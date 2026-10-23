import assert from "node:assert/strict";
import test from "node:test";

import {
  airflowTargetFromInput,
  applyCommand,
  createProject,
  deserializeProject,
  identityQuaternion,
  inspectComponentDeletion,
  knownMm,
  serializeProject,
  unknownMm,
} from "../src/domain/spatial.mjs";
import {
  createEngineeringInputs,
  externalStaticPressureFromInput,
} from "../src/domain/engineering-inputs.mjs";
import { deriveRoomBoundaries } from "../src/domain/rooms.mjs";
import { createCatalogueComponent } from "../src/editor/component-catalogue.mjs";
import { createSyntheticComponent } from "../src/editor/synthetic-catalogue.mjs";
import { createInstallerDocumentFoundation } from "../src/editor/installer-document.mjs";
import { inspectProductCostingReadiness } from "../src/editor/product-costing.mjs";
import { inspectSizingPressureEvidence } from "../src/editor/sizing-pressure-evidence.mjs";

test("schema-17 migration adds empty engineering inputs without changing prior design data", () => {
  const current = balancedProject(350);
  const legacy = structuredClone(current);
  legacy.schemaVersion = 17;
  delete legacy.engineeringInputs;

  const reopened = deserializeProject(JSON.stringify(legacy));
  assert.deepEqual(reopened.engineeringInputs, createEngineeringInputs());
  assert.equal(reopened.rooms.length, current.rooms.length);
  assert.deepEqual(reopened.rooms[0].airflowTargets, current.rooms[0].airflowTargets);
  assert.deepEqual(reopened.quoteSnapshots, current.quoteSnapshots);
  assert.deepEqual(reopened.pdfReferenceAssets, current.pdfReferenceAssets);
});

test("Q350 screening matches only an exact sourced operating point and never becomes a network pressure result", () => {
  let project = addQ350(balancedProject(350));
  project = setDuty(project, 200);

  const inspection = inspectSizingPressureEvidence(project, "floor-ground");
  assert.equal(inspection.assignedFlow.unitDutyAirflowM3h, 350);
  assert.equal(inspection.unitPerformance.status, "source-statement-alignment-review-required");
  assert.equal(inspection.unitPerformance.matchedPoint.airflowM3h, 350);
  assert.equal(inspection.unitPerformance.matchedPoint.externalStaticPressurePa, 200);
  assert.equal(inspection.unitPerformance.matchedPoint.sourcePage, 2);
  assert.deepEqual(inspection.unitPerformance.manufacturerEvidence.source.pages, [2, 7]);
  assert.deepEqual(inspection.unitPerformance.manufacturerEvidence.applicableManufacturerArticles, ["471502110"]);
  assert.equal(inspection.unitPerformance.manufacturerEvidence.publishedOperatingPoints[1].sourcePage, 7);
  assert.equal(inspection.unitPerformance.manufacturerEvidence.soundMeasurementOperatingPoints.sourcePage, 8);
  assert.equal(inspection.unitPerformance.manufacturerEvidence.soundMeasurementOperatingPoints.airflowAndExternalPressure.length, 10);
  assert.equal(inspection.unitPerformance.manufacturerEvidence.soundMeasurementOperatingPoints.fanCurveUse, "blocked");
  assert.match(inspection.unitPerformance.manufacturerEvidence.soundMeasurementOperatingPoints.note, /acoustic measurement.*not.*fan-performance curve/i);
  assert.equal(inspection.networkPressure.calculatedPressureLossPa, null);
  assert.equal(inspection.networkPressure.status, "blocked-no-supported-network-loss-method");
  assert.match(inspection.evidenceBoundary, /does not solve pressure.*cannot interpolate a fan curve/i);
  assert.match(inspection.evidenceBoundary, /manual assigned room-target total.*not measured flow/i);
});

test("Q350 enthalpy article does not inherit the sensible article endpoint statement", () => {
  let project = addQ350(balancedProject(350), "zehnder-q350-erv-left-drawing-profile");
  project = setDuty(project, 200);

  const inspection = inspectSizingPressureEvidence(project, "floor-ground");
  assert.equal(inspection.unitPerformance.unit.manufacturerArticle, "471502111");
  assert.equal(inspection.unitPerformance.status, "blocked-no-reviewed-performance-evidence");
  assert.equal(
    inspection.unitPerformance.manufacturerEvidence.excludedManufacturerArticles[0].manufacturerArticle,
    "471502111",
  );
  assert.match(inspection.unitPerformance.blockers[0], /no reviewed manufacturer performance evidence/i);
});

test("above-maximum and intermediate Q350 duties remain blocked for distinct evidence reasons", () => {
  let above = addQ350(balancedProject(360));
  above = setDuty(above, 200);
  assert.equal(
    inspectSizingPressureEvidence(above, "floor-ground").unitPerformance.status,
    "blocked-above-published-maximum-airflow",
  );

  let intermediate = addQ350(balancedProject(200));
  intermediate = setDuty(intermediate, 100);
  const inspection = inspectSizingPressureEvidence(intermediate, "floor-ground");
  assert.equal(inspection.unitPerformance.status, "blocked-fan-curve-required");
  assert.match(inspection.unitPerformance.blockers[0], /checked fan curve.*interpolation/i);
});

