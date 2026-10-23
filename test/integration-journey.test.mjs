import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
import {
  createCommandHistory,
  executeCommand,
  redoCommand,
  undoCommand,
} from "../src/domain/history.mjs";
import {
  activateMechanicalTool,
  cancelMechanicalOperation,
  componentRotationIntent,
  createMechanicalInteractionState,
  handleMechanicalCanvasClick,
} from "../src/editor/mechanical-controller.mjs";
import { createDxfImportReviewController } from "../src/editor/dxf-import-controller.mjs";
import { createSyntheticComponent } from "../src/editor/synthetic-catalogue.mjs";
import { createLocalProjectStore } from "../src/persistence/local-project-store.mjs";
import {
  bytesToDataUrl,
  exportPortableProject,
  importPortableProject,
  sha256Hex,
} from "../src/persistence/portable-project.mjs";
import { createA3SheetModel, renderA3SheetSvg } from "../src/sheets/a3-sheet.mjs";

const FIXED_TIME = new Date("2026-10-15T22:00:00.000Z");

test("complete synthetic authoring journey preserves every domain and persistence invariant", async () => {
  let history = createCommandHistory(projectWithFloor());
  assertStage(history.present, "new project");

  history = executeCommand(history, await imageReferenceCommand());
  assert.equal(history.present.walls.length, 0, "reference import creates no authoritative wall");
  history = executeCommand(history, calibrationCommand());
  assert.equal(history.present.floorReferences[0].transform.scaleMmPerPixel.valueMm, 10);
  assertStage(history.present, "calibrated image reference");

  const dxfController = createDxfImportReviewController();
  const dxfText = await readFile(new URL("./fixtures/dxf/supported-ac1015.dxf", import.meta.url), "utf8");
  await dxfController.selectSource({ fileName: "supported-ac1015.dxf", sourceText: dxfText });
  dxfController.chooseUnits("mm");
  dxfController.chooseLayers(["WALLS", "CURVES"]);
  history = executeCommand(history, dxfController.prepareAcceptance({
    assetId: "cad-asset-journey",
    referenceId: "cad-reference-journey",
    floorId: "floor-ground",
    transform: {
      localOriginSource: { x: 0, y: 0 },
      translationMm: { x: 0, y: 0 },
      rotationRad: 0,
    },
    visible: true,
    opacity: 0.45,
  }));
  dxfController.complete();
  assert.equal(history.present.walls.length, 0, "DXF acceptance creates no authoritative wall");
  assertStage(history.present, "locked DXF reference");

  history = executeCommand(history, singleWallCommand());
  history = executeCommand(history, tJunctionCommand());
  assert.equal(incidentWallCount(history.present, "wall-node-junction"), 3);
  const beforeJunctionMove = structuredClone(history.present);
  history = executeCommand(history, {
    type: "wall.moveNode",
    nodeId: "wall-node-junction",
    xMm: 3200,
    yMm: 200,
  });
  const movedJunction = structuredClone(history.present);
  assert.equal(incidentWallCount(movedJunction, "wall-node-junction"), 3);
  history = undoCommand(history);
  assert.deepEqual(history.present, beforeJunctionMove);
  history = redoCommand(history);
  assert.deepEqual(history.present, movedJunction);
  assertStage(history.present, "edited T junction with undo-redo");

  let mechanical = createMechanicalInteractionState();
  for (const placement of [
    ["synthetic-mvhr-placeholder", "component-unit", 1500, 1500],
    ["synthetic-supply-terminal", "component-supply", 5200, 1500],
    ["synthetic-extract-terminal", "component-extract", 5200, 3200],
  ]) {
    mechanical = activateMechanicalTool(mechanical, "place-component", { catalogueItemId: placement[0] });
    const requested = handleMechanicalCanvasClick(mechanical, {
      point: { x: placement[2], y: placement[3] },
      hit: { kind: "wall" },
    });
    assert.equal(requested.intent.type, "component.place");
    history = executeCommand(history, {
      type: "component.add",
      component: createSyntheticComponent(requested.intent.catalogueItemId, {
        id: placement[1],
        floorId: "floor-ground",
        xMm: requested.intent.point.x,
        yMm: requested.intent.point.y,
      }),
    });
    mechanical = requested.state;
  }
  mechanical = cancelMechanicalOperation(mechanical);
  assert.equal(mechanical.tool, "select");

  mechanical = handleMechanicalCanvasClick(mechanical, {
    point: { x: 1500, y: 1500 },
    hit: { kind: "component", componentId: "component-unit" },
  }).state;
  const beforeRotation = structuredClone(history.present);
  history = executeCommand(history, componentRotationIntent(mechanical));
  const rotated = structuredClone(history.present);
  history = undoCommand(history);
  assert.deepEqual(history.present, beforeRotation);
  history = redoCommand(history);
  assert.deepEqual(history.present, rotated);
  assertStage(history.present, "synthetic components placed and rotated");

  history = executeCommand(history, routeCommandFromController(history.present, {
    id: "route-supply",
    ductKind: "semi-rigid-radial",
    startComponentId: "component-unit",
    startRole: "Dwelling supply",
    endComponentId: "component-supply",
    endRole: "Dwelling supply",
    intermediate: { x: 3400, y: 900 },
  }));
  history = executeCommand(history, routeCommandFromController(history.present, {
    id: "route-extract",
    ductKind: "generic-duct",
    startComponentId: "component-unit",
    startRole: "Dwelling extract",
    endComponentId: "component-extract",
    endRole: "Dwelling extract",
    intermediate: { x: 3500, y: 3500 },
  }));
  assert.equal(history.present.routes.length, 2);
  assert.equal(history.present.routes.every((route) => route.startAttachment && route.endAttachment), true);
  assertStage(history.present, "compatible typed supply and extract routes");

  const beforeCancellation = serializeProject(history.present);
  mechanical = activateMechanicalTool(createMechanicalInteractionState(), "route", { ductKind: "generic-duct" });
  const unusedPort = portByRole(history.present, "component-unit", "Outdoor intake");
  const unusedPoint = floorPortTransform(history.present, "component-unit", unusedPort.id).positionMm;
  mechanical = handleMechanicalCanvasClick(mechanical, {
    point: unusedPoint,
    hit: portHit("component-unit", unusedPort),
  }).state;
  mechanical = handleMechanicalCanvasClick(mechanical, {
    point: { x: 2600, y: 2200 },
    hit: { kind: "wall" },
  }).state;
  assert.ok(mechanical.routeDraft);
  mechanical = cancelMechanicalOperation(mechanical);
  assert.equal(mechanical.routeDraft, null);
  assert.equal(serializeProject(history.present), beforeCancellation, "cancelled route never becomes a command");

  const storage = memoryStorage();
  const store = createLocalProjectStore(storage, { now: () => new Date(FIXED_TIME) });
  assert.equal(store.save(history.present).ok, true);
  const recovered = store.load(history.present.id);
  assert.equal(recovered.ok, true);
  assert.deepEqual(recovered.project, history.present);
  assertStage(recovered.project, "device-local recovery");

  const portable = await exportPortableProject(recovered.project, { now: () => new Date(FIXED_TIME) });
  const opened = await importPortableProject(portable);
  assert.deepEqual(opened.project, recovered.project);
  assert.equal(opened.authorityRestored, false);
  assertStage(opened.project, "portable round trip");

  const sheet = createA3SheetModel(opened.project, sheetMetadata());
  const svg = renderA3SheetSvg(sheet);
  assert.equal(sheet.printScene.walls.length, 3);
  assert.equal(sheet.printScene.components.length, 3);
  assert.equal(sheet.printScene.routes.length, 2);
  assert.equal(sheet.printScene.references.length, 1);
  assert.equal(sheet.printScene.cadReferences.length, 1);
  assert.equal(sheet.fit.kind, "numeric");
  assert.match(svg, /DRAFT PREVIEW · NOT FOR CONSTRUCTION/);
  assert.match(svg, /data-kind="cad-reference"/);
  assert.doesNotMatch(svg, /selected|snap-marker|draft-layer/);
});

