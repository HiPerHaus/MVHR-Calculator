// @ts-check
// ============================================================
// HiPer Engine — acoustic.js unit tests
// Run: node --test packages/engine/tests/acoustic.test.js
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACOUSTIC_BASE_DBA,
  ACOUSTIC_THRESHOLDS,
  terminalDbaEstimate,
  isBedroom,
  acousticStatus,
} from '../acoustic.js';

// ── terminalDbaEstimate ───────────────────────────────────────
describe('terminalDbaEstimate', () => {
  it('returns 0 for zero velocity', () => {
    assert.equal(terminalDbaEstimate(0, 'semi_rigid_90'), 0);
  });

  it('returns 0 for negative velocity', () => {
    assert.equal(terminalDbaEstimate(-1, 'semi_rigid_90'), 0);
  });

  it('returns BASE at v = 1.0 m/s (log10(1) = 0)', () => {
    const dba = terminalDbaEstimate(1.0, 'semi_rigid_90');
    assert.ok(Math.abs(dba - ACOUSTIC_BASE_DBA.semi_rigid_90) < 0.001,
      `Expected ${ACOUSTIC_BASE_DBA.semi_rigid_90}, got ${dba.toFixed(3)}`);
  });

  it('EPP returns lower level than semi-rigid at same velocity', () => {
    const sr  = terminalDbaEstimate(1.5, 'semi_rigid_90');
    const epp = terminalDbaEstimate(1.5, 'epp_160');
    assert.ok(epp < sr, `EPP (${epp.toFixed(1)}) should be < SR90 (${sr.toFixed(1)})`);
  });

  it('noise increases with velocity', () => {
    const low  = terminalDbaEstimate(1.0, 'semi_rigid_90');
    const mid  = terminalDbaEstimate(1.5, 'semi_rigid_90');
    const high = terminalDbaEstimate(2.0, 'semi_rigid_90');
    assert.ok(low < mid && mid < high, `Order check: ${low.toFixed(1)} < ${mid.toFixed(1)} < ${high.toFixed(1)}`);
  });

  it('SR90 at 1.5 m/s is in the 25–35 dBA range', () => {
    const dba = terminalDbaEstimate(1.5, 'semi_rigid_90');
    assert.ok(dba >= 25 && dba <= 35, `dba=${dba.toFixed(1)} outside 25–35 range`);
  });

  it('SR90 at 2.0 m/s is in the 30–42 dBA range', () => {
    const dba = terminalDbaEstimate(2.0, 'semi_rigid_90');
    assert.ok(dba >= 30 && dba <= 42, `dba=${dba.toFixed(1)} outside 30–42 range`);
  });

  it('unknown duct type falls back to semi-rigid base', () => {
    const unknown = terminalDbaEstimate(1.0, 'unknown_type');
    const sr      = terminalDbaEstimate(1.0, 'semi_rigid_90');
    assert.equal(unknown, sr);
  });

  it('exponent: doubling velocity adds ~15 dBA (50·log10(2) ≈ 15.05)', () => {
    const v1  = terminalDbaEstimate(1.0, 'semi_rigid_90');
    const v2  = terminalDbaEstimate(2.0, 'semi_rigid_90');
    const inc = v2 - v1;
    assert.ok(Math.abs(inc - 50 * Math.log10(2)) < 0.001,
      `Expected ~${(50 * Math.log10(2)).toFixed(2)} dB step, got ${inc.toFixed(3)}`);
  });
});

// ── isBedroom ─────────────────────────────────────────────────
describe('isBedroom', () => {
  it('detects "Bedroom 1"',       () => assert.equal(isBedroom('Bedroom 1'), true));
  it('detects "Master Bedroom"',  () => assert.equal(isBedroom('Master Bedroom'), true));
  it('detects "Ensuite"',         () => assert.equal(isBedroom('Ensuite'), true));
  it('detects "Sleep Study"',     () => assert.equal(isBedroom('Sleep Study'), true));
  it('does not flag "Living"',    () => assert.equal(isBedroom('Living Room'), false));
  it('does not flag "Kitchen"',   () => assert.equal(isBedroom('Kitchen'), false));
  it('does not flag ""',          () => assert.equal(isBedroom(''), false));
  it('does not flag null/undef',  () => assert.equal(isBedroom(null), false));
  it('case-insensitive: "BED"',   () => assert.equal(isBedroom('BED'), true));
});

// ── acousticStatus ────────────────────────────────────────────
describe('acousticStatus', () => {
  // Bedroom thresholds: attenuator > 25, exceed > 30
  it('bedroom ok below 25 dBA', () => {
    assert.equal(acousticStatus(20, 'Bedroom 1'), 'ok');
  });
  it('bedroom ok at exactly 25 dBA', () => {
    assert.equal(acousticStatus(25, 'Bedroom 1'), 'ok');
  });
  it('bedroom attenuator at 26 dBA', () => {
    assert.equal(acousticStatus(26, 'Bedroom 1'), 'attenuator');
  });
  it('bedroom attenuator at 30 dBA (> 25 threshold, ≤ 30 exceed)', () => {
    assert.equal(acousticStatus(30, 'Bedroom 1'), 'attenuator');
  });
  it('bedroom exceed above 30 dBA', () => {
    assert.equal(acousticStatus(31, 'Bedroom 1'), 'exceed');
  });

  // General thresholds: attenuator > 35, exceed > 40
  it('general ok at 35 dBA', () => {
    assert.equal(acousticStatus(35, 'Living Room'), 'ok');
  });
  it('general attenuator at 36 dBA', () => {
    assert.equal(acousticStatus(36, 'Living Room'), 'attenuator');
  });
  it('general exceed above 40 dBA', () => {
    assert.equal(acousticStatus(41, 'Kitchen'), 'exceed');
  });

  // General when no room name provided
  it('general thresholds used for empty room name', () => {
    assert.equal(acousticStatus(36, ''), 'attenuator');
    assert.equal(acousticStatus(20, ''), 'ok');
  });
});

// ── Integration: SR90 terminal velocity vs bedroom limit ──────
describe('integration: bedroom compliance velocity', () => {
  it('SR90 at 1.2 m/s should be ok in a bedroom (dba ≈ 24 < 25 threshold)', () => {
    // bedroom ok threshold = 25 dBA; v_threshold ≈ 10^((25-20)/50) = 10^0.1 ≈ 1.26 m/s
    const dba = terminalDbaEstimate(1.2, 'semi_rigid_90');
    assert.ok(dba < 25, `Expected dba < 25, got ${dba.toFixed(2)}`);
    assert.equal(acousticStatus(dba, 'Master Bedroom'), 'ok',
      `dba=${dba.toFixed(1)} should be ok`);
  });

  it('SR90 at 1.8 m/s should need attenuator in a bedroom', () => {
    const dba = terminalDbaEstimate(1.8, 'semi_rigid_90');
    const status = acousticStatus(dba, 'Bedroom 2');
    assert.ok(status === 'attenuator' || status === 'exceed',
      `dba=${dba.toFixed(1)} should be attenuator or exceed`);
  });

  it('EPP at 2.0 m/s should be ok in a general space', () => {
    const dba = terminalDbaEstimate(2.0, 'epp_180');
    assert.equal(acousticStatus(dba, 'Living Room'), 'ok',
      `EPP dba=${dba.toFixed(1)} should be ok in living room`);
  });
});
