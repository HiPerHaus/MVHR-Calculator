import assert from "node:assert/strict";
import test from "node:test";

import {
  activateMechanicalTool,
  cancelMechanicalOperation,
  componentMoveIntent,
  componentRotationIntent,
  createMechanicalInteractionState,
  handleMechanicalCanvasClick,
  removeMechanicalRoutePoint,
  requiresProjectReplacementConfirmation,
  resolveComponentPlacementState,
  updateMechanicalPointer,
} from "../src/editor/mechanical-controller.mjs";

test("route back removes one draft point without committing geometry", () => {
  let state = activateMechanicalTool(createMechanicalInteractionState(), "route", { ductKind: "epp-rigid-dn160" });
  state = handleMechanicalCanvasClick(state, {
    point: { x: 0, y: 0 },
    hit: { kind: "port", componentId: "unit", portId: "supply", system: "mvhr", stream: "supply", role: "Dwelling supply" },
  }).state;
  state = handleMechanicalCanvasClick(state, { point: { x: 1000, y: 0 }, hit: null }).state;
  const backed = removeMechanicalRoutePoint(state);
  assert.equal(backed.routeDraft.points.length, 1);
  assert.deepEqual(backed.pointer, { x: 0, y: 0 });
  assert.equal(removeMechanicalRoutePoint(backed).routeDraft, null);
});
import {
  createSyntheticComponent,
  SYNTHETIC_COMPONENT_CATALOGUE,
} from "../src/editor/synthetic-catalogue.mjs";
import { createCatalogueComponent } from "../src/editor/component-catalogue.mjs";
import {
  applyCommand,
  createProject,
  deserializeProject,
  floorPortTransform,
  identityQuaternion,
  knownMm,
  serializeProject,
  unknownMm,
} from "../src/domain/spatial.mjs";
import {
  createCommandHistory,
  executeCommand,
  redoCommand,
  undoCommand,
} from "../src/domain/history.mjs";
import { createLocalProjectStore } from "../src/persistence/local-project-store.mjs";

test("synthetic catalogue is visibly non-manufacturer and creates typed ports", () => {
  assert.ok(SYNTHETIC_COMPONENT_CATALOGUE.length >= 3);
  assert.ok(SYNTHETIC_COMPONENT_CATALOGUE.every((item) => item.status.includes("synthetic")));

  const component = createSyntheticComponent("synthetic-mvhr-placeholder", {
    id: "component-synthetic-unit",
    floorId: "floor-ground",
    xMm: 1000,
    yMm: 2000,
  });
  assert.equal(component.catalogueStatus, "synthetic-not-manufacturer-verified");
  assert.equal(component.ports.length, 4);
  assert.deepEqual(
    new Set(component.ports.map((port) => port.role)),
    new Set(["Dwelling supply", "Dwelling extract", "Outdoor intake", "Outdoor exhaust"]),
  );
  assert.equal(component.positionMm.z.state, "unknown");
});

test("placement owns wall clicks, repeats, and cancels without a persisted command", () => {
  let state = activateMechanicalTool(
    createMechanicalInteractionState(),
    "place-component",
    { catalogueItemId: "synthetic-supply-terminal" },
  );
  state = updateMechanicalPointer(state, { x: 1000, y: 2000 });
  const first = handleMechanicalCanvasClick(state, {
    point: { x: 1000, y: 2000 },
    hit: { kind: "wall" },
  });
  assert.equal(first.intent.type, "component.place");
  assert.equal(first.intent.catalogueItemId, "synthetic-supply-terminal");
  assert.equal(first.state.tool, "place-component");

  const second = handleMechanicalCanvasClick(first.state, {
    point: { x: 3000, y: 2000 },
    hit: { kind: "wall" },
  });
  assert.equal(second.intent.type, "component.place");
  assert.notDeepEqual(second.intent.point, first.intent.point);

  const cancelled = cancelMechanicalOperation(second.state);
  assert.equal(cancelled.tool, "select");
  assert.equal(cancelled.placement, null);
  assert.equal(cancelled.routeDraft, null);
});

