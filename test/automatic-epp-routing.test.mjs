import assert from "node:assert/strict";
import test from "node:test";

import { createCommandHistory, executeCommand, undoCommand } from "../src/domain/history.mjs";
import { applyCommand, createProject, deserializeProject, identityQuaternion, knownMm, serializeProject, unknownMm } from "../src/domain/spatial.mjs";
import { inspectAutomaticEppRouting } from "../src/editor/automatic-epp-routing.mjs";
import { createCatalogueComponent } from "../src/editor/component-catalogue.mjs";
import { createEquipmentAssembly } from "../src/editor/equipment-assemblies.mjs";
import { createConfiguredMvhrComponent } from "../src/editor/mvhr-placement.mjs";
import { createThreeDDrawingScene, renderThreeDDrawingSvg } from "../src/sheets/three-d-drawing.mjs";

test("automatic DN160 EPP routing requires explicit endpoints and applies as one editable undo step", () => {
  let project = scaledFixture(rectangle());
  project = add(project, createCatalogueComponent("synthetic-mvhr-placeholder", { id: "unit", floorId: "ground", xMm: 1200, yMm: 2200 }));
  const assembly = createEquipmentAssembly("generic-remote-supply-attenuation-set", { id: "supply-set", floorId: "ground", xMm: 6000, yMm: 2200 });
  project = applyCommand(project, { type: "equipmentAssembly.add", ...assembly });

  const choose = inspectAutomaticEppRouting(project, "ground");
  assert.equal(choose.status, "choose-endpoints");
  assert.equal(choose.proposal, null);
  const start = choose.endpoints.find((entry) => entry.componentId === "unit" && entry.stream === "supply");
  assert.ok(start);
  const afterStart = inspectAutomaticEppRouting(project, "ground", { startKey: start.key });
  const end = afterStart.compatibleEnds.find((entry) => entry.componentId.endsWith("end-plate"));
  assert.ok(end);
  const ready = inspectAutomaticEppRouting(project, "ground", { startKey: start.key, endKey: end.key });
  assert.equal(ready.status, "ready");
  assert.equal(ready.proposal.diameterMm, 160);
  assert.equal(ready.proposal.geometryStatus, "drawing-only-fit-unverified");

  const history = executeCommand(createCommandHistory(project), { type: "route.add", route: routeFrom(ready.proposal, "auto-epp") });
  assert.equal(history.present.routes.length, 1);
  assert.deepEqual(undoCommand(history).present, project);
  let moved = applyCommand(history.present, { type: "equipmentAssembly.moveBy", assemblyId: "supply-set", dxMm: 250, dyMm: -100 });
  moved = applyCommand(moved, { type: "equipmentAssembly.rotateFloorZ", assemblyId: "supply-set", angleRad: Math.PI / 2 });
  assert.notDeepEqual(moved.routes[0].points.at(-1), history.present.routes[0].points.at(-1));
  moved = applyCommand(moved, { type: "threeD.applyFloorHeights", floorId: "ground", equipmentElevationMm: knownMm(2200, "measured equipment base"), outletElevationMm: knownMm(2400, "measured terminal base"), ductElevationMm: knownMm(2650, "measured duct centreline") });
  const reopened = deserializeProject(serializeProject(moved));
  assert.deepEqual(reopened.routes, moved.routes);
  const svg = renderThreeDDrawingSvg(createThreeDDrawingScene(reopened, "ground"));
  assert.match(svg, /data-route-id="auto-epp"/);
  assert.equal(svg, renderThreeDDrawingSvg(createThreeDDrawingScene(deserializeProject(serializeProject(reopened)), "ground")));
  const repeated = inspectAutomaticEppRouting(history.present, "ground", { startKey: start.key, endKey: end.key });
  assert.notEqual(repeated.status, "ready");
  assert.equal(repeated.proposal, null);
});

test("DN125 outdoor routing only permits a matching explicit external terminal", () => {
  let project = scaledFixture(rectangle());
  const unit = createConfiguredMvhrComponent({ model: "ca200", mounting: "horizontal", handing: "left", layout: "remote-attenuators" }, { id: "ca200", floorId: "ground", xMm: 1800, yMm: 2500 });
  project = add(project, unit);
  project = add(project, createCatalogueComponent("generic-external-grille-intake-dn125", { id: "intake-grille", floorId: "ground", xMm: 10250, yMm: 2500 }));
  project = add(project, createCatalogueComponent("generic-external-grille-exhaust-dn125", { id: "exhaust-grille", floorId: "ground", xMm: 10250, yMm: 3500 }));

  const initial = inspectAutomaticEppRouting(project, "ground");
  const intake = initial.endpoints.find((entry) => entry.componentId === "ca200" && entry.stream === "intake");
  const afterStart = inspectAutomaticEppRouting(project, "ground", { startKey: intake.key });
  assert.deepEqual(afterStart.compatibleEnds.map((entry) => entry.componentId), ["intake-grille"]);
  const ready = inspectAutomaticEppRouting(project, "ground", { startKey: intake.key, endKey: afterStart.compatibleEnds[0].key });
  assert.equal(ready.status, "ready");
  assert.equal(ready.proposal.diameterMm, 125);
  assert.equal(ready.proposal.exteriorTermination, true);

  const supply = initial.endpoints.find((entry) => entry.componentId === "ca200" && entry.stream === "supply");
  const supplyChoices = inspectAutomaticEppRouting(project, "ground", { startKey: supply.key });
  assert.equal(supplyChoices.compatibleEnds.some((entry) => entry.externalTerminal), false);
});

