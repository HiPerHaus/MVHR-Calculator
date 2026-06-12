// @ts-check
// ============================================================
// HiPer Engine — Constants
// Passive House methodology defaults and reference values.
// All constants are pure data — no imports, no side effects.
// ============================================================

/** Engine semantic version — stamped on every airflow_designs row. */
export const ENGINE_VERSION = '1.0.0';

// ── PHI compliance thresholds ─────────────────────────────────
/** Minimum average ACH for Passive House (30% per hour). */
export const PHI_MIN_ACH = 0.30;
/** Minimum heat recovery efficiency for PHI compliance (fraction, not %). */
export const PHI_MIN_HR_EFF = 0.75;
/** Maximum specific fan power for PHI compliance (Wh/m³). */
export const PHI_MAX_SFP = 0.45;

// ── Assumed ceiling height when room-level data absent ────────
export const DEFAULT_CEILING_HEIGHT_M = 2.4;

// ── Per-m² area flow rates (m³/h per m²) ─────────────────────
/**
 * Area-based design flow rates by design method.
 * passive_house: 1.0 m³/h·m² (PHI Good Practice Guide, equivalent to ~0.42 ACH at 2.4 m).
 * as1668: 1.5 m³/h·m² (NCC / AS1668 minimum).
 */
export const AREA_RATE = {
  passive_house: 1.0,
  as1668:        1.5,
};

// ── Default room airflow rates (m³/h) ─────────────────────────
// Normal / continuous design rates. NOT peak/boost.
// Match the defaults in api/studio/settings.js.
export const DEFAULT_ROOM_RATES = {
  bedroom_single_m3h:       20,
  bedroom_double_m3h:       30,
  bedroom_extra_person_m3h: 10,
  living_m3h:               40,
  second_living_m3h:        25,
  dining_m3h:               20,
  kitchen_extract_m3h:      40,
  pantry_extract_m3h:       20,
  bathroom_extract_m3h:     30,  // continuous rate (boost = 40)
  ensuite_extract_m3h:      30,  // continuous rate (boost = 40)
  laundry_extract_m3h:      25,  // continuous rate (boost = 40)
  wc_extract_m3h:           20,
};

// ── Minimum extract airflow per room type (m³/h) ──────────────
// Never reduce below these values during supply/extract balancing.
// Source: PHI Good Practice Guide minimum ventilation requirements.
export const EXTRACT_MINIMUMS = {
  kitchen:  30,
  pantry:   15,
  laundry:  15,
  bathroom: 20,
  ensuite:  20,
  wc:       10,
};

// ── Boost / peak extract rates (m³/h) ─────────────────────────
// PHI Good Practice Guide peak demand rates.
// Used only for the boost capacity check — NOT for continuous design airflow.
export const BOOST_EXTRACT_RATES = {
  kitchen:  60,
  bathroom: 40,
  ensuite:  40,
  laundry:  40,
  wc:       20,
  pantry:   20,
};

// ── Boost / fan-speed methodology defaults ────────────────────
// Used when no project-level or user-level override is supplied.
// boost_method:
//   'percentage'  — boostFlow = designFlow × (1 + boost_airflow_offset_pct / 100)
//   'room_based'  — boostFlow = sum(room.boost_extract_m3h)
export const DEFAULT_BOOST_SETTINGS = {
  boost_method:             'percentage',
  boost_airflow_offset_pct: 30,   // +30% above design airflow
  low_airflow_offset_pct:   -30,  // −30% below design airflow
};


// ── Area calculation exclusions ───────────────────────────────
// Classifications excluded from both the area sum and the ACH volume sum.
// 'ignore' = deliberately excluded (garages, plant rooms).
// 'transfer' = circulation/robe spaces (no ventilation, not habitable volume).
export const AREA_EXCLUDE_CLASSIFICATIONS = new Set(['ignore', 'transfer']);
// Room types excluded from area sum and ACH volume sum regardless of classification.
export const AREA_EXCLUDE_TYPES           = new Set(['service', 'robe', 'circulation']);

// Room types expected to carry valid area data for the COMPLETENESS CHECK.
// Only supply-side habitable rooms are expected to have known floor areas;
// extract rooms (kitchen, wet_area, laundry) use fixed rates and may lack area.
// If fewer than AREA_COMPLETENESS_THRESHOLD of these have area > 0,
// the area-based calculation is suppressed.
// NOTE: extract rooms still contribute to the area SUM when they do carry area data.
export const AREA_EXPECTED_TYPES = new Set([
  'bedroom', 'living', 'dining', 'office', 'gym',
]);
export const AREA_COMPLETENESS_THRESHOLD = 0.80; // 80 %
