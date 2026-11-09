import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCommand, createProject, deserializeProject, floorPortTransform,
  identityQuaternion, knownMm, previewDuctRouteGeometry, serializeProject,
} from "../src/domain/spatial.mjs";
import { createCatalogueComponent, routeFamilyForKind } from "../src/editor/component-catalogue.mjs";
import { deriveHrvCeilingElbows } from "../src/editor/hrv-ceiling-elbows.mjs";
import { deriveDuctBodyGeometry } from "../src/editor/duct-body-geometry.mjs";
import { isEppPlanSegment } from "../src/domain/epp-plan-constraints.mjs";

function fixture(size = 160) {
  let project = applyCommand(createProject("manual-hrv-departure"), { type: "floor.add", floor: {
    id: "ground", name: "Ground", transform: {
      translationMm: { x: 0, y: 0, z: knownMm(0, "synthetic datum") }, orientation: identityQuaternion(),
    },
  } });
  for (const [record, id] of [
    [size === 160 ? "zehnder-q350-hrv-left-drawing-profile" : "zehnder-ca200-horizontal-left-drawing-profile", "unit"],
    [`generic-external-grille-combined-dn${size}`, "grille"],
  ]) project = applyCommand(project, { type: "component.add", component: createCatalogueComponent(record, {
    id, floorId: "ground", xMm: 2000, yMm: 2000,
  }) });
  project = applyCommand(project, { type: "component.rotateFloorZ", componentId: "unit", angleRad: Math.PI });
  project = applyCommand(project, { type: "component.rotateFloorZ", componentId: "grille", angleRad: Math.PI / 2 });
  const unit = project.components.find(c => c.id === "unit");
  const grille = project.components.find(c => c.id === "grille");
  const unitPort = unit.ports.find(p => p.stream === "intake");
  const grillePort = grille.ports.find(p => p.stream === "intake");
  const start = floorPortTransform(project, unit.id, unitPort.id).positionMm;
  const oldEnd = floorPortTransform(project, grille.id, grillePort.id).positionMm;
  project = applyCommand(project, { type: "component.moveXY", componentId: grille.id,
    xMm: grille.positionMm.x + start.x + 60 - oldEnd.x, yMm: grille.positionMm.y + start.y + 4000 - oldEnd.y });
  const end = floorPortTransform(project, grille.id, grillePort.id).positionMm;
  const family = routeFamilyForKind(`epp-rigid-dn${size}`);
  return { project, start, end, family,
    startAttachment: { componentId: unit.id, portId: unitPort.id },
    endAttachment: { componentId: grille.id, portId: grillePort.id } };
}

function routeValue(f, offset, reverse) {
  const points = [f.start, { ...f.start, x: f.start.x - offset, y: f.start.y + offset },
    { ...f.start, x: f.start.x - offset, y: f.start.y + 3000 },
    { ...f.end, y: f.start.y + 3000 }, f.end];
  return { id: "intake-route", floorId: "ground", system: "mvhr", stream: "intake", role: "Outdoor intake",
    ductKind: f.family.id, connectionInterface: f.family.connectionInterface, parallelRunCount: 1,
    startAttachment: reverse ? f.endAttachment : f.startAttachment,
    endAttachment: reverse ? f.startAttachment : f.endAttachment,
    points: reverse ? points.slice().reverse() : points };
}

for (const size of [125, 160]) for (const reverse of [false, true]) for (const offset of [100, 300, 450, 500, 800]) {
  test(`DN${size} manual unit departure preserves a ${offset} mm 45 degree offset ${reverse ? "in reverse" : "forwards"}`, () => {
    const f = fixture(size), route = routeValue(f, offset, reverse);
    const preview = previewDuctRouteGeometry(f.project, route);
    const committed = applyCommand(f.project, { type: "route.add", route });
    assert.deepEqual(preview, committed.routes[0], "preview and commit remain identical");
    const fromUnit = reverse ? preview.points.slice().reverse() : preview.points;
    assert.deepEqual(fromUnit[1], { ...f.start, x: f.start.x - offset, y: f.start.y + offset },
      "the explicit first corner must not become a forced straight lead");
    for (let i = 1; i < fromUnit.length; i++) assert.ok(isEppPlanSegment(fromUnit[i - 1], fromUnit[i]));
    const elbow = deriveHrvCeilingElbows([preview], f.project.components)[0];
    assert.ok(Math.abs(elbow.angleDegrees - 135) < 1e-6, "top elbow points along the drawn 45 degree departure");
    assert.deepEqual(previewDuctRouteGeometry(committed, preview), preview, "normalization is idempotent");
    assert.deepEqual(deserializeProject(serializeProject(committed)).routes, committed.routes);
    assert.equal(f.project.routes.length, 0, "the source project was not changed");
  });
}

