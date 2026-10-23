import assert from "node:assert/strict";
import test from "node:test";

import {
  canRedo,
  canUndo,
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
  unknownMm,
} from "../src/domain/spatial.mjs";

test("a wall chain creates explicit shared topology", () => {
  const project = applyCommand(projectWithFloor(), wallChainCommand());

  assert.equal(project.wallNodes.length, 3);
  assert.equal(project.walls.length, 2);
  assert.equal(project.walls[0].endNodeId, "wall-node-b");
  assert.equal(project.walls[1].startNodeId, "wall-node-b");
  assert.equal(project.walls[0].thicknessMm, 140);
  assert.equal(project.walls[0].heightMm.state, "unknown");
});

test("wall commands reject zero-length geometry, dangling floors, and duplicate IDs", () => {
  const project = projectWithFloor();
  const zeroLength = wallChainCommand();
  zeroLength.points[1] = structuredClone(zeroLength.points[0]);
  assert.throws(() => applyCommand(project, zeroLength), /non-zero plan length/);

  const danglingFloor = wallChainCommand();
  danglingFloor.floorId = "floor-missing";
  assert.throws(() => applyCommand(project, danglingFloor), /Floor not found/);

  const duplicateNodes = wallChainCommand();
  duplicateNodes.nodeIds[1] = duplicateNodes.nodeIds[0];
  assert.throws(() => applyCommand(project, duplicateNodes), /different nodes/);
});

test("moving a wall node preserves topology IDs and unknown elevation", () => {
  const project = applyCommand(projectWithFloor(), wallChainCommand());
  const moved = applyCommand(project, {
    type: "wall.moveNode",
    nodeId: "wall-node-b",
    xMm: 6500,
    yMm: 500,
  });

  assert.equal(moved.wallNodes.find((node) => node.id === "wall-node-b").positionMm.x, 6500);
  assert.equal(
    moved.wallNodes.find((node) => node.id === "wall-node-b").positionMm.z.state,
    "unknown",
  );
  assert.equal(moved.walls[0].endNodeId, "wall-node-b");
  assert.equal(moved.walls[1].startNodeId, "wall-node-b");
  assert.equal(project.wallNodes.find((node) => node.id === "wall-node-b").positionMm.x, 6000);
});

test("one committed wall chain is one undoable and redoable command", () => {
  const initial = projectWithFloor();
  const history = createCommandHistory(initial);
  const executed = executeCommand(history, wallChainCommand());

  assert.equal(canUndo(executed), true);
  assert.equal(executed.present.walls.length, 2);
  const undone = undoCommand(executed);
  assert.equal(undone.present.walls.length, 0);
  assert.equal(canRedo(undone), true);
  const redone = redoCommand(undone);
  assert.deepEqual(redone.present, executed.present);
  assert.equal(canRedo(redone), false);
  assert.equal(history.present.walls.length, 0, "history operations must not mutate prior states");
});

test("a new command after undo clears redo history", () => {
  let history = createCommandHistory(projectWithFloor());
  history = executeCommand(history, wallChainCommand());
  history = undoCommand(history);
  const alternate = wallChainCommand();
  alternate.nodeIds = ["wall-node-x", "wall-node-y", "wall-node-z"];
  alternate.wallIds = ["wall-x-y", "wall-y-z"];
  alternate.points[1].y = 1200;
  history = executeCommand(history, alternate);

  assert.equal(canRedo(history), false);
  assert.equal(history.present.walls[0].id, "wall-x-y");
});

test("wall graph save and reopen preserves identities and explicit unknowns", () => {
  const project = applyCommand(projectWithFloor(), wallChainCommand());
  const reopened = deserializeProject(serializeProject(project));

  assert.deepEqual(reopened.wallNodes, project.wallNodes);
  assert.deepEqual(reopened.walls, project.walls);
  assert.equal(reopened.walls[0].heightMm.valueMm, null);
});

test("a closed chain and adjoining chain reuse endpoints without coincident nodes", () => {
  let project = applyCommand(projectWithFloor(), closedRectangleCommand());
  project = applyCommand(project, adjoiningChainCommand());

  assert.equal(project.wallNodes.length, 6);
  assert.equal(project.walls.length, 7);
  assert.equal(project.wallNodes.filter((node) => node.id === "wall-node-b").length, 1);
  assert.equal(project.wallNodes.filter((node) => node.id === "wall-node-c").length, 1);
  assert.equal(
    project.walls.filter(
      (wall) => wall.startNodeId === "wall-node-b" || wall.endNodeId === "wall-node-b",
    ).length,
    3,
  );
});

