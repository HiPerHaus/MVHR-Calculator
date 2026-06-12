// @ts-check
// ============================================================
// HiPer Engine — pressure.js unit tests
// Run: node --test packages/engine/tests/pressure.test.js
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  frictionFactor,
  segmentPressurePa,
  specificResistancePam,
  flowFromVelocity,
  calcSystemPressure,
  systemPressureStatus,
} from '../pressure.js';
import { calcVelocityMs } from '../duct.js';

// ── frictionFactor ────────────────────────────────────────────
describe('frictionFactor', () => {
  it('returns 64/Re for laminar flow (Re < 2300)', () => {
    const f = frictionFactor(1000, 1.5, 90);
    assert.ok(Math.abs(f - 64 / 1000) < 1e-9);
  });

  it('returns reasonable value for turbulent flow — SR90 30 m³/h', () => {
    // Re ≈ 7 860; expected f ≈ 0.042–0.060 range
    const f = frictionFactor(7860, 1.5, 90);
    assert.ok(f > 0.03 && f < 0.08, `f=${f} outside expected range`);
  });

  it('lower f for smooth EPP vs rough semi-rigid at same Re', () => {
    const fRough  = frictionFactor(30000, 1.5,  90);
    const fSmooth = frictionFactor(30000, 0.15, 90);
    assert.ok(fSmooth < fRough, 'smooth EPP should have lower f');
  });

  it('returns safe default for zero Re', () => {
    const f = frictionFactor(0, 1.5, 90);
    assert.ok(f > 0);
  });
});

// ── segmentPressurePa ─────────────────────────────────────────
describe('segmentPressurePa', () => {
  it('returns 0 for zero flow', () => {
    assert.equal(segmentPressurePa(0, 90, 5, 'semi_rigid_90'), 0);
  });

  it('returns 0 for zero length', () => {
    assert.equal(segmentPressurePa(30, 90, 0, 'semi_rigid_90'), 0);
  });

  it('scales linearly with length', () => {
    const p1 = segmentPressurePa(30, 90, 1, 'semi_rigid_90');
    const p5 = segmentPressurePa(30, 90, 5, 'semi_rigid_90');
    assert.ok(Math.abs(p5 - p1 * 5) < 0.01, `Not linear: p1=${p1} p5=${p5}`);
  });

  it('SR90 at 30 m³/h, 10 m — plausible 5–20 Pa range', () => {
    // v ≈ 1.31 m/s, Re ≈ 7860, includes 50% fitting factor
    const dp = segmentPressurePa(30, 90, 10, 'semi_rigid_90');
    assert.ok(dp >= 5 && dp <= 20, `dp=${dp.toFixed(2)} Pa outside 5–20 Pa`);
  });

  it('EPP180 at 250 m³/h, 5 m — plausible 2–10 Pa range', () => {
    const dp = segmentPressurePa(250, 180, 5, 'epp_180');
    assert.ok(dp >= 2 && dp <= 10, `dp=${dp.toFixed(2)} Pa outside 2–10 Pa`);
  });

  it('larger diameter → lower pressure drop (same flow + length)', () => {
    const dp90  = segmentPressurePa(30, 90,  5, 'semi_rigid_90');
    const dp125 = segmentPressurePa(30, 125, 5, 'semi_rigid_90');
    assert.ok(dp125 < dp90, 'larger diameter should give lower ΔP');
  });

  it('higher flow → higher pressure drop (same diameter + length)', () => {
    const dpLow  = segmentPressurePa(20, 90, 5, 'semi_rigid_90');
    const dpHigh = segmentPressurePa(40, 90, 5, 'semi_rigid_90');
    assert.ok(dpHigh > dpLow, 'higher flow should give higher ΔP');
  });
});

// ── specificResistancePam ─────────────────────────────────────
describe('specificResistancePam', () => {
  it('equals segmentPressurePa at 1 m', () => {
    const r = specificResistancePam(30, 90, 'semi_rigid_90');
    const p = segmentPressurePa(30, 90, 1, 'semi_rigid_90');
    assert.ok(Math.abs(r - p) < 1e-9);
  });

  it('SR90 at 30 m³/h gives 0.5–2 Pa/m', () => {
    const r = specificResistancePam(30, 90, 'semi_rigid_90');
    assert.ok(r >= 0.5 && r <= 2.0, `r=${r.toFixed(3)} Pa/m outside expected range`);
  });
});

// ── flowFromVelocity ─────────────────────────────────────────
describe('flowFromVelocity', () => {
  it('returns 0 for zero velocity', () => {
    assert.equal(flowFromVelocity(0, 90), 0);
  });

  it('round-trips with calcVelocityMs', () => {
    const flow = 30;
    const diam = 90;
    const v    = calcVelocityMs(flow, diam);
    const back = flowFromVelocity(v, diam);
    assert.ok(Math.abs(back - flow) < 0.01, `round-trip: in=${flow} out=${back.toFixed(3)}`);
  });
});

