// ============================================================
// HiPer Engine — ACH compliance tests
// Uses Node built-in test runner
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcAchFloor, calcAchAtDesign } from '../ach.js';
import { calculateAirflow } from '../calculate.js';
import { PHI_MIN_ACH, DEFAULT_CEILING_HEIGHT_M } from '../constants.js';

const room = (area, h = null) => ({
  id: 'r', name: 'Room', room_type: 'bedroom', classification: 'supply',
  bed_spaces: 0, area, ceiling_height_m: h, floor: 'G',
});

describe('calcAchFloor', () => {
  it('returns hasVolumeData=false when no rooms have area', () => {
    const r = calcAchFloor([room(0), room(0)]);
    assert.equal(r.hasVolumeData, false);
    assert.equal(r.minFlowForAchM3h, 0);
  });

  it('uses DEFAULT_CEILING_HEIGHT_M when ceiling_height_m is null', () => {
    const r = calcAchFloor([room(100, null)]);
    assert.equal(r.hasVolumeData, true);
    const expectedVol = 100 * DEFAULT_CEILING_HEIGHT_M;
    assert.ok(Math.abs(r.totalVolumeM3 - expectedVol) < 0.1,
      `volume ${r.totalVolumeM3} ≠ ${expectedVol}`);
    assert.equal(r.minFlowForAchM3h, Math.ceil(PHI_MIN_ACH * expectedVol));
  });

  it('uses explicit ceiling_height_m when provided', () => {
    // 100 m² × 3.0 m = 300 m³ → minFlow = ceil(0.30 × 300) = 90
    const r = calcAchFloor([room(100, 3.0)]);
    assert.ok(Math.abs(r.totalVolumeM3 - 300) < 0.1);
    assert.equal(r.minFlowForAchM3h, 90);
  });

  it('sums multiple rooms correctly', () => {
    const r = calcAchFloor([room(50, 2.4), room(30, 2.4)]);
    assert.ok(Math.abs(r.totalVolumeM3 - 80 * 2.4) < 0.1);
  });

  it('excludes ignored classification rooms', () => {
    const rooms = [
      room(100, 2.4),
      { id: 'g', name: 'Garage', room_type: 'service', classification: 'ignore', area: 50, ceiling_height_m: null, floor: 'G' },
    ];
    const r = calcAchFloor(rooms);
    assert.ok(Math.abs(r.totalVolumeM3 - 100 * 2.4) < 0.1);
  });

  it('excludes service room_type rooms', () => {
    const rooms = [
      room(100, 2.4),
      { id: 'p', name: 'Plant', room_type: 'service', classification: 'supply', area: 10, ceiling_height_m: null, floor: 'G' },
    ];
    const r = calcAchFloor(rooms);
    assert.ok(Math.abs(r.totalVolumeM3 - 100 * 2.4) < 0.1);
  });

  it('minFlowForAchM3h rounds up (ceil)', () => {
    // 10 m² × 2.4 m = 24 m³ → 0.30 × 24 = 7.2 → ceil = 8
    const r = calcAchFloor([room(10, 2.4)]);
    assert.equal(r.minFlowForAchM3h, 8);
  });

  it('reports achMinimum = 0.30', () => {
    const r = calcAchFloor([room(100)]);
    assert.equal(r.achMinimum, PHI_MIN_ACH);
  });
});

describe('calcAchAtDesign', () => {
  it('passes at exactly 0.30 ACH', () => {
    // 100 m³ at 30 m³/h = 0.30 ACH
    const r = calcAchAtDesign(100, 30);
    assert.equal(r.achPasses, true);
    assert.ok(Math.abs(r.achAtDesign - 0.30) < 0.01);
  });

  it('fails at 0.25 ACH', () => {
    const r = calcAchAtDesign(100, 25);
    assert.equal(r.achPasses, false);
    assert.ok(Math.abs(r.achAtDesign - 0.25) < 0.01);
  });

  it('passes at 0.625 ACH (well above minimum)', () => {
    const r = calcAchAtDesign(200, 125);
    assert.equal(r.achPasses, true);
  });

  it('handles zero volume gracefully', () => {
    const r = calcAchAtDesign(0, 100);
    assert.equal(r.achPasses, false);
  });
});

describe('ACH integration — calculateAirflow includes ACH as fourth candidate', () => {
  it('ACH minimum governs when volume × 0.30 > other candidates', () => {
    // 200 m² (bedroom 20 + living 130 + dining 50), 3.5 m ceilings
    // volume = 200 × 3.5 = 700 m³
    // minACH = ceil(0.30 × 700) = 210 m³/h
    // occupancy = 2 × 30 = 60 m³/h
    // extractDemand = 30 (bath) = 30 m³/h
    // area = 200 × 1.0 = 200 m³/h
    // ACH candidate 210 > area 200 → ACH governs
    const rooms = [
      { id: 'bed', name: 'Bedroom',  room_type: 'bedroom',  classification: 'supply',  bed_spaces: 2, area: 20,  ceiling_height_m: 3.5, floor: 'G' },
      { id: 'liv', name: 'Living',   room_type: 'living',   classification: 'supply',  bed_spaces: 0, area: 130, ceiling_height_m: 3.5, floor: 'G' },
      { id: 'din', name: 'Dining',   room_type: 'dining',   classification: 'supply',  bed_spaces: 0, area: 50,  ceiling_height_m: 3.5, floor: 'G' },
      { id: 'bat', name: 'Bathroom', room_type: 'wet_area', classification: 'extract', bed_spaces: 0, area: 0,   ceiling_height_m: null, floor: 'G' },
    ];
    const result = calculateAirflow(rooms, 'passive_house');
    assert.equal(result.designDriver, 'ach_minimum');
    assert.equal(result.designFlowM3h, 210);
    assert.equal(result.achPasses, true);
    assert.ok(Math.abs(result.totalVolumeM3 - 700) < 1);
  });
});