function routeCommandFromController(project, options) {
  const startPort = portByRole(project, options.startComponentId, options.startRole);
  const endPort = portByRole(project, options.endComponentId, options.endRole);
  const startPoint = floorPortTransform(project, options.startComponentId, startPort.id).positionMm;
  const endPoint = floorPortTransform(project, options.endComponentId, endPort.id).positionMm;
  let state = activateMechanicalTool(createMechanicalInteractionState(), "route", {
    ductKind: options.ductKind,
  });
  state = handleMechanicalCanvasClick(state, {
    point: startPoint,
    hit: portHit(options.startComponentId, startPort),
  }).state;
  state = handleMechanicalCanvasClick(state, {
    point: options.intermediate,
    hit: { kind: "wall" },
  }).state;
  const completed = handleMechanicalCanvasClick(state, {
    point: endPoint,
    hit: portHit(options.endComponentId, endPort),
  });
  assert.equal(completed.intent.type, "route.commit");
  return {
    type: "route.add",
    route: {
      id: options.id,
      floorId: "floor-ground",
      system: completed.intent.system,
      stream: completed.intent.stream,
      role: completed.intent.role,
      ductKind: completed.intent.ductKind,
      startAttachment: completed.intent.start,
      endAttachment: completed.intent.end,
      points: completed.intent.points.map((point, index) => ({
        x: point.x,
        y: point.y,
        z: unknownMm(index === 0 || index === completed.intent.points.length - 1
          ? "endpoint derived on command"
          : "synthetic route elevation not set"),
      })),
    },
  };
}

