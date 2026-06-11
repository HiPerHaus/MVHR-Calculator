// @ts-check
// ============================================================
// HiPer Engine — Room allocation
// Assigns per-room supply and extract rates before balancing.
// ============================================================

import { DEFAULT_ROOM_RATES } from './constants.js';
import { r1, toLps } from './helpers.js';
import { extractRate, boostExtractRate } from './extract.js';
import { isWC, isEnsuite, isPantryLaundry } from './helpers.js';
import { supplyRate } from './supply.js';

/**
 * Assign supply and extract m³/h to every room.
 *
 * These are the "raw" rates before the balancer adjusts them to the whole-house design flow.
 *
 * @param {object[]} rooms
 * @param {object}   [rates]
 * @returns {object[]}
 */
export function allocateRooms(rooms, rates = DEFAULT_ROOM_RATES) {
  return rooms.map(room => {
    const cls = room.classification;
    const t   = room.room_type;
    const n   = room.name ?? '';

    if (cls === 'ignore') {
      return mkRoom(room, 0, 0, 'ignored');
    }
    if (cls === 'transfer' || t === 'circulation' || t === 'robe') {
      return mkRoom(room, 0, 0, 'transfer');
    }

    // Extract rooms
    const eRate = extractRate(room, rates);
    if (eRate > 0) {
      const bRate = boostExtractRate(room, n);
      let driver = `${t}`;
      if (t === 'wet_area') {
        driver = isWC(n)      ? `wc_${rates.wc_extract_m3h}`
               : isEnsuite(n) ? `ensuite_${rates.ensuite_extract_m3h}`
               :                `bathroom_${rates.bathroom_extract_m3h}`;
      }
      return mkRoom(room, 0, eRate, driver, null, bRate);
    }

    // Supply rooms
    const sRate = supplyRate(room, rates);
    if (sRate > 0) {
      const driver = t === 'bedroom'
        ? `bedroom_${Math.max(room.bed_spaces || 1, 1)}bed`
        : `${t}_fixed`;
      return mkRoom(room, sRate, 0, driver);
    }

    return mkRoom(room, 0, 0, 'unclassified');
  });
}

/**
 * @param {object} room
 * @param {number} supplyM3h
 * @param {number} extractM3h
 * @param {string} driver
 * @param {string|null} [notes]
 * @param {number} [boostExtractM3h]
 * @returns {object}
 */
export function mkRoom(room, supplyM3h, extractM3h, driver, notes = null, boostExtractM3h = 0) {
  return {
    project_room_id:   room.id,
    room_name:         room.name,
    room_type:         room.room_type,
    floor:             room.floor ?? null,
    sort_order:        room.sort_order ?? 0,
    supply_m3h:        supplyM3h,
    extract_m3h:       extractM3h,
    boost_extract_m3h: boostExtractM3h,
    supply_lps:        toLps(supplyM3h),
    extract_lps:       toLps(extractM3h),
    airflow_driver:    driver,
    notes,
  };
}
