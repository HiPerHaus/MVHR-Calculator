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
//     supply:   [Room]  — where Room has fields:
//       AI-sourced (read from AI output, validated):
//         name, area, spaceType, confidence, fixtures, parentRoom, bedSpaces, potentialBedSpaces
//       Server-derived (never from AI):
//         labelSeen, roomType, ventilationClassification, optionalExtract, optionalSupply,
//         containsSecondaryExtractZone, classificationReason, terminalPriority, airflowDriver,
//         requiresManualReview, floor
//       spaceType: 'bedroom'|'living'|'dining'|'kitchen'|'kitchenette'|'wet_area'|'laundry'|
//                  'office'|'gym'|'robe'|'circulation'|'service'|'other'
//       airflowDriver: 'occupancy'|'area'|'fixed_extract'|'transfer'|'optional'
//       terminalPriority: 'high'|'medium'|'low'|'none'
//       requiresManualReview: boolean — confidence<0.75 or ambiguous name with no fixtures
//       bedSpaces: number (permanent sleeping capacity; 0 for non-bedrooms)
//       potentialBedSpaces: number (convertible rooms; 0 if not applicable)
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

// ── Model strategy ───────────────────────────────────────────
// Stage 1 (extraction):  Sonnet — fast, cheap, handles most plans correctly.
// Stage 2 (recovery):    Opus   — only when Sonnet fails escalation checks.
// Classification:        Haiku  — see classify-pages.js.
//
// Escalation triggers (Sonnet → Opus):
//   1. JSON parse failure after retry
//   2. Zero rooms returned after postProcessRooms
//   3. Room count below MINIMUM_ROOM_COUNT (likely missed rooms, not a sparse plan)
//   4. forceOpus flag set by caller (manual high-accuracy mode)
const EXTRACTION_MODEL  = 'claude-sonnet-4-6';
const RECOVERY_MODEL    = 'claude-opus-4-5';
const MINIMUM_ROOM_COUNT = 3;   // plans with fewer rooms after Stage 1 trigger Opus recovery

// Valid room types (must match frontend PHPP_SUPPLY_DEFAULTS / PHPP_EXTRACT_DEFAULTS)
const SUPPLY_TYPES   = new Set(['Single Bedroom','Double Bedroom','Master Bedroom','Study / Office','Living Room','Dining Room','Rumpus Room','Other']);
const EXTRACT_TYPES  = new Set(['Kitchen','Bathroom','Ensuite','Laundry','WC','Pantry','Pantry/Laundry','Other']);
const TRANSFER_TYPES = new Set(['Hallway','Entry','Corridor','Other']);
const IGNORE_TYPES   = new Set([
  'WIR','Garage','Porch','Carport','Alfresco','Store','Other',
  // Extended external / outdoor types
  'Verandah','Balcony','Deck','Patio','Shed','Workshop','BBQ Area','Outdoor Kitchen','Courtyard',
]);
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
// ── Server-side derivation functions ──────────────────────────────────────────
// These replace AI-generated fields with deterministic values.
// The AI is no longer asked to produce airflowDriver, terminalPriority, roomType,
// optionalSupply, or optionalExtract.

const SPACE_TYPE_VALUES = new Set([
  'bedroom','living','dining','kitchen','kitchenette','wet_area','laundry',
  'office','gym','robe','circulation','service','other',
]);

// spaceType → airflowDriver (fully deterministic)
const SPACE_TYPE_TO_DRIVER = {
  bedroom:     'occupancy',   living:       'occupancy',
  dining:      'area',        kitchen:      'fixed_extract',
  kitchenette: 'fixed_extract', wet_area:   'fixed_extract',
  laundry:     'fixed_extract', office:     'occupancy',
  gym:         'occupancy',   robe:         'optional',
  circulation: 'transfer',    service:      'optional',
  other:       'occupancy',
};

function deriveAirflowDriver(spaceType) {
  return SPACE_TYPE_TO_DRIVER[spaceType] ?? 'occupancy';
}

// spaceType + ventClass → terminalPriority
// 'medium' for ambiguous habitable rooms that may share a terminal.
const SPACE_TYPE_TO_TERMINAL = {
  bedroom:     'high',   living:       'high',
  dining:      'high',   kitchen:      'high',
  kitchenette: 'medium', wet_area:     'high',
  laundry:     'high',   office:       'medium',
  gym:         'medium', robe:         'low',
  circulation: 'none',   service:      'none',
  other:       'medium',
};

function deriveTerminalPriority(spaceType, ventClass) {
  if (ventClass === 'transfer' || ventClass === 'ignore') return 'none';
  return SPACE_TYPE_TO_TERMINAL[spaceType] ?? 'high';
}

// name → roomType (canonical label for display/legacy use)
// Combined pantry+laundry rooms — common in Australian residential (Butler's Pantry / Laundry)
const PANTRY_LAUNDRY_PATTERN = /\b(b['']?pty|butler['']?s?\s+pantry|pantry)\s*[/&]\s*(ldy|laundry)\b|\b(ldy|laundry)\s*[/&]\s*(b['']?pty|butler['']?s?\s+pantry|pantry)\b/i;

const NAME_LOWER_TO_ROOM_TYPE = {
  // Combined pantry/laundry (must be checked before individual matches)
  "butler's pantry / laundry": 'Pantry/Laundry', "butler's pantry/laundry": 'Pantry/Laundry',
  "butlers pantry / laundry":  'Pantry/Laundry', "pantry / laundry": 'Pantry/Laundry',
  "pantry/laundry":            'Pantry/Laundry', "b'pty / ldy": 'Pantry/Laundry',
  "b'pty/ldy":                 'Pantry/Laundry', "bpty / ldy": 'Pantry/Laundry',
  'single bedroom': 'Single Bedroom', 'double bedroom': 'Double Bedroom',
  'master bedroom': 'Master Bedroom', 'bedroom':        'Double Bedroom',
  'study':          'Study / Office', 'study / office': 'Study / Office',
  'home office':    'Study / Office', 'office':         'Study / Office',
  'living room':    'Living Room',    'living':         'Living Room',
  'lounge':         'Living Room',    'dining room':    'Dining Room',
  'dining':         'Dining Room',    'rumpus room':    'Rumpus Room',
  'rumpus':         'Rumpus Room',    'kitchen':        'Kitchen',
  'bathroom':       'Bathroom',       'ensuite':        'Ensuite',
  'laundry':        'Laundry',        'wc':             'WC',
  'toilet':         'WC',             'pantry':         'Pantry',
  'hallway':        'Hallway',        'hall':           'Hallway',
  'entry':          'Entry',          'corridor':       'Corridor',
  'wir':            'WIR',            'walk-in robe':   'WIR',
  'garage':         'Garage',         'porch':          'Porch',
  'carport':        'Carport',        'alfresco':       'Alfresco',
  'store':          'Store',          'storage':        'Store',
  // External / outdoor display names
  'verandah':       'Verandah',       'veranda':        'Verandah',
  'balcony':        'Balcony',        'deck':           'Deck',
  'patio':          'Patio',          'shed':           'Shed',
  'workshop':       'Workshop',       'bbq':            'BBQ Area',
  'bbq area':       'BBQ Area',       'outdoor kitchen':'Outdoor Kitchen',
  'courtyard':      'Courtyard',
};

function deriveRoomType(name, spaceType) {
  const lower = (name || '').toLowerCase().trim();
  if (NAME_LOWER_TO_ROOM_TYPE[lower]) return NAME_LOWER_TO_ROOM_TYPE[lower];
  // Catch any variant not in the static map
  if (PANTRY_LAUNDRY_PATTERN.test(name)) return 'Pantry/Laundry';
  // Fall back to spaceType-based label
  const SPACE_TO_TYPE = {
    bedroom: 'Double Bedroom', living: 'Living Room', dining: 'Dining Room',
    kitchen: 'Kitchen', kitchenette: 'Kitchen', wet_area: 'Bathroom',
    laundry: 'Laundry', office: 'Study / Office', gym: 'Other',
    robe: 'WIR', circulation: 'Hallway', service: 'Other', other: 'Other',
  };
  return SPACE_TO_TYPE[spaceType] ?? 'Other';
}