test("short 45 degree intake departure clears the adjacent exhaust port instead of crossing it", () => {
  const f = fixture(), route = previewDuctRouteGeometry(f.project, routeValue(f, 300, false));
  const unit = f.project.components.find(c => c.id === "unit");
  const exhaust = unit.ports.find(p => p.stream === "exhaust");
  const port = floorPortTransform(f.project, unit.id, exhaust.id).positionMm;
  const centreline = deriveDuctBodyGeometry(route, f.family).sampledCentreline;
  const distance = (p, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  };
  const clearance = Math.min(...centreline.slice(1).map((p, i) => distance(port, centreline[i], p)));
  assert.ok(clearance > 160, `synthetic DN160 nominal bodies remain apart: ${clearance}`);
});


for (const size of [125, 160]) for (const reverse of [false, true]) {
  for (const [dx, dy] of [[10, 0], [-10, 0], [0, 10], [0, -10], [500, 0], [-500, 0], [0, 500], [0, -500]]) {
    test(`DN${size} ${reverse ? "reverse" : "forward"} departure survives a unit move of ${dx},${dy} mm`, () => {
      const f = fixture(size), value = routeValue(f, 300, reverse);
      const cornerIndex = reverse ? value.points.length - 2 : 1;
      value.points[cornerIndex].z = knownMm(2450, "synthetic corner elevation");
      const original = applyCommand(f.project, { type: "route.add", route: value });
      const unit = original.components.find(c => c.id === "unit");
      const command = { type: "component.moveXY", componentId: unit.id,
        xMm: unit.positionMm.x + dx, yMm: unit.positionMm.y + dy };
      const movedProject = { ...original, components: original.components.map(c => c.id === unit.id
        ? { ...c, positionMm: { ...c.positionMm, x: command.xMm, y: command.yMm } } : c) };
      const preview = previewDuctRouteGeometry(movedProject, original.routes[0]);
      const moved = applyCommand(original, command);
      assert.deepEqual(preview, moved.routes[0], "disposable drag and final command stay identical");
      const points = reverse ? preview.points.slice().reverse() : preview.points;
      assert.ok(Math.abs((points[1].x - points[0].x) + (points[1].y - points[0].y)) < 1e-6);
      assert.ok(points[1].x < points[0].x && points[1].y > points[0].y,
        "the preserved outlet still leaves down-left instead of crossing the next port");
      assert.deepEqual(points[1].z, value.points[cornerIndex].z, "moving in plan preserves the corner elevation");
      assert.deepEqual(points[0], floorPortTransform(moved, "unit", f.startAttachment.portId).positionMm);
      assert.deepEqual(deserializeProject(serializeProject(moved)).routes, moved.routes);
    });
  }
  test(`DN${size} ${reverse ? "reverse" : "forward"} Realign preserves the unit departure`, () => {
    const f = fixture(size), original = applyCommand(f.project, { type: "route.add", route: routeValue(f, 300, reverse) });
    const aligned = applyCommand(original, { type: "route.realignEppConnections", routeId: "intake-route" });
    const fromUnit = reverse ? aligned.routes[0].points.slice().reverse() : aligned.routes[0].points;
    assert.deepEqual(fromUnit[1], { ...f.start, x: f.start.x - 300, y: f.start.y + 300 });
    for (let i = 1; i < fromUnit.length; i++) assert.ok(isEppPlanSegment(fromUnit[i - 1], fromUnit[i]));
  });
}