// ── calcSystemPressure ────────────────────────────────────────
describe('calcSystemPressure', () => {
  // Minimal synthetic design:
  //   intake (EPP180, 200 m³/h, 5 m) → MVHR
  //   MVHR → supply_trunk (EPP180, 200 m³/h, 2 m, main)
  //   supply_trunk → terminal_A (SR90, 30 m³/h, 8 m, terminal)
  //   supply_trunk → terminal_B (SR90, 25 m³/h, 12 m, terminal) ← index
  //   terminal_X → extract_trunk (SR90, 25 m³/h, 10 m, terminal) ← index
  //   extract_trunk → MVHR (EPP180, 200 m³/h, 2 m, main)
  //   MVHR → exhaust (EPP180, 200 m³/h, 3 m)
  const mkRun = (run_type, flow_m3h, diameter_mm, length_m, duct_type, category = 'main') => ({
    run_type, flow_m3h, velocity_m_s: null, diameter_mm, length_m, duct_type,
    metadata: { run_category: category },
  });

  const testRuns = [
    mkRun('intake',  200, 180, 5, 'epp_180'),
    mkRun('supply',  200, 180, 2, 'epp_180', 'main'),
    mkRun('supply',  30,   90, 8, 'semi_rigid_90', 'terminal'),
    mkRun('supply',  25,   90, 12, 'semi_rigid_90', 'terminal'),  // index terminal
    mkRun('extract', 25,   90, 10, 'semi_rigid_90', 'terminal'),  // index terminal
    mkRun('extract', 200, 180,  2, 'epp_180', 'main'),
    mkRun('exhaust', 200, 180,  3, 'epp_180'),
  ];

  it('returns non-negative pressures', () => {
    const r = calcSystemPressure(testRuns);
    assert.ok(r.externalPa     >= 0);
    assert.ok(r.supplyIndexPa  >= 0);
    assert.ok(r.extractIndexPa >= 0);
    assert.ok(r.totalSystemPa  >= 0);
  });

  it('totalSystemPa = external + supply index + extract index', () => {
    const r = calcSystemPressure(testRuns);
    assert.equal(r.totalSystemPa, r.externalPa + r.supplyIndexPa + r.extractIndexPa);
  });

  it('supply index ≥ supply main (max terminal is additive)', () => {
    const r = calcSystemPressure(testRuns);
    assert.ok(r.supplyIndexPa >= r.supplyMainPa);
  });

  it('longer terminal dominates index run', () => {
    // 12 m terminal should dominate over 8 m terminal
    const dp12 = segmentPressurePa(25, 90, 12, 'semi_rigid_90');
    const dp8  = segmentPressurePa(30, 90,  8, 'semi_rigid_90');
    // supplyIndexPa = supply_main + max(dp8, dp12)
    const r = calcSystemPressure(testRuns);
    const supplyMain = segmentPressurePa(200, 180, 2, 'epp_180');
    const expected = Math.round(supplyMain + Math.max(dp8, dp12));
    assert.equal(r.supplyIndexPa, expected);
  });

  it('returns per-run pressures array of same length as input', () => {
    const r = calcSystemPressure(testRuns);
    assert.equal(r.runPressures.length, testRuns.length);
  });

  it('returns zeros for empty runs array', () => {
    const r = calcSystemPressure([]);
    assert.equal(r.totalSystemPa, 0);
    assert.equal(r.externalPa,    0);
  });

  it('falls back to velocity_m_s when flow_m3h is null', () => {
    const run = {
      run_type: 'intake', flow_m3h: null,
      velocity_m_s: calcVelocityMs(200, 180),
      diameter_mm: 180, length_m: 5, duct_type: 'epp_180',
      metadata: {},
    };
    const r = calcSystemPressure([run]);
    // Should produce non-zero pressure despite null flow_m3h
    assert.ok(r.externalPa > 0);
  });
});

// ── systemPressureStatus ─────────────────────────────────────
describe('systemPressureStatus', () => {
  it('ok when total < unit pressure', () => {
    assert.equal(systemPressureStatus(80, 150),  'ok');
  });
  it('ok at exact limit', () => {
    assert.equal(systemPressureStatus(150, 150), 'ok');
  });
  it('warning within 15% over', () => {
    assert.equal(systemPressureStatus(165, 150), 'warning');
  });
  it('exceed above 15% over', () => {
    assert.equal(systemPressureStatus(180, 150), 'exceed');
  });
  it('unknown when unit pressure is null/zero', () => {
    assert.equal(systemPressureStatus(100, null), 'unknown');
    assert.equal(systemPressureStatus(100, 0),    'unknown');
  });
});
