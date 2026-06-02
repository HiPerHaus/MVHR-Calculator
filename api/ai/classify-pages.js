// api/ai/classify-pages.js
// POST /api/ai/classify-pages  (internal — called by render-pdf)
//
// Runs an AI page-type classification pass over all rendered pages of a PDF.
// Sends pages to Claude Vision in batches of MAX_BATCH_SIZE.
// Writes classification results to pdf_pages.
// Updates pdf_uploads.status → awaiting_confirmation when done.
//
// Request body (JSON):
//   uploadId   uuid    — pdf_uploads.id
//   jobId      uuid    — pdf_uploads.job_id
//   userId     string  — owning user id
//   pageCount  number  — total pages (for progress tracking)

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase  = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Haiku is sufficient for page-type classification (simple categorisation).
// Reserve Opus/Sonnet for the room analysis pass in analyse-plan.js.
const MODEL          = 'claude-haiku-4-5-20251001';
const MAX_BATCH_SIZE = 20;    // max pages per Claude Vision call
const BUCKET         = 'plan-uploads';

// ── Internal auth ─────────────────────────────────────────────────────────
function validateInternalToken(req) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    console.warn('classify-pages: INTERNAL_API_SECRET is not set. Falling back to host check — set this env var in production.');
    const host = req.headers.host ?? '';
    return host.includes('localhost') || host.includes('vercel.internal');
  }
  return req.headers['x-internal-secret'] === secret;
}

// ── Classification system prompt ───────────────────────────────────────────
const CLASSIFICATION_SYSTEM = `You are an expert architectural document classifier.
You will receive one or more images from an architectural plan set.
For EACH image, determine the page type and return a JSON classification.

PAGE TYPES:
- floor_plan       Horizontal cut showing rooms, walls, doors, windows, internal room labels
- site_plan        Site boundary, building footprint, north arrow, setbacks, survey information
- elevation        External facade view — height dimensions, floor level markers, cladding materials visible
- section          Vertical cross-section through the building — ceiling heights, floor-to-floor dimensions
- roof_plan        Roof geometry viewed from above — ridge lines, eaves, slope annotations
- detail           Enlarged construction node or junction — door head, window sill, wall connection
- schedule         Tabular data — door schedule, window schedule, room finish schedule
- specification    Written specification, notes sheet, or legend page
- unknown          Cannot be confidently classified

STRONG FLOOR PLAN INDICATORS (confidence ≥ 0.85):
- Room name labels visible inside rooms (BEDROOM, KITCHEN, LIVING, BATHROOM, etc.)
- Internal walls forming a plan layout with door swing arcs
- Window symbols on wall lines
- Area or dimension annotations inside rooms
- North arrow or compass rose
- Room numbers or reference codes

VOLUME CALCULATION METADATA:
For EVERY page, also assess:
- hasFloorLevels:    Are storey level markers or floor level indicators visible?
- hasCeilingHeights: Are ceiling height dimensions explicitly shown?
- hasRoofGeometry:   Is roof ridge geometry, slope, or eaves geometry visible?
- hasElevationData:  Is this an external elevation projection showing building height?
- hasSectionData:    Is this a cross-section cut showing floor-to-ceiling relationships?

RESPONSE FORMAT:
Return a JSON array — one object per image, in the same order as the images provided.
{
  "pages": [
    {
      "pageNumber":          1,
      "pageType":            "floor_plan",
      "confidence":          0.97,
      "reason":              "Room labels BEDROOM, KITCHEN, LIVING visible; door swings; window symbols on walls",
      "hasFloorLevels":      false,
      "hasCeilingHeights":   false,
      "hasRoofGeometry":     false,
      "hasElevationData":    false,
      "hasSectionData":      false
    }
  ]
}

Be concise in 'reason' — one sentence maximum.
If you cannot see the image clearly, return pageType: "unknown" with low confidence.`;

