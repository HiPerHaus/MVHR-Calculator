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
const TOKENS_PER_PAGE = 400; // increased budget for new richer output (planType + sheetTitle + detectedFloor)

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
// Each page receives a planType from the following enum.
// Only floor_plan_primary pages will be sent for room extraction.
const CLASSIFICATION_SYSTEM = `You are an architectural drawing classifier for an MVHR ventilation design platform.
Your task is to classify each drawing page into EXACTLY ONE of these plan types.

PLAN TYPE DEFINITIONS
=====================

floor_plan_primary
  The COMPLETE floor plan for one distinct building level.
  Shows ALL rooms for that level. Used for MVHR room extraction.
  Examples: "Floor Plan", "Ground Floor Plan", "First Floor Plan", "Level 1 Plan", "Basement Plan"
  There is typically ONE primary floor plan per building level.

floor_plan_detail
  An ENLARGED or PARTIAL view showing only a SUBSET of rooms from a primary floor plan.
  The same rooms already appear on the primary floor plan at smaller scale.
  NEVER creates a separate floor — it is just a zoomed view of part of an existing level.
  Title indicators: "North Wing", "South Wing", "East Wing", "West Wing",
    "Enlarged Plan", "Detail Plan", "Partial Plan", any zone or wing reference.
  Even if it shows rooms from above with correct room names — if it only covers PART
  of the building, it is floor_plan_detail, NOT floor_plan_primary.

ceiling_plan
  Shows ceiling heights, bulkheads, skylights, downlight positions, or ceiling treatment.
  May look IDENTICAL to a floor plan (same room boundaries, same room names inside rooms)
  but the PURPOSE is to show ceiling information, NOT to define rooms for ventilation.
  Title indicators: "Ceiling Height Plan", "Reflected Ceiling Plan", "RCP",
    "Ceiling Plan", "Bulkhead Plan", "Ceiling Heights".
  Even though room names appear inside the boundaries, this is NOT a floor plan.
  CRITICAL: A page titled "Ceiling Height Plan" is ALWAYS ceiling_plan, never floor_plan_primary.

roof_plan
  Top-down view of the ROOF surface. Shows roof pitches, ridges, gutters, fascia.
  Does NOT show internal rooms.

electrical_plan
  Shows power points, circuits, switchboard, cable runs, smoke detectors.
  Same room boundaries as floor plan but annotated for electrical, not MVHR.

lighting_plan
  Shows light fittings, pendant positions, sensor zones.

plumbing_plan
  Shows pipe runs, fixtures, floor waste, hot/cold water, hydraulic.
  Also called: Hydraulic Plan, Services Plan, Wet Areas Plan.

slab_plan
  Shows concrete slab outline, thickenings, pad footings, setout dimensions.
  Also: Slab Layout, Structural Plan, Footing Plan, Framing Plan.

section
  Vertical cut through the building showing floor-to-ceiling heights, stair sections.
  Title: "Section AA", "Building Section", "Cross Section".

elevation
  External or internal wall face views. NOT a top-down plan.
  Title: "North Elevation", "East Elevation", "Internal Elevation", "Elevations".

schedule
  Tabular data. Door schedule, window schedule, finish schedule, fixture schedule.

detail
  Construction details, joinery details, wet area details, stair details.
  Small-scale drawings showing how specific junctions are built.

site_plan
  Shows the property boundary, building footprint, site contours, setbacks.
  The building appears as a simple outline, NOT a detailed floor plan.

specification
  Text specifications, notes sheets, energy reports, NatHERS.

other
  Anything not covered above (cover pages, indices, legends, photos).

DISTINGUISHING PRIMARY FROM DETAIL FLOOR PLANS
===============================================
Ask: Does this drawing cover the ENTIRE floor plate or only PART of it?
  ENTIRE floor plate → floor_plan_primary
  PART of the floor (wing, zone, enlarged area) → floor_plan_detail

North Wing Floor Plan → floor_plan_detail (covers only the north section)
South Wing Floor Plan → floor_plan_detail (covers only the south section)
Ground Floor Plan     → floor_plan_primary (covers the whole ground level)

DISTINGUISHING PRIMARY FROM CEILING PLANS
==========================================
Look at the TITLE BLOCK first.
If the title contains "Ceiling", "RCP", "Reflected" → ceiling_plan regardless of content.
If the page shows dotted lines, height annotations (2700, 3000mm), downlights → ceiling_plan.

OUTPUT FORMAT — STRICT
======================
Return ONLY a single valid JSON object.
NO markdown code fences. NO backticks. NO prose before or after.
First character MUST be { and last character MUST be }.

Required format:
{"pages":[{"pageNumber":1,"planType":"floor_plan_primary","sheetTitle":"A105 - Floor Plan","detectedFloor":"Ground Floor","confidence":0.95,"reason":"complete floor plan for ground level"}],"summary":"brief"}

Each page object MUST have: pageNumber, planType, sheetTitle, detectedFloor, confidence, reason.
planType MUST be one of: floor_plan_primary | floor_plan_detail | ceiling_plan | roof_plan |
  electrical_plan | lighting_plan | plumbing_plan | slab_plan | section | elevation |
  schedule | detail | site_plan | specification | other
sheetTitle: the drawing title from the title block (e.g. "A105 - Floor Plan"), or null if not visible.
detectedFloor: the building level this page represents if applicable (e.g. "Ground Floor", "First Floor"), or null.
Keep reason under 80 characters.`;