// spaceType-driven hard overrides for ventilationClassification.
// The AI classification is used only when no server rule applies ('other' spaceType).
// Returns { classification, reason } or null when no override applies.
function deriveVentilationOverride(spaceType, fixtures) {
  const hasWetFixture = Array.isArray(fixtures) &&
    fixtures.some(f => WET_FIXTURE_PATTERNS.some(p => p.test(f)));

  switch (spaceType) {
    case 'robe':        return { classification: 'transfer', reason: 'spaceType=robe → transfer' };
    case 'circulation': return { classification: 'transfer', reason: 'spaceType=circulation → transfer' };
    case 'service':     return { classification: 'ignore',   reason: 'spaceType=service → ignore' };
    case 'kitchen':     return { classification: 'extract',  reason: 'spaceType=kitchen → extract' };
    case 'kitchenette': return { classification: 'extract',  reason: 'spaceType=kitchenette → extract' };
    case 'wet_area':    return { classification: 'extract',  reason: 'spaceType=wet_area → extract' };
    case 'laundry':     return { classification: 'extract',  reason: 'spaceType=laundry → extract' };
    case 'bedroom':     return { classification: 'supply',   reason: 'spaceType=bedroom → supply' };
    case 'living':      return { classification: 'supply',   reason: 'spaceType=living → supply' };
    case 'dining':      return { classification: 'supply',   reason: 'spaceType=dining → supply' };
    case 'office':      return { classification: hasWetFixture ? 'extract' : 'supply',
                                 reason: hasWetFixture ? 'spaceType=office + wet fixture → extract' : 'spaceType=office → supply' };
    case 'gym':         return { classification: 'extract',  reason: 'spaceType=gym → extract' };
    default:            return null; // 'other' — trust AI classification
  }
}

// Optional supply/extract flags — derived from spaceType + area, never from AI.
// Ignore rooms must never carry optional flags — they are outside MVHR scope entirely.
function deriveOptionalFlags(spaceType, area, ventClass) {
  if (ventClass === 'ignore') return { optionalSupply: false, optionalExtract: false };
  const a = area || 0;
  return {
    optionalSupply:  spaceType === 'robe' && a >= 4,
    optionalExtract: spaceType === 'service' && a >= 2,
  };
}

// Bedroom fallback: master → 2, all others → 1, non-bedrooms → 0.
function bedroomFallbackSpaces(name, spaceType) {
  if (spaceType !== 'bedroom') return 0;
  if (/master|bed(?:room)?\s*1\b|bed\s*1\b|primary|main\s*bed/i.test(name)) return 2;
  return 1;
}

// ── validateRoom ──────────────────────────────────────────────────────────────
// Accepts AI room object, normalises all fields, applies server-side overrides.
// Returns null if the room cannot be used.
function validateRoom(raw, floorIndex) {
  if (!raw || typeof raw !== 'object') return null;

  const name      = typeof raw.name === 'string'     ? raw.name.trim()     : '';
  const labelSeen = typeof raw.labelSeen === 'string' ? raw.labelSeen.trim() : name;
  const area      = typeof raw.area === 'number' && raw.area > 0
    ? Math.round(raw.area * 10) / 10 : null;
  const confidence = typeof raw.confidence === 'number'
    ? Math.min(1, Math.max(0, raw.confidence)) : null;

  const fixtures = Array.isArray(raw.fixtures)
    ? raw.fixtures.filter(f => typeof f === 'string' && f.trim()).map(f => f.trim().toLowerCase())
    : [];

  const parentRoom = typeof raw.parentRoom === 'string' && raw.parentRoom.trim()
    ? raw.parentRoom.trim() : null;

  // ── External space override: always ignored ──────────────────────────────
  // Runs BEFORE spaceType derivation so the AI-provided spaceType has no effect.
  // External/outdoor rooms (alfresco, garage, shed, workshop, BBQ, balcony, etc.)
  // must NEVER contribute to supply, extract, boost, occupancy, or duct layout.
  if (EXTERNAL_SPACE_PATTERN.test(name)) {
    return {
      name:                         name,
      labelSeen:                    labelSeen || name,
      roomType:                     deriveRoomType(name, 'service'),
      area:                         area ?? 0,
      floor:                        floorIndex,
      ventilationClassification:    'ignore',
      confidence:                   confidence ?? 1.0,
      fixtures:                     [],           // clear AI-reported fixtures
      optionalExtract:              false,
      optionalSupply:               false,
      containsSecondaryExtractZone: false,
      classificationReason:         'External/outdoor space — excluded from MVHR ventilation.',
      parentRoom,
      terminalPriority:             'none',
      spaceType:                    'service',
      airflowDriver:                'optional',
      bedSpaces:                    0,
      potentialBedSpaces:           0,
      requiresManualReview:         false,
    };
  }

  // ── spaceType: AI value validated; fallback to name-pattern lookup ──────
  const rawSpaceType = typeof raw.spaceType === 'string'
    ? raw.spaceType.toLowerCase().trim() : null;
  const NAME_TO_SPACE = {
    bedroom: /\bbed(?:room)?\b|\bmaster\b|\bnursery\b|\bguest\s+bed/i,
    kitchen: /\bkitchen\b|\bscullery\b|\bbutler\b|\bpantry\b/i,
    wet_area: /\bbath(?:room)?\b|\bensuite\b|\bwc\b|\btoilet\b|\bpowder\b/i,
    laundry:  /\blaundry\b|\butility\b/i,
    circulation: /\bhall(?:way)?\b|\bentry\b|\bcorridor\b|\bpassage(?:way)?\b|\bvestibule\b|\bstair|\blobby\b|\bfoyer\b|\blanding\b/i,
    robe: /\bwir\b|\bwtr\b|\brobe\b|\bdressing\b/i,
    service: /\bgarage\b|\bcarport\b|\bpatio\b|\bbalcon|\balfresco\b|\bverandah\b|\bporch\b|\bdeck\b|\bstore\b|\bstorage\b|\bservery\b/i,
    living: /\bliving\b|\blounge\b|\bfamily\b|\brumpus\b|\brumpus\b|\bretreat\b|\bactivity\b|\bmedia\b|\btheatre\b|\bsitting\b/i,
    dining: /\bdining\b|\bmeals\b/i,
    office: /\bstudy\b|\boffice\b|\blibrary\b/i,
    gym: /\bgym\b|\bexercise\b/i,
  };
  let spaceType = SPACE_TYPE_VALUES.has(rawSpaceType) ? rawSpaceType : null;
  if (!spaceType) {
    // Combined pantry/laundry must be checked before NAME_TO_SPACE to avoid
    // the kitchen pattern (which matches 'butler' and 'pantry') winning.
    if (PANTRY_LAUNDRY_PATTERN.test(name)) {
      spaceType = 'laundry'; // laundry drives the higher continuous + boost extract rates
    } else {
      for (const [st, pattern] of Object.entries(NAME_TO_SPACE)) {
        if (pattern.test(name)) { spaceType = st; break; }
      }
    }
  }
  spaceType = spaceType ?? 'other';

  // ── ventilationClassification: fully server-derived ─────────────────────
  // AI no longer outputs classification — derived here from spaceType + fixtures.
  // For spaceType='other' (no rule applies): wet fixture → extract, else → supply.
  const override = deriveVentilationOverride(spaceType, fixtures);
  let ventClass;
  if (override) {
    ventClass = override.classification;
  } else {
    // spaceType='other': use fixture evidence; postProcessRooms label rules run next
    const hasWetFixture = fixtures.some(f => WET_FIXTURE_PATTERNS.some(p => p.test(f)));
    ventClass = hasWetFixture ? 'extract' : 'supply';
  }

  // ── requiresManualReview: server-derived ─────────────────────────────────
  // Flags a room for human review when any of these conditions apply:
  //   1. AI confidence < 0.75
  //   2. Ambiguous room name + no fixture evidence to resolve it
  //   3. "/" in name (e.g. "Study/Bed 4") — dual-purpose room needs user decision
  //   4. Name matches a known special-use room type that is project-specific
  const AMBIGUOUS_REVIEW_PATTERNS = [
    /\bmulti.?use\b/i,  /\bmulti.?purpose\b/i, /\bmpr\b/i,
    /\bstudio\b/i,      /\bretreat\b/i,         /\bactivity\b/i,
    /\boffice\b/i,      /\bhome.?office\b/i,    /\brumpus\b/i,
    /\bgym\b/i,         /\bhobby\b/i,
    /\bcellar\b/i,      /\bgames\b/i,
    /\bmedia\b/i,       /\btheatre\b/i,         /\bmedia\s+room\b/i,
    /\bgames\s+room\b/i, /\bhome\s+theatre\b/i,
  ];
  // Known combined room types with "/" are NOT ambiguous — exempt from manual review.
  const isKnownCombined = PANTRY_LAUNDRY_PATTERN.test(name);
  const hasDualPurposeName = !isKnownCombined && name.includes('/');  // e.g. "Study/Bed 4"
  const requiresManualReview =
    (confidence !== null && confidence < 0.75) ||
    hasDualPurposeName ||
    (AMBIGUOUS_REVIEW_PATTERNS.some(p => p.test(name)) && fixtures.length === 0);

  // ── All derived fields ──────────────────────────────────────────────────
  const airflowDriver    = deriveAirflowDriver(spaceType);
  const terminalPriority = deriveTerminalPriority(spaceType, ventClass);
  const roomType         = deriveRoomType(name, spaceType);
  const { optionalSupply, optionalExtract } = deriveOptionalFlags(spaceType, area, ventClass);

  const bedSpaces = typeof raw.bedSpaces === 'number' && raw.bedSpaces >= 0
    ? Math.round(raw.bedSpaces) : bedroomFallbackSpaces(name, spaceType);
  const potentialBedSpaces = typeof raw.potentialBedSpaces === 'number' && raw.potentialBedSpaces >= 0
    ? Math.round(raw.potentialBedSpaces) : 0;

  return {
    name:                      name || roomType,
    labelSeen:                 labelSeen || name || roomType,
    roomType,
    area:                      area ?? 0,
    floor:                     floorIndex,
    ventilationClassification: ventClass,
    confidence,
    fixtures,
    optionalExtract,
    optionalSupply,
    containsSecondaryExtractZone: false, // placeholder — overwritten by deriveRelationalFields()
    classificationReason:         null,
    parentRoom,
    terminalPriority,
    spaceType,
    airflowDriver,
    bedSpaces,
    potentialBedSpaces,
    requiresManualReview,
  };
}

