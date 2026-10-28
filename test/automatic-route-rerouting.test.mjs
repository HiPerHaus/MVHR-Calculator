import assert from "node:assert/strict";
import test from "node:test";

import { createCommandHistory, executeCommand, undoCommand } from "../src/domain/history.mjs";
import { applyCommand, createProject, deserializeProject, identityQuaternion, knownMm, serializeProject, unknownMm } from "../src/domain/spatial.mjs";
import { inspectAutomaticEppRouting } from "../src/editor/automatic-epp-routing.mjs";
import { inspectAutomaticRadialRouting } from "../src/editor/automatic-radial-routing.mjs";
import { inspectAutomaticRouteRerouting } from "../src/editor/automatic-route-rerouting.mjs";
import { createCatalogueComponent, routeFamilyForKind } from "../src/editor/component-catalogue.mjs";
import { createEquipmentAssembly } from "../src/editor/equipment-assemblies.mjs";
import { standaloneCwRecordId } from "../src/editor/standalone-cw.mjs";

test("explicit DN90 re-routing switches Direct to Building-aligned and back without changing topology", () => {
  let project = scaledFixture(rectangle());
  project = add(project, createCatalogueComponent(standaloneCwRecordId({ size: "320", orientation: "vertical", stream: "supply" }), {
    id: "cw-source", floorId: "ground", xMm: 1200, yMm: 1200, allowAssemblyOnly: true,
  }));
  project = add(project, createCatalogueComponent("luna-supply", { id: "outlet", floorId: "ground", xMm: 7200, yMm: 3800 }));
  const initial = inspectAutomaticRadialRouting(project, "ground").proposals[0];
  const directRoute = radialRoute(initial, "accepted-route");
  project = applyCommand(project, { type: "route.add", route: directRoute });
  const beforePreview = structuredClone(project);

  const aligned = inspectAutomaticRouteRerouting(project, "ground", ["accepted-route"], {
    system: "dn90", routingStyle: "building-aligned", buildingAxisRad: 0,
  });
  assert.equal(aligned.status, "ready");
  assert.deepEqual(project, beforePreview, "preview/cancel leaves accepted geometry unchanged");
  assert.equal(aligned.proposals[0].replacementRoute.id, "accepted-route");
  assert.deepEqual(aligned.proposals[0].replacementRoute.startAttachment, directRoute.startAttachment);
  assert.deepEqual(aligned.proposals[0].replacementRoute.endAttachment, directRoute.endAttachment);
  assert.ok(aligned.proposals[0].points.length >= 3);

  const history = executeCommand(createCommandHistory(project), {
    type: "route.replaceBatch", routes: aligned.proposals.map((proposal) => proposal.replacementRoute),
  });
  assert.notDeepEqual(history.present.routes[0].points, directRoute.points);
  assert.deepEqual(undoCommand(history).present, project, "the whole replacement is one undo step");

  const backToDirect = inspectAutomaticRouteRerouting(history.present, "ground", ["accepted-route"], {
    system: "dn90", routingStyle: "direct",
  });
  assert.equal(backToDirect.status, "ready");
  const restored = applyCommand(history.present, { type: "route.replaceBatch", routes: [backToDirect.proposals[0].replacementRoute] });
  assert.equal(restored.routes[0].points.length, 2);
  assert.deepEqual(deserializeProject(serializeProject(restored)).routes, restored.routes);
});

test("rotated Building-aligned re-routing follows the confirmed building axis", () => {
  const angle = Math.PI / 6;
  const outline = rectangle().map((point) => rotate(point, angle));
  let project = scaledFixture(outline);
  const source = rotate({ x: 1200, y: 1200 }, angle);
  const destination = rotate({ x: 7200, y: 3800 }, angle);
  project = add(project, createCatalogueComponent(standaloneCwRecordId({ size: "320", orientation: "vertical", stream: "supply" }), {
    id: "cw-source", floorId: "ground", xMm: source.x, yMm: source.y, allowAssemblyOnly: true,
  }));
  project = add(project, createCatalogueComponent("luna-supply", { id: "outlet", floorId: "ground", xMm: destination.x, yMm: destination.y }));
  const direct = inspectAutomaticRadialRouting(project, "ground").proposals[0];
  project = applyCommand(project, { type: "route.add", route: radialRoute(direct, "rotated-route") });

  const preview = inspectAutomaticRouteRerouting(project, "ground", ["rotated-route"], {
    system: "dn90", routingStyle: "building-aligned", buildingAxisRad: angle,
  });
  assert.equal(preview.status, "ready");
  for (let index = 1; index < preview.proposals[0].points.length; index += 1) {
    const a = rotate(preview.proposals[0].points[index - 1], -angle);
    const b = rotate(preview.proposals[0].points[index], -angle);
    assert.ok(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6);
  }
});

