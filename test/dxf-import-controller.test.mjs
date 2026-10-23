import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applyCommand,
  createProject,
  deserializeProject,
  identityQuaternion,
  knownMm,
  serializeProject,
} from "../src/domain/spatial.mjs";
import { createDxfImportReviewController } from "../src/editor/dxf-import-controller.mjs";
import { inspectAsciiDxf, transformDxfReferenceGeometry } from "../src/import/dxf-reference.mjs";

const FIXTURE_ROOT = new URL("./fixtures/dxf/", import.meta.url);

test("review requires explicit units, at least one layer and partial-import acknowledgement", async () => {
  const controller = createDxfImportReviewController();
  const sourceText = await fixtureText("unsupported-content-ac1015.dxf");
  await controller.selectSource({ fileName: "unsupported-content-ac1015.dxf", sourceText });

  assert.equal(controller.getState().status, "review");
  assert.throws(() => controller.prepareAcceptance(settings()), /units require explicit confirmation/);
  assert.throws(() => controller.chooseUnits("m"), /conflicts with declared mm/);
  controller.chooseUnits("mm");
  assert.throws(() => controller.prepareAcceptance(settings()), /layer must be explicitly selected/);
  controller.chooseLayers(["SUPPORTED"]);
  assert.throws(() => controller.prepareAcceptance(settings()), /partial-import acceptance/);
  controller.acceptPartialImport(true);

  const before = projectWithFloor();
  const command = controller.prepareAcceptance(settings());
  const after = applyCommand(before, command);
  assert.equal(before.cadReferenceAssets.length, 0);
  assert.equal(before.floorCadReferences.length, 0);
  assert.equal(after.cadReferenceAssets.length, 1);
  assert.equal(after.floorCadReferences[0].locked, true);
  assert.equal(after.walls.length, 0);
});

test("failed and cancelled reviews cannot create a command or mutate the current project", async () => {
  const controller = createDxfImportReviewController();
  const project = projectWithFloor();
  const failed = await controller.selectSource({ fileName: "bad.dxf", sourceText: "not a dxf" });
  assert.equal(failed.state.status, "failed");
  assert.throws(() => controller.prepareAcceptance(settings()), /completed DXF inspection/);
  assert.deepEqual(project, projectWithFloor());

  await controller.selectSource({
    fileName: "supported-ac1015.dxf",
    sourceText: await fixtureText("supported-ac1015.dxf"),
  });
  controller.cancel();
  assert.equal(controller.getState().status, "idle");
  assert.throws(() => controller.prepareAcceptance(settings()), /completed DXF inspection/);
  assert.deepEqual(project, projectWithFloor());
});

test("a stale asynchronous inspection cannot replace a newer file selection", async () => {
  const pending = new Map();
  const inspect = (sourceText, { fileName }) => new Promise((resolve, reject) => {
    pending.set(fileName, { resolve, reject, sourceText });
  });
  const controller = createDxfImportReviewController({ inspect });
  const first = controller.selectSource({ fileName: "older.dxf", sourceText: "older" });
  await Promise.resolve();
  const second = controller.selectSource({ fileName: "newer.dxf", sourceText: "newer" });
  await Promise.resolve();

  pending.get("older.dxf").resolve({ marker: "older", layers: [] });
  assert.equal((await first).stale, true);
  assert.equal(controller.getState().fileName, "newer.dxf");
  assert.equal(controller.getState().status, "inspecting");
  pending.get("newer.dxf").resolve({ marker: "newer", layers: [] });
  assert.equal((await second).stale, false);
  assert.equal(controller.getState().candidate.marker, "newer");
});

test("a stale file read is invalidated before its inspection can begin", async () => {
  const reads = new Map();
  const inspected = [];
  const controller = createDxfImportReviewController({
    inspect: async (sourceText, { fileName }) => {
      inspected.push(fileName);
      return { marker: sourceText, layers: [] };
    },
  });
  const first = controller.selectFile({
    fileName: "slow-old.dxf",
    loadText: () => new Promise((resolve) => reads.set("old", resolve)),
  });
  const second = controller.selectFile({
    fileName: "fast-new.dxf",
    loadText: () => new Promise((resolve) => reads.set("new", resolve)),
  });
  reads.get("new")("new source");
  await second;
  reads.get("old")("old source");
  assert.equal((await first).stale, true);
  assert.deepEqual(inspected, ["fast-new.dxf"]);
  assert.equal(controller.getState().fileName, "fast-new.dxf");
});

test("cancelling a pending file read prevents its later result from reopening review", async () => {
  let resolveRead;
  const controller = createDxfImportReviewController({
    inspect: async () => ({ marker: "should-not-run", layers: [] }),
  });
  const pending = controller.selectFile({
    fileName: "cancelled.dxf",
    loadText: () => new Promise((resolve) => { resolveRead = resolve; }),
  });
  controller.cancel();
  resolveRead("cancelled source");
  assert.equal((await pending).stale, true);
  assert.equal(controller.getState().status, "idle");
});

test("accepted records reopen to the same validated source-derived geometry", async () => {
  const controller = createDxfImportReviewController();
  const sourceText = await fixtureText("supported-ac1015.dxf");
  await controller.selectSource({ fileName: "supported-ac1015.dxf", sourceText });
  controller.chooseUnits("mm");
  controller.chooseLayers(["WALLS", "SYMBOLS"]);
  const command = controller.prepareAcceptance(settings());
  const project = applyCommand(projectWithFloor(), command);
  const reopened = deserializeProject(serializeProject(project));
  const transformed = transformDxfReferenceGeometry(
    reopened.cadReferenceAssets[0],
    reopened.floorCadReferences[0],
  );
  assert.deepEqual(transformed.geometry, transformDxfReferenceGeometry(command.asset, command.reference).geometry);
  assert.deepEqual(transformed.boundsMm, { minX: 5000, minY: 7000, maxX: 15000, maxY: 7204 });
});

async function fixtureText(name) {
  return readFile(new URL(name, FIXTURE_ROOT), "utf8");
}

function settings() {
  return {
    assetId: "cad-asset-review",
    referenceId: "cad-reference-review",
    floorId: "floor-ground",
    transform: {
      localOriginSource: { x: 0, y: 0 },
      translationMm: { x: 5000, y: 7000 },
      rotationRad: 0,
    },
    visible: true,
    opacity: 0.55,
  };
}

function projectWithFloor() {
  return applyCommand(createProject("project-dxf-review"), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "synthetic fixture") },
        orientation: identityQuaternion(),
      },
    },
  });
}