test("duty input preserves Pa convention, basis, source and filter condition through save and reopen", () => {
  let project = addQ350(balancedProject(200));
  project = setDuty(project, 100);
  const reopened = deserializeProject(serializeProject(project));
  assert.deepEqual(reopened.engineeringInputs, project.engineeringInputs);
  const pressure = reopened.engineeringInputs.floorDuties[0].externalStaticPressure;
  assert.equal(pressure.inputUnit, "Pa");
  assert.equal(pressure.pressureConvention, "external-static");
  assert.equal(pressure.basis, "External design duty supplied by engineer");
  assert.equal(pressure.source, "Engineer note P-01");
  assert.equal(pressure.filterCondition, "Clean filters");

  const forged = structuredClone(project);
  forged.engineeringInputs.floorDuties[0].externalStaticPressure.valuePa = 999;
  assert.throws(() => serializeProject(forged), /canonical Pa value/);

  project = applyCommand(project, {
    type: "component.delete",
    componentId: "q350-unit",
    confirmedScope: inspectComponentDeletion(project, "q350-unit"),
  });
  assert.equal(project.engineeringInputs.floorDuties[0].unitComponentId, null);
  assert.equal(project.engineeringInputs.floorDuties[0].externalStaticPressure.valuePa, 100);
});

test("product costing stays unpriced and installer measurements stay blank", () => {
  let project = addQ350(balancedProject(200));
  project = setDuty(project, 100);
  project = addAndAssignTerminal(project, "supply-terminal", "synthetic-supply-terminal", "room-supply", 2000, 2000);
  project = addAndAssignTerminal(project, "extract-terminal", "synthetic-extract-terminal", "room-extract", 6000, 2000);

  const costing = inspectProductCostingReadiness(project, "floor-ground");
  assert.equal(costing.state, "unpriced-foundation");
  assert.equal(costing.summary.pricedLineCount, 0);
  assert.equal(costing.summary.total, null);
  assert.equal(costing.lines.every((line) => line.price === null), true);
  assert.match(costing.evidenceBoundary, /Unknown prices remain null, not zero/);

  const installer = createInstallerDocumentFoundation(project, "floor-ground");
  assert.equal(installer.status, "working-draft-incomplete");
  assert.equal(installer.sourceDesignSnapshotId, null);
  assert.equal(installer.commissioningRows.length, 2);
  assert.equal(installer.commissioningRows.every((row) => row.measuredNormalAirflow === null), true);
  assert.equal(installer.commissioningRows.every((row) => row.measuredBoostAirflow === null), true);
  assert.equal(installer.airflowSchedule.every((row) => row.predicted === null && row.measured === null), true);
  assert.match(installer.evidenceBoundary, /not an issued installer document/i);
});

function setDuty(project, pressurePa) {
  return applyCommand(project, {
    type: "engineering.setFloorDuty",
    duty: {
      floorId: "floor-ground",
      mode: "normal",
      unitComponentId: "q350-unit",
      externalStaticPressure: externalStaticPressureFromInput(
        pressurePa,
        "External design duty supplied by engineer",
        "Engineer note P-01",
        "Clean filters",
      ),
    },
  });
}

function addQ350(project, catalogueId = "zehnder-q350-hrv-left-drawing-profile") {
  return applyCommand(project, {
    type: "component.add",
    component: createCatalogueComponent(catalogueId, {
      id: "q350-unit",
      floorId: "floor-ground",
      xMm: 4000,
      yMm: 5000,
    }),
  });
}

function balancedProject(airflowM3h) {
  let project = applyCommand(createProject("project-engineering-foundation"), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "engineering test datum") },
        orientation: identityQuaternion(),
      },
    },
  });
  project = applyCommand(project, wallChain(
    ["node-a", "node-b", "node-c", "node-d", "node-a"],
    ["wall-a-b", "wall-b-c", "wall-c-d", "wall-d-a"],
    [point(0, 0), point(4000, 0), point(4000, 4000), point(0, 4000), point(0, 0)],
  ));
  project = applyCommand(project, wallChain(
    ["node-b", "node-e", "node-f", "node-c"],
    ["wall-b-e", "wall-e-f", "wall-f-c"],
    [point(4000, 0), point(8000, 0), point(8000, 4000), point(4000, 4000)],
  ));
  const candidates = deriveRoomBoundaries(project, "floor-ground").candidates;
  project = createRoom(project, "room-supply", "Supply room", "supply", candidates.find((item) => item.centroidMm.x < 4000).key, airflowM3h);
  project = createRoom(project, "room-extract", "Extract room", "extract", candidates.find((item) => item.centroidMm.x > 4000).key, airflowM3h);
  return project;
}

function createRoom(project, roomId, name, role, boundaryKey, airflowM3h) {
  const target = airflowTargetFromInput(airflowM3h, "m3/h", "Explicit engineering test target", "Test schedule A");
  return applyCommand(project, {
    type: "room.createFromBoundary",
    roomId,
    floorId: "floor-ground",
    boundaryKey,
    name,
    use: role === "supply" ? "bedroom" : "bathroom",
    ventilationRole: role,
    airflowTargets: { normal: { required: target, assigned: target } },
  });
}

function addAndAssignTerminal(project, id, catalogueId, roomId, xMm, yMm) {
  const terminal = createSyntheticComponent(catalogueId, { id, floorId: "floor-ground", xMm, yMm });
  project = applyCommand(project, { type: "component.add", component: terminal });
  return applyCommand(project, {
    type: "terminal.assignRoom",
    roomId,
    componentId: terminal.id,
    portId: terminal.ports[0].id,
  });
}

function wallChain(nodeIds, wallIds, points) {
  return {
    type: "wall.addChain",
    floorId: "floor-ground",
    nodeIds,
    wallIds,
    points,
    splits: [],
    thicknessMm: 140,
    heightMm: unknownMm("not measured"),
    referenceLine: "centreline",
    classification: "physical",
  };
}

function point(x, y) {
  return { x, y, z: unknownMm("not measured") };
}
