import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  createProject,
  deserializeProject,
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
import {
  createCatalogueComponent,
  routeFamilyForKind,
} from "../src/editor/component-catalogue.mjs";
import { createEquipmentAssembly } from "../src/editor/equipment-assemblies.mjs";
import { auditVentilation } from "../src/editor/ventilation-audit.mjs";

test("audit counts placed constituents once, keeps groups separate and accepts a complete generic topology", () => {
  const project = completeGenericSystem();
  const audit = auditVentilation(project, "floor-ground");

  assert.equal(audit.parts.componentCount, 9);
  assert.equal(audit.parts.assemblyGroupCount, 2);
  assert.equal(audit.parts.groupedComponentCount, 6);
  assert.equal(audit.parts.independentComponentCount, 3);
  assert.equal(audit.parts.lines.reduce((total, line) => total + line.count, 0), 9);
  assert.equal(audit.parts.assemblyGroups.reduce((total, group) => total + group.componentCount, 0), 6);

  assert.equal(audit.routes.routeCount, 4);
  assert.equal(audit.routes.groups.find((group) => group.ductKind === "epp-rigid-dn160").routeCount, 2);
  assert.equal(audit.routes.groups.find((group) => group.ductKind === "semi-rigid-radial").routeCount, 2);
  assert.equal(audit.routes.developedState, "unknown");
  assert.ok(audit.routes.projectedMm > 0);

  assert.deepEqual(audit.spareBranches.map((item) => [item.stream, item.count]), [
    ["supply", 5],
    ["extract", 5],
  ]);
  assert.deepEqual(audit.diagnostics, []);
  assert.deepEqual(audit.diagnosticCounts, { error: 0, warning: 0, info: 0 });
  assert.ok(Object.isFrozen(audit));
});

test("audit reports actionable missing paths and unset runs without treating spare branches as faults", () => {
  let project = projectWithFloor();
  const unit = catalogueComponent("synthetic-mvhr-placeholder", "unit", 1000, 1000);
  const terminal = catalogueComponent("synthetic-supply-terminal", "terminal", 6000, 1000);
  const setout = catalogueComponent("zehnder-q350-hrv-setout", "setout", 1000, 4000);
  const assembly = createEquipmentAssembly("generic-remote-supply-attenuation-set", {
    id: "supply-group",
    floorId: "floor-ground",
    xMm: 3500,
    yMm: 1000,
  });
  project = applyCommand(project, { type: "component.add", component: unit });
  project = applyCommand(project, { type: "component.add", component: terminal });
  project = applyCommand(project, { type: "component.add", component: setout });
  project = applyCommand(project, { type: "equipmentAssembly.add", ...assembly });

  const audit = auditVentilation(project, "floor-ground");
  const codes = new Set(audit.diagnostics.map((item) => item.code));
  assert.ok(codes.has("unit-main-disconnected"));
  assert.ok(codes.has("assembly-main-disconnected"));
  assert.ok(codes.has("outlet-disconnected"));
  assert.ok(codes.has("outlet-run-count-unset"));
  assert.ok(codes.has("unit-setout-only"));
  assert.equal(audit.spareBranches.find((item) => item.stream === "supply").count, 6);
  assert.equal(audit.diagnostics.some((item) => /spare|cap/i.test(`${item.title} ${item.detail}`)), true);
  assert.equal(audit.diagnostics.some((item) => item.code.includes("spare")), false);
});

test("audit flags an interface transition hidden by a legacy compatibility-free route", () => {
  let project = projectWithFloor();
  const unit = catalogueComponent("synthetic-mvhr-placeholder", "unit", 1000, 1000);
  const terminal = catalogueComponent("synthetic-supply-terminal", "terminal", 5000, 1000);
  project = applyCommand(project, { type: "component.add", component: unit });
  project = applyCommand(project, { type: "component.add", component: terminal });
  project = applyCommand(project, routeCommand(
    "legacy-transition",
    "generic-duct",
    endpoint(unit, "Dwelling supply"),
    endpoint(terminal, "Dwelling supply"),
  ));

  const audit = auditVentilation(project, "floor-ground");
  assert.ok(audit.diagnostics.some((item) => item.code === "route-endpoint-size-conflict"));
  assert.match(audit.diagnostics.find((item) => item.code === "route-endpoint-size-conflict").detail, /explicit adapter/i);
});

test("audit rejects an interface transition hidden by a direct typed connection", () => {
  let project = projectWithFloor();
  const unit = catalogueComponent("synthetic-mvhr-placeholder", "unit", 1000, 1000);
  const terminal = catalogueComponent("synthetic-supply-terminal", "terminal", 5000, 1000);
  project = applyCommand(project, { type: "component.add", component: unit });
  project = applyCommand(project, { type: "component.add", component: terminal });
  const from = endpoint(unit, "Dwelling supply");
  const to = endpoint(terminal, "Dwelling supply");
  project = applyCommand(project, {
    type: "connection.add",
    connection: {
      id: "unadapted-direct-transition",
      kind: "direct",
      from: { componentId: from.componentId, portId: from.portId },
      to: { componentId: to.componentId, portId: to.portId },
      evidence: "synthetic audit conflict fixture",
    },
  });

  const audit = auditVentilation(project, "floor-ground");
  assert.ok(audit.diagnostics.some((item) => item.code === "direct-connection-size-conflict"));
  assert.ok(audit.diagnostics.some((item) => item.code === "unit-main-incomplete"));
  assert.ok(audit.diagnostics.some((item) => item.code === "outlet-path-incomplete"));
});

