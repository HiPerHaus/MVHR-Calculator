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
//     supply:   [{ name, labelSeen, roomType, area, floor, ventilationClassification, confidence,
//                  fixtures, optionalExtract, optionalSupply, containsSecondaryExtractZone,
//                  classificationReason }],
//     extract:  [...],
//     transfer: [...],
//     ignore:   [...]
//   },
//   warnings:        string[],
//   assumptions:     string[],
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
    optionalExtract:                false,
    optionalSupply:                 false,
    containsSecondaryExtractZone:   raw.containsSecondaryExtractZone === true,
    classificationReason:           null,
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
//   1.  Service/equipment → exclude
//   2.  Wet-fixture override → force extract (shower/toilet/sink/basin etc.)
//   3.  WIR → transfer + optionalSupply (≥ 4 m²)
//   4.  Joinery (BIR/CPD/robe/linen etc.) → exclude or ignore
//   5.  Outdoor/non-ventilated labels → force ignore
//   6.  Circulation labels → force transfer
//   7.  Gym → force extract
//   8.  Extract labels (kitchen/pantry/scullery/bathroom etc.) → force extract
//   9.  Habitable labels → force supply
//  10.  Store rules → transfer + optionalExtract
//  11.  JAN heuristic
//  12.  Person-name heuristic

// ── Pattern sets ─────────────────────────────────────────────

const SERVICE_PATTERNS = [
  /\bhws\b/i,           // hot water system
  /\bhot water\b/i,
  /\bhrv\b/i,           // heat-recovery ventilation unit housing
  /\bmvhr\b/i,          // MVHR cupboard
  /\bplant\b/i,
  /\bboiler\b/i,
  /\bmeter board\b/i,
  /\belectrical\b/i,
  /\bmechanical\b/i,
  /\broof space\b/i,
  /\battic\b/i,
  /\bunderfloor\b/i,
  /\blift shaft\b/i,
  /\bbin store\b/i,
];

// Joinery/built-in storage — NOT architectural rooms.
// WIR is intentionally absent — handled by its own rule.
const JOINERY_PATTERNS = [
  /\bcpd\b/i,           // coat pantry door / cupboard
  /\bbir\b/i,           // built-in robe
  /\brobe\b/i,          // robe joinery
  /\bwardrobe\b/i,
  /\blinen\b/i,
  /\bbroom\b/i,
  /\bshelv/i,
  /\bfridge\b/i,        // fridge recess
  /\bcupboard\b/i,
  /\bcabinet/i,
  /\bjoinery\b/i,
];

// Outdoor / non-ventilated — always ignore
const IGNORE_LABEL_PATTERNS = [
  /\bverandah\b/i, /\bveranda\b/i,
  /\bporch\b/i,
  /\balfresco\b/i,
  /\bgarage\b/i,
  /\bcarport\b/i,
  /\bbalcon/i,          // balcony, balconies
  /\bdeck\b/i,
  /\bcourtyard\b/i,
  /\boutdoor\b/i,
];

// Circulation — always transfer
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

// Extract — wet/odour-producing rooms (by label)
// Gym is handled separately below (its own rule).
const EXTRACT_LABEL_PATTERNS = [
  /\bbath(room)?\b/i,
  /\bensuite\b/i,
  /\bwc\b/i,
  /\bpowder\b/i,
  /\btoilet\b/i,
  /\blaundry\b/i,
  /\bkitchen\b/i,
  /\bpantry\b/i,       // pantry / walk-in pantry / butler's pantry — always extract
  /\bscullery\b/i,
  /\bbutler/i,         // butler's pantry
  /\bmudroom\b/i,
  /\butility\b/i,
];

// Supply — habitable rooms
// Gym intentionally excluded (it is extract — see rule 7 below).
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
  /\bstudio\b/i,
  /\bstudy\b/i,
  /\boffice\b/i,
  /\blibrary\b/i,
  /\bplayroom\b/i,
  /\bplay room\b/i,
  /\bretreat\b/i,
  /\bsitting\b/i,
  /\bsunroom\b/i,
  /\bhome theatre\b/i,
  /\bmulti.?purpose\b/i,
  /\bmulti.?use\b/i,
];

