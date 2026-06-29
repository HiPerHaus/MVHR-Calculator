// tests/mvhrRoomsSource.test.js
// F3 step 4 — DBM room → engine room mapping.
// Run: node --test tests/*.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dbmRoomToEngineRoom } from '../lib/mvhrRoomsSource.js';

test('maps building_model_rooms to the engine room shape', () => {
  const dbmRoom = {
    id: 'bm-1',
    name: 'Master Bed',
    room_type: 'bedroom',
    classification: 'supply',
    area_m2: 14.5,
    ceiling_height_m: 2.55,
    bed_spaces: 2,
    sort_order: 3,
    source_room_id: 'pr-1',
    source_json: { mvhr: { floor: 'First Floor', is_confirmed: true, optional_supply: true, optional_extract: false, requires_manual_review: false } },
  };
  const r = dbmRoomToEngineRoom(dbmRoom);

  // FK safety: engine room id must be the project_rooms id (→ airflow_rooms.project_room_id)
  assert.equal(r.id, 'pr-1');
  assert.equal(r.name, 'Master Bed');
  assert.equal(r.room_type, 'bedroom');
  assert.equal(r.classification, 'supply');
  assert.equal(r.area, 14.5);
  assert.equal(r.ceiling_height_m, 2.55);
  assert.equal(r.bed_spaces, 2);
  assert.equal(r.floor, 'First Floor');
  assert.equal(r.sort_order, 3);
  assert.equal(r.optional_supply, true);
  assert.equal(r.is_confirmed, true);
});

test('coerces stringified numerics to Number (engine does area>0 and area+=)', () => {
  const r = dbmRoomToEngineRoom({ name: 'X', room_type: 'living', classification: 'supply', area_m2: '12.00', ceiling_height_m: '2.40', source_room_id: 'pr-2', source_json: {} });
  assert.equal(typeof r.area, 'number');
  assert.equal(r.area, 12);
  assert.equal(typeof r.ceiling_height_m, 'number');
  assert.equal(r.ceiling_height_m, 2.4);
  // A summation like the engine performs must add numerically, not concatenate.
  assert.equal(r.area + r.area, 24);
});

test('null area stays null (not 0); missing source_room_id → null id', () => {
  const r = dbmRoomToEngineRoom({ name: 'Void', room_type: 'other', classification: 'ignore', area_m2: null, ceiling_height_m: null, source_room_id: null, source_json: {} });
  assert.equal(r.area, null);
  assert.equal(r.ceiling_height_m, null);
  assert.equal(r.id, null);        // manual DBM room with no project_rooms counterpart
  assert.equal(r.bed_spaces, 0);
  assert.equal(r.is_confirmed, true);
});