test("a committed MVHR placement returns to Select once while invalid and repeat placements retain their tools", () => {
  const placement = activateMechanicalTool(
    createMechanicalInteractionState(),
    "place-component",
    { catalogueItemId: "zehnder-q350-hrv-left-drawing-profile" },
  );
  const requested = handleMechanicalCanvasClick(placement, {
    point: { x: 1200, y: 800 },
    hit: null,
  });
  const completed = resolveComponentPlacementState(requested.state, {
    committed: true,
    componentId: "component-q350-new",
    returnToSelect: true,
  });
  assert.equal(completed.tool, "select");
  assert.equal(completed.placement, null);
  assert.equal(completed.selectedComponentId, "component-q350-new");

  const nextClick = handleMechanicalCanvasClick(completed, {
    point: { x: 2200, y: 800 },
    hit: null,
  });
  assert.equal(nextClick.intent, null, "the next canvas click must not place a second unit");
  assert.equal(nextClick.state.tool, "select");

  const rejected = resolveComponentPlacementState(requested.state, {
    committed: false,
    componentId: "component-q350-rejected",
    returnToSelect: true,
  });
  assert.equal(rejected, requested.state);
  assert.equal(rejected.tool, "place-component");
  assert.equal(rejected.placement.catalogueItemId, "zehnder-q350-hrv-left-drawing-profile");

  const terminalPlacement = activateMechanicalTool(
    createMechanicalInteractionState(),
    "place-component",
    { catalogueItemId: "synthetic-supply-terminal" },
  );
  const repeated = resolveComponentPlacementState(terminalPlacement, {
    committed: true,
    componentId: "component-terminal-new",
    returnToSelect: false,
  });
  assert.equal(repeated, terminalPlacement);
  assert.equal(repeated.tool, "place-component");

  const q350 = createCatalogueComponent("zehnder-q350-hrv-left-drawing-profile", {
    id: "component-q350-new",
    floorId: "floor-ground",
    xMm: 1200,
    yMm: 800,
  });
  let history = createCommandHistory(projectWithFloor());
  history = executeCommand(history, { type: "component.add", component: q350 });
  assert.equal(history.present.components.at(-1).id, completed.selectedComponentId);
  history = undoCommand(history);
  assert.equal(history.present.components.length, 0);
  history = redoCommand(history);
  assert.equal(history.present.components.at(-1).id, "component-q350-new");
});

test("route state accepts intermediate points, rejects invalid joins and resets after commit", () => {
  let state = activateMechanicalTool(createMechanicalInteractionState(), "route", {
    ductKind: "semi-rigid-radial",
  });
  const wallStart = handleMechanicalCanvasClick(state, {
    point: { x: 0, y: 0 },
    hit: { kind: "wall" },
  });
  assert.equal(wallStart.intent, null);
  assert.equal(wallStart.state.routeDraft, null);

  const startHit = portHit("component-a", "port-a", "supply", "Dwelling supply");
  const started = handleMechanicalCanvasClick(state, { point: { x: 100, y: 200 }, hit: startHit });
  assert.equal(started.state.routeDraft.ductKind, "semi-rigid-radial");

  const intermediate = handleMechanicalCanvasClick(started.state, {
    point: { x: 1500, y: 800 },
    hit: { kind: "wall" },
  });
  assert.equal(intermediate.state.routeDraft.points.length, 2);

  const incompatible = handleMechanicalCanvasClick(intermediate.state, {
    point: { x: 2000, y: 1000 },
    hit: portHit("component-x", "port-x", "extract", "Dwelling extract"),
  });
  assert.equal(incompatible.intent, null);
  assert.deepEqual(incompatible.state, intermediate.state);

  const samePort = handleMechanicalCanvasClick(intermediate.state, {
    point: { x: 100, y: 200 },
    hit: startHit,
  });
  assert.equal(samePort.intent, null);
  assert.deepEqual(samePort.state, intermediate.state);

  const completed = handleMechanicalCanvasClick(intermediate.state, {
    point: { x: 3000, y: 2000 },
    hit: portHit("component-b", "port-b", "supply", "Dwelling supply"),
  });
  assert.equal(completed.intent.type, "route.commit");
  assert.equal(completed.intent.ductKind, "semi-rigid-radial");
  assert.equal(completed.intent.parallelRunCount, 1, "newly drawn routes default to Single");
  assert.equal(completed.intent.points.length, 3);
  assert.equal(completed.state.routeDraft, null);
  assert.equal(completed.state.tool, "route", "route tool remains active for repeated routing");
});

