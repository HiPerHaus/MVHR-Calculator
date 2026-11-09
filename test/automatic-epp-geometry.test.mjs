import assert from "node:assert/strict";
import test from "node:test";
import { applyCommand, createProject, floorPortTransform, identityQuaternion, knownMm, unknownMm } from "../src/domain/spatial.mjs";
import { createCatalogueComponent, routeFamilyForKind } from "../src/editor/component-catalogue.mjs";
import { inspectAutomaticEppGeometry } from "../src/editor/automatic-epp-geometry.mjs";
import { validateDuctPathInsideOutline } from "../src/editor/automatic-radial-routing.mjs";
import { deriveSweptCentreline } from "../src/editor/duct-body-geometry.mjs";

const polygon = [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 6000 }, { x: 0, y: 6000 }];
const square = (x, y, width = 10) => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + width }, { x, y: y + width }];
const plan = points => points.map(({ x, y }) => ({ x, y }));

function fixture() {
  return applyCommand(createProject("epp-geometry"), { type: "floor.add", floor: { id: "ground", name: "Ground", transform: { translationMm: { x: 0, y: 0, z: knownMm(0, "test datum") }, orientation: identityQuaternion() } } });
}
function route(points, overrides = {}) {
  return { id: "epp-route", floorId: "ground", system: "mvhr", stream: "supply", role: "Dwelling supply", ductKind: "epp-rigid-dn160", connectionInterface: routeFamilyForKind("epp-rigid-dn160").connectionInterface, parallelRunCount: 1, startAttachment: null, endAttachment: null, points: points.map(point => ({ ...point, z: unknownMm("test elevation unknown") })), ...overrides };
}
function externalFixture(reverse = false) {
  let project = fixture();
  const component = createCatalogueComponent("generic-external-grille-intake-dn160", { id: "terminal", floorId: "ground", xMm: 10250, yMm: 2500 });
  project = applyCommand(project, { type: "component.add", component });
  const port = component.ports.find(port => port.stream === "intake");
  const end = floorPortTransform(project, component.id, port.id).positionMm;
  const endpoint = { componentId: component.id, portId: port.id };
  const points = [{ x: 1000, y: end.y }, end];
  if (reverse) points.reverse();
  return { project, route: route(points, { stream: "intake", role: "Outdoor intake", startAttachment: reverse ? endpoint : null, endAttachment: reverse ? null : endpoint }) };
}

test("final rigid elbow body rejects an exclusion missed by both planner controls and generic curve", () => {
  const project = fixture();
  const input = route([{ x: 1000, y: 1000 }, { x: 5000, y: 1000 }, { x: 5000, y: 5000 }]);
  const options = { forbiddenPolygons: [square(4895, 1100)] };
  assert.equal(validateDuctPathInsideOutline(input.points, polygon, 160, options), true);
  assert.equal(validateDuctPathInsideOutline(deriveSweptCentreline(input.points).points, polygon, 160, options), true);
  const before = structuredClone({ project, input });
  const result = inspectAutomaticEppGeometry(project, input, polygon, options);
  assert.equal(result.valid, false);
  assert.ok(result.body.elbows.some(elbow => elbow.drawable));
  assert.deepEqual({ project, input }, before);
});

test("final validation uses known outside diameter while preserving unknown elevation", () => {
  const project = fixture();
  const input = route([{ x: 1000, y: 100 }, { x: 5000, y: 100 }]);
  assert.equal(inspectAutomaticEppGeometry(project, input, polygon).valid, true);
  const wider = { ...input, connectionInterface: { ...input.connectionInterface, outsideDiameterMm: 240 } };
  const checked = inspectAutomaticEppGeometry(project, wider, polygon);
  assert.equal(checked.valid, false);
  assert.equal(checked.body.diameterBasis, "outside");
  assert.ok(checked.route.points.every(point => point.z.state === "unknown"));
});

