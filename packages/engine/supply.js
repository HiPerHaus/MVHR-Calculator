// @ts-check
// ============================================================
// HiPer Engine — Supply room logic
// Rate lookup and adjustable-room priority.
// ============================================================

import { DEFAULT_ROOM_RATES } from './constants.js';

/**
 * Priority for supply-side balancing adjustment.
 * Lower number = adjusted first. 0 = fixed (bedrooms, offices, gym — never adjusted).
 *   1 = main living  2 = family room  3 = dining  4 = rumpus  5 = retreat  6 = other living
 * @param {object} srcRoom
 * @returns {number}
 */
export function supplyAdjPriority(srcRoom) {
  const t = srcRoom.room_type;
  const n = (srcRoom.name ?? '').toLowerCase();
  if (t === 'living') {
    if (/family/i.test(n))  return 2;
    if (/dining/i.test(n))  return 3;
    if (/rumpus/i.test(n))  return 4;
    if (/retreat/i.test(n)) return 5;
    if (/media|games|lounge|second|2nd/i.test(n)) return 6;
    return 1; // main living — highest priority
  }
  if (t === 'dining') return 3;
  return 0; // fixed
}

/**
 * Design supply rate for a room (m³/h).
 * Returns 0 for extract/transfer/ignored rooms and non-ventilated spaces.
 * @param {object} room
 * @param {object} [rates]
 * @returns {number}
 */
export function supplyRate(room, rates = DEFAULT_ROOM_RATES) {
  const t   = room.room_type;
  const cls = room.classification;
  const n   = room.name ?? '';

  if (cls === 'ignore' || cls === 'transfer') return 0;
  if (t === 'circulation' || t === 'robe')    return 0;

  switch (t) {
    case 'bedroom': {
      const beds = Math.max(room.bed_spaces || 1, 1);
      if (beds === 1) return rates.bedroom_single_m3h;
      return rates.bedroom_double_m3h + (beds - 2) * rates.bedroom_extra_person_m3h;
    }
    case 'living': {
      if (/retreat|rumpus|media|games|family|lounge 2|living 2/i.test(n)) return rates.second_living_m3h;
      return rates.living_m3h;
    }
    case 'dining':   return rates.dining_m3h;
    case 'office':   return 20;
    case 'gym':      return 30;
    default:
      if (cls === 'supply') return 15;
      return 0;
  }
}
