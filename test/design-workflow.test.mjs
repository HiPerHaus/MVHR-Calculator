import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  createProject,
  deserializeProject,
  identityQuaternion,
  knownMm,
  serializeProject,
  terminalRoomAssignment,
  unknownMm,
} from "../src/domain/spatial.mjs";
import {
  inspectDetailedDesign,
  inspectQuickQuote,
} from "../src/domain/design-workflow.mjs";
import { deriveRoomBoundaries } from "../src/domain/rooms.mjs";
import { createCatalogueComponent } from "../src/editor/component-catalogue.mjs";

const SNAPSHOT_TIME = "2026-10-20T12:00:00.000Z";

test("quick quote uses canonical serviced area without requiring rooms and keeps exclusions explicit", () => {
  let project = quotedFloorProject();
  assert.equal(project.rooms.length, 0);
  const inspection = inspectQuickQuote(project);
  assert.equal(inspection.areaM2, 80);
  assert.equal(inspection.spatialReady, true);
  assert.equal(inspection.priced, false);
  assert.equal(inspection.commercial, null);
  assert.deepEqual(project.quoteDraft.scopeExclusions, ["Garage", "Alfresco"]);
  assert.equal(inspection.outlineBasis[0].scaleEvidence, "manual-project-grid");
});

test("plan markup does not request or calculate commercial inputs", () => {
  const project = floorWithOutline();
  const inspection = inspectQuickQuote(project);
  assert.equal(inspection.priced, false);
  assert.equal(inspection.commercial, null);
  assert.deepEqual(inspection.missingCommercialInputs, []);
});

test("quick quote totals the existing floor model without requiring room duplication", () => {
  let project = floorWithOutline();
  project = applyCommand(project, {
    type: "floor.add",
    floor: {
      id: "floor-upper",
      name: "Upper Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(3000, "test upper datum") },
        orientation: identityQuaternion(),
      },
    },
  });
  project = applyCommand(project, {
    type: "floorArea.create",
    outline: {
      id: "serviced-area-upper",
      floorId: "floor-upper",
      name: "Upper serviced area",
      geometrySource: "manual-floor-area-outline",
      purpose: "preliminary-quoting",
      areaConvention: "closed-plan-outline",
      measurementBasis: "floor-local-plan-mm",
      vertices: [vertex("upper-a", 0, 0), vertex("upper-b", 5000, 0), vertex("upper-c", 5000, 4000), vertex("upper-d", 0, 4000)],
      holes: [],
    },
  });
  const inspection = inspectQuickQuote(project);
  assert.equal(inspection.areaM2, 100);
  assert.equal(inspection.outlineBasis.length, 2);
  assert.equal(project.rooms.length, 0);
});

test("conversion is blocked until serviced area and scope review exist", () => {
  let project = applyCommand(projectWithFloor(), { type: "workflow.startPreliminaryLayout" });
  assert.throws(() => applyCommand(project, {
    type: "workflow.convertToProject",
    quoteSnapshotId: "quote-invalid",
    createdAtUtc: SNAPSHOT_TIME,
  }), /closed serviced-area outline, scope exclusions review/);
  assert.equal(project.quoteSnapshots.length, 0);
});

test("preliminary ventilation can exist without rooms and conversion is idempotent", () => {
  let project = quotedFloorProject();
  project = applyCommand(project, { type: "workflow.startPreliminaryLayout" });
  project = applyCommand(project, {
    type: "component.add",
    component: createCatalogueComponent("synthetic-supply-terminal", {
      id: "outlet-preliminary",
      floorId: "floor-ground",
      xMm: 2000,
      yMm: 2000,
    }),
  });
  project = applyCommand(project, {
    type: "component.setDuctRunCount",
    componentId: "outlet-preliminary",
    ductRunCount: 2,
  });
  assert.equal(project.rooms.length, 0);

  const carriedObjects = structuredClone({
    floorAreaOutlines: project.floorAreaOutlines,
    components: project.components,
    equipmentAssemblies: project.equipmentAssemblies,
    routes: project.routes,
    floorReferences: project.floorReferences,
    floorCadReferences: project.floorCadReferences,
  });
  const converted = applyCommand(project, {
    type: "workflow.convertToProject",
    quoteSnapshotId: "quote-baseline-1",
    createdAtUtc: SNAPSHOT_TIME,
  });
  const repeated = applyCommand(converted, {
    type: "workflow.convertToProject",
    quoteSnapshotId: "must-not-be-created",
    createdAtUtc: "2026-10-20T13:00:00.000Z",
  });
  assert.equal(repeated.workflow.stage, "project-converted");
  assert.equal(repeated.quoteSnapshots.length, 1);
  assert.equal(repeated.workflow.convertedQuoteSnapshotId, "quote-baseline-1");
  assert.equal(repeated.quoteSnapshots[0].preliminaryAllowances.outletCount, 1);
  assert.equal(repeated.quoteSnapshots[0].preliminaryAllowances.knownDuctRunCount, 2);
  assert.deepEqual({
    floorAreaOutlines: repeated.floorAreaOutlines,
    components: repeated.components,
    equipmentAssemblies: repeated.equipmentAssemblies,
    routes: repeated.routes,
    floorReferences: repeated.floorReferences,
    floorCadReferences: repeated.floorCadReferences,
  }, carriedObjects);
  assert.deepEqual(repeated, converted);
});

