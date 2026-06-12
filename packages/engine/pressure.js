// @ts-check
// ============================================================
// HiPer Engine — Duct pressure-drop calculations
// Pure functions; no Supabase imports.
//
// Method: Darcy-Weisbach friction pressure drop with
//         Swamee-Jain explicit approximation to Colebrook-White.
//
// Fitting losses: 50% equivalent-length allowance applied to
//   every segment's friction loss (conservative for MVHR
//   radial layouts with bends and T-pieces).
//   Set FITTING_FACTOR = 1.0 to disable.
//
// Roughness values (absolute, mm):
//   Semi-rigid corrugated PE/PP 90 mm:  ε = 1.5 mm
//   EPP smooth rigid (all sizes):       ε = 0.15 mm
//
// Air properties (20 °C, 50% RH, sea level):
//   ρ = 1.20 kg/m³   ν = 1.50 × 10⁻⁵ m²/s
// ============================================================

import { ductAreaM2, calcVelocityMs } from './duct.js';

/** Air density (kg/m³) */
const RHO = 1.20;

/** Kinematic viscosity (m²/s) */
const NU  = 1.50e-5;

/**
 * Fitting equivalent-length multiplier.
 * 1.5 → 50% extra length for bends, T-pieces, diffusers.
 */
const FITTING_FACTOR = 1.5;

/**
 * Absolute roughness (mm) by duct product type.
 * @type {Record<string, number>}
 */
export const DUCT_ROUGHNESS_MM = {
  semi_rigid_90: 1.5,   // corrugated PE/PP flex duct
  epp_160:       0.15,  // smooth EPP rigid bore
  epp_180:       0.15,
  epp_200:       0.15,
  epp_250:       0.15,
  epp_315:       0.15,
};

/**
 * Moody friction factor via Swamee-Jain explicit approximation
 * to the Colebrook-White equation (ASCE 1976).
 *
 * Valid for: 10^-6 ≤ k (relative roughness) ≤ 0.01;
 *            5 000 ≤ Re ≤ 10^8.
 * Falls back to Hagen-Poiseuille for Re < 2 300 (laminar).
 *
 * @param {number} re          Reynolds number
 * @param {number} roughnessMm Absolute wall roughness (mm)
 * @param {number} diamMm      Duct internal diameter (mm)
 * @returns {number}           Darcy friction factor (dimensionless)
 */
export function frictionFactor(re, roughnessMm, diamMm) {
  if (re <= 0 || diamMm <= 0) return 0.02; // safe default
  if (re < 2300) return 64 / re;           // laminar — Hagen-Poiseuille
  const k = roughnessMm / diamMm;          // relative roughness
  // Swamee-Jain:  f = 0.25 / [ log10( k/3.7 + 5.74 / Re^0.9 ) ]²
  const term = k / 3.7 + 5.74 / Math.pow(re, 0.9);
  if (term <= 0) return 0.02;
  const f = 0.25 / Math.pow(Math.log10(term), 2);
  return Math.max(0.01, f);   // floor prevents division artefacts
}

/**
 * Darcy-Weisbach friction pressure drop for a single duct segment.
 * Includes a 50 % equivalent-length allowance for fittings.
 *
 * ΔP = f × (L_eff / D) × (ρ/2) × v²
 *
 * where L_eff = lengthM × FITTING_FACTOR
 *
 * @param {number} flowM3h   Volumetric flow (m³/h)
 * @param {number} diamMm    Internal duct diameter (mm)
 * @param {number} lengthM   Straight duct length (m)
 * @param {string} [ductType='semi_rigid_90']  Duct product type
 * @returns {number}         Total pressure drop (Pa), ≥ 0
 */
export function segmentPressurePa(flowM3h, diamMm, lengthM, ductType = 'semi_rigid_90') {
  if (!(flowM3h > 0) || !(diamMm > 0) || !(lengthM > 0)) return 0;
  const d    = diamMm / 1000;            // m
  const v    = calcVelocityMs(flowM3h, diamMm);
  const re   = v * d / NU;
  const eps  = DUCT_ROUGHNESS_MM[ductType] ?? 1.5;
  const f    = frictionFactor(re, eps, diamMm);
  const lEff = lengthM * FITTING_FACTOR; // include fitting allowance
  const dp   = f * (lEff / d) * (RHO / 2) * v * v;
  return Math.max(0, dp);
}

/**
 * Specific resistance (Pa/m) for a given flow + diameter.
 * Useful for comparing run efficiency or tabulating resistance.
 *
 * @param {number} flowM3h
 * @param {number} diamMm
 * @param {string} [ductType='semi_rigid_90']
 * @returns {number}  Pa per metre (fitting factor included)
 */
export function specificResistancePam(flowM3h, diamMm, ductType = 'semi_rigid_90') {
  return segmentPressurePa(flowM3h, diamMm, 1, ductType);
}

