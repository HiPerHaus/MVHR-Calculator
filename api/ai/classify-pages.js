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
const MAX_BATCH_SIZE = 4;     // small batches → simpler JSON → fewer parse failures
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

// ── JSON extraction helpers ───────────────────────────────────────────────
// Strip markdown fences and extract the first JSON object or array found.
function extractJson(text) {
  // Remove markdown fences
  let s = text.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/im, '').trim();

  // Try direct parse first
  try { return JSON.parse(s); } catch (_) {}

  // Find the outermost { ... } or [ ... ] block
  const firstBrace  = s.indexOf('{');
  const firstBracket = s.indexOf('[');
  let start = -1;
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    start = firstBrace;
  } else if (firstBracket !== -1) {
    start = firstBracket;
  }
  if (start === -1) throw new SyntaxError('No JSON structure found in response');

  const lastBrace   = s.lastIndexOf('}');
  const lastBracket = s.lastIndexOf(']');
  const end = Math.max(lastBrace, lastBracket);
  if (end === -1 || end < start) throw new SyntaxError('Malformed JSON structure');

  return JSON.parse(s.slice(start, end + 1));
}

// Build a default "unclassified" result for a single page — used when all
// attempts to get a valid classification fail.
function unclassifiedResult(pageId, reason) {
  return {
    id:                        pageId,
    page_type:                 'unclassified',
    classification_confidence: null,
    classification_reason:     reason.slice(0, 500),
    has_floor_levels:          null,
    has_ceiling_heights:       null,
    has_roof_geometry:         null,
    has_elevation_data:        null,
    has_section_data:          null,
  };
}

// ── Single-page classification ─────────────────────────────────────────────
// Classifies exactly one page. Called as a fallback when a multi-page batch
// fails to parse — guarantees every page always gets a result.
async function classifyOnePage(page, signedUrl) {
  const userMessage = {
    role:    'user',
    content: [
      { type: 'image', source: { type: 'url', url: signedUrl } },
      { type: 'text',  text: 'Classify this single image. Return JSON only — no prose, no markdown.' },
    ],
  };

  const response = await anthropic.messages.create({
    model:      MODEL,
    max_tokens: 512,
    system:     CLASSIFICATION_SYSTEM,
    messages:   [userMessage],
    // Prefill forces the response to start with the JSON object.
  });

  const raw = response.content?.[0]?.text ?? '';
  const parsed = extractJson(raw);
  // Single-page response may be a bare object or wrapped in { pages: [...] }
  const r = parsed?.pages?.[0] ?? parsed;
  return r;
}

