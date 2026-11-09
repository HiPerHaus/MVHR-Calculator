import assert from "node:assert/strict";
import test from "node:test";
import { applyCommand, createProject, identityQuaternion, knownMm, unknownMm, floorPortTransform, previewDuctRouteGeometry } from "../src/domain/spatial.mjs";
import { createCatalogueComponent, routeFamilyForKind } from "../src/editor/component-catalogue.mjs";
import { activateMechanicalTool, createMechanicalInteractionState, handleMechanicalCanvasClick, mechanicalRoutePreview, updateMechanicalPointer } from "../src/editor/mechanical-controller.mjs";
import { deriveHrvCeilingElbows } from "../src/editor/hrv-ceiling-elbows.mjs";
import { hasHrvCeilingElbow } from "../src/domain/epp-plan-constraints.mjs";

function fixture() {
  let project = applyCommand(createProject("route-preview"), { type: "floor.add", floor: { id: "floor-ground", name: "Ground", transform: { translationMm: { x: 0, y: 0, z: knownMm(0, "test") }, orientation: identityQuaternion() } } });
  for (const [record, id, xMm, yMm] of [["zehnder-q350-hrv-left-drawing-profile", "unit", 0, 0], ["generic-external-grille-combined-dn160", "grille", 4000, 2500]]) {
    project = applyCommand(project, { type: "component.add", component: createCatalogueComponent(record, { id, floorId: "floor-ground", xMm, yMm }) });
  }
  return project;
}
function endpoint(project, componentId) {
  const component = project.components.find(value => value.id === componentId);
  const port = component.ports.find(value => value.stream === "intake");
  const transform = floorPortTransform(project, componentId, port.id);
  return { point: transform.positionMm, hit: { kind: "port", componentId, portId: port.id, system: port.system, stream: port.stream, role: port.role, interface: port.interface, direction: transform.direction, ceilingElbow: hasHrvCeilingElbow(component, port) } };
}
function routeFromIntent(intent) {
  return { id: "preview-run", floorId: "floor-ground", ductKind: intent.ductKind, system: intent.system, stream: intent.stream, role: intent.role, connectionInterface: intent.connectionInterface, parallelRunCount: 1, startAttachment: intent.start, endAttachment: intent.end, points: intent.points.map(point => ({ ...point, z: unknownMm("route preview elevation not set") })) };
}

test("EPP hover preview exactly matches commit and top elbows in either drawing direction", () => {
  for (const reverse of [false, true]) for (const rotation of [0, Math.PI / 2]) {
    let project = fixture();
    if (rotation) project = applyCommand(project, { type: "component.rotateFloorZ", componentId: "unit", angleRad: rotation });
    const start = endpoint(project, reverse ? "grille" : "unit"), end = endpoint(project, reverse ? "unit" : "grille");
    let state = activateMechanicalTool(createMechanicalInteractionState(), "route", { ductKind: "epp-rigid-dn160" });
    state = handleMechanicalCanvasClick(state, start).state;
    state = handleMechanicalCanvasClick(state, { point: { x: start.point.x + 120, y: start.point.y + 120 } }).state;
    const before = structuredClone({ project, state });
    const previewIntent = mechanicalRoutePreview(state, end);
    const commitIntent = handleMechanicalCanvasClick(state, end).intent;
    assert.deepEqual(previewIntent, commitIntent);
    const route = routeFromIntent(previewIntent);
    const preview = previewDuctRouteGeometry(project, route);
    const committed = applyCommand(project, { type: "route.add", route }).routes[0];
    assert.deepEqual(preview, committed);
    assert.deepEqual(deriveHrvCeilingElbows([preview], project.components), deriveHrvCeilingElbows([committed], project.components));
    assert.equal(deriveHrvCeilingElbows([preview], project.components).length, 1);
    assert.deepEqual({ project, state }, before, "preview and click must not mutate their inputs");
  }
});

test("free previews stay snapped while occupied, same and incompatible ports never become attachments", () => {
  const project = fixture(), start = endpoint(project, "unit"), end = endpoint(project, "grille");
  let state = handleMechanicalCanvasClick(activateMechanicalTool(createMechanicalInteractionState(), "route", { ductKind: "epp-rigid-dn160" }), start).state;
  state = updateMechanicalPointer(state, { x: 1400, y: 900 });
  for (const hit of [null, start.hit, { ...end.hit, occupied: true }, { ...end.hit, stream: "supply" }]) {
    const preview = mechanicalRoutePreview(state, { hit });
    assert.equal(preview.end, null);
    assert.ok(Math.hypot(preview.points.at(-1).x - state.pointer.x, preview.points.at(-1).y - state.pointer.y) < 1e-6);
  }
  assert.equal(mechanicalRoutePreview(createMechanicalInteractionState()), null);
});

test("disposable moved-component and edited-point EPP previews match their commands", () => {
  let project = fixture();
  const start = endpoint(project, "unit"), end = endpoint(project, "grille");
  const family = routeFamilyForKind("epp-rigid-dn160");
  const route = { id: "preview-run", floorId: "floor-ground", system: "mvhr", stream: "intake", role: "Outdoor intake", ductKind: family.id, connectionInterface: family.connectionInterface, startAttachment: { componentId: "unit", portId: start.hit.portId }, endAttachment: { componentId: "grille", portId: end.hit.portId }, points: [start.point, { x: -1500, y: 1500, z: unknownMm("test") }, end.point] };
  project = applyCommand(project, { type: "route.add", route });
  const before = structuredClone(project);
  for (const componentId of ["unit", "grille"]) {
    const command = { type: "component.moveXY", componentId, xMm: 1700, yMm: 2700 };
    const movedProject = { ...project, components: project.components.map(component => component.id === componentId ? { ...component, positionMm: { ...component.positionMm, x: command.xMm, y: command.yMm } } : component) };
    const preview = previewDuctRouteGeometry(movedProject, project.routes[0]);
    assert.deepEqual(preview, applyCommand(project, command).routes[0]);
  }
  const editedRoute = { ...project.routes[0], points: project.routes[0].points.map((point, index) => index === 1 ? { ...point, x: 937, y: 1423 } : point) };
  assert.deepEqual(previewDuctRouteGeometry(project, editedRoute), applyCommand(project, { type: "route.movePoint", routeId: route.id, pointIndex: 1, xMm: 937, yMm: 1423 }).routes[0]);
  assert.deepEqual(project, before);
});
