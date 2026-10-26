import assert from "node:assert/strict";
import test from "node:test";

import { createCommandHistory, executeCommand, undoCommand } from "../src/domain/history.mjs";
import { applyCommand, assumedMm, createProject, deserializeProject, identityQuaternion, knownMm, serializeProject, unknownMm } from "../src/domain/spatial.mjs";
import { inspectAutomaticEppRouting } from "../src/editor/automatic-epp-routing.mjs";
import { inspectAutomaticRadialRouting } from "../src/editor/automatic-radial-routing.mjs";
import { createCatalogueComponent, routeFamilyForKind } from "../src/editor/component-catalogue.mjs";
import { createEquipmentAssembly } from "../src/editor/equipment-assemblies.mjs";
import { inspectRoutingCoordination } from "../src/editor/routing-coordination.mjs";
import { standaloneCwRecordId } from "../src/editor/standalone-cw.mjs";
import { createA3SheetModel, renderA3SheetSvg } from "../src/sheets/a3-sheet.mjs";
import { createThreeDDrawingScene, renderThreeDDrawingSvg } from "../src/sheets/three-d-drawing.mjs";

test("named exclusions and floor clear spacing are undoable, editable and portable", () => {
  let project = scaledFixture();
  const exclusion = beam("beam-1", 3500, 1800, 800, 1200, { mode: "solid-range", bottomMm: assumedMm(2200, "beam soffit"), topMm: assumedMm(2600, "beam top") });
  let history = executeCommand(createCommandHistory(project), { type: "routingExclusion.add", exclusion });
  history = executeCommand(history, { type: "routingClearance.set", floorId: "ground", clearSpacingMm: assumedMm(75, "coordination gap") });
  history = executeCommand(history, { type: "routingExclusion.update", exclusionId: "beam-1", changes: { name: "Kitchen beam", geometry: { shape: "rectangle", x: 3600, y: 1800, width: 900, height: 1200 } } });
  assert.equal(history.present.routingExclusions[0].name, "Kitchen beam");
  assert.equal(history.present.routingClearanceSettings[0].clearSpacingMm.valueMm, 75);
  assert.equal(undoCommand(history).present.routingExclusions[0].name, "Beam beam-1");
  assert.deepEqual(deserializeProject(serializeProject(history.present)), history.present);
  const removed = applyCommand(history.present, { type: "routingExclusion.remove", exclusionId: "beam-1" });
  assert.equal(removed.routingExclusions.length, 0);
});

test("DN90 and DN160 automatic routes detour around full-width exclusions and report blocked corridors", () => {
  let project = scaledFixture();
  project = applyCommand(project, { type: "routingExclusion.add", exclusion: beam("beam-centre", 4400, 1400, 1200, 3200) });
  project = add(project, createCatalogueComponent(standaloneCwRecordId({ size: "320", orientation: "vertical", stream: "supply" }), { id: "cw-source", floorId: "ground", xMm: 1000, yMm: 3000, allowAssemblyOnly: true }));
  project = add(project, createCatalogueComponent("luna-supply", { id: "outlet", floorId: "ground", xMm: 9000, yMm: 3000 }));
  const radial = inspectAutomaticRadialRouting(project, "ground", { gridSpacingMm: 180 });
  assert.equal(radial.status, "ready");
  assert.ok(radial.proposals[0].points.length > 2);
  const alignedRadial = inspectAutomaticRadialRouting(project, "ground", { routingStyle: "building-aligned", buildingAxisRad: 0, gridSpacingMm: 180 });
  assert.equal(alignedRadial.status, "ready");
  assert.equal(alignedRadial.proposals[0].routingStyle, "building-aligned");
  assert.ok(alignedRadial.proposals[0].points.length > 2);

  let eppProject = scaledFixture();
  eppProject = applyCommand(eppProject, { type: "routingExclusion.add", exclusion: beam("beam-centre", 4400, 1400, 1200, 3200) });
  eppProject = add(eppProject, createCatalogueComponent("synthetic-mvhr-placeholder", { id: "unit", floorId: "ground", xMm: 1000, yMm: 3000 }));
  const assembly = createEquipmentAssembly("generic-remote-supply-attenuation-set", { id: "supply-set", floorId: "ground", xMm: 8500, yMm: 3000 });
  eppProject = applyCommand(eppProject, { type: "equipmentAssembly.add", ...assembly });
  const first = inspectAutomaticEppRouting(eppProject, "ground");
  const start = first.endpoints.find((entry) => entry.componentId === "unit" && entry.stream === "supply");
  const second = inspectAutomaticEppRouting(eppProject, "ground", { startKey: start.key });
  const ready = inspectAutomaticEppRouting(eppProject, "ground", { startKey: start.key, endKey: second.compatibleEnds[0].key }, { gridSpacingMm: 100 });
  assert.equal(ready.status, "ready");
  assert.ok(ready.proposal.points.length > 2);
  const alignedEpp = inspectAutomaticEppRouting(eppProject, "ground", { startKey: start.key, endKey: second.compatibleEnds[0].key }, { routingStyle: "building-aligned", buildingAxisRad: 0, gridSpacingMm: 100 });
  assert.equal(alignedEpp.status, "ready");
  assert.equal(alignedEpp.proposal.routingStyle, "building-aligned");

  const blocked = applyCommand(project, { type: "routingExclusion.update", exclusionId: "beam-centre", changes: { geometry: { shape: "rectangle", x: 4400, y: 80, width: 1200, height: 5840 } } });
  const unresolved = inspectAutomaticRadialRouting(blocked, "ground", { gridSpacingMm: 160 });
  assert.equal(unresolved.proposals.length, 0);
  assert.match(unresolved.unresolved[0].reason, /No full-width DN90 route/);
});