test("audit is reproducible through portable reopen and command undo-redo", () => {
  const project = completeGenericSystem();
  const expected = auditVentilation(project, "floor-ground");
  assert.deepEqual(auditVentilation(deserializeProject(serializeProject(project)), "floor-ground"), expected);

  const extraTerminal = catalogueComponent("synthetic-supply-terminal", "extra-terminal", 8000, 1600);
  let history = createCommandHistory(project);
  history = executeCommand(history, { type: "component.add", component: extraTerminal });
  const changed = auditVentilation(history.present, "floor-ground");
  assert.ok(changed.diagnostics.some((item) => item.componentId === "extra-terminal" && item.code === "outlet-disconnected"));
  history = undoCommand(history);
  assert.deepEqual(auditVentilation(history.present, "floor-ground"), expected);
  history = redoCommand(history);
  assert.deepEqual(auditVentilation(history.present, "floor-ground"), changed);
});

function completeGenericSystem() {
  let project = projectWithFloor();
  const unit = catalogueComponent("synthetic-mvhr-placeholder", "unit", 1000, 2200);
  const supply = createEquipmentAssembly("generic-remote-supply-attenuation-set", {
    id: "supply-group", floorId: "floor-ground", xMm: 4000, yMm: 1200,
  });
  const extract = createEquipmentAssembly("generic-remote-extract-attenuation-set", {
    id: "extract-group", floorId: "floor-ground", xMm: 4000, yMm: 3200,
  });
  const supplyTerminal = catalogueComponent("synthetic-supply-terminal", "supply-terminal", 7000, 1200);
  const extractTerminal = catalogueComponent("synthetic-extract-terminal", "extract-terminal", 7000, 3200);
  project = applyCommand(project, { type: "component.add", component: unit });
  project = applyCommand(project, { type: "equipmentAssembly.add", ...supply });
  project = applyCommand(project, { type: "equipmentAssembly.add", ...extract });
  project = applyCommand(project, { type: "component.add", component: supplyTerminal });
  project = applyCommand(project, { type: "component.add", component: extractTerminal });
  project = applyCommand(project, { type: "component.setDuctRunCount", componentId: supplyTerminal.id, ductRunCount: 1 });
  project = applyCommand(project, { type: "component.setDuctRunCount", componentId: extractTerminal.id, ductRunCount: 2 });

  project = applyCommand(project, routeCommand("supply-main", "epp-rigid-dn160",
    endpoint(unit, "Dwelling supply"), endpoint(component(project, "supply-group-end-plate"), "Dwelling supply", "rigid-epp")));
  project = applyCommand(project, routeCommand("extract-main", "epp-rigid-dn160",
    endpoint(unit, "Dwelling extract"), endpoint(component(project, "extract-group-end-plate"), "Dwelling extract", "rigid-epp")));
  project = applyCommand(project, routeCommand("supply-branch", "semi-rigid-radial",
    endpoint(component(project, "supply-group-radial-plate"), "Dwelling supply", "semi-rigid-pe"), endpoint(supplyTerminal, "Dwelling supply")));
  project = applyCommand(project, routeCommand("extract-branch", "semi-rigid-radial",
    endpoint(component(project, "extract-group-radial-plate"), "Dwelling extract", "semi-rigid-pe"), endpoint(extractTerminal, "Dwelling extract")));
  return project;
}

function routeCommand(id, ductKind, start, end) {
  const family = routeFamilyForKind(ductKind);
  return {
    type: "route.add",
    route: {
      id,
      floorId: "floor-ground",
      system: start.port.system,
      stream: start.port.stream,
      role: start.port.role,
      ductKind,
      connectionInterface: family.connectionInterface,
      startAttachment: { componentId: start.componentId, portId: start.portId },
      endAttachment: { componentId: end.componentId, portId: end.portId },
      points: [
        { ...start.positionMm, z: unknownMm("test route elevation") },
        { ...end.positionMm, z: unknownMm("test route elevation") },
      ],
    },
  };
}

function endpoint(componentValue, role, family = null) {
  const port = componentValue.ports.find((candidate) => (
    candidate.role === role && (family === null || candidate.interface?.family === family)
  ));
  if (!port) throw new TypeError(`Port not found: ${componentValue.id} ${role}`);
  const positionMm = {
    x: componentValue.positionMm.x + port.positionMm.x,
    y: componentValue.positionMm.y + port.positionMm.y,
  };
  return { componentId: componentValue.id, portId: port.id, port, positionMm };
}

function catalogueComponent(catalogueItemId, id, xMm, yMm) {
  return createCatalogueComponent(catalogueItemId, { id, floorId: "floor-ground", xMm, yMm });
}

function component(project, id) {
  const value = project.components.find((candidate) => candidate.id === id);
  if (!value) throw new TypeError(`Component not found: ${id}`);
  return value;
}

function projectWithFloor() {
  const project = applyCommand(createProject("project-ventilation-audit"), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "audit test datum") },
        orientation: identityQuaternion(),
      },
    },
  });
  return project;
}
