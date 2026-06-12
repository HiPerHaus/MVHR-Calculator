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
// Note: extractDemandM3h and boostDemandM3h are derived from allocateRooms() below
// (calcExtractDemandNominal / calcBoostDemand retained in extract.js for external use only)
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

  // ── 1. Room allocations ─────────────────────────────────────
  //    Run first — extractDemandM3h and boostDemandM3h are derived
  //    from these results, guaranteeing they match the room schedule.
  //    allocateRooms correctly excludes ignored, transfer, circulation,
  //    and robe rooms; calcExtractDemandNominal previously missed the
  //    transfer check, causing the demand to exceed total_extract_m3h.
  let roomResults = allocateRooms(rooms, rates);

  // ── 2. Whole-house design candidates ─────────────────────────
  const { occupancyCount, occupancyFlowM3h } = calcOccupancyFlow(rooms);

  // Continuous extract demand = pre-balancing sum of per-room extract.
  // Derived from allocateRooms so ignored/transfer/circulation/robe rooms
  // are correctly excluded — consistent with what the room schedule will show.
  const extractDemandM3h = Math.round(roomResults.reduce((s, r) => s + r.extract_m3h, 0));

  // Boost demand = peak capacity check only — never a design-flow candidate.
  const boostDemandM3h = Math.round(roomResults.reduce((s, r) => s + (r.boost_extract_m3h || 0), 0));

  const {
    treatedAreaM2, areaFlowM3h, hasAreaData,
    areaWithCount, areaExpectedCount,
  } = calcAreaFlow(rooms, method);

  // ACH floor (volume-based minimum) — independent of the other candidates
  const achFloor = calcAchFloor(rooms);

  // Collect all valid continuous candidates (boost is never included)
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

  // ── 3. ACH achieved at design flow (reporting only) ──────────
  const achReport = achFloor.hasVolumeData
    ? calcAchAtDesign(achFloor.totalVolumeM3, designFlowM3h)
    : { achAtDesign: null, achPasses: null };

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
