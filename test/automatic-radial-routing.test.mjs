import assert from "node:assert/strict";
import test from "node:test";

import { createCommandHistory, executeCommand, undoCommand } from "../src/domain/history.mjs";
import { applyCommand, createProject, deserializeProject, identityQuaternion, knownMm, serializeProject, unknownMm } from "../src/domain/spatial.mjs";
import { createCatalogueComponent, routeFamilyForKind } from "../src/editor/component-catalogue.mjs";
import { inspectAutomaticRadialRouting, validateDuctPathInsideOutline } from "../src/editor/automatic-radial-routing.mjs";
import { standaloneCwRecordId } from "../src/editor/standalone-cw.mjs";

test("automatic DN90 routing keeps its swept full-width path inside a concave scaled outline", () => {
  let project = scaledFixture(concaveOutline());
  project = add(project, createCatalogueComponent(standaloneCwRecordId({ size: "320", orientation: "vertical", stream: "supply" }), {
    id: "cw-supply", floorId: "ground", xMm: 1000, yMm: 3000, allowAssemblyOnly: true,
  }));
  project = add(project, createCatalogueComponent("luna-supply", {
    id: "outlet-supply", floorId: "ground", xMm: 5000, yMm: 3000,
  }));

  const preview = inspectAutomaticRadialRouting(project, "ground", { gridSpacingMm: 100 });
  assert.equal(preview.status, "ready");
  assert.equal(preview.proposals.length, 1);
  assert.ok(preview.proposals[0].points.length > 2, "concavity requires a detour");
  assert.equal(preview.proposals[0].stream, "supply");
  assert.equal(preview.proposals[0].diameterMm, 90);
  assert.equal(validateDuctPathInsideOutline(preview.proposals[0].points, concaveOutline()), true);
});

test("routing reports scale, capacity and full-width containment blockers without mutating the project", () => {
  let unscaled = baseFixture(rectangleOutline());
  unscaled = add(unscaled, createCatalogueComponent("luna-supply", {
    id: "outlet", floorId: "ground", xMm: 3000, yMm: 2000,
  }));
  const before = structuredClone(unscaled);
  const scaleBlocked = inspectAutomaticRadialRouting(unscaled, "ground");
  assert.equal(scaleBlocked.status, "blocked");
  assert.match(scaleBlocked.notes[0], /Calibrate/);
  assert.deepEqual(unscaled, before);

  const noSource = inspectAutomaticRadialRouting(scaledFixture(rectangleOutline(), [unscaled.components[0]]), "ground");
  assert.equal(noSource.status, "partial");
  assert.match(noSource.unresolved[0].reason, /No compatible free DN90/);

  assert.equal(validateDuctPathInsideOutline([{ x: 20, y: 200 }, { x: 1000, y: 200 }], rectangleOutline()), false);
});

test("batch application is one undo step, preserves existing routes and rejects duplicate capacity atomically", () => {
  let project = scaledFixture(rectangleOutline());
  project = applyCommand(project, { type: "route.add", route: {
    id: "manual-route-existing", floorId: "ground", system: "mvhr", stream: "supply", role: null,
    ductKind: "generic-duct", parallelRunCount: 1, startAttachment: null, endAttachment: null,
    points: [{ x: 800, y: 500, z: unknownMm("manual route height not set") }, { x: 1800, y: 500, z: unknownMm("manual route height not set") }],
  } });
  const manualRoute = structuredClone(project.routes[0]);
  project = add(project, createCatalogueComponent(standaloneCwRecordId({ size: "320", orientation: "vertical", stream: "supply" }), {
    id: "cw-source", floorId: "ground", xMm: 1000, yMm: 1800, allowAssemblyOnly: true,
  }));
  for (const [id, y] of [["outlet-a", 1200], ["outlet-b", 2600]]) {
    project = add(project, createCatalogueComponent("luna-supply", { id, floorId: "ground", xMm: 5000, yMm: y }));
  }
  const preview = inspectAutomaticRadialRouting(project, "ground");
  assert.equal(preview.proposals.length, 2);
  const routes = preview.proposals.map((proposal, index) => routeFromProposal(proposal, `auto-${index + 1}`));
  const history = executeCommand(createCommandHistory(project), { type: "route.addBatch", routes });
  assert.equal(history.present.routes.length, 3);
  assert.deepEqual(history.present.routes[0], manualRoute);
  assert.deepEqual(undoCommand(history).present, project);
  assert.equal(inspectAutomaticRadialRouting(history.present, "ground").status, "nothing-to-route");
  const reopened = deserializeProject(serializeProject(history.present));
  assert.deepEqual(reopened.routes, history.present.routes);
  assert.deepEqual(reopened.routes[0], manualRoute);
  assert.equal(inspectAutomaticRadialRouting(reopened, "ground").status, "nothing-to-route");

  const duplicate = structuredClone(routes[1]);
  duplicate.id = "auto-duplicate";
  duplicate.startAttachment = structuredClone(routes[0].startAttachment);
  assert.throws(() => applyCommand(project, { type: "route.addBatch", routes: [routes[0], duplicate] }), /Port is already occupied/);
  assert.deepEqual(project.routes, [manualRoute]);
});

