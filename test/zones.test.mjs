import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  createProject,
  deserializeProject,
  identityQuaternion,
  knownMm,
  SCHEMA_VERSION,
  serializeProject,
  terminalRoomAssignment,
  terminalPlacementSpace,
  unknownMm,
} from "../src/domain/spatial.mjs";
import {
  deriveRoomBoundaries,
  deriveZoneBoundaries,
  inspectRoomBoundary,
  inspectZoneBoundary,
} from "../src/domain/rooms.mjs";
import { createSyntheticComponent } from "../src/editor/synthetic-catalogue.mjs";
import { planSnappedWallChain } from "../src/editor/wall-snap.mjs";

test("a nonphysical room divider partitions one enclosure into non-double-counted zone faces", () => {
  const project = partitionedProject();
  const room = project.rooms[0];
  const roomInspection = inspectRoomBoundary(project, room);
  const zones = deriveZoneBoundaries(project, room.id);

  assert.equal(deriveRoomBoundaries(project, room.floorId).candidates.length, 1);
  assert.equal(roomInspection.status, "current");
  assert.equal(roomInspection.areaMm2, 24_000_000);
  assert.deepEqual(zones.candidates.map((candidate) => candidate.areaMm2), [12_000_000, 12_000_000]);
  assert.equal(
    zones.candidates.reduce((sum, candidate) => sum + candidate.areaMm2, 0),
    roomInspection.areaMm2,
  );
  assert.equal(project.walls.find((wall) => wall.id === "divider-main").classification, "virtual");
  assert.equal(Object.hasOwn(project.walls.find((wall) => wall.id === "divider-main"), "airflowTargets"), false);
});

test("named Kitchen and Dining zones persist independently inside their parent enclosure", () => {
  let project = partitionedProject();
  const room = project.rooms[0];
  const candidates = deriveZoneBoundaries(project, room.id).candidates;
  const left = candidates.find((candidate) => candidate.centroidMm.x < 3000);
  const right = candidates.find((candidate) => candidate.centroidMm.x > 3000);
  project = createZone(project, "zone-kitchen", room.id, left.key, "Kitchen", "kitchen", "extract");
  project = createZone(project, "zone-dining", room.id, right.key, "Dining", "dining", "supply");

  const reopened = deserializeProject(serializeProject(project));
  assert.equal(reopened.rooms.length, 1);
  assert.equal(reopened.rooms[0].name, "Kitchen / Dining enclosure");
  assert.deepEqual(reopened.zones.map((zone) => zone.name).toSorted(), ["Dining", "Kitchen"]);
  assert.equal(reopened.zones.every((zone) => zone.parentRoomId === room.id), true);
  assert.equal(reopened.zones.every((zone) => inspectZoneBoundary(reopened, zone).status === "current"), true);
  assert.equal(reopened.zones.every((zone) => zone.airflowTargets.normal.assigned.state === "unresolved"), true);
});

test("manual terminal assignment targets a zone without inferring airflow", () => {
  let project = partitionedProject();
  const room = project.rooms[0];
  const left = deriveZoneBoundaries(project, room.id).candidates.find(
    (candidate) => candidate.centroidMm.x < 3000,
  );
  project = createZone(project, "zone-bedroom", room.id, left.key, "Bedroom", "bedroom", "supply");
  const terminal = createSyntheticComponent("synthetic-supply-terminal", {
    id: "component-zone-supply",
    floorId: "floor-ground",
    xMm: 1500,
    yMm: 2000,
  });
  project = applyCommand(project, { type: "component.add", component: terminal });
  project = applyCommand(project, {
    type: "terminal.assignZone",
    zoneId: "zone-bedroom",
    componentId: terminal.id,
    portId: terminal.ports[0].id,
  });

  assert.deepEqual(terminalRoomAssignment(project, terminal.id), {
    zoneId: "zone-bedroom",
    componentId: terminal.id,
    portId: terminal.ports[0].id,
    assignmentMethod: "manual",
  });
  assert.equal(project.zones[0].airflowTargets.normal.assigned.state, "unresolved");
  project = applyCommand(project, {
    type: "terminal.unassignRoom",
    componentId: terminal.id,
    portId: terminal.ports[0].id,
  });
  assert.equal(terminalRoomAssignment(project, terminal.id), null);
});

