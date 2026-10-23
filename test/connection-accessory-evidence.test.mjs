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
} from "../src/domain/spatial.mjs";
import { createCatalogueComponent, routeFamilyForKind } from "../src/editor/component-catalogue.mjs";
import { inspectConnectionAccessoryEvidence } from "../src/editor/connection-accessory-evidence.mjs";
import { createEquipmentAssembly } from "../src/editor/equipment-assemblies.mjs";

test("Q350 to remote EPP route reports source provenance, known setout and unresolved installation evidence", () => {
  let project = projectWithFloor();
  const unit = createCatalogueComponent("zehnder-q350-hrv-left-drawing-profile", {
    id: "q350-left",
    floorId: "floor-ground",
    xMm: 1000,
    yMm: 1000,
  });
  const assemblyValue = createEquipmentAssembly("generic-remote-supply-attenuation-set", {
    id: "supply-assembly",
    floorId: "floor-ground",
    xMm: 4000,
    yMm: 1000,
  });
  project = applyCommand(project, { type: "component.add", component: unit });
  project = applyCommand(project, { type: "equipmentAssembly.add", ...assemblyValue });
  const endPlate = project.components.find((component) => component.id === "supply-assembly-end-plate");
  const unitPort = unit.ports.find((port) => port.role === "Dwelling supply");
  const endPlatePort = endPlate.ports.find((port) => port.interface?.family === "rigid-epp");
  project = addAttachedRoute(project, "q350-to-remote", unit, unitPort, endPlate, endPlatePort);

  const inspection = inspectConnectionAccessoryEvidence(project, "floor-ground");
  const route = inspection.items.find((item) => item.id === "route:q350-to-remote");

  assert.equal(inspection.summary.inspectedConnectionCount, 3);
  assert.equal(inspection.summary.routeConnectionCount, 1);
  assert.equal(inspection.summary.directConnectionCount, 2);
  assert.equal(inspection.summary.installationReadyCount, 0);
  assert.equal(inspection.summary.drawingOnlyCount, 1);
  assert.equal(inspection.summary.syntheticFixtureCount, 2);
  assert.equal(route.status, "drawing-topology-only");
  assert.equal(route.installationStatus, "unverified");
  assert.equal(route.routeEvidence.connectionScope, "drawing-only");
  assert.deepEqual(route.accessoryDecision.inferredItems, []);
  assert.equal(route.accessoryDecision.inferredQuantity, null);
  assert.ok(route.accessoryDecision.requiredEvidence.some((item) => item.code === "mating-profile"));
  assert.ok(route.accessoryDecision.requiredEvidence.some((item) => item.code === "adapter-or-sleeve-decision"));
  assert.ok(route.accessoryDecision.requiredEvidence.some((item) => item.code === "field-connector-configuration"));
  assert.ok(route.accessoryDecision.requiredEvidence.some((item) => item.code === "local-product-crosswalk"));
  assert.match(route.verifiedFacts.join(" "), /160 mm inside and 190 mm outside/);

  const q350Endpoint = route.endpoints.find((endpoint) => endpoint.componentId === "q350-left");
  assert.equal(q350Endpoint.catalogueEvidence.knownDimensions.body.width, 725);
  assert.equal(q350Endpoint.catalogueEvidence.knownDimensions.body.depth, 570);
  assert.equal(q350Endpoint.catalogueEvidence.knownDimensions.body.height, 745);
  assert.equal(q350Endpoint.catalogueEvidence.manufacturerArticle, "471502110");
  assert.equal(q350Endpoint.catalogueEvidence.localSkuCrosswalkStatus, "unverified");
  assert.equal(q350Endpoint.catalogueEvidence.handing, "supply-and-extract-air-to-left");
  assert.deepEqual(
    q350Endpoint.catalogueEvidence.sourceRecords.map((source) => source.sourceId),
    [
      "internal-product-identifiers-rev-6a",
      "zehnder-comfoair-q350-tr-technical-specification",
      "zehnder-q350-q450-setout",
    ],
  );
  assert.match(inspection.evidenceBoundary, /No adapter, sleeve, seal, support, clearance/);
  assert.ok(Object.isFrozen(inspection));
});

