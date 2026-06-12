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
 * Supply balance profile for a room: priority (higher = receives supply first during
 * proportional balancing) and maximum airflow cap (m³/h).
 * Priority 0 = not adjustable (bedrooms are fixed; non-supply rooms don't participate).
 *
 * Priority table (from spec):
 *   Main Living 100, Family 95, Meals 90, Dining 85, Open Plan 80,
 *   Games/Rumpus 70, Theatre/Cinema/Media 40, Office/Study 20.
 * Max table:
 *   Living/Family/Open Plan 80, Meals/Dining 60, Games/Rumpus 50,
 *   Theatre/Cinema/Media 40, Office 30.
 *
 * @param {object} room
 * @returns {{ priority: number, max: number }}
 */
export function supplyBalanceProfile(room) {
  const t = room.room_type;
  const n = (room.name ?? '').toLowerCase();

  if (t === 'bedroom') return { priority: 0, max: Infinity }; // fixed — not adjustable

  if (t === 'living') {
    if (/\bfamily\b/i.test(n))                                return { priority: 95, max: 80 };
    if (/\bmeals\b/i.test(n))                                 return { priority: 90, max: 60 };
    if (/\bdining\b/i.test(n))                                return { priority: 85, max: 60 };
    if (/\bopen[_\s]?plan\b/i.test(n))                        return { priority: 80, max: 80 };
    if (/\bgames\b|\brumpus\b/i.test(n))                      return { priority: 70, max: 50 };
    if (/\btheatre\b|\bcinema\b|\bmedia[\s_]room\b/i.test(n)) return { priority: 40, max: 40 };
    return { priority: 100, max: 80 }; // main living — highest priority
  }

  if (t === 'dining') return { priority: 85, max: 60 };
  if (t === 'office') return { priority: 20, max: 30 };

  return { priority: 0, max: 0 }; // non-adjustable
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
