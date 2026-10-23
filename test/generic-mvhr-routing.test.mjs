import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  createProject,
  floorPortTransform,
  identityQuaternion,
  knownMm,
  unknownMm,
  validateProject,
} from "../src/domain/spatial.mjs";
import {
  createCatalogueComponent,
  routeFamilyForKind,
} from "../src/editor/component-catalogue.mjs";
import {
  activateMechanicalTool,
  createMechanicalInteractionState,
  handleMechanicalCanvasClick,
} from "../src/editor/mechanical-controller.mjs";
import { createEquipmentAssembly } from "../src/editor/equipment-assemblies.mjs";

test("generic HRV routes through separate supply and extract remote assemblies to typed outlets", () => {
  let project = projectWithFloor();
  const unit = createCatalogueComponent("synthetic-mvhr-placeholder", {
    id: "unit-generic",
    floorId: "floor-ground",
    xMm: 1000,
    yMm: 2000,
  });
  const supplyAssembly = createEquipmentAssembly("generic-remote-supply-attenuation-set", {
    id: "assembly-supply",
    floorId: "floor-ground",
    xMm: 4000,
    yMm: 1200,
  });
  const extractAssembly = createEquipmentAssembly("generic-remote-extract-attenuation-set", {
    id: "assembly-extract",
    floorId: "floor-ground",
    xMm: 4000,
    yMm: 3200,
  });
  const supplyOutlet = createCatalogueComponent("synthetic-supply-terminal", {
    id: "outlet-supply",
    floorId: "floor-ground",
    xMm: 7000,
    yMm: 1200,
  });
  const extractOutlet = createCatalogueComponent("synthetic-extract-terminal", {
    id: "outlet-extract",
    floorId: "floor-ground",
    xMm: 7000,
    yMm: 3200,
  });

  project = applyCommand(project, { type: "component.add", component: unit });
  project = applyCommand(project, { type: "equipmentAssembly.add", ...supplyAssembly });
  project = applyCommand(project, { type: "equipmentAssembly.add", ...extractAssembly });
  project = applyCommand(project, { type: "component.add", component: supplyOutlet });
  project = applyCommand(project, { type: "component.add", component: extractOutlet });

  const supplyEndPlate = component(project, "assembly-supply-end-plate");
  const supplyRadialPlate = component(project, "assembly-supply-radial-plate");
  const extractEndPlate = component(project, "assembly-extract-end-plate");
  const extractRadialPlate = component(project, "assembly-extract-radial-plate");

  project = addControllerRoute(project, "route-supply-main", "epp-rigid-dn160",
    endpoint(unit, "Dwelling supply"), endpoint(supplyEndPlate, "Dwelling supply", "rigid-epp"));
  project = addControllerRoute(project, "route-extract-main", "epp-rigid-dn160",
    endpoint(unit, "Dwelling extract"), endpoint(extractEndPlate, "Dwelling extract", "rigid-epp"));
  project = addControllerRoute(project, "route-supply-branch", "semi-rigid-radial",
    endpoint(supplyRadialPlate, "Dwelling supply", "semi-rigid-pe"), endpoint(supplyOutlet, "Dwelling supply"));
  project = addControllerRoute(project, "route-extract-branch", "semi-rigid-radial",
    endpoint(extractRadialPlate, "Dwelling extract", "semi-rigid-pe"), endpoint(extractOutlet, "Dwelling extract"));

  assert.equal(project.routes.length, 4);
  assert.deepEqual(project.routes.map((route) => route.connectionInterface.nominalSizeMm), [160, 160, 90, 90]);
  assert.doesNotThrow(() => validateProject(project));

  const wrongRole = routeIntent(
    project,
    "epp-rigid-dn160",
    endpoint(unit, "Outdoor intake"),
    endpoint(supplyEndPlate, "Dwelling supply", "rigid-epp"),
  );
  assert.equal(wrongRole.intent, null);
  assert.match(wrongRole.message, /incompatible/);

  const duplicate = project.routes[0];
  assert.throws(() => applyCommand(project, {
    type: "route.add",
    route: { ...structuredClone(duplicate), id: "route-duplicate-occupied" },
  }), /already occupied/);

  const intake = endpoint(unit, "Outdoor intake");
  const intakePoint = floorPortTransform(project, intake.componentId, intake.portId).positionMm;
  assert.throws(() => applyCommand(project, {
    type: "route.add",
    route: {
      id: "route-wrong-size",
      floorId: "floor-ground",
      system: "mvhr",
      stream: "intake",
      role: "Outdoor intake",
      ductKind: "epp-rigid-dn125",
      connectionInterface: routeFamilyForKind("epp-rigid-dn125").connectionInterface,
      startAttachment: { componentId: intake.componentId, portId: intake.portId },
      endAttachment: null,
      points: [intakePoint, { x: intakePoint.x + 1000, y: intakePoint.y, z: unknownMm("test free end") }],
    },
  }), /explicit adapter/);
});

function addControllerRoute(project, id, ductKind, start, end) {
  const result = routeIntent(project, ductKind, start, end);
  assert.equal(result.intent?.type, "route.commit");
  return applyCommand(project, {
    type: "route.add",
    route: {
      id,
      floorId: "floor-ground",
      system: result.intent.system,
      stream: result.intent.stream,
      role: result.intent.role,
      ductKind: result.intent.ductKind,
      connectionInterface: result.intent.connectionInterface,
      startAttachment: result.intent.start,
      endAttachment: result.intent.end,
      points: result.intent.points.map((point) => ({
        x: point.x,
        y: point.y,
        z: unknownMm("generic routing test elevation"),
      })),
    },
  });
}

function routeIntent(project, ductKind, start, end) {
  let state = activateMechanicalTool(createMechanicalInteractionState(), "route", { ductKind });
  const startPoint = floorPortTransform(project, start.componentId, start.portId).positionMm;
  const endPoint = floorPortTransform(project, end.componentId, end.portId).positionMm;
  const started = handleMechanicalCanvasClick(state, {
    point: startPoint,
    hit: hit(start),
  });
  if (!started.state.routeDraft) return started;
  state = started.state;
  return handleMechanicalCanvasClick(state, {
    point: endPoint,
    hit: hit(end),
  });
}

function endpoint(componentValue, role, family = null) {
  const port = componentValue.ports.find((candidate) => (
    candidate.role === role && (family === null || candidate.interface?.family === family)
  ));
  if (!port) throw new TypeError(`Port not found: ${componentValue.id} ${role} ${family ?? ""}`);
  return { componentId: componentValue.id, portId: port.id, port };
}

function hit(value) {
  return {
    kind: "port",
    componentId: value.componentId,
    portId: value.portId,
    system: value.port.system,
    stream: value.port.stream,
    role: value.port.role,
    interface: value.port.interface,
  };
}

function component(project, id) {
  const value = project.components.find((candidate) => candidate.id === id);
  if (!value) throw new TypeError(`Component not found: ${id}`);
  return value;
}

function projectWithFloor() {
  return applyCommand(createProject("project-generic-mvhr-routing"), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "generic routing test datum") },
        orientation: identityQuaternion(),
      },
    },
  });
}
