import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  createProject,
  deserializeProject,
  identityQuaternion,
  inspectComponentDeletion,
  knownMm,
  roomTerminalPort,
  serializeProject,
  terminalRoomAssignment,
  unknownMm,
} from "../src/domain/spatial.mjs";
import { createSyntheticComponent } from "../src/editor/synthetic-catalogue.mjs";
import {
  deriveRoomBoundaries,
  inspectRoomBoundary,
  newlyEligibleRoomBoundaries,
} from "../src/domain/rooms.mjs";

test("a 6000 by 4000 wall face is offered for explicit room confirmation", () => {
  const project = rectangularProject();
  const derivation = deriveRoomBoundaries(project, "floor-ground");

  assert.equal(derivation.candidates.length, 1);
  assert.equal(derivation.candidates[0].areaMm2, 24_000_000);
  assert.deepEqual(derivation.candidates[0].centroidMm, { x: 3000, y: 2000 });
  assert.deepEqual(derivation.diagnostics, []);
  assert.deepEqual(project.rooms, [], "derivation must not silently create a room");
});

test("closing joined walls identifies one new unassigned room boundary for confirmation", () => {
  const openProject = applyCommand(projectWithFloor(), {
    type: "wall.addChain",
    floorId: "floor-ground",
    nodeIds: ["node-a", "node-b", "node-c", "node-d"],
    wallIds: ["wall-a-b", "wall-b-c", "wall-c-d"],
    points: [point(0, 0), point(6000, 0), point(6000, 4000), point(0, 4000)],
    splits: [],
    thicknessMm: 140,
    heightMm: unknownMm("not measured"),
    referenceLine: "centreline",
    classification: "physical",
  });
  const closedProject = applyCommand(openProject, {
    type: "wall.addChain",
    floorId: "floor-ground",
    nodeIds: ["node-d", "node-a"],
    wallIds: ["wall-d-a"],
    points: [point(0, 4000), point(0, 0)],
    splits: [],
    thicknessMm: 140,
    heightMm: unknownMm("not measured"),
    referenceLine: "centreline",
    classification: "physical",
  });

  const newlyEligible = newlyEligibleRoomBoundaries(openProject, closedProject, "floor-ground");
  assert.equal(newlyEligible.length, 1);
  assert.equal(newlyEligible[0].areaMm2, 24_000_000);

  const confirmedProject = createRoom(
    closedProject,
    "room-confirmed",
    "Living",
    "living",
    newlyEligible[0].key,
  );
  assert.deepEqual(
    newlyEligibleRoomBoundaries(openProject, confirmedProject, "floor-ground"),
    [],
    "an already assigned boundary must not prompt again",
  );
});

test("confirmed Kitchen/Dining metadata and stable identity survive save and reopen", () => {
  let project = rectangularProject();
  const candidate = deriveRoomBoundaries(project, "floor-ground").candidates[0];
  project = applyCommand(project, {
    type: "room.createFromBoundary",
    roomId: "room-kitchen-dining",
    floorId: "floor-ground",
    boundaryKey: candidate.key,
    name: "Kitchen / Dining",
    use: "kitchen-dining",
    ventilationRole: "extract",
  });

  const reopened = deserializeProject(serializeProject(project));
  assert.equal(reopened.rooms[0].id, "room-kitchen-dining");
  assert.equal(reopened.rooms[0].name, "Kitchen / Dining");
  assert.equal(reopened.rooms[0].use, "kitchen-dining");
  assert.equal(reopened.rooms[0].ventilationRole, "extract");
  assert.equal(reopened.rooms[0].heightMm.state, "unknown");
  assert.equal(reopened.rooms[0].volumeEvidence.state, "unknown");
  assert.equal(reopened.rooms[0].volumeEvidence.valueM3, null);
  assert.deepEqual(reopened.rooms[0].terminalAssociations, []);
  assert.equal(inspectRoomBoundary(reopened, reopened.rooms[0]).areaMm2, 24_000_000);
});

