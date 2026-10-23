import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createDxfReferenceRecords,
  dxfAssetDerivedFingerprint,
  dxfReferenceSnapPoints,
  DXF_IMPORTER,
  inspectAsciiDxf,
  MAX_DXF_DIAGNOSTICS,
  MAX_DXF_EXPANSION_VISITS,
  MAX_DXF_GROUP_PAIRS,
  MAX_DXF_SOURCE_ENTITIES,
  MAX_DXF_TEXT_BYTES,
  SUPPORTED_DXF_ENTITIES,
  transformDxfReferenceGeometry,
} from "../src/import/dxf-reference.mjs";
import {
  applyCommand,
  createProject,
  deserializeProject,
  identityQuaternion,
  knownMm,
  serializeProject,
} from "../src/domain/spatial.mjs";
import { createLocalProjectStore } from "../src/persistence/local-project-store.mjs";
import {
  exportPortableProject,
  importPortableProject,
} from "../src/persistence/portable-project.mjs";

const FIXTURE_ROOT = new URL("./fixtures/dxf/", import.meta.url);

test("bounded AC1015 inspection preserves supported geometry, layers, bounds and source provenance", async () => {
  const candidate = await inspectFixture("supported-ac1015.dxf");

  assert.deepEqual(SUPPORTED_DXF_ENTITIES, ["LINE", "LWPOLYLINE", "ARC", "CIRCLE", "TEXT", "INSERT"]);
  assert.equal(candidate.dxfVersion, "AC1015");
  assert.deepEqual(candidate.declaredUnits, {
    status: "declared-supported",
    code: 4,
    unit: "mm",
    mmPerSourceUnit: 1,
  });
  assert.equal(candidate.requiresUnitChoice, false);
  assert.equal(candidate.source.sha256.length, 64);
  assert.equal(candidate.importer.id, DXF_IMPORTER.id);
  assert.equal(candidate.importer.version, DXF_IMPORTER.version);
  assert.equal(candidate.counts.sourceEntities, 8);
  assert.equal(candidate.counts.expandedEntities, 7);
  assert.equal(candidate.counts.omittedEntities, 0);
  assert.equal(candidate.geometry.length, 7);
  assert.deepEqual(candidate.sourceBoundsUnits, { minX: 0, minY: 0, maxX: 10000, maxY: 6000 });
  assert.deepEqual(candidate.layers.map((layer) => [layer.name, layer.entityCount]), [
    ["ANNO", 1],
    ["CURVES", 3],
    ["SYMBOLS", 2],
    ["WALLS", 1],
  ]);

  const polyline = candidate.geometry.find((item) => item.kind === "lwpolyline");
  assert.equal(polyline.vertices[0].bulge, 0.414213562373095);
  const blockLine = candidate.geometry.find((item) => item.sourceHandle === "B1");
  assert.deepEqual(blockLine.start, { x: 100, y: 200 });
  assert.deepEqual(blockLine.end, { x: 100, y: 204 });
  assert.deepEqual(blockLine.instancePath, [{
    blockName: "SYNTHETIC_SYMBOL",
    insertHandle: "15",
    sourceLine: 221,
  }]);
  assert.equal(blockLine.layer, "SYMBOLS");
  assert.equal(blockLine.sourceEntityType, "LINE");
  assert.equal(Object.isFrozen(candidate), true);
});

test("unknown DXF units cannot materialize until an explicit supported unit is chosen", async () => {
  const candidate = await inspectFixture("unknown-units-ac1015.dxf");
  assert.equal(candidate.requiresUnitChoice, true);
  assert.equal(candidate.declaredUnits.status, "unitless");
  assert.match(candidate.diagnostics.map((item) => item.message).join(" "), /user unit choice is required/);

  assert.throws(
    () => createDxfReferenceRecords(candidate, acceptanceSettings({ unitChoice: undefined })),
    /explicit unit choice/,
  );
  const records = createDxfReferenceRecords(candidate, acceptanceSettings({ unitChoice: "m" }));
  assert.deepEqual(records.reference.units, {
    source: "user-confirmed",
    unit: "m",
    mmPerSourceUnit: 1000,
    declaredCode: 0,
  });
  const transformed = transformDxfReferenceGeometry(records.asset, records.reference);
  assert.deepEqual(transformed.geometry[0].start, { x: 1000, y: 2000 });
  assert.deepEqual(transformed.geometry[0].end, { x: 11000, y: 2000 });
});

