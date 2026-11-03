import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  createProject,
  deserializeProject,
  identityQuaternion,
  inspectComponentDeletion,
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
import {
  decentralisedControllerElectricalConnection,
  decentralisedControllerTypeLabel,
  inspectDecentralisedMvhr,
} from "../src/editor/decentralised-mvhr.mjs";
import {
  createCommandHistory,
  executeCommand,
  redoCommand,
  undoCommand,
} from "../src/domain/history.mjs";
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

test("controller markers and cable routes survive move rotate edit save and option duplication", () => {
  let project = projectWithFloor();
  const unit = component("aerofresh-30-compact-decentralised", "unit-a", 1200, 1200);
  const controller = component("aerofresh-smove-controller-decentralised", "controller-a", 2600, 1800);
  project = applyCommand(project, { type: "component.add", component: unit });
  project = applyCommand(project, { type: "component.add", component: controller });
  assert.equal(project.components.find(item => item.id === unit.id).decentralisedMvhr.markupId, "D1");
  assert.equal(project.components.find(item => item.id === controller.id).decentralisedController.markupId, "C1");
  project = applyCommand(project, { type: "decentralisedCable.add", cable: {
    id: "cable-a", floorId: "floor-ground", controllerId: controller.id, unitComponentId: unit.id,
    cableKind: "combined-power-control", topologyStatus: "verified-synchronised-pairs", maximumRouteLengthMm: null,
    specification: { status: "candidate-manual-mirror", label: "LiYY 3 × 0.75 mm² stranded · 6–16 VDC power/control", source: "manual mirror candidate" },
    points: [{ x: 2600, y: 1800 }, { x: 1200, y: 1200 }],
  } });
  project = applyCommand(project, { type: "decentralisedCable.insertPoint", cableId: "cable-a", segmentIndex: 0, point: { x: 2100, y: 1450 } });
  project = applyCommand(project, { type: "decentralisedCable.movePoint", cableId: "cable-a", pointIndex: 1, point: { x: 2100, y: 1600 } });
  project = applyCommand(project, { type: "component.moveXY", componentId: controller.id, xMm: 2800, yMm: 1900 });
  project = applyCommand(project, { type: "component.rotateFloorZ", componentId: controller.id, angleRad: Math.PI / 2 });
  assert.deepEqual(project.decentralisedCables[0].points[0], { x: 2800, y: 1900 });
  assert.deepEqual(project.decentralisedCables[0].points.at(-1), { x: 1200, y: 1200 });
  const reopened = deserializeProject(serializeProject(project));
  assert.deepEqual(reopened.decentralisedCables, project.decentralisedCables);
  const schedule = createPartsSchedule(reopened, { floorId: "floor-ground" });
  assert.equal(schedule.decentralisedCableLines.length, 1);
  assert.equal(schedule.decentralisedCableLines[0].lengthStatus, "plan-route-only-elevation-and-slack-excluded");
  assert.equal(schedule.decentralisedCableLines[0].displayCableType, "LiYY 3 × 0.75 mm² or equivalent");
  assert.equal(schedule.decentralisedCableLines[0].specification.label, "LiYY 3 × 0.75 mm² stranded · 6–16 VDC power/control");
  const svg = renderA3SheetSvg(createA3SheetModel(reopened, sheetMetadata()));
  assert.match(svg, /data-system="decentralised-controller"/);
  assert.match(svg, /data-kind="decentralised-cable"/);
  assert.match(svg, />D1<|>C1</);
  assert.match(svg, /Controller Cable - LiYY 3 × 0\.75 mm² or equivalent/);
  assert.match(svg, /Decentralised MVHR - AeroFresh 30 Compact/);
  assert.match(svg, /Controller - sMove/);
  assert.match(svg, /ELECTRICAL CONNECTION · PRELIMINARY/);
  assert.match(svg, /230 V to controller location/);
  assert.match(svg, /manufacturer-authored-mirror-original-unverified/);
  assert.doesNotMatch(svg, /C1 sMove\) —|controller\/PSU arrangement|exact arrangement manual-required|via specified separate PSU|Do not connect a fan directly to 230 V|LV\/control -|Topology -|Terminals -|Evidence -|Source -|Limit -/);

  const duplicated = applyCommand(reopened, { type: "designOption.duplicate", id: "option-copy", name: "Option copy", revision: "B", copyScopes: ["markup"], activate: true });
  assert.equal(duplicated.decentralisedCables.length, 1);
  assert.notEqual(duplicated.decentralisedCables[0].id, "cable-a");
  assert.ok(duplicated.components.some(item => item.decentralisedController?.markupId === "C1"));
});

