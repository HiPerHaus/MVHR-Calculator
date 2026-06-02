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
//   analysisStatus:  'success' | 'failed',
//   recoveryMode:    boolean,
//   stage1RoomCount: number,
//   stage2RoomCount: number | null,
//   rooms: {
//     supply:   [{ name, labelSeen, roomType, area, floor, ventilationClassification, confidence }],
//     extract:  [...],
//     transfer: [...],
//     ignore:   [...]
//   },
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

// Validate and normalise a single room object from AI output.
// Stage 1 focus: name, label, type, classification, confidence, area only.
// Airflow, outlets and open-plan detection are deferred to later stages.
// Returns null if the room cannot be used.
function validateRoom(raw, floorIndex) {
  if (!raw || typeof raw !== 'object') return null;

  const name     = typeof raw.name === 'string'     ? raw.name.trim()     : '';
  // 'labelSeen' = the exact text printed on the plan (new format).
  // Fall back to name if the AI didn't include a separate labelSeen field.
  const labelSeen = typeof raw.labelSeen === 'string' ? raw.labelSeen.trim() : name;
  const roomType  = typeof raw.roomType === 'string'  ? raw.roomType.trim()  : '';
  const area      = typeof raw.area === 'number' && raw.area > 0
    ? Math.round(raw.area * 10) / 10 : null;
  const confidence = typeof raw.confidence === 'number'
    ? Math.min(1, Math.max(0, raw.confidence)) : null;

  // fixtures: AI-reported plumbing/wet-area indicators visible in the room
  const fixtures = Array.isArray(raw.fixtures)
    ? raw.fixtures.filter(f => typeof f === 'string' && f.trim()).map(f => f.trim().toLowerCase())
    : [];

  // Coerce roomType to nearest valid value
  let resolvedType = ALL_TYPES.has(roomType) ? roomType : null;
  if (!resolvedType) {
    const lower = roomType.toLowerCase();
    for (const t of ALL_TYPES) {
      if (t.toLowerCase() === lower) { resolvedType = t; break; }
    }
  }
  if (!resolvedType) resolvedType = 'Other';

  // Accept 'classification' (new Stage 1 format) or 'ventilationClassification' (legacy)
  const rawClass = raw.classification ?? raw.ventilationClassification ?? null;
  let ventClass  = typeof rawClass === 'string' ? rawClass.toLowerCase().trim() : null;
  if (!VENT_CLASSIFICATIONS.has(ventClass)) {
    if (SUPPLY_TYPES.has(resolvedType))        ventClass = 'supply';
    else if (EXTRACT_TYPES.has(resolvedType))  ventClass = 'extract';
    else if (TRANSFER_TYPES.has(resolvedType)) ventClass = 'transfer';
    else if (IGNORE_TYPES.has(resolvedType))   ventClass = 'ignore';
    else                                        ventClass = 'supply';
  }

  return {
    name:                      name || resolvedType,
    labelSeen:                 labelSeen || name || resolvedType,
    roomType:                  resolvedType,
    area:                      area ?? 0,
    floor:                     floorIndex,
    ventilationClassification: ventClass,
    confidence,
    fixtures,
    optionalExtract:           false,
    optionalSupply:            false,
    classificationReason:      null,
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
// Precedence order (highest first):
//   1. Service/equipment → exclude
//   2. Fixture override → force extract (sink/basin/toilet/shower etc. take priority over name)
//   3. WIR size rules → size-based supply/transfer/ignore + optionalSupply
//   4. Known joinery/storage labels (BIR/CPD/robe/wardrobe/linen etc.) → exclude or demote to ignore
//   5. Outdoor/non-ventilated label patterns → force ignore
//   6. Circulation label patterns → force transfer
//   7. Wet-room label patterns → force extract
//   8. Habitable label patterns → force supply
//   9. Store size rules → size-based extract/transfer/ignore + optionalExtract
//  10. JAN heuristic
//  11. Person-name heuristic (last — only when nothing else matched)

// ── Pattern sets ─────────────────────────────────────────────

const SERVICE_PATTERNS = [
  /\bhws\b/i,         // hot water system
  /\bhot water\b/i,
  /\bhrv\b/i,         // heat recovery ventilation unit
  /\bplant\b/i,
  /\bboiler\b/i,
  /\bmeter board\b/i,
  /\bequipment\b/i,
];

// Joinery/built-in storage — NOT architectural rooms.
// These are always excluded or demoted, never promoted to supply/transfer.
// WIR (walk-in robe) is NOT in this list — it gets its own size-based rule below.
const JOINERY_PATTERNS = [
  /\bcpd\b/i,         // coat pantry door / cupboard
  /\bbir\b/i,         // built-in robe
  /\brobe\b/i,        // robe joinery (not WIR — caught separately)
  /\bwardrobe\b/i,    // wardrobe joinery
  /\blinen\b/i,
  /\bbroom\b/i,
  /\bshelv/i,
  /\bfridge\b/i,
  /\bcupboard\b/i,
  /\bcabinet/i,
  /\bjoinery\b/i,
];

// Labels that should always be ignore (outdoor / non-ventilated)
// Note: WIR is intentionally excluded here — it has its own size-based rule.
const IGNORE_LABEL_PATTERNS = [
  /\bverandah\b/i, /\bveranda\b/i,
  /\bporch\b/i,
  /\balfresco\b/i,
  /\bgarage\b/i,
  /\bcarport\b/i,
  /\bbalcon/i,        // balcony, balconies
  /\bdeck\b/i,
  /\bcourtyard\b/i,
];

// Labels that should always be transfer (circulation)
const TRANSFER_LABEL_PATTERNS = [
  /\bpassage\b/i,
  /\bhall(way)?\b/i,
  /\bcorridor\b/i,
  /\bentry\b/i,
  /\bfoyer\b/i,
  /\blobby\b/i,
  /\blanding\b/i,
  /\bstair/i,
];

// Labels that should always be extract (wet rooms / service)
const EXTRACT_LABEL_PATTERNS = [
  /\bbath(room)?\b/i,
  /\bensuite\b/i,
  /\bwc\b/i,
  /\bpowder\b/i,
  /\btoilet\b/i,
  /\blaundry\b/i,
  /\bkitchen\b/i,
  /\bpantry\b/i,
  /\butility\b/i,
];

// Labels that should always be supply (habitable rooms)
const SUPPLY_LABEL_PATTERNS = [
  /\bbedroom\b/i,
  /\bmaster\b/i,
  /\bliving\b/i,
  /\bdining\b/i,
  /\bmeals\b/i,
  /\bfamily\b/i,
  /\blounge\b/i,
  /\brumpus\b/i,
  /\btheatre\b/i,
  /\bmedia\b/i,
  /\bgames\b/i,
  /\bactivity\b/i,
  /\bgym\b/i,
  /\bstudio\b/i,
  /\bstudy\b/i,
  /\boffice\b/i,
];

// All known architectural room words — used to exclude them from person-name heuristic
const KNOWN_ROOM_WORDS = new Set([
  'bedroom','master','living','dining','meals','kitchen','bathroom','bath','ensuite',
  'laundry','hallway','hall','passage','entry','corridor','foyer','lobby','study','office',
  'rumpus','pantry','wc','toilet','powder','wir','robe','garage','porch','carport',
  'alfresco','verandah','veranda','store','other','lounge','family','theatre','media',
  'activity','games','gym','cellar','bar','studio','landing','stair','stairs',
  'utility','balcony','deck','courtyard','jan',
]);

const STORE_PATTERN = /\bstore\b/i;

// Wet-area fixtures that force extract classification regardless of room name.
// Oven, cooktop, fridge and dishwasher are intentionally excluded — they do not
// require extract ventilation on their own. They may appear in fixtures[] for
// information but must NOT trigger the extract override.
const WET_FIXTURE_PATTERNS = [
  /\bsink\b/i,
  /\bbasin\b/i,
  /\bvanity\b/i,
  /\btoilet\b/i,
  /\bwc\b/i,
  /\bshower\b/i,
  /\bbath\b/i,
  /\blaundry tub\b/i,
  /\btub\b/i,
  /\btrough\b/i,
  /\bkitchenette\b/i,
];
// Matches WIR, Walk-in Robe, Walk in Robe, Walk-in Wardrobe, Walk in Wardrobe
const WIR_PATTERN   = /\b(wir|walk[-\s]?in\s+(robe|wardrobe))\b/i;

function postProcessRooms(rooms, warnings) {
  const out = [];

  for (const room of rooms) {
    const name    = (room.name || '').trim();
    const area    = room.area || 0;
    const nameLo  = name.toLowerCase();
    let matched   = false; // set true if a label pattern fires

    // ── 1. Service / equipment → exclude ─────────────────────
    if (SERVICE_PATTERNS.some(p => p.test(name))) {
      warnings.push(`"${name}" identified as a service/equipment space — excluded as a separate MVHR zone.`);
      continue;
    }

    // ── 2. Fixture override — wet-area fixtures force extract ─────
    // Plumbing fixtures take priority over room name.
    // A "Multi Use Room" with a sink is extract. A "Studio" with a kitchenette is extract.
    if (Array.isArray(room.fixtures) && room.fixtures.length > 0) {
      const fixtureStr = room.fixtures.join(' ');
      const wetFixture = room.fixtures.find(f => WET_FIXTURE_PATTERNS.some(p => p.test(f)));
      if (wetFixture) {
        room.ventilationClassification = 'extract';
        if (!EXTRACT_TYPES.has(room.roomType)) room.roomType = 'Other';
        room.classificationReason = `Contains wet fixture (${wetFixture}) — classified as extract regardless of room name.`;
        warnings.push(`"${name}" reclassified as extract — ${wetFixture} detected.`);
        out.push(room);
        continue;
      }
    }

    // ── 3. WIR (walk-in robe) — size-based ───────────────────────
    // Matches name, labelSeen, or roomType against WIR / Walk-in Robe / Walk-in Wardrobe.
    // Must run before joinery rule so "Walk-in Robe" doesn't get caught by /\brobe\b/i.
    const combined = `${room.name} ${room.labelSeen || ''} ${room.roomType}`.toLowerCase();
    if (WIR_PATTERN.test(combined)) {
      const WIR_REASON = 'Separate WIR may be used as a low-flow supply point if required for system balance or air movement.';
      room.roomType = 'WIR';
      if (area < 2) {
        room.ventilationClassification = 'ignore';
        room.classificationReason = 'WIR too small for an MVHR terminal — classified as ignore.';
        warnings.push(`Walk-in Robe (${area} m²) classified as ignore — too small for an MVHR terminal.`);
      } else if (area < 5) {
        room.ventilationClassification = 'transfer';
        room.optionalSupply = true;
        room.classificationReason = WIR_REASON;
        warnings.push(`Walk-in Robe (${area} m²) classified as optional supply zone.`);
      } else {
        room.ventilationClassification = 'supply';
        room.optionalSupply = true;
        room.classificationReason = WIR_REASON;
        warnings.push(`Walk-in Robe (${area} m²) classified as optional supply zone.`);
      }
      out.push(room);
      continue;
    }

    // ── 3. Joinery / built-in storage ─────────────────────────
    // CPD, BIR, linen, broom, shelving, fridge recess, cupboard, cabinet, joinery:
    // always ignore (or exclude if tiny). Only promote to WIR/ignore if genuinely room-sized (≥ 4 m²).
    if (JOINERY_PATTERNS.some(p => p.test(name))) {
      if (area >= 4) {
        room.ventilationClassification = 'ignore';
        room.roomType = 'WIR';
        room.classificationReason = 'Room-sized storage/robe space — classified as ignore; no MVHR terminal required.';
        warnings.push(`"${name}" (${area} m²) treated as walk-in robe — classified as ignore.`);
        out.push(room);
      } else {
        // Small joinery — not a room, exclude entirely
        warnings.push(`"${name}" treated as built-in joinery/storage — excluded as a separate MVHR zone.`);
      }
      continue;
    }

    // ── 3. Outdoor / non-ventilated label patterns ────────────
    if (IGNORE_LABEL_PATTERNS.some(p => p.test(name))) {
      if (room.ventilationClassification !== 'ignore') {
        room.ventilationClassification = 'ignore';
        if (!IGNORE_TYPES.has(room.roomType)) room.roomType = 'Other';
      }
      out.push(room);
      matched = true;
    }

    // ── 4. Circulation label patterns ─────────────────────────
    else if (TRANSFER_LABEL_PATTERNS.some(p => p.test(name))) {
      if (room.ventilationClassification !== 'transfer') {
        room.ventilationClassification = 'transfer';
        if (!TRANSFER_TYPES.has(room.roomType)) room.roomType = 'Other';
      }
      out.push(room);
      matched = true;
    }

    // ── 5. Wet-room label patterns ────────────────────────────
    else if (EXTRACT_LABEL_PATTERNS.some(p => p.test(name))) {
      if (room.ventilationClassification !== 'extract') {
        room.ventilationClassification = 'extract';
        if (!EXTRACT_TYPES.has(room.roomType)) room.roomType = 'Other';
      }
      out.push(room);
      matched = true;
    }

    // ── 6. Habitable room label patterns ──────────────────────
    else if (SUPPLY_LABEL_PATTERNS.some(p => p.test(name))) {
      if (room.ventilationClassification !== 'supply') {
        room.ventilationClassification = 'supply';
        if (!SUPPLY_TYPES.has(room.roomType)) room.roomType = 'Other';
      }
      out.push(room);
      matched = true;
    }

    if (matched) continue;

    // ── 7. Store size rules ───────────────────────────────────
    // Internal enclosed store rooms are classified by area:
    //   < 2 m²        → ignore (too small for a terminal)
    //   2 – 5 m²      → transfer + optionalExtract (may suit balance)
    //   > 5 m²        → extract candidate + optionalExtract
    // Joinery spaces (CPD/BIR/linen etc.) are handled above and never reach here.
    if (STORE_PATTERN.test(name) || room.roomType === 'Store') {
      room.roomType = 'Store';
      if (area < 2) {
        room.ventilationClassification = 'ignore';
        room.classificationReason = 'Store too small for an MVHR terminal.';
        warnings.push(`"${name}" (${area} m²) — too small for an MVHR terminal, classified as ignore.`);
      } else if (area <= 5) {
        room.ventilationClassification = 'transfer';
        room.optionalExtract = true;
        room.classificationReason = 'Internal store may be used as an extract point if required for system balance.';
        warnings.push(`"${name}" (${area} m²) — classified as transfer with optional extract.`);
      } else {
        room.ventilationClassification = 'extract';
        room.optionalExtract = true;
        room.classificationReason = 'Internal store may be used as an extract point if required for system balance.';
        warnings.push(`"${name}" (${area} m²) — large internal store classified as extract candidate.`);
      }
      out.push(room);
      continue;
    }

    // ── 8. JAN room ───────────────────────────────────────────
    if (/\bjan\b/i.test(name)) {
      if (area >= 4) {
        if (room.ventilationClassification !== 'supply') {
          room.ventilationClassification = 'supply';
          room.roomType = 'Study / Office';
          warnings.push(`"${name}" classified as supply — appears to be a usable enclosed room, not a janitor closet.`);
        }
      } else {
        room.ventilationClassification = 'ignore';
        room.roomType = 'Store';
        warnings.push(`"${name}" (${area} m²) treated as a small utility space — classified as ignore.`);
      }
      out.push(room);
      continue;
    }

    // ── 9. Person-name heuristic (last resort) ────────────────
    // Single capitalised word not in the known room vocabulary → likely a person's bedroom
    const isPersonName = /^[A-Z][a-z]{2,}$/.test(name) && !KNOWN_ROOM_WORDS.has(nameLo);
    if (isPersonName && room.ventilationClassification !== 'supply') {
      room.ventilationClassification = 'supply';
      if (!SUPPLY_TYPES.has(room.roomType)) room.roomType = 'Other';
      warnings.push(`"${name}" interpreted as a habitable room (personal label) — classified as supply.`);
    }

    out.push(room);
  }

  return out;
}

// ── System prompt — Stage 1: room identification only ─────────
// Goal: produce a reliable room schedule. Nothing else.
// Airflow, outlets, floor area and MVHR design are handled in later stages.
const SYSTEM_PROMPT = `You are reading an architectural floor plan.
Your ONLY job is to identify every room and space visible on the plan and classify it.
Do not calculate airflow. Do not calculate outlets. Do not estimate floor area.

════ STEP 1: READ EVERY ROOM LABEL ════
Scan the entire plan and list every labelled space. Use the exact text you can see as "labelSeen".

If ANY of these words appear on the plan they MUST appear in rooms[]:
  Kitchen  Scullery  Pantry  Butlers Pantry
  Living   Lounge    Dining  Meals   Family  Rumpus  Theatre  Activity  Retreat
  Bedroom  Master    Bed     Study   Office
  Bath     Bathroom  Ensuite WC      Powder  Toilet  Laundry
  Entry    Hall      Hallway Passage Corridor  Lobby  Landing
  WIR      Robe      Store   Garage  Alfresco  Verandah  Porch  Carport

Do NOT return empty rooms[].
If labels are unclear, use a generic name and set confidence 0.5.
Include uncertain rooms — omitting rooms is an error.

Rooms labelled with a person's name (PAUL, JAN, JANE, TOM, etc.) are habitable rooms
(bedroom or study) — classify as supply.

════ STEP 2: CLASSIFY EACH ROOM ════
Set "classification" to exactly one of:
  "supply"   — bedrooms, living, dining, study, rumpus, theatre, family, retreat, lounge, activity, office
  "extract"  — kitchen, scullery, butler's pantry, bathroom, ensuite, WC, powder, toilet, laundry
  "transfer" — entry, hall, hallway, passage, corridor, lobby, landing
  "ignore"   — WIR, robe, BIR, CPD, garage, carport, alfresco, verandah, porch, balcony,
               store < 4 m², linen, cupboard, HWS, HRV, plant room, joinery spaces

Set "roomType" to exactly one of:
  Supply:   "Single Bedroom"  "Double Bedroom"  "Master Bedroom"  "Study / Office"
            "Living Room"  "Dining Room"  "Rumpus Room"  "Other"
  Extract:  "Kitchen"  "Bathroom"  "Ensuite"  "Laundry"  "WC"  "Pantry"  "Other"
  Transfer: "Hallway"  "Entry"  "Corridor"  "Other"
  Ignore:   "WIR"  "Garage"  "Porch"  "Carport"  "Alfresco"  "Store"  "Other"

════ STEP 3: IDENTIFY FIXTURES IN EVERY ROOM ════
Do NOT rely on the room label to decide whether a room has plumbing.
Visually inspect the interior of EVERY room for drawn symbols and joinery outlines.

Look specifically for these drawn elements inside each room boundary:
  • Sink symbol       — rectangular or D-shaped outline against a wall or benchtop
  • Basin symbol      — circular or oval outline, usually wall-mounted
  • Vanity            — rectangular benchtop with one or two basin outlines
  • Laundry tub       — deep square or rectangular tub symbol
  • Kitchenette       — short run of joinery with a sink outline included
  • Shower recess     — square or rectangular zone, often with a drain circle
  • Bath              — large rectangular or freestanding tub outline
  • Toilet / WC       — elongated oval or rectangular symbol

Small plumbing fixtures are commonly drawn as simple outlines against walls and are easy to
miss. Check every wall inside the room, not just the labelled centre.

These room types often contain plumbing fixtures even when not labelled as wet rooms —
inspect them carefully:
  Multi-Use Room  Study  Office  Utility  Workshop  Studio  Store  Mudroom
  Scullery  Pantry  Retreat  Activity  Rumpus  Gym  Cellar  Bar

WET FIXTURES — if any are visible inside the room, add to fixtures[] and set classification "extract":
  sink  basin  vanity  toilet  WC  shower  bath  laundry tub  tub  trough  kitchenette

DRY FIXTURES — add to fixtures[] for information only, do NOT classify as extract alone:
  oven  cooktop  fridge  dishwasher

FIXTURE RULE (highest priority — overrides room name):
• Any wet fixture present → classification = "extract"
• Oven / cooktop / fridge / dishwasher alone → do not change classification
• Examples:
    Multi-Use Room + sink symbol    = extract
    Study + basin symbol            = extract
    Utility Room + basin            = extract
    Studio + kitchenette with sink  = extract
    Mudroom + laundry tub           = extract
    Scullery + sink + dishwasher    = extract  (sink is wet)
    Rumpus + fridge only            = supply   (fridge alone is not wet)

If no fixtures are visible inside the room boundary, set "fixtures": [].

════ CRITICAL RULES ════
• Thick-walled enclosed spaces with a door = rooms. List them.
• Thin joinery lines, shelf outlines, robe zones = not rooms. Do not list as separate entries.
• Estimate area (m²) from dimensions or proportions. If uncertain, estimate and set confidence 0.5.
• If room extraction is impossible (blank page, not a floor plan), return analysisStatus "failed".

════ RESPONSE FORMAT ════
Return ONLY valid JSON. No markdown. No prose. No other fields.

{
  "rooms": [
    { "name": "Master Bedroom", "labelSeen": "MASTER BED",
      "roomType": "Master Bedroom", "classification": "supply",
      "area": 19.2, "confidence": 0.94, "fixtures": [] },
    { "name": "Kitchen", "labelSeen": "KITCHEN",
      "roomType": "Kitchen", "classification": "extract",
      "area": 16.4, "confidence": 0.97, "fixtures": ["sink", "kitchen joinery"] },
    { "name": "Multi-Use Room", "labelSeen": "MULTI USE",
      "roomType": "Other", "classification": "extract",
      "area": 12.0, "confidence": 0.85, "fixtures": ["sink"] },
    { "name": "Rumpus Room", "labelSeen": "RUMPUS",
      "roomType": "Rumpus Room", "classification": "supply",
      "area": 22.0, "confidence": 0.95, "fixtures": ["fridge"] },
    { "name": "Hallway", "labelSeen": "HALL",
      "roomType": "Hallway", "classification": "transfer",
      "area": 8.2, "confidence": 0.9, "fixtures": [] }
  ]
}`;

// ── Stage 2 recovery prompt ────────────────────────────────────
// Used only when Stage 1 returns no rooms on a plan that appears readable.
// Same schema as Stage 1 but explicitly named as recovery to reduce cognitive overlap.
const ROOM_RECOVERY_PROMPT = `You are reading an architectural floor plan.
Stage 1 analysis returned no rooms. Your job is to recover the room schedule.

Read every visible room label on the plan and return a room entry for each one.
Use the exact label text you can see as "labelSeen".

Classification rules:
  "supply"   — bedrooms, living, dining, study, rumpus, family, theatre, office, habitable rooms
  "extract"  — kitchen, bathroom, ensuite, WC, powder, toilet, laundry, pantry, scullery
  "transfer" — entry, hall, hallway, passage, corridor, lobby, landing
  "ignore"   — WIR, robe, BIR, CPD, garage, carport, alfresco, verandah, porch, store < 4 m²,
               cupboards, joinery, HWS, HRV, plant spaces

Rooms labelled with a person's name (PAUL, JAN, JANE, etc.) are habitable — classify as supply.
Do not return cupboards, joinery, shelving or robe outlines as rooms.
Estimate area (m²) if visible. Set confidence 0.5 for uncertain rooms.
Do NOT rely on room labels to detect plumbing. Visually inspect every room's interior for
drawn fixture symbols — sink outlines, basin circles, vanity benchtops, laundry tubs, shower
recesses. Small fixtures are drawn against walls and easy to miss; check all four walls.
Rooms like Multi-Use Room, Study, Office, Utility, Studio, Mudroom, Workshop often contain
sinks even when not labelled as wet rooms.
Wet fixtures (sink, basin, vanity, toilet, WC, shower, bath, laundry tub, tub, trough,
kitchenette) → add to fixtures[] and set classification "extract".
Dry fixtures (oven, cooktop, fridge, dishwasher) → add to fixtures[] but do NOT trigger extract.
Multi-Use Room + sink = extract. Rumpus + fridge only = supply.

Return ONLY valid JSON. No markdown. No prose.

{
  "rooms": [
    { "name": "Master Bedroom", "labelSeen": "MASTER BED",
      "roomType": "Master Bedroom", "classification": "supply",
      "area": 18.0, "confidence": 0.8, "fixtures": [] },
    { "name": "Kitchen", "labelSeen": "KITCHEN",
      "roomType": "Kitchen", "classification": "extract",
      "area": 14.0, "confidence": 0.9, "fixtures": ["sink", "kitchen joinery"] }
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
              text: 'Analyse this floor plan and return the structured JSON room list.',
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

  // ── Resolve rooms — new flat format: parsed.rooms[] with classification field.
  // validateRoom accepts both 'classification' (new) and 'ventilationClassification' (legacy).
  const rawRooms  = Array.isArray(parsed?.rooms) ? parsed.rooms : [];
  const allRooms  = rawRooms.map(r => validateRoom(r, floorIndex)).filter(Boolean);
  const supply    = allRooms.filter(r => r.ventilationClassification === 'supply');
  const extract   = allRooms.filter(r => r.ventilationClassification === 'extract');
  const transfer  = allRooms.filter(r => r.ventilationClassification === 'transfer');
  const ignore    = allRooms.filter(r => r.ventilationClassification === 'ignore');

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
  const stage1RawCount = supply.length + extract.length + transfer.length + ignore.length;
  const stage1Cleaned  = postProcessRooms([...supply, ...extract, ...transfer, ...ignore], warnings);
  const stage1RoomCount = stage1Cleaned.length; // post-filter count (debug field)

  let finalSupply   = stage1Cleaned.filter(r => r.ventilationClassification === 'supply');
  let finalExtract  = stage1Cleaned.filter(r => r.ventilationClassification === 'extract');
  let finalTransfer = stage1Cleaned.filter(r => r.ventilationClassification === 'transfer');
  let finalIgnore   = stage1Cleaned.filter(r => r.ventilationClassification === 'ignore');
  let recoveryMode  = false;
  let stage2RoomCount = null; // null when Stage 2 was not invoked
  // 'success' | 'failed'
  let analysisStatus = stage1RoomCount > 0 ? 'success' : null; // resolved below

  // ── Stage 2: recovery pass when Stage 1 returns no rooms ─────
  if (analysisStatus === null) {
    console.log('analyse-plan: Stage 1 returned empty rooms — attempting Stage 2 recovery');

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
        stage2RoomCount = stage2Rooms.length;
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
      analysisStatus:   'failed',
      failureReason:    'room_extraction_failed',
      suggestions:      FAILURE_SUGGESTIONS,
      stage1RoomCount,
      stage2RoomCount,
      warnings,
      model:            MODEL,
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
      .update({ ai_analysis_json: analysisJson })
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
    stage1RoomCount,
    stage2RoomCount,
    rooms:                  { supply: finalSupply, extract: finalExtract, transfer: finalTransfer, ignore: finalIgnore },
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
