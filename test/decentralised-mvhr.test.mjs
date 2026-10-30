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
import { deriveRoomBoundaries } from "../src/domain/rooms.mjs";
import {
  COMPONENT_CATALOGUE,
  createCatalogueComponent,
  deriveVentilationConnectionDemand,
} from "../src/editor/component-catalogue.mjs";
import { inspectDecentralisedMvhr } from "../src/editor/decentralised-mvhr.mjs";
import { createPartsSchedule } from "../src/editor/parts-schedule.mjs";
import { auditVentilation } from "../src/editor/ventilation-audit.mjs";
import { createA3SheetModel, renderA3SheetSvg } from "../src/sheets/a3-sheet.mjs";

const DECENTRALISED_IDS = [
  "aerofresh-30-compact-decentralised",
  "zehnder-comfospot-50-decentralised",
  "zehnder-comfoair-70-decentralised",
  "lunos-e2-60-decentralised",
];

test("current decentralised catalogue exposes four schematic zero-port physical-unit records", () => {
  const records = DECENTRALISED_IDS.map((id) => COMPONENT_CATALOGUE.find((item) => item.id === id));
  assert.equal(records.every(Boolean), true);
  assert.deepEqual(records.map((item) => item.decentralisedSpecification.operatingMode), [
    "alternating-paired",
    "continuous-balanced",
    "continuous-balanced",
    "alternating-paired",
  ]);
  for (const record of records) {
    assert.equal(record.category, "decentralised-mvhr-unit");
    assert.equal(record.symbol.scaleStatus, "schematic-not-to-scale");
    assert.equal(record.dimensions.penetrationDiameterMm, null);
    assert.equal(record.ports.length, 0);
    assert.equal(record.decentralisedSpecification.airflowUse, "catalogue-reference-only-excluded-from-project-totals");
  }
});

test("physical markers retain explicit room, pair and controller associations through save and reopen", () => {
  let project = projectWithRoom();
  const first = component("aerofresh-30-compact-decentralised", "aerofresh-head-1", 1200, 1200);
  const second = component("aerofresh-30-compact-decentralised", "aerofresh-head-2", 4800, 1200);
  project = applyCommand(project, { type: "component.add", component: first, autoAssignTerminalSpace: true });
  project = applyCommand(project, { type: "component.add", component: second, autoAssignTerminalSpace: true });
  for (const componentId of [first.id, second.id]) {
    project = applyCommand(project, {
      type: "component.setDecentralisedConfiguration",
      componentId,
      roomId: "room-living",
      zoneId: null,
      pairGroupId: "Pair 1",
      controllerReference: "sMove 1",
    });
  }
  project = applyCommand(project, { type: "component.rotateFloorZ", componentId: second.id, angleRad: Math.PI });

  const reopened = deserializeProject(serializeProject(project));
  const inspection = inspectDecentralisedMvhr(reopened, "floor-ground");
  assert.equal(inspection.unitCount, 2);
  assert.equal(inspection.pairGroupCount, 1);
  assert.equal(inspection.controllerReferenceCount, 1);
  assert.equal(inspection.pairGroups[0].physicalUnitCount, 2);
  assert.deepEqual(inspection.diagnostics, []);
  assert.equal(reopened.components.every((item) => item.decentralisedMvhr.roomId === "room-living"), true);
  assert.equal(deriveVentilationConnectionDemand(reopened).supply.outletCount, 0);
  assert.equal(deriveVentilationConnectionDemand(reopened).extract.outletCount, 0);
});

test("decentralised-only audit avoids false central topology errors and keeps airflow not calculated", () => {
  let project = projectWithFloor();
  project = applyCommand(project, { type: "component.add", component: component("zehnder-comfospot-50-decentralised", "cs50-1", 1000, 1000) });
  const audit = auditVentilation(project, "floor-ground");
  assert.equal(audit.topologyCoverage.status, "not-applicable-decentralised-only");
  assert.equal(audit.decentralised.unitCount, 1);
  assert.equal(audit.diagnostics.some((item) => item.code === "topology-not-assessed"), false);
  assert.equal(audit.diagnostics.some((item) => item.code === "outlet-disconnected"), false);
  assert.equal(audit.diagnostics.some((item) => item.code === "decentralised-airflow-not-calculated"), true);
});

