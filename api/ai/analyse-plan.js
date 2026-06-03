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
//   imageData    string   optional — base64-encoded image (if sending inline, ≤1 MB)
//   imageUrl     string   optional — signed Supabase Storage URL (alternative to imageData)
//   storagePath  string   optional — Supabase Storage path, e.g. "plan-uploads/temp/<uid>/<file>"
//                                    preferred for files >1 MB (avoids Vercel 4.5 MB body limit)
//   mimeType     string   optional — 'image/png' | 'image/jpeg' | 'image/webp' (default 'image/png')
//   climateZone  string   optional — override / pre-filled climate zone
//   pdfUploadId     string   optional — RESERVED: future UUID referencing a processed PDF upload record;
//                                       currently a no-op, accepted for forward-compatibility
//   hiresImagePath  string   optional — Storage path for the hi-res PNG rendered by render-hires.js.
//                                       Supplied by auto-analyse; takes priority over pdf_pages.image_path
//                                       when pdfPageId is also set.
//
// Exactly one of imageData, imageUrl, or storagePath must be provided.
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
//                  classificationReason, parentRoom, terminalPriority, spaceType }],
//                  terminalPriority: 'high' | 'medium' | 'low' | 'none'
//                  spaceType: 'bedroom' | 'living' | 'dining' | 'kitchen' | 'kitchenette' |
//                             'wet_area' | 'laundry' | 'office' | 'gym' | 'robe' |
//                             'circulation' | 'service' | 'other'
//                  airflowDriver: 'occupancy' | 'area' | 'fixed_extract' | 'transfer' | 'optional'
//                  requiresManualReview: boolean — ambiguous room with no detected fixtures
//                  bedSpaces: number (permanent sleeping capacity; 0 for non-bedrooms)
//                  potentialBedSpaces: number (convertible rooms; 0 if not applicable)
// Top-level response also includes:
//   occupancySummary:  { suggestedOccupancy, totalBedSpaces, potentialAdditionalBedSpaces }
//   reviewCandidates:  [{ room, reason, roomBoundaryHint }]
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

