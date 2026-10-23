import assert from "node:assert/strict";
import test from "node:test";

import {
  createCommandHistory,
  executeCommand,
  MAX_COMMAND_HISTORY_BYTES,
  MAX_COMMAND_HISTORY_ENTRIES,
  redoCommand,
  undoCommand,
} from "../src/domain/history.mjs";
import {
  applyCommand,
  createProject,
  identityQuaternion,
  knownMm,
} from "../src/domain/spatial.mjs";

test("command history retains a bounded newest window and still supports undo and redo", () => {
  let history = createCommandHistory(projectWithFloor());
  const commandCount = MAX_COMMAND_HISTORY_ENTRIES + 25;
  for (let index = 0; index < commandCount; index += 1) {
    history = executeCommand(history, {
      type: "wall.addChain",
      floorId: "floor-ground",
      nodeIds: [`wall-node-${index}-a`, `wall-node-${index}-b`],
      wallIds: [`wall-${index}`],
      points: [
        { x: index * 20, y: 0, z: knownMm(0, "synthetic") },
        { x: index * 20, y: 10, z: knownMm(0, "synthetic") },
      ],
      thicknessMm: 90,
      heightMm: knownMm(2400, "synthetic"),
      referenceLine: "centreline",
      classification: "physical",
    });
  }

  assert.equal(history.past.length, MAX_COMMAND_HISTORY_ENTRIES);
  const beforeUndo = history.present.walls.length;
  history = undoCommand(history);
  assert.equal(history.present.walls.length, beforeUndo - 1);
  history = redoCommand(history);
  assert.equal(history.present.walls.length, beforeUndo);
  assert.equal(history.past.length, MAX_COMMAND_HISTORY_ENTRIES);
  assert.deepEqual(Object.keys(history.past.at(-1).command), ["type"]);
});

test("command history byte budget discards older snapshots before the newest", () => {
  const project = projectWithFloor();
  const oversizedEstimate = Math.floor(MAX_COMMAND_HISTORY_BYTES * 0.625);
  const history = {
    past: [
      { project: structuredClone(project), command: { type: "synthetic-oldest" }, estimatedBytes: oversizedEstimate },
      { project: structuredClone(project), command: { type: "synthetic-newer" }, estimatedBytes: oversizedEstimate },
    ],
    present: project,
    future: [],
  };

  const next = executeCommand(history, {
    type: "floor.add",
    floor: {
      id: "floor-upper",
      name: "Upper",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(3000, "synthetic") },
        orientation: identityQuaternion(),
      },
    },
  });

  assert.deepEqual(next.past.map((entry) => entry.command.type), ["synthetic-newer", "floor.add"]);
  assert.ok(next.past.reduce((total, entry) => total + entry.estimatedBytes, 0) <= MAX_COMMAND_HISTORY_BYTES);
});

function projectWithFloor() {
  return applyCommand(createProject("project-history-bounds"), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Ground",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "synthetic") },
        orientation: identityQuaternion(),
      },
    },
  });
}