test("early schema 7 room drafts reopen with explicit unknown volume and no terminal associations", () => {
  let project = rectangularProject();
  const candidate = deriveRoomBoundaries(project, "floor-ground").candidates[0];
  project = createRoom(project, "room-early-schema-seven", "Kitchen", "kitchen", candidate.key);
  const earlyDraft = structuredClone(project);
  earlyDraft.schemaVersion = 7;
  delete earlyDraft.rooms[0].volumeEvidence;
  delete earlyDraft.rooms[0].terminalAssociations;

  const reopened = deserializeProject(JSON.stringify(earlyDraft));
  assert.deepEqual(reopened.rooms[0].volumeEvidence, {
    state: "unknown",
    valueM3: null,
    reason: "room volume not calculated",
  });
  assert.deepEqual(reopened.rooms[0].terminalAssociations, []);
});

test("a designer can manually assign one typed terminal endpoint to a compatible room", () => {
  let project = rectangularProject();
  const candidate = deriveRoomBoundaries(project, "floor-ground").candidates[0];
  project = applyCommand(project, {
    type: "room.createFromBoundary",
    roomId: "room-bedroom",
    floorId: "floor-ground",
    boundaryKey: candidate.key,
    name: "Bedroom",
    use: "bedroom",
    ventilationRole: "supply",
  });
  const terminal = createSyntheticComponent("synthetic-supply-terminal", {
    id: "component-bedroom-supply",
    floorId: "floor-ground",
    xMm: 3000,
    yMm: 2000,
  });
  project = applyCommand(project, { type: "component.add", component: terminal });
  project = applyCommand(project, {
    type: "terminal.assignRoom",
    roomId: "room-bedroom",
    componentId: terminal.id,
    portId: terminal.ports[0].id,
  });

  assert.deepEqual(project.rooms[0].terminalAssociations, [{
    componentId: terminal.id,
    portId: terminal.ports[0].id,
    assignmentMethod: "manual",
  }]);
  assert.equal(roomTerminalPort(project, terminal.id).stream, "supply");
  assert.deepEqual(terminalRoomAssignment(project, terminal.id), {
    roomId: "room-bedroom",
    componentId: terminal.id,
    portId: terminal.ports[0].id,
    assignmentMethod: "manual",
  });
  assert.equal(project.rooms[0].airflowTargets.normal.required.state, "unresolved");
  assert.equal(project.rooms[0].airflowTargets.normal.assigned.state, "unresolved");
  assert.deepEqual(deserializeProject(serializeProject(project)), project);
});

test("manual terminal assignment can move between rooms and be explicitly removed", () => {
  let project = adjacentRoomProject();
  const candidates = deriveRoomBoundaries(project, "floor-ground").candidates;
  project = createRoom(project, "room-left", "Bedroom 1", "bedroom", candidates[0].key);
  project = createRoom(project, "room-right", "Bedroom 2", "bedroom", candidates[1].key);
  const terminal = createSyntheticComponent("synthetic-supply-terminal", {
    id: "component-movable-supply",
    floorId: "floor-ground",
    xMm: 2000,
    yMm: 2000,
  });
  project = applyCommand(project, { type: "component.add", component: terminal });
  project = applyCommand(project, {
    type: "terminal.assignRoom",
    roomId: "room-left",
    componentId: terminal.id,
    portId: terminal.ports[0].id,
  });
  project = applyCommand(project, {
    type: "terminal.assignRoom",
    roomId: "room-right",
    componentId: terminal.id,
    portId: terminal.ports[0].id,
  });

  assert.deepEqual(project.rooms.find((room) => room.id === "room-left").terminalAssociations, []);
  assert.equal(project.rooms.find((room) => room.id === "room-right").terminalAssociations.length, 1);
  project = applyCommand(project, {
    type: "terminal.unassignRoom",
    componentId: terminal.id,
    portId: terminal.ports[0].id,
  });
  assert.equal(terminalRoomAssignment(project, terminal.id), null);
});