// ── Multi-page batch call ──────────────────────────────────────────────────
// Returns parsed result or throws. Caller is responsible for retry/fallback.
async function classifyBatch(batchPages, urlMap) {
  const activeBatch  = batchPages.filter(p => urlMap[p.page_number]);
  const imageBlocks  = activeBatch.map(p => ({
    type: 'image', source: { type: 'url', url: urlMap[p.page_number] },
  }));
  const pageListText = activeBatch
    .map((p, idx) => `Image ${idx + 1} = Page ${p.page_number}`)
    .join('\n');

  const userMessage = {
    role:    'user',
    content: [
      ...imageBlocks,
      {
        type: 'text',
        text: [
          `Classify each of the ${imageBlocks.length} images above.`,
          pageListText,
          '',
          'Respond with ONLY a JSON object — no markdown, no explanation, no prose.',
          'Format: {"pages":[{"pageNumber":N,"pageType":"...","confidence":0.0,"reason":"...","hasFloorLevels":false,"hasCeilingHeights":false,"hasRoofGeometry":false,"hasElevationData":false,"hasSectionData":false}]}',
        ].join('\n'),
      },
    ],
  };

  const response = await anthropic.messages.create({
    model:      MODEL,
    max_tokens: 256 * activeBatch.length + 128,  // scale with batch size
    system:     CLASSIFICATION_SYSTEM,
    messages:   [userMessage],
  });

  const raw = response.content?.[0]?.text ?? '';
  console.log(`[classify-pages] batch raw response (${activeBatch.length} pages):`, raw.slice(0, 400));
  return extractJson(raw);
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
      const batch = pages.slice(i, i + MAX_BATCH_SIZE);

      // ── Sign URLs ────────────────────────────────────────────────────────
      const paths = batch
        .filter(p => p.image_path)
        .map(p => p.image_path.replace(`${BUCKET}/`, ''));

      const { data: signedUrls, error: signErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(paths, 3600);

      if (signErr || !signedUrls?.length) {
        console.warn(`[classify-pages] could not sign URLs for batch starting at page ${batch[0].page_number}`);
        for (const p of batch) updates.push(unclassifiedResult(p.id, 'Image URL signing failed'));
        continue;
      }

      // Build pageNumber → signedUrl map (paths and batch are in the same order
      // because we filtered both by image_path presence in the same order).
      const urlMap = {};
      let urlIdx = 0;
      for (const p of batch) {
        if (p.image_path) {
          urlMap[p.page_number] = signedUrls[urlIdx]?.signedUrl ?? null;
          urlIdx++;
        }
      }

      const activeBatch = batch.filter(p => urlMap[p.page_number]);
      if (!activeBatch.length) {
        for (const p of batch) updates.push(unclassifiedResult(p.id, 'No image available'));
        continue;
      }

      // ── Attempt 1: batch call ─────────────────────────────────────────────
      let batchResult = null;
      let attempt1Err = null;
      try {
        batchResult = await classifyBatch(batch, urlMap);
      } catch (err) {
        attempt1Err = err;
        console.warn(`[classify-pages] batch parse failed (attempt 1, pages ${batch[0].page_number}–${batch[batch.length-1].page_number}): ${err.message}`);
      }

      // ── Attempt 2: retry once if first attempt failed ─────────────────────
      if (!batchResult) {
        try {
          batchResult = await classifyBatch(batch, urlMap);
        } catch (err) {
          console.warn(`[classify-pages] batch parse failed (attempt 2, pages ${batch[0].page_number}–${batch[batch.length-1].page_number}): ${err.message}`);
        }
      }

      // ── If batch succeeded, extract results ────────────────────────────────
      if (batchResult) {
        const resultPages = batchResult?.pages ?? (Array.isArray(batchResult) ? batchResult : []);
        const resultMap   = {};
        for (const r of resultPages) {
          if (r?.pageNumber != null) resultMap[r.pageNumber] = r;
        }

        for (const p of batch) {
          const r = resultMap[p.page_number];
          if (r) {
            updates.push({
              id:                        p.id,
              page_type:                 validatePageType(r.pageType),
              classification_confidence: typeof r.confidence === 'number' ? r.confidence : null,
              classification_reason:     typeof r.reason    === 'string'  ? r.reason.slice(0, 500) : null,
              has_floor_levels:          r.hasFloorLevels    ?? null,
              has_ceiling_heights:       r.hasCeilingHeights ?? null,
              has_roof_geometry:         r.hasRoofGeometry   ?? null,
              has_elevation_data:        r.hasElevationData  ?? null,
              has_section_data:          r.hasSectionData    ?? null,
            });
          } else {
            // Batch succeeded but this page's number wasn't in the response —
            // fall through to individual classification below.
            console.warn(`[classify-pages] page ${p.page_number} missing from batch result — classifying individually`);
            try {
              const r2 = await classifyOnePage(p, urlMap[p.page_number]);
              updates.push({
                id:                        p.id,
                page_type:                 validatePageType(r2?.pageType),
                classification_confidence: typeof r2?.confidence === 'number' ? r2.confidence : null,
                classification_reason:     (typeof r2?.reason === 'string' ? r2.reason : 'Individual fallback').slice(0, 500),
                has_floor_levels:          r2?.hasFloorLevels    ?? null,
                has_ceiling_heights:       r2?.hasCeilingHeights ?? null,
                has_roof_geometry:         r2?.hasRoofGeometry   ?? null,
                has_elevation_data:        r2?.hasElevationData  ?? null,
                has_section_data:          r2?.hasSectionData    ?? null,
              });
            } catch (indErr) {
              updates.push(unclassifiedResult(p.id, `Individual classification failed: ${indErr.message}`));
            }
          }
        }
        continue;
      }

      // ── Batch failed both attempts: classify each page individually ────────
      console.warn(`[classify-pages] falling back to per-page classification for pages ${batch[0].page_number}–${batch[batch.length-1].page_number}`);

      for (const p of activeBatch) {
        try {
          const r = await classifyOnePage(p, urlMap[p.page_number]);
          updates.push({
            id:                        p.id,
            page_type:                 validatePageType(r?.pageType),
            classification_confidence: typeof r?.confidence === 'number' ? r.confidence : null,
            classification_reason:     (typeof r?.reason === 'string' ? r.reason : 'Batch failed; classified individually').slice(0, 500),
            has_floor_levels:          r?.hasFloorLevels    ?? null,
            has_ceiling_heights:       r?.hasCeilingHeights ?? null,
            has_roof_geometry:         r?.hasRoofGeometry   ?? null,
            has_elevation_data:        r?.hasElevationData  ?? null,
            has_section_data:          r?.hasSectionData    ?? null,
          });
          console.log(`[classify-pages] individual classification page ${p.page_number}: ${r?.pageType ?? 'unknown'}`);
        } catch (indErr) {
          console.error(`[classify-pages] individual classification failed for page ${p.page_number}:`, indErr.message);
          updates.push(unclassifiedResult(p.id, `Classification failed: ${indErr.message}`));
        }
      }

      // Pages that had no signed URL are already handled above via unclassifiedResult.
      for (const p of batch.filter(p => !urlMap[p.page_number])) {
        updates.push(unclassifiedResult(p.id, 'No image available'));
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
    const host    = req.headers.host ?? '';
    const proto   = host.includes('localhost') ? 'http' : 'https';
    const baseUrl = `${proto}://${host}`;

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
