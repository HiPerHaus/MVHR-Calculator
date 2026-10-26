import assert from "node:assert/strict";
import test from "node:test";

import { applyCommand, createProject, identityQuaternion, knownMm } from "../src/domain/spatial.mjs";
import { createCatalogueComponent } from "../src/editor/component-catalogue.mjs";
import { createEquipmentAssembly } from "../src/editor/equipment-assemblies.mjs";
import { inspectEquipmentFirstRouting } from "../src/editor/routing-workflow.mjs";

test("equipment-first routing checklist reports missing typed equipment without inventing connections", () => {
  const project = floorFixture();
  const workflow = inspectEquipmentFirstRouting(project, "ground");
  assert.equal(workflow.status, "attention");
  assert.match(workflow.steps[0].detail, /MVHR unit/);
  assert.match(workflow.steps[0].detail, /outdoor intake terminal/);
  assert.equal(project.components.length, 0);
});

test("equipment-first routing checklist recognises placed unit, terminals, distribution and constraints", () => {
  let project = floorFixture();
  project = add(project, createCatalogueComponent("synthetic-mvhr-placeholder", { id: "unit-main", floorId: "ground", xMm: 1500, yMm: 1800 }));
  project = add(project, createCatalogueComponent("luna-supply", { id: "outlet-supply", floorId: "ground", xMm: 6500, yMm: 1400 }));
  project = add(project, createCatalogueComponent("luna-extract", { id: "outlet-extract", floorId: "ground", xMm: 6500, yMm: 3000 }));
  project = add(project, createCatalogueComponent("generic-external-grille-combined-dn160", { id: "external-combined", floorId: "ground", xMm: 9000, yMm: 2200 }));
  for (const id of ["generic-remote-supply-attenuation-set", "generic-remote-extract-attenuation-set"]) {
    const assembly = createEquipmentAssembly(id, { id: `assembly-${id}`, floorId: "ground", xMm: 3800, yMm: id.includes("supply") ? 1400 : 3000 });
    project = applyCommand(project, { type: "equipmentAssembly.add", ...assembly });
  }
  const workflow = inspectEquipmentFirstRouting(project, "ground");
  assert.equal(workflow.status, "ready");
  assert.equal(workflow.counts.units, 1);
  assert.equal(workflow.counts.outlets, 2);
  assert.equal(workflow.counts.intakeTerminals, 1);
  assert.equal(workflow.counts.exhaustTerminals, 1);
  assert.equal(workflow.steps.find((step) => step.id === "distribution").status, "ready");
  assert.match(workflow.steps.find((step) => step.id === "review").detail, /remaining connections/);
});

function add(project, component) { return applyCommand(project, { type: "component.add", component }); }
function floorFixture() {
  let project = createProject("routing-workflow");
  project = applyCommand(project, { type: "floor.add", floor: { id: "ground", name: "Ground", transform: { translationMm: { x: 0, y: 0, z: knownMm(0, "datum") }, orientation: identityQuaternion() } } });
  project = applyCommand(project, { type: "floorArea.create", outline: { id: "outline", floorId: "ground", name: "Building", geometrySource: "manual-floor-area-outline", purpose: "preliminary-quoting", areaConvention: "closed-plan-outline", measurementBasis: "floor-local-plan-mm", holes: [], vertices: [{x:0,y:0},{x:10000,y:0},{x:10000,y:5000},{x:0,y:5000}].map((point,index)=>({id:`v-${index}`,positionMm:{...point,z:knownMm(0,"plan")}})) } });
  project = applyCommand(project, { type: "reference.addImage", asset: { id: "asset", kind: "image", fileName: "fixture.png", mediaType: "image/png", byteLength: 3, sha256: "0".repeat(64), widthPx: 1000, heightPx: 500, dataUrl: "data:image/png;base64,AAAA" }, reference: { id: "reference", floorId: "ground", assetId: "asset", visible: true, locked: true, opacity: 0.5, transform: { translationMm: { x:0,y:0 }, rotationRad:0, scaleMmPerPixel:knownMm(10,"fixture") }, calibration:null } });
  return applyCommand(project, { type: "reference.calibrate", referenceId: "reference", sourcePointApx:{x:0,y:0}, sourcePointBpx:{x:1000,y:0}, knownDistanceMm:10000, inputUnit:"m", acceptedAtUtc:"2026-10-26T00:00:00.000Z", previewScaleMmPerPixel:10, rescaleFloorModel:false });
}
