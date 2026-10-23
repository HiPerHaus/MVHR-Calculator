import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  arePortsConnected,
  createProject,
  deserializeProject,
  identityQuaternion,
  inspectComponentDeletion,
  knownMm,
  quaternionFromYaw,
  routeEndpointTransform,
  routeLengthSummary,
  SCHEMA_VERSION,
  serializeProject,
  unknownMm,
  worldPortTransform,
} from "../src/domain/spatial.mjs";
import {
  createCommandHistory,
  executeCommand,
  redoCommand,
  undoCommand,
} from "../src/domain/history.mjs";
import { createLocalProjectStore } from "../src/persistence/local-project-store.mjs";
import {
  exportPortableProject,
  importPortableProject,
} from "../src/persistence/portable-project.mjs";

const FIXED_TIME = new Date("2026-10-15T15:00:00.000Z");

test("attached route endpoints derive from synthetic component-local ports and full transforms", () => {
  const project = attachedProject();
  const route = project.routes[0];

  assert.deepEqual(route.points[0], {
    x: 1000,
    y: 2100,
    z: knownMm(350, "derived from component-a/port-a"),
  });
  assert.deepEqual(route.points.at(-1), {
    x: 4900,
    y: 2000,
    z: knownMm(350, "derived from component-b/port-b"),
  });
  const endpointTransform = routeEndpointTransform(project, "route-main", "start");
  assert.deepEqual(endpointTransform.floorPositionMm, route.points[0]);
  assert.equal(endpointTransform.buildingPositionState, "known");
  assertVectorClose(
    endpointTransform.buildingPositionMm,
    { x: 7900, y: 21000, z: 3350 },
  );
  assert.equal(
    arePortsConnected(project, endpoint("component-a", "port-a"), endpoint("component-b", "port-b")),
    true,
  );
});

test("non-planar component orientation contributes to an attached route endpoint", () => {
  let project = syntheticProject();
  project = addComponent(project, component(
    "component-a",
    "port-a",
    "supply",
    "Dwelling supply",
    { x: 1000, y: 2000 },
    { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 },
    { x: 0, y: 100, z: 50 },
  ));
  project = applyCommand(project, attachedRouteCommand({ endAttachment: null }));

  assert.deepEqual(project.routes[0].points[0], {
    x: 1000,
    y: 1950,
    z: knownMm(400, "derived from component-a/port-a"),
  });
  assertVectorClose(
    worldPortTransform(project, "component-a", "port-a").positionMm,
    { x: 8050, y: 21000, z: 3400 },
  );
});

test("moving a component keeps its attached route endpoint derived and is repeatably undoable", () => {
  const initial = attachedProject();
  const unchangedInterior = structuredClone(initial.routes[0].points[1]);
  const unchangedEnd = structuredClone(initial.routes[0].points.at(-1));
  let history = createCommandHistory(initial);

  history = executeCommand(history, {
    type: "component.moveXY",
    componentId: "component-a",
    xMm: 2000,
    yMm: 3000,
  });
  const moved = structuredClone(history.present);
  assert.deepEqual(moved.routes[0].points[0], {
    x: 2000,
    y: 3100,
    z: knownMm(350, "derived from component-a/port-a"),
  });
  assert.deepEqual(moved.routes[0].points[1], unchangedInterior);
  assert.deepEqual(moved.routes[0].points.at(-1), unchangedEnd);

  history = undoCommand(history);
  assert.deepEqual(history.present, initial);
  history = redoCommand(history);
  assert.deepEqual(history.present, moved);
  history = undoCommand(history);
  history = redoCommand(history);
  assert.deepEqual(history.present, moved);
});

test("route endpoint attachment is explicit, atomic, and preserved through undo-redo", () => {
  let project = syntheticProject();
  project = addComponent(project, component("component-a", "port-a", "supply", "Dwelling supply"));
  project = applyCommand(project, freeRouteCommand({ role: "Dwelling supply" }));
  let history = createCommandHistory(project);

  history = executeCommand(history, {
    type: "route.attachEndpoint",
    routeId: "route-main",
    end: "start",
    endpoint: endpoint("component-a", "port-a"),
  });
  const attached = structuredClone(history.present);
  assert.deepEqual(attached.routes[0].startAttachment, endpoint("component-a", "port-a"));
  assert.deepEqual(attached.routes[0].points[0], {
    x: 1000,
    y: 2100,
    z: knownMm(350, "derived from component-a/port-a"),
  });

  history = undoCommand(history);
  assert.equal(history.present.routes[0].startAttachment, null);
  history = redoCommand(history);
  assert.deepEqual(history.present, attached);
});

