import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  createProject,
  deserializeProject,
  floorPortTransform,
  identityQuaternion,
  knownMm,
  serializeProject,
  unknownMm,
  validateProject,
} from "../src/domain/spatial.mjs";
import { createCatalogueComponent } from "../src/editor/component-catalogue.mjs";
import {
  activateMechanicalTool,
  createMechanicalInteractionState,
  handleMechanicalCanvasClick,
} from "../src/editor/mechanical-controller.mjs";
import { createEquipmentAssembly } from "../src/editor/equipment-assemblies.mjs";

for (const handing of ["left", "right"]) {
  for (const stream of ["supply", "extract"]) {
    test(`Q350 ${handing}-hand ${stream} EPP drawing route completes HRV to remote end plate and persists`, () => {
      const fixture = routingFixture(handing, stream);
      const result = routeIntent(fixture.project, fixture.unitEndpoint, fixture.endPlateEndpoint);

      assert.equal(result.intent?.type, "route.commit");
      assert.equal(result.intent.stream, stream);
      assert.equal(result.intent.connectionInterface.connectionScope, "drawing-only");
      assert.equal(result.intent.connectionInterface.installationCompatibilityStatus, "unverified");

      const routed = commitRoute(fixture.project, result.intent, `route-${handing}-${stream}-forward`);
      assert.doesNotThrow(() => validateProject(routed));
      assert.deepEqual(deserializeProject(serializeProject(routed)), routed);
    });
  }
}

test("Q350 remote EPP drawing route completes from the attenuator end plate back to the HRV", () => {
  const fixture = routingFixture("left", "supply");
  const result = routeIntent(fixture.project, fixture.endPlateEndpoint, fixture.unitEndpoint);

  assert.equal(result.intent?.type, "route.commit");
  assert.deepEqual(result.intent.start, {
    componentId: fixture.endPlateEndpoint.component.id,
    portId: fixture.endPlateEndpoint.port.id,
  });
  assert.deepEqual(result.intent.end, {
    componentId: fixture.unitEndpoint.component.id,
    portId: fixture.unitEndpoint.port.id,
  });
  assert.doesNotThrow(() => validateProject(commitRoute(fixture.project, result.intent, "route-reverse-supply")));
});

test("Q350 remote EPP drawing route still rejects the wrong service port", () => {
  const fixture = routingFixture("right", "supply");
  const wrongPort = fixture.unit.ports.find((port) => port.stream === "extract");
  const result = routeIntent(
    fixture.project,
    fixture.endPlateEndpoint,
    { component: fixture.unit, port: wrongPort },
  );

  assert.equal(result.intent, null);
  assert.match(result.message, /incompatible: Dwelling extract \(extract\); route started from Dwelling supply \(supply\)/);
  assert.equal(result.state.routeDraft.points.length, 1);
});

for (const reverse of [false, true]) {
  test(`Q350 drawing route accepts a pinned legacy EPP endpoint without a drawing-class field ${reverse ? "in reverse" : "from the HRV"}`, () => {
    const fixture = routingFixture("right", "extract", { legacyEppInterface: true });
    assert.equal(fixture.endPlateEndpoint.port.interface.family, "rigid-epp");
    assert.equal(fixture.endPlateEndpoint.port.interface.nominalSizeMm, 160);
    assert.equal(fixture.endPlateEndpoint.port.interface.drawingConnectionClass, undefined);

    const start = reverse ? fixture.endPlateEndpoint : fixture.unitEndpoint;
    const end = reverse ? fixture.unitEndpoint : fixture.endPlateEndpoint;
    const result = routeIntent(fixture.project, start, end);
    assert.equal(result.intent?.type, "route.commit");
    const routed = commitRoute(fixture.project, result.intent, `route-legacy-${reverse ? "reverse" : "forward"}`);
    const reopened = deserializeProject(serializeProject(routed));
    assert.equal(reopened.routes.length, 1);
    assert.equal(reopened.routes[0].connectionInterface.connectionScope, "drawing-only");
    assert.doesNotThrow(() => validateProject(reopened));
  });
}

function routingFixture(handing, stream, options = {}) {
  let project = applyCommand(createProject(`project-q350-epp-${handing}-${stream}`), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "routing fixture datum") },
        orientation: identityQuaternion(),
      },
    },
  });
  const unit = createCatalogueComponent(`zehnder-q350-hrv-${handing}-drawing-profile`, {
    id: `component-q350-${handing}-${stream}`,
    floorId: "floor-ground",
    xMm: 0,
    yMm: 0,
  });
  const assemblyValue = createEquipmentAssembly(`generic-remote-${stream}-attenuation-set`, {
    id: `assembly-${handing}-${stream}`,
    floorId: "floor-ground",
    xMm: 2500,
    yMm: 0,
  });
  if (options.legacyEppInterface === true) {
    const endPlate = assemblyValue.components.find((component) => component.id.endsWith("-end-plate"));
    const eppPort = endPlate.ports.find((port) => port.interface?.family === "rigid-epp");
    delete eppPort.interface.drawingConnectionClass;
    delete eppPort.interface.installationCompatibilityStatus;
  }
  project = applyCommand(project, { type: "component.add", component: unit });
  project = applyCommand(project, { type: "equipmentAssembly.add", ...assemblyValue });
  const endPlate = project.components.find((component) => (
    component.id === `${assemblyValue.assembly.id}-end-plate`
  ));
  const unitPort = unit.ports.find((port) => port.stream === stream);
  const endPlatePort = endPlate.ports.find((port) => port.interface?.family === "rigid-epp");
  return {
    project,
    unit,
    unitEndpoint: { component: unit, port: unitPort },
    endPlateEndpoint: { component: endPlate, port: endPlatePort },
  };
}

function routeIntent(project, start, end) {
  let state = activateMechanicalTool(createMechanicalInteractionState(), "route", {
    ductKind: "epp-rigid-dn160",
  });
  const started = handleMechanicalCanvasClick(state, {
    point: endpointPoint(project, start),
    hit: endpointHit(start),
  });
  assert.ok(started.state.routeDraft);
  state = started.state;
  return handleMechanicalCanvasClick(state, {
    point: endpointPoint(project, end),
    hit: endpointHit(end),
  });
}

function commitRoute(project, intent, id) {
  return applyCommand(project, {
    type: "route.add",
    route: {
      id,
      floorId: "floor-ground",
      system: intent.system,
      stream: intent.stream,
      role: intent.role,
      ductKind: intent.ductKind,
      parallelRunCount: intent.parallelRunCount,
      connectionInterface: intent.connectionInterface,
      startAttachment: intent.start,
      endAttachment: intent.end,
      points: intent.points.map((point) => ({
        ...point,
        z: unknownMm("routing fixture elevation"),
      })),
    },
  });
}

function endpointPoint(project, endpoint) {
  const point = floorPortTransform(project, endpoint.component.id, endpoint.port.id).positionMm;
  return { x: point.x, y: point.y };
}

function endpointHit(endpoint) {
  return {
    kind: "port",
    componentId: endpoint.component.id,
    portId: endpoint.port.id,
    system: endpoint.port.system,
    stream: endpoint.port.stream,
    role: endpoint.port.role,
    interface: endpoint.port.interface,
    occupied: false,
  };
}