test("deleting a decentralised unit closes visible numbering gaps without changing stable links or other options", () => {
  let project = projectWithFloor();
  const first = component("aerofresh-30-compact-decentralised", "stable-unit-first", 1000, 1000);
  const middle = component("lunos-e2-60-decentralised", "stable-unit-middle", 2000, 1000);
  const last = component("zehnder-comfospot-50-decentralised", "stable-unit-last", 3000, 1000);
  const controller = component("manual-decentralised-controller", "stable-controller", 4000, 1000);
  for (const item of [first, middle, last, controller]) project = applyCommand(project, { type: "component.add", component: item });
  project = applyCommand(project, { type: "decentralisedCable.add", cable: {
    id: "stable-cable", floorId: "floor-ground", controllerId: controller.id, unitComponentId: last.id,
    cableKind: "unspecified", topologyStatus: "unverified-model-specific", maximumRouteLengthMm: null,
    specification: { status: "unverified-manual-input", label: null, source: null },
    points: [{ x: 4000, y: 1000 }, { x: 3000, y: 1000 }],
  } });
  project = applyCommand(project, { type: "designOption.duplicate", id: "option-delete-test", name: "Deletion test", revision: "B", copyScopes: ["markup"], activate: true });
  const optionUnitIds = project.components.filter((item) => item.decentralisedMvhr).map((item) => item.id);
  const [optionFirstId, optionMiddleId, optionLastId] = optionUnitIds;
  const optionControllerId = project.components.find((item) => item.decentralisedController).id;
  const optionCableId = project.decentralisedCables[0].id;
  const beforeDelete = structuredClone(project);
  const deletion = inspectComponentDeletion(project, optionMiddleId);
  let history = executeCommand(createCommandHistory(project), {
    type: "component.delete",
    componentId: optionMiddleId,
    confirmedScope: deletion,
  });

  assert.deepEqual(history.present.components.filter((item) => item.decentralisedMvhr).map((item) => ({ id: item.id, markupId: item.decentralisedMvhr.markupId })), [
    { id: optionFirstId, markupId: "D1" },
    { id: optionLastId, markupId: "D2" },
  ]);
  assert.deepEqual(history.present.decentralisedCables.map((cable) => ({ id: cable.id, controllerId: cable.controllerId, unitComponentId: cable.unitComponentId })), [
    { id: optionCableId, controllerId: optionControllerId, unitComponentId: optionLastId },
  ]);
  const sheet = createA3SheetModel(history.present, sheetMetadata());
  const legendLabels = sheet.printScene.legend.map((entry) => entry.label);
  assert.equal(legendLabels.includes("Decentralised MVHR - AeroFresh 30 Compact"), true);
  assert.equal(legendLabels.includes("Decentralised MVHR - ComfoSpot 50"), true);
  assert.equal(legendLabels.includes("Decentralised MVHR - LUNOS e²60"), false);
  assert.equal(sheet.printScene.electricalConnections.some((entry) => entry.unitMarkupIds.includes("D2")), true);
  const svg = renderA3SheetSvg(sheet);
  assert.match(svg, new RegExp(`data-id="${optionLastId}" data-markup-id="D2"`));
  assert.doesNotMatch(svg, /data-markup-id="D3"/);
  const schedule = createPartsSchedule(history.present, { floorId: "floor-ground" });
  assert.equal(schedule.decentralisedSystems.unitCount, 2);
  assert.deepEqual(schedule.decentralisedSystems.cableRoutes.map((cable) => cable.unitComponentId), [optionLastId]);

  history = undoCommand(history);
  assert.deepEqual(history.present, beforeDelete);
  history = redoCommand(history);
  assert.deepEqual(history.present.components.filter((item) => item.decentralisedMvhr).map((item) => item.decentralisedMvhr.markupId), ["D1", "D2"]);
  const reopened = deserializeProject(serializeProject(history.present));
  assert.deepEqual(reopened.components.filter((item) => item.decentralisedMvhr).map((item) => item.decentralisedMvhr.markupId), ["D1", "D2"]);
  assert.equal(reopened.decentralisedCables[0].unitComponentId, optionLastId);

  const originalOptionId = reopened.designOptions.find((option) => option.id !== "option-delete-test").id;
  const original = applyCommand(reopened, { type: "designOption.switch", optionId: originalOptionId });
  assert.deepEqual(original.components.filter((item) => item.decentralisedMvhr).map((item) => ({ id: item.id, markupId: item.decentralisedMvhr.markupId })), [
    { id: first.id, markupId: "D1" },
    { id: middle.id, markupId: "D2" },
    { id: last.id, markupId: "D3" },
  ]);
});