test("dangling, cross-floor, incompatible and multiply occupied route attachments fail atomically", () => {
  let project = syntheticProject();
  project = addComponent(project, component("component-a", "port-a", "supply", "Dwelling supply"));
  project = addComponent(project, component("component-compatible", "port-compatible", "supply", "Dwelling supply"));
  project = addComponent(project, component("component-extract", "port-extract", "extract", "Dwelling extract"));
  project = addComponent(project, component("component-outdoor", "port-outdoor", "supply", "Outdoor intake"));
  project = applyCommand(project, {
    type: "floor.add",
    floor: {
      id: "floor-upper",
      name: "Synthetic Upper Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(3000, "synthetic upper floor") },
        orientation: identityQuaternion(),
      },
    },
  });
  const crossFloor = component("component-cross-floor", "port-cross-floor", "supply", "Dwelling supply");
  crossFloor.floorId = "floor-upper";
  project = addComponent(project, crossFloor);
  const before = structuredClone(project);

  const unclassifiedDuct = attachedRouteCommand({
    endAttachment: null,
    ductKind: "invented-flex-product",
  });
  assert.throws(() => applyCommand(project, unclassifiedDuct), /duct kind/);
  assert.deepEqual(project, before);

  const selfOccupied = attachedRouteCommand({
    endAttachment: endpoint("component-a", "port-a"),
  });
  assert.throws(() => applyCommand(project, selfOccupied), /already occupied/);
  assert.deepEqual(project, before);

  for (const [binding, message] of [
    [endpoint("component-missing", "port-missing"), /not found/],
    [endpoint("component-cross-floor", "port-cross-floor"), /same floor/],
    [endpoint("component-extract", "port-extract"), /system and stream/],
    [endpoint("component-outdoor", "port-outdoor"), /matching typed role/],
  ]) {
    const command = attachedRouteCommand();
    command.route.startAttachment = binding;
    command.route.endAttachment = null;
    assert.throws(() => applyCommand(project, command), message);
    assert.deepEqual(project, before);
  }

  project = applyCommand(project, attachedRouteCommand({ endAttachment: null }));
  const occupiedBefore = structuredClone(project);
  const secondRoute = attachedRouteCommand({ id: "route-second", endAttachment: null });
  assert.throws(
    () => applyCommand(project, secondRoute),
    /already occupied/,
  );
  assert.deepEqual(project, occupiedBefore);

  assert.throws(
    () => applyCommand(project, {
      type: "connection.add",
      connection: {
        id: "connection-occupied",
        from: endpoint("component-a", "port-a"),
        to: endpoint("component-compatible", "port-compatible"),
      },
    }),
    /already occupied/,
  );
  assert.deepEqual(project, occupiedBefore);
});

test("persisted attached endpoints cannot drift away from their authoritative ports", () => {
  const stale = attachedProject();
  stale.routes[0].points[0].x += 1;

  assert.throws(
    () => serializeProject(stale),
    /must equal its derived component-port position/,
  );
});

test("an attached endpoint with unknown component elevation remains unknown", () => {
  let project = syntheticProject();
  const unknownComponent = component("component-a", "port-a", "supply", "Dwelling supply");
  unknownComponent.positionMm.z = unknownMm("synthetic installation height not measured");
  project = addComponent(project, unknownComponent);
  project = applyCommand(project, attachedRouteCommand({ endAttachment: null }));

  assert.deepEqual(
    project.routes[0].points[0].z,
    unknownMm("route endpoint depends on unknown component elevation: component-a"),
  );
  assert.equal(routeLengthSummary(project.routes[0]).developedState, "unknown");
  assert.equal(routeLengthSummary(project.routes[0]).developedMm, null);
});

test("visual route crossings do not create graph connectivity", () => {
  let project = syntheticProject();
  for (const value of [
    component("component-a", "port-a", "supply", "Dwelling supply"),
    component("component-b", "port-b", "supply", "Dwelling supply", { x: 5000, y: 2000 }),
    component("component-c", "port-c", "supply", "Dwelling supply", { x: 3000, y: 1000 }),
    component("component-d", "port-d", "supply", "Dwelling supply", { x: 3000, y: 4000 }),
  ]) project = addComponent(project, value);
  project = applyCommand(project, attachedRouteCommand());
  project = applyCommand(project, {
    type: "route.add",
    route: {
      ...freeRouteCommand({ id: "route-crossing", role: "Dwelling supply" }).route,
      id: "route-crossing",
      points: [knownPoint(3000, 1000, 0), knownPoint(3000, 4000, 0)],
    },
  });

  assert.equal(
    arePortsConnected(project, endpoint("component-a", "port-a"), endpoint("component-b", "port-b")),
    true,
  );
  assert.equal(
    arePortsConnected(project, endpoint("component-c", "port-c"), endpoint("component-d", "port-d")),
    false,
  );
});

