// @ts-check
// ============================================================
// HiPer Engine — Extract room logic
// Rate lookup, reduction priority, minimums, boost rates,
// and the whole-house nominal extract demand total.
// ============================================================

import { DEFAULT_ROOM_RATES, EXTRACT_MINIMUMS, BOOST_EXTRACT_RATES } from './constants.js';
import { isWC, isEnsuite, isPantryLaundry } from './helpers.js';

/**
 * Continuous (design) extract rate for a room (m³/h).
 * Returns 0 for supply/transfer rooms.
 * @param {object} room
 * @param {object} [rates]
 * @returns {number}
 */
export function extractRate(room, rates = DEFAULT_ROOM_RATES) {
  const t = room.room_type;
  const n = room.name ?? '';
  if (isPantryLaundry(room, n)) return rates.laundry_extract_m3h;
  if (/pantry/i.test(n))        return rates.pantry_extract_m3h ?? 20;
  if (t === 'kitchen' || t === 'kitchenette') return rates.kitchen_extract_m3h;
  if (t === 'laundry')  return rates.laundry_extract_m3h;
  if (t === 'wet_area') {
    if (isWC(n))      return rates.wc_extract_m3h;
    if (isEnsuite(n)) return rates.ensuite_extract_m3h;
    return rates.bathroom_extract_m3h;
  }
  if (t === 'service') return 15;
  return 0;
}

/**
 * Priority tier for extract reduction during balancing.
 * Lower number = reduced first.
 *   1 = WC/powder  2 = bathroom+ensuite  3 = laundry  4 = pantry  5 = kitchen
 * Returns 0 for rooms that are not extract rooms.
 * @param {object} room
 * @param {string} n  room.name
 * @returns {number}
 */
export function extractReducePriority(room, n) {
  const t = room.room_type;
  if (t === 'wet_area') {
    if (isWC(n)) return 1;
    return 2; // bathroom AND ensuite share tier 2 → proportional reduction
  }
  if (isPantryLaundry(room, n)) return 3;
  if (t === 'laundry') return 3;
  if (/pantry/i.test(n)) return 4;
  if (t === 'kitchen' || t === 'kitchenette') return 5;
  return 0;
}

/**
 * Minimum extract airflow for a room (m³/h) — never reduced below this during balancing.
 * @param {object} room
 * @param {string} n  room.name
 * @returns {number}
 */
export function extractMin(room, n) {
  const t = room.room_type;
  if (isPantryLaundry(room, n)) return EXTRACT_MINIMUMS.laundry;
  if (/pantry/i.test(n))        return EXTRACT_MINIMUMS.pantry;
  if (t === 'kitchen' || t === 'kitchenette') return EXTRACT_MINIMUMS.kitchen;
  if (t === 'laundry')  return EXTRACT_MINIMUMS.laundry;
  if (t === 'wet_area') {
    if (isWC(n))      return EXTRACT_MINIMUMS.wc;
    if (isEnsuite(n)) return EXTRACT_MINIMUMS.ensuite;
    return EXTRACT_MINIMUMS.bathroom;
  }
  return 0;
}

/**
 * Peak / boost extract rate for a room (m³/h) — PHI peak demand.
 * Used only for the boost capacity check; NOT for continuous design airflow.
 * @param {object} room
 * @param {string} n  room.name
 * @returns {number}
 */
export function boostExtractRate(room, n) {
  const t = room.room_type;
  if (isPantryLaundry(room, n)) return BOOST_EXTRACT_RATES.laundry;
  if (/pantry/i.test(n))        return BOOST_EXTRACT_RATES.pantry;
  if (t === 'kitchen' || t === 'kitchenette') return BOOST_EXTRACT_RATES.kitchen;
  if (t === 'laundry')  return BOOST_EXTRACT_RATES.laundry;
  if (t === 'wet_area') {
    if (isWC(n))      return BOOST_EXTRACT_RATES.wc;
    if (isEnsuite(n)) return BOOST_EXTRACT_RATES.ensuite;
    return BOOST_EXTRACT_RATES.bathroom;
  }
  return 0;
}

/**
 * Whole-house nominal extract demand: sum of continuous extract rates for all extract rooms.
 *
 * This is a distinct design criterion from occupancy-based and area-based flows.
 * Per PHI methodology, the continuous design flow must be sufficient to exhaust all
 * extract rooms at their nominal rated flow simultaneously.
 *
 * @param {object[]} rooms
 * @param {object} [rates]
 * @returns {{ extractDemandM3h: number }}
 */
export function calcExtractDemandNominal(rooms, rates = DEFAULT_ROOM_RATES) {
  let total = 0;
  for (const r of rooms) {
    if (r.classification === 'ignore')   continue;
    if (r.classification === 'transfer') continue;
    const t = r.room_type;
    if (t === 'circulation' || t === 'robe') continue;
    total += extractRate(r, rates);
  }
  return { extractDemandM3h: Math.round(total) };
}

/**
 * Whole-house boost demand: sum of PEAK extract rates for all extract rooms.
 * Used as the boost capacity check — the MVHR unit must be able to achieve this
 * flow (or the designer accepts a constrained boost mode).
 *
 * @param {object[]} rooms
 * @returns {{ boostDemandM3h: number }}
 */
export function calcBoostDemand(rooms) {
  let total = 0;
  for (const r of rooms) {
    if (r.classification === 'ignore')   continue;
    if (r.classification === 'transfer') continue;
    const t = r.room_type;
    if (t === 'circulation' || t === 'robe') continue;
    const n = r.name ?? '';
    total += boostExtractRate(r, n);
  }
  return { boostDemandM3h: Math.round(total) };
}