test("route authoring keeps occupied ports visible but rejects them with a specific message", () => {
  const state = activateMechanicalTool(createMechanicalInteractionState(), "route", {
    ductKind: "epp-rigid-dn160",
  });
  const occupiedStart = handleMechanicalCanvasClick(state, {
    point: { x: 100, y: 200 },
    hit: portHit("component-unit", "port-supply", "supply", "Dwelling supply", { occupied: true }),
  });
  assert.equal(occupiedStart.state.routeDraft, null);
  assert.match(occupiedStart.message, /already connected/);

  const started = handleMechanicalCanvasClick(state, {
    point: { x: 100, y: 200 },
    hit: portHit("component-unit", "port-supply", "supply", "Dwelling supply"),
  });
  const occupiedEnd = handleMechanicalCanvasClick(started.state, {
    point: { x: 1000, y: 200 },
    hit: portHit("component-main", "port-main", "supply", "Dwelling supply", { occupied: true }),
  });
  assert.equal(occupiedEnd.intent, null);
  assert.deepEqual(occupiedEnd.state, started.state);
  assert.match(occupiedEnd.message, /already connected/);
});

test("a compatibility-free legacy route still rejects unlike endpoint interfaces", () => {
  const state = activateMechanicalTool(createMechanicalInteractionState(), "route", {
    ductKind: "generic-duct",
  });
  const started = handleMechanicalCanvasClick(state, {
    point: { x: 0, y: 0 },
    hit: portHit("component-rigid", "port-rigid", "supply", "Dwelling supply", {
      interface: { family: "rigid-epp", nominalSizeMm: 160 },
    }),
  });
  const rejected = handleMechanicalCanvasClick(started.state, {
    point: { x: 1000, y: 0 },
    hit: portHit("component-radial", "port-radial", "supply", "Dwelling supply", {
      interface: { family: "semi-rigid-pe", nominalSizeMm: 90 },
    }),
  });

  assert.equal(rejected.intent, null);
  assert.match(rejected.message, /rigid-epp DN160 cannot connect to semi-rigid-pe DN90/);
  assert.equal(rejected.state.routeDraft.points.length, 1);
});

test("tool switching and Escape-style cancellation discard incomplete route state", () => {
  let state = activateMechanicalTool(createMechanicalInteractionState(), "route", {
    ductKind: "generic-duct",
  });
  state = handleMechanicalCanvasClick(state, {
    point: { x: 100, y: 200 },
    hit: portHit("component-a", "port-a", "supply", "Dwelling supply"),
  }).state;
  assert.ok(state.routeDraft);

  const switched = activateMechanicalTool(state, "place-component", {
    catalogueItemId: "synthetic-extract-terminal",
  });
  assert.equal(switched.routeDraft, null);
  const cancelled = cancelMechanicalOperation(switched);
  assert.equal(cancelled.tool, "select");
  assert.equal(cancelled.pointer, null);
});

