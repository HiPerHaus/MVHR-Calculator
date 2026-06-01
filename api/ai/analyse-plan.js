// api/ai/analyse-plan.js
// POST /api/ai/analyse-plan
//
// Analyses a floor-plan image with Claude Vision and extracts a structured
// room list ready to populate the MVHR design form.
//
// Request body (multipart/form-data OR JSON):
//   projectId   uuid     required — the project this floor plan belongs to
//   floorIndex  integer  optional — 0 = ground floor (default)
//   imageData   string   optional — base64-encoded image (if sending inline)
//   imageUrl    string   optional — signed Supabase Storage URL (alternative to imageData)
//   mimeType    string   optional — 'image/png' | 'image/jpeg' | 'image/webp' (default 'image/png')
//   climateZone string   optional — override / pre-filled climate zone
//
// Exactly one of imageData or imageUrl must be provided.
//
// Response 200:
// {
//   rooms: {
//     supply: [{ name, roomType, area, floor }],
//     extract: [{ name, roomType, area, floor }]
//   },
//   climateZone: string | null,
//   warnings: string[],
//   model: string,
//   inputTokens: number,
//   outputTokens: number,
//   creditsDeducted: number,
//   newBalance: number,
//   logId: uuid
// }

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { rateLimit, applyRateLimit } from '../../lib/rate-limit.js';

// ── Clients ──────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Rate limiting — 10 AI calls per minute per instance ──────
const limiter = rateLimit({ windowMs: 60_000, max: 10 });

// ── Constants ────────────────────────────────────────────────
const MODEL = 'claude-opus-4-5';

// Valid room types that match the frontend's PHPP_SUPPLY_DEFAULTS / PHPP_EXTRACT_DEFAULTS
const SUPPLY_TYPES  = new Set(['Single Bedroom','Double Bedroom','Master Bedroom','Study / Office','Living Room','Dining Room','Rumpus Room','Other']);
const EXTRACT_TYPES = new Set(['Kitchen','Bathroom','Ensuite','Laundry','WC','Pantry','Other']);
const ALL_TYPES     = new Set([...SUPPLY_TYPES, ...EXTRACT_TYPES]);

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

