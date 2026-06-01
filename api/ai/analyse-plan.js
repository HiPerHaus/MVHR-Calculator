// api/ai/analyse-plan.js
// POST /api/ai/analyse-plan
//
// Analyses a floor-plan image with Claude Vision and extracts a structured
// room list ready to populate the MVHR design form.
//
// Request body (multipart/form-data OR JSON):
//   projectId   uuid     required unless testMode=true
//   testMode    boolean  optional — when true, requires admin auth; projectId becomes optional;
//                         credits still deducted; plan_analysis_log still written;
//                         projects.ai_analysis_json NOT updated if projectId is absent
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
//     supply:   [{ name, roomType, area, floor, ventilationClassification, recommendedAirflow, recommendedOutlets, confidence, openPlan }],
//     extract:  [...],
//     transfer: [...],
//     ignore:   [...]
//   },
//   totalInternalFloorArea: number | null,
//   floorAreaConfidence:    number | null,
//   climateZone:     string | null,
//   warnings:        string[],
//   model:           string,
//   inputTokens:     number,
//   outputTokens:    number,
//   creditsDeducted: number,
//   newBalance:      number,
//   logId:           uuid | null,
//   logError:        string | null
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

// Valid room types (must match frontend PHPP_SUPPLY_DEFAULTS / PHPP_EXTRACT_DEFAULTS)
const SUPPLY_TYPES   = new Set(['Single Bedroom','Double Bedroom','Master Bedroom','Study / Office','Living Room','Dining Room','Rumpus Room','Other']);
const EXTRACT_TYPES  = new Set(['Kitchen','Bathroom','Ensuite','Laundry','WC','Pantry','Other']);
const TRANSFER_TYPES = new Set(['Hallway','Entry','Corridor','Other']);
const IGNORE_TYPES   = new Set(['WIR','Garage','Porch','Carport','Alfresco','Store','Other']);
const ALL_TYPES      = new Set([...SUPPLY_TYPES, ...EXTRACT_TYPES, ...TRANSFER_TYPES, ...IGNORE_TYPES]);

const VENT_CLASSIFICATIONS = new Set(['supply','extract','transfer','ignore']);

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

