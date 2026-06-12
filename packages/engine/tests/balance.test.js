// ============================================================
// HiPer Engine — Balancing logic tests
// Uses Node built-in test runner
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateAirflow } from '../calculate.js';
import { EXTRACT_MINIMUMS } from '../constants.js';

function mkRoom(overrides) {
  return {
    id: overrides.name ?? 'room',
    floor: 'G',
    classification: 'supply',
    bed_spaces: 0,
    area: 0,
    ceiling_height_m: null,
    ...overrides,
  };
}

function simpleHouse() {
  return [
    mkRoom({ name: 'Bed1',     room_type: 'bedroom',  classification: 'supply',  bed_spaces: 1 }),
    mkRoom({ name: 'Bed2',     room_type: 'bedroom',  classification: 'supply',  bed_spaces: 2 }),
    mkRoom({ name: 'Living',   room_type: 'living',   classification: 'supply'  }),
    mkRoom({ name: 'Kitchen',  room_type: 'kitchen',  classification: 'extract' }),
    mkRoom({ name: 'Bathroom', room_type: 'wet_area', classification: 'extract' }),
    mkRoom({ name: 'WC',       room_type: 'wet_area', classification: 'extract' }),
  ];
}

describe('Balance — supply and extract converge on design flow', () => {
  it('both sides within 5% of design flow', () => {
    const { designFlowM3h, totalSupplyM3h, totalExtractM3h, balanceStatus } =
      calculateAirflow(simpleHouse(), 'passive_house');
    const sRatio = Math.abs(totalSupplyM3h  - designFlowM3h) / designFlowM3h;
    const eRatio = Math.abs(totalExtractM3h - designFlowM3h) / designFlowM3h;
    assert.ok(sRatio <= 0.05, `supply ratio ${sRatio} > 5%`);
    assert.ok(eRatio <= 0.05, `extract ratio ${eRatio} > 5%`);
    assert.ok(['balanced','minor_adjustment'].includes(balanceStatus));
  });
});

describe('Balance — extract minimums respected', () => {
  it('no extract room falls below its minimum', () => {
    const rooms = [
      mkRoom({ name: 'Bed1',     room_type: 'bedroom',  classification: 'supply',  bed_spaces: 1 }),
      mkRoom({ name: 'Kitchen',  room_type: 'kitchen',  classification: 'extract' }),
      mkRoom({ name: 'Bathroom', room_type: 'wet_area', classification: 'extract' }),
      mkRoom({ name: 'Laundry',  room_type: 'laundry',  classification: 'extract' }),
    ];
    const { roomResults } = calculateAirflow(rooms, 'passive_house');
    for (const r of roomResults) {
      if (r.extract_m3h === 0) continue;
      if (r.room_type === 'kitchen' || r.room_type === 'kitchenette') {
        assert.ok(r.extract_m3h >= EXTRACT_MINIMUMS.kitchen,
          `Kitchen ${r.room_name} below minimum: ${r.extract_m3h} < ${EXTRACT_MINIMUMS.kitchen}`);
      }
      if (r.room_type === 'laundry') {
        assert.ok(r.extract_m3h >= EXTRACT_MINIMUMS.laundry,
          `Laundry below minimum: ${r.extract_m3h} < ${EXTRACT_MINIMUMS.laundry}`);
      }
    }
  });
});