/**
 * Derive flow (m³/h) from stored velocity + diameter.
 * Used when a run has velocity_m_s but no explicit flow_m3h.
 *
 * @param {number} velocityMs
 * @param {number} diamMm
 * @returns {number}
 */
export function flowFromVelocity(velocityMs, diamMm) {
  if (!(velocityMs > 0) || !(diamMm > 0)) return 0;
  return velocityMs * ductAreaM2(diamMm) * 3600;
}

/**
 * System pressure analysis for an MVHR installation.
 *
 * Identifies the index circuit (longest resistance path) on each side
 * and sums: external (intake + exhaust) + supply index + extract index.
 *
 * Index path per side = main trunk ΔP + worst single terminal leg ΔP.
 * (Conservative: assumes no flow-sharing benefit between parallel legs.)
 *
 * @param {Array<{
 *   flow_m3h:      number|null,
 *   velocity_m_s:  number|null,
 *   diameter_mm:   number,
 *   length_m:      number|null,
 *   duct_type:     string,
 *   run_type:      string,
 *   metadata?:     {run_category?: string}
 * }>} runs
 *
 * @returns {{
 *   externalPa:     number,
 *   supplyMainPa:   number,
 *   supplyIndexPa:  number,
 *   extractMainPa:  number,
 *   extractIndexPa: number,
 *   totalSystemPa:  number,
 *   runPressures:   Array<{id?: string, pressurePa: number}>
 * }}
 */
export function calcSystemPressure(runs) {
  /**
   * Compute pressure for a single run object.
   * Falls back from flow_m3h → velocity_m_s if flow not stored.
   */
  function runPa(r) {
    const flow = r.flow_m3h > 0 ? r.flow_m3h
               : flowFromVelocity(r.velocity_m_s ?? 0, r.diameter_mm);
    return segmentPressurePa(flow, r.diameter_mm, r.length_m ?? 0, r.duct_type);
  }

  const intakeRuns  = runs.filter(r => r.run_type === 'intake');
  const exhaustRuns = runs.filter(r => r.run_type === 'exhaust');

  const supplyMain  = runs.filter(r => r.run_type === 'supply' && r.metadata?.run_category === 'main');
  const supplyTerms = runs.filter(r => r.run_type === 'supply' && r.metadata?.run_category === 'terminal');

  const extractMain  = runs.filter(r => r.run_type === 'extract' && r.metadata?.run_category === 'main');
  const extractTerms = runs.filter(r => r.run_type === 'extract' && r.metadata?.run_category === 'terminal');

  const sumPa  = (arr) => arr.reduce((s, r) => s + runPa(r), 0);
  const maxPa  = (arr) => arr.length === 0 ? 0 : Math.max(...arr.map(r => runPa(r)));

  const externalPa     = sumPa(intakeRuns) + sumPa(exhaustRuns);
  const supplyMainPa   = sumPa(supplyMain);
  const supplyTermPa   = maxPa(supplyTerms);      // worst terminal only (index run)
  const supplyIndexPa  = supplyMainPa + supplyTermPa;
  const extractMainPa  = sumPa(extractMain);
  const extractTermPa  = maxPa(extractTerms);
  const extractIndexPa = extractMainPa + extractTermPa;

  const totalSystemPa = externalPa + supplyIndexPa + extractIndexPa;

  // Round each component individually, then sum for additive consistency.
  const extR     = Math.round(externalPa);
  const supMR    = Math.round(supplyMainPa);
  const supIR    = Math.round(supplyIndexPa);
  const extMR    = Math.round(extractMainPa);
  const extIR    = Math.round(extractIndexPa);
  const totalR   = extR + supIR + extIR;

  // Also produce per-run pressures for stamping back to DB
  const runPressures = runs.map(r => ({
    id:          r.id,
    pressurePa:  Math.round(runPa(r) * 100) / 100,
  }));

  return {
    externalPa:     extR,
    supplyMainPa:   supMR,
    supplyIndexPa:  supIR,
    extractMainPa:  extMR,
    extractIndexPa: extIR,
    totalSystemPa:  totalR,
    runPressures,
  };
}

/**
 * Check whether the computed system pressure is within the unit's
 * external pressure capability.
 *
 * @param {number} totalSystemPa       From calcSystemPressure
 * @param {number|null} unitExtPressure Unit's ext_pressure (Pa)
 * @returns {'ok'|'warning'|'exceed'|'unknown'}
 */
export function systemPressureStatus(totalSystemPa, unitExtPressure) {
  if (!(unitExtPressure > 0)) return 'unknown';
  if (totalSystemPa <= unitExtPressure)          return 'ok';
  if (totalSystemPa <= unitExtPressure * 1.15)   return 'warning'; // within 15%
  return 'exceed';
}
