import assert from "node:assert/strict";
import test from "node:test";

import { createCommandHistory, executeCommand, undoCommand } from "../src/domain/history.mjs";
import { applyCommand, assumedMm, createProject, deserializeProject, floorPortTransform, identityQuaternion, knownMm, serializeProject, unknownMm } from "../src/domain/spatial.mjs";
import { createCatalogueComponent, routeFamilyForKind } from "../src/editor/component-catalogue.mjs";
import { createEquipmentAssembly } from "../src/editor/equipment-assemblies.mjs";
import { standaloneCwRecordId } from "../src/editor/standalone-cw.mjs";
import { createDefaultThreeDView, createThreeDDrawingScene, renderThreeDDrawingSvg } from "../src/sheets/three-d-drawing.mjs";

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

test("individual component and route heights override floor defaults and survive undo and reopen", () => {
  let history = executeCommand(createCommandHistory(routedFixture()), {
    type: "threeD.applyFloorHeights",
    floorId: "ground",
    equipmentElevationMm: assumedMm(2200, "floor equipment default"),
    outletElevationMm: assumedMm(2400, "floor outlet default"),
    ductElevationMm: assumedMm(2600, "floor route default"),
  });
  history = executeCommand(history, {
    type: "component.setElevation",
    componentId: "outlet-supply",
    elevationMm: knownMm(2475, "measured terminal centre"),
  });
  const beforeRouteOverride = history.present;
  history = executeCommand(history, {
    type: "route.setRoutingElevation",
    routeId: "route-supply",
    elevationMm: knownMm(2850, "measured route centreline"),
  });
  const project = history.present;
  assert.equal(project.components.find((component) => component.id === "cw-supply").positionMm.z.valueMm, 2200);
  assert.equal(project.components.find((component) => component.id === "outlet-supply").positionMm.z.valueMm, 2475);
  assert.equal(project.routes[0].routingElevationMm.valueMm, 2850);
  assert.deepEqual(undoCommand(history).present, beforeRouteOverride);

  const reopened = deserializeProject(serializeProject(project));
  assert.equal(reopened.routes[0].routingElevationMm.valueMm, 2850);
  const scene = createThreeDDrawingScene(reopened, "ground");
  assert.equal(scene.routes[0].verticalTransitionCount, 2);
  assert.deepEqual(scene.routes[0].points.map((point) => point.z), [2514.3, 2850, 2850, 2850, 2475]);
  assert.equal(scene.heightItems.find((item) => item.id === "outlet-supply").measurement.state, "known");
  assert.equal(scene.heightItems.find((item) => item.id === "route-supply").measurement.valueMm, 2850);
});

test("grouped equipment exposes both a shared height convenience and individual member setout", () => {
  const value = createEquipmentAssembly("generic-remote-supply-attenuation-set", {
    id: "assembly-supply",
    floorId: "ground",
    xMm: 2000,
    yMm: 1800,
  });
  let project = applyCommand(projectWithFloor(), { type: "equipmentAssembly.add", ...value });
  project = applyCommand(project, {
    type: "equipmentAssembly.setElevation",
    assemblyId: value.assembly.id,
    elevationMm: assumedMm(2200, "assembly default"),
  });
  project = applyCommand(project, {
    type: "equipmentAssembly.setMemberElevation",
    assemblyId: value.assembly.id,
    componentId: value.components[1].id,
    elevationMm: knownMm(2350, "measured attenuator setout"),
  });
  const scene = createThreeDDrawingScene(deserializeProject(serializeProject(project)), "ground");
  const assemblyItem = scene.heightItems.find((item) => item.kind === "assembly");
  const memberItems = scene.heightItems.filter((item) => item.kind === "assembly-component");
  assert.equal(assemblyItem.measurement.state, "mixed");
  assert.equal(memberItems.length, 3);
  assert.equal(memberItems.find((item) => item.id === value.components[1].id).measurement.valueMm, 2350);
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

test("solid route rendering separates twin runs visually, preserves one centreline and follows the chosen view", () => {
  let project = applyCommand(routedFixture(), {
    type: "threeD.applyFloorHeights",
    floorId: "ground",
    equipmentElevationMm: knownMm(2100, "measured setout"),
    outletElevationMm: knownMm(2450, "measured setout"),
    ductElevationMm: knownMm(2700, "measured setout"),
  });
  project = applyCommand(project, { type: "route.setParallelRunCount", routeId: "route-supply", parallelRunCount: 2 });
  const scene = createThreeDDrawingScene(project, "ground");
  assert.equal(scene.routes[0].parallelRunCount, 2);
  assert.equal(scene.routes[0].points.length, 5);
  const baseView = createDefaultThreeDView();
  const base = renderThreeDDrawingSvg(scene, { view: baseView });
  const orbited = renderThreeDDrawingSvg(scene, { view: { ...baseView, azimuthRad: baseView.azimuthRad + 0.4, zoom: 1.25, panX: 20, panY: -10 } });
  assert.equal((base.match(/data-route-run=/g) ?? []).length, 2);
  assert.match(base, / Q /);
  assert.match(base, /data-component-port=/);
  assert.match(base, /visually separated parallel runs are schematic/);
  assert.notEqual(orbited, base);
  assert.equal(renderThreeDDrawingSvg(createThreeDDrawingScene(deserializeProject(serializeProject(project)), "ground"), { view: baseView }), base);
});

function routedFixture() {
  let project = projectWithFloor();
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

function projectWithFloor() {
  return applyCommand(createProject("three-d-fixture"), { type: "floor.add", floor: { id: "ground", name: "Ground", transform: { translationMm: { x: 0, y: 0, z: knownMm(0, "finished floor datum") }, orientation: identityQuaternion() } } });
}
