// @ts-check
// ============================================================
// HiPer Engine — Area-based design flow
// ============================================================

import { r0, r1 } from './helpers.js';
import {
  AREA_RATE,
  AREA_EXCLUDE_CLASSIFICATIONS,
  AREA_EXCLUDE_TYPES,
  AREA_EXPECTED_TYPES,
  AREA_COMPLETENESS_THRESHOLD,
} from './constants.js';

/**
 * Area-based design flow: treatedArea × method rate (m³/h per m²).
 *
 * Returns hasAreaData=false when fewer than 80% of habitable rooms have area > 0,
 * since a partial area total would produce a misleading (under-sized) result.
 *
 * @param {object[]} rooms
 * @param {string}   method  'passive_house' | 'as1668'
 * @returns {{
 *   treatedAreaM2:    number,
 *   areaFlowM3h:      number,
 *   hasAreaData:      boolean,
 *   areaWithCount:    number,
 *   areaExpectedCount:number,
 * }}
 */
export function calcAreaFlow(rooms, method) {
  const rate = AREA_RATE[method] ?? 1.0;

  const habitableRooms = rooms.filter(r =>
    !AREA_EXCLUDE_CLASSIFICATIONS.has(r.classification) &&
    !AREA_EXCLUDE_TYPES.has(r.room_type) &&
    AREA_EXPECTED_TYPES.has(r.room_type)
  );
  const withArea    = habitableRooms.filter(r => r.area > 0);
  const missingArea = habitableRooms.filter(r => !(r.area > 0));
  const completeness = habitableRooms.length > 0
    ? withArea.length / habitableRooms.length
    : 0;

  if (completeness < AREA_COMPLETENESS_THRESHOLD) {
    return {
      treatedAreaM2: 0, areaFlowM3h: 0, hasAreaData: false,
      areaWithCount: withArea.length, areaExpectedCount: habitableRooms.length,
    };
  }

  let area = 0;
  for (const r of rooms) {
    if (AREA_EXCLUDE_CLASSIFICATIONS.has(r.classification)) continue;
    if (AREA_EXCLUDE_TYPES.has(r.room_type))                continue;
    if (!(r.area > 0))                                      continue;
    area += r.area;
  }

  return {
    treatedAreaM2:     r1(area),
    areaFlowM3h:       r0(area * rate),
    hasAreaData:       true,
    areaWithCount:     withArea.length,
    areaExpectedCount: habitableRooms.length,
  };
}