test("automatic terminal placement prefers the confirmed child zone over its parent room", () => {
  let project = partitionedProject();
  const room = project.rooms[0];
  const candidates = deriveZoneBoundaries(project, room.id).candidates;
  const left = candidates.find((candidate) => candidate.centroidMm.x < 3000);
  const right = candidates.find((candidate) => candidate.centroidMm.x > 3000);
  project = createZone(project, "zone-kitchen-auto", room.id, left.key, "Kitchen", "kitchen", "extract");
  project = createZone(project, "zone-dining-auto", room.id, right.key, "Dining", "dining", "supply");
  const terminal = createSyntheticComponent("synthetic-extract-terminal", {
    id: "component-auto-zone",
    floorId: "floor-ground",
    xMm: 1500,
    yMm: 2000,
  });

  project = applyCommand(project, {
    type: "component.add",
    component: terminal,
    autoAssignTerminalSpace: true,
  });
  assert.deepEqual(terminalRoomAssignment(project, terminal.id), {
    zoneId: "zone-kitchen-auto",
    componentId: terminal.id,
    portId: terminal.ports[0].id,
    assignmentMethod: "spatial",
  });
  assert.deepEqual(room.terminalAssociations, []);
});

test("a partitioned parent room cannot compete with its child zones for one terminal", () => {
  let project = partitionedProject();
  const room = project.rooms[0];
  const candidate = deriveZoneBoundaries(project, room.id).candidates[0];
  project = createZone(project, "zone-target", room.id, candidate.key, "Kitchen", "kitchen", "extract");
  const terminal = createSyntheticComponent("synthetic-extract-terminal", {
    id: "component-parent-conflict",
    floorId: "floor-ground",
    xMm: 1500,
    yMm: 2000,
  });
  project = applyCommand(project, { type: "component.add", component: terminal });
  assert.throws(() => applyCommand(project, {
    type: "terminal.assignRoom",
    roomId: room.id,
    componentId: terminal.id,
    portId: terminal.ports[0].id,
  }), /child zone/);
});

test("dangling and nested room dividers do not become false zone partitions", () => {
  let dangling = roomProject();
  dangling = applyDivider(dangling, {
    nodeIds: ["divider-edge", "divider-open"],
    wallIds: ["divider-dangling"],
    points: [point(3000, 0), point(3000, 2000)],
  });
  const danglingResult = deriveZoneBoundaries(dangling, dangling.rooms[0].id);
  assert.equal(danglingResult.candidates.length, 0);
  assert.ok(danglingResult.diagnostics.some((diagnostic) => diagnostic.code === "open-endpoint"));

  let nested = roomProject();
  nested = applyDivider(nested, {
    nodeIds: ["inner-a", "inner-b", "inner-c", "inner-d", "inner-a"],
    wallIds: ["inner-a-b", "inner-b-c", "inner-c-d", "inner-d-a"],
    points: [point(2000, 1000), point(4000, 1000), point(4000, 3000), point(2000, 3000), point(2000, 1000)],
  });
  const nestedResult = deriveZoneBoundaries(nested, nested.rooms[0].id);
  assert.equal(nestedResult.candidates.length, 0);
  assert.ok(nestedResult.diagnostics.some(
    (diagnostic) => diagnostic.code === "unsupported-zone-partition",
  ));
});

test("splitting a referenced divider preserves zone identities and deletion remains guarded", () => {
  let project = partitionedProject();
  const room = project.rooms[0];
  const candidates = deriveZoneBoundaries(project, room.id).candidates;
  project = createZone(project, "zone-left", room.id, candidates[0].key, "Kitchen", "kitchen", "extract");
  project = createZone(project, "zone-right", room.id, candidates[1].key, "Dining", "dining", "supply");

  project = applyCommand(project, {
    type: "wall.split",
    wallId: "divider-main",
    newNodeId: "divider-mid",
    newWallId: "divider-main-upper",
    point: { x: 3000, y: 2000 },
  });
  assert.deepEqual(project.zones.map((zone) => zone.id), ["zone-left", "zone-right"]);
  assert.equal(project.zones.every((zone) => zone.boundary.length === 5), true);
  assert.equal(project.zones.every((zone) => inspectZoneBoundary(project, zone).status === "current"), true);
  assert.throws(
    () => applyCommand(project, { type: "wall.delete", wallId: "divider-main" }),
    /blocked by dependent references/,
  );
  assert.throws(
    () => applyCommand(project, { type: "room.remove", roomId: room.id }),
    /blocked by dependent zones/,
  );
  project = applyCommand(project, { type: "zone.remove", zoneId: "zone-left" });
  project = applyCommand(project, { type: "zone.remove", zoneId: "zone-right" });
  project = applyCommand(project, { type: "wall.delete", wallId: "divider-main" });
  assert.equal(project.walls.some((wall) => wall.id === "divider-main"), false);
});

