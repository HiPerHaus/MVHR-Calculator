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
} from "../src/domain/spatial.mjs";
import {
  createCatalogueComponent,
  routeFamilyForKind,
} from "../src/editor/component-catalogue.mjs";
import {
  GENERIC_CW_PLAN_GRAPHIC_ID,
  Q350_PLAN_GRAPHIC_ID,
  deriveComponentPlanGraphic,
  q350CasingPath,
} from "../src/editor/component-plan-graphics.mjs";
import { createEquipmentAssembly } from "../src/editor/equipment-assemblies.mjs";

test("Q350 plan graphics preserve the manufacturer footprint and exact handed port maps", () => {
  const left = createCatalogueComponent("zehnder-q350-hrv-left-drawing-profile", {
    id: "q350-left",
    floorId: "floor-ground",
    xMm: 0,
    yMm: 0,
  });
  const right = createCatalogueComponent("zehnder-q350-erv-right-drawing-profile", {
    id: "q350-right",
    floorId: "floor-ground",
    xMm: 0,
    yMm: 0,
  });
  const leftGraphic = deriveComponentPlanGraphic(left);
  const rightGraphic = deriveComponentPlanGraphic(right);

  assert.equal(leftGraphic.graphicId, Q350_PLAN_GRAPHIC_ID);
  assert.equal(leftGraphic.widthMm, 725);
  assert.equal(leftGraphic.depthMm, 570);
  assert.equal(leftGraphic.handing, "left");
  assert.equal(leftGraphic.handingLabel, "LH");
  assert.deepEqual(leftGraphic.ports.map(portSummary), [
    ["ETA", -290, -162, 160, 190],
    ["SUP", -290, 118.5, 160, 190],
    ["EHA", 290, -162, 160, 190],
    ["ODA", 290, 118.5, 160, 190],
  ]);
  assert.deepEqual(rightGraphic.ports.map(portSummary), [
    ["ODA", -290, -162, 160, 190],
    ["EHA", -290, 118.5, 160, 190],
    ["SUP", 290, -162, 160, 190],
    ["ETA", 290, 118.5, 160, 190],
  ]);
  assert.match(q350CasingPath(leftGraphic), /^M -362\.5 -285 H 362\.5/u);
  assert.equal(Object.isFrozen(leftGraphic.ports), true);
});

test("existing saved Q350 box snapshots gain the vector appearance without a schema rewrite", () => {
  const existing = createCatalogueComponent("zehnder-q350-hrv-left-drawing-profile", {
    id: "saved-q350",
    floorId: "floor-ground",
    xMm: 0,
    yMm: 0,
  });
  existing.displaySymbol = { shape: "box", widthMm: 725, heightMm: 570 };
  assert.equal(deriveComponentPlanGraphic(existing).graphicId, Q350_PLAN_GRAPHIC_ID);
  assert.equal(deriveComponentPlanGraphic({
    id: "generic",
    displaySymbol: { shape: "box", widthMm: 725, heightMm: 570 },
    ports: [],
  }), null);
});

test("Q350 rotation, attached route endpoints and the plan graphic survive save and reopen", () => {
  let project = projectWithFloor();
  const component = createCatalogueComponent("zehnder-q350-hrv-left-drawing-profile", {
    id: "q350-rotated",
    floorId: "floor-ground",
    xMm: 1000,
    yMm: 2000,
  });
  project = applyCommand(project, { type: "component.add", component });
  const supply = component.ports.find((port) => port.role === "Dwelling supply");
  const before = floorPortTransform(project, component.id, supply.id).positionMm;
  project = applyCommand(project, {
    type: "route.add",
    route: {
      id: "q350-route",
      floorId: "floor-ground",
      system: "mvhr",
      stream: "supply",
      role: "Dwelling supply",
      ductKind: "epp-rigid-dn160",
      parallelRunCount: 1,
      connectionInterface: routeFamilyForKind("epp-rigid-dn160").connectionInterface,
      startAttachment: { componentId: component.id, portId: supply.id },
      endAttachment: null,
      points: [before, { x: 3000, y: 2500, z: before.z }],
    },
  });
  project = applyCommand(project, {
    type: "component.rotateFloorZ",
    componentId: component.id,
    angleRad: Math.PI / 2,
  });
  const rotatedPort = floorPortTransform(project, component.id, supply.id).positionMm;
  assert.equal(rotatedPort.x, 881.5);
  assert.equal(rotatedPort.y, 1710);
  assert.deepEqual(project.routes[0].points[0], rotatedPort);

  const reopened = deserializeProject(serializeProject(project));
  assert.deepEqual(reopened, project);
  assert.deepEqual(
    deriveComponentPlanGraphic(reopened.components[0]).ports.map(portSummary),
    deriveComponentPlanGraphic(component).ports.map(portSummary),
  );
  assert.deepEqual(reopened.routes[0].points[0], floorPortTransform(reopened, component.id, supply.id).positionMm);
});