test("deletion normalises legacy decentralised number gaps before assigning the next unit number", () => {
  let project = projectWithFloor();
  const first = component("aerofresh-30-compact-decentralised", "legacy-unit-first", 1000, 1000);
  const middle = component("lunos-e2-60-decentralised", "legacy-unit-middle", 2000, 1000);
  const last = component("zehnder-comfospot-50-decentralised", "legacy-unit-last", 3000, 1000);
  for (const item of [first, middle, last]) project = applyCommand(project, { type: "component.add", component: item });
  project.components.find((item) => item.id === middle.id).decentralisedMvhr.markupId = "D4";
  project.components.find((item) => item.id === last.id).decentralisedMvhr.markupId = "D9";
  project = deserializeProject(serializeProject(project));
  const deletion = inspectComponentDeletion(project, middle.id);
  project = applyCommand(project, { type: "component.delete", componentId: middle.id, confirmedScope: deletion });
  assert.deepEqual(project.components.filter((item) => item.decentralisedMvhr).map((item) => item.decentralisedMvhr.markupId), ["D1", "D2"]);
  const added = component("zehnder-comfoair-70-decentralised", "legacy-unit-added", 4000, 1000);
  project = applyCommand(project, { type: "component.add", component: added });
  assert.equal(project.components.find((item) => item.id === added.id).decentralisedMvhr.markupId, "D3");
});

test("drawing key and electrical note list actual mixed models, cable types and verified LUNOS detail", () => {
  let project = projectWithFloor();
  const aero = component("aerofresh-30-compact-decentralised", "aero-unit", 1000, 1000);
  const smove = component("aerofresh-smove-controller-decentralised", "smove-controller", 1800, 1000);
  const lunos = component("lunos-e2-60-decentralised", "lunos-unit", 1000, 2400);
  const lunosController = component("lunos-5-sc-ft-controller-decentralised", "lunos-controller", 1800, 2400);
  for (const item of [aero, smove, lunos, lunosController]) project = applyCommand(project, { type: "component.add", component: item });
  project = applyCommand(project, { type: "decentralisedCable.add", cable: {
    id: "aero-cable", floorId: "floor-ground", controllerId: smove.id, unitComponentId: aero.id,
    cableKind: "combined-power-control", topologyStatus: "verified-synchronised-pairs", maximumRouteLengthMm: null,
    specification: { status: "candidate-manual-mirror", label: "LiYY 3 × 0.75 mm² stranded", source: "INST-AEROFRESH30 V1 pp6, 21–22 · manufacturer-authored mirror; original host not retrieved" },
    points: [{ x: 1800, y: 1000 }, { x: 1000, y: 1000 }],
  } });
  project = applyCommand(project, { type: "decentralisedCable.add", cable: {
    id: "lunos-cable", floorId: "floor-ground", controllerId: lunosController.id, unitComponentId: lunos.id,
    cableKind: "control-interconnect", topologyStatus: "verified-star-individual-runs", maximumRouteLengthMm: null,
    specification: { status: "verified-manufacturer", label: "J-Y(St)Y (2x2x0.8)", source: "LUNOS E474 09.23 pp1, 3" },
    points: [{ x: 1800, y: 2400 }, { x: 1000, y: 2400 }],
  } });
  const sheet = createA3SheetModel(project, sheetMetadata());
  const labels = sheet.printScene.legend.map((entry) => entry.label);
  assert.equal(labels.filter((label) => label === "Decentralised MVHR - AeroFresh 30 Compact").length, 1);
  assert.equal(labels.filter((label) => label === "Decentralised MVHR - LUNOS e²60").length, 1);
  assert.equal(labels.filter((label) => label === "Controller - sMove").length, 1);
  assert.equal(labels.filter((label) => label === "Controller - 5/SC-FT SmartComfort").length, 1);
  assert.equal(labels.filter((label) => label.startsWith("Controller Cable - ")).length, 2);
  assert.equal(labels.includes("Controller Cable - LiYY 3 × 0.75 mm² or equivalent"), true);
  assert.equal(labels.some((label) => /schematic location marker|electrical design status shown/u.test(label)), false);
  const lunosConnection = sheet.printScene.electricalConnections.find((connection) => connection.controllerId === lunosController.id);
  assert.equal(lunosConnection.topology, "Individual star runs from controller to fan; loop-through is prohibited.");
  assert.equal(lunosConnection.terminals, "+, −, S1/S2 at the fan circuit; diagram orientation remains governed by the cited current manual");
  assert.match(lunosConnection.mains, /Separate 230 V mains PSU/);
  assert.match(lunosConnection.limitations, /No verified maximum fan-cable length is stored/);
  const svg = renderA3SheetSvg(sheet);
  assert.match(svg, /data-layout="single-column"/);
  assert.match(svg, /230 V to controller location/);
  assert.match(svg, /manufacturer-authored-mirror-original-unverified/);
  assert.match(svg, /verified-manufacturer/);
  assert.doesNotMatch(svg, /C2 5\/SC-FT SmartComfort\) —|controller\/PSU arrangement|exact arrangement manual-required|via specified separate PSU|Individual star runs from controller to fan|Terminals -|Separate 230 V mains PSU|LV\/control -|Topology -|Evidence -|Source -|Limit -/);
});

