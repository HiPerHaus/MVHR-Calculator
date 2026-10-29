import assert from "node:assert/strict";
import test from "node:test";

import {
  airflowTargetFromInput,
  applyCommand,
  createProject,
  deserializeProject,
  identityQuaternion,
  knownMm,
  serializeProject,
  unresolvedSpaceAirflowTargets,
  unknownMm,
} from "../src/domain/spatial.mjs";
import { deriveRoomBoundaries } from "../src/domain/rooms.mjs";
import { createSyntheticComponent } from "../src/editor/synthetic-catalogue.mjs";
import { inspectAirflowBalance } from "../src/editor/airflow-balance.mjs";

test("schema-16 rooms migrate with separate unresolved required and assigned Normal targets", () => {
  let project = twoRoomProject();
  project = createRoom(project, "room-supply", "Bedroom", "supply", leftBoundary(project));
  const legacy = structuredClone(project);
  legacy.schemaVersion = 16;
  delete legacy.rooms[0].airflowTargets;

  const reopened = deserializeProject(JSON.stringify(legacy));
  assert.deepEqual(reopened.rooms[0].airflowTargets, unresolvedSpaceAirflowTargets());
  assert.equal(reopened.quoteSnapshots.length, 0);
  assert.equal(reopened.pdfReferenceAssets.length, 0);

  const roomFree = createProject("room-free-airflow-project");
  assert.deepEqual(inspectAirflowBalance(
    applyCommand(roomFree, { type: "floor.add", floor: floor() }),
    "floor-ground",
  ).lines, []);
});

test("explicit units, basis and source produce transparent required and assigned totals without a compliance verdict", () => {
  let project = twoRoomProject();
  project = createRoom(project, "room-bedroom", "Bedroom", "supply", leftBoundary(project));
  project = createRoom(project, "room-bathroom", "Bathroom", "extract", rightBoundary(project));
  project = updateTargets(project, "room-bedroom", "room", {
    required: airflowTargetFromInput(54, "m3/h", "User-selected design basis", "Project brief R1"),
    assigned: airflowTargetFromInput(18, "l/s", "Designer-assigned Normal target", "Manual entry by Jono"),
  });
  project = updateTargets(project, "room-bathroom", "room", {
    required: airflowTargetFromInput(14, "l/s", "User-selected design basis", "Project brief R1"),
    assigned: airflowTargetFromInput(43.2, "m3/h", "Designer-assigned Normal target", "Manual entry by Jono"),
  });
  project = addAndAssignTerminal(project, "supply-terminal", "synthetic-supply-terminal", "room-bedroom", 2000, 2000);
  project = addAndAssignTerminal(project, "extract-terminal", "synthetic-extract-terminal", "room-bathroom", 6000, 2000);

  const inspection = inspectAirflowBalance(project, "floor-ground");
  assert.equal(project.rooms[0].airflowTargets.normal.required.valueLps, 15);
  assert.equal(project.rooms[1].airflowTargets.normal.assigned.valueLps, 12);
  assert.equal(inspection.totals.supply.requiredKnownLps, 15);
  assert.equal(inspection.totals.supply.assignedKnownLps, 18);
  assert.equal(inspection.totals.extract.requiredKnownLps, 14);
  assert.equal(inspection.totals.extract.assignedKnownLps, 12);
  assert.equal(inspection.assignedImbalanceLps, 6);
  assert.equal(inspection.assignedBalanceState, "calculated-no-tolerance-applied");
  assert.equal(inspection.numericRelation, "known-supply-subtotal-greater");
  assert.equal(inspection.lines.find((line) => line.id === "room-bedroom").assignedMinusRequiredLps, 3);
  assert.match(inspection.evidenceBoundary, /no regulatory rate.*balance tolerance.*compliance verdict/i);
});