for (const reverse of [false, true]) {
  test(`only selected external terminal straight leg may cross outline ${reverse ? "at start" : "at end"}`, () => {
    const { project, route: input } = externalFixture(reverse);
    const before = structuredClone(project);
    const checked = inspectAutomaticEppGeometry(project, input, polygon);
    assert.equal(checked.valid, true);
    assert.equal(checked.exteriorTermination, true);
    const committed = applyCommand(project, { type: "route.add", route: input });
    assert.deepEqual(checked.route, committed.routes[0]);
    assert.deepEqual(project, before);
    assert.equal(inspectAutomaticEppGeometry(project, input, polygon, { forbiddenPolygons: [square(10050, 2490, 20)] }).valid, false, "outside terminal leg still respects exclusions");
    assert.equal(inspectAutomaticEppGeometry(project, input, polygon, { blockedSegments: [{ start: { x: 10100, y: 2300 }, end: { x: 10100, y: 2700 }, radiusMm: 45 }], clearSpacingMm: 25 }).valid, false, "outside terminal leg still respects duct clearance");
    const unbound = { ...input, startAttachment: null, endAttachment: null };
    assert.equal(inspectAutomaticEppGeometry(project, unbound, polygon).valid, false, "unbound outside endpoints have no exception");
  });
}

test("external terminal exception cannot skip a concave outline and re-enter the building", () => {
  const { project, route: input } = externalFixture();
  const concave = [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 6000 }, { x: 7000, y: 6000 }, { x: 7000, y: 1000 }, { x: 5000, y: 1000 }, { x: 5000, y: 6000 }, { x: 0, y: 6000 }];
  assert.equal(inspectAutomaticEppGeometry(project, input, concave).valid, false);
});

test("normalization and final body stay equal to commit for HRV lead compaction", () => {
  let project = fixture();
  const unit = createCatalogueComponent("synthetic-mvhr-placeholder", { id: "unit", floorId: "ground", xMm: 2000, yMm: 2000 });
  project = applyCommand(project, { type: "component.add", component: unit });
  const port = unit.ports.find(port => port.stream === "supply");
  const origin = floorPortTransform(project, unit.id, port.id).positionMm;
  const input = route([origin, { x: origin.x, y: origin.y + 500 }, { x: origin.x + 1500, y: origin.y + 500 }, { x: origin.x + 3500, y: origin.y + 1500 }], { startAttachment: { componentId: unit.id, portId: port.id } });
  const checked = inspectAutomaticEppGeometry(project, input, polygon);
  assert.equal(checked.valid, true);
  assert.notDeepEqual(plan(checked.route.points), plan(input.points), "the exact final HRV lead differs from planner controls");
  assert.deepEqual(checked.route, applyCommand(project, { type: "route.add", route: input }).routes[0]);
});

test("both twin drawing lanes must fit, and existing twin lanes reserve their actual clearance", async () => {
  const { routingCoordinationInputs } = await import("../src/editor/routing-coordination.mjs");
  let project = fixture();
  const tooCloseToBoundary = route([{ x: 500, y: 100 }, { x: 4500, y: 100 }], { parallelRunCount: 2 });
  assert.equal(inspectAutomaticEppGeometry(project, tooCloseToBoundary, polygon).valid, false);
  const existing = route([{ x: 500, y: 1500 }, { x: 4500, y: 1500 }], { parallelRunCount: 2 });
  project = applyCommand(project, { type: "route.add", route: existing });
  const candidate = route([{ x: 500, y: 1750 }, { x: 4500, y: 1750 }], { id: "single-candidate" });
  const options = routingCoordinationInputs(project, "ground");
  assert.equal(inspectAutomaticEppGeometry(project, candidate, polygon, options).valid, false);
});

test("terminal exception rejects a tangent or nearby unrelated concave boundary", () => {
  const { project, route: input } = externalFixture();
  const tangent = [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 6000 }, { x: 5200, y: 6000 }, { x: 5000, y: 2500 }, { x: 4800, y: 6000 }, { x: 0, y: 6000 }];
  assert.equal(inspectAutomaticEppGeometry(project, input, tangent).valid, false);
  const nearby = tangent.map(point => point.x === 5000 ? { ...point, y: 2570 } : point);
  assert.equal(inspectAutomaticEppGeometry(project, input, nearby).valid, false, "centerline misses the notch but full body does not");
});