// ── Helpers ──────────────────────────────────────────────────
function isUuid(v) {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function stripMarkdown(text) {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

// Default recommended airflow (L/s) by room type and area.
function defaultAirflow(roomType, area, ventClass) {
  if (ventClass === 'transfer' || ventClass === 'ignore') return 0;
  const a = area || 0;
  switch (roomType) {
    case 'Master Bedroom':  return Math.max(15, Math.round(a * 1.0));
    case 'Double Bedroom':  return Math.max(12, Math.round(a * 0.9));
    case 'Single Bedroom':  return Math.max(10, Math.round(a * 0.8));
    case 'Living Room':     return Math.max(20, Math.round(a * 1.2));
    case 'Dining Room':     return Math.max(15, Math.round(a * 1.0));
    case 'Study / Office':  return Math.max(10, Math.round(a * 0.8));
    case 'Rumpus Room':     return Math.max(15, Math.round(a * 1.0));
    case 'Kitchen':         return 25;
    case 'Bathroom':        return 25;
    case 'Ensuite':         return 20;
    case 'Laundry':         return 20;
    case 'WC':              return 10;
    case 'Pantry':          return 10;
    default: return ventClass === 'supply' ? Math.max(10, Math.round(a * 0.8)) : 10;
  }
}

// Default recommended outlets by area, classification and open-plan status.
function defaultOutlets(area, ventClass, openPlan, roomType) {
  if (ventClass === 'transfer' || ventClass === 'ignore') return 0;
  if (ventClass === 'extract') return (roomType === 'Kitchen' && area > 30) ? 2 : 1;
  // supply
  if (openPlan && area >= 60) return 3;
  if ((openPlan && area >= 40) || area >= 25) return 2;
  return 1;
}

// Validate and clean a single room object from AI output.
// Returns null if the room is unusable.
function validateRoom(raw, floorIndex) {
  if (!raw || typeof raw !== 'object') return null;

  const name     = typeof raw.name === 'string'     ? raw.name.trim()     : '';
  const roomType = typeof raw.roomType === 'string' ? raw.roomType.trim() : '';
  const area     = typeof raw.area === 'number' && raw.area > 0
    ? Math.round(raw.area * 10) / 10 : null;
  const confidence = typeof raw.confidence === 'number'
    ? Math.min(1, Math.max(0, raw.confidence)) : null;
  const openPlan = raw.openPlan === true;

  // Coerce roomType to nearest valid value
  let resolvedType = ALL_TYPES.has(roomType) ? roomType : null;
  if (!resolvedType) {
    const lower = roomType.toLowerCase();
    for (const t of ALL_TYPES) {
      if (t.toLowerCase() === lower) { resolvedType = t; break; }
    }
  }
  if (!resolvedType) resolvedType = 'Other';

  // Resolve ventilationClassification — honour AI value, fall back to type inference
  let ventClass = typeof raw.ventilationClassification === 'string'
    ? raw.ventilationClassification.toLowerCase().trim() : null;
  if (!VENT_CLASSIFICATIONS.has(ventClass)) {
    if (SUPPLY_TYPES.has(resolvedType))        ventClass = 'supply';
    else if (EXTRACT_TYPES.has(resolvedType))  ventClass = 'extract';
    else if (TRANSFER_TYPES.has(resolvedType)) ventClass = 'transfer';
    else if (IGNORE_TYPES.has(resolvedType))   ventClass = 'ignore';
    else ventClass = 'supply';
  }

  // Airflow — use AI value if present and sensible, otherwise derive default
  const aiAirflow = typeof raw.recommendedAirflow === 'number' && raw.recommendedAirflow >= 0
    ? Math.round(raw.recommendedAirflow) : null;
  const recommendedAirflow = aiAirflow ?? defaultAirflow(resolvedType, area ?? 0, ventClass);

  // Outlets — use AI value if present, otherwise derive default
  const aiOutlets = typeof raw.recommendedOutlets === 'number' && raw.recommendedOutlets >= 0
    ? Math.round(raw.recommendedOutlets) : null;
  const recommendedOutlets = aiOutlets ?? defaultOutlets(area ?? 0, ventClass, openPlan, resolvedType);

  return {
    name:                     name || resolvedType,
    roomType:                 resolvedType,
    area:                     area ?? 0,
    floor:                    floorIndex,
    ventilationClassification: ventClass,
    recommendedAirflow,
    recommendedOutlets,
    confidence,
    openPlan,
  };
}

// Suggestions returned to the client when both AI passes fail.
const FAILURE_SUGGESTIONS = [
  'Upload a higher resolution image',
  'Crop the image to the floor plan only',
  'Ensure room names are visible',
  'Avoid elevations, sections and site plans',
  'Export PDF files at higher quality',
  'Upload a single floor at a time',
  'Ensure room labels are not hidden by dimensions or notes',
];

// ── Post-processing: architectural cleanup ────────────────────
// Applied after BOTH Stage 1 and Stage 2 extractions.
// Removes joinery/cupboard false-positives, absorbs service spaces,
// reclassifies stores and ambiguous rooms, and emits descriptive warnings.

// Keywords that indicate built-in joinery / equipment — NOT separate MVHR rooms.
// Match against the room name (case-insensitive, word-boundary aware where possible).
const JOINERY_PATTERNS = [
  /\bcpd\b/i,         // coat pantry door / cupboard
  /\bbir\b/i,         // built-in robe
  /\brobe\b/i,
  /\bwardrobe\b/i,
  /\blinen\b/i,
  /\bbroom\b/i,
  /\bshelv/i,         // shelving, shelves
  /\bfridge\b/i,
  /\bcupboard\b/i,
  /\bcabinet/i,       // cabinet, cabinetry
  /\bjoinery\b/i,
  /\bpantry cupboard\b/i,
];

const SERVICE_PATTERNS = [
  /\bhws\b/i,         // hot water system
  /\bhot water\b/i,
  /\bhrv\b/i,         // heat recovery ventilation unit
  /\bplant\b/i,
  /\bboiler\b/i,
  /\bmeter\b/i,
  /\bequipment\b/i,
];

// Name patterns where large context can override — e.g. "store" by itself
const STORE_PATTERN = /\bstore\b/i;

function postProcessRooms(rooms, warnings) {
  const out = [];

  for (const room of rooms) {
    const name = (room.name || '').trim();
    const area = room.area || 0;
    const nameLower = name.toLowerCase();

    // ── Service / plant spaces ────────────────────────────────
    if (SERVICE_PATTERNS.some(p => p.test(name))) {
      warnings.push(`"${name}" identified as a service/equipment space — excluded as a separate MVHR zone.`);
      continue;
    }

    // ── Joinery / built-in storage ────────────────────────────
    if (JOINERY_PATTERNS.some(p => p.test(name))) {
      if (area >= 4) {
        // Large enough to be a genuine WIR — keep as ignore
        room.ventilationClassification = 'ignore';
        room.roomType = 'WIR';
        warnings.push(`"${name}" (${area} m²) treated as walk-in robe — classified as ignore.`);
        out.push(room);
      } else {
        warnings.push(`"${name}" treated as built-in storage — excluded as a separate MVHR zone.`);
      }
      continue;
    }

    // ── Store rooms ───────────────────────────────────────────
    if (STORE_PATTERN.test(name) || room.roomType === 'Store') {
      if (area < 3) {
        warnings.push(`"${name}" (${area} m²) is too small for an MVHR terminal — excluded.`);
        continue;
      }
      if (area <= 4) {
        // Small store — demote to ignore
        if (room.ventilationClassification !== 'ignore') {
          room.ventilationClassification = 'ignore';
          room.roomType = 'Store';
          warnings.push(`"${name}" (${area} m²) classified as ignore — small store, no MVHR terminal required.`);
        }
      } else if (room.ventilationClassification === 'supply') {
        // Larger store should never be supply — reclassify
        room.ventilationClassification = 'transfer';
        room.roomType = 'Store';
        warnings.push(`"${name}" (${area} m²) reclassified from supply to transfer — storage areas are not MVHR supply zones.`);
      }
      out.push(room);
      continue;
    }

    // ── Person-name rooms → habitable supply ─────────────────
    // Rooms labelled with a person's given name are almost always bedrooms/studies.
    // Simple heuristic: single capitalised word that is not a known room keyword.
    const KNOWN_ROOM_WORDS = new Set([
      'bedroom','living','dining','kitchen','bathroom','ensuite','laundry',
      'hallway','entry','corridor','study','office','rumpus','pantry','wc','wir',
      'garage','porch','carport','alfresco','store','other','lounge','family',
      'theatre','media','activity','games','gym','cellar','bar','studio',
    ]);
    const isPersonName = /^[A-Z][a-z]{2,}$/.test(name) && !KNOWN_ROOM_WORDS.has(nameLower);
    if (isPersonName && room.ventilationClassification !== 'supply') {
      room.ventilationClassification = 'supply';
      if (!SUPPLY_TYPES.has(room.roomType)) {
        room.roomType = 'Other';
      }
      warnings.push(`"${name}" interpreted as a habitable room (personal label) — classified as supply.`);
    }

    // ── JAN room ─────────────────────────────────────────────
    if (/\bjan\b/i.test(name)) {
      if (area >= 4 && room.ventilationClassification !== 'supply') {
        room.ventilationClassification = 'supply';
        room.roomType = 'Study / Office';
        warnings.push(`"${name}" classified as supply — appears to be a usable enclosed room, not a janitor closet.`);
      } else if (area < 4) {
        warnings.push(`"${name}" (${area} m²) treated as a small utility space — classified as ignore.`);
        room.ventilationClassification = 'ignore';
        room.roomType = 'Store';
      }
    }

    out.push(room);
  }

  return out;
}

// ── System prompt ─────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an MVHR (Mechanical Ventilation with Heat Recovery) design assistant \
for Australian residential buildings. Analyse the provided architectural floor plan and return \
structured MVHR design data as JSON.

════ TASK 1 — IDENTIFY ARCHITECTURAL ROOMS (mandatory) ════
Your primary task is to list every enclosed architectural room or usable space visible in this floor plan.

• Include every room, even if labels are unclear or absent.
• If a room has no visible label, assign a generic name: "Bedroom 1", "Bedroom 2", "Living",
  "Dining", "Kitchen", "Bathroom", "Ensuite", "Laundry", "WC", "Study", "Hall", "Garage", etc.
• If the plan shows ANY enclosed spaces, the rooms array must be non-empty.
• Uncertain rooms: include them with confidence 0.4–0.6 rather than omitting them.
• SELF-CHECK before finalising: if totalInternalFloorArea > 0 and rooms is empty, re-read the
  image and add rooms. A 150 m² home → at least 8 rooms; a 250 m² home → at least 12 rooms.

════ WALLS vs JOINERY — CRITICAL DISTINCTION ════
Only return architectural rooms or usable enclosed spaces.
Use wall thickness and enclosure lines to distinguish rooms from built-in joinery:

  ROOMS (return these):
  • Thick double-line walls forming a fully enclosed space with a door opening
  • Spaces with floor area, carpet hatching, or furniture symbols
  • Any space a person can stand, sleep, work, cook, or bathe in

  NOT ROOMS (do NOT return these as separate items):
  • Thin internal lines showing robe outlines, shelving, bench tops, joinery
  • CPD (coat/pantry door / cupboard), BIR (built-in robe), WIR only if tiny alcove
  • Kitchen cabinetry, bathroom vanity, bathroom cupboard recesses
  • Fridge recess, oven recess, dishwasher space
  • Linen cupboard, broom cupboard, small store cupboard < 3 m²
  • HWS (hot water system) alcove, HRV equipment cupboard, plant/boiler space
  • Any robe, shelf, or joinery zone drawn with thin lines inside another room

  ABSORPTION RULE — absorb these into their parent room:
  • HWS / hot water alcove inside laundry → part of Laundry
  • CPD beside bathroom or ensuite → part of Bathroom / Ensuite
  • BIR / robe zone off a bedroom → part of that bedroom or classify as WIR (ignore)
  • Small kitchen store cupboard → part of Kitchen
  • HRV / plant cupboard near laundry → not ventilated, ignore

════ STORAGE AND SERVICE SPACES ════
  Small store < 3 m²:      ignore — too small for an MVHR terminal
  Store 3–4 m²:            classify as "ignore" or "transfer" (never supply)
  Store > 4 m², enclosed:  classify as "extract" (if service / utility zone) or "transfer"
  WIR off bedroom:         classify as "ignore" unless large (> 6 m²), then "transfer"
  Service / plant space:   classify as "ignore" — HWS, HRV, boiler, meter board, etc.

════ AMBIGUOUS ROOM NAMES ════
  "JAN":   If it is a fully enclosed usable room with carpet, door and dimensions ≥ 4 m²,
           treat as habitable — classify as "supply" (e.g. study, utility, hobby room).
           Only treat as janitor/cleaner if clear institutional/commercial context.
  "PAUL":  Treat as a person's name used for a bedroom or study — classify as "supply".
  Rooms labelled with a person's name are almost always bedrooms or private habitable spaces.
  Any labelled room with furniture, carpet, or a bed symbol → supply.

════ ROOM CLASSIFICATION ════
Assign every room a ventilationClassification:
  "supply"   — fresh air delivered: bedrooms, living, dining, study, rumpus, habitable rooms
  "extract"  — stale air removed: kitchen, bathroom, ensuite, laundry, WC, pantry, utility
  "transfer" — passive air path, no terminal needed: hallway, entry, corridor
  "ignore"   — not ventilated: WIR, garage, porch, carport, alfresco, store, plant room

════ ROOM TYPES (use EXACTLY these strings) ════
  Supply:   "Single Bedroom", "Double Bedroom", "Master Bedroom", "Study / Office",
            "Living Room", "Dining Room", "Rumpus Room", "Other"
  Extract:  "Kitchen", "Bathroom", "Ensuite", "Laundry", "WC", "Pantry", "Other"
  Transfer: "Hallway", "Entry", "Corridor", "Other"
  Ignore:   "WIR", "Garage", "Porch", "Carport", "Alfresco", "Store", "Other"

════ RECOMMENDED AIRFLOW (L/s) ════
Round to nearest whole litre.
  Supply — type + area:
    Master Bedroom:  max(15, round(area × 1.0))
    Double Bedroom:  max(12, round(area × 0.9))
    Single Bedroom:  max(10, round(area × 0.8))
    Living Room:     max(20, round(area × 1.2))
    Dining Room:     max(15, round(area × 1.0))
    Study / Office:  max(10, round(area × 0.8))
    Rumpus Room:     max(15, round(area × 1.0))
  Extract: Kitchen 25  Bathroom 25  Ensuite 20  Laundry 20  WC 10  Pantry 10
  Transfer / Ignore: 0

════ RECOMMENDED OUTLETS ════
  Supply < 25 m²: 1 outlet    Supply 25–49 m²: 2 outlets
  Open plan ≥ 40 m²: 2 minimum    Open plan ≥ 60 m²: 3 outlets
  Extract: 1 outlet (kitchen > 30 m² → 2)    Transfer / Ignore: 0

════ OPEN PLAN DETECTION ════
Set openPlan: true for any room > 40 m² that combines multiple functions (e.g. "Meals / Living").

════ TASK 2 — FLOOR AREA ESTIMATE ════
After listing rooms, estimate totalInternalFloorArea (m²).
Include: habitable rooms, hallways, bathrooms, laundries, WIRs, internal circulation.
Exclude: porch, verandah, alfresco, carport, garage, balconies, unenclosed areas.
Rate confidence 0.0–1.0 in floorAreaConfidence.

════ ROOM AREAS ════
Estimate from scale bars, dimension strings, or grid. If no scale is visible, use typical
Australian residential sizes. Set area to 0 only if genuinely impossible to estimate.

════ CLIMATE ZONE ════
If visible in title block or annotations, return AS/NZS climate zone "1"–"8". Otherwise null.

════ RESPONSE FORMAT ════
Return ONLY valid JSON — no markdown fences, no prose before or after.

{
  "rooms": [
    { "name": "Master Bedroom", "roomType": "Master Bedroom", "area": 19.2,
      "ventilationClassification": "supply", "recommendedAirflow": 20,
      "recommendedOutlets": 1, "confidence": 0.94, "openPlan": false },
    { "name": "Kitchen", "roomType": "Kitchen", "area": 16.4,
      "ventilationClassification": "extract", "recommendedAirflow": 25,
      "recommendedOutlets": 1, "confidence": 0.97, "openPlan": false },
    { "name": "Hallway", "roomType": "Hallway", "area": 8.2,
      "ventilationClassification": "transfer", "recommendedAirflow": 0,
      "recommendedOutlets": 0, "confidence": 0.9, "openPlan": false }
  ],
  "totalInternalFloorArea": 245.6,
  "floorAreaConfidence": 0.87,
  "climateZone": null,
  "warnings": []
}`;

// ── Stage 2 recovery prompt — room identification only ─────────
// Used when Stage 1 returns a valid floor area but empty room arrays.
// Deliberately ignores airflow, classifications, and floor area to
// reduce cognitive load on the model and maximise room recall.
const ROOM_RECOVERY_PROMPT = `You are analysing an architectural floor plan image.
Your ONLY task is to identify every enclosed architectural room or usable space visible.

Rules:
• Only return architectural rooms — spaces enclosed by thick walls with a door opening.
• Do NOT return cupboards, robes, joinery, shelving, or built-in storage as separate rooms.
  These include: BIR, CPD, robe outlines, kitchen joinery, bathroom cupboards, linen cupboards,
  HWS alcoves, HRV cupboards, fridge recesses, small store cupboards.
• If a label is readable, use it. If not, assign a generic name: "Bedroom", "Living", "Kitchen", etc.
• Estimate the area of each room in m². If uncertain, use a reasonable guess.
• Do NOT compute airflow, outlets, or MVHR classifications — handled elsewhere.
• Set confidence 0.5 for any room where you are uncertain.
• Include usable spaces: bedrooms, bathrooms, hallways, laundry, garage, WIR (if walk-in sized).
• Rooms labelled with a person's name (e.g. "Paul") are bedrooms or habitable rooms — include them.

Return ONLY valid JSON — no markdown, no prose.

{
  "rooms": [
    { "name": "Master Bedroom", "roomType": "Master Bedroom", "area": 18.0, "confidence": 0.8 },
    { "name": "Kitchen",        "roomType": "Kitchen",         "area": 14.0, "confidence": 0.9 },
    { "name": "Hallway",        "roomType": "Hallway",         "area": 7.0,  "confidence": 0.7 }
  ]
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
    testMode     = false,
    floorIndex   = 0,
    imageData,      // base64 string
    imageUrl,       // signed Storage URL
    mimeType     = 'image/png',
    climateZone: clientClimateZone,
  } = req.body ?? {};

  // In testMode, require admin auth; otherwise projectId is mandatory
  if (testMode) {
    const { data: adminProfile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();
    if (!adminProfile?.is_admin) {
      return res.status(403).json({ error: 'Admin access required for testMode' });
    }
  } else {
    if (!isUuid(projectId)) {
      return res.status(400).json({ error: 'Valid projectId (UUID) required' });
    }
  }

  if (!imageData && !imageUrl) {
    return res.status(400).json({ error: 'Provide imageData (base64) or imageUrl' });
  }
  if (imageData && imageUrl) {
    return res.status(400).json({ error: 'Provide imageData OR imageUrl, not both' });
  }

  const validMimeTypes = ['image/png','image/jpeg','image/jpg','image/webp','image/gif'];
  const safeMimeType = validMimeTypes.includes(mimeType) ? mimeType : 'image/png';

  // ── Verify project belongs to caller (skipped in testMode with no projectId) ──
  if (isUuid(projectId)) {
    const { data: project, error: projErr } = await supabase
      .from('projects')
      .select('id, user_id, storey_count')
      .eq('id', projectId)
      .single();

    if (projErr || !project) return res.status(404).json({ error: 'Project not found' });
    // In testMode admins may inspect any project; outside testMode enforce ownership
    if (!testMode && project.user_id !== user.id) return res.status(403).json({ error: 'Forbidden' });
  }

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

  // Rough decoded byte size — used later to warn about low-resolution images
  const imgByteEstimate = Math.ceil(imageSource.data.length * 3 / 4);

  // ── Call Claude Vision ──────────────────────────────────────
  let claudeResponse;
  try {
    claudeResponse = await anthropic.messages.create({
      model:      MODEL,
      max_tokens: 4096,
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
      ...(isUuid(projectId) ? { project_id: projectId } : {}),
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

  // Small image → room labels may be unreadable
  if (imgByteEstimate < 150_000) {
    warnings.push('Room labels may be too small to read. Try a cropped screenshot of the floor plan.');
  }

  try {
    parsed = JSON.parse(stripMarkdown(rawText));
  } catch (e) {
    // Log failure — no credits deducted
    await supabase.from('plan_analysis_log').insert({
      ...(isUuid(projectId) ? { project_id: projectId } : {}),
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

  // ── Resolve rooms — support parsed.rooms.supply/extract (current Claude output),
  //   parsed.supply/extract (original format), and any room with an explicit
  //   ventilationClassification for transfer/ignore rooms.
  const supplyRaw =
    Array.isArray(parsed?.rooms?.supply)
      ? parsed.rooms.supply
      : Array.isArray(parsed?.supply)
        ? parsed.supply
        : [];

  const extractRaw =
    Array.isArray(parsed?.rooms?.extract)
      ? parsed.rooms.extract
      : Array.isArray(parsed?.extract)
        ? parsed.extract
        : [];

  // Merge and tag with default classifications; validateRoom will infer from roomType
  // if ventilationClassification is absent (handles legacy and Claude-generated fields).
  const allRoomsRaw = [
    ...supplyRaw.map( r => ({ ...r, ventilationClassification: r.ventilationClassification || 'supply'  })),
    ...extractRaw.map(r => ({ ...r, ventilationClassification: r.ventilationClassification || 'extract' })),
  ];

  const allRooms = allRoomsRaw.map(r => validateRoom(r, floorIndex)).filter(Boolean);
  const supply   = allRooms.filter(r => r.ventilationClassification === 'supply');
  const extract  = allRooms.filter(r => r.ventilationClassification === 'extract');
  const transfer = allRooms.filter(r => r.ventilationClassification === 'transfer');
  const ignore   = allRooms.filter(r => r.ventilationClassification === 'ignore');

  // ── Floor area ───────────────────────────────────────────────
  const totalInternalFloorArea = typeof parsed?.totalInternalFloorArea === 'number'
    && parsed.totalInternalFloorArea > 0
    ? Math.round(parsed.totalInternalFloorArea * 10) / 10
    : null;
  const floorAreaConfidence = typeof parsed?.floorAreaConfidence === 'number'
    ? Math.min(1, Math.max(0, parsed.floorAreaConfidence))
    : null;

  // ── Collect AI warnings ──────────────────────────────────────
  if (Array.isArray(parsed.warnings)) {
    for (const w of parsed.warnings) {
      if (typeof w === 'string' && w.trim()) warnings.push(w.trim());
    }
  }

  // Token counts accumulate across both calls
  let totalInputTokens  = inputTokens;
  let totalOutputTokens = outputTokens;

  // ── Stage 1 post-processing ───────────────────────────────────
  // Apply architectural cleanup before deciding whether rooms were found.
  const stage1Cleaned = postProcessRooms([...supply, ...extract, ...transfer, ...ignore], warnings);

  let finalSupply   = stage1Cleaned.filter(r => r.ventilationClassification === 'supply');
  let finalExtract  = stage1Cleaned.filter(r => r.ventilationClassification === 'extract');
  let finalTransfer = stage1Cleaned.filter(r => r.ventilationClassification === 'transfer');
  let finalIgnore   = stage1Cleaned.filter(r => r.ventilationClassification === 'ignore');
  let recoveryMode  = false;
  // 'success' | 'failed'
  let analysisStatus = stage1Cleaned.length > 0 ? 'success' : null; // resolved below

  const resolvedClimateZone = clientClimateZone
    || (typeof parsed.climateZone === 'string' ? parsed.climateZone.trim() : null)
    || null;

  // ── Stage 2: recovery pass when Stage 1 finds area but no rooms ─
  if (analysisStatus === null && totalInternalFloorArea > 0) {
    console.log('analyse-plan: Stage 1 returned empty rooms with area', totalInternalFloorArea, '— attempting Stage 2 recovery');

    let stage2Rooms = [];
    try {
      const stage2Response = await anthropic.messages.create({
        model:      MODEL,
        max_tokens: 2048,
        system:     ROOM_RECOVERY_PROMPT,
        messages: [
          {
            role:    'user',
            content: [
              { type: 'image', source: imageSource },
              { type: 'text',  text: 'Identify every room visible in this floor plan and return the JSON room list.' },
            ],
          },
        ],
      });

      totalInputTokens  += stage2Response.usage?.input_tokens  ?? 0;
      totalOutputTokens += stage2Response.usage?.output_tokens ?? 0;

      const stage2Text = stage2Response.content?.[0]?.text ?? '';
      let stage2Parsed;
      try { stage2Parsed = JSON.parse(stripMarkdown(stage2Text)); }
      catch (_) { console.warn('analyse-plan: Stage 2 JSON parse failed'); }

      if (stage2Parsed) {
        const raw2 = Array.isArray(stage2Parsed.rooms) ? stage2Parsed.rooms : [];
        const validated2 = raw2.map(r => validateRoom(r, floorIndex)).filter(Boolean);
        // Apply same architectural cleanup to Stage 2 results
        stage2Rooms = postProcessRooms(validated2, warnings);
      }
    } catch (e) {
      console.error('analyse-plan: Stage 2 Claude call failed:', e.message);
    }

    if (stage2Rooms.length > 0) {
      recoveryMode   = true;
      analysisStatus = 'success';
      finalSupply    = stage2Rooms.filter(r => r.ventilationClassification === 'supply');
      finalExtract   = stage2Rooms.filter(r => r.ventilationClassification === 'extract');
      finalTransfer  = stage2Rooms.filter(r => r.ventilationClassification === 'transfer');
      finalIgnore    = stage2Rooms.filter(r => r.ventilationClassification === 'ignore');
      warnings.push('Room schedule extracted via Stage 2 recovery pass — review classifications and airflow values before use.');
    } else {
      analysisStatus = 'failed';
    }
  } else if (analysisStatus === null) {
    // Stage 1 found no rooms and no floor area — still a failure
    analysisStatus = 'failed';
  }

  // ── Failure path — log, no credits, return structured failure ─
  if (analysisStatus === 'failed') {
    const { data: logRow, error: logErr } = await supabase
      .from('plan_analysis_log')
      .insert({
        ...(isUuid(projectId) ? { project_id: projectId } : {}),
        user_id:           user.id,
        floor_index:       floorIndex,
        credits_deducted:  0,
        model_used:        MODEL,
        input_tokens:      totalInputTokens,
        output_tokens:     totalOutputTokens,
        raw_response:      rawText,
        climate_zone:      resolvedClimateZone,
        status:            'error',
        error_detail:      'room_extraction_failed',
        analysis_status:   'failed',
        failure_reason:    'room_extraction_failed',
        ...(testMode ? { test_mode: true } : {}),
      })
      .select('id')
      .single();

    if (logErr) console.error('plan_analysis_log insert error (failure):', logErr);

    return res.status(200).json({
      analysisStatus:  'failed',
      failureReason:   'room_extraction_failed',
      suggestions:     FAILURE_SUGGESTIONS,
      totalInternalFloorArea,
      floorAreaConfidence,
      climateZone:     resolvedClimateZone,
      warnings,
      model:           MODEL,
      inputTokens:     totalInputTokens,
      outputTokens:    totalOutputTokens,
      creditsDeducted: 0,
      newBalance:      null,
      logId:           logRow?.id ?? null,
      logError:        logErr?.message ?? null,
    });
  }

  // ── Success path ─────────────────────────────────────────────

  const analysisJson = {
    supply: finalSupply, extract: finalExtract, transfer: finalTransfer, ignore: finalIgnore,
    totalInternalFloorArea, floorAreaConfidence,
    climateZone: resolvedClimateZone,
    warnings,
    analysisStatus: 'success',
    recoveryMode,
  };

  // ── Deduct credits only on success ──────────────────────────
  const { data: newBalance, error: deductErr } = await supabase.rpc('deduct_credits', {
    p_user_id:     user.id,
    p_amount:      creditCost,
    p_operation:   operation,
    p_project_id:  isUuid(projectId) ? projectId : null,
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
    warnings.push('Warning: credit deduction encountered an issue. Contact support if your balance is incorrect.');
  }

  // ── Persist analysis to projects.ai_analysis_json ───────────
  if (isUuid(projectId)) {
    await supabase
      .from('projects')
      .update({
        ai_analysis_json: analysisJson,
        ...(resolvedClimateZone ? { climate_zone: resolvedClimateZone } : {}),
      })
      .eq('id', projectId);
  }

  // ── Write audit log ─────────────────────────────────────────
  const { data: logRow, error: logErr } = await supabase
    .from('plan_analysis_log')
    .insert({
      ...(isUuid(projectId) ? { project_id: projectId } : {}),
      user_id:           user.id,
      floor_index:       floorIndex,
      credits_deducted:  deductErr ? 0 : creditCost,
      model_used:        MODEL,
      input_tokens:      totalInputTokens,
      output_tokens:     totalOutputTokens,
      raw_response:      rawText,
      parsed_rooms:      analysisJson,
      climate_zone:      resolvedClimateZone,
      status:            'ok',
      analysis_status:   'success',
      ...(testMode      ? { test_mode:      true } : {}),
      ...(recoveryMode  ? { recovery_mode:  true } : {}),
    })
    .select('id')
    .single();

  if (logErr) console.error('plan_analysis_log insert error:', logErr);

  // ── Return structured result ─────────────────────────────────
  return res.status(200).json({
    analysisStatus:         'success',
    recoveryMode,
    rooms:                  { supply: finalSupply, extract: finalExtract, transfer: finalTransfer, ignore: finalIgnore },
    totalInternalFloorArea,
    floorAreaConfidence,
    climateZone:            resolvedClimateZone,
    warnings,
    model:                  MODEL,
    inputTokens:            totalInputTokens,
    outputTokens:           totalOutputTokens,
    creditsDeducted:        deductErr ? 0 : creditCost,
    newBalance:             newBalance ?? null,
    logId:                  logRow?.id  ?? null,
    logError:               logErr?.message ?? null,
  });
}