test("attached route topology round-trips through canonical, local and portable persistence", async () => {
  const project = attachedProject();
  assert.deepEqual(deserializeProject(serializeProject(project)), project);

  const storage = memoryStorage();
  const store = createLocalProjectStore(storage, { now: () => new Date(FIXED_TIME) });
  assert.equal(store.save(project).ok, true);
  assert.deepEqual(store.load(project.id).project, project);

  const portable = await exportPortableProject(project, { now: () => new Date(FIXED_TIME) });
  const reopened = await importPortableProject(portable);
  assert.deepEqual(reopened.project, project);
  assert.equal(reopened.project.routes[0].startAttachment.portId, "port-a");
  assert.equal(reopened.project.routes[0].endAttachment.portId, "port-b");
});

test("a saved route can change between single and twin without changing geometry or endpoints", () => {
  const initial = applyCommand(attachedProject(), {
    type: "component.setDuctRunCount",
    componentId: "component-a",
    ductRunCount: 7,
  });
  const geometry = structuredClone(initial.routes[0].points);
  const startAttachment = structuredClone(initial.routes[0].startAttachment);
  const endAttachment = structuredClone(initial.routes[0].endAttachment);
  let history = createCommandHistory(initial);

  history = executeCommand(history, {
    type: "route.setParallelRunCount",
    routeId: "route-main",
    parallelRunCount: 2,
  });
  assert.equal(history.present.routes[0].parallelRunCount, 2);
  assert.deepEqual(history.present.routes[0].points, geometry);
  assert.deepEqual(history.present.routes[0].startAttachment, startAttachment);
  assert.deepEqual(history.present.routes[0].endAttachment, endAttachment);
  assert.equal(history.present.components.find((component) => component.id === "component-a").ductRunCount, 7);

  history = undoCommand(history);
  assert.equal(history.present.routes[0].parallelRunCount, null);
  history = redoCommand(history);
  assert.equal(history.present.routes[0].parallelRunCount, 2);
  history = executeCommand(history, {
    type: "route.setParallelRunCount",
    routeId: "route-main",
    parallelRunCount: 1,
  });

  const storage = memoryStorage();
  const store = createLocalProjectStore(storage, { now: () => new Date(FIXED_TIME) });
  assert.equal(store.save(history.present).ok, true);
  const reopened = store.load(history.present.id).project;
  assert.equal(reopened.routes[0].parallelRunCount, 1);
  assert.deepEqual(reopened.routes[0].points, geometry);
  assert.deepEqual(reopened.routes[0].startAttachment, startAttachment);
  assert.deepEqual(reopened.routes[0].endAttachment, endAttachment);
  assert.equal(reopened.components.find((component) => component.id === "component-a").ductRunCount, 7);
});

test("route arrangement rejects counts other than single or twin", () => {
  const project = attachedProject();
  assert.throws(() => applyCommand(project, {
    type: "route.setParallelRunCount",
    routeId: "route-main",
    parallelRunCount: 3,
  }), /must be null, 1, or 2/);
  assert.equal(project.routes[0].parallelRunCount, null);
});