test("missing targets, unmatched terminals and unapplied required-target suggestions stay explicit", () => {
  let project = twoRoomProject();
  project = createRoom(project, "room-bedroom", "Bedroom", "supply", leftBoundary(project));
  project = createRoom(project, "room-bathroom", "Bathroom", "extract", rightBoundary(project));
  project = updateTargets(project, "room-bedroom", "room", {
    required: airflowTargetFromInput(10, "l/s", "Owner-entered requirement", "Room schedule draft"),
  });
  project = updateTargets(project, "room-bathroom", "room", {
    assigned: airflowTargetFromInput(12, "l/s", "Designer-assigned Normal target", "Manual entry"),
  });
  project = addAndAssignTerminal(project, "assigned-supply-terminal", "synthetic-supply-terminal", "room-bedroom", 2000, 2000);
  const looseExtract = createSyntheticComponent("synthetic-extract-terminal", {
    id: "unassigned-extract-terminal",
    floorId: "floor-ground",
    xMm: 9000,
    yMm: 2000,
  });
  project = applyCommand(project, { type: "component.add", component: looseExtract, autoAssignTerminalSpace: true });

  const inspection = inspectAirflowBalance(project, "floor-ground");
  assert.equal(inspection.assignedBalanceState, "incomplete");
  assert.deepEqual(inspection.missingAssignedTargetSpaceIds, ["room-bedroom"]);
  assert.deepEqual(inspection.terminalWithoutTargetSpaceIds, ["room-bedroom"]);
  assert.deepEqual(inspection.targetWithoutTerminalSpaceIds, ["room-bathroom"]);
  assert.deepEqual(inspection.unassignedTerminals.map((item) => item.componentId), ["unassigned-extract-terminal"]);
  assert.equal(inspection.suggestions.length, 1);
  assert.equal(inspection.suggestions[0].status, "available-user-action-not-applied");
  assert.equal(project.rooms.find((room) => room.id === "room-bedroom").airflowTargets.normal.assigned.state, "unresolved");

  project = updateTargets(project, "room-bedroom", "room", {
    required: project.rooms.find((room) => room.id === "room-bedroom").airflowTargets.normal.required,
    assigned: airflowTargetFromInput(10, "l/s", "Explicitly adopted from required Normal target", "Room schedule draft"),
  });
  assert.equal(inspectAirflowBalance(project, "floor-ground").suggestions.length, 0);
});

test("terminal movement and spatial reassignment change coverage without moving room targets", () => {
  let project = twoRoomProject();
  project = createRoom(project, "room-left", "Bedroom 1", "supply", leftBoundary(project));
  project = createRoom(project, "room-right", "Bedroom 2", "supply", rightBoundary(project));
  project = updateTargets(project, "room-left", "room", {
    assigned: airflowTargetFromInput(11, "l/s", "Designer-assigned Normal target", "Manual entry"),
  });
  project = updateTargets(project, "room-right", "room", {
    assigned: airflowTargetFromInput(13, "l/s", "Designer-assigned Normal target", "Manual entry"),
  });
  const terminal = createSyntheticComponent("synthetic-supply-terminal", {
    id: "moving-terminal",
    floorId: "floor-ground",
    xMm: 2000,
    yMm: 2000,
  });
  project = applyCommand(project, { type: "component.add", component: terminal, autoAssignTerminalSpace: true });
  assert.equal(inspectAirflowBalance(project, "floor-ground").lines.find((line) => line.id === "room-left").terminalCount, 1);

  project = applyCommand(project, {
    type: "component.moveXY",
    componentId: terminal.id,
    xMm: 6000,
    yMm: 2000,
    autoAssignTerminalSpace: true,
  });
  const moved = inspectAirflowBalance(project, "floor-ground");
  assert.equal(moved.lines.find((line) => line.id === "room-left").terminalCount, 0);
  assert.equal(moved.lines.find((line) => line.id === "room-right").terminalCount, 1);
  assert.equal(project.rooms.find((room) => room.id === "room-left").airflowTargets.normal.assigned.valueLps, 11);
  assert.equal(project.rooms.find((room) => room.id === "room-right").airflowTargets.normal.assigned.valueLps, 13);
});

test("airflow targets and balance are deterministic through save and reopen", () => {
  let project = twoRoomProject();
  project = createRoom(project, "room-save", "Bedroom", "supply", leftBoundary(project));
  project = updateTargets(project, "room-save", "room", {
    required: airflowTargetFromInput(36, "m3/h", "Project-specific required flow", "Owner brief"),
    assigned: airflowTargetFromInput(12, "l/s", "Manual designer override", "Design note 7"),
  });
  const expected = inspectAirflowBalance(project, "floor-ground");
  const reopened = deserializeProject(serializeProject(project));
  assert.deepEqual(reopened, project);
  assert.deepEqual(inspectAirflowBalance(reopened, "floor-ground"), expected);

  const forged = structuredClone(project);
  forged.rooms[0].airflowTargets.normal.assigned.valueLps = 999;
  assert.throws(() => serializeProject(forged), /canonical L\/s value/);
  assert.throws(() => applyCommand(project, {
    type: "room.updateMetadata",
    roomId: "room-save",
    name: "Bedroom",
    use: "bedroom",
    ventilationRole: "none",
  }), /Known airflow targets require a supply or extract/);
});

