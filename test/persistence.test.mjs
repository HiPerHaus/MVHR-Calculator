import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  createProject,
  identityQuaternion,
  knownMm,
  unknownMm,
} from "../src/domain/spatial.mjs";
import {
  createLocalProjectStore,
  localProjectStorageKeys,
} from "../src/persistence/local-project-store.mjs";

const FIXED_TIME = new Date("2026-10-15T12:00:00.000Z");

test("device-local save and reopen preserves wall topology and unknown elevations", () => {
  const storage = memoryStorage();
  const store = localStore(storage);
  const project = applyCommand(syntheticProject(), closedWallCommand());

  const saved = store.save(project);
  const reopened = store.load(project.id);

  assert.equal(saved.ok, true);
  assert.equal(saved.companyAccountSaved, false);
  assert.equal(saved.storageScope, "device-local-prototype");
  assert.equal(reopened.ok, true);
  assert.equal(reopened.found, true);
  assert.deepEqual(reopened.project, project);
  assert.equal(reopened.project.wallNodes.length, 4);
  assert.equal(reopened.project.walls.length, 4);
  assert.equal(reopened.project.walls[0].heightMm.state, "unknown");
  assert.equal(reopened.project.wallNodes[0].positionMm.z.state, "unknown");
});

test("a failed local save keeps the previous acknowledged project", () => {
  const storage = memoryStorage();
  const store = localStore(storage);
  const initial = applyCommand(syntheticProject(), closedWallCommand());
  assert.equal(store.save(initial).ok, true);

  const edited = applyCommand(initial, {
    type: "wall.moveNode",
    nodeId: "synthetic-node-b",
    xMm: 6200,
    yMm: 0,
  });
  storage.failNextSet((key) => key.endsWith(":current"));
  const failed = store.save(edited);
  const reopened = store.load(initial.id);

  assert.equal(failed.ok, false);
  assert.equal(failed.code, "write_failed");
  assert.equal(failed.previousValidRetained, true);
  assert.equal(reopened.ok, true);
  assert.deepEqual(reopened.project, initial);
  assert.notDeepEqual(reopened.project, edited);
});

test("a corrupted current-record write is not falsely acknowledged and recovers previous", () => {
  const storage = memoryStorage();
  const store = localStore(storage);
  const initial = applyCommand(syntheticProject(), closedWallCommand());
  assert.equal(store.save(initial).ok, true);
  const edited = applyCommand(initial, {
    type: "wall.moveNode",
    nodeId: "synthetic-node-b",
    xMm: 6400,
    yMm: 0,
  });

  storage.corruptNextSet((key) => key.endsWith(":current"), () => "{corrupted-current");
  const failed = store.save(edited);
  const reopened = store.load(initial.id);

  assert.equal(failed.ok, false);
  assert.equal(failed.code, "write_failed");
  assert.equal(failed.previousValidRetained, true);
  assert.equal(reopened.source, "previous");
  assert.deepEqual(reopened.project, initial);
});

test("malformed current data falls back to the previous valid local project", () => {
  const storage = memoryStorage();
  const store = localStore(storage);
  const initial = applyCommand(syntheticProject(), closedWallCommand());
  const edited = applyCommand(initial, {
    type: "wall.moveNode",
    nodeId: "synthetic-node-b",
    xMm: 6100,
    yMm: 0,
  });
  store.save(initial);
  store.save(edited);

  const keys = localProjectStorageKeys(initial.id);
  storage.forceSet(keys.current, "{ malformed-json");
  const reopened = store.load(initial.id);

  assert.equal(reopened.ok, true);
  assert.equal(reopened.source, "previous");
  assert.equal(reopened.recoveredFromInvalidCurrent, true);
  assert.deepEqual(reopened.project, initial);
  assert.match(reopened.errors.join(" "), /current/);
});

test("unsupported schemas and authority-bearing imports are rejected without replacing recovery", () => {
  const storage = memoryStorage();
  const store = localStore(storage);
  const valid = applyCommand(syntheticProject(), closedWallCommand());
  store.save(valid);
  store.save(valid);

  const keys = localProjectStorageKeys(valid.id);
  const unsupported = JSON.parse(storage.getItem(keys.current));
  const unsupportedProject = JSON.parse(unsupported.projectJson);
  unsupportedProject.schemaVersion = 999;
  unsupported.projectJson = JSON.stringify(unsupportedProject);
  storage.forceSet(keys.current, JSON.stringify(unsupported));
  assert.equal(store.load(valid.id).source, "previous");

  const authorityBearing = JSON.parse(storage.getItem(keys.current));
  authorityBearing.companyId = "forged-company";
  storage.forceSet(keys.current, JSON.stringify(authorityBearing));
  const reopened = store.load(valid.id);
  assert.equal(reopened.source, "previous");
  assert.equal(reopened.companyAccountSaved, false);
});

test("denied local storage reports failure and never reports a saved state", () => {
  const storage = memoryStorage();
  storage.failReads(true);
  const store = localStore(storage);

  const loaded = store.load("project-synthetic-persistence");
  const saved = store.save(syntheticProject());

  assert.equal(loaded.ok, false);
  assert.equal(loaded.code, "read_failed");
  assert.equal(saved.ok, false);
  assert.equal(saved.companyAccountSaved, false);
});

function localStore(storage) {
  return createLocalProjectStore(storage, { now: () => new Date(FIXED_TIME) });
}

function syntheticProject() {
  return applyCommand(createProject("project-synthetic-persistence"), {
    type: "floor.add",
    floor: {
      id: "floor-synthetic-ground",
      name: "Synthetic Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "synthetic persistence fixture") },
        orientation: identityQuaternion(),
      },
    },
  });
}

function closedWallCommand() {
  return {
    type: "wall.addChain",
    floorId: "floor-synthetic-ground",
    nodeIds: [
      "synthetic-node-a",
      "synthetic-node-b",
      "synthetic-node-c",
      "synthetic-node-d",
      "synthetic-node-a",
    ],
    wallIds: [
      "synthetic-wall-ab",
      "synthetic-wall-bc",
      "synthetic-wall-cd",
      "synthetic-wall-da",
    ],
    points: [
      point(0, 0),
      point(6000, 0),
      point(6000, 4000),
      point(0, 4000),
      point(0, 0),
    ],
    thicknessMm: 140,
    heightMm: unknownMm("synthetic wall height not measured"),
    referenceLine: "centreline",
    classification: "physical",
  };
}

function point(x, y) {
  return { x, y, z: unknownMm("synthetic base elevation not measured") };
}

function memoryStorage() {
  const values = new Map();
  let failRead = false;
  let failSetPredicate = null;
  let corruptSet = null;
  return {
    getItem(key) {
      if (failRead) throw new Error("Synthetic local storage read denied");
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      if (failSetPredicate?.(key)) {
        failSetPredicate = null;
        throw new Error("Synthetic local storage quota exhausted");
      }
      if (corruptSet?.predicate(key)) {
        values.set(key, String(corruptSet.transform(value)));
        corruptSet = null;
      } else {
        values.set(key, String(value));
      }
    },
    removeItem(key) {
      values.delete(key);
    },
    failNextSet(predicate) {
      failSetPredicate = predicate;
    },
    failReads(value) {
      failRead = value;
    },
    corruptNextSet(predicate, transform) {
      corruptSet = { predicate, transform };
    },
    forceSet(key, value) {
      values.set(key, String(value));
    },
  };
}
