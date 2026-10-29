import assert from "node:assert/strict";
import test from "node:test";

import { applyCommand, createProject, identityQuaternion, knownMm, unknownMm } from "../src/domain/spatial.mjs";
import { deriveRoomBoundaries, deriveZoneBoundaries } from "../src/domain/rooms.mjs";
import { createSyntheticComponent } from "../src/editor/synthetic-catalogue.mjs";
import { resolveDesignCheckTarget } from "../src/editor/check-targets.mjs";
import { planSnappedWallChain } from "../src/editor/wall-snap.mjs";

test("check targets resolve component, route, room and zone centres and fail safely when stale", () => {
  let project = applyCommand(createProject("check-targets"), { type: "floor.add", floor: floor() });
  project = applyCommand(project, wallChain(
    ["node-a", "node-b", "node-c", "node-d", "node-a"], ["wall-ab", "wall-bc", "wall-cd", "wall-da"],
    [point(0, 0), point(6000, 0), point(6000, 4000), point(0, 4000), point(0, 0)],
  ));
  const boundary = deriveRoomBoundaries(project, "floor-ground").candidates[0];
  project = applyCommand(project, { type: "room.createFromBoundary", roomId: "room-main", floorId: "floor-ground", boundaryKey: boundary.key, name: "Kitchen / Dining", use: "kitchen-dining", ventilationRole: "unassigned" });
  project = applyCommand(project, planSnappedWallChain(project, {
    ...wallChain(["divider-bottom", "divider-top"], ["divider"], [point(3000, 0), point(3000, 4000)]),
    classification: "virtual", parentRoomId: "room-main", thicknessMm: 20,
  }, { idPrefix: "divider-snap" }));
  const zoneBoundary = deriveZoneBoundaries(project, "room-main").candidates[0];
  project = applyCommand(project, { type: "zone.createFromBoundary", zoneId: "zone-one", parentRoomId: "room-main", boundaryKey: zoneBoundary.key, name: "Kitchen", use: "kitchen", ventilationRole: "extract" });
  const component = createSyntheticComponent("synthetic-supply-terminal", { id: "terminal", floorId: "floor-ground", xMm: 1200, yMm: 1600 });
  project = applyCommand(project, { type: "component.add", component });
  project = applyCommand(project, { type: "route.add", route: {
    id: "free-route", floorId: "floor-ground", system: "mvhr", stream: "supply", role: "Dwelling supply", ductKind: "generic-duct", connectionInterface: null,
    startAttachment: null, endAttachment: null,
    points: [point(1000, 1000), point(5000, 3000)],
  } });

  assert.deepEqual(resolveDesignCheckTarget(project, { kind: "component", id: "terminal" }).centreMm, { x: 1200, y: 1600 });
  assert.deepEqual(resolveDesignCheckTarget(project, { kind: "route", id: "free-route" }).centreMm, { x: 3000, y: 2000 });
  assert.deepEqual(resolveDesignCheckTarget(project, { kind: "room", id: "room-main" }).centreMm, { x: 3000, y: 2000 });
  assert.notEqual(resolveDesignCheckTarget(project, { kind: "zone", id: "zone-one" }).centreMm.x, 3000);
  assert.equal(resolveDesignCheckTarget(project, { kind: "route", id: "deleted" }), null);
  assert.equal(resolveDesignCheckTarget(project, { kind: "unsupported", id: "terminal" }), null);
});

function floor() {
  return { id: "floor-ground", name: "Ground", transform: { translationMm: { x: 0, y: 0, z: knownMm(0, "test") }, orientation: identityQuaternion() } };
}
function point(x, y) { return { x, y, z: unknownMm("test") }; }
function wallChain(nodeIds, wallIds, points) {
  return { type: "wall.addChain", floorId: "floor-ground", nodeIds, wallIds, points, splits: [], thicknessMm: 140, heightMm: unknownMm("test"), referenceLine: "centreline", classification: "physical" };
}