test("alternating groups warn softly while continuous-balanced units reject pair references", () => {
  let project = projectWithFloor();
  const lunos = component("lunos-e2-60-decentralised", "lunos-1", 1000, 1000);
  const cs50 = component("zehnder-comfospot-50-decentralised", "cs50-1", 2000, 1000);
  project = applyCommand(project, { type: "component.add", component: lunos });
  project = applyCommand(project, { type: "component.add", component: cs50 });
  project = applyCommand(project, {
    type: "component.setDecentralisedConfiguration",
    componentId: lunos.id,
    roomId: null,
    zoneId: null,
    pairGroupId: "Group A",
    controllerReference: "5/UNI-FT 1",
  });
  const inspection = inspectDecentralisedMvhr(project, "floor-ground");
  assert.equal(inspection.diagnostics.some((item) => item.code === "decentralised-pair-count-review"), true);
  assert.throws(() => applyCommand(project, {
    type: "component.setDecentralisedConfiguration",
    componentId: cs50.id,
    roomId: null,
    zoneId: null,
    pairGroupId: "Not applicable",
    controllerReference: null,
  }), /Continuous-balanced units do not require/);
});

test("parts schedule and A3 export count physical units without adding pair or controller quantities", () => {
  let project = projectWithFloor();
  for (const [index, id] of DECENTRALISED_IDS.entries()) {
    project = applyCommand(project, { type: "component.add", component: component(id, `decentralised-${index + 1}`, 1000 + index * 500, 1000) });
  }
  const schedule = createPartsSchedule(project, { floorId: "floor-ground" });
  assert.equal(schedule.decentralisedSystems.unitCount, 4);
  assert.equal(schedule.componentLines.filter((line) => line.section === "decentralised").reduce((sum, line) => sum + line.quantity, 0), 4);
  assert.equal(schedule.summary.componentQuantity, 4);
  const sheet = createA3SheetModel(project, sheetMetadata());
  const svg = renderA3SheetSvg(sheet);
  assert.match(svg, /data-system="decentralised-mvhr"/);
  assert.match(svg, /Decentralised MVHR/);
});

function component(catalogueItemId, id, xMm, yMm) {
  return createCatalogueComponent(catalogueItemId, { id, floorId: "floor-ground", xMm, yMm });
}

function projectWithFloor() {
  return applyCommand(createProject("project-decentralised-mvhr"), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Ground Floor",
      transform: { translationMm: { x: 0, y: 0, z: knownMm(0, "test datum") }, orientation: identityQuaternion() },
    },
  });
}

function projectWithRoom() {
  let project = applyCommand(projectWithFloor(), {
    type: "wall.addChain",
    floorId: "floor-ground",
    nodeIds: ["node-a", "node-b", "node-c", "node-d", "node-a"],
    wallIds: ["wall-a-b", "wall-b-c", "wall-c-d", "wall-d-a"],
    points: [point(0, 0), point(6000, 0), point(6000, 4000), point(0, 4000), point(0, 0)],
    splits: [],
    thicknessMm: 140,
    heightMm: unknownMm("not measured"),
    referenceLine: "centreline",
    classification: "physical",
  });
  const boundary = deriveRoomBoundaries(project, "floor-ground").candidates[0];
  project = applyCommand(project, {
    type: "room.createFromBoundary",
    roomId: "room-living",
    floorId: "floor-ground",
    boundaryKey: boundary.key,
    name: "Living",
    use: "living",
    ventilationRole: "supply",
  });
  return project;
}

function point(x, y) {
  return { x, y, z: knownMm(0, "test floor") };
}

function sheetMetadata() {
  return {
    floorId: "floor-ground",
    orientation: "landscape",
    includeSchedule: true,
    drawingTitle: "Decentralised MVHR markup",
    projectName: "Synthetic test",
    siteName: "Test site",
    drawingId: "MVHR-001",
    revision: "P01",
    revisionText: "Initial decentralised markup",
    issueDate: "2026-10-30",
    status: "Preliminary — not for construction",
    drawnBy: "Test",
    checkedBy: "",
    company: { companyName: "HiPer Haus", tradingName: "HiPer Haus", website: "https://www.hiperhaus.com.au", email: "", phone: "", addressLines: [] },
    companyLogoDataUrl: null,
  };
}