test("generic remote assemblies use a recognisable provisional CW-inspired graphic without changing ports", () => {
  const supply = createEquipmentAssembly("generic-remote-supply-attenuation-set", {
    id: "assembly-supply-graphic",
    floorId: "floor-ground",
    xMm: 1000,
    yMm: 2000,
  });
  const extract = createEquipmentAssembly("generic-remote-extract-attenuation-set", {
    id: "assembly-extract-graphic",
    floorId: "floor-ground",
    xMm: 1000,
    yMm: 3000,
  });
  const supplyGraphics = supply.components.map(deriveComponentPlanGraphic);
  const extractGraphics = extract.components.map(deriveComponentPlanGraphic);

  assert.deepEqual(supplyGraphics.map((graphic) => graphic.partType), [
    "round-end-plate",
    "attenuator",
    "radial-plate",
  ]);
  assert.ok(supplyGraphics.every((graphic) => graphic.graphicId === GENERIC_CW_PLAN_GRAPHIC_ID));
  assert.ok(supplyGraphics.every((graphic) => graphic.kind === "generic-provisional-plan-symbol"));
  assert.ok(supplyGraphics.every((graphic) => graphic.displayIdentity === "GENERIC CW-STYLE"));
  assert.ok(supplyGraphics.every((graphic) => (
    graphic.dimensionBasis === "official-cw320-envelope-with-generic-unverified-port-centres"
  )));
  assert.ok(supplyGraphics.every((graphic) => (
    graphic.connectorExtentStatus === "unverified-not-included-in-body-envelope"
  )));
  assert.ok(supplyGraphics.every((graphic) => graphic.flowDirectionX === 1));
  assert.ok(extractGraphics.every((graphic) => graphic.flowDirectionX === -1));
  assert.deepEqual(supplyGraphics.map((graphic) => [graphic.widthMm, graphic.depthMm]), [
    [51, 336],
    [500, 320],
    [41, 336],
  ]);

  const endPlate = supplyGraphics[0];
  const radialPlate = supplyGraphics[2];
  assert.deepEqual(
    endPlate.ports.map((port) => [port.family, port.xMm, port.yMm, port.nominalDiameterMm]),
    [["rigid-epp", -25.5, 0, 160], ["generic-cw-module", 25.5, 0, 320]],
  );
  assert.deepEqual(
    radialPlate.ports.filter((port) => port.family === "semi-rigid-pe").map((port) => [port.xMm, port.yMm]),
    [[20.5, -120], [20.5, -72], [20.5, -24], [20.5, 24], [20.5, 72], [20.5, 120]],
  );
  assert.match(endPlate.evidenceBoundary, /generic fixture, not a verified ComfoWell SKU/u);
  assert.equal(Object.isFrozen(radialPlate.ports), true);
});