test("zero difference stays known and multiple terminals do not multiply a room target", () => {
  let project = twoRoomProject();
  project = createRoom(project, "room-multi", "Bedroom", "supply", leftBoundary(project));
  project = updateTargets(project, "room-multi", "room", {
    required: airflowTargetFromInput(10, "l/s", "Room requirement", "Test schedule"),
    assigned: airflowTargetFromInput(36, "m3/h", "Assigned room design target", "Test schedule"),
  });
  project = addAndAssignTerminal(project, "supply-terminal-a", "synthetic-supply-terminal", "room-multi", 1500, 1500);
  project = addAndAssignTerminal(project, "supply-terminal-b", "synthetic-supply-terminal", "room-multi", 2500, 2500);

  const inspection = inspectAirflowBalance(project, "floor-ground");
  const line = inspection.lines.find((candidate) => candidate.id === "room-multi");
  assert.equal(line.terminalCount, 2);
  assert.equal(line.assignedMinusRequiredLps, 0);
  assert.equal(line.coverageStatus, "assigned-target-not-allocated-across-multiple-terminals");
  assert.equal(inspection.totals.supply.assignedKnownLps, 10);
  assert.equal(inspection.totals.supply.terminalCount, 2);
});

function updateTargets(project, id, kind, partial) {
  const collection = kind === "zone" ? project.zones : project.rooms;
  const space = collection.find((candidate) => candidate.id === id);
  const targets = structuredClone(space.airflowTargets);
  if (partial.required) targets.normal.required = partial.required;
  if (partial.assigned) targets.normal.assigned = partial.assigned;
  return applyCommand(project, {
    type: `${kind}.updateMetadata`,
    [`${kind}Id`]: id,
    name: space.name,
    use: space.use,
    ventilationRole: space.ventilationRole,
    airflowTargets: targets,
  });
}

function addAndAssignTerminal(project, id, catalogueId, roomId, xMm, yMm) {
  const terminal = createSyntheticComponent(catalogueId, { id, floorId: "floor-ground", xMm, yMm });
  project = applyCommand(project, { type: "component.add", component: terminal });
  return applyCommand(project, {
    type: "terminal.assignRoom",
    roomId,
    componentId: terminal.id,
    portId: terminal.ports[0].id,
  });
}

function createRoom(project, id, name, ventilationRole, boundaryKey) {
  return applyCommand(project, {
    type: "room.createFromBoundary",
    roomId: id,
    floorId: "floor-ground",
    boundaryKey,
    name,
    use: name.startsWith("Bath") ? "bathroom" : "bedroom",
    ventilationRole,
  });
}

function twoRoomProject() {
  let project = applyCommand(createProject("project-airflow-balance"), { type: "floor.add", floor: floor() });
  project = applyCommand(project, wallChain(
    ["node-a", "node-b", "node-c", "node-d", "node-a"],
    ["wall-a-b", "wall-b-c", "wall-c-d", "wall-d-a"],
    [point(0, 0), point(4000, 0), point(4000, 4000), point(0, 4000), point(0, 0)],
  ));
  project = applyCommand(project, wallChain(
    ["node-b", "node-e", "node-f", "node-c"],
    ["wall-b-e", "wall-e-f", "wall-f-c"],
    [point(4000, 0), point(8000, 0), point(8000, 4000), point(4000, 4000)],
  ));
  return project;
}

function leftBoundary(project) {
  return deriveRoomBoundaries(project, "floor-ground").candidates.find((candidate) => candidate.centroidMm.x < 4000).key;
}

function rightBoundary(project) {
  return deriveRoomBoundaries(project, "floor-ground").candidates.find((candidate) => candidate.centroidMm.x > 4000).key;
}

function floor() {
  return {
    id: "floor-ground",
    name: "Ground Floor",
    transform: {
      translationMm: { x: 0, y: 0, z: knownMm(0, "airflow test datum") },
      orientation: identityQuaternion(),
    },
  };
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