// ── Helpers ──────────────────────────────────────────────────
function isUuid(v) {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function stripMarkdown(text) {
  // Strip ```json ... ``` fencing that Claude sometimes adds
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

// Validate and clean a single room object from AI output.
// Returns null if the room is unusable.
function validateRoom(raw, floorIndex) {
  if (!raw || typeof raw !== 'object') return null;
  const name     = typeof raw.name === 'string' ? raw.name.trim() : '';
  const roomType = typeof raw.roomType === 'string' ? raw.roomType.trim() : '';
  const area     = typeof raw.area === 'number' && raw.area > 0 ? Math.round(raw.area * 10) / 10 : null;

  // Coerce to nearest valid type if AI hallucinated a close variant
  let resolvedType = ALL_TYPES.has(roomType) ? roomType : null;
  if (!resolvedType) {
    // Try case-insensitive match
    const lower = roomType.toLowerCase();
    for (const t of ALL_TYPES) {
      if (t.toLowerCase() === lower) { resolvedType = t; break; }
    }
  }
  if (!resolvedType) resolvedType = 'Other';

  return {
    name:     name || resolvedType,
    roomType: resolvedType,
    area:     area ?? 0,
    floor:    floorIndex,
  };
}

// ── System prompt ─────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an MVHR (Mechanical Ventilation with Heat Recovery) design assistant.
Your task is to analyse an architectural floor plan image and extract a structured room list
to populate an MVHR ventilation design tool.

Rules:
1. Identify every habitable room and label it as either a SUPPLY or EXTRACT room.
   SUPPLY rooms receive fresh air: bedrooms, living areas, studies, dining rooms, rumpus rooms.
   EXTRACT rooms exhaust stale air: kitchens, bathrooms, ensuites, laundries, WCs, pantries.
2. Assign each room a roomType from EXACTLY this list (no other values allowed):
   Supply types:  "Single Bedroom", "Double Bedroom", "Master Bedroom", "Study / Office",
                  "Living Room", "Dining Room", "Rumpus Room", "Other"
   Extract types: "Kitchen", "Bathroom", "Ensuite", "Laundry", "WC", "Pantry", "Other"
3. Estimate the floor area in m² from any scale bar, grid, or dimensions visible.
   If no scale is visible, use a best-estimate based on context (typical room sizes).
   Set area to 0 if genuinely impossible to estimate.
4. If you can identify the climate zone (from a site plan, north point, or document title block),
   include it as a string matching AS/NZS 4859 zones: "1","2","3","4","5","6","7","8".
   Otherwise set climateZone to null.
5. Garages, store rooms, plant rooms, and unenclosed areas are NOT ventilated — exclude them.
6. Include a warnings array for anything unusual: missing scale, ambiguous room labels,
   open-plan areas that may need splitting, etc.

Respond with ONLY valid JSON — no prose, no markdown fences — in this exact shape:
{
  "supply": [
    { "name": "Master Bedroom", "roomType": "Master Bedroom", "area": 18.5 }
  ],
  "extract": [
    { "name": "Kitchen", "roomType": "Kitchen", "area": 14.2 }
  ],
  "climateZone": null,
  "warnings": ["No scale bar detected — areas estimated from typical room proportions."]
}`;

// ── Handler ───────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!applyRateLimit(req, res, { limiter })) return;

  // ── Auth ────────────────────────────────────────────────────
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  // ── Parse body ──────────────────────────────────────────────
  const {
    projectId,
    floorIndex   = 0,
    imageData,      // base64 string
    imageUrl,       // signed Storage URL
    mimeType     = 'image/png',
    climateZone: clientClimateZone,
  } = req.body ?? {};

  if (!isUuid(projectId)) {
    return res.status(400).json({ error: 'Valid projectId (UUID) required' });
  }
  if (!imageData && !imageUrl) {
    return res.status(400).json({ error: 'Provide imageData (base64) or imageUrl' });
  }
  if (imageData && imageUrl) {
    return res.status(400).json({ error: 'Provide imageData OR imageUrl, not both' });
  }

  const validMimeTypes = ['image/png','image/jpeg','image/jpg','image/webp','image/gif'];
  const safeMimeType = validMimeTypes.includes(mimeType) ? mimeType : 'image/png';

  // ── Verify project belongs to caller ───────────────────────
  const { data: project, error: projErr } = await supabase
    .from('projects')
    .select('id, user_id, storey_count')
    .eq('id', projectId)
    .single();

  if (projErr || !project) return res.status(404).json({ error: 'Project not found' });
  if (project.user_id !== user.id) return res.status(403).json({ error: 'Forbidden' });

  // ── Determine credit cost ───────────────────────────────────
  const operation = 'ai_plan_analysis';
  const { data: opCost } = await supabase
    .from('operation_costs')
    .select('credits, label')
    .eq('operation', operation)
    .single();

  const creditCost = opCost?.credits ?? 3;

  // ── Check balance BEFORE calling Claude (fail fast) ─────────
  const { data: profile } = await supabase
    .from('profiles')
    .select('credit_balance')
    .eq('id', user.id)
    .single();

  if ((profile?.credit_balance ?? 0) < creditCost) {
    return res.status(402).json({
      error:    'insufficient_credits',
      balance:  profile?.credit_balance ?? 0,
      required: creditCost,
    });
  }

  // ── Resolve image source ─────────────────────────────────────
  let imageSource;

  if (imageData) {
    // Inline base64 — validate size
    const byteLen = Math.ceil((imageData.replace(/=/g,'').length) * 3 / 4);
    if (byteLen > MAX_IMAGE_BYTES) {
      return res.status(413).json({ error: `Image too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB)` });
    }
    imageSource = { type: 'base64', media_type: safeMimeType, data: imageData };

  } else {
    // URL source — fetch and convert to base64 so we own the data
    let fetchRes;
    try {
      fetchRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
      if (!fetchRes.ok) throw new Error(`Image fetch failed: ${fetchRes.status}`);
    } catch (e) {
      return res.status(400).json({ error: `Could not fetch imageUrl: ${e.message}` });
    }

    const contentType  = fetchRes.headers.get('content-type') || safeMimeType;
    const resolvedMime = validMimeTypes.includes(contentType.split(';')[0].trim())
      ? contentType.split(';')[0].trim()
      : safeMimeType;

    const buf = await fetchRes.arrayBuffer();
    if (buf.byteLength > MAX_IMAGE_BYTES) {
      return res.status(413).json({ error: `Image too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB)` });
    }

    imageSource = {
      type:       'base64',
      media_type: resolvedMime,
      data:       Buffer.from(buf).toString('base64'),
    };
  }

  // ── Call Claude Vision ──────────────────────────────────────
  let claudeResponse;
  try {
    claudeResponse = await anthropic.messages.create({
      model:      MODEL,
      max_tokens: 2048,
      system:     SYSTEM_PROMPT,
      messages: [
        {
          role:    'user',
          content: [
            {
              type:   'image',
              source: imageSource,
            },
            {
              type: 'text',
              text: `Analyse this floor plan and return the structured JSON room list.${
                clientClimateZone
                  ? ` The user has indicated climate zone "${clientClimateZone}" — include it in your response.`
                  : ''
              }`,
            },
          ],
        },
      ],
    });
  } catch (e) {
    console.error('Anthropic API error:', e);

    // Log failure — no credits deducted
    await supabase.from('plan_analysis_log').insert({
      project_id:   projectId,
      user_id:      user.id,
      floor_index:  floorIndex,
      credits_deducted: 0,
      model_used:   MODEL,
      status:       'error',
      error_detail: e.message,
    });

    return res.status(502).json({ error: 'AI service error. No credits were deducted.' });
  }

  const rawText      = claudeResponse.content?.[0]?.text ?? '';
  const inputTokens  = claudeResponse.usage?.input_tokens  ?? 0;
  const outputTokens = claudeResponse.usage?.output_tokens ?? 0;

  // ── Parse and validate AI response ─────────────────────────
  let parsed;
  const warnings = [];

  try {
    parsed = JSON.parse(stripMarkdown(rawText));
  } catch (e) {
    // Log failure — no credits deducted
    await supabase.from('plan_analysis_log').insert({
      project_id:   projectId,
      user_id:      user.id,
      floor_index:  floorIndex,
      credits_deducted: 0,
      model_used:   MODEL,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      raw_response: rawText,
      status:       'error',
      error_detail: `JSON parse failed: ${e.message}`,
    });

    return res.status(422).json({
      error: 'AI returned an unparseable response. No credits were deducted. Please try again.',
    });
  }

  // Validate and clean each room
  const supplyRaw  = Array.isArray(parsed.supply)  ? parsed.supply  : [];
  const extractRaw = Array.isArray(parsed.extract) ? parsed.extract : [];

  const supply  = supplyRaw.map(r => validateRoom(r, floorIndex)).filter(Boolean);
  const extract = extractRaw.map(r => validateRoom(r, floorIndex)).filter(Boolean);

  // Collect AI warnings
  if (Array.isArray(parsed.warnings)) {
    for (const w of parsed.warnings) {
      if (typeof w === 'string' && w.trim()) warnings.push(w.trim());
    }
  }

  if (supply.length === 0 && extract.length === 0) {
    warnings.push('No rooms were identified in this image. Check that the image is a readable floor plan.');
  }

  const resolvedClimateZone = clientClimateZone
    || (typeof parsed.climateZone === 'string' ? parsed.climateZone.trim() : null)
    || null;

  const analysisJson = { supply, extract, climateZone: resolvedClimateZone, warnings };

  // ── Deduct credits AFTER successful parse ───────────────────
  const { data: newBalance, error: deductErr } = await supabase.rpc('deduct_credits', {
    p_user_id:     user.id,
    p_amount:      creditCost,
    p_operation:   operation,
    p_project_id:  projectId,
    p_description: opCost?.label ?? 'AI floor plan analysis',
  });

  if (deductErr) {
    if (deductErr.message?.includes('insufficient_credits')) {
      return res.status(402).json({
        error:    'insufficient_credits',
        balance:  profile?.credit_balance ?? 0,
        required: creditCost,
      });
    }
    console.error('deduct_credits error:', deductErr);
    // Don't fail the user — we have the result; log and return it (credits will be reconciled manually)
    warnings.push('Warning: credit deduction encountered an issue. Contact support if your balance is incorrect.');
  }

  // ── Persist analysis to projects.ai_analysis_json ───────────
  await supabase
    .from('projects')
    .update({
      ai_analysis_json: analysisJson,
      ...(resolvedClimateZone ? { climate_zone: resolvedClimateZone } : {}),
    })
    .eq('id', projectId);

  // ── Write audit log ─────────────────────────────────────────
  const { data: logRow } = await supabase
    .from('plan_analysis_log')
    .insert({
      project_id:        projectId,
      user_id:           user.id,
      floor_index:       floorIndex,
      credits_deducted:  deductErr ? 0 : creditCost,
      model_used:        MODEL,
      input_tokens:      inputTokens,
      output_tokens:     outputTokens,
      raw_response:      rawText,
      parsed_rooms:      analysisJson,
      climate_zone:      resolvedClimateZone,
      status:            'ok',
    })
    .select('id')
    .single();

  // ── Return structured result ────────────────────────────────
  return res.status(200).json({
    rooms:           { supply, extract },
    climateZone:     resolvedClimateZone,
    warnings,
    model:           MODEL,
    inputTokens,
    outputTokens,
    creditsDeducted: deductErr ? 0 : creditCost,
    newBalance:      newBalance ?? null,
    logId:           logRow?.id ?? null,
  });
}
