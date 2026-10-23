import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  createProject,
  identityQuaternion,
  knownMm,
} from "../src/domain/spatial.mjs";
import { createLocalProjectStore } from "../src/persistence/local-project-store.mjs";
import {
  createLocalProjectLibrary,
  createOpaqueProjectId,
} from "../src/persistence/local-project-library.mjs";

test("named projects support new, save, reopen, rename and independent Save As identities", () => {
  const storage = memoryStorage();
  const library = createLibrary(storage);
  const alpha = syntheticProject("project-alpha");
  const alphaSaved = library.saveProject(alpha, "House");
  assert.equal(alphaSaved.ok, true);

  const renamed = library.saveProject(alpha, "House renamed");
  assert.equal(renamed.ok, true);
  assert.equal(renamed.projectId, alpha.id);
  assert.equal(library.loadProject(alpha.id).name, "House renamed");

  const copy = { ...structuredClone(alpha), id: "project-beta" };
  const betaSaved = library.saveProject(copy, "House renamed");
  assert.equal(betaSaved.ok, true);
  assert.notEqual(betaSaved.projectId, alphaSaved.projectId);
  assert.deepEqual(library.loadProject(alpha.id).project, alpha);
  assert.deepEqual(library.loadProject(copy.id).project, copy);

  const listed = library.listProjects();
  assert.equal(listed.ok, true);
  assert.equal(listed.projects.length, 2);
  assert.equal(listed.projects.filter((entry) => entry.name === "House renamed").length, 2);
});

test("saving one named project never changes another project", () => {
  const storage = memoryStorage();
  const library = createLibrary(storage);
  const alpha = syntheticProject("project-alpha");
  const beta = syntheticProject("project-beta");
  library.saveProject(alpha, "Alpha");
  library.saveProject(beta, "Beta");
  const editedAlpha = applyCommand(alpha, {
    type: "quote.updateDraft",
    quoteDraft: {
      ...alpha.quoteDraft,
      scopeExclusions: ["Garage"],
      scopeReviewed: true,
    },
  });
  library.saveProject(editedAlpha, "Alpha");

  assert.deepEqual(library.loadProject(alpha.id).project, editedAlpha);
  assert.deepEqual(library.loadProject(beta.id).project, beta);
});

test("legacy single draft migration copies without deleting or rewriting the old journal", () => {
  const storage = memoryStorage();
  const legacyStore = createLocalProjectStore(storage, { now: clock() });
  const legacy = syntheticProject("project-legacy");
  legacyStore.save(legacy);
  const before = storage.snapshot();
  const library = createLibrary(storage);

  const migrated = library.migrateLegacy(legacyStore.load(legacy.id), "Recovered project");

  assert.equal(migrated.ok, true);
  assert.equal(migrated.migrated, true);
  assert.deepEqual(library.loadProject(legacy.id).project, legacy);
  for (const [key, value] of before) assert.equal(storage.getItem(key), value);
});

test("failed named save is not acknowledged and leaves the library checkpoint discoverable", () => {
  const storage = memoryStorage();
  const library = createLibrary(storage);
  const project = syntheticProject("project-failure");
  library.saveProject(project, "Before failure");
  storage.failNextSet((key) => key.includes("test-project") && key.endsWith(":current"));

  const failed = library.saveProject({ ...structuredClone(project), quoteDraft: {
    ...project.quoteDraft,
    scopeReviewed: true,
  } }, "After failure");

  assert.equal(failed.ok, false);
  assert.equal(failed.code, "write_failed");
  assert.equal(library.loadProject(project.id).name, "Before failure");
  assert.deepEqual(library.loadProject(project.id).project, project);
});

test("an interrupted index promotion reopens the exact previously acknowledged project revision", () => {
  const storage = memoryStorage();
  const library = createLibrary(storage);
  const project = syntheticProject("project-index-failure");
  assert.equal(library.saveProject(project, "Indexed project").ok, true);
  const edited = applyCommand(project, {
    type: "quote.updateDraft",
    quoteDraft: {
      ...project.quoteDraft,
      scopeExclusions: ["Garage"],
      scopeReviewed: true,
    },
  });
  storage.failNextSet((key) => key === "test-library:current");

  const failed = library.saveProject(edited, "Unacknowledged rename");
  const reopened = library.loadProject(project.id);

  assert.equal(failed.ok, false);
  assert.equal(failed.projectCheckpointWritten, true);
  assert.equal(reopened.ok, true);
  assert.equal(reopened.name, "Indexed project");
  assert.deepEqual(reopened.project, project);
  assert.notDeepEqual(reopened.project, edited);
});

test("corrupt current library index recovers the previous valid index", () => {
  const storage = memoryStorage();
  const library = createLibrary(storage);
  library.saveProject(syntheticProject("project-one"), "One");
  library.saveProject(syntheticProject("project-two"), "Two");
  storage.forceSet("test-library:current", "{broken");

  const listed = library.listProjects();

  assert.equal(listed.ok, true);
  assert.equal(listed.recoveredFromInvalidCurrent, true);
  assert.equal(listed.projects.length, 1);
  assert.equal(listed.projects[0].name, "One");
});

test("opaque project identity is independent from its visible name", () => {
  const id = createOpaqueProjectId({ randomUUID: () => "12345678-1234-1234-1234-123456789abc" });
  assert.equal(id, "project-12345678-1234-1234-1234-123456789abc");
});

function createLibrary(storage) {
  return createLocalProjectLibrary(storage, {
    now: clock(),
    indexPrefix: "test-library",
    projectKeyPrefix: "test-project",
  });
}

function clock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 9, 20, 12, 0, tick++));
}

function syntheticProject(id) {
  return applyCommand(createProject(id), {
    type: "floor.add",
    floor: {
      id: `floor-${id}`,
      name: "Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "synthetic library fixture") },
        orientation: identityQuaternion(),
      },
    },
  });
}

function memoryStorage() {
  const values = new Map();
  let failSetPredicate = null;
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      if (failSetPredicate?.(key)) {
        failSetPredicate = null;
        throw new Error("Synthetic quota failure");
      }
      values.set(key, String(value));
    },
    removeItem(key) { values.delete(key); },
    failNextSet(predicate) { failSetPredicate = predicate; },
    forceSet(key, value) { values.set(key, String(value)); },
    snapshot() { return new Map(values); },
  };
}
