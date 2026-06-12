// ============================================================
// HiPer Engine — calculateAirflow known-answer tests
// Uses Node built-in test runner (node:test + node:assert)
// Run with:  node --test packages/engine/tests/calculate.test.js
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateAirflow } from '../calculate.js';
import {
  STUDIO_APARTMENT,
  TOWNHOUSE_3BED,
  LARGE_FAMILY_HOME,
  HIGH_CEILING_LOFT,
  AS1668_3BED,
  EXTRACT_HEAVY,
} from './fixtures.js';

function run(fixture) {
  return calculateAirflow(fixture.rooms, fixture.method);
}

// ── Fixture 1: Studio apartment (extract demand governs) ──────
describe('STUDIO_APARTMENT — extract demand governs (P1.2 regression)', () => {
  const result = run(STUDIO_APARTMENT);

  it('occupancyFlowM3h = 30', () => assert.equal(result.occupancyFlowM3h, 30));
  it('extractDemandM3h = 90 (kitchen+bath+WC)', () => assert.equal(result.extractDemandM3h, 90));
  it('hasAreaData = false', () => assert.equal(result.hasAreaData, false));
  it('designFlowM3h = 90 — must equal extractDemand, NOT occupancy 30', () =>
    assert.equal(result.designFlowM3h, 90));
  it('designDriver = extract_demand', () => assert.equal(result.designDriver, 'extract_demand'));
  it('balanceStatus = balanced', () => assert.equal(result.balanceStatus, 'balanced'));
  it('achPasses = null (no area data)', () => assert.equal(result.achPasses, null));
  it('engine stamps a semver version string', () =>
    assert.match(result.engineVersion, /^\d+\.\d+\.\d+$/));
  it('supply total within 5% of design flow', () => {
    const ratio = Math.abs(result.totalSupplyM3h - result.designFlowM3h) / result.designFlowM3h;
    assert.ok(ratio <= 0.05, `supply ratio ${ratio} > 5%`);
  });
  it('extract total within 5% of design flow', () => {
    const ratio = Math.abs(result.totalExtractM3h - result.designFlowM3h) / result.designFlowM3h;
    assert.ok(ratio <= 0.05, `extract ratio ${ratio} > 5%`);
  });
  it('P1.2 REGRESSION: design flow must not equal old occupancy-only answer of 30', () =>
    assert.notEqual(result.designFlowM3h, 30));
});

// ── Fixture 2: 3-bed townhouse (occupancy governs) ───────────
describe('TOWNHOUSE_3BED — occupancy governs', () => {
  const result = run(TOWNHOUSE_3BED);

  it('occupancyFlowM3h = 150', () => assert.equal(result.occupancyFlowM3h, 150));
  it('extractDemandM3h = 145', () => assert.equal(result.extractDemandM3h, 145));
  it('designFlowM3h = 150', () => assert.equal(result.designFlowM3h, 150));
  it('designDriver = occupancy', () => assert.equal(result.designDriver, 'occupancy'));
  it('hasAreaData = false', () => assert.equal(result.hasAreaData, false));
  it('all rooms allocated', () =>
    assert.equal(result.roomResults.length, TOWNHOUSE_3BED.rooms.length));
  it('at least one extract room has extract_m3h > 0', () =>
    assert.ok(result.roomResults.some(r => r.extract_m3h > 0)));
  it('balanced within 5%', () => {
    const ratio = Math.max(
      Math.abs(result.totalSupplyM3h  - result.designFlowM3h),
      Math.abs(result.totalExtractM3h - result.designFlowM3h)
    ) / result.designFlowM3h;
    assert.ok(ratio <= 0.05, `max deviation ratio ${ratio} > 5%`);
  });
});

// ── Fixture 3: Large family home (occupancy governs, ACH passes)
describe('LARGE_FAMILY_HOME — occupancy governs, ACH passes', () => {
  const result = run(LARGE_FAMILY_HOME);
  const { expected: e } = LARGE_FAMILY_HOME;

  it('occupancyFlowM3h = 240', () => assert.equal(result.occupancyFlowM3h, e.occupancyFlowM3h));
  it('extractDemandM3h = 195', () => assert.equal(result.extractDemandM3h, e.extractDemandM3h));
  it('hasAreaData = true', () => assert.equal(result.hasAreaData, true));
  it('treatedAreaM2 = 225', () => assert.equal(result.treatedAreaM2, e.treatedAreaM2));
  it('designFlowM3h = 240 (occupancy beats area 225)', () =>
    assert.equal(result.designFlowM3h, e.designFlowM3h));
  it('designDriver = occupancy', () => assert.equal(result.designDriver, e.designDriver));
  it('ACH data available', () => assert.equal(result.hasVolumeData, true));
  it('ACH passes', () => assert.equal(result.achPasses, true));
  it('achAtDesign >= 0.30', () =>
    assert.ok(result.achAtDesign >= 0.30, `achAtDesign ${result.achAtDesign} < 0.30`));
});

