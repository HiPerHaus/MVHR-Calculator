// @ts-check
// ============================================================
// HiPer Engine — ACH (Air Changes per Hour) compliance check
// PHI minimum: 0.30 ACH averaged across the treated floor area.
// ============================================================

import { r2 } from './helpers.js';
import {
  PHI_MIN_ACH,
  DEFAULT_CEILING_HEIGHT_M,
  AREA_EXCLUDE_CLASSIFICATIONS,
  AREA_EXCLUDE_TYPES,
} from './constants.js';

/**
 * Calculate the minimum design flow required to satisfy the PHI 0.30 ACH minimum,
 * based on the treated volume of the dwelling.
 *
 * Volume = sum(area × ceiling_height_m) for all non-excluded rooms with valid area.
 * Falls back to DEFAULT_CEILING_HEIGHT_M (2.4 m) if ceiling_height_m is absent.
 *
 * Returns hasVolumeData=false if no rooms contribute area (ACH check not possible).
 *
 * @param {object[]} rooms
 * @returns {{
 *   hasVolumeData:     boolean,
 *   totalVolumeM3:     number,
 *   minFlowForAchM3h:  number,  // ceil(PHI_MIN_ACH × totalVolumeM3) — the fourth design-flow candidate
 *   achMinimum:        number,  // 0.30
 * }}
 */
export function calcAchFloor(rooms) {
  let totalVolume = 0;

  for (const r of rooms) {
    if (AREA_EXCLUDE_CLASSIFICATIONS.has(r.classification)) continue;
    if (AREA_EXCLUDE_TYPES.has(r.room_type))                continue;
    if (!(r.area > 0))                                      continue;
    const h = (r.ceiling_height_m ?? DEFAULT_CEILING_HEIGHT_M);
    totalVolume += r.area * h;
  }

  if (totalVolume <= 0) {
    return { hasVolumeData: false, totalVolumeM3: 0, minFlowForAchM3h: 0, achMinimum: PHI_MIN_ACH };
  }

  return {
    hasVolumeData:    true,
    totalVolumeM3:    r2(totalVolume),
    minFlowForAchM3h: Math.ceil(PHI_MIN_ACH * totalVolume),
    achMinimum:       PHI_MIN_ACH,
  };
}

/**
 * Compute the actual ACH achieved at a given design flow.
 * Call this AFTER designFlowM3h has been determined (uses calcAchFloor output).
 *
 * @param {number} totalVolumeM3
 * @param {number} designFlowM3h
 * @returns {{
 *   achAtDesign: number,
 *   achPasses:   boolean,
 * }}
 */
export function calcAchAtDesign(totalVolumeM3, designFlowM3h) {
  if (totalVolumeM3 <= 0) return { achAtDesign: 0, achPasses: false };
  const rawAch = designFlowM3h / totalVolumeM3;
  return { achAtDesign: r2(rawAch), achPasses: rawAch >= PHI_MIN_ACH };
}
