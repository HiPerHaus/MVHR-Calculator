// @ts-check
// ============================================================
// HiPer Engine — Occupancy-based design flow
// ============================================================

import { r0 } from './helpers.js';

/**
 * Occupancy-based design flow: totalBedSpaces × 30 m³/h.
 *
 * Per PHI Good Practice Guide: 30 m³/h per person (occupant).
 * Bed-spaces are used as a proxy for occupancy.
 *
 * @param {object[]} rooms
 * @returns {{ occupancyCount: number, occupancyFlowM3h: number }}
 */
export function calcOccupancyFlow(rooms) {
  let count = 0;
  for (const r of rooms) {
    if (r.room_type === 'bedroom' && r.classification !== 'ignore') {
      count += Math.max(r.bed_spaces || 1, 1);
    }
  }
  return { occupancyCount: count, occupancyFlowM3h: r0(count * 30) };
}