describe('Balance — living room absorbs supply slack', () => {
  it('living room supply increases to cover extract demand', () => {
    // extract-heavy: kitchen(40)+bath(30)+WC(20) = 90 m³/h governs
    // fixed supply: bed(20) < 90, living must increase
    const rooms = [
      mkRoom({ name: 'Bed1',    room_type: 'bedroom',  classification: 'supply', bed_spaces: 1 }),
      mkRoom({ name: 'Living',  room_type: 'living',   classification: 'supply' }),
      mkRoom({ name: 'Kitchen', room_type: 'kitchen',  classification: 'extract' }),
      mkRoom({ name: 'Bath',    room_type: 'wet_area', classification: 'extract' }),
      mkRoom({ name: 'WC',      room_type: 'wet_area', classification: 'extract' }),
    ];
    const { roomResults } = calculateAirflow(rooms, 'passive_house');
    const living = roomResults.find(r => r.room_type === 'living');
    assert.ok(living, 'living room should exist in results');
    assert.ok(living.supply_m3h > 40,
      `living supply ${living.supply_m3h} should have been bumped above 40 m³/h`);
  });
});

describe('Balance — living room capped at 80 m³/h', () => {
  it('living room never exceeds 80 m³/h even under heavy extract demand', () => {
    const rooms = [
      mkRoom({ name: 'Living',   room_type: 'living',   classification: 'supply' }),
      mkRoom({ name: 'Kitchen1', room_type: 'kitchen',  classification: 'extract' }),
      mkRoom({ name: 'Kitchen2', room_type: 'kitchen',  classification: 'extract' }),
      mkRoom({ name: 'Bath1',    room_type: 'wet_area', classification: 'extract' }),
      mkRoom({ name: 'Bath2',    room_type: 'wet_area', classification: 'extract' }),
      mkRoom({ name: 'Bath3',    room_type: 'wet_area', classification: 'extract' }),
      mkRoom({ name: 'Laundry',  room_type: 'laundry',  classification: 'extract' }),
    ];
    const { roomResults } = calculateAirflow(rooms, 'passive_house');
    const living = roomResults.find(r => r.room_type === 'living');
    if (living) {
      assert.ok(living.supply_m3h <= 80,
        `living ${living.supply_m3h} exceeded 80 m³/h cap`);
    }
  });
});

describe('Balance — ignored rooms contribute zero', () => {
  it('ignored room has supply=0 and extract=0', () => {
    const rooms = [
      mkRoom({ name: 'Bed1',   room_type: 'bedroom',  classification: 'supply',  bed_spaces: 1 }),
      mkRoom({ name: 'Garage', room_type: 'service',  classification: 'ignore' }),
      mkRoom({ name: 'Bath',   room_type: 'wet_area', classification: 'extract' }),
    ];
    const { roomResults } = calculateAirflow(rooms, 'passive_house');
    const garage = roomResults.find(r => r.room_name === 'Garage');
    assert.equal(garage.supply_m3h, 0);
    assert.equal(garage.extract_m3h, 0);
  });
});

describe('Balance — proportional distribution by priority', () => {
  it('main living gets more supply than games room', () => {
    // Living: priority 100, max 80 — Games: priority 70, max 50
    // Both start at same base rate (25 for games/second living, 40 for living).
    // With extract demand forcing design flow up, living absorbs more.
    const rooms = [
      mkRoom({ name: 'Living',     room_type: 'living',   classification: 'supply' }),
      mkRoom({ name: 'Games Room', room_type: 'living',   classification: 'supply' }),
      mkRoom({ name: 'Kitchen',    room_type: 'kitchen',  classification: 'extract' }),
      mkRoom({ name: 'Bath1',      room_type: 'wet_area', classification: 'extract' }),
      mkRoom({ name: 'Bath2',      room_type: 'wet_area', classification: 'extract' }),
    ];
    const { roomResults } = calculateAirflow(rooms, 'passive_house');
    const living = roomResults.find(r => r.room_name === 'Living');
    const games  = roomResults.find(r => r.room_name === 'Games Room');
    assert.ok(living && games, 'Both rooms should exist');
    assert.ok(
      living.supply_m3h >= games.supply_m3h,
      `Living (${living.supply_m3h}) should be >= Games Room (${games.supply_m3h})`,
    );
  });
});

