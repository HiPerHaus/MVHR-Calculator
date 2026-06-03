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
const CLASSIFICATION_SYSTEM = `You are an architectural drawing classifier for an MVHR design platform.
Your task is NOT to analyse rooms.
Your task is ONLY to identify which pages in a drawing set contain usable architectural floor plans suitable for MVHR room extraction.
A usable floor plan must show:

* Internal room layouts
* Room names or room boundaries
* Internal walls and doors
* The actual habitable spaces within the building
Examples of VALID MVHR floor plans:

* Ground Floor Plan
* First Floor Plan
* Upper Floor Plan
* Basement Plan
* Mezzanine Plan
* Architectural Floor Plan
* Floor Plan with room labels
* Floor Plan with dimensions
Examples of INVALID pages:

* Site Plans
* Survey Plans
* Location Plans
* Roof Plans
* Reflected Ceiling Plans
* Electrical Plans
* Hydraulic Plans
* Structural Plans
* Framing Plans
* Slab Plans
* Setout Plans
* Construction Sequence Plans
* Door Schedules
* Window Schedules
* Elevations
* Sections
* Details
* Specifications
* Notes Sheets
* Energy Reports
Strong indicators of a valid MVHR floor plan:

* Top-down (bird's-eye) view of the building interior
* Room boundaries drawn as horizontal plan walls
* Door symbols shown as arcs swinging from a hinge point
* North arrow or compass rose
* Room names INSIDE room boundaries (not as titles above a drawing):
   * Bedroom / Bed 1 / Bed 2 / Master
   * Living / Lounge / Family / Dining / Meals
   * Kitchen / Pantry / Scullery
   * Bathroom / Bath / Ensuite
   * WC / Laundry
   * WIR / Store / Entry / Hallway
   * Study / Office / Rumpus / Media

CRITICAL DISTINCTION — Room names vs. Elevation headings:
A floor plan shows room names INSIDE the room boundaries on a top-down view.
An Internal Elevations sheet shows room names as HEADINGS above elevation drawings.

Internal Elevations sheets look like this:
  "ENSUITE ELEVATION"    — heading above a wall drawing showing tiles, shower, mirror
  "WC ELEVATION"         — heading above a wall drawing showing toilet, cistern, basin
  "LAUNDRY ELEVATION"    — heading above a wall drawing showing joinery, appliances
  "KITCHEN ELEVATION A"  — heading above a cabinet/bench drawing
These sheets contain room names but are NOT floor plans.
The primary content is vertical wall views, not horizontal room layouts.

How to tell the difference:
  Floor plan      → walls form enclosed room shapes viewed from above; doors shown as arcs
  Internal Elev.  → single wall faces shown flat-on; cabinets shown in front-elevation;
                    multiple drawings tiled across the page; heights/vertical dimensions visible
  Building Elev.  → external facade view; no internal rooms visible; floor level markers
  Section         → vertical cut through building; ceiling heights; floor-to-floor dimensions

Strong indicators of an INVALID page:

* Title contains "Elevation", "Elevations", "Internal Elevation", "Elev" — REJECT
* Title contains "Section", "Detail", "Construction" — REJECT
* Title contains "Roof Plan", "Site Plan", "Slab", "Electrical", "Services" — REJECT
* Multiple tiled wall-face drawings on one sheet — REJECT (Internal Elevations)
* Drawings showing cabinet fronts, tile patterns, or wall faces in portrait orientation — REJECT
* Large contour maps, property boundaries, setbacks — REJECT
* Ceiling grid or lighting layout — REJECT (Reflected Ceiling Plan)
* Structural grid, steel members, bracing — REJECT

IMPORTANT RULES:
A sheet titled "Internal Elevations" is NEVER a floor plan even if it shows room names.
A sheet titled "Elevations" is NEVER a floor plan even if it shows room shapes.
A sheet titled "Section" is NEVER a floor plan.
A detail sheet with a small reference floor plan in a corner is NOT a floor plan — reject it.
The PRIMARY purpose of the sheet determines its classification, not incidental reference drawings.
A building footprint on a Site Plan is NOT a floor plan.
A slab outline on a Slab Plan is NOT a floor plan.
A reflected ceiling plan is NOT a floor plan.
Only select pages where room layouts are visible from above and rooms can be analysed for MVHR.

For each page return:
{ "pageNumber": number, "isFloorPlan": true|false, "confidence": 0.0-1.0, "reason": "short explanation" }
After evaluating all pages return a summary object:
{ "selectedPages": [page numbers], "rejectedPages": [page numbers], "summary": "why the selected pages were chosen" }

Return ONLY valid JSON — no markdown, no prose, no explanation outside the JSON.`;