test("layer selection and source-to-floor transforms remain explicit and reversible", async () => {
  const candidate = await inspectFixture("supported-ac1015.dxf");
  const records = createDxfReferenceRecords(candidate, acceptanceSettings({
    includedLayers: ["WALLS", "SYMBOLS"],
    transform: {
      localOriginSource: { x: 0, y: 0 },
      translationMm: { x: 1000, y: 2000 },
      rotationRad: Math.PI / 2,
    },
  }));
  const transformed = transformDxfReferenceGeometry(records.asset, records.reference);

  assert.equal(transformed.geometry.length, 3);
  assert.deepEqual([...new Set(transformed.geometry.map((item) => item.layer))].sort(), ["SYMBOLS", "WALLS"]);
  const wall = transformed.geometry.find((item) => item.sourceHandle === "10");
  assertPointClose(wall.start, { x: 1000, y: 2000 });
  assertPointClose(wall.end, { x: 1000, y: 12000 });
  const blockLine = transformed.geometry.find((item) => item.sourceHandle === "B1");
  assertPointClose(blockLine.start, { x: 800, y: 2100 });
  assertPointClose(blockLine.end, { x: 796, y: 2100 });
  assert.deepEqual(records.reference.includedLayers, ["SYMBOLS", "WALLS"]);
});

test("DXF snap candidates are read-only reference queries and never create walls", async () => {
  const candidate = await inspectFixture("supported-ac1015.dxf");
  const records = createDxfReferenceRecords(candidate, acceptanceSettings({
    includedLayers: ["WALLS"],
    transform: {
      localOriginSource: { x: 0, y: 0 },
      translationMm: { x: 1000, y: 2000 },
      rotationRad: 0,
    },
  }));
  const project = applyCommand(projectWithFloor(), { type: "reference.addCad", ...records });
  const before = serializeProject(project);
  const snaps = dxfReferenceSnapPoints(project.cadReferenceAssets[0], project.floorCadReferences[0]);

  assert.deepEqual(snaps.map((snap) => snap.point), [
    { x: 1000, y: 2000 },
    { x: 11000, y: 2000 },
  ]);
  assert.equal(snaps.every((snap) => snap.referenceId === records.reference.id), true);
  assert.equal(project.walls.length, 0);
  assert.equal(serializeProject(project), before);
  assert.equal(Object.isFrozen(snaps), true);
});

test("large source coordinates preserve a one-unit feature through an explicit local origin", async () => {
  const candidate = await inspectAsciiDxf(simpleDxf({
    unitsCode: 6,
    entity: entity("LINE", [
      [5, "LARGE"], [8, "REFERENCE"],
      [10, "1000000000"], [20, "1000000000"], [30, "0"],
      [11, "1000000001"], [21, "1000000000"], [31, "0"],
    ]),
  }), { fileName: "synthetic-large-origin.dxf" });
  const records = createDxfReferenceRecords(candidate, acceptanceSettings({
    includedLayers: ["REFERENCE"],
    transform: {
      localOriginSource: { x: 1000000000, y: 1000000000 },
      translationMm: { x: 5000, y: 7000 },
      rotationRad: 0,
    },
  }));
  const line = transformDxfReferenceGeometry(records.asset, records.reference).geometry[0];
  assert.deepEqual(line.start, { x: 5000, y: 7000 });
  assert.deepEqual(line.end, { x: 6000, y: 7000 });
});

test("unsupported content is diagnosed and requires explicit partial acceptance", async () => {
  const candidate = await inspectFixture("unsupported-content-ac1015.dxf");
  assert.equal(candidate.geometry.length, 1);
  assert.equal(candidate.counts.omittedEntities, 2);
  assert.equal(candidate.partialAcceptanceRequired, true);
  assert.deepEqual(candidate.diagnostics.filter((item) => item.code === "unsupported-entity").map((item) => ({
    type: item.sourceEntityType,
    handle: item.sourceHandle,
    layer: item.layer,
  })), [
    { type: "HATCH", handle: "31", layer: "UNSUPPORTED" },
    { type: "MTEXT", handle: "32", layer: "UNSUPPORTED" },
  ]);
  assert.throws(
    () => createDxfReferenceRecords(candidate, acceptanceSettings({ includedLayers: ["SUPPORTED"] })),
    /explicit partial-import acceptance/,
  );
  const records = createDxfReferenceRecords(candidate, acceptanceSettings({
    includedLayers: ["SUPPORTED"],
    acceptPartial: true,
  }));
  assert.equal(records.asset.partialImportAccepted, true);
  assert.equal(records.asset.diagnostics.some((item) => item.sourceHandle === "31"), true);
});