function routeFromProposal(proposal, id) {
  const family = routeFamilyForKind("semi-rigid-radial");
  return {
    id, floorId: "ground", system: proposal.system, stream: proposal.stream, role: proposal.role,
    ductKind: family.id, connectionInterface: family.connectionInterface, parallelRunCount: 1,
    startAttachment: { componentId: proposal.source.componentId, portId: proposal.source.portId },
    endAttachment: { componentId: proposal.destination.componentId, portId: proposal.destination.portId },
    points: proposal.points.map((point) => ({ ...point, z: unknownMm("automatic route height not set") })),
  };
}

function add(project, component) { return applyCommand(project, { type: "component.add", component }); }

function scaledFixture(outline, components = []) {
  let project = baseFixture(outline);
  project = applyCommand(project, {
    type: "reference.addImage",
    asset: { id: "asset", kind: "image", fileName: "fixture.png", mediaType: "image/png", byteLength: 3, sha256: "0".repeat(64), widthPx: 1000, heightPx: 500, dataUrl: "data:image/png;base64,AAAA" },
    reference: { id: "reference", floorId: "ground", assetId: "asset", visible: true, locked: true, opacity: 0.5,
      transform: { translationMm: { x: 0, y: 0 }, rotationRad: 0, scaleMmPerPixel: knownMm(10, "fixture scale") }, calibration: null },
  });
  project = applyCommand(project, { type: "reference.calibrate", referenceId: "reference", sourcePointApx: { x: 0, y: 0 }, sourcePointBpx: { x: 1000, y: 0 }, knownDistanceMm: 10000, inputUnit: "m", acceptedAtUtc: "2026-10-24T00:00:00.000Z", previewScaleMmPerPixel: 10, rescaleFloorModel: false });
  for (const component of components) project = add(project, component);
  return project;
}

function baseFixture(points) {
  let project = createProject("automatic-radial-routing");
  project = applyCommand(project, { type: "floor.add", floor: { id: "ground", name: "Ground", transform: { translationMm: { x: 0, y: 0, z: knownMm(0, "floor datum") }, orientation: identityQuaternion() } } });
  return applyCommand(project, { type: "floorArea.create", outline: { id: "outline", floorId: "ground", name: "Building outline", geometrySource: "manual-floor-area-outline", purpose: "preliminary-quoting", areaConvention: "closed-plan-outline", measurementBasis: "floor-local-plan-mm", holes: [], vertices: points.map((point, index) => ({ id: `v-${index + 1}`, positionMm: { ...point, z: knownMm(0, "plan") } })) } });
}

function rectangleOutline() { return [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, { x: 0, y: 4000 }]; }
function concaveOutline() { return [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, { x: 3500, y: 4000 }, { x: 3500, y: 1500 }, { x: 2500, y: 1500 }, { x: 2500, y: 4000 }, { x: 0, y: 4000 }]; }