test("intermediate route points insert, move and remove without detaching endpoints", () => {
  const initial = attachedProject();
  const startAttachment = structuredClone(initial.routes[0].startAttachment);
  const endAttachment = structuredClone(initial.routes[0].endAttachment);
  const startPoint = structuredClone(initial.routes[0].points[0]);
  const endPoint = structuredClone(initial.routes[0].points.at(-1));
  let history = createCommandHistory(initial);

  history = executeCommand(history, {
    type: "route.insertPoint",
    routeId: "route-main",
    segmentIndex: 0,
    point: knownPoint(2000, 2300, 350),
  });
  const inserted = structuredClone(history.present);
  assert.equal(inserted.routes[0].points.length, 4);
  assert.deepEqual(inserted.routes[0].startAttachment, startAttachment);
  assert.deepEqual(inserted.routes[0].endAttachment, endAttachment);
  assert.deepEqual(inserted.routes[0].points[0], startPoint);
  assert.deepEqual(inserted.routes[0].points.at(-1), endPoint);

  history = executeCommand(history, {
    type: "route.movePoint",
    routeId: "route-main",
    pointIndex: 1,
    xMm: 1800,
    yMm: 3600,
  });
  const moved = structuredClone(history.present);
  assert.equal(history.past.length, 2, "one completed point drag is one command entry");
  assert.deepEqual(moved.routes[0].points[1], knownPoint(1800, 3600, 350));
  assert.ok(
    routeLengthSummary(moved.routes[0]).projectedMm > routeLengthSummary(inserted.routes[0]).projectedMm,
    "centreline length follows the reshaped points",
  );
  assert.deepEqual(moved.routes[0].points[0], startPoint);
  assert.deepEqual(moved.routes[0].points.at(-1), endPoint);

  history = undoCommand(history);
  assert.deepEqual(history.present, inserted);
  history = redoCommand(history);
  assert.deepEqual(history.present, moved);
  history = executeCommand(history, {
    type: "route.removePoint",
    routeId: "route-main",
    pointIndex: 1,
  });
  const removed = structuredClone(history.present);
  assert.equal(removed.routes[0].points.length, 3);
  assert.deepEqual(removed.routes[0].startAttachment, startAttachment);
  assert.deepEqual(removed.routes[0].endAttachment, endAttachment);

  const storage = memoryStorage();
  const store = createLocalProjectStore(storage, { now: () => new Date(FIXED_TIME) });
  assert.equal(store.save(removed).ok, true);
  assert.deepEqual(store.load(removed.id).project, removed);
  assert.throws(() => applyCommand(removed, {
    type: "route.movePoint",
    routeId: "route-main",
    pointIndex: 0,
    xMm: 0,
    yMm: 0,
  }), /endpoints remain fixed/);
  assert.throws(() => applyCommand(removed, {
    type: "route.removePoint",
    routeId: "route-main",
    pointIndex: removed.routes[0].points.length - 1,
  }), /endpoints remain fixed/);
});

test("component deletion is scoped, undoable and removes only attached routes", () => {
  const initial = attachedProject();
  const inspection = inspectComponentDeletion(initial, "component-a");
  assert.deepEqual(inspection.componentIds, ["component-a"]);
  assert.deepEqual(inspection.routeIds, ["route-main"]);
  assert.deepEqual(inspection.connectionIds, []);
  assert.throws(() => applyCommand(initial, {
    type: "component.delete",
    componentId: "component-a",
    confirmedScope: { ...inspection, routeIds: [] },
  }), /scope changed/);
  assert.equal(initial.components.length, 2);
  assert.equal(initial.routes.length, 1);

  let history = createCommandHistory(initial);
  history = executeCommand(history, {
    type: "component.delete",
    componentId: "component-a",
    confirmedScope: inspection,
  });
  const deleted = structuredClone(history.present);
  assert.deepEqual(deleted.components.map((component) => component.id), ["component-b"]);
  assert.deepEqual(deleted.routes, []);
  assert.equal(deleted.floors.length, initial.floors.length);
  history = undoCommand(history);
  assert.deepEqual(history.present, initial);
  history = redoCommand(history);
  assert.deepEqual(history.present, deleted);

  const storage = memoryStorage();
  const store = createLocalProjectStore(storage, { now: () => new Date(FIXED_TIME) });
  assert.equal(store.save(deleted).ok, true);
  assert.deepEqual(store.load(deleted.id).project, deleted);
});

test("unconnected component deletion preserves every unrelated object", () => {
  let project = syntheticProject();
  project = addComponent(project, component("component-alone", "port-alone", "extract", "Dwelling extract"));
  const inspection = inspectComponentDeletion(project, "component-alone");
  assert.equal(inspection.routeCount, 0);
  assert.equal(inspection.connectionCount, 0);
  const floor = structuredClone(project.floors[0]);

  project = applyCommand(project, {
    type: "component.delete",
    componentId: "component-alone",
    confirmedScope: inspection,
  });
  assert.deepEqual(project.components, []);
  assert.deepEqual(project.routes, []);
  assert.deepEqual(project.floors, [floor]);
});