// Map a classifier result to a validated page_type string.
// Supports both the new planType field and the legacy isFloorPlan boolean.
function planTypeFromResult(r) {
  // Prefer the new granular planType field.
  if (typeof r?.planType === 'string') return validatePageType(r.planType);
  // Backward-compat: legacy isFloorPlan boolean from old prompt.
  if (r?.isFloorPlan === true)  return 'floor_plan';
  if (r?.isFloorPlan === false) return 'unknown';
  return 'unknown';
}

// ── JSON extraction helpers ───────────────────────────────────────────────
// Strip markdown fences and extract the first JSON object or array found.
// Multi-stage: direct → outermost braces → pages array → throws.
function extractJson(text) {
  // Remove all markdown fences (including mid-string)
  let s = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  // Stage 1: direct parse
  try { return JSON.parse(s); } catch (_) {}

  // Stage 2: outermost { ... }
  const firstBrace = s.indexOf('{');
  const lastBrace  = s.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try { return JSON.parse(s.slice(firstBrace, lastBrace + 1)); } catch (_) {}
  }

  // Stage 3: extract the "pages" array specifically
  const pagesMatch = s.match(/"pages"\s*:\s*(\[[\s\S]*?\])/);
  if (pagesMatch) {
    try { return { pages: JSON.parse(pagesMatch[1]) }; } catch (_) {}
  }

  // Stage 4: find any [...] array
  const firstBracket = s.indexOf('[');
  const lastBracket  = s.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try { return { pages: JSON.parse(s.slice(firstBracket, lastBracket + 1)) }; } catch (_) {}
  }

  throw new SyntaxError(`No valid JSON found in AI response: ${s.slice(0, 120)}`);
}

// ── Text-based fallback classifier ───────────────────────────────────────
// Used when JSON parsing fails entirely. Checks the raw model response text
// for keyword signals so the page is never left unclassified.
function textFallbackPlanType(rawText) {
  const t = (rawText ?? '').toLowerCase();

  // Order matters: most specific checks first.
  if (/ceiling\s*height|reflected\s*ceiling|\brcp\b|ceiling\s*plan|bulkhead\s*plan/.test(t)) return 'ceiling_plan';
  if (/roof\s*plan/.test(t)) return 'roof_plan';
  if (/electrical\s*plan|power\s*plan/.test(t)) return 'electrical_plan';
  if (/lighting\s*plan/.test(t)) return 'lighting_plan';
  if (/hydraulic|plumbing|services\s*plan/.test(t)) return 'plumbing_plan';
  if (/slab\s*(plan|layout)|structural|framing\s*plan|footing\s*plan/.test(t)) return 'slab_plan';
  if (/\bsection\b/.test(t) && !/floor\s*plan/.test(t)) return 'section';
  if (/\belevation/.test(t) && !/floor\s*plan/.test(t)) return 'elevation';
  if (/\bschedule\b/.test(t) && !/floor\s*plan/.test(t)) return 'schedule';
  if (/site\s*plan/.test(t)) return 'site_plan';
  // Wing/enlarged = detail, not primary
  if (/north\s*wing|south\s*wing|east\s*wing|west\s*wing|enlarged\s*plan|partial\s*plan|detail\s*plan/.test(t)) return 'floor_plan_detail';
  if (/floor\s*plan|ground\s*floor|first\s*floor|upper\s*floor|basement|mezzanine/.test(t)) return 'floor_plan_primary';
  if (/\b(bedroom|kitchen|bathroom|laundry|living|dining|ensuite)\b/.test(t)) return 'floor_plan_primary';

  return 'unknown';
}