test("deleting a terminal clears its room association without changing room geometry", () => {
  let project = rectangularProject();
  const candidate = deriveRoomBoundaries(project, "floor-ground").candidates[0];
  project = applyCommand(project, {
    type: "room.createFromBoundary",
    roomId: "room-delete-terminal",
    floorId: "floor-ground",
    boundaryKey: candidate.key,
    name: "Bedroom",
    use: "bedroom",
    ventilationRole: "supply",
  });
  const terminal = createSyntheticComponent("synthetic-supply-terminal", {
    id: "component-delete-terminal",
    floorId: "floor-ground",
    xMm: 3000,
    yMm: 2000,
  });
  project = applyCommand(project, { type: "component.add", component: terminal });
  project = applyCommand(project, {
    type: "terminal.assignRoom",
    roomId: "room-delete-terminal",
    componentId: terminal.id,
    portId: terminal.ports[0].id,
  });
  const roomBoundary = structuredClone(project.rooms[0].boundary);
  const inspection = inspectComponentDeletion(project, terminal.id);
  assert.equal(inspection.associationCount, 1);

  project = applyCommand(project, {
    type: "component.delete",
    componentId: terminal.id,
    confirmedScope: inspection,
  });
  assert.deepEqual(project.components, []);
  assert.deepEqual(project.rooms[0].terminalAssociations, []);
  assert.deepEqual(project.rooms[0].boundary, roomBoundary);
  assert.equal(project.walls.length, 4);
});

test("terminal placement and movement use one deterministic containing-room association", () => {
  let project = adjacentRoomProject();
  const candidates = deriveRoomBoundaries(project, "floor-ground").candidates;
  const left = candidates.find((candidate) => candidate.centroidMm.x < 4000);
  const right = candidates.find((candidate) => candidate.centroidMm.x > 4000);
  project = createRoom(project, "room-left-auto", "Bedroom 1", "bedroom", left.key);
  project = createRoom(project, "room-right-auto", "Bedroom 2", "bedroom", right.key);
  const terminal = createSyntheticComponent("synthetic-supply-terminal", {
    id: "component-auto-room",
    floorId: "floor-ground",
    xMm: 2000,
    yMm: 2000,
  });

  project = applyCommand(project, {
    type: "component.add",
    component: terminal,
    autoAssignTerminalSpace: true,
  });
  assert.deepEqual(terminalRoomAssignment(project, terminal.id), {
    roomId: "room-left-auto",
    componentId: terminal.id,
    portId: terminal.ports[0].id,
    assignmentMethod: "spatial",
  });

  project = applyCommand(project, {
    type: "component.moveXY",
    componentId: terminal.id,
    xMm: 6000,
    yMm: 2000,
    autoAssignTerminalSpace: true,
  });
  assert.equal(project.rooms.find((room) => room.id === "room-left-auto").terminalAssociations.length, 0);
  assert.equal(terminalRoomAssignment(project, terminal.id).roomId, "room-right-auto");
  assert.equal(terminalRoomAssignment(project, terminal.id).assignmentMethod, "spatial");

  project = applyCommand(project, {
    type: "component.moveXY",
    componentId: terminal.id,
    xMm: 4000,
    yMm: 2000,
    autoAssignTerminalSpace: true,
  });
  assert.equal(terminalRoomAssignment(project, terminal.id), null, "a point on the shared wall is unassigned");
});

test("automatic room association leaves incompatible or outside terminals unassigned", () => {
  let project = rectangularProject();
  const candidate = deriveRoomBoundaries(project, "floor-ground").candidates[0];
  project = applyCommand(project, {
    type: "room.createFromBoundary",
    roomId: "room-extract-auto",
    floorId: "floor-ground",
    boundaryKey: candidate.key,
    name: "Kitchen",
    use: "kitchen",
    ventilationRole: "extract",
  });
  const incompatible = createSyntheticComponent("synthetic-supply-terminal", {
    id: "component-incompatible-auto",
    floorId: "floor-ground",
    xMm: 3000,
    yMm: 2000,
  });
  const outside = createSyntheticComponent("synthetic-extract-terminal", {
    id: "component-outside-auto",
    floorId: "floor-ground",
    xMm: 7000,
    yMm: 2000,
  });
  project = applyCommand(project, { type: "component.add", component: incompatible, autoAssignTerminalSpace: true });
  project = applyCommand(project, { type: "component.add", component: outside, autoAssignTerminalSpace: true });
  assert.equal(terminalRoomAssignment(project, incompatible.id), null);
  assert.equal(terminalRoomAssignment(project, outside.id), null);
});