test("coincident nodes and duplicate topological edges require explicit reuse", () => {
  const project = applyCommand(projectWithFloor(), closedRectangleCommand());
  const coincident = adjoiningChainCommand();
  coincident.nodeIds[0] = "new-node-at-b";
  assert.throws(() => applyCommand(project, coincident), /reuse coincident node identity/);

  const duplicateEdge = adjoiningChainCommand();
  duplicateEdge.nodeIds = ["wall-node-b", "wall-node-c"];
  duplicateEdge.wallIds = ["duplicate-b-c"];
  duplicateEdge.points = [point(6000, 0), point(6000, 4000)];
  assert.throws(() => applyCommand(project, duplicateEdge), /duplicates an existing topological edge/);
});

test("moving a shared endpoint updates every incident wall as one undoable command", () => {
  let history = createCommandHistory(
    applyCommand(
      applyCommand(projectWithFloor(), closedRectangleCommand()),
      adjoiningChainCommand(),
    ),
  );
  const before = structuredClone(history.present);
  history = executeCommand(history, {
    type: "wall.moveNode",
    nodeId: "wall-node-b",
    xMm: 6200,
    yMm: 200,
  });

  const incident = history.present.walls.filter(
    (wall) => wall.startNodeId === "wall-node-b" || wall.endNodeId === "wall-node-b",
  );
  assert.equal(incident.length, 3);
  assert.equal(
    history.present.wallNodes.find((node) => node.id === "wall-node-b").positionMm.z.state,
    "unknown",
  );
  history = undoCommand(history);
  assert.deepEqual(history.present, before);
  history = redoCommand(history);
  assert.equal(
    history.present.wallNodes.find((node) => node.id === "wall-node-b").positionMm.x,
    6200,
  );
});

test("splitting a wall preserves its identity and interpolates explicit elevation state", () => {
  let project = projectWithFloor();
  const wall = singleWallCommand();
  wall.points = [
    { x: 0, y: 0, z: knownMm(100, "synthetic start") },
    { x: 6000, y: 0, z: knownMm(400, "synthetic end") },
  ];
  project = applyCommand(project, wall);
  const original = structuredClone(project.walls[0]);
  const split = applyCommand(project, {
    type: "wall.split",
    wallId: "wall-a-b",
    newNodeId: "wall-node-junction",
    newWallId: "wall-junction-b",
    point: { x: 3000, y: 0 },
  });

  assert.equal(split.walls.length, 2);
  assert.equal(split.walls[0].id, original.id, "the start-side segment retains the source wall ID");
  assert.equal(split.walls[0].startNodeId, "wall-node-a");
  assert.equal(split.walls[0].endNodeId, "wall-node-junction");
  assert.equal(split.walls[1].startNodeId, "wall-node-junction");
  assert.equal(split.walls[1].endNodeId, "wall-node-b");
  assert.equal(split.walls[1].thicknessMm, original.thicknessMm);
  assert.equal(split.walls[1].referenceLine, original.referenceLine);
  assert.deepEqual(
    split.wallNodes.find((node) => node.id === "wall-node-junction").positionMm.z,
    knownMm(250, "interpolated from wall endpoints during split"),
  );
  assert.equal(project.walls.length, 1, "the prior project remains unchanged");
});

test("a T-junction split and new branch are one undoable topology command", () => {
  const initial = applyCommand(projectWithFloor(), singleWallCommand());
  let history = createCommandHistory(initial);
  history = executeCommand(history, tJunctionCommand());

  const junction = history.present.wallNodes.find((node) => node.id === "wall-node-junction");
  const incident = history.present.walls.filter(
    (wall) => wall.startNodeId === junction.id || wall.endNodeId === junction.id,
  );
  assert.equal(incident.length, 3);
  assert.deepEqual(
    new Set(incident.map((wall) => wall.id)),
    new Set(["wall-a-b", "wall-junction-b", "wall-junction-leg"]),
  );
  assert.equal(junction.positionMm.z.state, "unknown");
  assert.equal(history.present.wallNodes.filter((node) => node.positionMm.x === 3000 && node.positionMm.y === 0).length, 1);

  const completed = structuredClone(history.present);
  history = undoCommand(history);
  assert.deepEqual(history.present, initial);
  history = redoCommand(history);
  assert.deepEqual(history.present, completed);
  assert.deepEqual(deserializeProject(serializeProject(completed)), completed);
});

test("editing a committed T-junction moves every incident segment as one command", () => {
  let history = createCommandHistory(
    applyCommand(applyCommand(projectWithFloor(), singleWallCommand()), tJunctionCommand()),
  );
  const before = structuredClone(history.present);
  history = executeCommand(history, {
    type: "wall.moveNode",
    nodeId: "wall-node-junction",
    xMm: 3200,
    yMm: 200,
  });
  const incident = history.present.walls.filter(
    (wall) => wall.startNodeId === "wall-node-junction" || wall.endNodeId === "wall-node-junction",
  );
  assert.equal(incident.length, 3);
  assert.deepEqual(
    new Set(incident.map((wall) => wall.id)),
    new Set(["wall-a-b", "wall-junction-b", "wall-junction-leg"]),
  );
  assert.deepEqual(
    history.present.wallNodes.find((node) => node.id === "wall-node-junction").positionMm,
    { x: 3200, y: 200, z: unknownMm("wall split elevation depends on an unknown endpoint elevation") },
  );
  history = undoCommand(history);
  assert.deepEqual(history.present, before);
});