function textFallbackClassification(rawText) {
  const planType = textFallbackPlanType(rawText);
  return {
    planType,
    confidence: 0.55,
    reason:     'Fallback classification due to malformed AI JSON',
  };
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
  const pageType = planTypeFromResult(r);

  // sheet_title: from new planType response or best-effort from reason text
  const sheetTitle = typeof r?.sheetTitle === 'string' && r.sheetTitle.length > 0
    ? r.sheetTitle.slice(0, 255)
    : null;

  // detectedFloor: only meaningful for floor plan types
  const detectedFloor = typeof r?.detectedFloor === 'string' && r.detectedFloor.length > 0
    ? r.detectedFloor.slice(0, 100)
    : null;

  return {
    id:                        page.id,
    pdf_upload_id:             page.pdf_upload_id,
    page_number:               page.page_number,
    page_type:                 pageType,
    sheet_title:               sheetTitle,
    // Store detected floor in floor_name so auto-analyse can read it without
    // needing a separate column (floor_name is already fetched and can be null).
    ...(detectedFloor ? { floor_name: detectedFloor } : {}),
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
    max_tokens: TOKENS_PER_PAGE,
    system:     CLASSIFICATION_SYSTEM,
    messages:   [{
      role:    'user',
      content: [
        { type: 'image', source: { type: 'url', url: signedUrl } },
        {
          type: 'text',
          text: 'Classify this single drawing page. Return JSON ONLY — first char { last char }.\n{"pages":[{"pageNumber":1,"planType":"floor_plan_primary","sheetTitle":"A105 - Floor Plan","detectedFloor":"Ground Floor","confidence":0.95,"reason":"complete floor plan"}],"summary":"brief"}',
        },
      ],
    }],
  });

  const raw = response.content?.[0]?.text ?? '';
  try {
    const parsed = extractJson(raw);
    return parsed?.pages?.[0] ?? parsed;
  } catch (jsonErr) {
    console.warn(`[classify-pages] JSON parse failed for single page ${page.page_number}, using text fallback: ${jsonErr.message}`);
    return textFallbackClassification(raw);
  }
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
    max_tokens: TOKENS_PER_PAGE * activeBatch.length + 100,
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
            'Return ONLY JSON — first char { last char }. No markdown. No prose.',
            '{"pages":[{"pageNumber":N,"planType":"floor_plan_primary","sheetTitle":"A105 - Floor Plan","detectedFloor":"Ground Floor","confidence":0.95,"reason":"brief"}],"summary":"brief"}',
          ].join('\n'),
        },
      ],
    }],
  });

  const raw = response.content?.[0]?.text ?? '';
  console.log(`[classify-pages] batch raw (${activeBatch.length} pages):`, raw.slice(0, 400));
  return extractJson(raw);
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!validateInternalToken(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { uploadId, jobId, userId, pageCount } = req.body ?? {};
  let { projectId } = req.body ?? {};

  if (!uploadId || !jobId || !userId) {
    return res.status(400).json({ error: 'uploadId, jobId, userId required' });
  }

  // ── Recover projectId from pdf_uploads if not in request body ────────────
  // upload-pdf saves project_id to the uploads row; the internal-call chain may
  // not always carry it forward in the body, so we treat the DB as the source of
  // truth and recover it here so every downstream call (auto-analyse → analyse-plan)
  // can write project_id to plan_analysis_log.
  if (!projectId) {
    const { data: uploadRow } = await supabase
      .from('pdf_uploads')
      .select('project_id')
      .eq('id', uploadId)
      .single();

    if (uploadRow?.project_id) {
      projectId = uploadRow.project_id;
      console.log(JSON.stringify({
        event:     'classify-pages:projectId-recovered',
        uploadId,
        projectId,
      }));
    } else {
      console.warn(JSON.stringify({
        event:     'classify-pages:projectId-missing',
        uploadId,
        note:      'pdf_uploads.project_id is also null — plan_analysis_log rows will be unlinked',
      }));
    }
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

        // IMPORTANT: never trust AI-returned pageNumber — the model numbers pages
        // relative to the batch (1,2,3,4) not relative to the PDF (e.g. 9,10,11,12).
        // Always map by array position: resultPages[idx] → validBatch[idx].
        for (let idx = 0; idx < validBatch.length; idx++) {
          const p = validBatch[idx];
          const r = resultPages[idx];

          if (r) {
            updates.push(buildUpdate(p, r, null));
            console.log(`[classify-pages] batch pos ${idx} → page ${p.page_number}: isFloorPlan=${r.isFloorPlan} confidence=${r.confidence}`);
          } else {
            // Batch returned fewer results than pages sent — classify individually.
            console.warn(`[classify-pages] page ${p.page_number} missing from batch result at position ${idx} — classifying individually`);
            try {
              const r2 = await classifyOnePage(p, urlMap[p.page_number]);
              updates.push(buildUpdate(p, r2, 'Individual fallback'));
              console.log(`[classify-pages] individual fallback page ${p.page_number}: isFloorPlan=${r2?.isFloorPlan}`);
            } catch (indErr) {
              console.error(`[classify-pages] individual fallback failed for page ${p.page_number}:`, indErr.message);
              // Text fallback: never leave unclassified due to JSON error
              const fb = textFallbackClassification('');
              updates.push(buildUpdate(p, fb, `Text fallback after individual failure: ${indErr.message}`));
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
          console.log(`[classify-pages] individual page ${p.page_number}: isFloorPlan=${r?.isFloorPlan}`);
        } catch (indErr) {
          // classifyOnePage already tried text fallback internally — this means
          // even the API call failed (network/timeout). Use default fallback.
          console.error(`[classify-pages] individual failed for page ${p.page_number}:`, indErr.message);
          const fb = textFallbackClassification('');
          updates.push(buildUpdate(p, fb, `Text fallback after all attempts failed: ${indErr.message}`));
        }
      }

      // Pages with no signed URL: can't classify by image — use text fallback (defaults to floor_plan)
      for (const p of validBatch.filter(p => !urlMap[p.page_number])) {
        const fb = textFallbackClassification('');
        updates.push(buildUpdate(p, fb, 'No image URL available — text fallback'));
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

    // classifiedCount is set below from the DB integrity check result (actual DB state).
    // This placeholder is overwritten after the integrity query completes.
    let classifiedCount = updates.filter(u => u.page_type !== 'unclassified').length;

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

    // ── Integrity check: verify every page has been written ──────────────
    // Query the actual DB state after upsert — catches any silent upsert failures.
    const { data: unclassifiedRows } = await supabase
      .from('pdf_pages')
      .select('id, page_number')
      .eq('pdf_upload_id', uploadId)
      .eq('page_type', 'unclassified');

    const unclassifiedCount = unclassifiedRows?.length ?? 0;
    const expectedClassified = renderedCount;
    const actualClassified   = renderedCount - unclassifiedCount;

    console.log(JSON.stringify({
      event:               'classify-pages:integrity-check',
      uploadId,
      jobId,
      renderedCount,
      unclassifiedCount,
      actualClassified,
      expectedClassified,
      pass:                unclassifiedCount === 0,
      unclassifiedPages:   (unclassifiedRows ?? []).map(r => r.page_number),
    }));

    if (unclassifiedCount > 0) {
      console.warn(`[classify-pages] Classification integrity check: ${unclassifiedCount} page(s) remain unclassified. Expected ${expectedClassified} classified, found ${actualClassified}.`);
      // Non-fatal: log and continue — auto-analyse will skip non-floor-plan pages anyway.
      // Fatal failure (all unclassified) is caught by classifiedCount === 0 gate below.
    }

    // Use the DB-verified count from this point forward.
    classifiedCount = actualClassified;

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
  // New granular taxonomy (June 2026+)
  'floor_plan_primary',   // complete floor plan for one building level — room extraction eligible
  'floor_plan_detail',    // enlarged/partial view — NOT a separate floor, excluded from extraction
  'ceiling_plan',         // ceiling heights, RCP, bulkheads — excluded from extraction
  'roof_plan',
  'electrical_plan',
  'lighting_plan',
  'plumbing_plan',
  'slab_plan',
  'section',
  'elevation',
  'schedule',
  'detail',
  'site_plan',
  'specification',
  'other',
  // Legacy taxonomy (pre-June 2026) — kept for backward compat
  'floor_plan',           // legacy: treated as floor_plan_primary in isHabitableAnalysisPage
  'unknown',
  'unclassified',
]);

function validatePageType(raw) {
  if (typeof raw === 'string' && VALID_PAGE_TYPES.has(raw)) return raw;
  // Attempt to normalise common AI hallucinations
  if (typeof raw === 'string') {
    const lower = raw.toLowerCase().replace(/[\s-]+/g, '_');
    if (VALID_PAGE_TYPES.has(lower)) return lower;
    if (lower.includes('floor_plan') || lower.includes('floor plan')) return 'floor_plan_primary';
    if (lower.includes('ceiling'))   return 'ceiling_plan';
    if (lower.includes('elevation')) return 'elevation';
    if (lower.includes('section'))   return 'section';
    if (lower.includes('roof'))      return 'roof_plan';
    if (lower.includes('site'))      return 'site_plan';
  }
  return 'unknown';
}