test("room assignment rejects incompatible, non-terminal, cross-floor and duplicate endpoints", () => {
  let project = rectangularProject();
  const candidate = deriveRoomBoundaries(project, "floor-ground").candidates[0];
  project = applyCommand(project, {
    type: "room.createFromBoundary",
    roomId: "room-extract",
    floorId: "floor-ground",
    boundaryKey: candidate.key,
    name: "Bathroom",
    use: "bathroom",
    ventilationRole: "extract",
  });
  const supply = createSyntheticComponent("synthetic-supply-terminal", {
    id: "component-wrong-stream",
    floorId: "floor-ground",
    xMm: 2000,
    yMm: 2000,
  });
  const unit = createSyntheticComponent("synthetic-mvhr-placeholder", {
    id: "component-unit-not-terminal",
    floorId: "floor-ground",
    xMm: 1000,
    yMm: 1000,
  });
  project = applyCommand(project, { type: "component.add", component: supply });
  project = applyCommand(project, { type: "component.add", component: unit });
  assert.throws(() => applyCommand(project, {
    type: "terminal.assignRoom",
    roomId: "room-extract",
    componentId: supply.id,
    portId: supply.ports[0].id,
  }), /does not match room ventilation role/);
  assert.throws(() => applyCommand(project, {
    type: "terminal.assignRoom",
    roomId: "room-extract",
    componentId: unit.id,
    portId: unit.ports[0].id,
  }), /not an assignable single-room MVHR terminal/);

  project = applyCommand(project, {
    type: "floor.add",
    floor: {
      id: "floor-upper",
      name: "Upper Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(3000, "synthetic upper datum") },
        orientation: identityQuaternion(),
      },
    },
  });
  const upperExtract = createSyntheticComponent("synthetic-extract-terminal", {
    id: "component-upper-extract",
    floorId: "floor-upper",
    xMm: 3000,
    yMm: 2000,
  });
  project = applyCommand(project, { type: "component.add", component: upperExtract });
  assert.throws(() => applyCommand(project, {
    type: "terminal.assignRoom",
    roomId: "room-extract",
    componentId: upperExtract.id,
    portId: upperExtract.ports[0].id,
  }), /same floor/);

  const extract = createSyntheticComponent("synthetic-extract-terminal", {
    id: "component-extract",
    floorId: "floor-ground",
    xMm: 3000,
    yMm: 2000,
  });
  project = applyCommand(project, { type: "component.add", component: extract });
  project = applyCommand(project, {
    type: "terminal.assignRoom",
    roomId: "room-extract",
    componentId: extract.id,
    portId: extract.ports[0].id,
  });
  let duplicateProject = adjacentRoomProject();
  const duplicateCandidates = deriveRoomBoundaries(duplicateProject, "floor-ground").candidates;
  duplicateProject = createRoom(duplicateProject, "room-left-duplicate", "Bedroom 1", "bedroom", duplicateCandidates[0].key);
  duplicateProject = createRoom(duplicateProject, "room-right-duplicate", "Bedroom 2", "bedroom", duplicateCandidates[1].key);
  const duplicateTerminal = createSyntheticComponent("synthetic-supply-terminal", {
    id: "component-duplicate-terminal",
    floorId: "floor-ground",
    xMm: 2000,
    yMm: 2000,
  });
  duplicateProject = applyCommand(duplicateProject, { type: "component.add", component: duplicateTerminal });
  duplicateProject = applyCommand(duplicateProject, {
    type: "terminal.assignRoom",
    roomId: "room-left-duplicate",
    componentId: duplicateTerminal.id,
    portId: duplicateTerminal.ports[0].id,
  });
  const forged = structuredClone(duplicateProject);
  forged.rooms[1].terminalAssociations = structuredClone(forged.rooms[0].terminalAssociations);
  assert.throws(() => serializeProject(forged), /multiple rooms/);
});