test("old saved generic assembly snapshots gain the CW-inspired appearance through rotation and reopen", () => {
  let project = projectWithFloor();
  const value = createEquipmentAssembly("generic-remote-extract-attenuation-set", {
    id: "assembly-saved-cw-graphic",
    floorId: "floor-ground",
    xMm: 2400,
    yMm: 1800,
  });
  const [endPlate, attenuator, radialPlate] = value.components;
  for (const component of value.components) {
    component.catalogueRecordVersionId = component.catalogueRecordVersionId.replace(/\.v3$/u, ".v1");
    component.catalogueSnapshot.recordVersionId = component.catalogueRecordVersionId;
  }
  endPlate.positionMm.x = 1920;
  attenuator.positionMm.x = 2400;
  radialPlate.positionMm.x = 2880;
  endPlate.displaySymbol = { shape: "box", widthMm: 240, heightMm: 320 };
  attenuator.displaySymbol = { shape: "box", widthMm: 720, heightMm: 320 };
  radialPlate.displaySymbol = { shape: "box", widthMm: 240, heightMm: 320 };
  Object.assign(endPlate.ports.find((port) => port.id.endsWith("-port-epp")).positionMm, { x: -120 });
  Object.assign(endPlate.ports.find((port) => port.id.endsWith("-port-module")).positionMm, { x: 120 });
  Object.assign(attenuator.ports.find((port) => port.id.endsWith("-port-in")).positionMm, { x: -360 });
  Object.assign(attenuator.ports.find((port) => port.id.endsWith("-port-out")).positionMm, { x: 360 });
  Object.assign(radialPlate.ports.find((port) => port.id.endsWith("-port-module")).positionMm, { x: -120 });
  for (const port of radialPlate.ports.filter((port) => port.interface.family === "semi-rigid-pe")) {
    port.positionMm.x = 120;
  }
  endPlate.catalogueSnapshot.symbol = structuredClone(endPlate.displaySymbol);
  attenuator.catalogueSnapshot.symbol = structuredClone(attenuator.displaySymbol);
  radialPlate.catalogueSnapshot.symbol = structuredClone(radialPlate.displaySymbol);
  const eppPort = endPlate.ports.find((port) => port.interface.family === "rigid-epp");
  delete eppPort.interface.drawingConnectionClass;
  project = applyCommand(project, { type: "equipmentAssembly.add", ...value });
  const before = floorPortTransform(project, endPlate.id, eppPort.id).positionMm;
  project = applyCommand(project, {
    type: "equipmentAssembly.rotateFloorZ",
    assemblyId: value.assembly.id,
    angleRad: Math.PI / 2,
  });
  const after = floorPortTransform(project, endPlate.id, eppPort.id).positionMm;
  assert.notDeepEqual(after, before);

  const reopened = deserializeProject(serializeProject(project));
  const reopenedEndPlate = reopened.components.find((component) => component.id === endPlate.id);
  const graphic = deriveComponentPlanGraphic(reopenedEndPlate);
  assert.equal(graphic.graphicId, GENERIC_CW_PLAN_GRAPHIC_ID);
  assert.equal(graphic.partType, "round-end-plate");
  assert.equal(graphic.stream, "extract");
  assert.equal(graphic.widthMm, 240);
  assert.equal(graphic.dimensionBasis, "legacy-generic-envelope-preserved");
  assert.equal(graphic.ports.find((port) => port.family === "rigid-epp").xMm, -120);
  assert.deepEqual(
    reopened.routes,
    [],
    "presentation changes must not create or change route topology",
  );
});

function portSummary(port) {
  return [port.code, port.xMm, port.yMm, port.boreDiameterMm, port.outsideDiameterMm];
}

function projectWithFloor() {
  return applyCommand(createProject("project-q350-graphics-test"), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "Q350 graphics test datum") },
        orientation: identityQuaternion(),
      },
    },
  });
}


test("Q350 port labels clear the collar and point outwards for both hands", async () => {
  const { q350PortLabelLayout } = await import("../src/editor/component-plan-graphics.mjs");
  for (const xMm of [-290, 290]) {
    const p = { xMm, yMm: 118.5, outsideDiameterMm: 190 };
    const layout = q350PortLabelLayout(p);
    assert.ok(Math.abs(layout.xMm-p.xMm) > 95);
    assert.equal(layout.yMm, p.yMm);
    assert.equal(layout.anchor, xMm < 0 ? "end" : "start");
    assert.ok(xMm < 0 ? layout.xMm < xMm-95 : layout.xMm > xMm+95);
  }
});