// Map isFloorPlan result to internal pageType vocabulary.
// The classifier now returns a binary decision; we preserve the full
// taxonomy for non-floor-plan pages as 'unknown' (sufficient for MVHR).
function isFloorPlanToPageType(isFloorPlan) {
  return isFloorPlan === true ? 'floor_plan' : 'unknown';
}

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

// Derive boolean metadata from pageType — avoids asking the AI for extra fields.
function deriveBooleans(pageType) {
  return {
    has_floor_levels:    pageType === 'section'   || pageType === 'elevation',
    has_ceiling_heights: pageType === 'section',
    has_roof_geometry:   pageType === 'roof_plan' || pageType === 'section',
    has_elevation_data:  pageType === 'elevation',
    has_section_data:    pageType === 'section',
  };
}


// Build a DB upsert record from a parsed AI result.
// `page` must be the full fetched row (id, page_number, pdf_upload_id) so
// the upsert never hits NOT NULL constraints on those columns.
function buildUpdate(page, r, fallbackReason) {
  // Support both old {pageType} and new {isFloorPlan} response shapes.
  const rawPageType = r?.pageType
    ?? isFloorPlanToPageType(r?.isFloorPlan);
  const pageType = validatePageType(rawPageType);
  return {
    id:                        page.id,
    pdf_upload_id:             page.pdf_upload_id,
    page_number:               page.page_number,
    page_type:                 pageType,
    classification_confidence: typeof r?.confidence === 'number' ? r.confidence : null,
    classification_reason:     (typeof r?.reason === 'string' ? r.reason : fallbackReason ?? 'classified').slice(0, 500),
    ...deriveBooleans(pageType),
  };
}

// Build a safe "unclassified" record — includes all NOT NULL columns.
function unclassifiedRecord(page, reason) {
  return {
    id:                        page.id,
    pdf_upload_id:             page.pdf_upload_id,
    page_number:               page.page_number,
    page_type:                 'unclassified',
    classification_confidence: null,
    classification_reason:     reason.slice(0, 500),
    ...deriveBooleans('unclassified'),
  };
}

// ── Single-page classification ─────────────────────────────────────────────
async function classifyOnePage(page, signedUrl) {
  const response = await anthropic.messages.create({
    model:      MODEL,
    max_tokens: 128,
    system:     CLASSIFICATION_SYSTEM,
    messages:   [{
      role:    'user',
      content: [
        { type: 'image', source: { type: 'url', url: signedUrl } },
        { type: 'text',  text: 'Evaluate this image. Return JSON only — no prose, no markdown.\n{"pages":[{"pageNumber":1,"isFloorPlan":true,"confidence":0.0,"reason":"..."}],"selectedPages":[1],"rejectedPages":[],"summary":"..."}' },
      ],
    }],
  });

  const raw    = response.content?.[0]?.text ?? '';
  const parsed = extractJson(raw);
  return parsed?.pages?.[0] ?? parsed;
}