test("schema 8 virtual walls migrate as inert legacy boundaries rather than guessed room dividers", () => {
  const current = partitionedProject();
  const legacy = structuredClone(current);
  legacy.schemaVersion = 8;
  delete legacy.zones;
  for (const wall of legacy.walls.filter((candidate) => candidate.classification === "virtual")) {
    delete wall.boundaryRole;
    delete wall.parentRoomId;
  }

  const reopened = deserializeProject(JSON.stringify(legacy));
  const virtual = reopened.walls.find((wall) => wall.classification === "virtual");
  assert.equal(reopened.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(reopened.floorAreaOutlines, []);
  assert.deepEqual(reopened.zones, []);
  assert.equal(virtual.boundaryRole, "legacy-virtual");
  assert.equal(virtual.parentRoomId, null);
  assert.deepEqual(deriveZoneBoundaries(reopened, reopened.rooms[0].id).candidates, []);
});

function projectWithFloor() {
  return applyCommand(createProject("project-zone-boundaries"), {
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

function roomProject() {
  let project = applyCommand(projectWithFloor(), wallChain(
    ["node-a", "node-b", "node-c", "node-d", "node-a"],
    ["wall-a-b", "wall-b-c", "wall-c-d", "wall-d-a"],
    [point(0, 0), point(6000, 0), point(6000, 4000), point(0, 4000), point(0, 0)],
  ));
  const boundary = deriveRoomBoundaries(project, "floor-ground").candidates[0];
  project = applyCommand(project, {
    type: "room.createFromBoundary",
    roomId: "room-main",
    floorId: "floor-ground",
    boundaryKey: boundary.key,
    name: "Kitchen / Dining enclosure",
    use: "kitchen-dining",
    ventilationRole: "unassigned",
  });
  return project;
}

function partitionedProject() {
  return applyDivider(roomProject(), {
    nodeIds: ["divider-bottom", "divider-top"],
    wallIds: ["divider-main"],
    points: [point(3000, 0), point(3000, 4000)],
  });
}

function applyDivider(project, partial) {
  const raw = {
    ...wallChain(partial.nodeIds, partial.wallIds, partial.points),
    classification: "virtual",
    parentRoomId: "room-main",
    thicknessMm: 20,
  };
  const planned = planSnappedWallChain(project, raw, {
    idPrefix: `${partial.wallIds[0]}-snap`,
  });
  return applyCommand(project, planned);
}

function createZone(project, zoneId, parentRoomId, boundaryKey, name, use, ventilationRole) {
  return applyCommand(project, {
    type: "zone.createFromBoundary",
    zoneId,
    parentRoomId,
    boundaryKey,
    name,
    use,
    ventilationRole,
  });
}

function wallChain(nodeIds, wallIds, points) {
  return {
    type: "wall.addChain",
    floorId: "floor-ground",
    nodeIds,
    wallIds,
    points,
    splits: [],
    thicknessMm: 140,
    heightMm: unknownMm("not measured"),
    referenceLine: "centreline",
    classification: "physical",
  };
}

function point(x, y) {
  return { x, y, z: unknownMm("not measured") };
}


test("terminal placement selects the confirmed child zone role without falling back to its parent", () => {
  let project = partitionedProject();
  const room = project.rooms[0];
  const candidates = deriveZoneBoundaries(project, room.id).candidates;
  const left = candidates.find(candidate => candidate.centroidMm.x < 3000);
  const right = candidates.find(candidate => candidate.centroidMm.x > 3000);
  project = createZone(project, "zone-auto-extract", room.id, left.key, "Kitchen", "kitchen", "extract");
  assert.equal(terminalPlacementSpace(project, "floor-ground", {x:1500,y:2000}).space.ventilationRole, "extract");
  assert.equal(terminalPlacementSpace(project, "floor-ground", {x:4500,y:2000}), null);
  project = createZone(project, "zone-auto-supply", room.id, right.key, "Dining", "dining", "supply");
  assert.equal(terminalPlacementSpace(project, "floor-ground", {x:4500,y:2000}).space.ventilationRole, "supply");
  assert.equal(terminalPlacementSpace(project, "floor-ground", {x:3000,y:2000}), null);
  assert.equal(terminalPlacementSpace(project, "floor-ground", {x:-100,y:2000}), null);
});
