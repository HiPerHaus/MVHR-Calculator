import assert from "node:assert/strict";
import test from "node:test";

import { createCommandHistory, executeCommand, undoCommand } from "../src/domain/history.mjs";
import { applyCommand, assumedMm, createProject, deserializeProject, floorPortTransform, identityQuaternion, knownMm, serializeProject, unknownMm } from "../src/domain/spatial.mjs";
import { createCatalogueComponent, routeFamilyForKind } from "../src/editor/component-catalogue.mjs";
import { standaloneCwRecordId } from "../src/editor/standalone-cw.mjs";
import { createThreeDDrawingScene, renderThreeDDrawingSvg } from "../src/sheets/three-d-drawing.mjs";

test("height setup persists explicit assumptions and produces vertical transitions from the same routes", () => {
  const before = routedFixture();
  const history = executeCommand(createCommandHistory(before), {
    type: "threeD.applyFloorHeights",
    floorId: "ground",
    equipmentElevationMm: assumedMm(2200, "designer 3D setup"),
    outletElevationMm: assumedMm(2400, "designer 3D setup"),
    ductElevationMm: assumedMm(2600, "designer 3D setup"),
  });
  const project = history.present;
  assert.equal(project.components.find((component) => component.id === "cw-supply").positionMm.z.valueMm, 2200);
  assert.equal(project.components.find((component) => component.id === "outlet-supply").positionMm.z.valueMm, 2400);
  assert.equal(project.routes[0].routingElevationMm.valueMm, 2600);
  assert.equal(project.routes[0].routingElevationMm.state, "assumed");
  assert.deepEqual(undoCommand(history).present, before);
  assert.deepEqual(deserializeProject(serializeProject(project)), project);

  const scene = createThreeDDrawingScene(project, "ground");
  assert.equal(scene.routes.length, 1);
  assert.equal(scene.routes[0].verticalTransitionCount, 2);
  assert.deepEqual(scene.routes[0].points.map((point) => point.z), [2514.3, 2600, 2600, 2600, 2400]);
  assert.equal(scene.components.length, 2);
  assert.match(scene.boundary.statement, /not BIM/);
});

test("unknown heights remain diagnostics rather than invented zeroes", () => {
  const scene = createThreeDDrawingScene(routedFixture(), "ground");
  assert.equal(scene.components.length, 0);
  assert.equal(scene.routes.length, 0);
  assert.ok(scene.diagnostics.some((item) => /elevation is unknown/.test(item.issue)));
  assert.ok(scene.diagnostics.some((item) => /Route height/.test(item.issue)));
});

test("3D SVG is deterministic, labels its scope and uses known manufacturer envelopes where available", () => {
  const project = applyCommand(routedFixture(), {
    type: "threeD.applyFloorHeights",
    floorId: "ground",
    equipmentElevationMm: knownMm(2100, "measured setout"),
    outletElevationMm: knownMm(2450, "measured setout"),
    ductElevationMm: knownMm(2700, "measured setout"),
  });
  const scene = createThreeDDrawingScene(project, "ground");
  const svg = renderThreeDDrawingSvg(scene);
  const reopened = deserializeProject(serializeProject(project));
  const reopenedScene = createThreeDDrawingScene(reopened, "ground");
  assert.deepEqual(reopenedScene, scene);
  assert.equal(svg, renderThreeDDrawingSvg(reopenedScene));
  assert.match(svg, /schematic 3D MVHR view/);
  assert.match(svg, /data-component-id="cw-supply"/);
  assert.match(svg, /data-route-id="route-supply"/);
  assert.match(svg, /not BIM, clash detection/);
});

function routedFixture() {
  let project = createProject("three-d-fixture");
  project = applyCommand(project, { type: "floor.add", floor: { id: "ground", name: "Ground", transform: { translationMm: { x: 0, y: 0, z: knownMm(0, "finished floor datum") }, orientation: identityQuaternion() } } });
  const cw = createCatalogueComponent(standaloneCwRecordId({ size: "320", orientation: "vertical", stream: "supply" }), { id: "cw-supply", floorId: "ground", xMm: 1000, yMm: 1500, allowAssemblyOnly: true });
  const outlet = createCatalogueComponent("luna-supply", { id: "outlet-supply", floorId: "ground", xMm: 4500, yMm: 2600 });
  project = applyCommand(project, { type: "component.add", component: cw });
  project = applyCommand(project, { type: "component.add", component: outlet });
  const source = cw.ports.find((port) => port.interface.family === "semi-rigid-pe");
  const destination = outlet.ports[0];
  const family = routeFamilyForKind("semi-rigid-radial");
  return applyCommand(project, { type: "route.add", route: {
    id: "route-supply", floorId: "ground", system: "mvhr", stream: "supply", role: source.role,
    ductKind: family.id, connectionInterface: family.connectionInterface, parallelRunCount: 1,
    startAttachment: { componentId: cw.id, portId: source.id }, endAttachment: { componentId: outlet.id, portId: destination.id },
    points: [floorPortTransform(project, cw.id, source.id).positionMm, { x: 3000, y: 1800, z: unknownMm("route height not set") }, floorPortTransform(project, outlet.id, destination.id).positionMm],
  } });
}