test("selective replacement preserves manual routes and fails closed for custom vertical profiles", () => {
  let project = scaledFixture(rectangle());
  project = add(project, createCatalogueComponent(standaloneCwRecordId({ size: "320", orientation: "vertical", stream: "supply" }), {
    id: "cw-source", floorId: "ground", xMm: 1000, yMm: 1000, allowAssemblyOnly: true,
  }));
  project = add(project, createCatalogueComponent("luna-supply", { id: "outlet-a", floorId: "ground", xMm: 7000, yMm: 1600 }));
  project = add(project, createCatalogueComponent("luna-supply", { id: "outlet-b", floorId: "ground", xMm: 7000, yMm: 3600 }));
  const initial = inspectAutomaticRadialRouting(project, "ground").proposals;
  project = applyCommand(project, { type: "route.addBatch", routes: initial.map((proposal, index) => radialRoute(proposal, `route-${index + 1}`)) });
  project = applyCommand(project, { type: "route.add", route: {
    id: "manual-unattached", floorId: "ground", system: "mvhr", stream: "supply", role: null,
    ductKind: "generic-duct", parallelRunCount: 1, startAttachment: null, endAttachment: null,
    points: [{ x: 1000, y: 4500, z: unknownMm("manual") }, { x: 3000, y: 4500, z: unknownMm("manual") }],
  } });
  const manualBefore = structuredClone(project.routes.find((route) => route.id === "manual-unattached"));
  const selectedBefore = structuredClone(project.routes.find((route) => route.id === "route-1"));

  const preview = inspectAutomaticRouteRerouting(project, "ground", ["route-1"], {
    system: "dn90", routingStyle: "building-aligned", buildingAxisRad: 0,
  });
  assert.equal(preview.proposals.length, 1);
  const replaced = applyCommand(project, { type: "route.replaceBatch", routes: [preview.proposals[0].replacementRoute] });
  assert.deepEqual(replaced.routes.find((route) => route.id === "manual-unattached"), manualBefore);
  assert.deepEqual(replaced.routes.find((route) => route.id === "route-2"), project.routes.find((route) => route.id === "route-2"));
  assert.notDeepEqual(replaced.routes.find((route) => route.id === "route-1").points, selectedBefore.points);

  const custom = structuredClone(replaced.routes.find((route) => route.id === "route-1"));
  custom.points = [custom.points[0],
    { x: 3500, y: 1200, z: knownMm(2300, "custom rise") },
    { x: 5000, y: 1200, z: knownMm(2600, "custom drop") },
    custom.points.at(-1)];
  const customProject = applyCommand(replaced, { type: "route.replaceBatch", routes: [custom] });
  const blocked = inspectAutomaticRouteRerouting(customProject, "ground", ["route-1"], {
    system: "dn90", routingStyle: "direct",
  });
  assert.equal(blocked.proposals.length, 0);
  assert.match(blocked.unresolved[0].reason, /custom interior vertical profile/);
  const atomicBlocked = inspectAutomaticRouteRerouting(customProject, "ground", ["route-1", "route-2"], {
    system: "dn90", routingStyle: "direct",
  });
  assert.equal(atomicBlocked.proposals.length, 0, "one unresolved selection prevents a partial replacement batch");
  assert.match(atomicBlocked.message, /Nothing will be changed/);
});