test("invalid or ambiguous wall splits fail atomically", () => {
  const project = applyCommand(projectWithFloor(), singleWallCommand());
  const before = structuredClone(project);
  for (const [pointValue, message] of [
    [{ x: 0, y: 0 }, /strictly inside/],
    [{ x: 3000, y: 20 }, /strictly inside/],
  ]) {
    assert.throws(() => applyCommand(project, {
      type: "wall.split",
      wallId: "wall-a-b",
      newNodeId: "wall-node-junction",
      newWallId: "wall-junction-b",
      point: pointValue,
    }), message);
    assert.deepEqual(project, before);
  }

  const duplicateSplit = tJunctionCommand();
  duplicateSplit.splits.push({
    wallId: "wall-a-b",
    nodeId: "wall-node-other-junction",
    newWallId: "wall-other-junction-b",
    point: { x: 4000, y: 0 },
  });
  assert.throws(() => applyCommand(project, duplicateSplit), /Duplicate Wall-chain split source wall ID/);
  assert.deepEqual(project, before);

  const invalidBranchAfterSplit = tJunctionCommand();
  invalidBranchAfterSplit.points[1] = point(3000, 0);
  assert.throws(() => applyCommand(project, invalidBranchAfterSplit), /non-zero plan length/);
  assert.deepEqual(project, before, "a later chain failure cannot leak a provisional wall split");
});

test("wall splitting is blocked when explicit dependants cannot be safely reassigned", () => {
  let project = applyCommand(projectWithFloor(), singleWallCommand());
  project = applyCommand(project, {
    type: "component.add",
    component: {
      id: "component-hosted-before-split",
      floorId: "floor-ground",
      positionMm: { x: 4500, y: 0, z: unknownMm("synthetic hosted height unknown") },
      orientation: identityQuaternion(),
      ports: [],
      hostWallId: "wall-a-b",
    },
  });
  const before = structuredClone(project);

  assert.throws(
    () => applyCommand(project, tJunctionCommand()),
    /Wall split is blocked by dependent references: components\.0\.hostWallId/,
  );
  assert.deepEqual(project, before);
});

test("deleting one T-junction branch preserves neighbouring walls and shared junction identity", () => {
  const project = applyCommand(
    applyCommand(projectWithFloor(), singleWallCommand()),
    tJunctionCommand(),
  );
  const deleted = applyCommand(project, {
    type: "wall.delete",
    wallId: "wall-junction-leg",
  });

  assert.deepEqual(
    deleted.walls.map((wall) => wall.id),
    ["wall-a-b", "wall-junction-b"],
  );
  assert.ok(deleted.wallNodes.some((node) => node.id === "wall-node-junction"));
  assert.equal(deleted.wallNodes.some((node) => node.id === "wall-node-leg"), false);
  assert.equal(deleted.walls[0].endNodeId, "wall-node-junction");
  assert.equal(deleted.walls[1].startNodeId, "wall-node-junction");
  assert.equal(project.walls.length, 3, "deletion must not mutate the prior project");
});

test("deleting a wall removes only orphaned endpoints and preserves a shared junction", () => {
  const project = applyCommand(
    applyCommand(projectWithFloor(), singleWallCommand()),
    tJunctionCommand(),
  );
  const deleted = applyCommand(project, {
    type: "wall.delete",
    wallId: "wall-a-b",
  });

  assert.equal(deleted.wallNodes.some((node) => node.id === "wall-node-a"), false);
  assert.ok(deleted.wallNodes.some((node) => node.id === "wall-node-junction"));
  assert.deepEqual(
    new Set(deleted.walls.map((wall) => wall.id)),
    new Set(["wall-junction-b", "wall-junction-leg"]),
  );
});

test("deleting a connected chain is distinct from deleting one wall", () => {
  let project = applyCommand(projectWithFloor(), singleWallCommand());
  project = applyCommand(project, tJunctionCommand());
  project = applyCommand(project, disconnectedWallCommand());

  const single = applyCommand(project, { type: "wall.delete", wallId: "wall-a-b" });
  assert.equal(single.walls.length, 3);
  assert.ok(single.walls.some((wall) => wall.id === "wall-disconnected"));

  const connected = applyCommand(project, {
    type: "wall.deleteConnected",
    wallId: "wall-a-b",
  });
  assert.deepEqual(connected.walls.map((wall) => wall.id), ["wall-disconnected"]);
  assert.deepEqual(
    new Set(connected.wallNodes.map((node) => node.id)),
    new Set(["wall-node-disconnected-a", "wall-node-disconnected-b"]),
  );
});

