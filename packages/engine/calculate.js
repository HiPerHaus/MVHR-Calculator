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

import { ENGINE_VERSION, DEFAULT_ROOM_RATES, DEFAULT_BOOST_SETTINGS, AREA_RATE, PHI_MIN_ACH } from './constants.js';
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
 * @param {object}   [settings]     — boost settings and optional canonicalGeometry
 * @returns {CalculationResult}
 */
export function calculateAirflow(rooms, method, userRates = {}, settings = {}) {
  const rates = { ...DEFAULT_ROOM_RATES, ...userRates };

  // ── Boost / fan-speed settings (with defaults) ────────────────
  const boostMethod    = settings.boost_method
    ?? DEFAULT_BOOST_SETTINGS.boost_method;
  const boostOffsetPct = Number(settings.boost_airflow_offset_pct
    ?? DEFAULT_BOOST_SETTINGS.boost_airflow_offset_pct);
  const lowOffsetPct   = Number(settings.low_airflow_offset_pct
    ?? DEFAULT_BOOST_SETTINGS.low_airflow_offset_pct);

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

  // Room-based boost: always computed for validation (independent of methodology).
  const roomBoostDemandM3h = Math.round(roomResults.reduce((s, r) => s + (r.boost_extract_m3h || 0), 0));


  const {
    treatedAreaM2, areaFlowM3h, hasAreaData,
    areaWithCount, areaExpectedCount,
  } = calcAreaFlow(rooms, method);

  // ACH floor (volume-based minimum) — independent of the other candidates
  const roomAchFloor = calcAchFloor(rooms);
  const canonicalGeometry = settings.canonicalGeometry ?? null;
  const canonicalVolumeM3 = Number(canonicalGeometry?.buildingVolumeM3 ?? 0);
  const canonicalAreaM2 = Number(canonicalGeometry?.conditionedFloorAreaM2 ?? 0);
  const areaRate = AREA_RATE[method] ?? 1.0;
  const resolvedTreatedAreaM2 = canonicalAreaM2 > 0 ? r1(canonicalAreaM2) : treatedAreaM2;
  const resolvedAreaFlowM3h = canonicalAreaM2 > 0 ? r0(canonicalAreaM2 * areaRate) : areaFlowM3h;
  const resolvedHasAreaData = canonicalAreaM2 > 0 ? true : hasAreaData;
  const achFloor = canonicalVolumeM3 > 0
    ? {
        hasVolumeData: true,
        totalVolumeM3: r1(canonicalVolumeM3),
        minFlowForAchM3h: Math.ceil(PHI_MIN_ACH * canonicalVolumeM3),
        achMinimum: roomAchFloor.achMinimum,
      }
    : roomAchFloor;

  // Collect all valid continuous candidates (boost is never included)
  const candidates = /** @type {{ label: string, value: number }[]} */ ([
    { label: 'occupancy',      value: occupancyFlowM3h },
    { label: 'extract_demand', value: extractDemandM3h },
  ]);
  if (resolvedHasAreaData) {
    candidates.push({ label: 'area', value: resolvedAreaFlowM3h });
  }
  if (achFloor.hasVolumeData && achFloor.minFlowForAchM3h > 0) {
    candidates.push({ label: 'ach_minimum', value: achFloor.minFlowForAchM3h });
  }

  const maxCandidate = candidates.reduce((best, c) => c.value > best.value ? c : best);
  const designFlowM3h = r0(maxCandidate.value);
  const designDriver  = /** @type {'occupancy'|'extract_demand'|'area'|'ach_minimum'} */ (maxCandidate.label);

  // ── 2b. Boost and fan-speed targets (depend on designFlowM3h) ──
  // Configured boost flow (unit selection + commissioning).
  const boostFlowM3h = boostMethod === 'percentage'
    ? Math.round(designFlowM3h * (1 + boostOffsetPct / 100))
    : roomBoostDemandM3h; // room_based method

  // Low speed target.
  const lowFlowM3h = Math.round(designFlowM3h * (1 + lowOffsetPct / 100));

  // Validation warning: configured boost may under-serve room peak demand.
  const boostWarning = roomBoostDemandM3h > boostFlowM3h;

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
    treatedAreaM2: resolvedTreatedAreaM2,
    areaFlowM3h: resolvedAreaFlowM3h,
    hasAreaData: resolvedHasAreaData,
    areaWithCount,
    areaExpectedCount,
    boostFlowM3h,
    roomBoostDemandM3h,    // always room-based (validation)
    lowFlowM3h,
    boostMethod,
    boostOffsetPct,
    lowOffsetPct,
    boostWarning,
    boostDemandM3h: boostFlowM3h, // backward-compat alias

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
