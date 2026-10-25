import assert from "node:assert/strict";
import test from "node:test";

import { createCommandHistory, executeCommand, undoCommand } from "../src/domain/history.mjs";
import {
  applyCommand,
  assumedMm,
  createProject,
  deserializeProject,
  floorPortTransform,
  identityQuaternion,
  knownMm,
  serializeProject,
  unknownMm,
  validateProject,
} from "../src/domain/spatial.mjs";
import { inspectAutomaticRadialRouting, validateDuctPathInsideOutline } from "../src/editor/automatic-radial-routing.mjs";
import { createCatalogueComponent, routeFamilyForKind } from "../src/editor/component-catalogue.mjs";
import { createEquipmentAssembly } from "../src/editor/equipment-assemblies.mjs";
import {
  activateMechanicalTool,
  cancelMechanicalOperation,
  createMechanicalInteractionState,
  handleMechanicalCanvasClick,
} from "../src/editor/mechanical-controller.mjs";
import { createDefaultThreeDView, createThreeDDrawingScene, renderThreeDDrawingSvg } from "../src/sheets/three-d-drawing.mjs";

test("complete synthetic MVHR system stays consistent from typed 2D routing through saved 3D export", () => {
  let project = scaledProject();
  const unit = createCatalogueComponent("synthetic-mvhr-placeholder", {
    id: "unit", floorId: "ground", xMm: 1500, yMm: 3500,
  });
  const supply = createEquipmentAssembly("generic-remote-supply-attenuation-set", {
    id: "supply-set", floorId: "ground", xMm: 3800, yMm: 1900,
  });
  const extract = createEquipmentAssembly("generic-remote-extract-attenuation-set", {
    id: "extract-set", floorId: "ground", xMm: 3800, yMm: 5000,
  });
  project = applyCommand(project, { type: "component.add", component: unit });
  project = applyCommand(project, { type: "equipmentAssembly.add", ...supply });
  project = applyCommand(project, { type: "equipmentAssembly.add", ...extract });
  for (const [id, catalogueItemId, xMm, yMm] of [
    ["supply-1", "luna-supply", 6500, 1100],
    ["supply-2", "luna-supply", 8100, 2100],
    ["supply-3", "luna-supply", 6800, 3100],
    ["extract-1", "luna-extract", 6500, 4300],
    ["extract-2", "luna-extract", 8200, 5200],
    ["extract-3", "luna-extract", 6900, 6100],
  ]) {
    project = applyCommand(project, { type: "component.add", component: createCatalogueComponent(catalogueItemId, { id, floorId: "ground", xMm, yMm }) });
  }

  project = addManualMain(project, "main-supply", endpoint(project, "unit", "Dwelling supply"), endpoint(project, "supply-set-end-plate", "Dwelling supply", "rigid-epp"));
  project = addManualMain(project, "main-extract", endpoint(project, "unit", "Dwelling extract"), endpoint(project, "extract-set-end-plate", "Dwelling extract", "rigid-epp"));
  assert.deepEqual(project.routes.map((route) => route.connectionInterface.nominalSizeMm), [160, 160]);

  const preview = inspectAutomaticRadialRouting(project, "ground", { gridSpacingMm: 120 });
  assert.equal(preview.status, "ready");
  assert.equal(preview.proposals.length, 6);
  assert.equal(preview.unresolved.length, 0);
  for (const proposal of preview.proposals) {
    assert.equal(validateDuctPathInsideOutline(proposal.points, OUTLINE), true);
  }
  const radialFamily = routeFamilyForKind("semi-rigid-radial");
  project = applyCommand(project, {
    type: "route.addBatch",
    routes: preview.proposals.map((proposal, index) => ({
      id: `radial-${index + 1}`,
      floorId: "ground",
      system: proposal.system,
      stream: proposal.stream,
      role: proposal.role,
      ductKind: radialFamily.id,
      connectionInterface: radialFamily.connectionInterface,
      parallelRunCount: 1,
      startAttachment: { componentId: proposal.source.componentId, portId: proposal.source.portId },
      endAttachment: { componentId: proposal.destination.componentId, portId: proposal.destination.portId },
      points: proposal.points.map((point) => ({ ...point, z: unknownMm("automatic radial height not set") })),
    })),
  });
  assert.equal(project.routes.length, 8);
  assert.equal(inspectAutomaticRadialRouting(project, "ground").status, "nothing-to-route");

  const beforeCancelledDraft = serializeProject(project);
  const unusedSupplyPort = project.components.find((component) => component.id === "supply-set-radial-plate").ports
    .find((port) => !occupied(project, "supply-set-radial-plate", port.id));
  let interaction = activateMechanicalTool(createMechanicalInteractionState(), "route", { ductKind: "semi-rigid-radial" });
  const unusedPosition = floorPortTransform(project, "supply-set-radial-plate", unusedSupplyPort.id).positionMm;
  interaction = handleMechanicalCanvasClick(interaction, { point: unusedPosition, hit: hit("supply-set-radial-plate", unusedSupplyPort) }).state;
  assert.ok(interaction.routeDraft);
  interaction = cancelMechanicalOperation(interaction);
  assert.equal(interaction.routeDraft, null);
  assert.equal(serializeProject(project), beforeCancelledDraft, "cancelling a route draft must not alter the project");

  let history = createCommandHistory(project);
  history = executeCommand(history, { type: "route.setParallelRunCount", routeId: "radial-1", parallelRunCount: 2 });
  const twinProject = history.present;
  history = executeCommand(history, { type: "route.setParallelRunCount", routeId: "radial-1", parallelRunCount: 1 });
  assert.equal(history.present.routes.find((route) => route.id === "radial-1").parallelRunCount, 1);
  history = undoCommand(history);
  assert.deepEqual(history.present, twinProject);

  history = executeCommand(history, { type: "equipmentAssembly.moveBy", assemblyId: "supply-set", dxMm: 120, dyMm: 80 });
  history = executeCommand(history, { type: "equipmentAssembly.rotateFloorZ", assemblyId: "extract-set", angleRad: Math.PI / 2 });
  history = executeCommand(history, {
    type: "threeD.applyFloorHeights",
    floorId: "ground",
    equipmentElevationMm: assumedMm(2100, "system coordination default"),
    outletElevationMm: assumedMm(2450, "terminal coordination default"),
    ductElevationMm: assumedMm(2700, "route coordination default"),
  });
  history = executeCommand(history, { type: "component.setElevation", componentId: "unit", elevationMm: knownMm(2250, "measured unit base") });
  history = executeCommand(history, {
    type: "equipmentAssembly.setMemberElevation",
    assemblyId: "supply-set",
    componentId: "supply-set-attenuator",
    elevationMm: knownMm(2325, "measured supply attenuator base"),
  });
  history = executeCommand(history, {
    type: "equipmentAssembly.setMemberElevation",
    assemblyId: "extract-set",
    componentId: "extract-set-radial-plate",
    elevationMm: knownMm(2380, "measured extract radial plate base"),
  });
  for (const [routeId, heightMm] of history.present.routes.map((route, index) => [route.id, index < 2 ? 2600 : 2780 + (index % 3) * 120])) {
    history = executeCommand(history, { type: "route.setRoutingElevation", routeId, elevationMm: knownMm(heightMm, `measured ${routeId} centreline`) });
  }
  project = history.present;
  assert.doesNotThrow(() => validateProject(project));

  const attachmentKeys = project.routes.flatMap((route) => [route.startAttachment, route.endAttachment])
    .filter(Boolean)
    .map((attachment) => `${attachment.componentId}/${attachment.portId}`);
  assert.equal(new Set(attachmentKeys).size, attachmentKeys.length, "every typed attached port must be occupied once");
  for (const route of project.routes.filter((candidate) => candidate.ductKind === "semi-rigid-radial")) {
    assert.equal(validateDuctPathInsideOutline(route.points.map(({ x, y }) => ({ x, y })), OUTLINE), true);
  }

  const reopened = deserializeProject(serializeProject(project));
  assert.deepEqual(reopened, project);
  const scene = createThreeDDrawingScene(reopened, "ground");
  assert.equal(scene.routes.length, 8);
  assert.equal(scene.routes.reduce((total, route) => total + route.verticalTransitionCount, 0), 16);
  assert.ok(scene.components.some((component) => component.shape === "unit"));
  assert.ok(scene.components.filter((component) => component.shape === "distribution").length >= 2);
  assert.ok(scene.heightItems.some((item) => item.kind === "assembly-component" && item.measurement.state === "known"));
  assert.ok(scene.diagnostics.some((item) => /schematic|provisional/i.test(item.issue)));
  assert.match(scene.boundary.statement, /not BIM, clash detection/);

  for (const route of reopened.routes) {
    const drawingRoute = scene.routes.find((candidate) => candidate.id === route.id);
    assert.deepEqual(
      [drawingRoute.points[0].x, drawingRoute.points[0].y, drawingRoute.points.at(-1).x, drawingRoute.points.at(-1).y],
      [route.points[0].x, route.points[0].y, route.points.at(-1).x, route.points.at(-1).y],
      `3D route ${route.id} must keep the saved 2D endpoints`,
    );
  }
  const view = { ...createDefaultThreeDView(), azimuthRad: -0.45, pitchRad: 0.72, zoom: 1.15, panX: 18, panY: -12 };
  const svg = renderThreeDDrawingSvg(scene, { view });
  assert.equal((svg.match(/data-route-run=/g) ?? []).length, 9, "one Twin and seven Single route bodies must remain individually visible");
  assert.equal((svg.match(/data-route-id=/g) ?? []).length, 9);
  assert.match(svg, /data-component-port=/);
  assert.match(svg, / Q /);
  assert.equal(renderThreeDDrawingSvg(createThreeDDrawingScene(deserializeProject(serializeProject(reopened)), "ground"), { view }), svg);
});

