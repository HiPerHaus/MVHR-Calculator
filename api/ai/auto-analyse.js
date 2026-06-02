// api/ai/auto-analyse.js
// POST /api/ai/auto-analyse  (internal — called by classify-pages, not by the client)
//
// Runs the full analysis pipeline in the background after page classification completes:
//   1. Auto-selects floor_plan pages (confidence >= threshold).
//   2. Updates pdf_pages with user_selected, page_role, floor_index.
//   3. Calls analyse-plan for each selected page (internal auth via x-internal-secret).
//   4. Sets pdf_uploads.status = 'complete'.
//   5. Sends a "your analysis is ready" email via Resend.
//
// The user never needs to interact with the page selection UI in this flow.
// classify-pages fires this as a fire-and-forget call after classification completes.
//
// Request body (JSON):
//   uploadId   uuid    — pdf_uploads.id
//   jobId      uuid    — pdf_uploads.job_id
//   userId     string  — owning user id
//   projectId  uuid    — optional, for email content
//
// Required env vars:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   INTERNAL_API_SECRET
//   RESEND_API_KEY
//   APP_URL                  — base URL of the app, e.g. https://hiper-studio.au
//   EMAIL_FROM               — sender address, e.g. HiPer Studio <no-reply@hiper-studio.au>

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Constants ──────────────────────────────────────────────────────────────
const BUCKET             = 'plan-uploads';
const PRIMARY_THRESHOLD  = 0.70;   // Confident floor plan
const FALLBACK_THRESHOLD = 0.40;   // If no confident pages found, accept lower confidence
const APP_URL            = (process.env.APP_URL ?? 'https://hiper-studio.au').replace(/\/$/, '');
const EMAIL_FROM         = process.env.EMAIL_FROM ?? 'HiPer Studio <no-reply@hiper-studio.au>';

// ── Internal auth ──────────────────────────────────────────────────────────
function validateInternalToken(req) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    console.warn('auto-analyse: INTERNAL_API_SECRET is not set — falling back to host check.');
    const host = req.headers.host ?? '';
    return host.includes('localhost') || host.includes('vercel.internal');
  }
  return req.headers['x-internal-secret'] === secret;
}

// ── Page selection ─────────────────────────────────────────────────────────
// Priority order:
//   1. floor_plan pages, confidence ≥ PRIMARY_THRESHOLD  (sorted by confidence desc, then page_number)
//   2. floor_plan pages, confidence ≥ FALLBACK_THRESHOLD
//   3. floor_plan pages, any confidence
//   4. site_plan pages (last-resort useful fallback)
//   5. any page (something is better than nothing)
// Never voluntarily selects elevation/section/detail/schedule/specification.
function selectFloorPlanPages(pages) {
  const floorPlans = pages
    .filter(p => p.page_type === 'floor_plan')
    .sort((a, b) => {
      // Primary sort: confidence desc
      const confDiff = (b.classification_confidence ?? 0) - (a.classification_confidence ?? 0);
      if (confDiff !== 0) return confDiff;
      return a.page_number - b.page_number;
    });

  let selected =
    floorPlans.filter(p => (p.classification_confidence ?? 0) >= PRIMARY_THRESHOLD)  ||
    floorPlans.filter(p => (p.classification_confidence ?? 0) >= FALLBACK_THRESHOLD) ||
    floorPlans;

  // Proper fallback chain — || on arrays is always truthy, use length checks:
  if (!selected.length) selected = floorPlans.filter(p => (p.classification_confidence ?? 0) >= PRIMARY_THRESHOLD);
  if (!selected.length) selected = floorPlans.filter(p => (p.classification_confidence ?? 0) >= FALLBACK_THRESHOLD);
  if (!selected.length) selected = floorPlans;
  if (!selected.length) selected = pages.filter(p => p.page_type === 'site_plan');
  if (!selected.length) selected = pages.slice(0, 1);

  // Deduplicate: if the same floor_level appears multiple times, keep highest confidence.
  const seen = new Map();
  for (const p of selected) {
    const key = p.floor_level ?? `page_${p.page_number}`;
    const existing = seen.get(key);
    if (!existing || (p.classification_confidence ?? 0) > (existing.classification_confidence ?? 0)) {
      seen.set(key, p);
    }
  }

  // Final sort: floor_level asc (known levels), then page_number asc.
  return [...seen.values()].sort((a, b) => {
    if (a.floor_level !== null && b.floor_level !== null) return a.floor_level - b.floor_level;
    return a.page_number - b.page_number;
  });
}