test("two adjacent rooms share one physical wall and update area without changing identity", () => {
  let project = adjacentRoomProject();
  const candidates = deriveRoomBoundaries(project, "floor-ground").candidates;
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((candidate) => candidate.areaMm2), [16_000_000, 16_000_000]);

  const left = candidates.find((candidate) => candidate.centroidMm.x < 4000);
  const right = candidates.find((candidate) => candidate.centroidMm.x > 4000);
  project = createRoom(project, "room-left", "Kitchen", "kitchen", left.key);
  project = createRoom(project, "room-right", "Dining", "dining", right.key);
  project = applyCommand(project, {
    type: "wall.moveNode",
    nodeId: "node-b",
    xMm: 4500,
    yMm: 0,
  });
  project = applyCommand(project, {
    type: "wall.moveNode",
    nodeId: "node-c",
    xMm: 4500,
    yMm: 4000,
  });

  assert.equal(project.walls.filter((wall) => wall.id === "wall-b-c").length, 1);
  assert.equal(project.rooms.find((room) => room.id === "room-left").name, "Kitchen");
  assert.equal(project.rooms.find((room) => room.id === "room-right").name, "Dining");
  assert.equal(inspectRoomBoundary(project, project.rooms[0]).areaMm2, 18_000_000);
  assert.equal(inspectRoomBoundary(project, project.rooms[1]).areaMm2, 14_000_000);
});

test("open gaps and crossing walls diagnose topology without false room candidates", () => {
  const gap = rectangularProject({ gapMm: 5 });
  const gapResult = deriveRoomBoundaries(gap, "floor-ground");
  assert.equal(gapResult.candidates.length, 0);
  assert.ok(gapResult.diagnostics.some((item) => item.code === "open-endpoint"));

  const crossed = applyCommand(rectangularProject(), {
    type: "wall.addChain",
    floorId: "floor-ground",
    nodeIds: ["node-cross-a", "node-cross-b"],
    wallIds: ["wall-crossing"],
    points: [point(0, 2000), point(6000, 2000)],
    splits: [],
    thicknessMm: 140,
    heightMm: unknownMm("not measured"),
    referenceLine: "centreline",
    classification: "physical",
  });
  const crossingResult = deriveRoomBoundaries(crossed, "floor-ground");
  assert.equal(crossingResult.candidates.length, 0);
  assert.ok(crossingResult.diagnostics.some((item) => item.code === "crossing-without-junction"));

  const overlapped = applyCommand(rectangularProject(), {
    type: "wall.addChain",
    floorId: "floor-ground",
    nodeIds: ["node-a", "node-overlap-end"],
    wallIds: ["wall-overlap"],
    points: [point(0, 0), point(3000, 0)],
    splits: [],
    thicknessMm: 140,
    heightMm: unknownMm("not measured"),
    referenceLine: "centreline",
    classification: "physical",
  });
  const overlapResult = deriveRoomBoundaries(overlapped, "floor-ground");
  assert.equal(overlapResult.candidates.length, 0);
  assert.ok(overlapResult.diagnostics.some((item) => item.code === "overlapping-walls"));
});

test("splitting a room wall expands the stored boundary and preserves room identity", () => {
  let project = rectangularProject();
  const candidate = deriveRoomBoundaries(project, "floor-ground").candidates[0];
  project = createRoom(project, "room-main", "Living", "living", candidate.key);
  project = applyCommand(project, {
    type: "wall.split",
    wallId: "wall-a-b",
    newNodeId: "node-a-b-mid",
    newWallId: "wall-mid-b",
    point: { x: 3000, y: 0 },
  });

  const room = project.rooms[0];
  assert.equal(room.id, "room-main");
  assert.equal(room.boundary.length, 5);
  assert.equal(room.boundary.some((entry) => entry.wallId === "wall-mid-b"), true);
  assert.equal(inspectRoomBoundary(project, room).status, "current");
});

