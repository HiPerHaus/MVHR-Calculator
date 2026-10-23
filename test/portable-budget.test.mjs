import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  createProject,
  deserializeProject,
  identityQuaternion,
  knownMm,
  serializeProject,
} from "../src/domain/spatial.mjs";
import {
  assertPortableProjectGrowth,
  encodePortableEnvelope,
  inspectPortableEnvelopeBudget,
  PortableBudgetError,
} from "../src/persistence/portable-envelope.mjs";
import {
  exportPortableProject,
  importPortableProject,
} from "../src/persistence/portable-project.mjs";
import { createLocalProjectStore } from "../src/persistence/local-project-store.mjs";

const FIXED_TIME = new Date("2026-10-15T12:00:00.000Z");

test("exact envelope accounting accepts the last fitting ASCII byte and rejects the next", () => {
  const maximumBytes = 4096;
  const fits = largestFittingFiller(maximumBytes, (filler) => JSON.stringify({ id: "project-budget", notes: filler }));
  const accepted = inspectPortableEnvelopeBudget(JSON.stringify({ id: "project-budget", notes: "x".repeat(fits) }), { maximumBytes });
  const rejected = inspectPortableEnvelopeBudget(JSON.stringify({ id: "project-budget", notes: "x".repeat(fits + 1) }), { maximumBytes });

  assert.equal(accepted.portable, true);
  assert.ok(accepted.remainingBytes >= 0);
  assert.equal(rejected.portable, false);
  assert.equal(
    accepted.projectJsonBytes + accepted.jsonEscapingBytes + accepted.portableMetadataBytes,
    accepted.totalBytes,
  );
});

test("escaped and Unicode project text is charged by encoded UTF-8 envelope bytes", () => {
  const projectJson = JSON.stringify({
    name: "Quoted \"name\" with slash \\ and newline\n plus € and 漢字",
  });
  const budget = inspectPortableEnvelopeBudget(projectJson, { maximumBytes: 4096 });

  assert.equal(budget.portable, true);
  assert.ok(budget.projectJsonBytes > projectJson.length);
  assert.ok(budget.jsonEscapingBytes > 0);
  assert.ok(budget.portableMetadataBytes > 0);
});

test("several embedded assets and base64 amplification share the same total envelope", () => {
  const rawBytesPerAsset = 420;
  const base64 = Buffer.alloc(rawBytesPerAsset, 0xa5).toString("base64");
  const projectJson = JSON.stringify({
    referenceAssets: Array.from({ length: 4 }, (_, index) => ({
      id: `asset-${index}`,
      byteLength: rawBytesPerAsset,
      dataUrl: `data:image/png;base64,${base64}`,
    })),
    cadReferenceAssets: [{ id: "cad-asset", sourceText: "0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n" }],
  });
  const budget = inspectPortableEnvelopeBudget(projectJson, { maximumBytes: 8192 });

  assert.equal(budget.portable, true);
  assert.ok(budget.projectJsonBytes > rawBytesPerAsset * 4 * 4 / 3);
  assert.equal(
    budget.projectJsonBytes + budget.jsonEscapingBytes + budget.portableMetadataBytes,
    budget.totalBytes,
  );
});

test("growth policy rejects a new overflow and only permits non-growing legacy recovery", () => {
  const maximumBytes = 2048;
  const current = JSON.stringify({ id: "project-growth", notes: "x".repeat(200) });
  const oversized = JSON.stringify({ id: "project-growth", notes: "x".repeat(3000) });
  const lessOversized = JSON.stringify({ id: "project-growth", notes: "x".repeat(2900) });
  const moreOversized = JSON.stringify({ id: "project-growth", notes: "x".repeat(3100) });

  assert.throws(
    () => assertPortableProjectGrowth(current, oversized, { maximumBytes }),
    (error) => error instanceof PortableBudgetError && error.code === "portable_budget_exceeded",
  );
  const recoverable = assertPortableProjectGrowth(oversized, lessOversized, { maximumBytes });
  assert.equal(recoverable.portable, false);
  assert.throws(
    () => assertPortableProjectGrowth(oversized, moreOversized, { maximumBytes }),
    (error) => error instanceof PortableBudgetError && error.code === "oversized_project_growth_blocked",
  );
});