// Robust JSON extraction — strips markdown fences, then finds the first
// valid {...} or [...] block if direct parse fails.
function extractJson(text) {
  let s = stripMarkdown(text);
  try { return JSON.parse(s); } catch (_) {}
  const fb = s.indexOf('{'), fb2 = s.indexOf('[');
  let start = -1;
  if (fb !== -1 && (fb2 === -1 || fb < fb2)) start = fb;
  else if (fb2 !== -1) start = fb2;
  if (start === -1) throw new SyntaxError('No JSON structure found');
  const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (end < start) throw new SyntaxError('Malformed JSON');
  return JSON.parse(s.slice(start, end + 1));
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

  // parentRoom: name of the primary room this zone was split from (secondary zones only)
  const parentRoom = typeof raw.parentRoom === 'string' && raw.parentRoom.trim()
    ? raw.parentRoom.trim()
    : null;

  // spaceType: functional space category used by the sizing engine for airflow lookup.
  const SPACE_TYPE_VALUES = new Set([
    'bedroom','living','dining','kitchen','kitchenette','wet_area','laundry',
    'office','gym','robe','circulation','service','other',
  ]);
  const rawSpaceType = typeof raw.spaceType === 'string'
    ? raw.spaceType.toLowerCase().trim() : null;
  // Fallback: infer from roomType when AI doesn't set it
  const ROOM_TYPE_TO_SPACE_TYPE = {
    'Single Bedroom':  'bedroom',  'Double Bedroom': 'bedroom',
    'Master Bedroom':  'bedroom',  'Study / Office': 'office',
    'Living Room':     'living',   'Dining Room':    'dining',
    'Rumpus Room':     'living',   'Other':          'other',
    'Kitchen':         'kitchen',  'Bathroom':       'wet_area',
    'Ensuite':         'wet_area', 'Laundry':        'laundry',
    'WC':              'wet_area', 'Pantry':         'kitchen',
    'Hallway':         'circulation', 'Entry':        'circulation',
    'Corridor':        'circulation', 'WIR':          'robe',
    'Garage':          'service',  'Porch':          'service',
    'Carport':         'service',  'Alfresco':       'service',
    'Store':           'service',
  };
  const spaceType = SPACE_TYPE_VALUES.has(rawSpaceType)
    ? rawSpaceType
    : ROOM_TYPE_TO_SPACE_TYPE[resolvedType] ?? 'other';

  // airflowDriver: sizing methodology for the calculation stage.
  const AIRFLOW_DRIVER_VALUES = new Set(['occupancy','area','fixed_extract','transfer','optional']);
  const rawDriver = typeof raw.airflowDriver === 'string'
    ? raw.airflowDriver.toLowerCase().trim() : null;
  // Fallback: derive from spaceType when AI doesn't set it
  const SPACE_TYPE_TO_DRIVER = {
    bedroom:     'occupancy',   living:       'occupancy',
    dining:      'area',        kitchen:      'fixed_extract',
    kitchenette: 'fixed_extract', wet_area:   'fixed_extract',
    laundry:     'fixed_extract', office:     'occupancy',
    gym:         'occupancy',   robe:         'optional',
    circulation: 'transfer',    service:      'optional',
    other:       'occupancy',
  };
  const airflowDriver = AIRFLOW_DRIVER_VALUES.has(rawDriver)
    ? rawDriver
    : SPACE_TYPE_TO_DRIVER[spaceType] ?? 'occupancy';

  // requiresManualReview: true when the AI completed inspection but fixture presence is uncertain.
  const requiresManualReview = raw.requiresManualReview === true;

  // bedSpaces / potentialBedSpaces: occupancy estimation (not ventilation classification).
  const bedSpaces          = typeof raw.bedSpaces === 'number' && raw.bedSpaces >= 0
    ? Math.round(raw.bedSpaces) : (spaceType === 'bedroom' ? 2 : 0);
  const potentialBedSpaces = typeof raw.potentialBedSpaces === 'number' && raw.potentialBedSpaces >= 0
    ? Math.round(raw.potentialBedSpaces) : 0;

  // terminalPriority: design-stage hint for terminal allocation.
  // 'high'   — normally requires its own dedicated terminal
  // 'medium' — often has its own terminal but may share
  // 'low'    — terminal optional, used for balancing or project-specific reasons
  // 'none'   — normally no terminal (hallways, circulation, service spaces)
  // AI may set this; falls back to a sensible default derived from ventClass.
  const TERMINAL_PRIORITY_VALUES = new Set(['high','medium','low','none']);
  const rawPriority = typeof raw.terminalPriority === 'string'
    ? raw.terminalPriority.toLowerCase().trim() : null;
  const terminalPriority = TERMINAL_PRIORITY_VALUES.has(rawPriority)
    ? rawPriority
    : ventClass === 'supply'   ? 'high'
    : ventClass === 'extract'  ? 'high'
    : ventClass === 'transfer' ? 'none'
    : 'none';

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
    parentRoom,
    terminalPriority,
    spaceType,
    airflowDriver,
    bedSpaces,
    potentialBedSpaces,
    requiresManualReview,
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
//   0.  Ambiguous label + no fixtures → requiresManualReview=true, confidence capped at 0.85
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

    // ── 0. Ambiguous label + no fixtures → requiresManualReview ──
    // Applied before all classification rules so every downstream path inherits the flag.
    const AMBIGUOUS_LABEL_PATTERNS = [
      /\bmulti.?use\b/i, /\bmulti.?purpose\b/i, /\bmpr\b/i,
      /\bstudio\b/i,     /\bretreat\b/i,         /\bactivity\b/i,
      /\boffice\b/i,     /\bhome office\b/i,      /\brumpus\b/i,
      /\bgym\b/i,        /\bworkshop\b/i,         /\bhobby\b/i,
      /\bcellar\b/i,     /\bgames\b/i,
    ];
    if (
      AMBIGUOUS_LABEL_PATTERNS.some(p => p.test(name)) &&
      (!Array.isArray(room.fixtures) || room.fixtures.length === 0)
    ) {
      room.requiresManualReview = true;
      if (room.confidence != null && room.confidence > 0.85) room.confidence = 0.85;
      warnings.push(`"${name}" — ambiguous room type with no fixtures detected. Flagged for manual review.`);
    }

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

IMPORTANT:
Missing a fixture is worse than incorrectly identifying a fixture.
When uncertain whether a sink, basin, kitchenette or laundry tub exists, inspect the room
again before classifying.

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

════ HABITABLE ROOM KITCHENETTE RULE ════
If a habitable room contains a sink AND cabinetry or a benchtop:
  → Treat the space as a kitchenette zone.
  → classification  = "extract"
  → spaceType       = "kitchenette"
  → airflowDriver   = "fixed_extract"
  → terminalPriority = "medium"
  → Reason: food preparation and appliance use generate moisture, odours and contaminants.

Applies to:
  Multi-Use Room  Studio  Retreat  Activity Room  Rumpus  Office  Guest Room
  Any habitable room not normally expected to contain a sink.

Confidence guidance:
  Sink + visible cabinetry or benchtop → high confidence kitchenette → extract
  Sink only (no visible cabinetry)     → still classify as extract, add assumption:
    "Sink detected without visible cabinetry — classified as extract pending manual review."

spaceType distinction:
  "kitchen"     — dedicated kitchen room (primary food preparation space)
  "kitchenette" — habitable room with sink and cabinetry (secondary/incidental food prep)

Both use airflowDriver = "fixed_extract", but kitchenette → terminalPriority "medium"
vs kitchen → terminalPriority "high".

════ MANDATORY INSPECTION OF AMBIGUOUS ROOMS ════
The following room types MUST undergo a detailed visual inspection before classification.
Do NOT classify these rooms based on the room label alone:

  Multi-Use Room  Multi-Purpose Room  MPR  Activity Room  Retreat  Rumpus  Games Room
  Studio  Gym  Cellar  Bar  Home Office  Office  Study  Workshop  Utility Room
  Craft Room  Hobby Room  Theatre  Media Room  Bonus Room  Flex Room  Sunroom

Before assigning a ventilation classification to any of these rooms:
  1. Inspect every wall of the room for drawn fixtures or joinery.
  2. Inspect all joinery runs — look for a sink bowl outline embedded in a benchtop.
  3. Look for plumbing symbols: circles (basin), rectangles (sink/tub), elongated ovals (toilet).
  4. Look for shower recess outlines — square/rectangular zone with a small circle (drain).
  5. Look for a laundry tub — deep square tub, often in a corner or against a wall.
  6. Check whether any benchtop runs along a wall that could conceal a kitchenette.
  7. Inspect corners and alcoves — wet fixtures are often placed out of the main circulation path.
  8. Look for a second label inside the room (e.g. "BAR SINK", "LAUNDRY TUB", "WC").
  9. Check for tile hatching patterns — often used to mark wet zones within a room.
  10. If any ambiguity remains, report the room at the HIGHER sensitivity level (i.e. include the fixture in fixtures[] rather than omitting it).

Mandatory Fixture Search:
  For every room in the ambiguous list above, explicitly check for and report:
    • Sink or basin of any kind (bar sink, prep sink, utility sink, kitchenette)
    • Shower recess or cubicle
    • Toilet or WC
    • Laundry tub or utility tub
    • Vanity unit

Visual Recognition Guidance:
  Sink / basin  — D-shaped or rectangular cutout in a benchtop line; may have a small + or circle for the drain
  Vanity        — benchtop line with one or two basin outlines; often shown with a mirror symbol above
  Shower        — square or rectangular outline, dashed or solid, with a drain circle inside
  Toilet / WC   — elongated oval (pan) attached to a smaller rectangle (cistern)
  Laundry tub   — square or near-square deep tub, usually in a corner, larger than a basin
  Kitchenette   — short joinery run (< 2 m) with a visible sink cutout; may include a small fridge symbol

Multi-Use Room Special Rule:
  A room labelled "Multi-Use", "Multi-Purpose", "MPR", "Activity", "Flex" or similar
  has a high probability of containing a kitchenette, bar sink or laundry tub.
  These fixtures are frequently installed in such rooms and are easy to miss on small-scale plans.
  ALWAYS look twice inside these rooms before deciding no wet fixture is present.

Second Inspection Pass — Mandatory:
  Before finalising any Multi-Use Room, MPR, Gym, Retreat, Studio, Office or Activity Room:
    Perform a second dedicated inspection pass of that room only.
    Do not rely on the first scan.
    Many fixtures are small, partially obscured, located within joinery, or located inside
    connected alcoves.

Hidden Wet-Area Detection:
  Pay particular attention to:
    • Rooms labelled "By Owner"
    • Unlabelled alcoves attached to an ambiguous room
    • Joinery recesses and built-in joinery runs
    • Small rooms or spaces connected to a Multi-Use Room
    • Rooms behind sliding doors or without a labelled door
    • Spaces connected to an ambiguous room without a physical door
  These frequently contain ensuites, powder rooms, kitchenettes, utility areas or laundry facilities.
  If such a space is found, inspect it for wet fixtures and include it as a separate room entry.

Evidence Hierarchy — most important rule:
  For ambiguous rooms:
    Room label   = weak evidence
    Fixtures     = strong evidence
  Always trust visible fixtures over room names.
  A room named "Activity Room" with a visible sink is EXTRACT, not supply.
  A room named "Gym" with no visible wet fixtures remains extract (elevated moisture load).
  A room named "Study" with a visible sink is EXTRACT.

Confidence Penalty:
  If an ambiguous room is classified without any detected fixtures:
    Maximum confidence = 0.90
    Confidence above 0.90 is only permitted when all walls, joinery and connected spaces
    are clearly visible and have been inspected in the second pass.

Assumptions Requirement:
  If an ambiguous room is classified as supply after inspection, add an entry to assumptions[]:
    "Multi-Use Room classified as supply. No sink, basin, shower, toilet, kitchenette or
    laundry fixtures detected after detailed inspection."
  If an ambiguous room is classified as extract due to a fixture, add an entry to assumptions[]:
    "Multi-Use Room reclassified as extract. Sink detected during second inspection pass."
  This creates an audit trail showing what the model inspected and why it classified as it did.

Manual Review Flag:
  If you have completed the second inspection pass of an ambiguous room and still cannot
  confirm whether wet fixtures are present:
    → Set "requiresManualReview": true on that room entry.
    → Do NOT confidently assign classification = "supply" in this state.
    → Keep the classification as your best estimate but record the uncertainty.
    → Add an assumption: "Multi-Use Room flagged for manual review — fixture presence uncertain
      after two inspection passes."
  If you are confident no fixtures are present after the second pass:
    → Set "requiresManualReview": false.
    → Add an assumption confirming what was inspected.
  The default value is false. Only set true when genuine uncertainty remains after inspection.

Warning Requirement:
  If you inspect a room from the ambiguous list and find no fixtures, add a note in assumptions[]:
    e.g. "Inspected Multi-Use Room — no wet fixtures visible; classified as supply."
  If you find a fixture, list it in fixtures[] and add a note in assumptions[]:
    e.g. "Multi-Use Room contains a sink — reclassified as extract."

════ AMBIGUOUS ROOM ESCALATION ════
If a room is classified as any of the following AND no fixtures are confidently identified:
  Multi-Use Room  Studio  Activity Room  Retreat  Rumpus  Gym  Home Office
  Workshop  Hobby Room  Cellar  Games Room  Unlabelled habitable room

THEN you MUST:
  → Set "requiresManualReview": true
  → Set confidence to no more than 0.85
  → Add an assumption explaining why, e.g.:
    "Multi-Use Room inspected. No fixtures confidently identified. Drawing scale prevents
    confirmation of kitchenette or wet-area fixtures. Manual review recommended."

NEVER confidently classify an ambiguous room as supply solely because no fixture was detected.
Absence of evidence is not evidence of absence.

════ FIXTURE VISIBILITY RULE ════
Distinguish between three states — do not collapse them:
  1. Fixture confidently identified  → list in fixtures[], classify accordingly
  2. Fixture possibly present         → list in fixtures[] with note "possible", set requiresManualReview true,
                                        add warning: "Possible kitchenette or wet-area fixture detected
                                        but could not be confirmed."
  3. No fixture visible after full inspection → fixtures: [], requiresManualReview depends on room type

If a fixture is only partially visible or resolution is insufficient:
  Do NOT assume it is absent.
  Set requiresManualReview = true and add a warning.

════ REVIEW CANDIDATES ════
Return a top-level "reviewCandidates" array listing every room that requires further human review.
Only include rooms where fixture presence is uncertain or the room type is ambiguous.

For each candidate, include:
  "room"             — exact room name as it appears in rooms[]
  "reason"           — why this room requires review (one sentence)
  "roomBoundaryHint" — plain-language description of where the room sits on the plan,
                       to support a future room-crop AI pass.
                       Example: "Lower-right corner adjacent Laundry and Entry"

Example output:
"reviewCandidates": [
  {
    "room": "Multi-Use Room",
    "reason": "Possible kitchenette. Fixture visibility insufficient at this drawing scale.",
    "roomBoundaryHint": "Lower-right corner of floor plan, adjacent to Laundry and Entry"
  },
  {
    "room": "Studio",
    "reason": "Sink symbol partially visible on north wall. Could not confirm.",
    "roomBoundaryHint": "Upper-left area, adjacent to Master Bedroom"
  }
]

If no rooms require review: "reviewCandidates": []

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

════ ROOM SPLITTING RULE ════
Some architectural spaces contain multiple ventilation zones.
If a room contains a clearly identifiable wet area that would normally be classified differently
to the main room — do NOT classify the entire room using a single ventilation classification.

Instead:
  1. Create the primary room entry using the dominant room function.
  2. Create a separate secondary zone entry for the wet area.
  3. Set containsSecondaryExtractZone = true on the primary room entry.
  4. Set "parentRoom" on the secondary zone entry to the primary room's name.
  5. Add a warning describing the split.

Examples:
  Bedroom + freestanding bath       → Bedroom (supply, containsSecondaryExtractZone true)
                                       Bath Zone (extract, parentRoom "Bedroom")
  Bedroom + ensuite                 → Bedroom (supply, containsSecondaryExtractZone true)
                                       Ensuite (extract, parentRoom "Bedroom")
  Gym + shower                      → Gym (extract — elevated CO₂/moisture load)
                                       Shower Zone (extract, parentRoom "Gym")
  Retreat + wet bar                 → Retreat (supply, containsSecondaryExtractZone true)
                                       Wet Bar Zone (extract, parentRoom "Retreat")
  Studio + kitchenette              → Studio (supply, containsSecondaryExtractZone true)
                                       Kitchenette Zone (extract, parentRoom "Studio")
  Living / Kitchen open-plan        → Living (supply)
                                       Kitchen Zone (extract, parentRoom "Living")

NEVER convert an entire habitable room to extract simply because a smaller wet area exists within it.
The primary room's classification must reflect its dominant occupancy function.

════ OPEN PLAN AIRFLOW ZONE RULE ════
Architectural rooms and ventilation zones are not always the same thing.
The objective is to identify airflow zones, not simply room names.
Large open-plan spaces frequently contain multiple ventilation zones with different functions.

Examples:
  Living / Dining / Kitchen
    → Living Room    = supply zone
    → Dining         = supply zone
    → Kitchen        = extract zone

  Living / Dining / Kitchen / Scullery
    → Living Room    = supply zone
    → Dining         = supply zone
    → Kitchen        = extract zone
    → Scullery       = extract zone

  Master Suite
    → Bedroom        = supply zone
    → Ensuite        = extract zone
    → WIR            = transfer zone

  Gym + Shower
    → Gym            = supply zone (CO₂/moisture load — see also Gym rule)
    → Shower Zone    = extract zone

  Retreat + Wet Bar
    → Retreat        = supply zone
    → Wet Bar Zone   = extract zone

  Studio + Kitchenette
    → Studio         = supply zone
    → Kitchenette    = extract zone

When a single architectural space contains areas that would normally receive different classifications:
  1. Split the space into airflow zones.
  2. Create a separate room object for each zone.
  3. Assign the correct ventilation classification to each zone.
  4. Link secondary zones using "parentRoom" set to the architectural room name.
  5. Add a warning describing the split.

Do NOT classify an entire open-plan area as supply or extract simply because one portion of the
space contains a wet area. Always classify based on airflow function.

════ AIRFLOW ZONE HIERARCHY ════
When determining ventilation classification, apply in this order:
  1. Visible fixtures   (highest priority — overrides everything)
  2. Room function      (gym, pantry, laundry always extract regardless of label)
  3. Architectural layout (open plan — split at the wet zone boundary)
  4. Room label         (lowest priority — use only when nothing else is visible)

Visible fixtures always override room labels:
  Room labelled "Studio"         + sink          → extract zone
  Room labelled "Multi-Use Room" + shower        → extract zone
  Room labelled "Retreat"        + kitchenette   → extract zone
  Room labelled "Bedroom"        + bath only     → supply zone + secondary extract zone
  Room labelled "Living"         + kitchen bench → split: living = supply, kitchen = extract

The objective is to identify the airflow zones that will ultimately receive MVHR terminals.
Every zone should represent a distinct airflow destination, not simply a room name.

════ ZONE OUTPUT FORMAT ════
Each zone is a room entry in the rooms[] array.
Secondary zones created by splitting must set "parentRoom" to the architectural room name.
Set "terminalPriority" per the TERMINAL PRIORITY RULE above.

Example output for open-plan Living / Dining / Kitchen:
  { "name": "Living Room", "classification": "supply",  "parentRoom": null,                       "terminalPriority": "high" }
  { "name": "Dining",      "classification": "supply",  "parentRoom": "Living / Dining / Kitchen", "terminalPriority": "high" }
  { "name": "Kitchen",     "classification": "extract", "parentRoom": "Living / Dining / Kitchen", "terminalPriority": "high" }

Example output for Master Suite:
  { "name": "Master Bedroom",           "classification": "supply",  "parentRoom": null,             "terminalPriority": "high", "containsSecondaryExtractZone": true }
  { "name": "Master Bedroom - Ensuite", "classification": "extract", "parentRoom": "Master Bedroom", "terminalPriority": "high" }

Example output for Pantry adjacent to Kitchen:
  { "name": "Kitchen", "classification": "extract", "parentRoom": null,      "terminalPriority": "high" }
  { "name": "Pantry",  "classification": "extract", "parentRoom": "Kitchen", "terminalPriority": "low"  }

Do NOT create separate zones for:
  Hallways  Corridors  Small cupboards  Joinery  Storage recesses
unless they independently require a ventilation terminal.

════ TERMINAL PRIORITY RULE ════
Not all airflow zones require their own MVHR terminal.
For every zone, assign a "terminalPriority" value reflecting normal MVHR design practice —
not project-specific decisions, which are made at the sizing stage.

HIGH — normally requires its own dedicated terminal:
  Bedroom  Master Bedroom  Living Room  Lounge  Dining Room  Family Room
  Kitchen  Bathroom  Ensuite  WC  Powder Room  Toilet  Laundry

MEDIUM — often has its own terminal but may share airflow with an adjacent zone:
  Gym  Home Office  Study  Multi-Use Room  Retreat  Activity Room  Studio  Rumpus  Media Room

LOW — terminal optional; used for balancing or project-specific reasons:
  Pantry  Scullery  Walk-in Pantry  Butler's Pantry
  Walk-in Robe (WIR)  Dressing Room  Internal Store

NONE — normally no terminal:
  Hallway  Corridor  Entry  Foyer  Stair  Landing
  Mudroom  Porch  Small Cupboard  Joinery  Plant Room  Garage  Outdoor areas

terminalPriority reflects whether a zone would typically receive a terminal in a standard
MVHR design. It does NOT mean a terminal is mandatory — the sizing engine will decide that
based on airflow balance, room volume and project requirements.

════ SPACE TYPE RULE ════
For every airflow zone, assign a "spaceType" that represents the functional use of the zone.
spaceType is used by the sizing engine to look up airflow rates and design rules.
Use the room function, not the room label.

  "bedroom"     — Bedroom  Master Bedroom  Guest Bedroom  Kids Bedroom  Personal room (named)
  "living"      — Living  Lounge  Family Room  Sitting Room  Retreat  Rumpus  Activity  Sunroom
                  Multi-Use Room  Multi-Purpose Room  Media Room  Games Room  Theatre  Home Theatre
                  Studio (no wet fixtures)
  "dining"      — Dining  Meals  Dining Room  Breakfast
  "kitchen"     — Kitchen  Scullery  Butler's Pantry  Walk-in Pantry  Pantry
  "kitchenette" — Habitable room with a sink + cabinetry (Multi-Use Room, Studio, Retreat, etc.)
                  See HABITABLE ROOM KITCHENETTE RULE for classification details.
  "wet_area"    — Bathroom  Ensuite  Powder Room  WC  Toilet
  "laundry"     — Laundry  Mudroom (with laundry fixtures)  Utility Room (with laundry fixtures)
  "office"      — Study  Office  Home Office  Library  Workroom
  "gym"         — Gym  Home Gym  Exercise Room
  "robe"        — Walk-in Robe (WIR)  Dressing Room  Wardrobe Room
  "circulation" — Hallway  Corridor  Entry  Foyer  Passage  Landing  Stair  Lobby
  "service"     — Store  Cupboard  Plant Room  Mechanical  Electrical  HWS  Garage  Carport
                  Bin Store  Roof Space  Attic  Outdoor areas
  "other"       — Any zone that does not clearly fit the above

Notes:
  • Pantry, Scullery and Butler's Pantry → "kitchen" (airflow calculated using kitchen extract rate)
  • WIR and Dressing Room → "robe" (transfer zone; low or no terminal)
  • A Retreat or Rumpus without wet fixtures → "living"
  • A Studio with a sink → spaceType "kitchen" (or "wet_area" if sink only), classification = extract
  • Mudroom without laundry fixtures → "circulation"

════ AIRFLOW DRIVER RULE ════
For every airflow zone assign an "airflowDriver".
The airflowDriver identifies which sizing methodology applies at the calculation stage.

  "occupancy"      — habitable rooms where airflow is primarily driven by occupants:
                     Bedroom  Master Bedroom  Guest Bedroom  Living Room  Lounge  Family Room
                     Retreat  Home Office  Study  Library  Multi-Use Room  Activity Room  Studio
                     Gym  Rumpus  Media Room  Playroom  Sunroom

  "area"           — larger habitable spaces where floor area influences the airflow rate:
                     Open-Plan Living  Dining Room  Meals  Dining  Large Family Room
                     (Use "area" instead of "occupancy" when the space is open-plan or > ~40 m²)

  "fixed_extract"  — wet rooms and service areas where extract rates are typically prescribed:
                     Kitchen  Scullery  Butler's Pantry  Pantry
                     Kitchenette (habitable room with sink + cabinetry)
                     Bathroom  Ensuite  WC  Powder Room  Toilet
                     Laundry  Mudroom (wet)  Utility Room (wet)

  "transfer"       — circulation spaces that move air between supply and extract zones:
                     Hallway  Corridor  Passage  Entry  Foyer  Stair  Landing  Lobby

  "optional"       — spaces that may receive airflow for balancing but are not compliance-required:
                     Walk-in Robe (WIR)  Dressing Room  Internal Store  Cupboard  Plant Room

Examples:
  Bedroom         → "occupancy"
  Living Room     → "occupancy"
  Open-Plan Living/Dining (> 40 m²) → "area"
  Dining Room     → "area"
  Kitchen         → "fixed_extract"
  Ensuite         → "fixed_extract"
  WC              → "fixed_extract"
  Laundry         → "fixed_extract"
  Pantry          → "fixed_extract"
  Hallway         → "transfer"
  Walk-in Robe    → "optional"
  Internal Store  → "optional"

════ BED SPACE DETECTION RULE ════
This is NOT a ventilation classification task.
This is an occupancy estimation task only.
Estimate likely sleeping capacity conservatively. The user will always be able to override values.

For every zone set "bedSpaces" and "potentialBedSpaces". Default both to 0.

PERMANENT BED SPACES — bedSpaces:
  Master Bedroom              → 2  (assume double unless clearly single-occupancy)
  Double Bedroom / Bedroom    → 2  (Bedroom 2, Bedroom 3, Guest Bedroom, Bedroom)
  Single / Child / Nursery    → 1  (Small Bedroom, Child's Room, Nursery, Baby's Room)
  All non-bedroom zones       → 0

CONVERTIBLE BED SPACES — potentialBedSpaces:
  A non-bedroom zone that has a door, appears to have a window, and is of suitable size
  (roughly ≥ 8 m²) may be suitable for future bedroom conversion:
    Study  Multi-Purpose Room  Multi-Use Room  Retreat  Studio  Activity Room
    → potentialBedSpaces = 1
  Add an assumption: "Multi-Use Room appears suitable for future bedroom conversion."
  All other zones: potentialBedSpaces = 0

ROOMS THAT ARE NOT BEDROOMS (bedSpaces = 0 unless fixtures suggest otherwise):
  Study  Home Office  Library  Retreat  Sitting Room  Media Room  Theatre
  Living Room  Lounge  Dining Room  Gym  Games Room  Activity Room
  Multi-Purpose Room  Multi-Use Room  Studio  Rumpus Room

PROJECT-LEVEL OCCUPANCY SUMMARY:
After listing all rooms[], add a top-level "occupancySummary" object:
  {
    "suggestedOccupancy":          <sum of all bedSpaces>,
    "totalBedSpaces":              <sum of all bedSpaces>,
    "potentialAdditionalBedSpaces":<sum of all potentialBedSpaces>
  }

Do not attempt to predict actual residents.
Only estimate available sleeping capacity.

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
      "spaceType": "bedroom", "airflowDriver": "occupancy",
      "area": 19.2, "confidence": 0.94, "terminalPriority": "high",
      "fixtures": [], "containsSecondaryExtractZone": false, "parentRoom": null,
      "bedSpaces": 2, "potentialBedSpaces": 0 },
    { "name": "Kitchen", "labelSeen": "KITCHEN",
      "roomType": "Kitchen", "classification": "extract",
      "spaceType": "kitchen", "airflowDriver": "fixed_extract",
      "area": 16.4, "confidence": 0.97, "terminalPriority": "high",
      "fixtures": ["sink", "dishwasher"], "containsSecondaryExtractZone": false, "parentRoom": null },
    { "name": "Multi-Use Room", "labelSeen": "MULTI USE",
      "roomType": "Other", "classification": "extract",
      "spaceType": "kitchen", "airflowDriver": "fixed_extract",
      "area": 12.0, "confidence": 0.85, "terminalPriority": "medium",
      "fixtures": ["sink"], "containsSecondaryExtractZone": false, "parentRoom": null },
    { "name": "Rumpus Room", "labelSeen": "RUMPUS",
      "roomType": "Rumpus Room", "classification": "supply",
      "spaceType": "living", "airflowDriver": "occupancy",
      "area": 22.0, "confidence": 0.95, "terminalPriority": "high",
      "fixtures": ["fridge"], "containsSecondaryExtractZone": false, "parentRoom": null },
    { "name": "Walk-in Robe", "labelSeen": "WIR",
      "roomType": "WIR", "classification": "transfer",
      "spaceType": "robe", "airflowDriver": "optional",
      "area": 5.5, "confidence": 0.92, "terminalPriority": "low",
      "fixtures": [], "containsSecondaryExtractZone": false, "parentRoom": null },
    { "name": "Master Bedroom", "labelSeen": "MASTER SUITE",
      "roomType": "Master Bedroom", "classification": "supply",
      "spaceType": "bedroom", "airflowDriver": "occupancy",
      "area": 22.0, "confidence": 0.93, "terminalPriority": "high",
      "fixtures": ["freestanding bath"], "containsSecondaryExtractZone": true, "parentRoom": null },
    { "name": "Master Bedroom - Bath Zone", "labelSeen": "FREESTANDING BATH",
      "roomType": "Bathroom", "classification": "extract",
      "spaceType": "wet_area", "airflowDriver": "fixed_extract",
      "area": 4.0, "confidence": 0.88, "terminalPriority": "high",
      "fixtures": ["freestanding bath"], "containsSecondaryExtractZone": false, "parentRoom": "Master Bedroom" }
  ],
  "warnings": ["Master Bedroom split: primary room supply, bath zone created as secondary extract."],
  "assumptions": ["Multi-Use Room appears suitable for future bedroom conversion."],
  "occupancySummary": {
    "suggestedOccupancy": 6,
    "totalBedSpaces": 6,
    "potentialAdditionalBedSpaces": 1
  }
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