// Known room vocabulary — excludes from person-name heuristic
const KNOWN_ROOM_WORDS = new Set([
  'bedroom','master','living','dining','meals','kitchen','bathroom','bath','ensuite',
  'laundry','hallway','hall','passage','entry','corridor','foyer','lobby','study','office',
  'rumpus','pantry','wc','toilet','powder','wir','robe','garage','porch','carport',
  'alfresco','verandah','veranda','store','other','lounge','family','theatre','media',
  'activity','games','gym','cellar','bar','studio','landing','stair','stairs',
  'utility','balcony','deck','courtyard','jan','scullery','butler','mudroom','library',
  'playroom','retreat','sitting','sunroom','kitchen','kitchenette',
]);

const STORE_PATTERN = /\bstore\b/i;

// Moisture fixtures — add to fixtures[] but do NOT force extract on their own.
// A habitable room with only these becomes Supply + containsSecondaryExtractZone = true.
// They only trigger extract if a WET fixture (shower/toilet/sink/basin) is also present.
const MOISTURE_FIXTURE_PATTERNS = [
  /\bbath\b/i,
  /\bfreestanding bath\b/i,
  /\bspa bath\b/i,
  /\bspa\b/i,
  /\bsauna\b/i,
];

// Wet-area fixtures that force extract regardless of room name.
// IMPORTANT: bath, freestanding bath, spa bath and sauna are MOISTURE fixtures —
// they do not auto-trigger extract unless a shower, toilet or sink is also present.
// Those are intentionally absent from this list.
const WET_FIXTURE_PATTERNS = [
  /\bsink\b/i,
  /\bbasin\b/i,
  /\bvanity\b/i,
  /\btoilet\b/i,
  /\bwc\b/i,
  /\burinal\b/i,
  /\bshower\b/i,
  /\blaundry tub\b/i,
  /\butility sink\b/i,
  /\bkitchen sink\b/i,
  /\bbar sink\b/i,
  /\bprep sink\b/i,
  /\btrough\b/i,
  /\bkitchenette\b/i,
];

// Matches WIR, Walk-in Robe, Walk in Robe, Walk-in Wardrobe, Walk in Wardrobe
const WIR_PATTERN = /\b(wir|walk[-\s]?in\s+(robe|wardrobe))\b/i;