test("adding a physical partition wall requires explicit room reassignment instead of duplicating metadata", () => {
  let project = rectangularProject();
  const candidate = deriveRoomBoundaries(project, "floor-ground").candidates[0];
  project = createRoom(project, "room-original", "Kitchen / Dining", "kitchen-dining", candidate.key);
  project = applyCommand(project, {
    type: "wall.addChain",
    floorId: "floor-ground",
    nodeIds: ["node-a-b-mid", "node-c-d-mid"],
    wallIds: ["wall-divider"],
    points: [point(3000, 0), point(3000, 4000)],
    splits: [
      { wallId: "wall-a-b", nodeId: "node-a-b-mid", newWallId: "wall-mid-b", point: { x: 3000, y: 0 } },
      { wallId: "wall-c-d", nodeId: "node-c-d-mid", newWallId: "wall-mid-d", point: { x: 3000, y: 4000 } },
    ],
    thicknessMm: 140,
    heightMm: unknownMm("not measured"),
    referenceLine: "centreline",
    classification: "physical",
  });

  const derivation = deriveRoomBoundaries(project, "floor-ground");
  assert.equal(derivation.candidates.length, 2);
  assert.equal(inspectRoomBoundary(project, project.rooms[0], derivation).status, "reassignment-required");
  assert.equal(project.rooms.length, 1, "the split must not copy room metadata silently");

  project = applyCommand(project, {
    type: "room.assignBoundary",
    roomId: "room-original",
    boundaryKey: derivation.candidates[0].key,
  });
  project = createRoom(
    project,
    "room-created-after-split",
    "Dining",
    "dining",
    derivation.candidates[1].key,
  );
  assert.equal(project.rooms.find((room) => room.id === "room-original").name, "Kitchen / Dining");
  assert.equal(project.rooms.length, 2);
});

test("one eligible face cannot be assigned to two rooms and referenced walls cannot be deleted", () => {
  let project = rectangularProject();
  const candidate = deriveRoomBoundaries(project, "floor-ground").candidates[0];
  project = createRoom(project, "room-one", "Kitchen", "kitchen", candidate.key);
  assert.throws(
    () => createRoom(project, "room-two", "Dining", "dining", candidate.key),
    /already assigned/,
  );
  assert.throws(
    () => applyCommand(project, { type: "wall.delete", wallId: "wall-a-b" }),
    /blocked by dependent references/,
  );
  const forgedDuplicate = structuredClone(project);
  forgedDuplicate.rooms.push({ ...structuredClone(project.rooms[0]), id: "room-forged-duplicate" });
  assert.throws(() => serializeProject(forgedDuplicate), /cannot share one authoritative boundary/);
});

function projectWithFloor() {
  return applyCommand(createProject("project-room-boundaries"), {
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

function rectangularProject({ gapMm = 0 } = {}) {
  return applyCommand(projectWithFloor(), {
    type: "wall.addChain",
    floorId: "floor-ground",
    nodeIds: gapMm === 0
      ? ["node-a", "node-b", "node-c", "node-d", "node-a"]
      : ["node-a", "node-b", "node-c", "node-d", "node-gap"],
    wallIds: ["wall-a-b", "wall-b-c", "wall-c-d", "wall-d-a"],
    points: [point(0, 0), point(6000, 0), point(6000, 4000), point(0, 4000), point(gapMm, 0)],
    splits: [],
    thicknessMm: 140,
    heightMm: unknownMm("not measured"),
    referenceLine: "centreline",
    classification: "physical",
  });
}

function adjacentRoomProject() {
  let project = applyCommand(projectWithFloor(), {
    type: "wall.addChain",
    floorId: "floor-ground",
    nodeIds: ["node-a", "node-b", "node-c", "node-d", "node-a"],
    wallIds: ["wall-a-b", "wall-b-c", "wall-c-d", "wall-d-a"],
    points: [point(0, 0), point(4000, 0), point(4000, 4000), point(0, 4000), point(0, 0)],
    splits: [],
    thicknessMm: 140,
    heightMm: unknownMm("not measured"),
    referenceLine: "centreline",
    classification: "physical",
  });
  project = applyCommand(project, {
    type: "wall.addChain",
    floorId: "floor-ground",
    nodeIds: ["node-b", "node-e", "node-f", "node-c"],
    wallIds: ["wall-b-e", "wall-e-f", "wall-f-c"],
    points: [point(4000, 0), point(8000, 0), point(8000, 4000), point(4000, 4000)],
    splits: [],
    thicknessMm: 140,
    heightMm: unknownMm("not measured"),
    referenceLine: "centreline",
    classification: "physical",
  });
  return project;
}

function createRoom(project, roomId, name, use, boundaryKey) {
  return applyCommand(project, {
    type: "room.createFromBoundary",
    roomId,
    floorId: "floor-ground",
    boundaryKey,
    name,
    use,
    ventilationRole: "unassigned",
  });
}

function point(x, y) {
  return { x, y, z: unknownMm("not measured") };
}
