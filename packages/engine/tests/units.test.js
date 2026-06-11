// ============================================================
// HiPer Engine — Unit scoring and PH compliance gate tests
// Uses Node built-in test runner
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreMvhrUnits } from '../units.js';
import { PHI_MIN_HR_EFF, PHI_MAX_SFP } from '../constants.js';

const UNITS = {
  phi_ideal: {
    id: 'u1', manufacturer: 'Zehnder', model: 'ComfoAir Q350',
    hr_eff: 0.92, sfp: 0.30, flow_min: 50, flow_max: 350,
    phi_cert_id: 'PHI-1234', user_id: null,
  },
  phi_borderline: {
    id: 'u2', manufacturer: 'ACME', model: 'HR-250',
    hr_eff: 0.75, sfp: 0.45, flow_min: 50, flow_max: 250,
    phi_cert_id: null, user_id: null,
  },
  low_hr: {
    id: 'u3', manufacturer: 'Budget', model: 'HRV-200',
    hr_eff: 0.70, sfp: 0.30, flow_min: 50, flow_max: 200,
    phi_cert_id: null, user_id: null,
  },
  high_sfp: {
    id: 'u4', manufacturer: 'OldStyle', model: 'Fan-300',
    hr_eff: 0.85, sfp: 0.60, flow_min: 50, flow_max: 300,
    phi_cert_id: null, user_id: null,
  },
  both_fail: {
    id: 'u5', manufacturer: 'Poor', model: 'Old-200',
    hr_eff: 0.60, sfp: 0.70, flow_min: 50, flow_max: 200,
    phi_cert_id: null, user_id: null,
  },
  boost_small: {
    id: 'u6', manufacturer: 'Compact', model: 'Mini-150',
    hr_eff: 0.80, sfp: 0.40, flow_min: 30, flow_max: 150,
    phi_cert_id: null, user_id: null,
  },
};

describe('PH compliance flags', () => {
  it('ph_compliant=true for unit meeting HR and SFP', () => {
    const [u] = scoreMvhrUnits([UNITS.phi_ideal], 200, 60, 0);
    assert.equal(u.ph_compliant, true);
    assert.equal(u.compliance_flags.length, 0);
  });

  it('ph_compliant=true at exact boundary (HR=0.75, SFP=0.45)', () => {
    const [u] = scoreMvhrUnits([UNITS.phi_borderline], 200, 60, 0);
    assert.equal(u.ph_compliant, true);
  });

  it('ph_compliant=false and hr flag when HR < 0.75', () => {
    const [u] = scoreMvhrUnits([UNITS.low_hr], 150, 60, 0);
    assert.equal(u.ph_compliant, false);
    assert.equal(u.hr_compliant, false);
    assert.equal(u.sfp_compliant, true);
    assert.ok(u.compliance_flags.includes(`hr_below_${Math.round(PHI_MIN_HR_EFF * 100)}pct`));
  });

  it('ph_compliant=false and sfp flag when SFP > 0.45', () => {
    const [u] = scoreMvhrUnits([UNITS.high_sfp], 250, 60, 0);
    assert.equal(u.ph_compliant, false);
    assert.equal(u.hr_compliant, true);
    assert.equal(u.sfp_compliant, false);
    assert.ok(u.compliance_flags.includes(`sfp_above_${PHI_MAX_SFP}`));
  });

  it('two flags when HR and SFP both fail', () => {
    const [u] = scoreMvhrUnits([UNITS.both_fail], 150, 60, 0);
    assert.equal(u.ph_compliant, false);
    assert.equal(u.compliance_flags.length, 2);
  });

  it('boost_undersized flag when unit cannot handle boost demand', () => {
    const [u] = scoreMvhrUnits([UNITS.boost_small], 100, 60, 200);
    assert.equal(u.boost_capable, false);
    assert.ok(u.compliance_flags.includes('boost_undersized'));
  });

  it('no boost flag when boost demand is met', () => {
    const [u] = scoreMvhrUnits([UNITS.phi_ideal], 200, 60, 300);
    assert.equal(u.boost_capable, true);
    assert.ok(!u.compliance_flags.includes('boost_undersized'));
  });

  it('boost_capable=true when boostM3h=0 (no boost check)', () => {
    const [u] = scoreMvhrUnits([UNITS.boost_small], 100, 60, 0);
    assert.equal(u.boost_capable, true);
  });
});

describe('Ranking', () => {
  it('PHI-compliant unit ranks above non-compliant', () => {
    const scored = scoreMvhrUnits([UNITS.low_hr, UNITS.phi_ideal], 200, 60, 0);
    const ids = scored.map(u => u.id);
    assert.ok(ids.indexOf('u1') < ids.indexOf('u3'));
  });

  it('non-compliant units still appear in results', () => {
    const scored = scoreMvhrUnits([UNITS.low_hr, UNITS.both_fail, UNITS.phi_ideal], 150, 60, 0);
    assert.equal(scored.length, 3);
  });

  it('non-compliant units have lower score than compliant', () => {
    const scored = scoreMvhrUnits([UNITS.phi_ideal, UNITS.both_fail], 150, 60, 0);
    const compliant    = scored.find(u => u.id === 'u1');
    const nonCompliant = scored.find(u => u.id === 'u5');
    assert.ok(compliant.score > nonCompliant.score);
  });

  it('results are sorted descending by score', () => {
    const scored = scoreMvhrUnits(Object.values(UNITS), 180, 60, 0);
    for (let i = 1; i < scored.length; i++) {
      assert.ok(scored[i - 1].score >= scored[i].score,
        `score at ${i - 1} (${scored[i - 1].score}) < score at ${i} (${scored[i].score})`);
    }
  });

  it('boost-capable unit ranks above boost-undersized unit when operating points are similar', () => {
    // Both units at ~67% operating point; only unit A can handle boost=180 m³/h
    const unitA = { id: 'uA', manufacturer: 'A', model: 'M1', hr_eff: 0.80, sfp: 0.40, flow_min: 30, flow_max: 180, phi_cert_id: null, user_id: null };
    const unitB = { id: 'uB', manufacturer: 'B', model: 'M2', hr_eff: 0.80, sfp: 0.40, flow_min: 30, flow_max: 150, phi_cert_id: null, user_id: null };
    // design=100, boost=180: unitA capable (180≥180), unitB not (150<180)
    const scored = scoreMvhrUnits([unitB, unitA], 100, 60, 180);
    assert.equal(scored[0].id, 'uA', 'boost-capable unit should rank first');
  });
});

describe('Load rating', () => {
  it('load_rating=ideal when within ±10% of preferred load', () => {
    // design=180, flow_max=300 → op%=60, preferred=60 → ideal
    const [u] = scoreMvhrUnits([{ ...UNITS.phi_ideal, flow_max: 300 }], 180, 60, 0);
    assert.equal(u.load_rating, 'ideal');
    assert.equal(u.actual_operating_pct, 60);
  });

  it('load_rating=too_high when operating > 85%', () => {
    // design=260, flow_max=300 → op%=87
    const [u] = scoreMvhrUnits([{ ...UNITS.phi_ideal, flow_max: 300 }], 260, 60, 0);
    assert.equal(u.load_rating, 'too_high');
  });

  it('load_rating=too_low when operating < 35%', () => {
    // design=80, flow_max=350 → op%=23
    const [u] = scoreMvhrUnits([UNITS.phi_ideal], 80, 60, 0);
    assert.equal(u.load_rating, 'too_low');
  });
});