// ── Multi-page batch call ──────────────────────────────────────────────────
async function classifyBatch(batchPages, urlMap) {
  const activeBatch = batchPages.filter(p => urlMap[p.page_number]);
  const imageBlocks = activeBatch.map(p => ({
    type: 'image', source: { type: 'url', url: urlMap[p.page_number] },
  }));
  const pageListText = activeBatch
    .map((p, idx) => `Image ${idx + 1} = Page ${p.page_number}`)
    .join('\n');

  const response = await anthropic.messages.create({
    model:      MODEL,
    max_tokens: 128 * activeBatch.length + 64,
    system:     CLASSIFICATION_SYSTEM,
    messages:   [{
      role:    'user',
      content: [
        ...imageBlocks,
        {
          type: 'text',
          text: [
            `Evaluate each of the ${imageBlocks.length} images above for MVHR floor plan suitability.`,
            pageListText,
            '',
            'Return ONLY JSON — no markdown, no prose.',
            '{"pages":[{"pageNumber":N,"isFloorPlan":true|false,"confidence":0.0,"reason":"..."}],"selectedPages":[...],"rejectedPages":[...],"summary":"..."}',
          ].join('\n'),
        },
      ],
    }],
  });

  const raw = response.content?.[0]?.text ?? '';
  console.log(`[classify-pages] batch raw (${activeBatch.length} pages):`, raw.slice(0, 300));
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
      .select('id, page_number, image_path, upload_id, pdf_upload_id')
      .or(`pdf_upload_id.eq.${uploadId},upload_id.eq.${uploadId}`)
      .order('page_number', { ascending: true });

    if (pagesErr || !pages?.length) {
      throw new Error(`No pages found for upload ${uploadId}`);
    }

    // ── Process in batches ─────────────────────────────────────────────────
    const updates = [];

    for (let i = 0; i < pages.length; i += MAX_BATCH_SIZE) {
      const batch = pages.slice(i, i + MAX_BATCH_SIZE);

      // Guard: skip any page row that somehow has no page_number — cannot safely upsert.
      for (const p of batch) {
        if (!p.page_number) {
          console.error(`[classify-pages] page row ${p.id} has null page_number — skipping`);
        }
      }
      const validBatch = batch.filter(p => p.page_number != null);

      // ── Sign URLs ────────────────────────────────────────────────────────
      const paths = validBatch
        .filter(p => p.image_path)
        .map(p => p.image_path.replace(`${BUCKET}/`, ''));

      const { data: signedUrls, error: signErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(paths, 3600);

      if (signErr || !signedUrls?.length) {
        console.warn(`[classify-pages] could not sign URLs for batch starting at page ${validBatch[0]?.page_number}`);
        for (const p of validBatch) updates.push(unclassifiedRecord(p, 'Image URL signing failed'));
        continue;
      }

      // Build pageNumber → signedUrl map
      const urlMap = {};
      let urlIdx = 0;
      for (const p of validBatch) {
        if (p.image_path) {
          urlMap[p.page_number] = signedUrls[urlIdx]?.signedUrl ?? null;
          urlIdx++;
        }
      }

      const activeBatch = validBatch.filter(p => urlMap[p.page_number]);

      if (!activeBatch.length) {
        for (const p of validBatch) updates.push(unclassifiedRecord(p, 'No image available'));
        continue;
      }

      // ── Attempt 1: batch call ─────────────────────────────────────────────
      let batchResult = null;
      let attempt1Err = null;
      try {
        batchResult = await classifyBatch(validBatch, urlMap);
      } catch (err) {
        attempt1Err = err;
        console.warn(`[classify-pages] batch parse failed (attempt 1, pages ${batch[0].page_number}–${batch[batch.length-1].page_number}): ${err.message}`);
      }

      // ── Attempt 2: retry once if first attempt failed ─────────────────────
      if (!batchResult) {
        try {
          batchResult = await classifyBatch(validBatch, urlMap);
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

        for (const p of validBatch) {
          const r = resultMap[p.page_number];
          if (r) {
            updates.push(buildUpdate(p, r, null));
          } else {
            // Batch succeeded but this page was missing — classify individually.
            console.warn(`[classify-pages] page ${p.page_number} missing from batch result — classifying individually`);
            try {
              const r2 = await classifyOnePage(p, urlMap[p.page_number]);
              updates.push(buildUpdate(p, r2, 'Individual fallback'));
            } catch (indErr) {
              updates.push(unclassifiedRecord(p, `Individual classification failed: ${indErr.message}`));
            }
          }
        }
        continue;
      }

      // ── Batch failed both attempts: classify each page individually ────────
      console.warn(`[classify-pages] falling back to per-page classification for pages ${validBatch[0]?.page_number}–${validBatch[validBatch.length-1]?.page_number}`);

      for (const p of activeBatch) {
        try {
          const r = await classifyOnePage(p, urlMap[p.page_number]);
          updates.push(buildUpdate(p, r, 'Batch failed; classified individually'));
          console.log(`[classify-pages] individual page ${p.page_number}: ${validatePageType(r?.pageType)}`);
        } catch (indErr) {
          console.error(`[classify-pages] individual failed for page ${p.page_number}:`, indErr.message);
          updates.push(unclassifiedRecord(p, `Classification failed: ${indErr.message}`));
        }
      }

      // Pages with no signed URL were not in activeBatch — mark them unclassified.
      for (const p of validBatch.filter(p => !urlMap[p.page_number])) {
        updates.push(unclassifiedRecord(p, 'No image available'));
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

    const classifiedCount = updates.filter(u => u.page_type !== 'unclassified').length;

    // Use actual pdf_pages rows as source of truth.
    // Supabase JS v2: count option must be on select('*', { count, head }) — but to
    // avoid count syntax pitfalls, just fetch ids and use .length.
    const { data: pageRows, error: pageCountErr } = await supabase
      .from('pdf_pages')
      .select('id, page_number, pdf_upload_id')
      .eq('pdf_upload_id', uploadId)
      .limit(100);

    const renderedCount = pageRows?.length ?? pages.length;

    console.log(JSON.stringify({
      event:              'classify-pages:page-count-check',
      uploadId,
      countByPdfUploadId: renderedCount,
      pageCountErr:       pageCountErr?.message ?? null,
      pagesArrayLength:   pages.length,
      classifiedCount,
      sampleRows:         (pageRows ?? []).slice(0, 3).map(r => ({
        id: r.id, page_number: r.page_number, pdf_upload_id: r.pdf_upload_id,
      })),
    }));

    // ── Update pdf_uploads with accurate progress fields ──────────────────
    await supabase
      .from('pdf_uploads')
      .update({
        status:                'awaiting_confirmation',
        stage:                 'classified',
        page_count:            renderedCount,
        pages_rendered:        renderedCount,
        pages_classified:      classifiedCount,
        classify_completed_at: classifyCompletedAt,
      })
      .eq('id', uploadId);

    // ── Gate: only hand off to auto-analyse if pages actually exist ────────
    if (renderedCount === 0) {
      console.log(JSON.stringify({
        event: 'classify-pages:handoff-skipped',
        reason: 'no pdf_pages rows exist',
        uploadId, jobId, renderedCount, classifiedCount,
      }));
      await supabase.from('pdf_uploads')
        .update({ status: 'error', error_detail: 'No rendered pages found in pdf_pages' })
        .eq('id', uploadId);
      return res.status(200).json({ uploadId, jobId, status: 'skipped', reason: 'no_pages' });
    }

    if (classifiedCount === 0) {
      console.log(JSON.stringify({
        event: 'classify-pages:handoff-skipped',
        reason: 'no pages successfully classified',
        uploadId, jobId, renderedCount, classifiedCount,
      }));
      await supabase.from('pdf_uploads')
        .update({ status: 'error', error_detail: 'No pages were successfully classified' })
        .eq('id', uploadId);
      return res.status(200).json({ uploadId, jobId, status: 'skipped', reason: 'no_classified_pages' });
    }

    // ── Hand off to auto-analyse via waitUntil ────────────────────────────
    const baseUrl = (
      process.env.PUBLIC_SITE_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      (req.headers.host?.includes('localhost') ? `http://${req.headers.host}` : 'https://www.hiper-studio.au')
    ).replace(/\/$/, '');

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
      status: 'awaiting_confirmation', error_detail: null,
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
  'roof_plan', 'detail', 'schedule', 'specification', 'unknown', 'unclassified',
]);

function validatePageType(raw) {
  if (typeof raw === 'string' && VALID_PAGE_TYPES.has(raw)) return raw;
  return 'unknown';
}
