import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  createProject,
  deserializeProject,
  identityQuaternion,
  knownMm,
  serializeProject,
} from "../src/domain/spatial.mjs";
import {
  COMFOWELL_320_ARTICLE_EVIDENCE,
  createCatalogueComponent,
  routeFamilyForKind,
} from "../src/editor/component-catalogue.mjs";
import { createEquipmentAssembly } from "../src/editor/equipment-assemblies.mjs";
import { createPartsSchedule } from "../src/editor/parts-schedule.mjs";

test("schedule distinguishes exact placed counts from provisional product evidence", () => {
  let project = projectWithFloor();
  project = addCatalogueComponent(project, "synthetic-supply-terminal", "terminal-a", 1000, 1000);
  project = addCatalogueComponent(project, "synthetic-supply-terminal", "terminal-b", 2000, 1000);
  project = addCatalogueComponent(project, "zehnder-q350-hrv-left-drawing-profile", "q350", 3000, 1000);
  const original = structuredClone(project);

  const schedule = createPartsSchedule(project, { floorId: "floor-ground" });
  const terminalLine = schedule.componentLines.find((line) => line.description === "Generic supply terminal");
  const q350Line = schedule.componentLines.find((line) => line.componentIds.includes("q350"));

  assert.equal(schedule.summary.componentQuantity, 3);
  assert.equal(schedule.summary.verifiedComponentQuantity, 0);
  assert.equal(schedule.summary.sourceBackedProvisionalQuantity, 1);
  assert.equal(schedule.summary.unmatchedProvisionalQuantity, 2);
  assert.equal(terminalLine.quantity, 2);
  assert.equal(terminalLine.evidenceClass, "unmatched-provisional");
  assert.equal(q350Line.evidenceClass, "source-backed-provisional");
  assert.equal(q350Line.manufacturerArticle, "471502110");
  assert.match(q350Line.evidenceNote, /crosswalk|compatibility/i);
  assert.equal(schedule.unresolved.some((item) => item.ref === terminalLine.ref), true);
  assert.equal(Object.isFrozen(schedule), true);
  assert.deepEqual(project, original);
});

test("official ComfoWell article identities stay separate from Australian and compatibility status", () => {
  assert.deepEqual(
    COMFOWELL_320_ARTICLE_EVIDENCE.map((item) => item.manufacturerArticle),
    ["990323644", "990323501", "990323613", "990323512"],
  );
  for (const item of COMFOWELL_320_ARTICLE_EVIDENCE) {
    assert.equal(item.manufacturerIdentityStatus, "verified-official-manufacturer-source");
    assert.equal(item.localSkuCrosswalkStatus, "unverified");
    assert.equal(item.australianAvailabilityStatus, "unverified");
    assert.notEqual(item.installationCompatibilityStatus, "verified");
  }
});

test("generic remote assembly constituents are counted once and only reference CW products", () => {
  let project = projectWithFloor();
  const assembly = createEquipmentAssembly("generic-remote-supply-attenuation-set", {
    id: "supply-group",
    floorId: "floor-ground",
    xMm: 3000,
    yMm: 2000,
  });
  project = applyCommand(project, { type: "equipmentAssembly.add", ...assembly });

  const schedule = createPartsSchedule(project, { floorId: "floor-ground" });
  assert.equal(schedule.summary.componentQuantity, 3);
  assert.equal(schedule.summary.assemblyGroupCount, 1);
  assert.equal(schedule.componentLines.reduce((sum, line) => sum + line.groupedQuantity, 0), 3);
  assert.equal(schedule.componentLines.every((line) => line.quantity === 1), true);
  assert.equal(schedule.componentLines.every((line) => line.referenceCandidate?.status === "reference-only-not-a-match"), true);
  assert.deepEqual(
    schedule.componentLines.map((line) => line.referenceCandidate.manufacturerArticle).sort(),
    ["990323501", "990323512", "990323613"],
  );
  assert.equal(schedule.unresolved.filter((item) => item.code === "reference-candidate-not-selected").length, 3);
});

test("route schedule multiplies Single and Twin saved centrelines while preserving unset quantity", () => {
  let project = projectWithFloor();
  project = addRoute(project, "single", 1000, 1);
  project = addRoute(project, "twin", 2000, 2);
  project = addRoute(project, "unset", 3000, null);

  const schedule = createPartsSchedule(project, { floorId: "floor-ground" });
  const line = schedule.routeLines[0];
  assert.equal(line.routeCount, 3);
  assert.equal(line.savedCentrelinePlanMm, 6000);
  assert.equal(line.knownMultipliedPlanMm, 5000);
  assert.equal(line.arrangements.single.routeCount, 1);
  assert.equal(line.arrangements.twin.routeCount, 1);
  assert.equal(line.arrangements.unset.routeCount, 1);
  assert.equal(line.pendingParallelRunRouteCount, 1);
  assert.equal(line.pendingParallelRunCentrelineMm, 3000);
  assert.equal(line.knownMultipliedDevelopedMm, 5000);
  assert.equal(line.developedQuantityMm, null);
  assert.equal(line.developedQuantityState, "incomplete");
  assert.match(schedule.lengthBasis, /saved route control-polyline centreline/i);
  assert.match(schedule.lengthBasis, /display sweeps.*excluded/i);
});

test("schedule is deterministic through canonical save and reopen", () => {
  let project = projectWithFloor();
  project = addCatalogueComponent(project, "synthetic-extract-terminal", "terminal", 1000, 1000);
  project = addRoute(project, "extract-twin", 2750, 2, "extract");
  const expected = createPartsSchedule(project, { floorId: "floor-ground" });

  const reopened = deserializeProject(serializeProject(project));
  assert.deepEqual(createPartsSchedule(reopened, { floorId: "floor-ground" }), expected);
});

function projectWithFloor() {
  return applyCommand(createProject("project-parts-schedule"), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "parts schedule test datum") },
        orientation: identityQuaternion(),
      },
    },
  });
}

function addCatalogueComponent(project, catalogueItemId, id, xMm, yMm) {
  return applyCommand(project, {
    type: "component.add",
    component: createCatalogueComponent(catalogueItemId, {
      id,
      floorId: "floor-ground",
      xMm,
      yMm,
    }),
  });
}

function addRoute(project, id, lengthMm, parallelRunCount, stream = "supply") {
  const family = routeFamilyForKind("semi-rigid-radial");
  return applyCommand(project, {
    type: "route.add",
    route: {
      id,
      floorId: "floor-ground",
      system: "mvhr",
      stream,
      role: stream === "supply" ? "Dwelling supply" : "Dwelling extract",
      ductKind: family.id,
      connectionInterface: family.connectionInterface,
      parallelRunCount,
      startAttachment: null,
      endAttachment: null,
      points: [
        { x: 0, y: 0, z: knownMm(2500, "synthetic schedule route") },
        { x: lengthMm, y: 0, z: knownMm(2500, "synthetic schedule route") },
      ],
    },
  });
}