test("EPP re-routing preserves explicit endpoints, duct family and occupied topology", () => {
  let project = scaledFixture(rectangle());
  project = add(project, createCatalogueComponent("synthetic-mvhr-placeholder", { id: "unit", floorId: "ground", xMm: 1200, yMm: 2200 }));
  project = applyCommand(project, { type: "equipmentAssembly.add", ...createEquipmentAssembly("generic-remote-supply-attenuation-set", {
    id: "supply-set", floorId: "ground", xMm: 7000, yMm: 3200,
  }) });
  const choose = inspectAutomaticEppRouting(project, "ground");
  const start = choose.endpoints.find((endpoint) => endpoint.componentId === "unit" && endpoint.stream === "supply");
  const end = inspectAutomaticEppRouting(project, "ground", { startKey: start.key }).compatibleEnds.find((endpoint) => endpoint.componentId.endsWith("end-plate"));
  const direct = inspectAutomaticEppRouting(project, "ground", { startKey: start.key, endKey: end.key }).proposal;
  project = applyCommand(project, { type: "route.add", route: eppRoute(direct, "epp-route") });

  const aligned = inspectAutomaticRouteRerouting(project, "ground", ["epp-route"], {
    system: "epp", routingStyle: "building-aligned", buildingAxisRad: 0,
  });
  assert.equal(aligned.status, "ready");
  const replacement = aligned.proposals[0].replacementRoute;
  assert.equal(replacement.ductKind, project.routes[0].ductKind);
  assert.deepEqual(replacement.startAttachment, project.routes[0].startAttachment);
  assert.deepEqual(replacement.endAttachment, project.routes[0].endAttachment);
  const applied = applyCommand(project, { type: "route.replaceBatch", routes: [replacement] });
  assert.equal(applied.routes.length, 1);
  assert.throws(() => applyCommand(project, { type: "route.replaceBatch", routes: [{ ...replacement, stream: "extract" }] }), /cannot change stream/);
});

function radialRoute(proposal, id) {
  const family = routeFamilyForKind("semi-rigid-radial");
  return {
    id, floorId: "ground", system: proposal.system, stream: proposal.stream, role: proposal.role,
    ductKind: family.id, connectionInterface: family.connectionInterface, parallelRunCount: 1,
    startAttachment: { componentId: proposal.source.componentId, portId: proposal.source.portId },
    endAttachment: { componentId: proposal.destination.componentId, portId: proposal.destination.portId },
    points: proposal.points.map((point) => ({ ...point, z: unknownMm("automatic route height not set") })),
  };
}

function eppRoute(proposal, id) {
  return {
    id, floorId: "ground", system: proposal.system, stream: proposal.stream, role: proposal.role,
    ductKind: proposal.ductKind, connectionInterface: proposal.connectionInterface, parallelRunCount: 1,
    startAttachment: { componentId: proposal.source.componentId, portId: proposal.source.portId },
    endAttachment: { componentId: proposal.destination.componentId, portId: proposal.destination.portId },
    points: proposal.points.map((point) => ({ ...point, z: unknownMm("automatic EPP height not set") })),
  };
}

function add(project, component) { return applyCommand(project, { type: "component.add", component }); }
function scaledFixture(outline) {
  let project = createProject("automatic-route-rerouting");
  project = applyCommand(project, { type: "floor.add", floor: { id: "ground", name: "Ground", transform: { translationMm: { x: 0, y: 0, z: knownMm(0, "floor datum") }, orientation: identityQuaternion() } } });
  project = applyCommand(project, { type: "floorArea.create", outline: { id: "outline", floorId: "ground", name: "Building outline", geometrySource: "manual-floor-area-outline", purpose: "preliminary-quoting", areaConvention: "closed-plan-outline", measurementBasis: "floor-local-plan-mm", holes: [], vertices: outline.map((point, index) => ({ id: `v-${index}`, positionMm: { ...point, z: knownMm(0, "plan") } })) } });
  project = applyCommand(project, { type: "reference.addImage", asset: { id: "asset", kind: "image", fileName: "fixture.png", mediaType: "image/png", byteLength: 3, sha256: "0".repeat(64), widthPx: 1000, heightPx: 500, dataUrl: "data:image/png;base64,AAAA" }, reference: { id: "reference", floorId: "ground", assetId: "asset", visible: true, locked: true, opacity: 0.5, transform: { translationMm: { x: 0, y: 0 }, rotationRad: 0, scaleMmPerPixel: knownMm(10, "fixture scale") }, calibration: null } });
  return applyCommand(project, { type: "reference.calibrate", referenceId: "reference", sourcePointApx: { x: 0, y: 0 }, sourcePointBpx: { x: 1000, y: 0 }, knownDistanceMm: 10000, inputUnit: "m", acceptedAtUtc: "2026-10-28T00:00:00.000Z", previewScaleMmPerPixel: 10, rescaleFloorModel: false });
}
function rectangle() { return [{ x: 0, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 5000 }, { x: 0, y: 5000 }]; }
function rotate(point, angle) { return { x: point.x * Math.cos(angle) - point.y * Math.sin(angle), y: point.x * Math.sin(angle) + point.y * Math.cos(angle) }; }