AMBIGUOUS ROOM INSPECTION — inspect every wall before classifying:
  Multi-Use  Multi-Purpose  MPR  Activity  Retreat  Rumpus  Games  Studio  Gym  Cellar  Bar
  Office  Study  Workshop  Utility  Craft  Hobby  Theatre  Media  Flex  Sunroom
  For each: check every wall for sink, basin, vanity, shower, toilet, laundry tub, kitchenette.
  Tile hatching, benchtop runs with cutouts, and plumbing symbols count as fixture evidence.
  If fixture presence is uncertain, include it in fixtures[] (missing = worse than false positive).
  Add a note in assumptions[] for each ambiguous room you inspect.

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
  // Two auth paths:
  //   1. Internal (auto-analysis): x-internal-secret header + userId in body.
  //      Used by auto-analyse.js to run analysis in the background without a
  //      user's bearer token. Only accepted when INTERNAL_API_SECRET is set.
  //   2. Standard: Bearer token from Authorization header.
  let user;
  const internalSecret = req.headers['x-internal-secret'];
  const internalApiSecret = process.env.INTERNAL_API_SECRET;

  let internalCall = false;
  if (internalSecret && internalApiSecret && internalSecret === internalApiSecret) {
    // Internal call — trust userId from request body.
    const bodyUserId = req.body?.userId;
    if (!bodyUserId) return res.status(400).json({ error: 'userId required for internal auth' });
    user = { id: bodyUserId };
    internalCall = true;
  } else {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const { data: { user: authUser }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authUser) return res.status(401).json({ error: 'Invalid token' });
    user = authUser;
  }

  // ── Parse body ──────────────────────────────────────────────
  const {
    projectId,
    testMode     = false,
    floorIndex   = 0,
    imageData,        // base64 string — small images / backwards compat only
    imageUrl,         // signed external URL
    storagePath,      // Supabase Storage path — preferred for large files (avoids 413)
    mimeType      = 'image/png',
    pdfUploadId,      // UUID — links this call to a pdf_uploads row (audit trail)
    pdfPageId,        // UUID — when provided, image is resolved from pdf_pages.image_path
    hiresImagePath,   // Storage path for hi-res PNG (supplied by auto-analyse after render-hires)
                      // Takes priority over pdf_pages.image_path when pdfPageId is also set.
  } = req.body ?? {};

  // projectId is required for standard (user-facing) calls.
  // It is optional when:
  //   - testMode is true (admin test path)
  //   - internalCall is true (auto-analyse pipeline — pdfPageId/pdfUploadId identify the work)
  if (testMode) {
    const { data: adminProfile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();
    if (!adminProfile?.is_admin) {
      return res.status(403).json({ error: 'Admin access required for testMode' });
    }
  } else if (!internalCall) {
    if (!isUuid(projectId)) {
      return res.status(400).json({ error: 'Valid projectId (UUID) required' });
    }
  }

  // ── Resolve pdfPageId → storagePath ──────────────────────────────────────
  // When pdfPageId is provided the caller doesn't send an image directly.
  // Priority: hiresImagePath (250 DPI PNG from render-hires) > pdf_pages.image_path (72 DPI JPEG).
  let resolvedStoragePath = storagePath;

  if (pdfPageId) {
    // If auto-analyse already rendered hi-res, use it directly without a DB lookup.
    if (hiresImagePath) {
      // Hi-res PNG already rendered by render-hires — use it directly.
      resolvedStoragePath = hiresImagePath;
    } else {
      // Fall back to the low-res classification JPEG from pdf_pages.image_path.
      if (!isUuid(pdfPageId)) {
        return res.status(400).json({ error: 'pdfPageId must be a valid UUID' });
      }
      const { data: pageRow, error: pageErr } = await supabase
        .from('pdf_pages')
        .select('id, image_path, pdf_upload_id')
        .eq('id', pdfPageId)
        .single();

      if (pageErr || !pageRow) {
        return res.status(404).json({ error: 'pdfPageId not found' });
      }
      if (!pageRow.image_path) {
        return res.status(409).json({ error: 'Page image not yet rendered — poll job-status first' });
      }
      resolvedStoragePath = pageRow.image_path; // e.g. "plan-uploads/temp/<uid>/<jobId>/page_01.jpg"
    }
  }

  const sourceCount = [imageData, imageUrl, resolvedStoragePath].filter(Boolean).length;
  if (sourceCount === 0) {
    return res.status(400).json({ error: 'Provide pdfPageId, storagePath, imageUrl, or imageData (base64)' });
  }
  if (sourceCount > 1 && !pdfPageId) {
    // pdfPageId resolves to storagePath — only flag conflict for manual combinations
    return res.status(400).json({ error: 'Provide only one of: pdfPageId, storagePath, imageUrl, imageData' });
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
  // Priority: storagePath (preferred — no payload size limit) > imageUrl > imageData (legacy)
  let imageSource;

  if (resolvedStoragePath) {
    // Download directly from Supabase Storage server-side.
    // resolvedStoragePath is either the original storagePath or the image_path from pdf_pages.
    const bucket = resolvedStoragePath.split('/')[0];
    const path   = resolvedStoragePath.slice(bucket.length + 1);

    const { data: storageData, error: storageErr } = await supabase
      .storage
      .from(bucket)
      .download(path);

    if (storageErr || !storageData) {
      return res.status(400).json({ error: `Could not download from storage: ${storageErr?.message ?? 'unknown error'}` });
    }

    const buf = await storageData.arrayBuffer();
    if (buf.byteLength > MAX_IMAGE_BYTES) {
      return res.status(413).json({ error: `Image too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB)` });
    }

    // Infer MIME type from file extension in resolvedStoragePath
    const ext = path.split('.').pop().toLowerCase();
    const extMimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
    const resolvedMime = extMimeMap[ext] ?? safeMimeType;

    imageSource = {
      type:       'base64',
      media_type: resolvedMime,
      data:       Buffer.from(buf).toString('base64'),
    };

  } else if (imageData) {
    // Inline base64 — kept for backwards compatibility and small test images only.
    // For large images use storagePath to avoid Vercel's 4.5 MB body limit.
    const byteLen = Math.ceil((imageData.replace(/=/g,'').length) * 3 / 4);
    if (byteLen > MAX_IMAGE_BYTES) {
      return res.status(413).json({ error: `Image too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB). Upload via storagePath instead.` });
    }
    imageSource = { type: 'base64', media_type: safeMimeType, data: imageData };

  } else {
    // Signed external URL — fetch server-side and convert to base64
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

  // After analysis, clean up temp storage file (fire-and-forget — do not block on error).
  // Skip cleanup when the image came from a PDF page (pdfPageId set) — those are permanent.
  if (storagePath && !pdfPageId) {
    const bucket = storagePath.split('/')[0];
    const path   = storagePath.slice(bucket.length + 1);
    supabase.storage.from(bucket).remove([path]).catch(e =>
      console.warn('analyse-plan: temp file cleanup failed:', e.message)
    );
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

  let rawText      = claudeResponse.content?.[0]?.text ?? '';
  let inputTokens  = claudeResponse.usage?.input_tokens  ?? 0;
  let outputTokens = claudeResponse.usage?.output_tokens ?? 0;

  // ── Parse and validate AI response ─────────────────────────
  let parsed;
  const warnings = [];

  // Small image → room labels may be unreadable
  if (imgByteEstimate < 150_000) {
    warnings.push('Room labels may be too small to read. Try a cropped screenshot of the floor plan.');
  }

  // Attempt 1: robust extraction (strips markdown fences, finds first JSON block)
  let parseError = null;
  try {
    parsed = extractJson(rawText);
  } catch (e) {
    parseError = e;
    console.warn('analyse-plan: Stage 1 parse attempt 1 failed:', e.message,
      '| raw snippet:', rawText.slice(0, 200));
  }

  // Attempt 2: retry with explicit JSON-only prompt
  if (!parsed) {
    console.log('analyse-plan: retrying Stage 1 with JSON-only prompt');
    try {
      const retryResponse = await anthropic.messages.create({
        model:      MODEL,
        max_tokens: 4096,
        system:     SYSTEM_PROMPT,
        messages: [
          {
            role:    'user',
            content: [
              { type: 'image', source: imageSource },
              { type: 'text',  text: 'Analyse this floor plan. Return ONLY a JSON object — no markdown, no prose. Start your response with {' },
            ],
          },
        ],
      });
      const retryText = retryResponse.content?.[0]?.text ?? '';
      inputTokens  += retryResponse.usage?.input_tokens  ?? 0;
      outputTokens += retryResponse.usage?.output_tokens ?? 0;
      try {
        parsed = extractJson(retryText);
        rawText = retryText; // use retry text for logging
        console.log('analyse-plan: Stage 1 retry parse succeeded');
      } catch (e2) {
        console.error('analyse-plan: Stage 1 retry parse also failed:', e2.message,
          '| raw snippet:', retryText.slice(0, 200));
        parseError = e2;
      }
    } catch (retryApiErr) {
      console.error('analyse-plan: Stage 1 retry API call failed:', retryApiErr.message);
    }
  }

  if (!parsed) {
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
      error_detail: `JSON parse failed after retry: ${parseError?.message}`,
    });

    return res.status(422).json({
      error: `AI returned an unparseable response (parse stage: ${parseError?.message ?? 'unknown'}). No credits deducted.`,
      rawSnippet: rawText.slice(0, 300),
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

  // ── Extract AI occupancy summary (if provided) ───────────────
  // Validated and recalculated from room data after postProcessRooms runs.
  // Raw AI value stored here; recalculated summary is computed below.
  const rawOccupancySummary = parsed.occupancySummary ?? null;

  // ── Collect AI warnings and assumptions ─────────────────────
  if (Array.isArray(parsed.warnings)) {
    for (const w of parsed.warnings) {
      if (typeof w === 'string' && w.trim()) warnings.push(w.trim());
    }
  }
  const assumptions = Array.isArray(parsed.assumptions)
    ? parsed.assumptions.filter(a => typeof a === 'string' && a.trim()).map(a => a.trim())
    : [];

  // reviewCandidates: rooms flagged by the AI for further human or crop-analysis review.
  // Validated: each entry must have a non-empty "room" string.
  const reviewCandidates = Array.isArray(parsed.reviewCandidates)
    ? parsed.reviewCandidates
        .filter(c => c && typeof c.room === 'string' && c.room.trim())
        .map(c => ({
          room:             c.room.trim(),
          reason:           typeof c.reason === 'string'           ? c.reason.trim()           : '',
          roomBoundaryHint: typeof c.roomBoundaryHint === 'string' ? c.roomBoundaryHint.trim() : '',
        }))
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

  // ── Stage 3: targeted fixture re-inspection for flagged rooms ─
  // Runs after Stage 1 (or Stage 2) when any room has requiresManualReview = true.
  // Sends a focused prompt listing only the flagged rooms and asks the model to
  // re-inspect each one for wet fixtures. Merges updated fixture lists back into
  // the final room objects without changing any other fields.
  // Stage 3 is intentionally non-destructive: it only adds fixtures and may flip
  // requiresManualReview to false if confident. It never removes rooms.
  // (Defined as an async function here; called after Stage 2 resolves below.)
  async function runStage3FixtureReview(flaggedRooms, imgSource) {
    if (!flaggedRooms.length) return {};

    const roomList = flaggedRooms
      .map(r => `- "${r.name}" (current classification: ${r.ventilationClassification}, spaceType: ${r.spaceType})`)
      .join('\n');

    const stage3Prompt = `You are a fixture detection specialist reviewing an architectural floor plan.
Stage 1 analysis flagged the following rooms as requiring manual fixture review.
For each room, fixtures could not be confirmed or ruled out after two inspection passes.

Rooms requiring re-inspection:
${roomList}

YOUR TASK:
For each room listed above, perform a focused inspection of that room's interior only.
Look for: sink, basin, vanity, shower, toilet, WC, laundry tub, kitchenette, trough, urinal.
Also look for: bath, freestanding bath, spa, spa bath, sauna.

IMPORTANT: Be specific. Do not inspect other rooms.
If you cannot locate a room on the plan, say so in the result.

Return ONLY valid JSON. No markdown. No prose.

{
  "rooms": [
    {
      "name": "<exact room name from list above>",
      "fixtures": ["sink", "vanity"],
      "requiresManualReview": false,
      "reviewNote": "Sink and vanity confirmed on north wall."
    }
  ]
}

If no fixtures are found after careful inspection:
  "fixtures": [],
  "requiresManualReview": false,
  "reviewNote": "No wet fixtures found after detailed inspection of all walls."

If still uncertain:
  "fixtures": [],
  "requiresManualReview": true,
  "reviewNote": "Room partially obscured — fixture presence cannot be confirmed or ruled out."`;

    try {
      const stage3Response = await anthropic.messages.create({
        model:      MODEL,
        max_tokens: 1024,
        system:     stage3Prompt,
        messages: [{
          role:    'user',
          content: [
            { type: 'image', source: imgSource },
            { type: 'text',  text:  'Re-inspect the listed rooms for wet fixtures and return the JSON result.' },
          ],
        }],
      });

      totalInputTokens  += stage3Response.usage?.input_tokens  ?? 0;
      totalOutputTokens += stage3Response.usage?.output_tokens ?? 0;

      const stage3Text = stage3Response.content?.[0]?.text ?? '';
      let stage3Parsed;
      try { stage3Parsed = JSON.parse(stripMarkdown(stage3Text)); }
      catch (_) {
        console.warn('analyse-plan: Stage 3 JSON parse failed');
        return {};
      }

      // Build a lookup: roomName → { fixtures, requiresManualReview, reviewNote }
      const updates = {};
      for (const r of (stage3Parsed.rooms ?? [])) {
        if (typeof r.name === 'string' && r.name.trim()) {
          updates[r.name.trim()] = {
            fixtures:            Array.isArray(r.fixtures) ? r.fixtures.map(f => String(f).trim().toLowerCase()) : [],
            requiresManualReview: r.requiresManualReview === true,
            reviewNote:           typeof r.reviewNote === 'string' ? r.reviewNote.trim() : null,
          };
        }
      }
      return updates;

    } catch (e) {
      console.error('analyse-plan: Stage 3 fixture review failed:', e.message);
      return {};
    }
  }

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

  // ── Stage 3: fixture re-inspection for requiresManualReview rooms ──
  if (analysisStatus === 'success') {
    const allRoomsForReview = [...finalSupply, ...finalExtract, ...finalTransfer, ...finalIgnore];
    const flagged = allRoomsForReview.filter(r => r.requiresManualReview);

    if (flagged.length > 0) {
      console.log(`analyse-plan: Stage 3 — re-inspecting ${flagged.length} flagged room(s)`);
      const stage3Updates = await runStage3FixtureReview(flagged, imageSource);

      if (Object.keys(stage3Updates).length > 0) {
        // Apply updates to all room lists
        const applyUpdates = rooms => rooms.map(room => {
          const update = stage3Updates[room.name];
          if (!update) return room;

          const mergedFixtures = [...new Set([...room.fixtures, ...update.fixtures])];
          const updatedRoom = { ...room, fixtures: mergedFixtures, requiresManualReview: update.requiresManualReview };

          // If Stage 3 found a wet fixture, re-run the fixture override logic
          const newWetFixture = update.fixtures.find(f => WET_FIXTURE_PATTERNS.some(p => p.test(f)));
          if (newWetFixture && updatedRoom.ventilationClassification !== 'extract') {
            updatedRoom.ventilationClassification = 'extract';
            if (!EXTRACT_TYPES.has(updatedRoom.roomType)) updatedRoom.roomType = 'Other';
            updatedRoom.classificationReason = `Stage 3 re-inspection: ${newWetFixture} detected — reclassified as extract.`;
            warnings.push(`"${room.name}" reclassified as extract after Stage 3 fixture review — ${newWetFixture} detected.`);
          }
          if (update.reviewNote) {
            assumptions.push(`Stage 3 review — "${room.name}": ${update.reviewNote}`);
          }
          return updatedRoom;
        });

        finalSupply   = applyUpdates(finalSupply);
        finalExtract  = applyUpdates(finalExtract);
        finalTransfer = applyUpdates(finalTransfer);
        finalIgnore   = applyUpdates(finalIgnore);

        // Re-sort any rooms that were reclassified to extract
        const reclassified = [...finalSupply, ...finalTransfer, ...finalIgnore].filter(r => r.ventilationClassification === 'extract');
        if (reclassified.length) {
          finalSupply   = finalSupply.filter(r   => r.ventilationClassification !== 'extract');
          finalTransfer = finalTransfer.filter(r => r.ventilationClassification !== 'extract');
          finalIgnore   = finalIgnore.filter(r   => r.ventilationClassification !== 'extract');
          finalExtract  = [...finalExtract, ...reclassified];
        }
      }
    }
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

    // ── Write analysis_log_id back to pdf_pages (failure path) ──────────────
    // Must be awaited — Vercel freezes the function once the response is flushed.
    if (pdfPageId && logRow?.id) {
      const { error: pageUpdateErr } = await supabase
        .from('pdf_pages')
        .update({ analysis_log_id: logRow.id })
        .eq('id', pdfPageId);
      if (pageUpdateErr) console.error('analyse-plan: pdf_pages analysis_log_id writeback failed (failure path):', pageUpdateErr);
    }

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

  // Compute occupancy summary from post-processed rooms.
  // Recalculated server-side so the value is always consistent with the validated room list.
  const allFinalRooms = [...finalSupply, ...finalExtract, ...finalTransfer, ...finalIgnore];
  const totalBedSpaces = allFinalRooms.reduce((sum, r) => sum + (r.bedSpaces || 0), 0);
  const potentialAdditionalBedSpaces = allFinalRooms.reduce((sum, r) => sum + (r.potentialBedSpaces || 0), 0);
  const occupancySummary = {
    suggestedOccupancy:           totalBedSpaces,
    totalBedSpaces,
    potentialAdditionalBedSpaces,
  };

  // Merge server-side flagged rooms into reviewCandidates so the array is always complete.
  // Rooms flagged by rule 0 (postProcessRooms) that aren't already in the AI's list are added.
  const allFinalForReview = [...finalSupply, ...finalExtract, ...finalTransfer, ...finalIgnore];
  const existingCandidateNames = new Set(reviewCandidates.map(c => c.room));
  for (const room of allFinalForReview) {
    if (room.requiresManualReview && !existingCandidateNames.has(room.name)) {
      reviewCandidates.push({
        room:             room.name,
        reason:           'Ambiguous room type with no fixtures detected — flagged by server-side rule.',
        roomBoundaryHint: '',
      });
    }
  }

  const analysisJson = {
    supply: finalSupply, extract: finalExtract, transfer: finalTransfer, ignore: finalIgnore,
    warnings,
    assumptions,
    reviewCandidates,
    analysisStatus: 'success',
    recoveryMode,
    occupancySummary,
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

  // ── Write analysis_log_id back to pdf_pages ──────────────────
  // Links this analysis run to the specific page that was analysed.
  // Must be awaited — Vercel freezes the function once the response is flushed,
  // so a fire-and-forget .then() will never execute.
  if (pdfPageId && logRow?.id) {
    const { error: pageUpdateErr } = await supabase
      .from('pdf_pages')
      .update({ analysis_log_id: logRow.id })
      .eq('id', pdfPageId);
    if (pageUpdateErr) console.error('analyse-plan: pdf_pages analysis_log_id writeback failed:', pageUpdateErr);
  }

  // ── Return structured result ─────────────────────────────────
  return res.status(200).json({
    analysisStatus:         'success',
    recoveryMode,
    stage1RoomCount,
    stage2RoomCount,
    rooms:                  { supply: finalSupply, extract: finalExtract, transfer: finalTransfer, ignore: finalIgnore },
    occupancySummary,
    reviewCandidates,
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
