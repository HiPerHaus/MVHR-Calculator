// api/ai/confirm-pages.js
// POST /api/ai/confirm-pages
//
// Records the user's confirmed floor-plan page selection.
// Updates pdf_pages with user_selected, page_role, floor_level, floor_name.
// Automatically sets page_role = 'volume_calculation' for elevation/section pages.
// Updates pdf_uploads.status = 'confirmed'.
//
// Request body (JSON):
// {
//   jobId: string,          // uuid — the job to confirm
//   pages: [
//     {
//       pageId:    string,   // uuid — pdf_pages.id
//       pageRole:  string,   // 'primary_analysis' | 'secondary_analysis' | ...
//       floorIndex:number,   // 0-based legacy field (kept for analyse-plan compat)
//       floorLevel:number,   // -1=basement, 0=ground, 1=first, ...
//       floorName: string,   // e.g. "Ground Floor Plan"
//     }
//   ]
// }
//
// Response 200:
// {
//   jobId:         string,
//   status:        'confirmed',
//   analysisPages: string[],  // pageIds selected for analysis
// }

import { createClient } from '@supabase/supabase-js';
import { rateLimit, applyRateLimit } from '../../lib/rate-limit.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const limiter = rateLimit({ windowMs: 60_000, max: 20 });

const VALID_PAGE_ROLES = new Set([
  'primary_analysis',
  'secondary_analysis',
  'volume_calculation',
  'reference_only',
  'ignored',
]);

// Page types that automatically get volume_calculation role
// even if the user didn't explicitly assign it.
const VOLUME_PAGE_TYPES = new Set(['elevation', 'section', 'roof_plan']);

function isUuid(v) {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!applyRateLimit(req, res, { limiter })) return;

  // ── Auth ──────────────────────────────────────────────────────────────────
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  // ── Parse body ────────────────────────────────────────────────────────────
  const { jobId, pages } = req.body ?? {};

  if (!jobId || !isUuid(jobId)) {
    return res.status(400).json({ error: 'jobId must be a valid UUID' });
  }

  if (!Array.isArray(pages) || pages.length === 0) {
    return res.status(400).json({ error: 'pages must be a non-empty array' });
  }

  // Validate each page entry.
  for (const p of pages) {
    if (!isUuid(p.pageId)) {
      return res.status(400).json({ error: `Invalid pageId: ${p.pageId}` });
    }
    if (p.pageRole && !VALID_PAGE_ROLES.has(p.pageRole)) {
      return res.status(400).json({ error: `Invalid pageRole: ${p.pageRole}` });
    }
  }

  // ── Fetch the upload (ownership check) ───────────────────────────────────
  const { data: upload, error: uploadErr } = await supabase
    .from('pdf_uploads')
    .select('id, job_id, status, user_id')
    .eq('job_id', jobId)
    .single();

  if (uploadErr || !upload) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (upload.user_id !== user.id) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Only allow confirmation from awaiting_confirmation state.
  // Allow re-confirmation (idempotent) from 'confirmed'.
  if (!['awaiting_confirmation', 'confirmed'].includes(upload.status)) {
    return res.status(409).json({
      error: `Cannot confirm pages in status: ${upload.status}`,
      currentStatus: upload.status,
    });
  }

  // ── Fetch all pages for this job to validate pageIds and get page_type ────
  const { data: allPages, error: allPagesErr } = await supabase
    .from('pdf_pages')
    .select('id, page_type, page_number')
    .eq('pdf_upload_id', upload.id);

  if (allPagesErr) {
    return res.status(500).json({ error: 'Failed to fetch pages' });
  }

  const pageMap = new Map(allPages.map(p => [p.id, p]));

  // Validate all submitted pageIds belong to this job.
  for (const p of pages) {
    if (!pageMap.has(p.pageId)) {
      return res.status(400).json({
        error: `pageId ${p.pageId} does not belong to job ${jobId}`,
      });
    }
  }

  // ── Build update payloads ─────────────────────────────────────────────────
  const submittedPageIds = new Set(pages.map(p => p.pageId));

  // Pages submitted by user → set user_selected + role + floor info.
  const selectedUpdates = pages.map(p => {
    const pageInfo = pageMap.get(p.pageId);
    // Default role: primary_analysis for floor plans, volume_calculation for elevations.
    const role = p.pageRole ??
      (VOLUME_PAGE_TYPES.has(pageInfo.page_type) ? 'volume_calculation' : 'primary_analysis');

    return {
      id:           p.pageId,
      user_selected:true,
      page_role:    role,
      floor_index:  p.floorIndex ?? null,
      floor_level:  p.floorLevel ?? null,
      floor_name:   p.floorName  ?? null,
    };
  });

  // Pages NOT submitted by user → mark unselected, preserve any existing role.
  // We don't reset page_role here — classification pass may have set volume_calculation
  // on elevation/section pages and we want to keep that.
  const unselectedPageIds = allPages
    .filter(p => !submittedPageIds.has(p.id))
    .map(p => p.id);

  // ── Write updates ─────────────────────────────────────────────────────────
  // Upsert selected pages one by one to set individual floor_level/floor_name.
  // (Supabase bulk upsert requires all rows to have the same columns.)
  for (const upd of selectedUpdates) {
    const { error: updErr } = await supabase
      .from('pdf_pages')
      .update({
        user_selected: upd.user_selected,
        page_role:     upd.page_role,
        floor_index:   upd.floor_index,
        floor_level:   upd.floor_level,
        floor_name:    upd.floor_name,
      })
      .eq('id', upd.id);

    if (updErr) {
      console.error('confirm-pages: update error for page', upd.id, updErr);
      return res.status(500).json({ error: 'Failed to update page selection' });
    }
  }

  // Mark unselected pages.
  if (unselectedPageIds.length > 0) {
    await supabase
      .from('pdf_pages')
      .update({ user_selected: false })
      .in('id', unselectedPageIds);
  }

  // Also auto-assign volume_calculation to any elevation/section pages that
  // weren't in the user's submitted list (they didn't select them for analysis
  // but we still want to tag them for future use).
  const volumeAutoIds = allPages
    .filter(p => !submittedPageIds.has(p.id) && VOLUME_PAGE_TYPES.has(p.page_type))
    .map(p => p.id);

  if (volumeAutoIds.length > 0) {
    await supabase
      .from('pdf_pages')
      .update({ page_role: 'volume_calculation' })
      .in('id', volumeAutoIds);
  }

  // ── Update upload status → confirmed ─────────────────────────────────────
  await supabase
    .from('pdf_uploads')
    .update({ status: 'confirmed' })
    .eq('id', upload.id);

  // ── Return analysisPages (pageIds with primary/secondary role) ────────────
  const analysisRoles = new Set(['primary_analysis', 'secondary_analysis']);
  const analysisPages = pages
    .filter(p => {
      const role = p.pageRole ??
        (VOLUME_PAGE_TYPES.has(pageMap.get(p.pageId)?.page_type) ? 'volume_calculation' : 'primary_analysis');
      return analysisRoles.has(role);
    })
    .map(p => p.pageId);

  return res.status(200).json({
    jobId:         upload.job_id,
    status:        'confirmed',
    analysisPages,
  });
}