test("coordination warnings distinguish height-separated crossings, collisions and unknown heights", () => {
  let project = scaledFixture();
  project = applyCommand(project, { type: "routingClearance.set", floorId: "ground", clearSpacingMm: assumedMm(50, "coordination gap") });
  project = applyCommand(project, { type: "routingExclusion.add", exclusion: beam("beam-range", 4700, 2600, 600, 800, { mode: "solid-range", bottomMm: knownMm(2100, "survey"), topMm: knownMm(2400, "survey") }) });
  project = addRoute(project, "horizontal", [{ x: 1000, y: 3000 }, { x: 9000, y: 3000 }], knownMm(2700, "measured centreline"), 160);
  project = addRoute(project, "vertical", [{ x: 5000, y: 800 }, { x: 5000, y: 5200 }], knownMm(3100, "measured centreline"), 125);
  let inspection = inspectRoutingCoordination(project, "ground");
  assert.equal(inspection.diagnostics.some((item) => item.code === "route-clearance-conflict"), false);
  assert.equal(inspection.diagnostics.some((item) => item.code === "route-obstacle-clash"), false);

  project = applyCommand(project, { type: "route.setRoutingElevation", routeId: "vertical", elevationMm: unknownMm("height pending") });
  inspection = inspectRoutingCoordination(project, "ground");
  assert.ok(inspection.diagnostics.some((item) => item.code === "route-clearance-height-unverified"));

  project = applyCommand(project, { type: "route.setRoutingElevation", routeId: "vertical", elevationMm: knownMm(2720, "measured centreline") });
  inspection = inspectRoutingCoordination(project, "ground");
  assert.ok(inspection.diagnostics.some((item) => item.code === "route-clearance-conflict"));

  project = applyCommand(project, { type: "route.setRoutingElevation", routeId: "horizontal", elevationMm: knownMm(2250, "measured centreline") });
  inspection = inspectRoutingCoordination(project, "ground");
  assert.ok(inspection.diagnostics.some((item) => item.code === "route-obstacle-clash"));
  const scene = createThreeDDrawingScene(project, "ground");
  assert.equal(scene.exclusions.length, 1);
  assert.match(renderThreeDDrawingSvg(scene), /data-routing-exclusion="beam-range"/);
  const sheet = createA3SheetModel(project, { floorId: "ground", orientation: "landscape", projectName: "Coordination fixture", siteName: "Synthetic site", clientName: "Not set", drawingTitle: "Routing coordination", drawingId: "HS-COORD-001", issueDate: "2026-10-24", status: "Preliminary — not for construction", revision: "DRAFT", revisionText: "Synthetic coordination test", drawnBy: "", checkedBy: "" });
  assert.match(renderA3SheetSvg(sheet), /data-kind="routing-exclusion" data-id="beam-range"/);
});

function addRoute(project, id, points, elevation, diameter) {
  const family = routeFamilyForKind(`epp-rigid-dn${diameter}`);
  return applyCommand(project, { type: "route.add", route: { id, floorId: "ground", system: "mvhr", stream: "supply", role: "Dwelling supply", ductKind: family.id, connectionInterface: family.connectionInterface, parallelRunCount: 1, startAttachment: null, endAttachment: null, routingElevationMm: elevation, points: points.map((point) => ({ ...point, z: unknownMm("free endpoint elevation") })) } });
}
function beam(id, x, y, width, height, verticalRange = { mode: "all-height" }) { return { id, floorId: "ground", name: `Beam ${id}`, kind: "beam", geometry: { shape: "rectangle", x, y, width, height }, verticalRange }; }
function add(project, component) { return applyCommand(project, { type: "component.add", component }); }
function scaledFixture() {
  let project = createProject("routing-coordination");
  project = applyCommand(project, { type: "floor.add", floor: { id: "ground", name: "Ground", transform: { translationMm: { x: 0, y: 0, z: knownMm(0, "datum") }, orientation: identityQuaternion() } } });
  project = applyCommand(project, { type: "floorArea.create", outline: { id: "outline", floorId: "ground", name: "Building", geometrySource: "manual-floor-area-outline", purpose: "preliminary-quoting", areaConvention: "closed-plan-outline", measurementBasis: "floor-local-plan-mm", holes: [], vertices: [{x:0,y:0},{x:10000,y:0},{x:10000,y:6000},{x:0,y:6000}].map((point,index)=>({id:`v-${index}`,positionMm:{...point,z:knownMm(0,"plan")}})) } });
  project = applyCommand(project, { type: "reference.addImage", asset: { id: "asset", kind: "image", fileName: "fixture.png", mediaType: "image/png", byteLength: 3, sha256: "0".repeat(64), widthPx: 1000, heightPx: 600, dataUrl: "data:image/png;base64,AAAA" }, reference: { id: "reference", floorId: "ground", assetId: "asset", visible: true, locked: true, opacity: 0.5, transform: { translationMm: { x:0,y:0 }, rotationRad:0, scaleMmPerPixel:knownMm(10,"fixture") }, calibration:null } });
  return applyCommand(project, { type: "reference.calibrate", referenceId: "reference", sourcePointApx:{x:0,y:0}, sourcePointBpx:{x:1000,y:0}, knownDistanceMm:10000, inputUnit:"m", acceptedAtUtc:"2026-10-24T00:00:00.000Z", previewScaleMmPerPixel:10, rescaleFloorModel:false });
}
