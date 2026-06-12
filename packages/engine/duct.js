// @ts-check
// ============================================================
// HiPer Engine — Duct velocity & sizing
// Pure functions; no Supabase imports.
//
// PH velocity limits (PHI Good Practice Guide):
//   main     ≤ 3.0 m/s  — trunk from MVHR, external intake/exhaust
//   branch   ≤ 2.5 m/s  — manifold to sub-distribution node
//   terminal ≤ 2.0 m/s  — last leg to room supply/extract terminal
//
// Standard sizes cover EPP rigid (≥ 160) and semi-rigid (≤ 125).
// ============================================================

/** Standard MVHR circular duct diameters (mm), ascending. */
export const STANDARD_DIAMETERS_MM = [90, 100, 110, 125, 150, 160, 180, 200, 250, 315];

/**
 * PH velocity limits by run category (m/s).
 * @type {{ main: number, branch: number, terminal: number }}
 */
export const PH_VELOCITY_LIMITS_MS = {
  main:     3.0,
  branch:   2.5,
  terminal: 2.0,
};

/**
 * Cross-sectional area of a circular duct (m²).
 * @param {number} diamMm
 * @returns {number}
 */
export function ductAreaM2(diamMm) {
  return Math.PI * Math.pow(diamMm / 2000, 2);
}

/**
 * Duct air velocity (m/s).
 * @param {number} flowM3h
 * @param {number} diamMm
 * @returns {number}
 */
export function calcVelocityMs(flowM3h, diamMm) {
  if (!(flowM3h > 0) || !(diamMm > 0)) return 0;
  return (flowM3h / 3600) / ductAreaM2(diamMm);
}

/**
 * Minimum duct diameter (mm, raw — not snapped to a standard size)
 * to keep velocity ≤ maxVelocityMs.
 * @param {number} flowM3h
 * @param {number} maxVelocityMs
 * @returns {number}
 */
export function minDiameterMm(flowM3h, maxVelocityMs) {
  return 1000 * Math.sqrt(4 * flowM3h / (Math.PI * maxVelocityMs * 3600));
}

/**
 * Select the smallest standard diameter (mm) that keeps velocity within
 * the PH limit for the given run category.
 *
 * @param {number} flowM3h
 * @param {'main'|'branch'|'terminal'} [category='main']
 * @returns {number}  always a value from STANDARD_DIAMETERS_MM (max 315)
 */
export function selectDiameterMm(flowM3h, category = 'main') {
  if (!(flowM3h > 0)) return STANDARD_DIAMETERS_MM[0];
  const limit = PH_VELOCITY_LIMITS_MS[category] ?? PH_VELOCITY_LIMITS_MS.main;
  const dMin  = minDiameterMm(flowM3h, limit);
  return STANDARD_DIAMETERS_MM.find(d => d >= dMin) ?? 315;
}

/**
 * Velocity compliance status against the PH limit for the given run category.
 * 'ok'      — at or below limit
 * 'warning' — 0–10 % over limit (amber)
 * 'exceed'  — more than 10 % over limit (red)
 *
 * @param {number} velocityMs
 * @param {'main'|'branch'|'terminal'} [category='main']
 * @returns {'ok'|'warning'|'exceed'}
 */
export function velocityStatus(velocityMs, category = 'main') {
  const limit = PH_VELOCITY_LIMITS_MS[category] ?? PH_VELOCITY_LIMITS_MS.main;
  if (velocityMs <= limit)          return 'ok';
  if (velocityMs <= limit * 1.10)   return 'warning';
  return 'exceed';
}

/**
 * Map a diameter (mm) to a duct product type string used in the DB.
 * Semi-rigid for ≤ 125; EPP rigid for ≥ 150.
 * @param {number} diamMm
 * @returns {string}
 */
export function diameterToDuctType(diamMm) {
  if (diamMm <= 125) return 'semi_rigid_90';
  if (diamMm <= 160) return 'epp_160';
  if (diamMm <= 180) return 'epp_180';
  if (diamMm <= 200) return 'epp_200';
  if (diamMm <= 250) return 'epp_250';
  return 'epp_315';
}