test("conversion preserves its layout baseline while later rooms link existing outlets explicitly", () => {
  let project = quotedFloorProject();
  project = addRectangleWalls(project);
  project = applyCommand(project, { type: "workflow.startPreliminaryLayout" });
  project = applyCommand(project, {
    type: "component.add",
    component: createCatalogueComponent("synthetic-supply-terminal", {
      id: "outlet-existing",
      floorId: "floor-ground",
      xMm: 2000,
      yMm: 2000,
    }),
  });
  project = applyCommand(project, {
    type: "workflow.convertToProject",
    quoteSnapshotId: "quote-baseline-rooms",
    createdAtUtc: SNAPSHOT_TIME,
  });
  const frozenAllowances = structuredClone(project.quoteSnapshots[0].preliminaryAllowances);
  project = applyCommand(project, {
    type: "quote.updateDraft",
    quoteDraft: { ...project.quoteDraft, areaRatePerM2: 999 },
  });
  project = applyCommand(project, { type: "workflow.startDetailedDesign" });
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
  assert.equal(terminalRoomAssignment(project, "outlet-existing"), null);
  project = applyCommand(project, { type: "terminal.assignUnassignedByPosition" });
  assert.equal(terminalRoomAssignment(project, "outlet-existing").roomId, "room-living");
  assert.equal(project.quoteSnapshots[0].commercial, null);
  assert.deepEqual(project.quoteSnapshots[0].preliminaryAllowances, frozenAllowances);

  const review = inspectDetailedDesign(project);
  assert.equal(review.assignedOutletCount, 1);
  assert.equal(review.unassignedOutletCount, 0);
  assert.ok(review.unresolvedRequirements.some((item) => item.includes("airflow")));

  const reopened = deserializeProject(serializeProject(project));
  assert.deepEqual(reopened.workflow, project.workflow);
  assert.deepEqual(reopened.quoteSnapshots, project.quoteSnapshots);
  assert.equal(terminalRoomAssignment(reopened, "outlet-existing").roomId, "room-living");
});

test("a layout baseline cannot be forged into a commercial total", () => {
  let project = quotedFloorProject();
  project = applyCommand(project, { type: "workflow.startPreliminaryLayout" });
  project = applyCommand(project, {
    type: "workflow.convertToProject",
    quoteSnapshotId: "quote-baseline-forgery",
    createdAtUtc: SNAPSHOT_TIME,
  });
  const forged = structuredClone(project);
  forged.quoteSnapshots[0].commercial = {
    currency: "NZD", areaSubtotal: 1, fixedAllowance: 0, subtotalBeforeMarkup: 1,
    markupPercent: 0, markupAmount: 0, total: 1,
  };
  assert.throws(() => serializeProject(forged), /Layout baseline cannot introduce a commercial total/);
});

test("schema-14 room designs migrate to detailed design without invented quote data", () => {
  let project = addRectangleWalls(floorWithOutline());
  const boundary = deriveRoomBoundaries(project, "floor-ground").candidates[0];
  project = applyCommand(project, {
    type: "room.createFromBoundary",
    roomId: "room-legacy",
    floorId: "floor-ground",
    boundaryKey: boundary.key,
    name: "Legacy living room",
    use: "living",
    ventilationRole: "supply",
  });
  const expectedRooms = structuredClone(project.rooms);
  const legacy = structuredClone(project);
  legacy.schemaVersion = 14;
  delete legacy.workflow;
  delete legacy.quoteDraft;
  delete legacy.quoteSnapshots;
  const migrated = deserializeProject(JSON.stringify(legacy));
  assert.equal(migrated.workflow.stage, "detailed-design");
  assert.equal(migrated.workflow.convertedQuoteSnapshotId, null);
  assert.deepEqual(migrated.quoteSnapshots, []);
  assert.deepEqual(migrated.rooms, expectedRooms);
});

function quotedFloorProject() {
  return applyCommand(floorWithOutline(), {
    type: "quote.updateDraft",
    quoteDraft: {
      currency: "NZD",
      areaRatePerM2: 100,
      fixedAllowance: 1200,
      markupPercent: 10,
      scopeExclusions: ["Garage", "Alfresco"],
      scopeReviewed: true,
    },
  });
}

function floorWithOutline() {
  let project = projectWithFloor();
  project = applyCommand(project, {
    type: "floorArea.create",
    outline: {
      id: "serviced-area-ground",
      floorId: "floor-ground",
      name: "Serviced area excluding garage and alfresco",
      geometrySource: "manual-floor-area-outline",
      purpose: "preliminary-quoting",
      areaConvention: "closed-plan-outline",
      measurementBasis: "floor-local-plan-mm",
      vertices: [
        vertex("a", 0, 0),
        vertex("b", 10000, 0),
        vertex("c", 10000, 8000),
        vertex("d", 0, 8000),
      ],
      holes: [],
    },
  });
  return project;
}

function projectWithFloor() {
  return applyCommand(createProject("project-quote-workflow"), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "test datum") },
        orientation: identityQuaternion(),
      },
    },
  });
}

function addRectangleWalls(project) {
  return applyCommand(project, {
    type: "wall.addChain",
    floorId: "floor-ground",
    nodeIds: ["node-a", "node-b", "node-c", "node-d", "node-a"],
    wallIds: ["wall-a", "wall-b", "wall-c", "wall-d"],
    points: [point(0, 0), point(10000, 0), point(10000, 8000), point(0, 8000), point(0, 0)],
    splits: [],
    thicknessMm: 140,
    heightMm: unknownMm("not measured"),
    referenceLine: "centreline",
    classification: "physical",
  });
}

function vertex(id, x, y) {
  return { id: `area-${id}`, positionMm: { x, y, z: knownMm(0, "test floor plan") } };
}

function point(x, y) {
  return { x, y, z: unknownMm("not measured") };
}
