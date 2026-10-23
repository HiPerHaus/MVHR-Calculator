import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  createProject,
  identityQuaternion,
  knownMm,
  SCHEMA_VERSION,
  serializeProject,
  sourcePointToWorld,
  unknownMm,
  worldPointToSource,
} from "../src/domain/spatial.mjs";
import {
  createCommandHistory,
  executeCommand,
  redoCommand,
  undoCommand,
} from "../src/domain/history.mjs";
import {
  PORTABLE_FORMAT,
  PORTABLE_PACKAGE_VERSION,
  MAX_IMAGE_BYTES,
  MAX_PORTABLE_TEXT_BYTES,
  bytesToDataUrl,
  dataUrlToBytes,
  exportPortableProject,
  importPortableProject,
  sha256Hex,
  validateImageBytes,
} from "../src/persistence/portable-project.mjs";

const FIXED_TIME = new Date("2026-10-15T13:00:00.000Z");

test("synthetic PNG reference calibrates 1000 pixels to 10 metres without moving walls", async () => {
  const project = await projectWithUncalibratedReference();
  const withWall = applyCommand(project, wallCommand());
  const wallBefore = structuredClone(withWall.walls);
  const nodesBefore = structuredClone(withWall.wallNodes);
  const calibrated = applyCommand(withWall, calibrationCommand());
  const reference = calibrated.floorReferences[0];

  assert.equal(reference.transform.scaleMmPerPixel.valueMm, 10);
  assert.equal(reference.calibration.knownDistanceMm, 10000);
  assert.deepEqual(calibrated.walls, wallBefore);
  assert.deepEqual(calibrated.wallNodes, nodesBefore);
  assert.deepEqual(
    sourcePointToWorld(reference.transform, { x: 500, y: 0 }, 10),
    { x: 6000, y: 2000 },
  );
  assert.deepEqual(
    worldPointToSource(reference.transform, { x: 6000, y: 2000 }, 10),
    { x: 500, y: 0 },
  );
});

test("calibration rejects invalid distances, units, and coincident points without mutation", async () => {
  const project = await projectWithUncalibratedReference();
  for (const knownDistanceMm of [0, -1, Number.NaN]) {
    const command = calibrationCommand();
    command.knownDistanceMm = knownDistanceMm;
    assert.throws(() => applyCommand(project, command), /finite|positive/);
    assert.equal(project.floorReferences[0].calibration, null);
  }
  const coincident = calibrationCommand();
  coincident.sourcePointBpx = { ...coincident.sourcePointApx };
  assert.throws(() => applyCommand(project, coincident), /distinct/);
  const unsupportedUnit = calibrationCommand();
  unsupportedUnit.inputUnit = "cm";
  assert.throws(() => applyCommand(project, unsupportedUnit), /input unit/);
  const implicitScope = calibrationCommand();
  delete implicitScope.rescaleFloorModel;
  assert.throws(() => applyCommand(project, implicitScope), /explicit floor-model scale choice/);
});

test("explicit floor rescale keeps the calibration anchor and scales authored XY only", async () => {
  let project = await projectWithUncalibratedReference();
  project = applyCommand(project, wallCommand());
  project = await addSecondReference(project);
  project = applyCommand(project, {
    type: "floor.add",
    floor: {
      id: "floor-unrelated",
      name: "Unrelated Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(3000, "synthetic unrelated floor") },
        orientation: identityQuaternion(),
      },
    },
  });
  project = applyCommand(project, componentCommand({
    id: "component-unrelated",
    floorId: "floor-unrelated",
    positionMm: { x: 9000, y: 8000, z: knownMm(250, "synthetic unrelated component") },
  }));
  const unrelatedBefore = structuredClone(project.components.find((item) => item.id === "component-unrelated"));
  const otherReferenceBefore = structuredClone(project.floorReferences[1]);
  const anchorBefore = sourcePointToWorld(
    project.floorReferences[0].transform,
    { x: 0, y: 0 },
    10,
  );

  const command = calibrationCommand({ knownDistanceMm: 20000, rescaleFloorModel: true });
  const scaled = applyCommand(project, command);
  const reference = scaled.floorReferences[0];

  assert.deepEqual(sourcePointToWorld(reference.transform, { x: 0, y: 0 }, 20), anchorBefore);
  assert.deepEqual(scaled.wallNodes.map(({ positionMm }) => positionMm), [
    { x: -1000, y: -2000, z: unknownMm("synthetic wall base unknown") },
    { x: 5000, y: -2000, z: unknownMm("synthetic wall base unknown") },
  ]);
  assert.equal(scaled.walls[0].thicknessMm, 140, "typed wall thickness is not a coordinate");
  assert.equal(scaled.walls[0].heightMm.state, "unknown");
  assert.deepEqual(
    scaled.components.find((item) => item.id === "component-unrelated"),
    unrelatedBefore,
    "another floor is outside the selected transform scope",
  );
  assert.deepEqual(scaled.floorReferences[1], otherReferenceBefore);
  assert.equal(reference.calibration.modelScaleMode, "reference-and-floor-walls");
  assert.equal(reference.calibration.modelScaleFactor, 2);
});