test("schema 3 free routes migrate with explicit null endpoint attachments", () => {
  let project = syntheticProject();
  project = applyCommand(project, freeRouteCommand());
  const legacy = structuredClone(project);
  legacy.schemaVersion = 3;
  delete legacy.routes[0].role;
  delete legacy.routes[0].startAttachment;
  delete legacy.routes[0].endAttachment;

  const migrated = deserializeProject(JSON.stringify(legacy));
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(migrated.rooms, []);
  assert.deepEqual(migrated.zones, []);
  assert.deepEqual(migrated.cadReferenceAssets, []);
  assert.deepEqual(migrated.floorCadReferences, []);
  assert.equal(migrated.routes[0].ductKind, "generic-duct");
  assert.equal(migrated.routes[0].role, null);
  assert.equal(migrated.routes[0].startAttachment, null);
  assert.equal(migrated.routes[0].endAttachment, null);
  assert.equal(migrated.routes[0].parallelRunCount, null);
});

test("schema 4 migration preserves typed route attachments and adds only a duct kind", () => {
  const project = attachedProject();
  const legacy = structuredClone(project);
  legacy.schemaVersion = 4;
  delete legacy.routes[0].ductKind;

  const migrated = deserializeProject(JSON.stringify(legacy));
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(migrated.rooms, []);
  assert.deepEqual(migrated.zones, []);
  assert.deepEqual(migrated.cadReferenceAssets, []);
  assert.deepEqual(migrated.floorCadReferences, []);
  assert.equal(migrated.routes[0].ductKind, "generic-duct");
  assert.deepEqual(migrated.routes[0].startAttachment, project.routes[0].startAttachment);
  assert.deepEqual(migrated.routes[0].endAttachment, project.routes[0].endAttachment);
  assert.deepEqual(migrated.routes[0].points, project.routes[0].points);
  assert.equal(migrated.routes[0].parallelRunCount, null);
});

function attachedProject() {
  let project = syntheticProject();
  project = addComponent(project, component("component-a", "port-a", "supply", "Dwelling supply"));
  project = addComponent(project, component(
    "component-b",
    "port-b",
    "supply",
    "Dwelling supply",
    { x: 5000, y: 2000 },
    identityQuaternion(),
    { x: -100, y: 0, z: 50 },
  ));
  return applyCommand(project, attachedRouteCommand());
}

function syntheticProject() {
  return applyCommand(createProject("project-synthetic-route-network"), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Synthetic Ground Floor",
      transform: {
        translationMm: { x: 10000, y: 20000, z: knownMm(3000, "synthetic route fixture") },
        orientation: quaternionFromYaw(Math.PI / 2),
      },
    },
  });
}

function component(
  id,
  portId,
  stream,
  role,
  position = { x: 1000, y: 2000 },
  orientation = quaternionFromYaw(Math.PI / 2),
  portPosition = { x: 100, y: 0, z: 50 },
) {
  return {
    id,
    floorId: "floor-ground",
    positionMm: { ...position, z: knownMm(300, "synthetic component elevation") },
    orientation,
    ports: [{
      id: portId,
      definitionId: `synthetic-definition-${portId}`,
      positionMm: portPosition,
      direction: { x: 1, y: 0, z: 0 },
      system: "mvhr",
      stream,
      role,
    }],
  };
}

function addComponent(project, value) {
  return applyCommand(project, { type: "component.add", component: value });
}

function attachedRouteCommand(overrides = {}) {
  return {
    type: "route.add",
    route: {
      id: "route-main",
      floorId: "floor-ground",
      system: "mvhr",
      stream: "supply",
      role: "Dwelling supply",
      startAttachment: endpoint("component-a", "port-a"),
      endAttachment: endpoint("component-b", "port-b"),
      points: [
        knownPoint(0, 0, 0),
        knownPoint(3000, 2500, 350),
        knownPoint(6000, 0, 0),
      ],
      ...overrides,
    },
  };
}

function freeRouteCommand(overrides = {}) {
  return {
    type: "route.add",
    route: {
      id: "route-main",
      floorId: "floor-ground",
      system: "mvhr",
      stream: "supply",
      role: null,
      startAttachment: null,
      endAttachment: null,
      points: [knownPoint(0, 0, 0), knownPoint(6000, 0, 0)],
      ...overrides,
    },
  };
}

function endpoint(componentId, portId) {
  return { componentId, portId };
}

function knownPoint(x, y, z) {
  return { x, y, z: knownMm(z, "synthetic route point") };
}

function assertVectorClose(actual, expected, tolerance = 1e-9) {
  for (const axis of ["x", "y", "z"]) {
    assert.ok(Math.abs(actual[axis] - expected[axis]) <= tolerance);
  }
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