test("manual controller and unconnected units print manual-required electrical placeholders", () => {
  let project = projectWithFloor();
  const unit = component("lunos-e2-60-decentralised", "unit-manual", 1000, 1000);
  const manual = component("manual-decentralised-controller", "controller-manual", 1800, 1000);
  project = applyCommand(project, { type: "component.add", component: unit });
  project = applyCommand(project, { type: "component.add", component: manual });
  project = applyCommand(project, { type: "decentralisedCable.add", cable: {
    id: "manual-cable", floorId: "floor-ground", controllerId: manual.id, unitComponentId: unit.id,
    cableKind: "unspecified", topologyStatus: "unverified-model-specific", maximumRouteLengthMm: null,
    specification: { status: "unverified-manual-input", label: null, source: null },
    points: [{ x: 1800, y: 1000 }, { x: 1000, y: 1000 }],
  } });
  project = applyCommand(project, { type: "component.add", component: component("zehnder-comfospot-50-decentralised", "unit-unconnected", 3000, 1000) });
  const sheet = createA3SheetModel(deserializeProject(serializeProject(project)), sheetMetadata());
  const svg = renderA3SheetSvg(sheet);
  assert.match(svg, /Controller Cable - Type unverified\/manual required/);
  assert.match(svg, /Controller - Type unverified\/manual required/);
  assert.match(svg, /230 V to controller location/);
  assert.doesNotMatch(svg, /controller\/PSU arrangement|exact arrangement manual-required|via specified separate PSU|No model-specific manual recorded|Integrated controller · connection detail not stored|Connection not marked/);
  const manualConnection = sheet.printScene.electricalConnections.find((connection) => connection.controllerId === manual.id);
  assert.match(manualConnection.limitations, /Do not use this placeholder as installation wiring guidance/);
});

test("older pinned controller snapshots do not silently inherit newer electrical evidence", () => {
  const controller = structuredClone(component("lunos-5-sc-ft-controller-decentralised", "legacy-controller", 1000, 1000));
  delete controller.catalogueSnapshot.decentralisedControllerSpecification.typeLabel;
  delete controller.catalogueSnapshot.decentralisedControllerSpecification.electricalConnection;
  assert.equal(decentralisedControllerTypeLabel(controller), "5/SC-FT SmartComfort control");
  assert.deepEqual(decentralisedControllerElectricalConnection(controller), {
    evidenceStatus: "unverified-manual-required",
    sourceRevision: "Pinned controller record does not contain model-specific electrical connection evidence",
    lowVoltage: "Unknown — current model-specific manual required",
    mains: "Unknown — electrician to confirm supply, PSU, protection and isolation requirements",
    topology: "Unknown — no wiring topology or terminal mapping inferred",
    terminals: null,
    limitations: "Do not use this placeholder as installation wiring guidance.",
  });
});

test("verified controller compatibility is enforced while manual controller remains explicitly unverified", () => {
  let project = projectWithFloor();
  const lunos = component("lunos-e2-60-decentralised", "lunos-unit", 1200, 1200);
  const smove = component("aerofresh-smove-controller-decentralised", "smove", 2500, 1200);
  const manual = component("manual-decentralised-controller", "manual-controller", 2500, 2200);
  for (const item of [lunos, smove, manual]) project = applyCommand(project, { type: "component.add", component: item });
  const cable = controllerId => ({ id: `cable-${controllerId}`, floorId: "floor-ground", controllerId, unitComponentId: lunos.id, cableKind: "unspecified", topologyStatus: "unverified-model-specific", maximumRouteLengthMm: null, specification: { status: "unverified-manual-input", label: null, source: null }, points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] });
  assert.throws(() => applyCommand(project, { type: "decentralisedCable.add", cable: cable(smove.id) }), /not verified/);
  project = applyCommand(project, { type: "decentralisedCable.add", cable: cable(manual.id) });
  const inspection = inspectDecentralisedMvhr(project, "floor-ground");
  assert.equal(inspection.diagnostics.some(item => item.code === "decentralised-controller-model-unverified"), true);
  const deletion = inspectComponentDeletion(project, manual.id);
  assert.deepEqual(deletion.decentralisedCableIds, ["cable-manual-controller"]);
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