const OUTLINE = Object.freeze([
  { x: 0, y: 0 }, { x: 9500, y: 0 }, { x: 9500, y: 7000 }, { x: 0, y: 7000 },
]);

function scaledProject() {
  let project = applyCommand(createProject("three-d-system-acceptance"), {
    type: "floor.add",
    floor: { id: "ground", name: "Ground", transform: { translationMm: { x: 0, y: 0, z: knownMm(0, "finished floor datum") }, orientation: identityQuaternion() } },
  });
  project = applyCommand(project, {
    type: "floorArea.create",
    outline: { id: "outline", floorId: "ground", name: "Building outline", geometrySource: "manual-floor-area-outline", purpose: "preliminary-quoting", areaConvention: "closed-plan-outline", measurementBasis: "floor-local-plan-mm", holes: [], vertices: OUTLINE.map((point, index) => ({ id: `outline-${index + 1}`, positionMm: { ...point, z: knownMm(0, "plan") } })) },
  });
  project = applyCommand(project, {
    type: "reference.addImage",
    asset: { id: "asset", kind: "image", fileName: "system-fixture.png", mediaType: "image/png", byteLength: 3, sha256: "0".repeat(64), widthPx: 950, heightPx: 700, dataUrl: "data:image/png;base64,AAAA" },
    reference: { id: "reference", floorId: "ground", assetId: "asset", visible: true, locked: true, opacity: 0.5, transform: { translationMm: { x: 0, y: 0 }, rotationRad: 0, scaleMmPerPixel: knownMm(10, "fixture scale") }, calibration: null },
  });
  return applyCommand(project, { type: "reference.calibrate", referenceId: "reference", sourcePointApx: { x: 0, y: 0 }, sourcePointBpx: { x: 950, y: 0 }, knownDistanceMm: 9500, inputUnit: "m", acceptedAtUtc: "2026-10-24T00:00:00.000Z", previewScaleMmPerPixel: 10, rescaleFloorModel: false });
}