test("floor rescale is blocked atomically when placed components or routes exist", async () => {
  for (const addServiceGeometry of [componentCommand, routeCommand]) {
    let project = await projectWithUncalibratedReference();
    project = applyCommand(project, wallCommand());
    project = applyCommand(project, addServiceGeometry());
    project = await addSecondReference(project);
    const before = structuredClone(project);

    assert.throws(
      () => applyCommand(project, calibrationCommand({ knownDistanceMm: 20000, rescaleFloorModel: true })),
      /blocked while placed components or routes exist/,
    );
    assert.deepEqual(project, before);
    assert.equal(project.floorReferences[0].calibration, null);
    assert.deepEqual(project.floorReferences[1], before.floorReferences[1]);
  }

  let referenceOnly = await projectWithUncalibratedReference();
  referenceOnly = applyCommand(referenceOnly, componentCommand());
  referenceOnly = applyCommand(referenceOnly, routeCommand());
  const authoredBefore = structuredClone({
    components: referenceOnly.components,
    routes: referenceOnly.routes,
  });
  referenceOnly = applyCommand(referenceOnly, calibrationCommand({ knownDistanceMm: 20000 }));
  assert.deepEqual(
    { components: referenceOnly.components, routes: referenceOnly.routes },
    authoredBefore,
  );
  assert.equal(referenceOnly.floorReferences[0].calibration.modelScaleMode, "reference-only");
});

test("floor rescale remains blocked for a route attached to moved component ports", async () => {
  let project = await projectWithUncalibratedReference();
  project = addSyntheticAttachedRoute(project);
  project = applyCommand(project, {
    type: "component.moveXY",
    componentId: "component-route-a",
    xMm: 2500,
    yMm: 3500,
  });
  const before = structuredClone(project);

  assert.throws(
    () => applyCommand(project, calibrationCommand({ knownDistanceMm: 20000, rescaleFloorModel: true })),
    /blocked while placed components or routes exist/,
  );
  assert.deepEqual(project, before);
  assert.equal(project.floorReferences[0].calibration, null);
  assert.deepEqual(project.routes[0].points[0], {
    x: 2600,
    y: 3500,
    z: unknownMm("route endpoint depends on unknown component elevation: component-route-a"),
  });

  const referenceOnly = applyCommand(project, calibrationCommand({ knownDistanceMm: 20000 }));
  assert.deepEqual(referenceOnly.components, before.components);
  assert.deepEqual(referenceOnly.routes, before.routes);
  assert.equal(referenceOnly.floorReferences[0].calibration.modelScaleMode, "reference-only");
});