test("portable export uses the exact boundary and migration reports an oversized recoverable state", async () => {
  const project = baseProject("project-portable-exact-boundary");
  const projectJson = serializeProject(project);
  const exact = inspectPortableEnvelopeBudget(projectJson, { exportedAtUtc: FIXED_TIME.toISOString() });
  const exported = await exportPortableProject(project, {
    now: () => new Date(FIXED_TIME),
    maximumBytes: exact.totalBytes,
  });
  assert.equal(new TextEncoder().encode(exported).byteLength, exact.totalBytes);
  await assert.rejects(
    () => exportPortableProject(project, {
      now: () => new Date(FIXED_TIME),
      maximumBytes: exact.totalBytes - 1,
    }),
    /portable project exceeds/i,
  );
  await assert.rejects(
    () => exportPortableProject(project, { now: () => new Date("+010000-01-01T00:00:00.000Z") }),
    /four-digit ISO year/,
  );

  const legacy = structuredClone(project);
  legacy.schemaVersion = 1;
  delete legacy.referenceAssets;
  delete legacy.floorReferences;
  delete legacy.cadReferenceAssets;
  delete legacy.floorCadReferences;
  const legacyJson = JSON.stringify(legacy);
  const legacyEnvelope = encodePortableEnvelope(legacyJson, FIXED_TIME.toISOString());
  const legacyInputBytes = new TextEncoder().encode(legacyEnvelope).byteLength;
  const migrated = deserializeProject(legacyJson);
  const migratedBytes = inspectPortableEnvelopeBudget(serializeProject(migrated)).totalBytes;
  assert.ok(migratedBytes > legacyInputBytes);
  const migrationLimit = Math.floor((legacyInputBytes + migratedBytes) / 2);

  const opened = await importPortableProject(legacyEnvelope, { maximumBytes: migrationLimit });
  assert.equal(opened.migration.migrated, true);
  assert.equal(opened.portableBudget.portable, false);
  assert.deepEqual(opened.project, migrated);
});

test("oversized local drafts remain recoverable and a rejected growth leaves the last good save", () => {
  const maximumBytes = 2048;
  const storage = memoryStorage();
  const store = createLocalProjectStore(storage, {
    now: () => new Date(FIXED_TIME),
    portableMaximumBytes: maximumBytes,
  });
  const safe = baseProject("project-local-budget");
  assert.equal(store.save(safe).ok, true);

  const growthCommand = {
    type: "floor.add",
    floor: {
      id: "floor-oversized",
      name: "x".repeat(3000),
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "synthetic") },
        orientation: identityQuaternion(),
      },
    },
  };
  assert.throws(
    () => applyCommand(safe, growthCommand, { portableMaximumBytes: maximumBytes }),
    (error) => error instanceof PortableBudgetError && error.code === "portable_budget_exceeded",
  );
  assert.deepEqual(store.load(safe.id).project, safe);

  const oversized = applyCommand(safe, growthCommand);
  assert.throws(
    () => assertPortableProjectGrowth(serializeProject(safe), serializeProject(oversized), { maximumBytes }),
    /project unchanged and no data discarded/,
  );

  const legacyStorage = memoryStorage();
  const legacyStore = createLocalProjectStore(legacyStorage, {
    now: () => new Date(FIXED_TIME),
    portableMaximumBytes: maximumBytes,
  });
  const saved = legacyStore.save(oversized);
  const reopened = legacyStore.load(oversized.id);
  assert.equal(saved.ok, true);
  assert.equal(saved.portableBudget.portable, false);
  assert.equal(reopened.ok, true);
  assert.equal(reopened.portableBudget.portable, false);
  assert.deepEqual(reopened.project, oversized);
});

function largestFittingFiller(maximumBytes, makeJson) {
  let low = 0;
  let high = maximumBytes;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const budget = inspectPortableEnvelopeBudget(makeJson("x".repeat(middle)), { maximumBytes });
    if (budget.portable) low = middle;
    else high = middle - 1;
  }
  return low;
}

function baseProject(id) {
  return createProject(id);
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}
