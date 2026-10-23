import assert from "node:assert/strict";
import test from "node:test";

import {
  createCommandHistory,
  executeCommand,
  redoCommand,
  undoCommand,
} from "../src/domain/history.mjs";
import {
  applyCommand,
  createProject,
  identityQuaternion,
  knownMm,
  unknownMm,
} from "../src/domain/spatial.mjs";
import {
  deriveRoomBoundaries,
  deriveZoneBoundaries,
  inspectRoomBoundary,
} from "../src/domain/rooms.mjs";
import {
  closestScreenCandidate,
  planSnappedWallChain,
  wallInteriorSnapRadiusPx,
} from "../src/editor/wall-snap.mjs";

test("Snap On turns a new wall crossing into one shared four-way junction", () => {
  const before = applyCommand(projectWithFloor(), wallCommand(
    ["node-a", "node-b"],
    ["wall-a-b"],
    [[0, 0], [6000, 0]],
  ));
  const raw = wallCommand(
    ["node-v-start", "node-v-end"],
    ["wall-v"],
    [[3000, -2000], [3000, 2000]],
  );
  const planned = planSnappedWallChain(before, raw, { idPrefix: "crossing-one" });
  const after = applyCommand(before, planned);
  const junction = after.wallNodes.find((node) => node.positionMm.x === 3000 && node.positionMm.y === 0);

  assert.equal(planned.splits.length, 1);
  assert.equal(planned.points.length, 3);
  assert.ok(junction);
  assert.equal(after.walls.filter((wall) => wall.startNodeId === junction.id || wall.endNodeId === junction.id).length, 4);
  assert.equal(deriveRoomBoundaries(after, "floor-ground").diagnostics.some(
    (item) => item.code === "crossing-without-junction",
  ), false);
});

test("Snap On links an endpoint into a wall interior as a T-junction", () => {
  const before = applyCommand(projectWithFloor(), wallCommand(
    ["node-a", "node-b"],
    ["wall-a-b"],
    [[0, 0], [6000, 0]],
  ));
  const planned = planSnappedWallChain(before, wallCommand(
    ["node-t", "node-leg"],
    ["wall-leg"],
    [[3000, 0], [3000, 3000]],
  ), { idPrefix: "t-junction" });
  const after = applyCommand(before, planned);
  const junction = after.wallNodes.find((node) => node.positionMm.x === 3000 && node.positionMm.y === 0);

  assert.equal(planned.splits.length, 1);
  assert.ok(junction);
  assert.equal(after.walls.filter((wall) => wall.startNodeId === junction.id || wall.endNodeId === junction.id).length, 3);
});

test("Snap On planarizes crossings with multiple committed walls in one command", () => {
  let before = applyCommand(projectWithFloor(), wallCommand(
    ["node-a", "node-b"],
    ["wall-a-b"],
    [[0, 0], [6000, 0]],
  ));
  before = applyCommand(before, wallCommand(
    ["node-c", "node-d"],
    ["wall-c-d"],
    [[0, 2000], [6000, 2000]],
  ));
  const planned = planSnappedWallChain(before, wallCommand(
    ["node-v-start", "node-v-end"],
    ["wall-v"],
    [[3000, -1000], [3000, 3000]],
  ), { idPrefix: "multi-crossing" });
  const after = applyCommand(before, planned);

  assert.equal(planned.splits.length, 2);
  assert.equal(planned.points.length, 4);
  assert.equal(after.walls.length, 7);
  for (const y of [0, 2000]) {
    const junction = after.wallNodes.find((node) => node.positionMm.x === 3000 && node.positionMm.y === y);
    assert.equal(after.walls.filter((wall) => wall.startNodeId === junction.id || wall.endNodeId === junction.id).length, 4);
  }
});

test("Snap Off preserves a true crossing as disconnected topology and near misses never merge", () => {
  const before = applyCommand(projectWithFloor(), wallCommand(
    ["node-a", "node-b"],
    ["wall-a-b"],
    [[0, 0], [6000, 0]],
  ));
  const crossing = wallCommand(
    ["node-v-start", "node-v-end"],
    ["wall-v"],
    [[3000, -2000], [3000, 2000]],
  );
  const disconnected = applyCommand(before, crossing);
  assert.equal(disconnected.wallNodes.length, 4);
  assert.ok(deriveRoomBoundaries(disconnected, "floor-ground").diagnostics.some(
    (item) => item.code === "crossing-without-junction",
  ));

  const nearMiss = wallCommand(
    ["node-near-a", "node-near-b"],
    ["wall-near"],
    [[3000, -2000], [3000, -1]],
  );
  const plannedNearMiss = planSnappedWallChain(before, nearMiss, { idPrefix: "near-miss" });
  assert.deepEqual(plannedNearMiss.splits, []);
  assert.equal(plannedNearMiss.points.length, 2);
});