function addManualMain(project, id, start, end) {
  const family = routeFamilyForKind("epp-rigid-dn160");
  const startPoint = floorPortTransform(project, start.componentId, start.portId).positionMm;
  const endPoint = floorPortTransform(project, end.componentId, end.portId).positionMm;
  return applyCommand(project, { type: "route.add", route: {
    id,
    floorId: "ground",
    system: "mvhr",
    stream: start.port.stream,
    role: start.port.role,
    ductKind: family.id,
    connectionInterface: family.connectionInterface,
    parallelRunCount: 1,
    startAttachment: { componentId: start.componentId, portId: start.portId },
    endAttachment: { componentId: end.componentId, portId: end.portId },
    points: [startPoint, { x: (startPoint.x + endPoint.x) / 2, y: startPoint.y, z: unknownMm("manual main height not set") }, endPoint],
  } });
}

function endpoint(project, componentId, role, family = null) {
  const component = project.components.find((candidate) => candidate.id === componentId);
  const port = component?.ports.find((candidate) => candidate.role === role && (family === null || candidate.interface?.family === family));
  if (!component || !port) throw new TypeError(`Missing endpoint ${componentId}/${role}/${family ?? "any"}`);
  return { componentId, portId: port.id, port };
}

function occupied(project, componentId, portId) {
  return project.routes.some((route) => [route.startAttachment, route.endAttachment].some((attachment) => attachment?.componentId === componentId && attachment.portId === portId)) ||
    project.connections.some((connection) => [connection.from, connection.to].some((attachment) => attachment.componentId === componentId && attachment.portId === portId));
}

function hit(componentId, port) {
  return { kind: "port", componentId, portId: port.id, system: port.system, stream: port.stream, role: port.role, interface: port.interface };
}
