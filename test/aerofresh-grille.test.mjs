import test from "node:test";
import assert from "node:assert/strict";
import { createCatalogueComponent } from "../src/editor/component-catalogue.mjs";
import { deriveComponentPlanGraphic, wallGrillePaths, lunaGrillePaths, LUNA_GRILLE_PLAN_GRAPHIC_ID, WALL_GRILLE_PLAN_GRAPHIC_ID } from "../src/editor/component-plan-graphics.mjs";
import { applyCommand, createProject, identityQuaternion, knownMm, serializeProject, deserializeProject } from "../src/domain/spatial.mjs";
import { createA3SheetModel, renderA3SheetSvg } from "../src/sheets/a3-sheet.mjs";

test("Aerofresh symbols preserve service, source identities and unknown connection geometry", () => {
  let project = applyCommand(createProject("project-aerofresh-symbols"), { type: "floor.add", floor: {
    id: "floor-ground", name: "Ground", transform: { translationMm: { x: 0, y: 0, z: knownMm(0, "test") }, orientation: identityQuaternion() },
  } });
  for (const [i, stream] of ["supply", "extract"].entries()) {
    const component = createCatalogueComponent(`aerofresh-magnetic-wall-grille-${stream}`, {
      id: `grille-${stream}`, floorId: "floor-ground", xMm: 1000+i*1500, yMm: 1000,
    });
    assert.equal(component.productId, null);
    assert.equal(component.ports.length, 1);
    assert.equal(component.catalogueSnapshot.dimensions.body, null);
    assert.equal(component.catalogueSnapshot.terminalSpecification.coverOptions[0].productId, "AER-GR-RECT-W");
    const graphic = deriveComponentPlanGraphic(component);
    assert.equal(graphic.graphicId, WALL_GRILLE_PLAN_GRAPHIC_ID);
    assert.equal(graphic.stream, stream);
    assert.equal(graphic.paths.length, 4);
    assert.equal(graphic.colour, stream === "supply" ? "#5050ff" : "#ff3038");
    project = applyCommand(project, { type: "component.add", component });
  }
  project = applyCommand(project, { type: "component.rotateFloorZ", componentId: "grille-extract", angleRad: Math.PI/2 });
  assert.deepEqual(deserializeProject(serializeProject(project)), project);
  const sheet = createA3SheetModel(project, { projectName: "Grille symbol check", drawingTitle: "Ventilation", drawingId: "V01", revision: "A", revisionText: "Symbol review", issueDate: "2026-10-23", status: "Preliminary — not for construction", orientation: "landscape", floorId: "floor-ground" });
  const svg = renderA3SheetSvg(sheet);
  assert.equal((svg.match(/data-plan-graphic="hiper-wall-bulkhead-grille-v1"/g) ?? []).length, 2);
  assert.match(svg, /data-service="supply"/);
  assert.match(svg, /data-service="extract"/);
  assert.match(svg, /rotate\(90\)/);
  assert.match(svg, /#5050ff/);
  assert.match(svg, /#ff3038/);
});

test("supply arrows point away and extract arrows point into the grille", () => {
  const supply = wallGrillePaths("supply", 300, 260);
  const extract = wallGrillePaths("extract", 300, 260);
  assert.equal(supply[0], extract[0]);
  const supplyNumbers = supply[2].match(/-?\d+(?:\.\d+)?/g).map(Number);
  const extractNumbers = extract[2].match(/-?\d+(?:\.\d+)?/g).map(Number);
  // The arrow tip is above its head base for supply, and below for extract.
  assert.ok(supplyNumbers[4] < supplyNumbers[6]);
  assert.ok(extractNumbers[4] > extractNumbers[6]);
  assert.throws(() => wallGrillePaths("invalid", 300, 260), /stream/);
});


test("Luna profiles retain product identity, five radial arrows and sheet appearance", () => {
  let project = applyCommand(createProject("project-luna-symbols"), { type: "floor.add", floor: {
    id: "floor-ground", name: "Ground", transform: { translationMm: { x: 0, y: 0, z: knownMm(0, "test") }, orientation: identityQuaternion() },
  } });
  for (const [i, stream] of ["supply", "extract"].entries()) {
    const component = createCatalogueComponent(`luna-${stream}`, { id: `luna-${stream}-placed`, floorId: "floor-ground", xMm: i*1500, yMm: 0 });
    assert.equal(component.productId, stream === "supply" ? "ZEN-GR-LUNA" : "ZEN-GR-LUNA-EV");
    assert.equal(component.ports.length, 1);
    assert.equal(component.catalogueSnapshot.dimensions.body, null);
    const graphic = deriveComponentPlanGraphic(component);
    assert.equal(graphic.graphicId, LUNA_GRILLE_PLAN_GRAPHIC_ID);
    assert.equal(graphic.paths.length, 6);
    assert.ok(graphic.strokeWidths[0] > graphic.strokeWidths[1]);
    const numbers = graphic.paths[1].match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g).map(Number);
    const tailRadius = Math.hypot(numbers[0], numbers[1]);
    const tipRadius = Math.hypot(numbers[4], numbers[5]);
    assert.ok(stream === "supply" ? tipRadius > tailRadius : tipRadius < tailRadius);
    project = applyCommand(project, { type: "component.add", component });
  }
  assert.deepEqual(deserializeProject(serializeProject(project)), project);
  const svg = renderA3SheetSvg(createA3SheetModel(project, { projectName: "Luna review", drawingTitle: "Ventilation", drawingId: "V02", revision: "A", revisionText: "Symbol review", issueDate: "2026-10-23", status: "Preliminary — not for construction", floorId: "floor-ground" }));
  assert.equal((svg.match(/data-plan-graphic="hiper-luna-grille-v1"/g) ?? []).length, 2);
  assert.match(svg, /#2020ff/);
  assert.match(svg, /#ff2020/);
  assert.match(svg, /stroke-width="4"/);
  assert.throws(() => lunaGrillePaths("invalid", 300), /stream/);
});