test("generic assembly joints remain synthetic evidence fixtures and never infer accessory items", () => {
  let project = projectWithFloor();
  const assemblyValue = createEquipmentAssembly("generic-remote-extract-attenuation-set", {
    id: "extract-assembly",
    floorId: "floor-ground",
    xMm: 3000,
    yMm: 1500,
  });
  project = applyCommand(project, { type: "equipmentAssembly.add", ...assemblyValue });

  const inspection = inspectConnectionAccessoryEvidence(project, "floor-ground");
  assert.equal(inspection.items.length, 2);
  for (const item of inspection.items) {
    assert.equal(item.status, "synthetic-fixture-only");
    assert.deepEqual(item.accessoryDecision.inferredItems, []);
    assert.equal(item.accessoryDecision.inferredQuantity, null);
    assert.ok(item.accessoryDecision.requiredEvidence.some((requirement) => requirement.code === "manufacturer-product-selection"));
    assert.ok(item.accessoryDecision.requiredEvidence.some((requirement) => requirement.code === "internal-joint-compatibility"));
    assert.ok(item.accessoryDecision.requiredEvidence.some((requirement) => requirement.code === "acoustic-duty"));
    for (const endpoint of item.endpoints) {
      assert.deepEqual(
        endpoint.catalogueEvidence.sourceRecords.map((source) => source.sourceId),
        ["hiper-generic-test-fixture", "zehnder-comfowell-320-technical-specification"],
      );
      assert.equal(endpoint.catalogueEvidence.classification, "synthetic-fixture");
    }
  }
});

test("legacy mismatched interfaces require an explicit transition without selecting an adapter", () => {
  let project = projectWithFloor();
  const unit = createCatalogueComponent("synthetic-mvhr-placeholder", {
    id: "generic-unit",
    floorId: "floor-ground",
    xMm: 1000,
    yMm: 1000,
  });
  const terminal = createCatalogueComponent("synthetic-supply-terminal", {
    id: "supply-terminal",
    floorId: "floor-ground",
    xMm: 5000,
    yMm: 1000,
  });
  project = applyCommand(project, { type: "component.add", component: unit });
  project = applyCommand(project, { type: "component.add", component: terminal });
  const unitPort = unit.ports.find((port) => port.role === "Dwelling supply");
  const terminalPort = terminal.ports[0];
  project = addAttachedRoute(project, "legacy-transition", unit, unitPort, terminal, terminalPort, "generic-duct");

  const inspection = inspectConnectionAccessoryEvidence(project, "floor-ground");
  const item = inspection.items[0];
  assert.equal(item.status, "explicit-transition-required");
  assert.equal(item.installationStatus, "blocked-pending-explicit-transition");
  assert.equal(inspection.summary.explicitTransitionCount, 1);
  assert.ok(item.accessoryDecision.requiredEvidence.some((requirement) => requirement.code === "explicit-transition"));
  assert.deepEqual(item.accessoryDecision.inferredItems, []);
});

test("connection evidence is deterministic through portable canonical reopen", () => {
  let project = projectWithFloor();
  const assemblyValue = createEquipmentAssembly("generic-remote-supply-attenuation-set", {
    id: "persistent-assembly",
    floorId: "floor-ground",
    xMm: 3000,
    yMm: 1500,
  });
  project = applyCommand(project, { type: "equipmentAssembly.add", ...assemblyValue });
  const expected = inspectConnectionAccessoryEvidence(project, "floor-ground");
  const reopened = deserializeProject(serializeProject(project));
  assert.deepEqual(inspectConnectionAccessoryEvidence(reopened, "floor-ground"), expected);
});

function projectWithFloor() {
  return applyCommand(createProject("project-connection-accessory-evidence"), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "connection evidence datum") },
        orientation: identityQuaternion(),
      },
    },
  });
}

function addAttachedRoute(project, id, startComponent, startPort, endComponent, endPort, ductKind = "epp-rigid-dn160") {
  const family = routeFamilyForKind(ductKind);
  const start = floorPortTransform(project, startComponent.id, startPort.id).positionMm;
  const end = floorPortTransform(project, endComponent.id, endPort.id).positionMm;
  return applyCommand(project, {
    type: "route.add",
    route: {
      id,
      floorId: "floor-ground",
      system: "mvhr",
      stream: "supply",
      role: "Dwelling supply",
      ductKind,
      parallelRunCount: 1,
      connectionInterface: family.connectionInterface,
      startAttachment: { componentId: startComponent.id, portId: startPort.id },
      endAttachment: { componentId: endComponent.id, portId: endPort.id },
      points: [
        { x: start.x, y: start.y, z: unknownMm("connection evidence route") },
        { x: end.x, y: end.y, z: unknownMm("connection evidence route") },
      ],
    },
  });
}