test("wall deletion rejects dangling identities and explicit dependent wall references atomically", () => {
  const project = applyCommand(projectWithFloor(), singleWallCommand());
  const before = structuredClone(project);
  assert.throws(
    () => applyCommand(project, { type: "wall.delete", wallId: "wall-missing" }),
    /Wall to delete not found/,
  );
  assert.deepEqual(project, before);

  const dependent = applyCommand(project, {
    type: "component.add",
    component: {
      id: "component-hosted",
      floorId: "floor-ground",
      positionMm: { x: 1200, y: 0, z: unknownMm("mounting height not measured") },
      orientation: identityQuaternion(),
      ports: [],
      hostWallId: "wall-a-b",
    },
  });
  const dependentBefore = structuredClone(dependent);
  assert.throws(
    () => applyCommand(dependent, { type: "wall.delete", wallId: "wall-a-b" }),
    /blocked by dependent references: components\.0\.hostWallId/,
  );
  assert.deepEqual(dependent, dependentBefore);
});

test("wall deletion survives save and reopen and repeated undo-redo cycles", () => {
  const initial = applyCommand(
    applyCommand(projectWithFloor(), singleWallCommand()),
    tJunctionCommand(),
  );
  let history = createCommandHistory(initial);
  history = executeCommand(history, { type: "wall.delete", wallId: "wall-junction-leg" });
  const deleted = structuredClone(history.present);

  assert.deepEqual(deserializeProject(serializeProject(deleted)), deleted);
  history = undoCommand(history);
  assert.deepEqual(history.present, initial);
  history = redoCommand(history);
  assert.deepEqual(history.present, deleted);
  history = undoCommand(history);
  assert.deepEqual(history.present, initial);
  history = redoCommand(history);
  assert.deepEqual(history.present, deleted);
});

function projectWithFloor() {
  return applyCommand(createProject("project-wall-fixture"), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "synthetic-fixture") },
        orientation: identityQuaternion(),
      },
    },
  });
}

function wallChainCommand() {
  return {
    type: "wall.addChain",
    floorId: "floor-ground",
    nodeIds: ["wall-node-a", "wall-node-b", "wall-node-c"],
    wallIds: ["wall-a-b", "wall-b-c"],
    points: [
      { x: 0, y: 0, z: unknownMm("base elevation not measured") },
      { x: 6000, y: 0, z: unknownMm("base elevation not measured") },
      { x: 6000, y: 4000, z: unknownMm("base elevation not measured") },
    ],
    thicknessMm: 140,
    heightMm: unknownMm("wall height not measured"),
    referenceLine: "centreline",
    classification: "physical",
  };
}

function singleWallCommand() {
  return {
    ...wallChainCommand(),
    nodeIds: ["wall-node-a", "wall-node-b"],
    wallIds: ["wall-a-b"],
    points: [point(0, 0), point(6000, 0)],
  };
}

function tJunctionCommand() {
  return {
    ...wallChainCommand(),
    nodeIds: ["wall-node-junction", "wall-node-leg"],
    wallIds: ["wall-junction-leg"],
    points: [point(3000, 0), point(3000, 3000)],
    splits: [
      {
        wallId: "wall-a-b",
        nodeId: "wall-node-junction",
        newWallId: "wall-junction-b",
        point: { x: 3000, y: 0 },
      },
    ],
  };
}

function closedRectangleCommand() {
  return {
    ...wallChainCommand(),
    nodeIds: ["wall-node-a", "wall-node-b", "wall-node-c", "wall-node-d", "wall-node-a"],
    wallIds: ["wall-a-b", "wall-b-c", "wall-c-d", "wall-d-a"],
    points: [point(0, 0), point(6000, 0), point(6000, 4000), point(0, 4000), point(0, 0)],
  };
}

function adjoiningChainCommand() {
  return {
    ...wallChainCommand(),
    nodeIds: ["wall-node-b", "wall-node-e", "wall-node-f", "wall-node-c"],
    wallIds: ["wall-b-e", "wall-e-f", "wall-f-c"],
    points: [point(6000, 0), point(10000, 0), point(10000, 4000), point(6000, 4000)],
  };
}

function disconnectedWallCommand() {
  return {
    ...wallChainCommand(),
    nodeIds: ["wall-node-disconnected-a", "wall-node-disconnected-b"],
    wallIds: ["wall-disconnected"],
    points: [point(9000, 7000), point(12000, 7000)],
  };
}

function point(x, y) {
  return { x, y, z: unknownMm("base elevation not measured") };
}