// ── deriveRelationalFields ───────────────────────────────────────────────
// Computes containsSecondaryExtractZone for every room by checking whether
// any other room in the same list references it as parentRoom AND is extract.
// Call this ONCE after all rooms are finalised (after Stage 3 / reclassification).
function deriveRelationalFields(rooms) {
  const extractChildParents = new Set(
    rooms
      .filter(r => r.ventilationClassification === 'extract' && r.parentRoom)
      .map(r => r.parentRoom)
  );
  return rooms.map(r => ({
    ...r,
    containsSecondaryExtractZone: extractChildParents.has(r.name),
  }));
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

// External / outdoor spaces — always classified as ignore regardless of AI spaceType or fixtures.
// Referenced in both validateRoom() (early return) and postProcessRooms() (step 0).
const EXTERNAL_SPACE_PATTERN =
  /\b(alfresco|verandah|veranda|balcon(?:y|ies)?|deck|porch|patio|outdoor\s+kitchen|bbq|carport|garage|shed|workshop|pool\s+equipment|courtyard|outdoor)\b/i;

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
// Note: EXTERNAL_SPACE_PATTERN (step 0 in postProcessRooms) is the primary guard;
// IGNORE_LABEL_PATTERNS is a defence-in-depth fallback at step 5.
const IGNORE_LABEL_PATTERNS = [
  /\bverandah\b/i, /\bveranda\b/i,
  /\bporch\b/i,
  /\bpatio\b/i,
  /\balfresco\b/i,
  /\bgarage\b/i,
  /\bcarport\b/i,
  /\bbalcon/i,          // balcony, balconies
  /\bdeck\b/i,
  /\bcourtyard\b/i,
  /\boutdoor\b/i,
  /\bbbq\b/i,           // BBQ area / outdoor grill
  /\bshed\b/i,          // garden shed, tool shed
  /\bworkshop\b/i,      // outdoor/backyard workshop
];

// Circulation — always transfer
const TRANSFER_LABEL_PATTERNS = [
  /\bpassage(?:way)?\b/i,   // passage AND passageway
  /\bvestibule\b/i,
  /\bhall(way)?\b/i,
  /\bentry\s+hall\b/i,
  /\bstair\s+hall\b/i,
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
  'alfresco','verandah','veranda','patio','store','other','lounge','family','theatre','media',
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

    // ── 0. Ambiguous / special-use rooms → set review flag + cap confidence ──
    // requiresManualReview is pre-set by validateRoom, but postProcessRooms
    // re-evaluates here to catch any rooms missed by the static check.
    // Confidence rules:
    //   High  (≥0.90): explicit label + classification confirmed by fixtures — no cap
    //   Medium (0.65): name-only inference, type guessed from context
    //   Low   (<0.65): dual-purpose "/" name, personal label, or ambiguous + no fixtures
    const AMBIGUOUS_LABEL_PATTERNS = [
      /\bmulti.?use\b/i, /\bmulti.?purpose\b/i, /\bmpr\b/i,
      /\bstudio\b/i,     /\bretreat\b/i,         /\bactivity\b/i,
      /\boffice\b/i,     /\bhome.?office\b/i,    /\brumpus\b/i,
      /\bgym\b/i,        /\bhobby\b/i,
      /\bcellar\b/i,     /\bgames\b/i,
      /\bmedia\b/i,      /\btheatre\b/i,
    ];
    const isAmbiguousNoFixtures =
      AMBIGUOUS_LABEL_PATTERNS.some(p => p.test(name)) &&
      (!Array.isArray(room.fixtures) || room.fixtures.length === 0);
    // Known combined types (e.g. Butler's Pantry / Laundry) are NOT ambiguous.
    const hasDualPurpose = name.includes('/') && !PANTRY_LAUNDRY_PATTERN.test(name);

    if (isAmbiguousNoFixtures) {
      room.requiresManualReview = true;
      // Medium confidence cap — name-only inference
      if (room.confidence == null || room.confidence > 0.65) room.confidence = 0.65;
    }
    if (hasDualPurpose) {
      room.requiresManualReview = true;
      // Low confidence cap — dual-purpose rooms need user decision
      if (room.confidence == null || room.confidence > 0.60) room.confidence = 0.60;
    }

    // ── 0. External / outdoor spaces → always ignore ─────────
    // Must run BEFORE step 1 (service exclusion) and step 2 (wet fixture override)
    // so that outdoor rooms with wet fixtures (e.g. outdoor kitchen sink) are still
    // classified as ignore rather than extract.
    if (EXTERNAL_SPACE_PATTERN.test(name)) {
      room.ventilationClassification = 'ignore';
      room.airflowDriver             = 'optional';
      room.requiresManualReview      = false;
      if (!IGNORE_TYPES.has(room.roomType)) room.roomType = 'Other';
      out.push(room);
      continue;
    }

    // ── 1. Service / equipment → exclude ─────────────────────
    if (SERVICE_PATTERNS.some(p => p.test(name))) {
      // Routine exclusion — no warning needed.
      continue;
    }

    // ── 2. Fixture override ───────────────────────────────────
    // Wet fixtures (shower/toilet/sink/basin etc.) force extract regardless of room name.
    // Moisture fixtures (bath/spa/sauna) alone preserve supply but flag secondary extract zone.
    if (Array.isArray(room.fixtures) && room.fixtures.length > 0) {
      const wetFixture = room.fixtures.find(f => WET_FIXTURE_PATTERNS.some(p => p.test(f)));

      if (wetFixture) {
        // Has a real wet fixture → extract.
        // Only warn when this overrides an unexpected classification (e.g. a labelled bedroom).
        const wasSupply = room.ventilationClassification === 'supply';
        room.ventilationClassification = 'extract';
        if (!EXTRACT_TYPES.has(room.roomType)) room.roomType = 'Other';
        room.classificationReason = `Contains wet fixture (${wetFixture}) — classified as extract regardless of room name.`;
        if (wasSupply && /\bbed\b|\bbedroom\b|\bmaster\b/i.test(name)) {
          warnings.push(`"${name}" reclassified as extract — unexpected wet fixture (${wetFixture}) detected.`);
        }
        out.push(room);
        continue;
      }

      // No wet fixture — check for moisture-only fixtures (bath/spa/sauna)
      const moistureFixture = room.fixtures.find(f => MOISTURE_FIXTURE_PATTERNS.some(p => p.test(f)));
      if (moistureFixture && room.ventilationClassification === 'supply') {
        // Habitable room with bath/spa alone: stay supply, flag secondary zone.
        room.containsSecondaryExtractZone = true;
        if (!room.classificationReason) {
          room.classificationReason = `Habitable room with ${moistureFixture} — supply preserved. Secondary extract zone flagged for diffuser allocation.`;
        }
        warnings.push(`"${name}" contains ${moistureFixture} — supply with secondary extract zone.`);
        // Fall through — room continues to label-pattern rules which will confirm supply
      }
    }

    // ── 2b. Combined Pantry/Laundry → extract, no manual review ─
    // Handles: Butler's Pantry / Laundry, B'Pty / Ldy, Pantry/Laundry, etc.
    // These are well-defined combined rooms common in Australian residential builds.
    // Both functions are extract; no ambiguity; do not flag for manual review.
    if (PANTRY_LAUNDRY_PATTERN.test(name)) {
      room.roomType                  = 'Pantry/Laundry';
      room.ventilationClassification = 'extract';
      room.requiresManualReview      = false;
      room.classificationReason      = 'Combined Butler\'s Pantry and Laundry — classified as extract.';
      out.push(room);
      matched = true;
    }
    if (matched) continue;

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
      } else {
        room.classificationReason = 'Walk-in Robe — transfer. Too small to warrant a supply terminal.';
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
        out.push(room);
      }
      // Small joinery excluded silently.
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
      const wasSupply = room.ventilationClassification === 'supply';
      room.ventilationClassification = 'transfer';
      if (!TRANSFER_TYPES.has(room.roomType)) room.roomType = 'Other';
      room.classificationReason = 'Circulation space — transfer (air movement path, not habitable).';

      // Passageway and vestibule are often misclassified as supply by the AI.
      // Flag for review + lower confidence so they appear in the Needs Review list.
      if (/\bpassageway\b|\bvestibule\b/i.test(name)) {
        room.requiresManualReview = true;
        if (room.confidence == null || room.confidence > 0.50) room.confidence = 0.50;
        if (wasSupply) {
          warnings.push(`"${name}" reclassified as Transfer — passageway/vestibule is a circulation space, not a supply room.`);
        }
      }
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
      // Pantry / scullery / butler's pantry: extract is correct but not always mandatory.
      // Set optionalExtract so the sizing engine can treat it as transfer if system balance allows.
      if (/\bpantry\b/i.test(name) || /\bscullery\b/i.test(name) || /\bbutler/i.test(name)) {
        room.optionalExtract = true;
        if (!room.classificationReason) {
          room.classificationReason = 'Pantry — extract (odour/moisture load). optionalExtract flagged; may be treated as transfer depending on system balance.';
        }
      }
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
      } else {
        room.ventilationClassification = 'transfer';
        room.optionalExtract = true;
        room.classificationReason = 'Internal store — transfer. May be used as an extract point for system balance.';
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
    // Skipped for service spaceTypes — these are never habitable rooms.
    const isPersonName = /^[A-Z][a-z]{2,}$/.test(name) && !KNOWN_ROOM_WORDS.has(nameLo);
    if (isPersonName && room.ventilationClassification !== 'supply' && room.spaceType !== 'service') {
      room.ventilationClassification = 'supply';
      if (!SUPPLY_TYPES.has(room.roomType)) room.roomType = 'Other';
      // Personal labels are inferred — flag for review, cap at medium confidence.
      room.requiresManualReview = true;
      if (room.confidence == null || room.confidence > 0.65) room.confidence = 0.65;
      warnings.push(`"${name}" interpreted as a habitable room (personal label) — classified as supply. Please verify.`);
    }

    out.push(room);
  }

  // ── Final sweep 1: warning-text → requiresManualReview ──────────────────
  // Any warning generated during processing that contains assumption language
  // flags the corresponding room for review, even if it wasn't caught above.
  const REVIEW_TRIGGER_WORDS = [
    'interpreted', 'assumed', 'possible', 'may be', 'personal label',
    'inferred', 'estimated', 'likely', 'appears to be', 'please verify',
  ];
  for (const room of out) {
    if (room.requiresManualReview) continue; // already flagged
    const reasonText = (room.classificationReason ?? '').toLowerCase();
    if (REVIEW_TRIGGER_WORDS.some(w => reasonText.includes(w))) {
      room.requiresManualReview = true;
    }
  }

  // ── Final sweep 2: hard-clear optional flags on all ignore rooms ─────────
  // Ensures service/outdoor spaces (Garage, Alfresco, Balcony, Patio etc.) are
  // never presented as optional ventilation locations in the UI, regardless of
  // how they were derived or which rule path they followed.
  for (const room of out) {
    if (room.ventilationClassification === 'ignore') {
      room.optionalSupply      = false;
      room.optionalExtract     = false;
      room.terminalPriority    = 'none';
      room.requiresManualReview = false;
    }
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

════ STEP 0: IDENTIFY THE FLOOR ════
Read the floor or sheet title printed on this plan drawing.
Return it as "floorName" at the TOP LEVEL of the JSON response (alongside "rooms").

Common titles: GROUND FLOOR  FIRST FLOOR  SECOND FLOOR  UPPER FLOOR  LOWER GROUND  BASEMENT  MEZZANINE
Normalise to title case: "Ground Floor"  "First Floor"  "Lower Ground"  "Basement"
If the title includes "PLAN" (e.g. "GROUND FLOOR PLAN"), strip "Plan" → "Ground Floor".

Rules:
  • Read the title as printed — do NOT infer from page order or context.
  • Page 1 is NOT automatically the ground floor.
  • If the title is clearly visible: use it exactly (normalised to title case).
  • If no title is visible: use "Unknown Floor" and add a warning.

════ MULTIPLE DRAWINGS OF THE SAME FLOOR ════
Architectural drawing sets frequently include several sheets of the SAME floor:
  e.g.  A1.0  Ground Floor Plan      ← primary
        A1.1  Dimensioned Plan        ← same floor, annotated with dimensions
        A1.3  Electrical Plan         ← same floor, annotated with electrical layouts

You are given ONE sheet at a time. You do NOT know what other sheets exist.

CRITICAL RULES:
  • You are extracting rooms from ONE floor only.
  • Do NOT invent additional floors because a room appears on a dimensioned or electrical sheet.
  • A "Dimensioned Plan", "Set-Out Plan", "Electrical Plan", "Hydraulic Plan", "Services Plan",
    or "Lighting Plan" is NOT a separate floor — it is the SAME floor shown with different annotations.
  • If the sheet title says "Dimensioned", "Set Out", "Services", "Electrical", "Hydraulic",
    "Lighting", "Furniture", "Finishes", or similar — read the rooms from the plan geometry
    but treat them as belonging to the SAME floor as the corresponding primary floor plan.
  • Do NOT create rooms with names like "Ground Floor Bedroom 2" — use "Bedroom 2" only.
    Floor assignment is handled by the calling system, not by you.
  • The number of DISTINCT floors must not exceed the number of clearly different floor levels
    shown on THIS sheet (almost always 1).

════ STEP 1: READ EVERY ROOM LABEL ════
Scan the entire plan. List every labelled space. Use the room name as "name" (title case).
Do NOT return empty rooms[]. If a label is unclear, use a generic name and set confidence 0.5.
Omitting rooms is an error.

These words MUST appear in rooms[] if visible on the plan:
  Kitchen  Scullery  Pantry  Butler's Pantry
  Living  Lounge  Dining  Meals  Family  Rumpus  Theatre  Media  Activity  Retreat  Sitting
  Bedroom  Master  Bed  Study  Office  Library  Playroom  Gym  Sunroom
  Bath  Bathroom  Ensuite  WC  Powder  Toilet  Laundry  Mudroom  Utility
  Entry  Hall  Hallway  Passage  Passageway  Corridor  Lobby  Landing  Stair  Vestibule
  WIR  Store  Garage  Alfresco  Verandah  Porch  Carport

Rooms labelled with a person's name (PAUL, JANE, TOM etc.) are bedrooms — classify as supply.

════ STEP 2: ASSIGN SPACE TYPES ════
The server derives ventilation classification, airflow drivers, and terminal priorities from
spaceType and fixtures[]. Your job is to assign the correct spaceType and list all visible
fixtures accurately. These two fields are the primary inputs to the ventilation engine.

HABITABLE SUPPLY SPACES — assign spaceType:
  Bedroom  Master Bedroom  Guest Bedroom             → "bedroom"
  Living  Lounge  Family  Rumpus  Theatre  Media
  Activity  Retreat  Sitting  Multi-Use  Sunroom      → "living"
  Dining  Meals  Breakfast                            → "dining"
  Study  Office  Home Office  Library  Workroom       → "office"
  Gym  Home Gym  Exercise Room                        → "gym"

MOISTURE/ODOUR-PRODUCING SPACES — assign spaceType:
  Kitchen  Scullery  Butler's Pantry  Walk-in Pantry  → "kitchen"
  Bathroom  Ensuite  Powder Room  WC  Toilet          → "wet_area"
  Laundry  Mudroom (with laundry)  Utility (wet)      → "laundry"
  Habitable room + sink + cabinetry                   → "kitchenette"

COMBINED PANTRY / LAUNDRY ROOMS:
  Common in Australian residential: Butler's Pantry / Laundry, B'Pty / Ldy, Pantry/Laundry.
  Use "name" = the label as written on the plan (e.g. "B'Pty / Ldy", "Butler's Pantry / Laundry").
  Use spaceType = "laundry" (laundry function drives the higher extract airflow requirement).
  Do NOT split into separate rooms unless physically separated on the plan.
  Do NOT flag requiresManualReview when both functions are clear from the label.
  Classification is always extract.

CIRCULATION SPACES — assign spaceType:
  Hallway  Corridor  Entry  Foyer  Passage  Passageway  Vestibule  Landing  Stair  Lobby  Entry Hall  Stair Hall  → "circulation"
  NOTE: Passageway and Vestibule are always circulation. Never classify as supply.

STORAGE/SERVICE SPACES — assign spaceType:
  Walk-in Robe  WIR  Dressing Room                   → "robe"
  Garage  Carport  Plant Room  Electrical  HWS
  Attic  Roof Space  Outdoor areas  Servery         → "service"

JOINERY (BIR/CPD/linen/cupboards) — NOT rooms. Do not list them as room entries.

Set "name" to the room name as it would appear in a room schedule (title case).

════ HABITABLE ROOM KITCHENETTE RULE ════
If a habitable room contains a sink AND cabinetry or a benchtop:
  → Set spaceType = "kitchenette"
  → Food preparation and appliance use generate moisture, odours and contaminants.
  → The server will classify this zone as extract.

Applies to:
  Multi-Use Room  Studio  Retreat  Activity Room  Rumpus  Office  Guest Room
  Any habitable room not normally expected to contain a sink.

Confidence guidance:
  Sink + visible cabinetry or benchtop → high confidence → spaceType "kitchenette"
  Sink only (no visible cabinetry)     → still set spaceType "kitchenette", add assumption:
    "Sink detected without visible cabinetry — classified as kitchenette pending manual review."

spaceType distinction:
  "kitchen"     — dedicated kitchen room (primary food preparation space)
  "kitchenette" — habitable room with sink and cabinetry (secondary/incidental food prep)

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

Manual Review Flag:
  If you cannot confirm whether wet fixtures are present after two inspection passes:
    → Set "requiresManualReview": true on that room entry.
    → Keep your best-estimate classification but lower confidence to ≤ 0.80.
  If you are confident no fixtures are present: set requiresManualReview: false.
  Default is false. Only set true when genuine uncertainty remains.

Assumptions — write only when genuinely informative:
  Only add to assumptions[] when the classification decision requires an explanation that
  is NOT already visible in ventilationClassification, spaceType, or fixtures[].
  Maximum 5 assumptions total. For a normal house: 0–2 is expected.
  DO NOT write assumptions for: Kitchen → extract, Bathroom → extract, Bedroom → supply,
  Living → supply, Garage → ignore. These are standard outcomes.
  GOOD: "Study assumed non-bedroom — no bed or wardrobe visible."
  BAD:  "Kitchen classified as extract — sink detected."

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
Only include a room in reviewCandidates[] when ALL of the following are true:
  • confidence < 0.80, OR room function cannot be determined
  • The uncertainty materially affects occupancy OR airflow calculations
  • The room is NOT a standard room (kitchen, bathroom, laundry, bedroom, living)
    unless a fixture cannot be identified despite two inspection passes

Maximum 3 reviewCandidates. For a standard detached house: 0–1 is expected.

DO NOT create reviewCandidates for:
  Kitchen  Bathroom  Laundry  Ensuite  WC  Bedroom  Living Room  Dining  Garage
  unless confidence < 0.80 or a fixture cannot be confirmed after two passes.

For each candidate include:
  "room"             — exact room name from rooms[]
  "reason"           — one sentence: what is uncertain and why it matters
  "roomBoundaryHint" — where it sits on the plan (supports future crop-analysis pass)

GOOD: { "room": "MPR", "reason": "Could not determine if bedroom or media room.", "roomBoundaryHint": "Upper-right, adjacent to Bedroom 3" }
BAD:  { "room": "Living Room", "reason": "May contain a kitchenette." }

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
  A habitable room with only moisture fixtures (no wet fixture) stays spaceType "bedroom"/"living" etc.
  The server marks it with a secondary extract zone for the bath area.

FIXTURE RULE — highest priority, use to determine correct spaceType:
  Wet fixture in any room                          → spaceType reflects wet function (kitchenette/wet_area)
  Oven / cooktop / fridge / dishwasher alone       → spaceType unchanged
  Bath / spa / sauna alone in habitable room       → keep habitable spaceType; split off a wet_area zone
  Bath + shower or toilet in any room              → spaceType "wet_area"

Examples (for spaceType assignment and zone splitting):
  Bedroom + freestanding bath only  → Bedroom spaceType "bedroom" + Bath Zone spaceType "wet_area"
  Master Suite + spa bath only      → Master Suite spaceType "bedroom" + Bath Zone spaceType "wet_area"
  Bedroom + bath + shower           → spaceType "wet_area"
  Bedroom + bath + toilet           → spaceType "wet_area"
  Multi-Use Room + sink             → spaceType "kitchenette"
  Bedroom + shower (no bath)        → spaceType "wet_area"
  Rumpus + fridge only              → spaceType "living"
  Store + laundry tub               → spaceType "laundry"
  Retreat + spa bath only           → Retreat spaceType "living" + Bath Zone spaceType "wet_area"

════ ROOM SPLITTING RULE ════
Some architectural spaces contain multiple ventilation zones.
If a room contains a clearly identifiable wet area that would normally be classified differently
to the main room — do NOT classify the entire room using a single ventilation classification.

Instead:
  1. Create the primary room entry using the dominant room function and its spaceType.
  2. Create a separate secondary zone entry for the wet area with the correct spaceType.
  3. Set "parentRoom" on the secondary zone entry to the primary room's name.
  4. Add a warning describing the split.
  (The server automatically derives containsSecondaryExtractZone from these parentRoom links.)

Examples:
  Bedroom + freestanding bath       → Bedroom (spaceType "bedroom", parentRoom null)
                                       Bath Zone (spaceType "wet_area", parentRoom "Bedroom")
  Bedroom + ensuite                 → Bedroom (spaceType "bedroom", parentRoom null)
                                       Ensuite (spaceType "wet_area", parentRoom "Bedroom")
  Gym + shower                      → Gym (spaceType "gym", parentRoom null)
                                       Shower Zone (spaceType "wet_area", parentRoom "Gym")
  Retreat + wet bar                 → Retreat (spaceType "living", parentRoom null)
                                       Wet Bar Zone (spaceType "kitchenette", parentRoom "Retreat")
  Studio + kitchenette              → Studio (spaceType "living", parentRoom null)
                                       Kitchenette Zone (spaceType "kitchenette", parentRoom "Studio")
  Living / Kitchen open-plan        → Living (spaceType "living", parentRoom null)
                                       Kitchen Zone (spaceType "kitchen", parentRoom "Living")

NEVER convert an entire habitable room to extract simply because a smaller wet area exists within it.
The primary room's classification must reflect its dominant occupancy function.

════ OPEN PLAN AIRFLOW ZONE RULE ════
Architectural rooms and ventilation zones are not always the same thing.
The objective is to identify airflow zones, not simply room names.
Large open-plan spaces frequently contain multiple ventilation zones with different functions.

Examples:
  Living / Dining / Kitchen
    → Living Room    (spaceType "living",   parentRoom null)
    → Dining         (spaceType "dining",   parentRoom "Living / Dining / Kitchen")
    → Kitchen        (spaceType "kitchen",  parentRoom "Living / Dining / Kitchen")

  Living / Dining / Kitchen / Scullery
    → Living Room    (spaceType "living",   parentRoom null)
    → Dining         (spaceType "dining",   parentRoom "Living / Dining / Kitchen / Scullery")
    → Kitchen        (spaceType "kitchen",  parentRoom "Living / Dining / Kitchen / Scullery")
    → Scullery       (spaceType "kitchen",  parentRoom "Living / Dining / Kitchen / Scullery")

  Master Suite
    → Bedroom        (spaceType "bedroom",  parentRoom null)
    → Ensuite        (spaceType "wet_area", parentRoom "Master Bedroom")
    → WIR            (spaceType "robe",     parentRoom "Master Bedroom")

  Gym + Shower
    → Gym            (spaceType "gym",      parentRoom null)
    → Shower Zone    (spaceType "wet_area", parentRoom "Gym")

  Retreat + Wet Bar
    → Retreat        (spaceType "living",      parentRoom null)
    → Wet Bar Zone   (spaceType "kitchenette", parentRoom "Retreat")

  Studio + Kitchenette
    → Studio         (spaceType "living",      parentRoom null)
    → Kitchenette    (spaceType "kitchenette", parentRoom "Studio")

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
  Room labelled "Studio"         + sink          → spaceType "kitchenette" (not "living")
  Room labelled "Multi-Use Room" + shower        → spaceType "wet_area"
  Room labelled "Retreat"        + kitchenette   → spaceType "kitchenette"
  Room labelled "Bedroom"        + bath only     → spaceType "bedroom", split bath zone as "wet_area"
  Room labelled "Living"         + kitchen bench → split: living "living", kitchen zone "kitchen"

The objective is to identify the airflow zones that will ultimately receive MVHR terminals.
Every zone should represent a distinct airflow destination, not simply a room name.

════ ZONE OUTPUT FORMAT ════
Each zone is a room entry in the rooms[] array.
Secondary zones created by splitting must set "parentRoom" to the architectural room name.

Example output for open-plan Living / Dining / Kitchen:
  { "name": "Living Room", "classification": "supply",  "parentRoom": null }
  { "name": "Dining",      "classification": "supply",  "parentRoom": "Living / Dining / Kitchen" }
  { "name": "Kitchen",     "classification": "extract", "parentRoom": "Living / Dining / Kitchen" }

Example output for Master Suite:
  { "name": "Master Bedroom",           "classification": "supply",  "parentRoom": null,             "containsSecondaryExtractZone": true }
  { "name": "Master Bedroom - Ensuite", "classification": "extract", "parentRoom": "Master Bedroom" }

Example output for Pantry adjacent to Kitchen:
  { "name": "Kitchen", "classification": "extract", "parentRoom": null }
  { "name": "Pantry",  "classification": "extract", "parentRoom": "Kitchen" }

Do NOT create separate zones for:
  Hallways  Corridors  Small cupboards  Joinery  Storage recesses
unless they independently require a ventilation terminal.

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
                  Bin Store  Roof Space  Attic  Outdoor areas  Servery
  "other"       — Any zone that does not clearly fit the above

Notes:
  • Pantry, Scullery and Butler's Pantry → "kitchen" (airflow calculated using kitchen extract rate)
  • WIR and Dressing Room → "robe" (transfer zone; low or no terminal)
  • A Retreat or Rumpus without wet fixtures → "living"
  • A Studio with a sink → spaceType "kitchen" (or "wet_area" if sink only), classification = extract
  • Mudroom without laundry fixtures → "circulation"

════ BED SPACE DETECTION RULE ════
This is NOT a ventilation classification task.
This is an occupancy estimation task only.
Estimate likely sleeping capacity conservatively for Australian residential MVHR design.
Do NOT assume 2 occupants in every bedroom — this significantly overestimates airflow requirements.

For every zone set "bedSpaces" and "potentialBedSpaces". Default both to 0.

PERMANENT BED SPACES — bedSpaces:
  Master Bedroom / Bedroom 1  → 2  (primary double bedroom)
  All other bedrooms          → 1  (Bedroom 2, Bedroom 3, Bedroom 4, Bedroom 5 etc.)
  Guest Bedroom               → 1
  Nursery / Baby's Room       → 1
  Single / Child's Room       → 1
  All non-bedroom zones       → 0

Examples:
  3-bedroom: Master(2) + Bed 2(1) + Bed 3(1)       = 4 total
  4-bedroom: Master(2) + Bed 2(1) + Bed 3(1) + Bed 4(1) = 5 total
  5-bedroom: Master(2) + Bed 2–5(1 each)            = 6 total

ZONES THAT ARE ALWAYS 0 (bedSpaces = 0):
  Study  Home Office  Library  Retreat  Sitting Room  Media Room  Theatre
  Living Room  Lounge  Dining Room  Gym  Games Room  Activity Room
  Multi-Purpose Room  Multi-Use Room  Studio  Rumpus Room
  Walk-in Robe  WIR  WTR  Hallway  Corridor  Entry  all circulation

CONVERTIBLE BED SPACES — potentialBedSpaces:
  A non-bedroom zone with a door, apparent window, and area ≥ 8 m² may convert to a bedroom:
    Study  Multi-Purpose Room  Multi-Use Room  Retreat  Activity Room
    → potentialBedSpaces = 1
  All other zones: potentialBedSpaces = 0

Do not attempt to predict actual residents.
Only estimate available sleeping capacity.
Do NOT output an occupancySummary object — the server recalculates it from room bedSpaces.

════ ZONE-WITHIN-ZONE ════
Some rooms contain two ventilation functions. Create split zone entries using parentRoom.
The server derives containsSecondaryExtractZone automatically from the parentRoom links.

BEDROOM WITH BATH (no shower or toilet present):
  → Keep bedroom as spaceType "bedroom" (primary zone, parentRoom null)
  → Create a secondary zone: spaceType "wet_area", parentRoom = bedroom name
  Rationale: a freestanding bath, spa bath or soaking tub does not produce sustained moisture
  the way a shower or toilet does. The bedroom's primary function remains habitable.
  Examples:
    Bedroom + freestanding bath only → Bedroom ("bedroom") + Bath Zone ("wet_area", parentRoom)
    Master Suite + bath              → Master Suite ("bedroom") + Bath Zone ("wet_area", parentRoom)
    Retreat + spa bath               → Retreat ("living") + Spa Zone ("wet_area", parentRoom)

BEDROOM WITH BATH + SHOWER OR TOILET:
  → The entire space becomes spaceType "wet_area" (wet fixture takes priority)
  Examples:
    Bedroom + bath + shower  → spaceType "wet_area"
    Bedroom + bath + toilet  → spaceType "wet_area"

BEDROOM WITH OPEN ENSUITE (no physical door):
  → Keep bedroom as spaceType "bedroom" (primary zone)
  → Create ensuite as spaceType "wet_area" with parentRoom = bedroom name
  The intended air path is supply → bedroom → ensuite → extract.

════ CONFIDENCE ════
Confidence represents uncertainty in room identification — not boundary approximation.
  Clearly labelled Bedroom / Kitchen / Bathroom → 0.90–0.98
  Room labelled MPR / Activity / Flex          → 0.60–0.80
  Unlabelled room inferred from context        → 0.50–0.75
Do NOT reduce confidence because room dimensions are estimated or boundaries are approximate.

════ OUTPUT CONSTRAINTS ════
The objective is to extract room data, not to explain every decision.
Room objects are the primary output. warnings[], assumptions[], reviewCandidates[] are
secondary and must only be created when genuinely necessary.

DO NOT EXPLAIN OBVIOUS SPACE TYPES.
Do not create warnings, assumptions or reviewCandidates for any of the following — these
are normal outcomes and require no explanation:
  Kitchen with sink · Bathroom with toilet/shower/bath · Laundry with tub
  Bedroom with clear label · Living room with no wet fixtures · Dining room
  Garage · Patio · Balcony · Hallway · Stair · Walk-in Robe · Store room

When a room's spaceType is clear: set it and return the room. Do not explain.
The shortest correct output is preferred.

MULTI-FLOOR PROJECTS — do NOT warn about cross-floor issues:
This sheet may be one of several in a multi-storey project.
NEVER generate warnings for any of the following — they cannot be assessed from a single sheet:
  • No master bedroom visible / no Bed 1 detected
  • Occupancy may be incomplete
  • Master bedroom likely on another floor
  • No double bedroom identified
  • Low occupancy estimate
Only warn about things that are genuinely unclear or missing ON THIS SHEET.

WARNINGS — maximum 5. Only for:
  • Unreadable or missing room labels
  • Ambiguous function that could not be resolved
  • Plan inconsistency (e.g. duplicate rooms, impossible area)
  • Fixture partially visible where spaceType may be affected
  BAD: "Kitchen classified as extract — sink detected."
  GOOD: "Room labelled 'MPR' — function could not be determined at this scale."

ASSUMPTIONS — maximum 5. Expected per house: 0–2.
  Only when the decision is non-obvious AND not visible in ventilationClassification,
  spaceType, or fixtures[].
  BAD: "Bed 2 classified as supply." GOOD: "Study assumed non-bedroom."

REVIEW CANDIDATES — maximum 3. Expected per house: 0–1.
  Only when ALL apply: confidence < 0.80 AND uncertainty materially affects occupancy
  or ventilation design AND room is not a standard room type.
  Do not create reviewCandidates because a room could theoretically contain fixtures.
  Avoid speculative reviews.
  BAD: "Living room may contain a kitchenette."
  GOOD: "Room labelled MPR could function as either a bedroom or media room."

DUPLICATE CHECK — before returning:
  • No duplicate Living rooms, Kitchens, Bathrooms, or Hallways unless physically separate
  • No duplicate reviewCandidates for the same room

════ RESPONSE FORMAT ════
Return ONLY valid JSON. No markdown. No prose.

Top-level fields: floorName · rooms · warnings · assumptions · reviewCandidates
Room fields: name · spaceType · area · confidence · fixtures · parentRoom · bedSpaces · potentialBedSpaces
Do NOT output: classification · ventilationClassification · containsSecondaryExtractZone · requiresManualReview
The server derives all classification, priority, and review fields from spaceType and fixtures.

{
  "floorName": "First Floor",
  "rooms": [
    { "name": "Master Bedroom",
      "spaceType": "bedroom", "area": 19.2, "confidence": 0.94,
      "fixtures": [], "parentRoom": null,
      "bedSpaces": 2, "potentialBedSpaces": 0 },
    { "name": "Bedroom 2",
      "spaceType": "bedroom", "area": 11.4, "confidence": 0.97,
      "fixtures": [], "parentRoom": null,
      "bedSpaces": 1, "potentialBedSpaces": 0 },
    { "name": "Kitchen",
      "spaceType": "kitchen", "area": 16.4, "confidence": 0.97,
      "fixtures": ["sink", "dishwasher"], "parentRoom": null,
      "bedSpaces": 0, "potentialBedSpaces": 0 },
    { "name": "Multi-Use Room",
      "spaceType": "kitchenette", "area": 12.0, "confidence": 0.72,
      "fixtures": ["sink"], "parentRoom": null,
      "bedSpaces": 0, "potentialBedSpaces": 0 },
    { "name": "Rumpus Room",
      "spaceType": "living", "area": 22.0, "confidence": 0.95,
      "fixtures": [], "parentRoom": null,
      "bedSpaces": 0, "potentialBedSpaces": 0 },
    { "name": "Walk-in Robe",
      "spaceType": "robe", "area": 5.5, "confidence": 0.92,
      "fixtures": [], "parentRoom": null,
      "bedSpaces": 0, "potentialBedSpaces": 0 },
    { "name": "Master Suite",
      "spaceType": "bedroom", "area": 22.0, "confidence": 0.93,
      "fixtures": ["freestanding bath"], "parentRoom": null,
      "bedSpaces": 2, "potentialBedSpaces": 0 },
    { "name": "Master Suite - Bath Zone",
      "spaceType": "wet_area", "area": 4.0, "confidence": 0.88,
      "fixtures": ["freestanding bath"], "parentRoom": "Master Suite",
      "bedSpaces": 0, "potentialBedSpaces": 0 }
  ],
  "warnings": ["Master Suite split: bedroom primary, bath zone added as secondary zone."],
  "assumptions": ["Multi-Use Room appears suitable for future bedroom conversion."]
}`;

// ── Stage 2 recovery prompt ────────────────────────────────────
// Used only when Stage 1 returns no rooms on a plan that appears readable.
// Same schema as Stage 1 but explicitly named as recovery to reduce cognitive overlap.
const ROOM_RECOVERY_PROMPT = `You are reading an architectural floor plan.
Stage 1 analysis returned no rooms. Your job is to recover the room schedule.

Read every visible room label. Use it as the "name" field (title case).
Do not return joinery, BIR, CPD, linen or shelf outlines as rooms.
Estimate area (m²) if visible. Use confidence 0.5 for uncertain rooms.
Rooms labelled with a person's name (PAUL, JAN, JANE etc.) are bedrooms — spaceType "bedroom".

SPACE TYPE ASSIGNMENT:
  "bedroom"     — bedroom, master, guest, nursery, personal room
  "living"      — living, lounge, family, rumpus, theatre, media, retreat, activity, multi-use
  "dining"      — dining, meals
  "kitchen"     — kitchen, scullery, butler's pantry, pantry
  "wet_area"    — bathroom, ensuite, WC, powder, toilet
  "laundry"     — laundry, mudroom (with fixtures), utility (with fixtures)
  "laundry"     — combined Butler's Pantry / Laundry, B'Pty / Ldy, Pantry/Laundry
                   (use "name" as written on plan; spaceType "laundry"; do NOT flag manual review)
  "office"      — study, office, library
  "gym"         — gym, exercise
  "robe"        — WIR, walk-in robe, dressing room
  "circulation" — entry, hall, hallway, passage, corridor, lobby, landing, stair
  "service"     — garage, carport, alfresco, verandah, porch, deck, outdoor areas,
                   plant room, electrical, HRV/MVHR, HWS, bin store, servery
  "other"       — anything else

AMBIGUOUS ROOM INSPECTION — inspect every wall before assigning spaceType:
  Multi-Use  Multi-Purpose  MPR  Activity  Retreat  Rumpus  Games  Studio  Gym  Cellar  Bar
  Office  Study  Workshop  Utility  Craft  Hobby  Theatre  Media  Flex  Sunroom
  For each: check every wall for sink, basin, vanity, shower, toilet, laundry tub, kitchenette.
  If wet fixtures found → spaceType "kitchenette" or "wet_area" depending on fixture type.
  If fixture presence is uncertain, include it in fixtures[] (missing = worse than false positive).

FIXTURE INSPECTION — do NOT rely on room labels for plumbing:
Inspect every room interior for drawn symbols against walls.
Wet fixtures → add to fixtures[] (server classifies accordingly):
  sink  basin  vanity  toilet  wc  urinal  shower  laundry tub  utility sink  trough  kitchenette
Dry fixtures → add to fixtures[] for information only:
  oven  cooktop  fridge  dishwasher
Moisture fixtures → add to fixtures[]:
  bath  freestanding bath  spa  sauna

If a room is a split zone (e.g. ensuite within a master suite), set parentRoom to the primary room name.

Also read the floor/sheet title printed on the plan and return it as "floorName" at the top level.
Normalise to title case (e.g. "FIRST FLOOR PLAN" → "First Floor").
If no title is visible: use "Unknown Floor".
Do NOT infer floor name from page order.

IMPORTANT — ONE FLOOR PER SHEET:
You are extracting rooms from ONE floor only — the floor shown on this sheet.
A "Dimensioned Plan", "Set-Out Plan", "Electrical Plan", "Hydraulic Plan", or any
annotated variant is the SAME floor as the corresponding primary floor plan.
Do NOT create rooms named "Ground Floor Bedroom 2" — use "Bedroom 2" only.
Floor assignment is handled by the calling system.

Do NOT generate warnings about missing master bedrooms or incomplete occupancy — this sheet
may be one of several floors in a multi-storey project.

Return ONLY valid JSON. No markdown. No prose.
Do NOT output: classification · containsSecondaryExtractZone · requiresManualReview

{
  "floorName": "Ground Floor",
  "rooms": [
    { "name": "Master Bedroom",
      "spaceType": "bedroom", "area": 18.0, "confidence": 0.8,
      "fixtures": [], "parentRoom": null,
      "bedSpaces": 2, "potentialBedSpaces": 0 },
    { "name": "Kitchen",
      "spaceType": "kitchen", "area": 14.0, "confidence": 0.9,
      "fixtures": ["sink", "dishwasher"], "parentRoom": null,
      "bedSpaces": 0, "potentialBedSpaces": 0 }
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
      model:      EXTRACTION_MODEL,
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
      model_used:   EXTRACTION_MODEL,
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
        model:      EXTRACTION_MODEL,
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
    // Stage 1 parse failed — do NOT return 422.
    // Fall through with empty rooms so Stage 2 (Opus) recovery runs.
    // The audit log insert will happen in the success/failure path below after Stage 2.
    console.warn(JSON.stringify({
      event:      'analyse-plan:stage1-parse-failed',
      model:      EXTRACTION_MODEL,
      parseError: parseError?.message ?? 'unknown',
      rawSnippet: rawText.slice(0, 200),
    }));
  }

  // ── Detect floor name from AI output ────────────────────────────────────
  // AI reads the sheet title printed on the plan (e.g. "FIRST FLOOR" → "First Floor").
  // Falls back to null when parse failed; the caller can supply a label if needed.
  const floorName = typeof parsed?.floorName === 'string' && parsed.floorName.trim()
    ? parsed.floorName.trim()
    : null;

  // ── Resolve rooms — new flat format: parsed.rooms[] with spaceType field.
  const rawRooms  = Array.isArray(parsed?.rooms) ? parsed.rooms : [];
  const allRooms  = rawRooms.map(r => validateRoom(r, floorIndex)).filter(Boolean);
  const supply    = allRooms.filter(r => r.ventilationClassification === 'supply');
  const extract   = allRooms.filter(r => r.ventilationClassification === 'extract');
  const transfer  = allRooms.filter(r => r.ventilationClassification === 'transfer');
  const ignore    = allRooms.filter(r => r.ventilationClassification === 'ignore');

  // occupancySummary is recalculated server-side from room bedSpaces values (see below).
  // The AI is no longer asked to output it — any AI-returned value is intentionally ignored.

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
  // Apply architectural cleanup then derive relational fields (containsSecondaryExtractZone).
  const stage1RawCount = supply.length + extract.length + transfer.length + ignore.length;
  const stage1Cleaned  = deriveRelationalFields(
    postProcessRooms([...supply, ...extract, ...transfer, ...ignore], warnings)
  );
  const stage1RoomCount = stage1Cleaned.length; // post-filter count (debug field)

  let finalSupply   = stage1Cleaned.filter(r => r.ventilationClassification === 'supply');
  let finalExtract  = stage1Cleaned.filter(r => r.ventilationClassification === 'extract');
  let finalTransfer = stage1Cleaned.filter(r => r.ventilationClassification === 'transfer');
  let finalIgnore   = stage1Cleaned.filter(r => r.ventilationClassification === 'ignore');
  let recoveryMode     = false;
  let stage2RoomCount  = null;   // null when Stage 2 was not invoked
  let modelUsed        = EXTRACTION_MODEL;
  let escalationReason = null;   // set when Sonnet → Opus escalation fires

  // If Stage 1 JSON parse failed entirely, force escalation with a specific reason.
  if (!parsed) {
    escalationReason = `Stage 1 JSON parse failed (${EXTRACTION_MODEL}): ${parseError?.message ?? 'unknown'}. Escalating to ${RECOVERY_MODEL}.`;
  }

  // 'success' | 'failed' | null (null triggers Stage 2)
  let analysisStatus = stage1RoomCount > 0 ? 'success' : null;

  // ── Escalation check: did Stage 1 (Sonnet) produce usable results? ───────
  // Even if Stage 1 returned rooms, escalate to Opus if the count is suspiciously
  // low for a plan that was classified as a floor plan (likely missed rooms).
  if (analysisStatus === 'success' && stage1RoomCount < MINIMUM_ROOM_COUNT) {
    escalationReason = `Stage 1 (${EXTRACTION_MODEL}) returned only ${stage1RoomCount} room(s) — below minimum threshold of ${MINIMUM_ROOM_COUNT}. Escalating to ${RECOVERY_MODEL}.`;
    console.log(JSON.stringify({ event: 'analyse-plan:escalation', reason: escalationReason }));
    analysisStatus = null;  // force Stage 2
  }

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
        model:      EXTRACTION_MODEL,
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

  // ── Stage 2: Opus recovery when Stage 1 (Sonnet) fails escalation ──────
  if (analysisStatus === null) {
    if (!escalationReason) {
      escalationReason = `Stage 1 (${EXTRACTION_MODEL}) returned 0 rooms. Escalating to ${RECOVERY_MODEL}.`;
    }
    console.log(JSON.stringify({ event: 'analyse-plan:stage2-recovery', reason: escalationReason, model: RECOVERY_MODEL }));

    let stage2Rooms = [];
    try {
      const stage2Response = await anthropic.messages.create({
        model:      RECOVERY_MODEL,
        max_tokens: 4096,
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
        // Apply same architectural cleanup + relational derivation to Stage 2 results
        stage2Rooms = deriveRelationalFields(postProcessRooms(validated2, warnings));
        stage2RoomCount = stage2Rooms.length;
      }
    } catch (e) {
      console.error('analyse-plan: Stage 2 Claude call failed:', e.message);
    }

    if (stage2Rooms.length > 0) {
      recoveryMode   = true;
      modelUsed      = RECOVERY_MODEL;
      analysisStatus = 'success';
      finalSupply    = stage2Rooms.filter(r => r.ventilationClassification === 'supply');
      finalExtract   = stage2Rooms.filter(r => r.ventilationClassification === 'extract');
      finalTransfer  = stage2Rooms.filter(r => r.ventilationClassification === 'transfer');
      finalIgnore    = stage2Rooms.filter(r => r.ventilationClassification === 'ignore');
      warnings.push(`Room schedule extracted via ${RECOVERY_MODEL} recovery pass — review classifications and airflow values before use.`);
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
            // Only warn on unexpected reclassification (e.g. a labelled bedroom)
            if (/\bbed\b|\bmaster\b|\bstudy\b|\boffice\b/i.test(room.name)) {
              warnings.push(`"${room.name}" reclassified as extract after Stage 3 — ${newWetFixture} detected.`);
            }
          }
          // Only add assumption if Stage 3 changed something worth noting
          if (update.reviewNote && (newWetFixture || update.requiresManualReview)) {
            assumptions.push(`Stage 3: "${room.name}" — ${update.reviewNote}`);
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

        // Re-derive containsSecondaryExtractZone after Stage 3 may have changed classifications
        const allStage3 = [...finalSupply, ...finalExtract, ...finalTransfer, ...finalIgnore];
        const withRelational = deriveRelationalFields(allStage3);
        finalSupply   = withRelational.filter(r => r.ventilationClassification === 'supply');
        finalExtract  = withRelational.filter(r => r.ventilationClassification === 'extract');
        finalTransfer = withRelational.filter(r => r.ventilationClassification === 'transfer');
        finalIgnore   = withRelational.filter(r => r.ventilationClassification === 'ignore');
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
        model_used:        modelUsed,
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
      model:            modelUsed,
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
  // Only add rooms where requiresManualReview is still true after Stage 3 re-inspection.
  const allFinalForReview = [...finalSupply, ...finalExtract, ...finalTransfer, ...finalIgnore];
  const existingCandidateNames = new Set(reviewCandidates.map(c => c.room));
  for (const room of allFinalForReview) {
    if (room.requiresManualReview && !existingCandidateNames.has(room.name)) {
      reviewCandidates.push({
        room:             room.name,
        reason:           'Ambiguous room type — fixture presence uncertain after inspection.',
        roomBoundaryHint: '',
      });
    }
  }

  // ── Enforce output caps ───────────────────────────────────────
  // Truncate to the maximums specified in the prompt. Any genuine outliers that
  // exceeded the cap would already have been de-duped by the prompt rules.
  const MAX_WARNINGS          = 5;
  const MAX_ASSUMPTIONS       = 5;
  const MAX_REVIEW_CANDIDATES = 3;
  if (warnings.length          > MAX_WARNINGS)          warnings.splice(MAX_WARNINGS);
  if (assumptions.length       > MAX_ASSUMPTIONS)       assumptions.splice(MAX_ASSUMPTIONS);
  if (reviewCandidates.length  > MAX_REVIEW_CANDIDATES) reviewCandidates.splice(MAX_REVIEW_CANDIDATES);

  const analysisJson = {
    // Rooms are nested under "rooms" so job-status can read parsed_rooms.rooms.supply etc.
    rooms: { supply: finalSupply, extract: finalExtract, transfer: finalTransfer, ignore: finalIgnore },
    warnings,
    assumptions,
    reviewCandidates,
    analysisStatus: 'success',
    recoveryMode,
    occupancySummary,
    floorName,            // AI-detected floor/sheet title (e.g. "First Floor", "Ground Floor")
    // Model metadata — stored so job-status can surface them in the admin UI
    modelUsed,
    stage1Model:        EXTRACTION_MODEL,
    stage2Model:        recoveryMode ? RECOVERY_MODEL : null,
    escalationReason:   escalationReason ?? null,
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

  // ── Diagnostic: log the projectId actually received ─────────
  console.log(JSON.stringify({
    event:        'analyse-plan:project-link',
    projectId:    projectId ?? null,
    hasValidUuid: isUuid(projectId),
    testMode:     testMode  || false,
    internalCall: internalCall || false,
    floorIndex,
  }));

  if (!isUuid(projectId) && !testMode) {
    // Non-test call with no valid projectId — this will create an unlinked log row.
    // For internal calls (auto-analyse pipeline) this is acceptable only when the upload
    // genuinely has no associated project. Log a warning so it is visible in Vercel logs.
    if (internalCall) {
      console.warn(JSON.stringify({
        event:   'analyse-plan:unlinked-internal-call',
        note:    'Internal analysis with no projectId — plan_analysis_log.project_id will be null',
        pdfPageId:   pdfPageId   ?? null,
        pdfUploadId: pdfUploadId ?? null,
      }));
    } else {
      // Direct (non-internal) call without projectId and not in testMode.
      // This should have been caught by the UUID guard above — log as unexpected.
      console.error(JSON.stringify({
        event: 'analyse-plan:unexpected-missing-projectId',
        note:  'Non-test, non-internal call reached log insert without a valid projectId',
      }));
    }
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
      project_id:        isUuid(projectId) ? projectId : null,
      user_id:           user.id,
      floor_index:       floorIndex,
      credits_deducted:  deductErr ? 0 : creditCost,
      model_used:        modelUsed,
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
    floorName,              // AI-detected floor/sheet title from the plan drawing
    stage1RoomCount,
    stage2RoomCount,
    rooms:                  { supply: finalSupply, extract: finalExtract, transfer: finalTransfer, ignore: finalIgnore },
    occupancySummary,
    reviewCandidates,
    warnings,
    assumptions,
    model:                  modelUsed,
    inputTokens:            totalInputTokens,
    outputTokens:           totalOutputTokens,
    creditsDeducted:        deductErr ? 0 : creditCost,
    newBalance:             newBalance ?? null,
    logId:                  logRow?.id  ?? null,
    logError:               logErr?.message ?? null,
  });
}