test("floor rescale is one undoable command and repeated calibration survives reopen", async () => {
  let project = await projectWithUncalibratedReference();
  project = applyCommand(project, wallCommand());
  const before = structuredClone(project);
  let history = createCommandHistory(project);

  history = executeCommand(history, calibrationCommand({ knownDistanceMm: 20000, rescaleFloorModel: true }));
  const first = structuredClone(history.present);
  assert.equal(first.floorReferences[0].transform.scaleMmPerPixel.valueMm, 20);
  history = undoCommand(history);
  assert.deepEqual(history.present, before);
  history = redoCommand(history);
  assert.deepEqual(history.present, first);

  const secondAnchorBefore = sourcePointToWorld(
    history.present.floorReferences[0].transform,
    { x: 500, y: 0 },
    20,
  );
  history = executeCommand(history, calibrationCommand({
    sourcePointApx: { x: 500, y: 0 },
    sourcePointBpx: { x: 1000, y: 0 },
    knownDistanceMm: 7500,
    rescaleFloorModel: true,
  }));
  const repeated = history.present;
  assert.deepEqual(
    sourcePointToWorld(repeated.floorReferences[0].transform, { x: 500, y: 0 }, 15),
    secondAnchorBefore,
  );
  assert.equal(repeated.floorReferences[0].calibration.modelScaleFactor, 0.75);
  assert.deepEqual(repeated.wallNodes.map(({ positionMm }) => positionMm), [
    { x: 2000, y: -1000, z: unknownMm("synthetic wall base unknown") },
    { x: 6500, y: -1000, z: unknownMm("synthetic wall base unknown") },
  ]);

  const encoded = await exportPortableProject(repeated, { now: () => new Date(FIXED_TIME) });
  const opened = await importPortableProject(encoded);
  assert.deepEqual(opened.project, repeated);
});

test("portable export and open preserve source bytes, checksum, transforms, and unknowns", async () => {
  let project = await projectWithUncalibratedReference();
  project = applyCommand(project, calibrationCommand());
  project = applyCommand(project, wallCommand());

  const encoded = await exportPortableProject(project, { now: () => new Date(FIXED_TIME) });
  const opened = await importPortableProject(encoded);

  assert.deepEqual(opened.project, project);
  assert.equal(opened.authorityRestored, false);
  assert.equal(opened.migration.migrated, false);
  assert.equal(opened.project.referenceAssets[0].fileName, "synthetic-reference-plan.png");
  assert.equal(opened.project.walls[0].heightMm.state, "unknown");
});

test("portable open rejects package authority claims and forged project authority", async () => {
  const project = await projectWithUncalibratedReference();
  const valid = JSON.parse(
    await exportPortableProject(project, { now: () => new Date(FIXED_TIME) }),
  );
  const packageClaim = { ...valid, companyId: "forged-company" };
  await assert.rejects(
    () => importPortableProject(JSON.stringify(packageClaim)),
    /authority-bearing/,
  );

  const forgedProject = JSON.parse(valid.projectJson);
  forgedProject.tenantId = "forged-tenant";
  valid.projectJson = JSON.stringify(forgedProject);
  await assert.rejects(
    () => importPortableProject(JSON.stringify(valid)),
    /cannot confer authority/,
  );
});

test("portable open rejects corrupted source bytes and dimension claims", async () => {
  const project = await projectWithUncalibratedReference();
  const valid = JSON.parse(
    await exportPortableProject(project, { now: () => new Date(FIXED_TIME) }),
  );
  const checksumMismatch = JSON.parse(valid.projectJson);
  checksumMismatch.referenceAssets[0].sha256 = "0".repeat(64);
  valid.projectJson = JSON.stringify(checksumMismatch);
  await assert.rejects(() => importPortableProject(JSON.stringify(valid)), /checksum mismatch/);

  const validAgain = JSON.parse(
    await exportPortableProject(project, { now: () => new Date(FIXED_TIME) }),
  );
  const dimensionMismatch = JSON.parse(validAgain.projectJson);
  dimensionMismatch.referenceAssets[0].widthPx = 999;
  validAgain.projectJson = JSON.stringify(dimensionMismatch);
  await assert.rejects(() => importPortableProject(JSON.stringify(validAgain)), /dimensions mismatch/);
});

test("portable and embedded-source bounds reject oversized or malformed input before decoding", async () => {
  const oversizedUnicode = "€".repeat(Math.floor(MAX_PORTABLE_TEXT_BYTES / 3) + 1);
  await assert.rejects(
    () => importPortableProject(oversizedUnicode),
    /portable project exceeds/i,
  );

  const oversizedBase64 = "A".repeat(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4);
  assert.throws(
    () => dataUrlToBytes(`data:image/png;base64,${oversizedBase64}`, "image/png"),
    /exceeds/,
  );
  assert.throws(
    () => dataUrlToBytes("data:image/png;base64,%%%%", "image/png"),
    /canonical base64/,
  );

  const invalidHeaderLength = syntheticPngHeader(10, 10);
  new DataView(invalidHeaderLength.buffer).setUint32(8, 12);
  assert.throws(() => validateImageBytes(invalidHeaderLength, "image/png"), /13-byte length/);

  const mismatchedClaim = await projectWithUncalibratedReference();
  mismatchedClaim.referenceAssets[0].dataUrl = "data:image/png;base64,AAAA";
  assert.throws(() => serializeProject(mismatchedClaim), /encoded source length/);
});