function portByRole(project, componentId, role) {
  const component = project.components.find((item) => item.id === componentId);
  const port = component?.ports.find((item) => item.role === role);
  if (!port) throw new TypeError(`Synthetic port not found: ${componentId} ${role}`);
  return port;
}

function portHit(componentId, port) {
  return {
    kind: "port",
    componentId,
    portId: port.id,
    system: port.system,
    stream: port.stream,
    role: port.role,
  };
}

function projectWithFloor() {
  return applyCommand(createProject("project-complete-synthetic-journey"), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Synthetic Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "synthetic journey datum") },
        orientation: identityQuaternion(),
      },
    },
  });
}

async function imageReferenceCommand() {
  const bytes = syntheticPngHeader(1001, 501);
  return {
    type: "reference.addImage",
    asset: {
      id: "image-asset-journey",
      kind: "image",
      fileName: "synthetic-journey.png",
      mediaType: "image/png",
      byteLength: bytes.byteLength,
      sha256: await sha256Hex(bytes),
      widthPx: 1001,
      heightPx: 501,
      dataUrl: bytesToDataUrl(bytes, "image/png"),
    },
    reference: {
      id: "image-reference-journey",
      floorId: "floor-ground",
      assetId: "image-asset-journey",
      visible: true,
      locked: true,
      opacity: 0.4,
      transform: {
        translationMm: { x: 500, y: 500 },
        rotationRad: 0,
        scaleMmPerPixel: unknownMm("synthetic journey reference uncalibrated"),
      },
      calibration: null,
    },
  };
}

function calibrationCommand() {
  return {
    type: "reference.calibrate",
    referenceId: "image-reference-journey",
    sourcePointApx: { x: 0, y: 0 },
    sourcePointBpx: { x: 1000, y: 0 },
    knownDistanceMm: 10000,
    inputUnit: "m",
    acceptedAtUtc: FIXED_TIME.toISOString(),
    previewScaleMmPerPixel: 10,
    rescaleFloorModel: false,
  };
}

function singleWallCommand() {
  return {
    type: "wall.addChain",
    floorId: "floor-ground",
    nodeIds: ["wall-node-a", "wall-node-b"],
    wallIds: ["wall-a-b"],
    points: [wallPoint(0, 0), wallPoint(6000, 0)],
    splits: [],
    thicknessMm: 140,
    heightMm: unknownMm("synthetic journey wall height not set"),
    referenceLine: "centreline",
    classification: "physical",
  };
}

function tJunctionCommand() {
  return {
    type: "wall.addChain",
    floorId: "floor-ground",
    nodeIds: ["wall-node-junction", "wall-node-leg"],
    wallIds: ["wall-junction-leg"],
    points: [wallPoint(3000, 0), wallPoint(3000, 3000)],
    splits: [{
      wallId: "wall-a-b",
      nodeId: "wall-node-junction",
      newWallId: "wall-junction-b",
      point: { x: 3000, y: 0 },
    }],
    thicknessMm: 140,
    heightMm: unknownMm("synthetic journey wall height not set"),
    referenceLine: "centreline",
    classification: "physical",
  };
}

function wallPoint(x, y) {
  return { x, y, z: unknownMm("synthetic journey wall base not set") };
}

function incidentWallCount(project, nodeId) {
  return project.walls.filter((wall) => wall.startNodeId === nodeId || wall.endNodeId === nodeId).length;
}

function assertStage(project, label) {
  assert.equal(validateProject(project), project, `${label}: project validates`);
  assert.deepEqual(deserializeProject(serializeProject(project)), project, `${label}: canonical round trip`);
  for (const field of ["tenantId", "companyId", "entitlement", "approvalState", "issueRevision"]) {
    assert.equal(Object.hasOwn(project, field), false, `${label}: no authority field ${field}`);
  }
}

function sheetMetadata() {
  return {
    floorId: "floor-ground",
    orientation: "landscape",
    projectName: "Complete synthetic journey",
    siteName: "Synthetic test site",
    clientName: "Not set",
    drawingTitle: "Synthetic Ground Floor MVHR Plan",
    drawingId: "HS-JOURNEY-001",
    issueDate: "2026-10-15",
    status: "Preliminary — not for construction",
    revision: "DRAFT",
    revisionText: "Integration verification",
    drawnBy: "",
    checkedBy: "",
  };
}

function syntheticPngHeader(widthPx, heightPx) {
  const bytes = new Uint8Array(45);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, widthPx);
  view.setUint32(20, heightPx);
  bytes.set([8, 6, 0, 0, 0], 24);
  bytes.set([0x49, 0x45, 0x4e, 0x44], 37);
  return bytes;
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}
