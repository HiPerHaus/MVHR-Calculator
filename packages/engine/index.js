// @ts-check
// ============================================================
// HiPer Engine — public API
// All pure functions; no Supabase, no I/O.
// ============================================================

export { ENGINE_VERSION } from './constants.js';
export { calculateAirflow } from './calculate.js';
export { scoreMvhrUnits } from './units.js';
export { calcAchFloor, calcAchAtDesign } from './ach.js';
export { calcOccupancyFlow } from './occupancy.js';
export { calcAreaFlow } from './area.js';
export { calcExtractDemandNominal, calcBoostDemand } from './extract.js';
export { balanceDesign } from './balance.js';
export { allocateRooms } from './allocation.js';
export { DEFAULT_ROOM_RATES, PHI_MIN_ACH, PHI_MIN_HR_EFF, PHI_MAX_SFP } from './constants.js';
export {
  STANDARD_DIAMETERS_MM, PH_VELOCITY_LIMITS_MS,
  ductAreaM2, calcVelocityMs, minDiameterMm,
  selectDiameterMm, velocityStatus, diameterToDuctType,
} from './duct.js';
export {
  DUCT_ROUGHNESS_MM,
  frictionFactor, segmentPressurePa, specificResistancePam,
  flowFromVelocity, calcSystemPressure, systemPressureStatus,
} from './pressure.js';
export {
  ACOUSTIC_BASE_DBA, ACOUSTIC_THRESHOLDS,
  terminalDbaEstimate, isBedroom, acousticStatus,
} from './acoustic.js';
