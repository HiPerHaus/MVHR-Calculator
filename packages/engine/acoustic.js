// @ts-check
// ============================================================
// HiPer Engine — Terminal acoustic estimation
// Pure functions; no Supabase imports.
//
// Method: velocity-based empirical noise model.
//
//   Lw = BASE_dBA + 50 · log₁₀(v)
//
// where BASE_dBA is the estimated sound power level (dBA at
// 1 m from diffuser face) at v = 1.0 m/s, and the exponent
// 50 encodes a v⁵ turbulence-noise dependency — standard for
// orifice/valve terminal units.
//
// Reference levels calibrated against typical MVHR diffuser
// data (Zehnder ComfoValve, Paul Novus, Blauberg CL):
//   Semi-rigid corrugated neck, 90 mm:  BASE = 20 dBA
//   EPP smooth bore (all sizes):        BASE = 15 dBA
//
// Thresholds (BS 8233:2014 / PassivHaus):
//   Bedroom / ensuite:  25 dBA → attenuator recommended
//                       30 dBA → non-compliant
//   General spaces:     35 dBA → attenuator recommended
//                       40 dBA → non-compliant
// ============================================================

/**
 * Base sound power level (dBA at 1 m) at reference velocity 1.0 m/s.
 * @type {Record<string, number>}
 */
export const ACOUSTIC_BASE_DBA = {
  semi_rigid_90: 20,
  epp_160:       15,
  epp_180:       15,
  epp_200:       15,
  epp_250:       15,
  epp_315:       15,
  custom:        20,
};

/**
 * Velocity-to-noise exponent in dB domain.
 * 50 = 10 × 5, encoding a v⁵ turbulent-jet noise relationship.
 */
const V_EXP_DB = 50;

/**
 * Per-category acoustic thresholds (dBA at 1 m from diffuser).
 * attenuator: level at which an in-line attenuator is recommended.
 * exceed:     level at which the design is considered non-compliant.
 */
export const ACOUSTIC_THRESHOLDS = {
  bedroom: { attenuator: 25, exceed: 30 },
  general: { attenuator: 35, exceed: 40 },
};

/**
 * Estimate terminal radiated noise (dBA at 1 m from diffuser face)
 * using velocity at the terminal neck.
 *
 * Lw = BASE + 50 · log₁₀(max(v, 0.01))
 *
 * Typical values (semi-rigid, BASE = 20 dBA):
 *   1.0 m/s →  20 dBA   (quiet)
 *   1.5 m/s →  29 dBA   (approaching bedroom limit)
 *   2.0 m/s →  35 dBA   (general-space attenuator zone)
 *   2.5 m/s →  40 dBA   (non-compliant general)
 *
 * @param {number} velocityMs  Velocity at terminal neck (m/s)
 * @param {string} [ductType='semi_rigid_90']
 * @returns {number}  Estimated dBA; 0 for zero/negative velocity
 */
export function terminalDbaEstimate(velocityMs, ductType = 'semi_rigid_90') {
  if (!(velocityMs > 0)) return 0;
  const base = ACOUSTIC_BASE_DBA[ductType] ?? 20;
  return base + V_EXP_DB * Math.log10(Math.max(velocityMs, 0.01));
}

/**
 * Return true when a room name indicates a noise-sensitive bedroom space.
 *
 * @param {string} roomName
 * @returns {boolean}
 */
export function isBedroom(roomName) {
  return /bed|master|ensuite|sleep/i.test(roomName ?? '');
}

/**
 * Determine acoustic compliance status for a terminal.
 *
 * @param {number} dba       Estimated dBA from terminalDbaEstimate
 * @param {string} [roomName='']
 * @returns {'ok'|'attenuator'|'exceed'}
 */
export function acousticStatus(dba, roomName = '') {
  const thresholds = isBedroom(roomName)
    ? ACOUSTIC_THRESHOLDS.bedroom
    : ACOUSTIC_THRESHOLDS.general;
  if (dba > thresholds.exceed)     return 'exceed';
  if (dba > thresholds.attenuator) return 'attenuator';
  return 'ok';
}