test("project replacement requires confirmation for committed differences or interrupted tools", () => {
  assert.equal(requiresProjectReplacementConfirmation({ wallDraftPointCount: 0 }), false);
  for (const value of [
    { committedProjectChanged: true },
    { wallDraftPointCount: 1 },
    { wallNodeDragActive: true },
    { componentDragActive: true },
    { routeDraftActive: true },
    { calibrationActive: true },
    { placementActive: true },
  ]) {
    assert.equal(
      requiresProjectReplacementConfirmation({ wallDraftPointCount: 0, ...value }),
      true,
    );
  }
  assert.throws(
    () => requiresProjectReplacementConfirmation({ wallDraftPointCount: -1 }),
    /non-negative integer/,
  );
});

test("controller move and rotation intents support undo-redo and saved-project reopening", () => {
  let project = projectWithFloor();
  const unit = createSyntheticComponent("synthetic-mvhr-placeholder", {
    id: "component-unit",
    floorId: "floor-ground",
    xMm: 1000,
    yMm: 1000,
  });
  const terminal = createSyntheticComponent("synthetic-supply-terminal", {
    id: "component-terminal",
    floorId: "floor-ground",
    xMm: 5000,
    yMm: 1000,
  });
  project = applyCommand(project, { type: "component.add", component: unit });
  project = applyCommand(project, { type: "component.add", component: terminal });
  const startPort = unit.ports.find((port) => port.role === "Dwelling supply");
  const endPort = terminal.ports[0];
  const startPosition = floorPortTransform(project, unit.id, startPort.id).positionMm;
  const endPosition = floorPortTransform(project, terminal.id, endPort.id).positionMm;
  project = applyCommand(project, {
    type: "route.add",
    route: {
      id: "route-controller",
      floorId: "floor-ground",
      system: "mvhr",
      stream: "supply",
      role: "Dwelling supply",
      ductKind: "generic-duct",
      startAttachment: { componentId: unit.id, portId: startPort.id },
      endAttachment: { componentId: terminal.id, portId: endPort.id },
      points: [startPosition, { x: 3000, y: 2000, z: unknownMm("synthetic route elevation") }, endPosition],
    },
  });

  let state = createMechanicalInteractionState();
  state = handleMechanicalCanvasClick(state, {
    point: { x: 5000, y: 1000 },
    hit: { kind: "component", componentId: terminal.id },
  }).state;
  let history = createCommandHistory(project);
  history = executeCommand(history, componentMoveIntent(state, { x: 6000, y: 2000 }));
  const moved = structuredClone(history.present);
  assert.equal(moved.routes[0].points.at(-1).x, 6000);
  assert.equal(moved.routes[0].points.at(-1).y, 2000);
  assert.deepEqual(moved.routes[0].points[1], project.routes[0].points[1]);
  history = undoCommand(history);
  assert.deepEqual(history.present, project);
  history = redoCommand(history);
  assert.deepEqual(history.present, moved);

  state = handleMechanicalCanvasClick(createMechanicalInteractionState(), {
    point: { x: 1000, y: 1000 },
    hit: { kind: "component", componentId: unit.id },
  }).state;
  history = executeCommand(history, componentRotationIntent(state));
  const rotated = history.present;
  assert.notDeepEqual(rotated.components[0].orientation, moved.components[0].orientation);
  assert.notDeepEqual(rotated.routes[0].points[0], moved.routes[0].points[0]);
  assert.deepEqual(deserializeProject(serializeProject(rotated)), rotated);

  const storage = memoryStorage();
  const store = createLocalProjectStore(storage, {
    now: () => new Date("2026-10-15T16:00:00.000Z"),
  });
  assert.equal(store.save(rotated).ok, true);
  assert.deepEqual(store.load(rotated.id).project, rotated);
});

function projectWithFloor() {
  return applyCommand(createProject("project-mechanical-controller"), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Synthetic Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "synthetic controller fixture") },
        orientation: identityQuaternion(),
      },
    },
  });
}

function portHit(componentId, portId, stream, role, options = {}) {
  return { kind: "port", componentId, portId, system: "mvhr", stream, role, ...options };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}