test("the 12 CSS-pixel acquisition radius stays screen-based across zoom mappings", () => {
  for (const viewUnitsPerPixel of [0.25, 1, 8]) {
    const worldOffsetInside = 11 * viewUnitsPerPixel;
    const worldOffsetOutside = 13 * viewUnitsPerPixel;
    const selected = closestScreenCandidate({ x: 400, y: 300 }, [
      { id: "outside", worldOffset: worldOffsetOutside, screenX: 413, screenY: 300 },
      { id: "inside", worldOffset: worldOffsetInside, screenX: 411, screenY: 300 },
    ], 12);
    assert.equal(selected.id, "inside");
    assert.equal(closestScreenCandidate({ x: 400, y: 300 }, [
      { id: "outside", worldOffset: worldOffsetOutside, screenX: 413, screenY: 300 },
    ], 12), null);
  }
});

test("wall-interior snapping includes the visible physical half-thickness at every zoom", () => {
  const physicalStrokeViewUnits = 14;
  for (const screenScalePxPerViewUnit of [0.25, 1, 4]) {
    const radiusPx = wallInteriorSnapRadiusPx(
      12,
      physicalStrokeViewUnits,
      screenScalePxPerViewUnit,
    );
    assert.equal(radiusPx, 12 + physicalStrokeViewUnits * screenScalePxPerViewUnit / 2);
    const visibleEdgeDistancePx = physicalStrokeViewUnits * screenScalePxPerViewUnit / 2;
    assert.equal(closestScreenCandidate({ x: 400, y: 300 }, [
      { id: "wall-centreline", screenX: 400, screenY: 300 + visibleEdgeDistancePx + 11, radiusPx },
    ], 12)?.id, "wall-centreline");
    assert.equal(closestScreenCandidate({ x: 400, y: 300 }, [
      { id: "outside", screenX: 400, screenY: 300 + visibleEdgeDistancePx + 13, radiusPx },
    ], 12), null);
  }
  assert.equal(wallInteriorSnapRadiusPx(12, 2, 50, { nonScalingStroke: true }), 13);
});

test("a snapped room divider preserves the physical room and creates zone faces", () => {
  let project = applyCommand(projectWithFloor(), wallCommand(
    ["node-a", "node-b", "node-c", "node-d", "node-a"],
    ["wall-a-b", "wall-b-c", "wall-c-d", "wall-d-a"],
    [[0, 0], [6000, 0], [6000, 4000], [0, 4000], [0, 0]],
  ));
  const initialBoundary = deriveRoomBoundaries(project, "floor-ground").candidates[0];
  project = applyCommand(project, {
    type: "room.createFromBoundary",
    roomId: "room-kitchen-dining",
    floorId: "floor-ground",
    boundaryKey: initialBoundary.key,
    name: "Kitchen / Dining",
    use: "kitchen-dining",
    ventilationRole: "extract",
  });
  const dividerCommand = wallCommand(
    ["node-divider-start", "node-divider-end"],
    ["wall-divider"],
    [[3000, 0], [3000, 4000]],
  );
  dividerCommand.classification = "virtual";
  dividerCommand.parentRoomId = "room-kitchen-dining";
  dividerCommand.thicknessMm = 20;
  const planned = planSnappedWallChain(project, dividerCommand, { idPrefix: "divider-crossing" });
  const after = applyCommand(project, planned);

  assert.equal(after.rooms[0].id, "room-kitchen-dining");
  assert.equal(after.rooms[0].name, "Kitchen / Dining");
  assert.equal(after.rooms[0].boundary.length, 6);
  assert.equal(deriveRoomBoundaries(after, "floor-ground").candidates.length, 1);
  assert.equal(inspectRoomBoundary(after, after.rooms[0]).status, "current");
  assert.equal(deriveZoneBoundaries(after, after.rooms[0].id).candidates.length, 2);
  const divider = after.walls.find((wall) => wall.id === "wall-divider");
  assert.equal(divider.classification, "virtual");
  assert.equal(divider.boundaryRole, "room-divider");
  assert.equal(divider.parentRoomId, "room-kitchen-dining");
});

test("a planned crossing remains one undoable and redoable command", () => {
  const before = applyCommand(projectWithFloor(), wallCommand(
    ["node-a", "node-b"],
    ["wall-a-b"],
    [[0, 0], [6000, 0]],
  ));
  const planned = planSnappedWallChain(before, wallCommand(
    ["node-v-start", "node-v-end"],
    ["wall-v"],
    [[3000, -2000], [3000, 2000]],
  ), { idPrefix: "history-crossing" });
  let history = executeCommand(createCommandHistory(before), planned);
  const completed = structuredClone(history.present);
  history = undoCommand(history);
  assert.deepEqual(history.present, before);
  history = redoCommand(history);
  assert.deepEqual(history.present, completed);
});

function projectWithFloor() {
  return applyCommand(createProject("project-wall-snap"), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "synthetic datum") },
        orientation: identityQuaternion(),
      },
    },
  });
}

function wallCommand(nodeIds, wallIds, xyPoints) {
  return {
    type: "wall.addChain",
    floorId: "floor-ground",
    nodeIds,
    wallIds,
    points: xyPoints.map(([x, y]) => ({ x, y, z: unknownMm("not measured") })),
    splits: [],
    thicknessMm: 140,
    heightMm: unknownMm("not measured"),
    referenceLine: "centreline",
    classification: "physical",
  };
}