// ── Fixture 4: High-ceiling loft (ACH minimum governs) ────────
describe('HIGH_CEILING_LOFT — ACH minimum governs', () => {
  const result = run(HIGH_CEILING_LOFT);
  const { expected: e } = HIGH_CEILING_LOFT;

  it('occupancyFlowM3h = 30', () => assert.equal(result.occupancyFlowM3h, e.occupancyFlowM3h));
  it('extractDemandM3h = 70', () => assert.equal(result.extractDemandM3h, e.extractDemandM3h));
  it('treatedAreaM2 = 100', () => assert.equal(result.treatedAreaM2, e.treatedAreaM2));
  it('areaFlowM3h = 100', () => assert.equal(result.areaFlowM3h, e.areaFlowM3h));
  it('designFlowM3h = 105 (ACH minimum ceil(0.30×350) governs)', () =>
    assert.equal(result.designFlowM3h, e.designFlowM3h));
  it('designDriver = ach_minimum', () =>
    assert.equal(result.designDriver, e.designDriver));
  it('ACH passes', () => assert.equal(result.achPasses, true));
  it('achAtDesign ≈ 0.30', () =>
    assert.ok(Math.abs(result.achAtDesign - 0.30) < 0.02,
      `achAtDesign ${result.achAtDesign} not ≈ 0.30`));
  it('totalVolumeM3 ≈ 350 (100 m² × 3.5 m)', () =>
    assert.ok(Math.abs(result.totalVolumeM3 - 350) < 1,
      `totalVolumeM3 ${result.totalVolumeM3} ≠ 350`));
});

// ── Fixture 5: AS1668 method (higher area rate) ───────────────
describe('AS1668_3BED — AS1668 1.5× area rate governs', () => {
  const result = run(AS1668_3BED);

  it('has area data', () => assert.equal(result.hasAreaData, true));
  it('areaFlowM3h > occupancyFlowM3h (1.5× rate effect)', () =>
    assert.ok(result.areaFlowM3h > result.occupancyFlowM3h,
      `area ${result.areaFlowM3h} should exceed occupancy ${result.occupancyFlowM3h}`));
  it('designDriver = area', () => assert.equal(result.designDriver, 'area'));
});

// ── Fixture 6: Extract-heavy (extract demand governs) ─────────
describe('EXTRACT_HEAVY — many extract rooms, extract demand governs', () => {
  const result = run(EXTRACT_HEAVY);
  const { expected: e } = EXTRACT_HEAVY;

  it('occupancyFlowM3h = 60', () => assert.equal(result.occupancyFlowM3h, e.occupancyFlowM3h));
  it('extractDemandM3h = 275', () => assert.equal(result.extractDemandM3h, e.extractDemandM3h));
  it('designFlowM3h = 275', () => assert.equal(result.designFlowM3h, e.designFlowM3h));
  it('designDriver = extract_demand', () =>
    assert.equal(result.designDriver, e.designDriver));
  it('design flow > 4× occupancy (shows occupancy-only would have badly undersized this)', () =>
    assert.ok(result.designFlowM3h > result.occupancyFlowM3h * 4));
});

