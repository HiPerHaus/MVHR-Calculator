import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  createProject,
  floorPortTransform,
  identityQuaternion,
  knownMm,
  serializeProject,
  unknownMm,
  validateProject,
} from "../src/domain/spatial.mjs";
import {
  canRedo,
  canUndo,
  createCommandHistory,
  executeCommand,
  redoCommand,
  undoCommand,
} from "../src/domain/history.mjs";
import {
  activateMechanicalTool,
  cancelMechanicalOperation,
  createMechanicalInteractionState,
  handleMechanicalCanvasClick,
} from "../src/editor/mechanical-controller.mjs";
import { createSyntheticComponent } from "../src/editor/synthetic-catalogue.mjs";

test("deterministic seeded operation sequences preserve project invariants through undo-redo", () => {
  const first = runSeededOperations(0x51a7c0de, 240);
  const replay = runSeededOperations(0x51a7c0de, 240);
  const different = runSeededOperations(0x1badb002, 240);

  assert.deepEqual(replay.log, first.log);
  assert.equal(replay.projectJson, first.projectJson);
  assert.notEqual(different.projectJson, first.projectJson);
  assert.equal(first.stepsValidated, 240);
});

function runSeededOperations(seed, count) {
  const random = seededRandom(seed);
  let history = createCommandHistory(baseProject());
  const log = [];
  for (let step = 0; step < count; step += 1) {
    const operation = Math.floor(random() * 7);
    if (operation === 0) {
      const command = {
        type: "component.moveXY",
        componentId: "component-unit",
        xMm: 1000 + Math.round(random() * 1800),
        yMm: 1000 + Math.round(random() * 1400),
      };
      history = executeCommand(history, command);
      log.push(["move-component", command.xMm, command.yMm]);
    } else if (operation === 1) {
      const angleRad = random() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
      history = executeCommand(history, {
        type: "component.rotateFloorZ",
        componentId: "component-unit",
        angleRad,
      });
      log.push(["rotate-component", angleRad]);
    } else if (operation === 2) {
      const command = {
        type: "wall.moveNode",
        nodeId: "wall-node-shared",
        xMm: 4500 + Math.round(random() * 1200),
        yMm: -400 + Math.round(random() * 800),
      };
      history = executeCommand(history, command);
      log.push(["move-wall-node", command.xMm, command.yMm]);
    } else if (operation === 3 && canUndo(history)) {
      history = undoCommand(history);
      log.push(["undo"]);
    } else if (operation === 4 && canRedo(history)) {
      history = redoCommand(history);
      log.push(["redo"]);
    } else if (operation === 5) {
      const before = serializeProject(history.present);
      assert.throws(() => executeCommand(history, {
        type: "component.moveXY",
        componentId: "component-unit",
        xMm: Number.NaN,
        yMm: 0,
      }), /finite/);
      assert.equal(serializeProject(history.present), before);
      log.push(["rejected-nonfinite"]);
    } else {
      const before = serializeProject(history.present);
      let state = activateMechanicalTool(createMechanicalInteractionState(), "route", {
        ductKind: "generic-duct",
      });
      const unused = history.present.components[0].ports.find((port) => port.role === "Outdoor intake");
      const point = floorPortTransform(history.present, "component-unit", unused.id).positionMm;
      state = handleMechanicalCanvasClick(state, {
        point,
        hit: {
          kind: "port",
          componentId: "component-unit",
          portId: unused.id,
          system: unused.system,
          stream: unused.stream,
          role: unused.role,
        },
      }).state;
      state = handleMechanicalCanvasClick(state, {
        point: { x: Math.round(random() * 6000), y: Math.round(random() * 4000) },
        hit: { kind: "wall" },
      }).state;
      state = cancelMechanicalOperation(state);
      assert.equal(state.routeDraft, null);
      assert.equal(serializeProject(history.present), before);
      log.push(["cancel-route"]);
    }
    validateProject(history.present);
    assert.equal(history.present.walls.length, 2);
    assert.equal(history.present.routes.length, 1);
    assert.equal(history.present.connections.length, 0);
  }
  return { log, projectJson: serializeProject(history.present), stepsValidated: count };
}

function baseProject() {
  let project = applyCommand(createProject("project-deterministic-operations"), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Synthetic Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "seeded operation datum") },
        orientation: identityQuaternion(),
      },
    },
  });
  project = applyCommand(project, {
    type: "wall.addChain",
    floorId: "floor-ground",
    nodeIds: ["wall-node-a", "wall-node-shared", "wall-node-b"],
    wallIds: ["wall-a-shared", "wall-shared-b"],
    points: [wallPoint(0, 0), wallPoint(5000, 0), wallPoint(8000, 3000)],
    splits: [],
    thicknessMm: 140,
    heightMm: unknownMm("seeded wall height not set"),
    referenceLine: "centreline",
    classification: "physical",
  });
  const unit = createSyntheticComponent("synthetic-mvhr-placeholder", {
    id: "component-unit",
    floorId: "floor-ground",
    xMm: 1500,
    yMm: 1500,
  });
  const terminal = createSyntheticComponent("synthetic-supply-terminal", {
    id: "component-terminal",
    floorId: "floor-ground",
    xMm: 6500,
    yMm: 1500,
  });
  project = applyCommand(project, { type: "component.add", component: unit });
  project = applyCommand(project, { type: "component.add", component: terminal });
  const start = unit.ports.find((port) => port.role === "Dwelling supply");
  const end = terminal.ports[0];
  project = applyCommand(project, {
    type: "route.add",
    route: {
      id: "route-seeded",
      floorId: "floor-ground",
      system: "mvhr",
      stream: "supply",
      role: "Dwelling supply",
      ductKind: "generic-duct",
      startAttachment: { componentId: unit.id, portId: start.id },
      endAttachment: { componentId: terminal.id, portId: end.id },
      points: [
        { x: 0, y: 0, z: unknownMm("derived endpoint") },
        { x: 4000, y: 2200, z: unknownMm("seeded route elevation not set") },
        { x: 0, y: 0, z: unknownMm("derived endpoint") },
      ],
    },
  });
  return project;
}

function wallPoint(x, y) {
  return { x, y, z: unknownMm("seeded wall base not set") };
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