test("schema 1 portable projects migrate sequentially without gaining authority", async () => {
  const current = baseProject();
  const legacy = structuredClone(current);
  legacy.schemaVersion = 1;
  delete legacy.referenceAssets;
  delete legacy.floorReferences;
  const envelope = {
    format: PORTABLE_FORMAT,
    packageVersion: PORTABLE_PACKAGE_VERSION,
    exportedAtUtc: FIXED_TIME.toISOString(),
    projectJson: JSON.stringify(legacy),
  };

  const opened = await importPortableProject(JSON.stringify(envelope));
  assert.equal(opened.migration.migrated, true);
  assert.equal(opened.migration.fromSchemaVersion, 1);
  assert.equal(opened.project.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(opened.project.floorAreaOutlines, []);
  assert.deepEqual(opened.project.rooms, []);
  assert.deepEqual(opened.project.zones, []);
  assert.deepEqual(opened.project.referenceAssets, []);
});

test("schema 2 calibration migrates as reference-only without inventing a model transform", async () => {
  let current = await projectWithUncalibratedReference();
  current = applyCommand(current, calibrationCommand());
  const legacy = structuredClone(current);
  legacy.schemaVersion = 2;
  delete legacy.floorReferences[0].calibration.modelScaleMode;
  delete legacy.floorReferences[0].calibration.modelScaleFactor;
  const envelope = {
    format: PORTABLE_FORMAT,
    packageVersion: PORTABLE_PACKAGE_VERSION,
    exportedAtUtc: FIXED_TIME.toISOString(),
    projectJson: JSON.stringify(legacy),
  };

  const opened = await importPortableProject(JSON.stringify(envelope));
  assert.equal(opened.migration.migrated, true);
  assert.equal(opened.migration.fromSchemaVersion, 2);
  assert.equal(opened.project.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(opened.project.floorAreaOutlines, []);
  assert.deepEqual(opened.project.rooms, []);
  assert.deepEqual(opened.project.zones, []);
  assert.equal(opened.project.floorReferences[0].calibration.modelScaleMode, "reference-only");
  assert.equal(opened.project.floorReferences[0].calibration.modelScaleFactor, 1);
});

async function projectWithUncalibratedReference() {
  const bytes = syntheticPngHeader(1001, 501);
  const digest = await sha256Hex(bytes);
  return applyCommand(baseProject(), {
    type: "reference.addImage",
    asset: {
      id: "reference-asset-synthetic",
      kind: "image",
      fileName: "synthetic-reference-plan.png",
      mediaType: "image/png",
      byteLength: bytes.byteLength,
      sha256: digest,
      widthPx: 1001,
      heightPx: 501,
      dataUrl: bytesToDataUrl(bytes, "image/png"),
    },
    reference: {
      id: "floor-reference-synthetic",
      floorId: "floor-synthetic-ground",
      assetId: "reference-asset-synthetic",
      visible: true,
      locked: true,
      opacity: 0.55,
      transform: {
        translationMm: { x: 1000, y: 2000 },
        rotationRad: 0,
        scaleMmPerPixel: unknownMm("synthetic reference not calibrated"),
      },
      calibration: null,
    },
  });
}

async function addSecondReference(project) {
  const bytes = syntheticPngHeader(401, 301);
  return applyCommand(project, {
    type: "reference.addImage",
    asset: {
      id: "reference-asset-other",
      kind: "image",
      fileName: "synthetic-other-reference.png",
      mediaType: "image/png",
      byteLength: bytes.byteLength,
      sha256: await sha256Hex(bytes),
      widthPx: 401,
      heightPx: 301,
      dataUrl: bytesToDataUrl(bytes, "image/png"),
    },
    reference: {
      id: "floor-reference-other",
      floorId: "floor-synthetic-ground",
      assetId: "reference-asset-other",
      visible: true,
      locked: true,
      opacity: 0.4,
      transform: {
        translationMm: { x: 7000, y: 8000 },
        rotationRad: 0,
        scaleMmPerPixel: unknownMm("other reference not calibrated"),
      },
      calibration: null,
    },
  });
}

function baseProject() {
  return applyCommand(createProject("project-synthetic-portable-reference"), {
    type: "floor.add",
    floor: {
      id: "floor-synthetic-ground",
      name: "Synthetic Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "synthetic portable fixture") },
        orientation: identityQuaternion(),
      },
    },
  });
}

function calibrationCommand(overrides = {}) {
  return {
    type: "reference.calibrate",
    referenceId: "floor-reference-synthetic",
    sourcePointApx: { x: 0, y: 0 },
    sourcePointBpx: { x: 1000, y: 0 },
    knownDistanceMm: 10000,
    inputUnit: "m",
    acceptedAtUtc: FIXED_TIME.toISOString(),
    previewScaleMmPerPixel: 10,
    rescaleFloorModel: false,
    ...overrides,
  };
}

function wallCommand() {
  return {
    type: "wall.addChain",
    floorId: "floor-synthetic-ground",
    nodeIds: ["synthetic-wall-node-a", "synthetic-wall-node-b"],
    wallIds: ["synthetic-wall-a-b"],
    points: [
      { x: 0, y: 0, z: unknownMm("synthetic wall base unknown") },
      { x: 3000, y: 0, z: unknownMm("synthetic wall base unknown") },
    ],
    thicknessMm: 140,
    heightMm: unknownMm("synthetic wall height unknown"),
    referenceLine: "centreline",
    classification: "physical",
  };
}

function componentCommand(overrides = {}) {
  return {
    type: "component.add",
    component: {
      id: "component-synthetic",
      floorId: "floor-synthetic-ground",
      positionMm: { x: 2000, y: 3000, z: unknownMm("synthetic component height unknown") },
      orientation: identityQuaternion(),
      ports: [],
      ...overrides,
    },
  };
}

function routeCommand() {
  return {
    type: "route.add",
    route: {
      id: "route-synthetic",
      floorId: "floor-synthetic-ground",
      system: "mvhr",
      stream: "supply",
      points: [
        { x: 1000, y: 2000, z: knownMm(0, "synthetic route datum") },
        { x: 2000, y: 3000, z: unknownMm("synthetic route rise unknown") },
      ],
    },
  };
}

function addSyntheticAttachedRoute(project) {
  for (const [componentId, portId, x] of [
    ["component-route-a", "port-route-a", 2000],
    ["component-route-b", "port-route-b", 6000],
  ]) {
    project = applyCommand(project, {
      type: "component.add",
      component: {
        id: componentId,
        floorId: "floor-synthetic-ground",
        positionMm: { x, y: 3000, z: unknownMm("synthetic component height unknown") },
        orientation: identityQuaternion(),
        ports: [{
          id: portId,
          definitionId: `synthetic-${portId}`,
          positionMm: { x: 100, y: 0, z: 50 },
          direction: { x: 1, y: 0, z: 0 },
          system: "mvhr",
          stream: "supply",
          role: "Dwelling supply",
        }],
      },
    });
  }
  return applyCommand(project, {
    type: "route.add",
    route: {
      id: "route-attached-synthetic",
      floorId: "floor-synthetic-ground",
      system: "mvhr",
      stream: "supply",
      role: "Dwelling supply",
      startAttachment: { componentId: "component-route-a", portId: "port-route-a" },
      endAttachment: { componentId: "component-route-b", portId: "port-route-b" },
      points: [
        { x: 0, y: 0, z: knownMm(0, "provisional synthetic endpoint") },
        { x: 4000, y: 4000, z: unknownMm("synthetic route rise unknown") },
        { x: 0, y: 0, z: knownMm(0, "provisional synthetic endpoint") },
      ],
    },
  });
}

function syntheticPngHeader(widthPx, heightPx) {
  const bytes = new Uint8Array(45);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, widthPx);
  view.setUint32(20, heightPx);
  bytes.set([8, 6, 0, 0, 0], 24);
  bytes.set([0x49, 0x45, 0x4e, 0x44], 37);
  return bytes;
}