test("DXF records persist through canonical, device-local and portable boundaries without authority", async () => {
  const candidate = await inspectFixture("supported-ac1015.dxf");
  const records = createDxfReferenceRecords(candidate, acceptanceSettings({ includedLayers: ["WALLS", "CURVES"] }));
  let project = projectWithFloor();
  project = applyCommand(project, { type: "reference.addCad", ...records });

  assert.equal(project.walls.length, 0);
  assert.equal(project.components.length, 0);
  assert.equal(project.cadReferenceAssets.length, 1);
  assert.equal(project.floorCadReferences.length, 1);
  assert.equal(project.cadReferenceAssets[0].sourceText, candidate.source.sourceText);
  assert.deepEqual(deserializeProject(serializeProject(project)), project);

  const storage = memoryStorage();
  const store = createLocalProjectStore(storage, { now: () => new Date("2026-10-15T12:00:00Z") });
  assert.equal(store.save(project).ok, true);
  assert.deepEqual(store.load(project.id).project, project);

  const portable = await exportPortableProject(project, { now: () => new Date("2026-10-15T12:00:00Z") });
  const reopened = await importPortableProject(portable);
  assert.deepEqual(reopened.project, project);
  assert.equal(reopened.authorityRestored, false);

  const tampered = structuredClone(project);
  tampered.cadReferenceAssets[0].sourceText = tampered.cadReferenceAssets[0].sourceText.replace("SYNTHETIC DXF LABEL", "SYNTHETIC DXF LABEX");
  await assert.rejects(() => exportPortableProject(tampered), /fingerprint mismatch/);

  const forgedDerivedData = structuredClone(project);
  forgedDerivedData.cadReferenceAssets[0].geometry[0].end.x += 1;
  forgedDerivedData.cadReferenceAssets[0].sourceBoundsUnits.maxX += 1;
  forgedDerivedData.cadReferenceAssets[0].derivedFingerprint = dxfAssetDerivedFingerprint(
    forgedDerivedData.cadReferenceAssets[0],
  );
  await assert.rejects(
    () => exportPortableProject(forgedDerivedData),
    /derived data does not match preserved source/,
  );
});

test("unsupported versions and malformed numeric entities never become accepted geometry", async () => {
  const unsupportedVersion = await inspectAsciiDxf(
    (await fixtureText("supported-ac1015.dxf")).replace("AC1015", "AC1032"),
    { fileName: "synthetic-unsupported-version.dxf" },
  );
  assert.equal(unsupportedVersion.blockingDiagnosticCount, 1);
  assert.throws(
    () => createDxfReferenceRecords(unsupportedVersion, acceptanceSettings()),
    /blocking diagnostics/,
  );

  const malformed = await inspectAsciiDxf(simpleDxf({
    unitsCode: 4,
    entity: entity("LINE", [
      [5, "BAD"], [8, "REFERENCE"],
      [10, "NaN"], [20, "0"], [30, "0"],
      [11, "100"], [21, "0"], [31, "0"],
    ]),
  }), { fileName: "synthetic-nonfinite.dxf" });
  assert.equal(malformed.geometry.length, 0);
  assert.equal(malformed.partialAcceptanceRequired, true);
  assert.match(malformed.diagnostics.map((item) => item.message).join(" "), /finite/);
});

