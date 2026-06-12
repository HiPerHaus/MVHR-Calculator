// @ts-check
// ============================================================
// HiPer Engine — Main calculation entry point
//
// Design flow basis (PHI-compliant):
//   designFlow = max(occupancyFlow, extractDemandNominal, areaFlow, achMinimumFlow)
//
// Each candidate is explained:
//   occupancyFlow    = bedSpaces × 30 m³/h  (people-based)
//   extractDemandNominal = sum of continuous extract rates  (wet-side demand)
//   areaFlow         = TFA × method rate  (fabric-based, suppressed if <80% rooms have area)
//   achMinimumFlow   = 0.30 ACH × treated volume  (PHI minimum, suppressed if no area data)
//
// The designDriver reports which criterion governed.
// ============================================================

import { ENGINE_VERSION, DEFAULT_ROOM_RATES } from './constants.js';
import { r0, r1, toLps } from './helpers.js';
import { calcOccupancyFlow } from './occupancy.js';
import { calcAreaFlow } from './area.js';
import { calcExtractDemandNominal, calcBoostDemand } from './extract.js';
import { calcAchFloor, calcAchAtDesign } from './ach.js';
import { allocateRooms } from './allocation.js';
import { balanceDesign } from './balance.js';

/**
 * @typedef {{
 *   // Design basis
 *   engineVersion:        string,
 *   occupancyCount:       number,
 *   occupancyFlowM3h:     number,
 *   extractDemandM3h:     number,
 *   treatedAreaM2:        number,
 *   areaFlowM3h:          number,
 *   hasAreaData:          boolean,
 *   areaWithCount:        number,
 *   areaExpectedCount:    number,
 *   boostDemandM3h:       number,
 *   designFlowM3h:        number,
 *   designFlowLps:        number,
 *   designDriver:         'occupancy'|'extract_demand'|'area'|'ach_minimum',
 *   // ACH compliance
 *   hasVolumeData:        boolean,
 *   totalVolumeM3:        number,
 *   achAtDesign:          number | null,
 *   achPasses:            boolean | null,
 *   achMinimum:           number,
 *   // Room totals
 *   totalSupplyM3h:       number,
 *   totalExtractM3h:      number,
 *   totalSupplyLps:       number,
 *   totalExtractLps:      number,
 *   adjustmentM3h:                          number,
 *   balanceStatus:                          string,
 *   supplyDeficitM3h:                       number,
 *   recommendedRoomsForAdditionalTerminals: string[],
 *   roomResults:          object[],
 * }} CalculationResult
 */

/**
 * Full MVHR airflow design calculation.
 *
 * @param {object[]} rooms          — confirmed project_rooms rows
 * @param {string}   method         — 'passive_house' | 'as1668'
 * @param {object}   [userRates]    — override DEFAULT_ROOM_RATES
 * @returns {CalculationResult}
 */
export function calculateAirflow(rooms, method, userRates = {}) {
  const rates = { ...DEFAULT_ROOM_RATES, ...userRates };

  // ── 1. Whole-house design candidates ─────────────────────────

  const { occupancyCount, occupancyFlowM3h }  = calcOccupancyFlow(rooms);
  const { extractDemandM3h }                   = calcExtractDemandNominal(rooms, rates);
  const {
    treatedAreaM2, areaFlowM3h, hasAreaData,
    areaWithCount, areaExpectedCount,
  } = calcAreaFlow(rooms, method);

  const { boostDemandM3h } = calcBoostDemand(rooms);

  // ACH floor (volume-based minimum) — independent of the other candidates
  const achFloor = calcAchFloor(rooms);

  // Collect all valid candidates and pick the maximum
  const candidates = /** @type {{ label: string, value: number }[]} */ ([
    { label: 'occupancy',      value: occupancyFlowM3h },
    { label: 'extract_demand', value: extractDemandM3h },
  ]);
  if (hasAreaData) {
    candidates.push({ label: 'area', value: areaFlowM3h });
  }
  if (achFloor.hasVolumeData && achFloor.minFlowForAchM3h > 0) {
    candidates.push({ label: 'ach_minimum', value: achFloor.minFlowForAchM3h });
  }

  const maxCandidate = candidates.reduce((best, c) => c.value > best.value ? c : best);
  const designFlowM3h = r0(maxCandidate.value);
  const designDriver  = /** @type {'occupancy'|'extract_demand'|'area'|'ach_minimum'} */ (maxCandidate.label);

  // ── 2. ACH achieved at design flow (reporting only) ──────────
  const achReport = achFloor.hasVolumeData
    ? calcAchAtDesign(achFloor.totalVolumeM3, designFlowM3h)
    : { achAtDesign: null, achPasses: null };

  // ── 3. Room allocations (fixed rates, independent of design flow) ──
  let roomResults = allocateRooms(rooms, rates);

  // ── 4. Balance supply and extract to the design flow target ──
  const { roomResults: balanced, adjustmentM3h, balanceStatus, supplyDeficitM3h, recommendedRoomsForAdditionalTerminals } =
    balanceDesign(roomResults, rooms, designFlowM3h);

  // ── 5. Final totals ───────────────────────────────────────────
  const totalSupplyM3h  = r1(balanced.reduce((s, r) => s + r.supply_m3h,  0));
  const totalExtractM3h = r1(balanced.reduce((s, r) => s + r.extract_m3h, 0));

  return {
    engineVersion:     ENGINE_VERSION,

    // Design candidates
    occupancyCount,
    occupancyFlowM3h,
    extractDemandM3h,
    treatedAreaM2,
    areaFlowM3h,
    hasAreaData,
    areaWithCount,
    areaExpectedCount,
    boostDemandM3h,

    // Chosen design flow
    designFlowM3h,
    designFlowLps:   toLps(designFlowM3h),
    designDriver,

    // ACH compliance
    hasVolumeData:   achFloor.hasVolumeData,
    totalVolumeM3:   achFloor.totalVolumeM3,
    achAtDesign:     achReport.achAtDesign,
    achPasses:       achReport.achPasses,
    achMinimum:      achFloor.achMinimum,

    // Room totals after balancing
    totalSupplyM3h,
    totalExtractM3h,
    totalSupplyLps:  toLps(totalSupplyM3h),
    totalExtractLps: toLps(totalExtractM3h),

    // Balancing
    adjustmentM3h,
    supplyDeficitM3h,
    recommendedRoomsForAdditionalTerminals,
    balanceStatus,

    roomResults: balanced,
  };
}
