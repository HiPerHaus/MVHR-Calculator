// tests/deriveBuildingModel.test.js
// F2 — known-answer tests for the pure DBM derivation mapper.
// Run: node --test tests/*.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveBuildingModel } from '../lib/deriveBuildingModel.js';

const project = { id: 'p1', user_id: 'u1', storey_count: 2 };

test('rooms-only derivation: rollups, levels, envelope membership, traceability', () => {
  const rooms = [
    { id: 'r1', name: 'Bed 1', floor: 'Ground Floor', room_type: 'bedroom', area: 12, ceiling_height_m: 2.4, volume_m3: 28.8, classification: 'supply', bed_spaces: 2, source: 'ai_extraction', sort_order: 0 },
    { id: 'r2', name: 'Bath',  floor: 'First Floor',  room_type: 'wet_area', area: 6,  ceiling_height_m: 2.4, classification: 'extract', source: 'manual', sort_order: 1 },
    { id: 'r3', name: 'Void',  floor: 'First Floor',  room_type: 'other',    area: null, classification: 'ignore', source: 'ai_extraction', sort_order: 2 },
  ];

  const { model, levels, rooms: dbmRooms, zones, event, summary } = deriveBuildingModel({ project, rooms, buildingVolume: null, zones: [] });

  // Levels: Ground (0) + First (1)
  assert.equal(levels.length, 2);
  assert.deepEqual(levels.map(l => l.level_index), [0, 1]);
  assert.equal(levels[0].name, 'Ground Floor');
  assert.equal(levels[1].name, 'First Floor');

  // Rollups: included rooms only (r3 is ignore → excluded)
  assert.equal(model.conditioned_floor_area_m2, 18);      // 12 + 6
  assert.equal(model.building_volume_m3, 43.2);           // 28.8 + (6*2.4)
  assert.equal(model.storey_count, 2);
  assert.equal(model.status, 'draft');
  assert.equal(model.source_type, 'derived');
  assert.equal(model.schema_version, 'dbm-1');
  assert.equal(model.derived_from.project_rooms_count, 3);

  // Envelope membership + traceability
  const void3 = dbmRooms.find(r => r.name === 'Void');
  assert.equal(void3.included_in_envelope, false);
  assert.equal(void3.exclusion_reason, 'classification=ignore');
  assert.equal(dbmRooms.find(r => r.name === 'Bed 1').source_room_id, 'r1');
  assert.equal(dbmRooms.find(r => r.name === 'Bath').manually_edited, true);
  assert.equal(dbmRooms.find(r => r.name === 'Bed 1').level_index, 0);
  assert.equal(dbmRooms.find(r => r.name === 'Bath').level_index, 1);

  // Warnings: no approved BV + missing area on Void
  assert.ok(summary.warnings.some(w => /no approved building volume/i.test(w)));
  assert.ok(summary.warnings.some(w => /Void.*no area/i.test(w)));

  assert.equal(zones.length, 0);
  assert.equal(event.event_type, 'derived');
});

test('approved building volume drives rollups and zone mapping', () => {
  const rooms = [
    { id: 'r1', name: 'Living', floor: 'Ground Floor', room_type: 'living', area: 30, ceiling_height_m: 2.7, volume_m3: 81, classification: 'supply', sort_order: 0 },
  ];
  const buildingVolume = {
    id: 'bv1', status: 'approved', conditioned_floor_area_m2: 150, building_volume_m3: 360,
    airtightness_layer: 'plasterboard', ai_confidence: 0.8, assumptions: ['ceilings assumed 2.4m'],
  };
  const zones = [
    { id: 'z1', zone_key: 'k1', name: 'Garage', level: 'Ground', area_m2: 20, height_m: 2.4, volume_m3: 48, included: false, ai_confidence: 0.9, evidence: 'hatched' },
    { id: 'z2', name: 'Living', area_m2: 30, height_m: 2.7, volume_m3: 81, included: true },
  ];

  const { model, zones: dbmZones, summary } = deriveBuildingModel({ project, rooms, buildingVolume, zones });

  // Rollups come from the approved BV, not the room sum
  assert.equal(model.conditioned_floor_area_m2, 150);
  assert.equal(model.building_volume_m3, 360);
  assert.equal(model.airtightness_layer, 'plasterboard');
  assert.equal(model.ai_confidence, 0.8);
  assert.deepEqual(model.assumptions, ['ceilings assumed 2.4m']);
  assert.equal(model.derived_from.building_volume_calculation_id, 'bv1');
  assert.equal(model.derived_from.building_volume_status, 'approved');

  // Zone mapping
  const garage = dbmZones.find(z => z.name === 'Garage');
  assert.equal(garage.kind, 'excluded');
  assert.equal(garage.category, 'garage');
  assert.equal(garage.included, false);
  assert.equal(garage.source_zone_id, 'z1');
  const living = dbmZones.find(z => z.name === 'Living');
  assert.equal(living.kind, 'envelope');
  assert.equal(living.included, true);

  // Approved BV → no "not approved" / "no approved BV" warning
  assert.ok(!summary.warnings.some(w => /not approved|no approved building volume/i.test(w)));
});

test('non-approved building volume is flagged', () => {
  const buildingVolume = { id: 'bv2', status: 'draft', conditioned_floor_area_m2: 100, building_volume_m3: 240 };
  const { summary } = deriveBuildingModel({ project, rooms: [], buildingVolume, zones: [] });
  assert.ok(summary.warnings.some(w => /not approved/i.test(w)));
  assert.ok(summary.warnings.some(w => /no rooms/i.test(w)));
});

test('level indices compact and preserve order for out-of-order / unknown floors', () => {
  const rooms = [
    { id: 'a', name: 'A', floor: 'Second Floor', area: 10, classification: 'supply', sort_order: 0 },
    { id: 'b', name: 'B', floor: 'Ground Floor', area: 10, classification: 'supply', sort_order: 1 },
    { id: 'c', name: 'C', floor: 'Mezzanine',    area: 10, classification: 'supply', sort_order: 2 },
  ];
  const { levels, rooms: dbmRooms } = deriveBuildingModel({ project, rooms, buildingVolume: null, zones: [] });

  // Dense 0..2, ordered: Ground(canon 0) < Second(canon 2) < Mezzanine(unknown, parked high)
  assert.deepEqual(levels.map(l => l.level_index), [0, 1, 2]);
  assert.equal(levels[0].name, 'Ground Floor');
  assert.equal(levels[1].name, 'Second Floor');
  assert.equal(levels[2].name, 'Mezzanine');

  assert.equal(dbmRooms.find(r => r.name === 'B').level_index, 0); // Ground
  assert.equal(dbmRooms.find(r => r.name === 'A').level_index, 1); // Second
  assert.equal(dbmRooms.find(r => r.name === 'C').level_index, 2); // Mezzanine
});