// ── Helpers ────────────────────────────────────────────────────────────────
function stripMarkdown(text) {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!validateInternalToken(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { uploadId, jobId, userId, pageCount, projectId } = req.body ?? {};

  if (!uploadId || !jobId || !userId) {
    return res.status(400).json({ error: 'uploadId, jobId, userId required' });
  }

  // Record classify start time
  const classifyStartedAt = new Date().toISOString();
  await supabase
    .from('pdf_uploads')
    .update({ classify_started_at: classifyStartedAt })
    .eq('id', uploadId);

  try {
    // ── Fetch all pages for this upload ────────────────────────────────────
    const { data: pages, error: pagesErr } = await supabase
      .from('pdf_pages')
      .select('id, page_number, image_path')
      .eq('pdf_upload_id', uploadId)
      .order('page_number', { ascending: true });

    if (pagesErr || !pages?.length) {
      throw new Error(`No pages found for upload ${uploadId}`);
    }

    // ── Process in batches ─────────────────────────────────────────────────
    const updates = [];

    for (let i = 0; i < pages.length; i += MAX_BATCH_SIZE) {
      const batch     = pages.slice(i, i + MAX_BATCH_SIZE);
      const batchNums = batch.map(p => p.page_number);

      // Generate signed URLs for each page image (1 hour TTL).
      const paths = batch
        .filter(p => p.image_path)
        .map(p => p.image_path.replace(`${BUCKET}/`, ''));

      const { data: signedUrls, error: signErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(paths, 3600);

      if (signErr || !signedUrls?.length) {
        console.warn(`classify-pages: could not sign URLs for batch ${i}–${i + batch.length}`);
        // Mark these pages as unknown rather than failing the whole job.
        for (const p of batch) {
          updates.push({
            id:                        p.id,
            page_type:                 'unknown',
            classification_confidence: null,
            classification_reason:     'Image not available for classification',
          });
        }
        continue;
      }

      // Build signed URL map: pageNumber → signedUrl
      const urlMap = {};
      for (let j = 0; j < batch.length; j++) {
        urlMap[batch[j].page_number] = signedUrls[j]?.signedUrl ?? null;
      }

      // ── Build Claude Vision message ──────────────────────────────────────
      // Each image is a separate content block.
      const imageBlocks = batch
        .filter(p => urlMap[p.page_number])
        .map(p => ({
          type: 'image',
          source: {
            type: 'url',
            url:  urlMap[p.page_number],
          },
        }));

      if (!imageBlocks.length) continue;

      // Tell Claude which page numbers correspond to which images.
      const pageListText = batch
        .filter(p => urlMap[p.page_number])
        .map((p, idx) => `Image ${idx + 1} = Page ${p.page_number}`)
        .join('\n');

      const userMessage = {
        role:    'user',
        content: [
          ...imageBlocks,
          {
            type: 'text',
            text: `Classify each of the ${imageBlocks.length} images above.\n\n${pageListText}\n\nReturn JSON only — no prose.`,
          },
        ],
      };

      // ── Call Claude ──────────────────────────────────────────────────────
      let batchResult;
      try {
        const response = await anthropic.messages.create({
          model:      MODEL,
          max_tokens: 2048,
          system:     CLASSIFICATION_SYSTEM,
          messages:   [userMessage],
        });

        const rawText   = response.content?.[0]?.text ?? '';
        const cleanText = stripMarkdown(rawText);
        batchResult     = JSON.parse(cleanText);
      } catch (aiErr) {
        console.error(`classify-pages: AI call failed for batch starting at page ${i + 1}:`, aiErr.message);
        // Graceful degradation — mark pages unknown.
        for (const p of batch) {
          updates.push({
            id:                        p.id,
            page_type:                 'unknown',
            classification_confidence: null,
            classification_reason:     'Classification failed',
          });
        }
        continue;
      }

      // ── Parse results ────────────────────────────────────────────────────
      const resultPages = batchResult?.pages ?? [];

      // Build lookup by pageNumber.
      const resultMap = {};
      for (const r of resultPages) {
        resultMap[r.pageNumber] = r;
      }

      for (const p of batch) {
        const r = resultMap[p.page_number] ?? {};
        const pageType = validatePageType(r.pageType);

        updates.push({
          id:                        p.id,
          page_type:                 pageType,
          classification_confidence: typeof r.confidence === 'number' ? r.confidence : null,
          classification_reason:     typeof r.reason === 'string'     ? r.reason.slice(0, 500) : null,
          has_floor_levels:          r.hasFloorLevels    ?? null,
          has_ceiling_heights:       r.hasCeilingHeights ?? null,
          has_roof_geometry:         r.hasRoofGeometry   ?? null,
          has_elevation_data:        r.hasElevationData  ?? null,
          has_section_data:          r.hasSectionData    ?? null,
        });
      }
    }

    // ── Write all updates to pdf_pages in one batched upsert ──────────────
    // Using upsert on 'id' avoids N individual UPDATE round-trips.
    if (updates.length > 0) {
      const { error: upsertErr } = await supabase
        .from('pdf_pages')
        .upsert(updates, { onConflict: 'id' });

      if (upsertErr) {
        console.error('classify-pages: batch upsert error', upsertErr);
        // Non-fatal — status will still advance to awaiting_confirmation.
      }
    }

    // ── Record completion + log performance ───────────────────────────────
    const classifyCompletedAt = new Date().toISOString();
    const classifyMs = Date.now() - new Date(classifyStartedAt).getTime();
    const failedClassifications = updates.filter(u => u.page_type === 'unknown' && u.classification_reason?.includes('failed')).length;

    console.log(JSON.stringify({
      event:                'classify-pages:complete',
      jobId,
      uploadId,
      totalPages:           pages.length,
      classifiedPages:      updates.length,
      failedClassifications,
      totalClassifyMs:      classifyMs,
      avgMsPerPage:         pages.length ? Math.round(classifyMs / pages.length) : 0,
      batchCount:           Math.ceil(pages.length / MAX_BATCH_SIZE),
    }));

    // ── Update pdf_uploads status → awaiting_confirmation ─────────────────
    await supabase
      .from('pdf_uploads')
      .update({
        status:                'awaiting_confirmation',
        classify_completed_at: classifyCompletedAt,
      })
      .eq('id', uploadId);

    // ── Hand off to auto-analyse via waitUntil ────────────────────────────
    // The status will transition: awaiting_confirmation → analysing → complete.
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';

    const analysePayload = JSON.stringify({ uploadId, jobId, userId, projectId: projectId ?? null });

    console.log(JSON.stringify({
      event:    'classify-pages:handoff',
      target:   'auto-analyse',
      uploadId,
      jobId,
    }));

    waitUntil(
      fetch(`${baseUrl}/api/ai/auto-analyse`, {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '',
        },
        body: analysePayload,
      }).then(async (r) => {
        const body = await r.text().catch(() => '');
        console.log(JSON.stringify({
          event:  'classify-pages:handoff-response',
          target: 'auto-analyse',
          status: r.status,
          body:   body.slice(0, 200),
        }));
        if (!r.ok) {
          await supabase
            .from('pdf_uploads')
            .update({ status: 'error', error_detail: `auto-analyse handoff failed (HTTP ${r.status}): ${body.slice(0, 300)}` })
            .eq('id', uploadId);
        }
      }).catch(async (err) => {
        console.error(JSON.stringify({
          event:  'classify-pages:handoff-error',
          target: 'auto-analyse',
          error:  err.message,
        }));
        await supabase
          .from('pdf_uploads')
          .update({ status: 'error', error_detail: `auto-analyse handoff error: ${err.message}` })
          .eq('id', uploadId);
      })
    );

    return res.status(200).json({
      uploadId,
      jobId,
      classifiedPages:      updates.length,
      failedClassifications,
      totalClassifyMs:      classifyMs,
      status: 'awaiting_confirmation',
    });

  } catch (err) {
    console.error('classify-pages: fatal error', err);

    await supabase
      .from('pdf_uploads')
      .update({ status: 'error', error_detail: err.message })
      .eq('id', uploadId);

    return res.status(500).json({ error: err.message });
  }
}

// ── Validation ─────────────────────────────────────────────────────────────
const VALID_PAGE_TYPES = new Set([
  'floor_plan', 'site_plan', 'elevation', 'section',
  'roof_plan', 'detail', 'schedule', 'specification', 'unknown',
]);

function validatePageType(raw) {
  if (typeof raw === 'string' && VALID_PAGE_TYPES.has(raw)) return raw;
  return 'unknown';
}