// ── Boost vs continuous design flow separation ────────────────
// Regression guard: boostDemandM3h must NEVER become the continuous designFlowM3h.
// Boost is a capacity check only; continuous design flow = max(occupancy, extract_demand, area, ach).
describe('Boost vs continuous design flow — boost must not drive designFlowM3h', () => {
  // Scenario:
  //   occupancy  = 2 beds × 2 persons × 30 = 120 m³/h
  //   extract    = kitchen(40)+bath×3(90)+ensuite(30)+laundry(25)+WC(20) = 205 m³/h  → governs
  //   boost      = kitchen(60)+bath×3(120)+ensuite(40)+laundry(40)+WC(20) = 280 m³/h  → capacity check only
  const rooms = [
    { id: 'Bed1',    name: 'Bed 1',   room_type: 'bedroom',  classification: 'supply',  bed_spaces: 2, area: 0, floor: 'G', ceiling_height_m: null },
    { id: 'Bed2',    name: 'Bed 2',   room_type: 'bedroom',  classification: 'supply',  bed_spaces: 2, area: 0, floor: 'G', ceiling_height_m: null },
    { id: 'Kitchen', name: 'Kitchen', room_type: 'kitchen',  classification: 'extract', bed_spaces: 0, area: 0, floor: 'G', ceiling_height_m: null },
    { id: 'Bath1',   name: 'Bath 1',  room_type: 'wet_area', classification: 'extract', bed_spaces: 0, area: 0, floor: 'G', ceiling_height_m: null },
    { id: 'Bath2',   name: 'Bath 2',  room_type: 'wet_area', classification: 'extract', bed_spaces: 0, area: 0, floor: 'G', ceiling_height_m: null },
    { id: 'Bath3',   name: 'Bath 3',  room_type: 'wet_area', classification: 'extract', bed_spaces: 0, area: 0, floor: 'G', ceiling_height_m: null },
    { id: 'Ensuite', name: 'Ensuite', room_type: 'wet_area', classification: 'extract', bed_spaces: 0, area: 0, floor: 'G', ceiling_height_m: null },
    { id: 'Laundry', name: 'Laundry', room_type: 'laundry',  classification: 'extract', bed_spaces: 0, area: 0, floor: 'G', ceiling_height_m: null },
    { id: 'WC',      name: 'WC',      room_type: 'wet_area', classification: 'extract', bed_spaces: 0, area: 0, floor: 'G', ceiling_height_m: null },
  ];
  const result = calculateAirflow(rooms, 'passive_house');

  it('designFlowM3h equals extractDemandM3h (extract demand is the governing continuous criterion)', () =>
    assert.equal(result.designFlowM3h, result.extractDemandM3h));
  it('designDriver = extract_demand', () =>
    assert.equal(result.designDriver, 'extract_demand'));
  it('boostDemandM3h > designFlowM3h — boost exceeds continuous design flow', () =>
    assert.ok(result.boostDemandM3h > result.designFlowM3h,
      `boost (${result.boostDemandM3h}) must exceed continuous (${result.designFlowM3h})`));
  it('designFlowM3h ≠ boostDemandM3h — boost did not become the design flow', () =>
    assert.notEqual(result.designFlowM3h, result.boostDemandM3h));
  it('boostDemandM3h is returned as a separate field', () =>
    assert.ok(result.boostDemandM3h > 0, 'boostDemandM3h must be a positive number'));
});

// ── Task #34: transfer rooms must not inflate extractDemandM3h ──
// Root cause: calcExtractDemandNominal only skipped classification='ignore'.
// Transfer-classified service rooms (extractRate=15) were counted in
// extractDemandM3h but allocated 0 by allocateRooms → demand > total_extract.
// Fix: derive extractDemandM3h from allocateRooms result in calculate.js.
describe('Transfer rooms excluded from extractDemandM3h (Task #34 regression)', () => {
  const rooms = [
    { id: 'Bed1', name: 'Bedroom 1',  room_type: 'bedroom',  classification: 'supply',   bed_spaces: 2, area: 0, floor: 'G', ceiling_height_m: null },
    { id: 'Kit',  name: 'Kitchen',    room_type: 'kitchen',  classification: 'extract',  bed_spaces: 0, area: 0, floor: 'G', ceiling_height_m: null },
    { id: 'Bath', name: 'Bathroom',   room_type: 'wet_area', classification: 'extract',  bed_spaces: 0, area: 0, floor: 'G', ceiling_height_m: null },
    // Three service rooms classified as transfer (plant room, external space, store).
    // Old code: 3×15 = 45 m³/h leaked into extractDemandM3h → 70+45=115 (wrong)
    // New code: excluded by allocateRooms → extractDemandM3h = 70 (correct)
    { id: 'Svc1', name: 'Plant Room', room_type: 'service',  classification: 'transfer', bed_spaces: 0, area: 0, floor: 'G', ceiling_height_m: null },
    { id: 'Svc2', name: 'Alfresco',   room_type: 'service',  classification: 'transfer', bed_spaces: 0, area: 0, floor: 'G', ceiling_height_m: null },
    { id: 'Svc3', name: 'Store',      room_type: 'service',  classification: 'transfer', bed_spaces: 0, area: 0, floor: 'G', ceiling_height_m: null },
  ];
  const result = calculateAirflow(rooms, 'passive_house');

  it('extractDemandM3h = 70 — transfer service rooms excluded', () =>
    assert.equal(result.extractDemandM3h, 70,
      `got ${result.extractDemandM3h}; 3 transfer service rooms (3×15=45) must not leak into extract demand`));

  it('designFlowM3h = 70 — not inflated to 115 by transfer rooms', () =>
    assert.equal(result.designFlowM3h, 70));

  it('designDriver = extract_demand', () =>
    assert.equal(result.designDriver, 'extract_demand'));

  it('transfer service rooms have 0 extract in room schedule', () => {
    const svcRooms = result.roomResults.filter(r => r.room_type === 'service');
    for (const r of svcRooms) {
      assert.equal(r.extract_m3h, 0, `${r.room_name} must have 0 extract`);
    }
  });
});