function postProcessRooms(rooms, warnings) {
  const out = [];

  for (const room of rooms) {
    const name   = (room.name || '').trim();
    const area   = room.area || 0;
    const nameLo = name.toLowerCase();
    let matched  = false;

    // ── 1. Service / equipment → exclude ─────────────────────
    if (SERVICE_PATTERNS.some(p => p.test(name))) {
      warnings.push(`"${name}" identified as a service/equipment space — excluded.`);
      continue;
    }

    // ── 2. Fixture override ───────────────────────────────────
    // Wet fixtures (shower/toilet/sink/basin etc.) force extract regardless of room name.
    // Moisture fixtures (bath/spa/sauna) alone preserve supply but flag secondary extract zone.
    if (Array.isArray(room.fixtures) && room.fixtures.length > 0) {
      const wetFixture = room.fixtures.find(f => WET_FIXTURE_PATTERNS.some(p => p.test(f)));

      if (wetFixture) {
        // Has a real wet fixture → extract
        room.ventilationClassification = 'extract';
        if (!EXTRACT_TYPES.has(room.roomType)) room.roomType = 'Other';
        room.classificationReason = `Contains wet fixture (${wetFixture}) — classified as extract regardless of room name.`;
        warnings.push(`"${name}" reclassified as extract — ${wetFixture} detected.`);
        out.push(room);
        continue;
      }

      // No wet fixture — check for moisture-only fixtures (bath/spa/sauna)
      const moistureFixture = room.fixtures.find(f => MOISTURE_FIXTURE_PATTERNS.some(p => p.test(f)));
      if (moistureFixture && room.ventilationClassification === 'supply') {
        // Habitable room with bath/spa alone: stay supply, flag secondary zone
        room.containsSecondaryExtractZone = true;
        if (!room.classificationReason) {
          room.classificationReason = `Habitable room with ${moistureFixture} — supply preserved. Secondary extract zone flagged for diffuser allocation.`;
        }
        warnings.push(`"${name}" contains ${moistureFixture} — classified as supply with secondary extract zone.`);
        // Fall through — room continues to label-pattern rules which will confirm supply
      }
    }

    // ── 3. WIR → transfer + optionalSupply ───────────────────
    // Matched against name + labelSeen + roomType to catch "Walk-in Robe" variants.
    // Must run before joinery rule (/\brobe\b/i would otherwise catch it).
    const combined = `${room.name} ${room.labelSeen || ''} ${room.roomType}`.toLowerCase();
    if (WIR_PATTERN.test(combined)) {
      room.roomType = 'WIR';
      room.ventilationClassification = 'transfer';
      if (area >= 4) {
        room.optionalSupply = true;
        room.classificationReason = 'Walk-in Robe — transfer. May be used as a low-flow supply point if required for system balance.';
        warnings.push(`Walk-in Robe (${area} m²) — transfer, optionalSupply flagged.`);
      } else {
        room.classificationReason = 'Walk-in Robe — transfer. Too small to warrant a supply terminal.';
        warnings.push(`Walk-in Robe (${area} m²) — classified as transfer.`);
      }
      out.push(room);
      continue;
    }

    // ── 4. Joinery / built-in storage ─────────────────────────
    if (JOINERY_PATTERNS.some(p => p.test(name))) {
      if (area >= 4) {
        room.ventilationClassification = 'ignore';
        room.roomType = 'WIR';
        room.classificationReason = 'Room-sized built-in storage — classified as ignore.';
        warnings.push(`"${name}" (${area} m²) treated as built-in storage — classified as ignore.`);
        out.push(room);
      } else {
        warnings.push(`"${name}" treated as built-in joinery — excluded.`);
      }
      continue;
    }

    // ── 5. Outdoor / non-ventilated → ignore ─────────────────
    if (IGNORE_LABEL_PATTERNS.some(p => p.test(name))) {
      room.ventilationClassification = 'ignore';
      if (!IGNORE_TYPES.has(room.roomType)) room.roomType = 'Other';
      out.push(room);
      matched = true;
    }

    // ── 6. Circulation → transfer ────────────────────────────
    else if (TRANSFER_LABEL_PATTERNS.some(p => p.test(name))) {
      room.ventilationClassification = 'transfer';
      if (!TRANSFER_TYPES.has(room.roomType)) room.roomType = 'Other';
      out.push(room);
      matched = true;
    }

    // ── 7. Gym → extract ─────────────────────────────────────
    // Gyms are extract due to elevated moisture, CO₂ and odour load.
    else if (/\bgym\b/i.test(name)) {
      room.ventilationClassification = 'extract';
      if (!EXTRACT_TYPES.has(room.roomType)) room.roomType = 'Other';
      room.classificationReason = 'Home gym — extract due to elevated moisture, CO₂ and odour load.';
      out.push(room);
      matched = true;
    }

    // ── 8. Extract labels ────────────────────────────────────
    else if (EXTRACT_LABEL_PATTERNS.some(p => p.test(name))) {
      room.ventilationClassification = 'extract';
      if (!EXTRACT_TYPES.has(room.roomType)) room.roomType = 'Other';
      out.push(room);
      matched = true;
    }

    // ── 9. Supply labels ─────────────────────────────────────
    else if (SUPPLY_LABEL_PATTERNS.some(p => p.test(name))) {
      room.ventilationClassification = 'supply';
      if (!SUPPLY_TYPES.has(room.roomType)) room.roomType = 'Other';
      out.push(room);
      matched = true;
    }

    if (matched) continue;

    // ── 10. Store rules ───────────────────────────────────────
    // Stores and cupboards are normally Transfer + optionalExtract for balancing flexibility.
    // Very small stores (< 2 m²) are Ignore.
    if (STORE_PATTERN.test(name) || room.roomType === 'Store') {
      room.roomType = 'Store';
      if (area < 2) {
        room.ventilationClassification = 'ignore';
        room.classificationReason = 'Store too small for an MVHR terminal.';
        warnings.push(`"${name}" (${area} m²) — too small for a terminal, classified as ignore.`);
      } else {
        room.ventilationClassification = 'transfer';
        room.optionalExtract = true;
        room.classificationReason = 'Internal store — transfer. May be used as an extract point for system balance.';
        warnings.push(`"${name}" (${area} m²) — transfer, optionalExtract flagged.`);
      }
      out.push(room);
      continue;
    }

    // ── 11. JAN heuristic ────────────────────────────────────
    if (/\bjan\b/i.test(name)) {
      if (area >= 4) {
        room.ventilationClassification = 'supply';
        room.roomType = 'Study / Office';
        warnings.push(`"${name}" classified as supply — appears to be a habitable room, not a janitor closet.`);
      } else {
        room.ventilationClassification = 'ignore';
        room.roomType = 'Store';
        warnings.push(`"${name}" (${area} m²) — classified as ignore (small utility space).`);
      }
      out.push(room);
      continue;
    }

    // ── 12. Person-name heuristic ─────────────────────────────
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

// ── System prompt — Stage 1: MVHR Room Classification Engine ──
const SYSTEM_PROMPT = `You are an MVHR room classification engine.
Analyse the residential floor plan and classify every identified space.
Do NOT perform airflow calculations, diffuser sizing, duct sizing, balancing or equipment selection.
Return structured JSON only.

════ MVHR AIR MOVEMENT PRINCIPLE ════
Supply rooms → Transfer areas → Extract rooms
Supply = habitable rooms where occupants spend extended time.
Extract = moisture-producing or odour-producing rooms.
Transfer = circulation spaces that allow air movement between supply and extract.
Ignore = non-habitable service spaces with no dedicated ventilation.

════ STEP 1: READ EVERY ROOM LABEL ════
Scan the entire plan. List every labelled space. Use the exact text visible as "labelSeen".
Do NOT return empty rooms[]. If a label is unclear, use a generic name and set confidence 0.5.
Omitting rooms is an error.

These words MUST appear in rooms[] if visible on the plan:
  Kitchen  Scullery  Pantry  Butler's Pantry
  Living  Lounge  Dining  Meals  Family  Rumpus  Theatre  Media  Activity  Retreat  Sitting
  Bedroom  Master  Bed  Study  Office  Library  Playroom  Gym  Sunroom
  Bath  Bathroom  Ensuite  WC  Powder  Toilet  Laundry  Mudroom  Utility
  Entry  Hall  Hallway  Passage  Corridor  Lobby  Landing  Stair
  WIR  Store  Garage  Alfresco  Verandah  Porch  Carport

Rooms labelled with a person's name (PAUL, JANE, TOM etc.) are bedrooms — classify as supply.

════ STEP 2: CLASSIFY EACH ROOM ════

SUPPLY — habitable rooms where occupants spend extended periods:
  Bedroom  Master Bedroom  Guest Bedroom  Living Room  Lounge  Family Room  Dining Room
  Rumpus Room  Media Room  Study  Home Office  Library  Playroom  Retreat  Sitting Room
  Activity Room  Multi-Purpose Room  Multi-Use Room  Home Theatre  Sunroom

EXTRACT — moisture or odour-producing rooms:
  Kitchen  Butler's Pantry  Walk-in Pantry  Scullery  Bathroom  Ensuite  Powder Room
  WC  Toilet  Laundry  Mudroom (with laundry)  Utility Room (with wet fixtures)
  Gym (always extract — elevated moisture, CO₂ and odour load)
  Pantry/Scullery/Butler's Pantry — always extract even without visible sink

TRANSFER — circulation spaces:
  Hallway  Corridor  Passage  Entry  Foyer  Stairwell  Landing

IGNORE — non-habitable service spaces:
  Garage  Carport  Plant Room  Mechanical Room  Electrical Room  HRV/MVHR cupboard
  Roof Space  Attic  Underfloor Void  Lift Shaft  Bin Store
  Outdoor: Balcony  Verandah  Alfresco  Porch  Deck  Courtyard

WALK-IN ROBES — classify as transfer. If ≥ 4 m² and attached to a bedroom, set optionalSupply true.
STORES — classify as transfer + set optionalExtract true (balancing flexibility). Tiny stores < 2 m² = ignore.
JOINERY (BIR/CPD/linen/cupboards) — these are NOT rooms. Do not list them as room entries.

Set "roomType" to exactly one of:
  Supply:   "Single Bedroom"  "Double Bedroom"  "Master Bedroom"  "Study / Office"
            "Living Room"  "Dining Room"  "Rumpus Room"  "Other"
  Extract:  "Kitchen"  "Bathroom"  "Ensuite"  "Laundry"  "WC"  "Pantry"  "Other"
  Transfer: "Hallway"  "Entry"  "Corridor"  "Other"
  Ignore:   "WIR"  "Garage"  "Porch"  "Carport"  "Alfresco"  "Store"  "Other"

════ STEP 3: IDENTIFY FIXTURES IN EVERY ROOM ════
Do NOT rely only on the room label. Visually inspect the interior of EVERY room for drawn symbols.

Look for these drawn elements against the walls inside each room:
  • Sink — rectangular or D-shaped outline on a benchtop or wall
  • Basin — circular or oval outline, usually wall-mounted
  • Vanity — benchtop with one or two basin outlines
  • Shower recess — square/rectangular zone with drain circle
  • Toilet / WC — elongated oval or rectangular symbol
  • Laundry tub — deep square/rectangular tub
  • Kitchenette — short joinery run with a sink outline

Small fixtures are drawn as simple outlines and easy to miss. Check every wall.
Inspect these room types carefully even if not labelled as wet rooms:
  Multi-Use Room  Study  Office  Utility  Workshop  Studio  Store  Mudroom
  Retreat  Activity  Rumpus  Gym  Cellar  Bar  Scullery  Pantry

WET FIXTURES → add to fixtures[] AND set classification "extract":
  sink  basin  vanity  toilet  wc  urinal  shower  laundry tub  utility sink
  kitchen sink  bar sink  prep sink  trough  kitchenette

DRY FIXTURES → add to fixtures[] for information only, do NOT change classification:
  oven  cooktop  fridge  dishwasher

MOISTURE FIXTURES → add to fixtures[], do NOT trigger extract alone:
  bath  freestanding bath  spa bath  sauna
  If a habitable (supply) room contains only moisture fixtures and no wet fixtures:
    → keep classification = "supply"
    → set containsSecondaryExtractZone = true

FIXTURE RULE — highest priority, overrides room name:
  Any wet fixture present                          → classification = "extract"
  Oven / cooktop / fridge / dishwasher alone       → no change
  Bath / spa / sauna alone in habitable room       → supply + containsSecondaryExtractZone true
  Bath + shower in any room                        → extract
  Bath + toilet in any room                        → extract

Examples:
  Bedroom + freestanding bath only  = supply + containsSecondaryExtractZone true
  Master Suite + spa bath only      = supply + containsSecondaryExtractZone true
  Bedroom + bath + shower           = extract
  Bedroom + bath + toilet           = extract
  Multi-Use Room + sink             = extract
  Bedroom + shower (no bath)        = extract
  Rumpus + fridge only              = supply
  Store + laundry tub               = extract
  Retreat + spa bath only           = supply + containsSecondaryExtractZone true

════ ZONE-WITHIN-ZONE ════
Some rooms contain two ventilation functions. Preserve the primary classification and set
"containsSecondaryExtractZone": true so Stage 2 can allocate a secondary extract terminal.

BEDROOM WITH BATH (no shower or toilet present):
  → classification = "supply"
  → containsSecondaryExtractZone = true
  Rationale: a freestanding bath, spa bath or soaking tub does not produce sustained moisture
  the way a shower or toilet does. The room's primary function remains habitable supply.
  Examples:
    Bedroom + freestanding bath only → supply + containsSecondaryExtractZone true
    Master Suite + bath              → supply + containsSecondaryExtractZone true
    Retreat + spa bath               → supply + containsSecondaryExtractZone true

BEDROOM WITH BATH + SHOWER OR TOILET:
  → classification = "extract"  (wet fixture takes priority)
  Examples:
    Bedroom + bath + shower  → extract
    Bedroom + bath + toilet  → extract

BEDROOM WITH OPEN ENSUITE (no physical door):
  → classification = "supply"
  → containsSecondaryExtractZone = true
  The intended air path is supply → bedroom → ensuite → extract.

════ CONFIDENCE ════
0.95+ = clear  |  0.85–0.95 = likely  |  0.70–0.85 = inferred  |  < 0.70 = uncertain

════ RESPONSE FORMAT ════
Return ONLY valid JSON. No markdown. No prose.

{
  "rooms": [
    { "name": "Master Bedroom", "labelSeen": "MASTER BED",
      "roomType": "Master Bedroom", "classification": "supply",
      "area": 19.2, "confidence": 0.94,
      "fixtures": [], "containsSecondaryExtractZone": false },
    { "name": "Kitchen", "labelSeen": "KITCHEN",
      "roomType": "Kitchen", "classification": "extract",
      "area": 16.4, "confidence": 0.97,
      "fixtures": ["sink", "dishwasher"], "containsSecondaryExtractZone": false },
    { "name": "Multi-Use Room", "labelSeen": "MULTI USE",
      "roomType": "Other", "classification": "extract",
      "area": 12.0, "confidence": 0.85,
      "fixtures": ["sink"], "containsSecondaryExtractZone": false },
    { "name": "Rumpus Room", "labelSeen": "RUMPUS",
      "roomType": "Rumpus Room", "classification": "supply",
      "area": 22.0, "confidence": 0.95,
      "fixtures": ["fridge"], "containsSecondaryExtractZone": false },
    { "name": "Walk-in Robe", "labelSeen": "WIR",
      "roomType": "WIR", "classification": "transfer",
      "area": 5.5, "confidence": 0.92,
      "fixtures": [], "containsSecondaryExtractZone": false }
  ],
  "warnings": [],
  "assumptions": []
}`;

// ── Stage 2 recovery prompt ────────────────────────────────────
// Used only when Stage 1 returns no rooms on a plan that appears readable.
// Same schema as Stage 1 but explicitly named as recovery to reduce cognitive overlap.
const ROOM_RECOVERY_PROMPT = `You are reading an architectural floor plan.
Stage 1 analysis returned no rooms. Your job is to recover the room schedule.
Apply the same MVHR classification rules as Stage 1.

Read every visible room label. Use the exact text as "labelSeen".
Do not return joinery, BIR, CPD, linen or shelf outlines as rooms.
Estimate area (m²) if visible. Use confidence 0.5 for uncertain rooms.
Rooms labelled with a person's name (PAUL, JAN, JANE etc.) are bedrooms — classify as supply.

CLASSIFICATION:
  supply   — bedroom, living, dining, study, rumpus, family, theatre, media, retreat, lounge,
             activity, multi-use, multi-purpose, office, library, playroom, sunroom
  extract  — kitchen, scullery, butler's pantry, pantry, bathroom, ensuite, WC, powder,
             toilet, laundry, mudroom, utility, gym
  transfer — entry, hall, hallway, passage, corridor, lobby, landing, stair
  ignore   — garage, carport, alfresco, verandah, porch, deck, outdoor areas,
             plant room, electrical room, HRV/MVHR cupboard, HWS, bin store
  WIR      — transfer (set optionalSupply true if ≥ 4 m²)
  Store    — transfer + optionalExtract true (ignore if < 2 m²)

FIXTURE INSPECTION — do NOT rely on room labels for plumbing:
Inspect every room interior for drawn symbols against walls.
Wet fixtures → add to fixtures[] AND set classification "extract":
  sink  basin  vanity  toilet  wc  urinal  shower  laundry tub  utility sink  trough  kitchenette
Dry fixtures → add to fixtures[] only, do NOT change classification:
  oven  cooktop  fridge  dishwasher
Moisture fixtures → add to fixtures[], only trigger extract if shower or toilet also present:
  bath  freestanding bath  spa  sauna

If a bedroom has an open ensuite zone, set "containsSecondaryExtractZone": true.

Return ONLY valid JSON. No markdown. No prose.

{
  "rooms": [
    { "name": "Master Bedroom", "labelSeen": "MASTER BED",
      "roomType": "Master Bedroom", "classification": "supply",
      "area": 18.0, "confidence": 0.8,
      "fixtures": [], "containsSecondaryExtractZone": false },
    { "name": "Kitchen", "labelSeen": "KITCHEN",
      "roomType": "Kitchen", "classification": "extract",
      "area": 14.0, "confidence": 0.9,
      "fixtures": ["sink", "dishwasher"], "containsSecondaryExtractZone": false }
  ],
  "warnings": [],
  "assumptions": []
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

  // ── Collect AI warnings and assumptions ─────────────────────
  if (Array.isArray(parsed.warnings)) {
    for (const w of parsed.warnings) {
      if (typeof w === 'string' && w.trim()) warnings.push(w.trim());
    }
  }
  const assumptions = Array.isArray(parsed.assumptions)
    ? parsed.assumptions.filter(a => typeof a === 'string' && a.trim()).map(a => a.trim())
    : [];

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
      assumptions,
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
    assumptions,
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
    assumptions,
    model:                  MODEL,
    inputTokens:            totalInputTokens,
    outputTokens:           totalOutputTokens,
    creditsDeducted:        deductErr ? 0 : creditCost,
    newBalance:             newBalance ?? null,
    logId:                  logRow?.id  ?? null,
    logError:               logErr?.message ?? null,
  });
}