test("pathological source byte and entity counts are rejected before unbounded expansion", async () => {
  await assert.rejects(
    () => inspectAsciiDxf(simpleDxf({ unitsCode: 4, entity: entity("TEXT", [
      [5, "NONASCII"], [8, "ANNO"], [10, "0"], [20, "0"], [40, "10"], [1, "café"],
    ]) }), { fileName: "synthetic-non-ascii.dxf" }),
    /7-bit ASCII/,
  );
  await assert.rejects(
    () => inspectAsciiDxf(`0\nEOF\n${" ".repeat(MAX_DXF_TEXT_BYTES)}`, { fileName: "synthetic-too-large.dxf" }),
    /byte prototype limit/,
  );
  const repeated = `${entity("POINT", [])}`
    .repeat(MAX_DXF_SOURCE_ENTITIES + 1);
  await assert.rejects(
    () => inspectAsciiDxf(simpleDxf({ unitsCode: 4, entity: repeated }), { fileName: "synthetic-too-many-entities.dxf" }),
    /entity prototype limit/,
  );
  await assert.rejects(
    () => inspectAsciiDxf("999\nx\n".repeat(MAX_DXF_GROUP_PAIRS + 1), { fileName: "synthetic-too-many-pairs.dxf" }),
    /group-pair prototype limit/,
  );
  const unsupported = entity("HATCH", []).repeat(MAX_DXF_DIAGNOSTICS + 1);
  await assert.rejects(
    () => inspectAsciiDxf(simpleDxf({ unitsCode: 4, entity: unsupported }), { fileName: "synthetic-too-many-diagnostics.dxf" }),
    /diagnostic prototype limit/,
  );
});

test("nested empty INSERT fan-out is stopped by a total recursive work budget", async () => {
  assert.equal(MAX_DXF_EXPANSION_VISITS, 200000);
  await assert.rejects(
    () => inspectAsciiDxf(nestedInsertFanoutDxf(), { fileName: "synthetic-insert-fanout.dxf" }),
    /visit prototype limit/,
  );
});

async function inspectFixture(name) {
  return inspectAsciiDxf(await fixtureText(name), { fileName: name });
}

async function fixtureText(name) {
  return readFile(new URL(name, FIXTURE_ROOT), "utf8");
}

function acceptanceSettings(overrides = {}) {
  return {
    assetId: "cad-asset-synthetic",
    referenceId: "cad-reference-synthetic",
    floorId: "floor-ground",
    includedLayers: ["REFERENCE"],
    unitChoice: undefined,
    transform: {
      localOriginSource: { x: 0, y: 0 },
      translationMm: { x: 1000, y: 2000 },
      rotationRad: 0,
    },
    visible: true,
    opacity: 0.5,
    acceptPartial: false,
    ...overrides,
  };
}

function projectWithFloor() {
  return applyCommand(createProject("project-synthetic-dxf"), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Synthetic Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "synthetic DXF fixture") },
        orientation: identityQuaternion(),
      },
    },
  });
}

function simpleDxf({ unitsCode, entity: entityText }) {
  return [
    "0", "SECTION", "2", "HEADER",
    "9", "$ACADVER", "1", "AC1015",
    "9", "$INSUNITS", "70", String(unitsCode),
    "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES",
    entityText.trimEnd(),
    "0", "ENDSEC", "0", "EOF", "",
  ].join("\n");
}

function entity(type, groups) {
  return ["0", type, ...groups.flatMap(([code, value]) => [String(code), String(value)]), ""].join("\n");
}

function nestedInsertFanoutDxf() {
  const fanout = 5;
  const blocks = [];
  for (let level = 0; level < 8; level += 1) {
    const children = level === 0
      ? ""
      : entity("INSERT", [[2, `B${level - 1}`]]).repeat(fanout);
    blocks.push([
      "0", "BLOCK", "2", `B${level}`, "10", "0", "20", "0", "30", "0",
      children.trimEnd(),
      "0", "ENDBLK",
    ].filter(Boolean).join("\n"));
  }
  return [
    "0", "SECTION", "2", "HEADER",
    "9", "$ACADVER", "1", "AC1015",
    "9", "$INSUNITS", "70", "4",
    "0", "ENDSEC",
    "0", "SECTION", "2", "BLOCKS",
    blocks.join("\n"),
    "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES",
    entity("INSERT", [[2, "B7"]]).repeat(fanout).trimEnd(),
    "0", "ENDSEC", "0", "EOF", "",
  ].join("\n");
}

function assertPointClose(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual.x - expected.x) <= epsilon, `x ${actual.x} != ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) <= epsilon, `y ${actual.y} != ${expected.y}`);
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}