describe('Balance — Theatre Room capped at 40 m³/h', () => {
  it('Theatre Room never exceeds 40 m³/h even under heavy extract demand', () => {
    const rooms = [
      mkRoom({ name: 'Living',       room_type: 'living',   classification: 'supply' }),
      mkRoom({ name: 'Theatre Room', room_type: 'living',   classification: 'supply' }),
      mkRoom({ name: 'Kitchen',      room_type: 'kitchen',  classification: 'extract' }),
      mkRoom({ name: 'Bath1',        room_type: 'wet_area', classification: 'extract' }),
      mkRoom({ name: 'Bath2',        room_type: 'wet_area', classification: 'extract' }),
      mkRoom({ name: 'Bath3',        room_type: 'wet_area', classification: 'extract' }),
    ];
    const { roomResults } = calculateAirflow(rooms, 'passive_house');
    const theatre = roomResults.find(r => r.room_name === 'Theatre Room');
    if (theatre) {
      assert.ok(
        theatre.supply_m3h <= 40,
        `Theatre Room (${theatre.supply_m3h}) exceeded 40 m³/h cap`,
      );
    }
  });
});

describe('Balance — additional_supply_required status', () => {
  it('fires when per-room max limits prevent reaching design flow', () => {
    // Theatre Room only: max 40 m³/h, but extract demand is ~165 m³/h → can't balance
    // design flow = 40+40+30+30+25 = 165 (extract dominated)
    // Theatre Room starts at 40, max = 40 → zero headroom → deficit = 125
    const rooms = [
      mkRoom({ name: 'Theatre Room', room_type: 'living',   classification: 'supply' }),
      mkRoom({ name: 'Kitchen1',     room_type: 'kitchen',  classification: 'extract' }),
      mkRoom({ name: 'Kitchen2',     room_type: 'kitchen',  classification: 'extract' }),
      mkRoom({ name: 'Bath1',        room_type: 'wet_area', classification: 'extract' }),
      mkRoom({ name: 'Bath2',        room_type: 'wet_area', classification: 'extract' }),
      mkRoom({ name: 'Laundry',      room_type: 'laundry',  classification: 'extract' }),
    ];
    const { balanceStatus, supplyDeficitM3h, recommendedRoomsForAdditionalTerminals } =
      calculateAirflow(rooms, 'passive_house');
    assert.equal(balanceStatus, 'additional_supply_required',
      `Expected additional_supply_required, got ${balanceStatus}`);
    assert.ok(supplyDeficitM3h > 0,
      `supplyDeficitM3h should be > 0, got ${supplyDeficitM3h}`);
    assert.ok(
      recommendedRoomsForAdditionalTerminals.includes('Theatre Room'),
      `Theatre Room should appear in recommendedRoomsForAdditionalTerminals`,
    );
  });
});

describe('Balance — recommended_terminal_count', () => {
  it('stamps terminal count on every room result', () => {
    const rooms = [
      mkRoom({ name: 'Living',  room_type: 'living',   classification: 'supply' }),
      mkRoom({ name: 'Bed1',    room_type: 'bedroom',  classification: 'supply',  bed_spaces: 1 }),
      mkRoom({ name: 'Kitchen', room_type: 'kitchen',  classification: 'extract' }),
      mkRoom({ name: 'Bath',    room_type: 'wet_area', classification: 'extract' }),
    ];
    const { roomResults } = calculateAirflow(rooms, 'passive_house');
    for (const r of roomResults) {
      if (r.supply_m3h > 0) {
        assert.ok(
          r.recommended_terminal_count !== null && r.recommended_terminal_count !== undefined,
          `${r.room_name} should have a recommended_terminal_count`,
        );
        assert.ok(
          [1, 2, 3].includes(r.recommended_terminal_count),
          `${r.room_name} terminal count ${r.recommended_terminal_count} not in [1,2,3]`,
        );
      } else {
        assert.equal(r.recommended_terminal_count, null,
          `${r.room_name} has no supply so terminal count should be null`);
      }
    }
  });
});