test("automatic EPP routing excludes incompatible and occupied ports and reports geometry blockers", () => {
  let project = scaledFixture(concave());
  project = add(project, createCatalogueComponent("synthetic-mvhr-placeholder", { id: "unit", floorId: "ground", xMm: 900, yMm: 3000 }));
  const supply = createEquipmentAssembly("generic-remote-supply-attenuation-set", { id: "supply-set", floorId: "ground", xMm: 5100, yMm: 3000 });
  project = applyCommand(project, { type: "equipmentAssembly.add", ...supply });
  const initial = inspectAutomaticEppRouting(project, "ground", {}, { gridSpacingMm: 100 });
  const start = initial.endpoints.find((entry) => entry.componentId === "unit" && entry.stream === "supply");
  const choices = inspectAutomaticEppRouting(project, "ground", { startKey: start.key }, { gridSpacingMm: 100 });
  assert.ok(choices.compatibleEnds.every((entry) => entry.nominalSizeMm === 160 && entry.stream === "supply"));
  const attempt = inspectAutomaticEppRouting(project, "ground", { startKey: start.key, endKey: choices.compatibleEnds[0].key }, { gridSpacingMm: 100 });
  assert.equal(attempt.status, "unresolved");
  assert.match(attempt.message, /full-width DN160/);
});

test("Building-aligned EPP preview keeps explicit endpoints and reports its geometry style", () => {
  let project = scaledFixture(rectangle());
  project = add(project, createCatalogueComponent("synthetic-mvhr-placeholder", { id: "unit", floorId: "ground", xMm: 1400, yMm: 1200 }));
  const assembly = createEquipmentAssembly("generic-remote-supply-attenuation-set", { id: "supply-set", floorId: "ground", xMm: 7000, yMm: 3600 });
  project = applyCommand(project, { type: "equipmentAssembly.add", ...assembly });
  const endpoints = inspectAutomaticEppRouting(project, "ground").endpoints;
  const start = endpoints.find((entry) => entry.componentId === "unit" && entry.stream === "supply");
  const choices = inspectAutomaticEppRouting(project, "ground", { startKey: start.key });
  const end = choices.compatibleEnds.find((entry) => entry.componentId.endsWith("end-plate"));
  const preview = inspectAutomaticEppRouting(project, "ground", { startKey: start.key, endKey: end.key }, {
    routingStyle: "building-aligned",
    buildingAxisRad: 0,
  });
  assert.equal(preview.status, "ready");
  assert.equal(preview.proposal.routingStyle, "building-aligned");
  assert.equal(preview.proposal.source.key, start.key);
  assert.equal(preview.proposal.destination.key, end.key);
  assert.ok(preview.proposal.points.length >= 3);
});

function routeFrom(proposal, id) {
  return {
    id, floorId: "ground", system: proposal.system, stream: proposal.stream, role: proposal.role,
    ductKind: proposal.ductKind, connectionInterface: proposal.connectionInterface, parallelRunCount: 1,
    startAttachment: { componentId: proposal.source.componentId, portId: proposal.source.portId },
    endAttachment: { componentId: proposal.destination.componentId, portId: proposal.destination.portId },
    points: proposal.points.map((point) => ({ ...point, z: unknownMm("automatic EPP route elevation not set") })),
  };
}
function add(project, component) { return applyCommand(project, { type: "component.add", component }); }
function scaledFixture(points) {
  let project = createProject("automatic-epp-routing");
  project = applyCommand(project, { type: "floor.add", floor: { id: "ground", name: "Ground", transform: { translationMm: { x: 0, y: 0, z: knownMm(0, "floor datum") }, orientation: identityQuaternion() } } });
  project = applyCommand(project, { type: "floorArea.create", outline: { id: "outline", floorId: "ground", name: "Building outline", geometrySource: "manual-floor-area-outline", purpose: "preliminary-quoting", areaConvention: "closed-plan-outline", measurementBasis: "floor-local-plan-mm", holes: [], vertices: points.map((point, index) => ({ id: `v-${index + 1}`, positionMm: { ...point, z: knownMm(0, "plan") } })) } });
  project = applyCommand(project, { type: "reference.addImage", asset: { id: "asset", kind: "image", fileName: "fixture.png", mediaType: "image/png", byteLength: 3, sha256: "0".repeat(64), widthPx: 1000, heightPx: 500, dataUrl: "data:image/png;base64,AAAA" }, reference: { id: "reference", floorId: "ground", assetId: "asset", visible: true, locked: true, opacity: 0.5, transform: { translationMm: { x: 0, y: 0 }, rotationRad: 0, scaleMmPerPixel: knownMm(10, "fixture scale") }, calibration: null } });
  return applyCommand(project, { type: "reference.calibrate", referenceId: "reference", sourcePointApx: { x: 0, y: 0 }, sourcePointBpx: { x: 1000, y: 0 }, knownDistanceMm: 10000, inputUnit: "m", acceptedAtUtc: "2026-10-24T00:00:00.000Z", previewScaleMmPerPixel: 10, rescaleFloorModel: false });
}
function rectangle() { return [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 5000 }, { x: 0, y: 5000 }]; }
function concave() { return [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 5000 }, { x: 3500, y: 5000 }, { x: 3500, y: 120 }, { x: 2500, y: 120 }, { x: 2500, y: 5000 }, { x: 0, y: 5000 }]; }
