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
  deserializeProject,
  identityQuaternion,
  knownMm,
  serializeProject,
  SCHEMA_VERSION,
} from "../src/domain/spatial.mjs";
import {
  inspectFloorAreaOutline,
  MAX_FLOOR_AREA_VERTICES,
} from "../src/domain/floor-area.mjs";

test("a preliminary floor-area outline measures independently of walls and rooms", () => {
  const before = projectWithFloor();
  const project = applyCommand(before, createOutlineCommand());
  const inspection = inspectFloorAreaOutline(project.floorAreaOutlines[0]);

  assert.equal(inspection.areaMm2, 24_000_000);
  assert.equal(inspection.perimeterMm, 20_000);
  assert.deepEqual(inspection.centroidMm, { x: 3000, y: 2000 });
  assert.equal(project.walls.length, 0);
  assert.equal(project.rooms.length, 0);
  assert.equal(project.zones.length, 0);
  assert.equal(project.floorAreaOutlines[0].purpose, "preliminary-quoting");
  assert.equal(project.floorAreaOutlines[0].areaConvention, "closed-plan-outline");
});

test("one outline per floor is explicit and holes are not silently accepted", () => {
  const project = applyCommand(projectWithFloor(), createOutlineCommand());
  assert.throws(
    () => applyCommand(project, createOutlineCommand({ id: "floor-area-second" })),
    /Only one floor area outline is supported per floor/,
  );

  const withHole = createOutlineCommand({ id: "floor-area-hole" });
  withHole.outline.floorId = "floor-upper";
  withHole.outline.holes = [[{ x: 1, y: 1 }]];
  const twoFloors = applyCommand(project, {
    type: "floor.add",
    floor: floor("floor-upper", "Upper Floor", 3000),
  });
  assert.throws(() => applyCommand(twoFloors, withHole), /holes and exclusions are not implemented/);
});

test("invalid or self-intersecting floor-area geometry is rejected atomically", () => {
  const project = projectWithFloor();
  const bowTie = createOutlineCommand();
  bowTie.outline.vertices = vertices([[0, 0], [6000, 4000], [6000, 0], [0, 4000]]);
  assert.throws(() => applyCommand(project, bowTie), /self-intersect/);
  assert.deepEqual(project.floorAreaOutlines, []);

  const collinear = createOutlineCommand();
  collinear.outline.vertices = vertices([[0, 0], [3000, 0], [6000, 0]]);
  assert.throws(() => applyCommand(project, collinear), /non-degenerate/);

  const repeated = createOutlineCommand();
  repeated.outline.vertices = vertices([[0, 0], [6000, 0], [6000, 0], [0, 4000]]);
  assert.throws(() => applyCommand(project, repeated), /repeat a vertex/);

  const oversized = createOutlineCommand();
  oversized.outline.vertices = Array.from(
    { length: MAX_FLOOR_AREA_VERTICES + 1 },
    (_, index) => ({
      id: `floor-area-vertex-${index + 1}`,
      positionMm: {
        x: Math.cos(index) * 1000,
        y: Math.sin(index) * 1000,
        z: knownMm(0, "floor-local plan"),
      },
    }),
  );
  assert.throws(() => applyCommand(project, oversized), /256-vertex prototype limit/);
});

test("vertex edits, metadata edits and removal are undoable and portable", () => {
  const initial = projectWithFloor();
  let history = executeCommand(createCommandHistory(initial), createOutlineCommand());
  history = executeCommand(history, {
    type: "floorArea.moveVertex",
    outlineId: "floor-area-ground",
    vertexId: "floor-area-vertex-2",
    xMm: 7000,
    yMm: 0,
  });
  history = executeCommand(history, {
    type: "floorArea.updateMetadata",
    outlineId: "floor-area-ground",
    name: "Preliminary ground-floor footprint",
  });
  const completed = structuredClone(history.present);
  assert.equal(completed.floorAreaOutlines[0].name, "Preliminary ground-floor footprint");
  assert.deepEqual(deserializeProject(serializeProject(completed)), completed);

  history = undoCommand(history);
  assert.equal(history.present.floorAreaOutlines[0].name, "Ground Floor floor area");
  history = redoCommand(history);
  assert.deepEqual(history.present, completed);

  const removed = applyCommand(completed, {
    type: "floorArea.remove",
    outlineId: "floor-area-ground",
  });
  assert.deepEqual(removed.floorAreaOutlines, []);
  assert.equal(removed.walls.length, 0);
});

test("a rejected vertex drag cannot corrupt the stored outline", () => {
  const project = applyCommand(projectWithFloor(), createOutlineCommand());
  const before = structuredClone(project);
  assert.throws(
    () => applyCommand(project, {
      type: "floorArea.moveVertex",
      outlineId: "floor-area-ground",
      vertexId: "floor-area-vertex-2",
      xMm: -1000,
      yMm: 3000,
    }),
    /self-intersect/,
  );
  assert.deepEqual(project, before);
});

test("schema 9 projects migrate with no invented floor-area outline", () => {
  const legacy = structuredClone(projectWithFloor());
  legacy.schemaVersion = 9;
  delete legacy.floorAreaOutlines;

  const migrated = deserializeProject(JSON.stringify(legacy));
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(migrated.floorAreaOutlines, []);
});

function projectWithFloor() {
  return applyCommand(createProject("project-floor-area"), {
    type: "floor.add",
    floor: floor("floor-ground", "Ground Floor", 0),
  });
}

function floor(id, name, elevationMm) {
  return {
    id,
    name,
    transform: {
      translationMm: { x: 0, y: 0, z: knownMm(elevationMm, "synthetic floor datum") },
      orientation: identityQuaternion(),
    },
  };
}

function createOutlineCommand({ id = "floor-area-ground" } = {}) {
  return {
    type: "floorArea.create",
    outline: {
      id,
      floorId: "floor-ground",
      name: "Ground Floor floor area",
      geometrySource: "manual-floor-area-outline",
      purpose: "preliminary-quoting",
      areaConvention: "closed-plan-outline",
      measurementBasis: "floor-local-plan-mm",
      vertices: vertices([[0, 0], [6000, 0], [6000, 4000], [0, 4000]]),
      holes: [],
    },
  };
}

function vertices(points) {
  return points.map(([x, y], index) => ({
    id: `floor-area-vertex-${index + 1}`,
    positionMm: { x, y, z: knownMm(0, "floor-local plan") },
  }));
}