// ── Render hi-res image for one page (Stage 2) ────────────────────────────
// Calls render-hires which renders the page at 250 DPI PNG and stores it.
// Returns the hires_image_path, or null if render fails (analyse-plan
// will fall back to the low-res classification image).
async function renderHires({ uploadId, jobId, pageId, storagePath, pageNumber, userId, baseUrl }) {
  const secret = process.env.INTERNAL_API_SECRET;
  console.log('[auto-analyse] render-hires call', {
    pageNumber,
    hasSecret: !!secret,
    secretLen: secret?.length ?? 0,
    url: `${baseUrl}/api/ai/render-hires`,
  });

  if (!secret) {
    console.error('[auto-analyse] INTERNAL_API_SECRET is not set — render-hires will return 401/403');
  }

  try {
    const res = await fetch(`${baseUrl}/api/ai/render-hires`, {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-internal-secret': secret ?? '',
      },
      body: JSON.stringify({ uploadId, jobId, pageId, storagePath, pageNumber, userId }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      console.warn(`[auto-analyse] render-hires HTTP ${res.status} for page ${pageNumber}:`, text.slice(0, 200));
      return null;
    }

    const data = await res.json();
    return data.hiresPath ?? null;
  } catch (e) {
    console.warn(`[auto-analyse] render-hires fetch error for page ${pageNumber}:`, e.message);
    return null;
  }
}

// ── Analyse one page ───────────────────────────────────────────────────────
// Calls analyse-plan with internal auth (x-internal-secret + userId in body).
async function analysePage({ uploadId, jobId, userId, projectId, pageId, floorIndex, floorLevel, floorName, hiresImagePath, baseUrl }) {
  const secret = process.env.INTERNAL_API_SECRET;
  console.log('[auto-analyse] analyse-plan call', {
    pageId,
    hasSecret: !!secret,
    secretLen: secret?.length ?? 0,
    url: `${baseUrl}/api/ai/analyse-plan`,
  });

  if (!secret) {
    console.error('[auto-analyse] INTERNAL_API_SECRET is not set — analyse-plan will return 401/403');
  }

  const body = {
    pdfPageId:   pageId,
    pdfUploadId: uploadId,
    floorIndex,
    userId,
    ...(projectId      ? { projectId }      : {}),
    ...(floorName      ? { floorName }      : {}),
    ...(hiresImagePath ? { hiresImagePath } : {}),
  };

  const res = await fetch(`${baseUrl}/api/ai/analyse-plan`, {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-internal-secret': secret ?? '',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(240_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`analyse-plan returned ${res.status}: ${text.slice(0, 300)}`);
  }

  return res.json();
}

// ── Email builder ──────────────────────────────────────────────────────────
function buildEmail({ userName, floorSummaries, dashboardUrl }) {
  const floorRows = floorSummaries.map((f, i) => `
    <tr>
      <td style="padding:8px 16px;border-bottom:1px solid #e5e7eb;color:#374151">
        ${f.floorName || `Floor ${i + 1}`}
      </td>
      <td style="padding:8px 16px;border-bottom:1px solid #e5e7eb;color:#374151;text-align:center">
        ${f.supplyCount}
      </td>
      <td style="padding:8px 16px;border-bottom:1px solid #e5e7eb;color:#374151;text-align:center">
        ${f.extractCount}
      </td>
    </tr>`).join('');

  const totalSupply  = floorSummaries.reduce((s, f) => s + f.supplyCount, 0);
  const totalExtract = floorSummaries.reduce((s, f) => s + f.extractCount, 0);

  return {
    subject: 'Your floor plan analysis is ready — HiPer Studio',
    html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">

        <!-- Header -->
        <tr><td style="background:#1d4ed8;padding:32px 40px">
          <p style="margin:0;color:#ffffff;font-size:22px;font-weight:600;letter-spacing:-0.3px">HiPer Studio</p>
          <p style="margin:8px 0 0;color:#bfdbfe;font-size:14px">MVHR Design Platform</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:40px">
          <p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#111827">
            Hi ${escapeHtml(userName || 'there')},
          </p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151">
            Your floor plan analysis is complete. Here's a summary of what we found:
          </p>

          <!-- Results table -->
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin-bottom:24px">
            <thead>
              <tr style="background:#f3f4f6">
                <th style="padding:10px 16px;text-align:left;font-size:13px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em">Floor</th>
                <th style="padding:10px 16px;text-align:center;font-size:13px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em">Supply</th>
                <th style="padding:10px 16px;text-align:center;font-size:13px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em">Extract</th>
              </tr>
            </thead>
            <tbody>
              ${floorRows}
              <tr style="background:#f9fafb">
                <td style="padding:10px 16px;font-size:14px;font-weight:600;color:#111827">Total</td>
                <td style="padding:10px 16px;text-align:center;font-size:14px;font-weight:600;color:#111827">${totalSupply}</td>
                <td style="padding:10px 16px;text-align:center;font-size:14px;font-weight:600;color:#111827">${totalExtract}</td>
              </tr>
            </tbody>
          </table>

          <!-- CTA -->
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px">
            <tr><td style="background:#1d4ed8;border-radius:6px">
              <a href="${dashboardUrl}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:-0.2px">
                View your results →
              </a>
            </td></tr>
          </table>

          <p style="margin:0;font-size:13px;line-height:1.6;color:#9ca3af">
            If the button above doesn't work, copy and paste this URL into your browser:<br>
            <a href="${dashboardUrl}" style="color:#1d4ed8;word-break:break-all">${dashboardUrl}</a>
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:24px 40px;border-top:1px solid #e5e7eb">
          <p style="margin:0;font-size:12px;color:#9ca3af">
            This email was sent by HiPer Studio · <a href="https://hiper-studio.au" style="color:#9ca3af">hiper-studio.au</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!validateInternalToken(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { uploadId, jobId, userId, projectId } = req.body ?? {};

  if (!uploadId || !jobId || !userId) {
    return res.status(400).json({ error: 'uploadId, jobId, userId required' });
  }

  // Log secret availability early — the most common cause of 401s on internal calls.
  console.log('[auto-analyse] env check', {
    hasInternalSecret: !!process.env.INTERNAL_API_SECRET,
    secretLen:         process.env.INTERNAL_API_SECRET?.length ?? 0,
    uploadId,
    jobId,
  });

  // Use the canonical public URL so internal self-calls bypass Vercel deployment protection.
  // VERCEL_URL is deployment-specific and hits the protected preview URL — don't use it.
  const baseUrl = (
    process.env.PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    (req.headers.host?.includes('localhost') ? 'http://localhost:3000' : 'https://www.hiper-studio.au')
  ).replace(/\/$/, '');

  // ── Mark as analysing immediately (prevents polling clients showing awaiting_confirmation) ──
  await supabase
    .from('pdf_uploads')
    .update({ status: 'analysing', auto_analysis: true })
    .eq('id', uploadId);

  try {
    // ── Fetch pdf_uploads.storage_path (needed for hi-res render) ─────────
    const { data: uploadRow, error: uploadErr } = await supabase
      .from('pdf_uploads')
      .select('storage_path')
      .eq('id', uploadId)
      .single();

    if (uploadErr || !uploadRow?.storage_path) {
      throw new Error(`Could not fetch storage_path for upload ${uploadId}: ${uploadErr?.message ?? 'empty'}`);
    }

    const originalStoragePath = uploadRow.storage_path;

    // ── Fetch all classified pages ─────────────────────────────────────────
    const { data: pages, error: pagesErr } = await supabase
      .from('pdf_pages')
      .select('id, page_number, page_type, classification_confidence, floor_level, floor_name, image_path')
      .eq('pdf_upload_id', uploadId)
      .order('page_number', { ascending: true });

    if (pagesErr || !pages?.length) {
      throw new Error(`No pages found for upload ${uploadId}: ${pagesErr?.message ?? 'empty'}`);
    }

    // ── Auto-select floor plan pages ───────────────────────────────────────
    const selectedPages = selectFloorPlanPages(pages);

    console.log(JSON.stringify({
      event:         'auto-analyse:pages-selected',
      jobId,
      uploadId,
      totalPages:    pages.length,
      selectedPages: selectedPages.map(p => ({ pageId: p.id, pageNumber: p.page_number, confidence: p.classification_confidence })),
    }));

    // ── Update pdf_pages — mark selected ──────────────────────────────────
    const pageUpdates = selectedPages.map((p, idx) => ({
      id:           p.id,
      user_selected: true,
      page_role:    'primary_analysis',
      floor_index:  idx,
      floor_level:  p.floor_level ?? idx,
      floor_name:   p.floor_name ?? (idx === 0 ? 'Ground Floor' : `Floor ${idx + 1}`),
    }));

    if (pageUpdates.length > 0) {
      await supabase.from('pdf_pages').upsert(pageUpdates, { onConflict: 'id' });
    }

    // ── Mark all non-selected pages ───────────────────────────────────────
    const selectedIds = new Set(selectedPages.map(p => p.id));
    const unselectedIds = pages.filter(p => !selectedIds.has(p.id)).map(p => p.id);
    if (unselectedIds.length > 0) {
      await supabase.from('pdf_pages').update({ user_selected: false }).in('id', unselectedIds);
    }

    // ── Run analyse-plan for each selected page ────────────────────────────
    const analysisResults = [];
    let successCount = 0;

    for (const pageUpdate of pageUpdates) {
      const page = selectedPages.find(p => p.id === pageUpdate.id);
      try {
        // Stage 2: render hi-res PNG for this floor plan page before analysis.
        // Falls back gracefully (null) — analyse-plan will use the low-res JPEG.
        const tHires = Date.now();
        const hiresImagePath = await renderHires({
          uploadId,
          jobId,
          pageId:      pageUpdate.id,
          storagePath: originalStoragePath,
          pageNumber:  page.page_number,
          userId,
          baseUrl,
        });
        console.log(JSON.stringify({
          event:      'auto-analyse:hires-render',
          jobId,
          pageNumber: page.page_number,
          success:    !!hiresImagePath,
          durationMs: Date.now() - tHires,
        }));

        const result = await analysePage({
          uploadId,
          jobId,
          userId,
          projectId: projectId ?? null,
          pageId:    pageUpdate.id,
          floorIndex: pageUpdate.floor_index,
          floorLevel: pageUpdate.floor_level,
          floorName:  pageUpdate.floor_name,
          hiresImagePath,
          baseUrl,
        });

        analysisResults.push({
          pageId:      pageUpdate.id,
          pageNumber:  page?.page_number,
          floorName:   pageUpdate.floor_name,
          floorIndex:  pageUpdate.floor_index,
          supplyCount: result.rooms?.supply?.length ?? 0,
          extractCount: result.rooms?.extract?.length ?? 0,
          success:     true,
        });
        successCount++;

        console.log(JSON.stringify({
          event:       'auto-analyse:page-done',
          jobId,
          pageNumber:  page?.page_number,
          floorName:   pageUpdate.floor_name,
          rooms:       (result.rooms?.supply?.length ?? 0) + (result.rooms?.extract?.length ?? 0),
        }));
      } catch (pageErr) {
        console.error(`auto-analyse: analyse-plan failed for page ${pageUpdate.id}:`, pageErr.message);
        analysisResults.push({
          pageId:     pageUpdate.id,
          pageNumber: page?.page_number,
          floorName:  pageUpdate.floor_name,
          success:    false,
          error:      pageErr.message,
        });
      }
    }

    // ── Mark complete ──────────────────────────────────────────────────────
    const completedAt = new Date().toISOString();
    await supabase
      .from('pdf_uploads')
      .update({
        status:               'complete',
        analysed_page_count:  successCount,
        completed_at:         completedAt,
      })
      .eq('id', uploadId);

    console.log(JSON.stringify({
      event:        'auto-analyse:complete',
      jobId,
      uploadId,
      successCount,
      failCount:    pageUpdates.length - successCount,
    }));

    // ── Send email ─────────────────────────────────────────────────────────
    try {
      await sendCompletionEmail({
        userId,
        jobId,
        analysisResults,
      });
    } catch (emailErr) {
      // Non-fatal — log and continue.
      console.error('auto-analyse: email failed:', emailErr.message);
    }

    return res.status(200).json({
      jobId,
      uploadId,
      status:       'complete',
      selectedPages: pageUpdates.length,
      successCount,
    });

  } catch (err) {
    console.error('auto-analyse: fatal error', err);

    await supabase
      .from('pdf_uploads')
      .update({ status: 'error', error_detail: err.message })
      .eq('id', uploadId);

    return res.status(500).json({ error: err.message });
  }
}

// ── Email dispatch ─────────────────────────────────────────────────────────
async function sendCompletionEmail({ userId, jobId, analysisResults }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('auto-analyse: RESEND_API_KEY not set — skipping email');
    return;
  }

  // Fetch user email + name from profiles
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', userId)
    .single();

  // Fallback: fetch email from auth.users via admin API
  let userEmail = profile?.email;
  let userName  = profile?.full_name ?? '';

  if (!userEmail) {
    const { data: { user: authUser } } = await supabase.auth.admin.getUserById(userId);
    userEmail = authUser?.email;
    userName  = authUser?.user_metadata?.full_name ?? authUser?.email?.split('@')[0] ?? '';
  }

  if (!userEmail) {
    console.warn(`auto-analyse: could not resolve email for userId ${userId} — skipping email`);
    return;
  }

  const successfulResults = analysisResults.filter(r => r.success);
  const floorSummaries = successfulResults.map(r => ({
    floorName:    r.floorName,
    supplyCount:  r.supplyCount,
    extractCount: r.extractCount,
  }));

  const dashboardUrl = `${APP_URL}`;
  const { subject, html } = buildEmail({ userName, floorSummaries, dashboardUrl });

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data: emailData, error: emailErr } = await resend.emails.send({
    from:    EMAIL_FROM,
    to:      userEmail,
    subject,
    html,
  });

  if (emailErr) throw new Error(`Resend error: ${emailErr.message ?? JSON.stringify(emailErr)}`);

  // Record email sent timestamp
  await supabase
    .from('pdf_uploads')
    .update({ email_sent_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('status', 'complete')
    .is('email_sent_at', null)
    .order('created_at', { ascending: false })
    .limit(1);

  console.log(JSON.stringify({
    event:    'auto-analyse:email-sent',
    jobId,
    to:       userEmail,
    emailId:  emailData?.id,
  }));
}
