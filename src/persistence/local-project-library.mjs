import { validateProject } from "../domain/spatial.mjs";
import { createLocalProjectStore } from "./local-project-store.mjs";

export const LOCAL_LIBRARY_FORMAT = "hiper-studio-device-project-library";
export const LOCAL_LIBRARY_VERSION = 1;
export const LOCAL_LIBRARY_SCOPE = "browser-device-local";

const INDEX_FIELDS = Object.freeze([
  "activeProjectId",
  "format",
  "projects",
  "storageScope",
  "version",
]);

const PROJECT_FIELDS = Object.freeze([
  "createdAtUtc",
  "id",
  "lastSavedAtUtc",
  "localSaveNumber",
  "name",
]);

/**
 * Named, browser-local project checkpoints. Project names are presentation
 * metadata only; stable opaque project IDs remain the storage identity.
 */
export function createLocalProjectLibrary(storage, options = {}) {
  validateStorage(storage);
  const now = options.now ?? (() => new Date());
  const indexPrefix = options.indexPrefix ?? "hiper-studio:device-project-library:v1";
  const projectStore = createLocalProjectStore(storage, {
    now,
    keyPrefix: options.projectKeyPrefix ?? "hiper-studio:named-project:v1",
    portableMaximumBytes: options.portableMaximumBytes,
  });
  const keys = {
    current: `${indexPrefix}:current`,
    previous: `${indexPrefix}:previous`,
    staging: `${indexPrefix}:staging`,
  };

  return Object.freeze({
    listProjects() {
      const loaded = loadIndex(storage, keys);
      if (!loaded.ok) return loaded;
      return {
        ok: true,
        projects: [...loaded.index.projects]
          .sort((left, right) => right.lastSavedAtUtc.localeCompare(left.lastSavedAtUtc)),
        activeProjectId: loaded.index.activeProjectId,
        recoveredFromInvalidCurrent: loaded.recoveredFromInvalidCurrent,
        storageScope: LOCAL_LIBRARY_SCOPE,
      };
    },

    loadProject(projectId) {
      const loaded = loadIndex(storage, keys);
      if (!loaded.ok) return loaded;
      const metadata = loaded.index.projects.find((project) => project.id === projectId);
      if (!metadata) {
        return { ok: true, found: false, storageScope: LOCAL_LIBRARY_SCOPE };
      }
      const result = projectStore.loadVersion(projectId, metadata.localSaveNumber);
      if (!result.ok || !result.found) {
        return {
          ...result,
          ok: false,
          found: false,
          code: result.code ?? "missing_named_project",
          message: result.message ?? "The named project checkpoint is missing.",
        };
      }
      return {
        ...result,
        metadata,
        name: metadata.name,
        storageScope: LOCAL_LIBRARY_SCOPE,
      };
    },

    saveProject(project, name) {
      const validated = structuredClone(validateProject(project));
      const cleanName = validateProjectName(name);
      const before = loadIndex(storage, keys);
      if (!before.ok) return before;
      const saved = projectStore.save(validated);
      if (!saved.ok) return saved;
      const existing = before.index.projects.find((entry) => entry.id === validated.id);
      const metadata = {
        id: validated.id,
        name: cleanName,
        createdAtUtc: existing?.createdAtUtc ?? saved.savedAtUtc,
        lastSavedAtUtc: saved.savedAtUtc,
        localSaveNumber: saved.localSaveNumber,
      };
      const next = {
        ...before.index,
        activeProjectId: validated.id,
        projects: [
          ...before.index.projects.filter((entry) => entry.id !== validated.id),
          metadata,
        ],
      };
      const indexed = saveIndex(storage, keys, next);
      if (!indexed.ok) {
        return {
          ...indexed,
          previousValidRetained: true,
          projectCheckpointWritten: true,
        };
      }
      return {
        ...saved,
        metadata,
        name: cleanName,
        storageScope: LOCAL_LIBRARY_SCOPE,
      };
    },

    setActiveProject(projectId) {
      const loaded = loadIndex(storage, keys);
      if (!loaded.ok) return loaded;
      if (projectId !== null && !loaded.index.projects.some((entry) => entry.id === projectId)) {
        return { ok: false, code: "unknown_project", message: "The project is not in this browser library." };
      }
      return saveIndex(storage, keys, { ...loaded.index, activeProjectId: projectId });
    },

    migrateLegacy(legacyLoad, defaultName = "Recovered project") {
      const loaded = loadIndex(storage, keys);
      if (!loaded.ok) return loaded;
      if (loaded.index.projects.length > 0 || !legacyLoad?.ok || !legacyLoad.found) {
        return { ok: true, migrated: false, index: loaded.index };
      }
      const saved = this.saveProject(legacyLoad.project, defaultName);
      return saved.ok
        ? { ...saved, migrated: true }
        : { ...saved, migrated: false };
    },
  });
}

export function validateProjectName(name) {
  if (typeof name !== "string") throw new TypeError("Project name must be text");
  const clean = name.trim();
  if (!clean) throw new TypeError("Project name is required");
  if (clean.length > 120) throw new RangeError("Project name must be 120 characters or fewer");
  return clean;
}

export function createOpaqueProjectId(cryptoSource = globalThis.crypto) {
  if (typeof cryptoSource?.randomUUID === "function") return `project-${cryptoSource.randomUUID()}`;
  const bytes = new Uint8Array(16);
  if (typeof cryptoSource?.getRandomValues !== "function") {
    throw new TypeError("Secure random project identity is unavailable");
  }
  cryptoSource.getRandomValues(bytes);
  return `project-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function emptyIndex() {
  return {
    format: LOCAL_LIBRARY_FORMAT,
    version: LOCAL_LIBRARY_VERSION,
    storageScope: LOCAL_LIBRARY_SCOPE,
    activeProjectId: null,
    projects: [],
  };
}

function loadIndex(storage, keys) {
  const errors = [];
  try {
    const currentRaw = storage.getItem(keys.current);
    const current = tryParseIndex(currentRaw, "current", errors);
    if (current) return { ok: true, index: current, recoveredFromInvalidCurrent: false, errors };
    const previous = tryParseIndex(storage.getItem(keys.previous), "previous", errors);
    if (previous) return { ok: true, index: previous, recoveredFromInvalidCurrent: true, errors };
    if (currentRaw === null && storage.getItem(keys.previous) === null) {
      return { ok: true, index: emptyIndex(), recoveredFromInvalidCurrent: false, errors: [] };
    }
    return { ok: false, code: "invalid_project_library", message: errors.join(" "), errors };
  } catch (error) {
    return failure("read_failed", error);
  }
}

function saveIndex(storage, keys, index) {
  const validated = parseIndex(JSON.stringify(index));
  try {
    const currentRaw = storage.getItem(keys.current);
    const current = tryParseIndex(currentRaw, "current", []);
    const encoded = JSON.stringify(validated);
    storage.setItem(keys.staging, encoded);
    parseIndex(storage.getItem(keys.staging));
    if (current) storage.setItem(keys.previous, currentRaw);
    storage.setItem(keys.current, encoded);
    const committed = parseIndex(storage.getItem(keys.current));
    try {
      storage.removeItem(keys.staging);
    } catch {
      // The verified current index is durable; stale staging is ignored.
    }
    return { ok: true, index: committed, storageScope: LOCAL_LIBRARY_SCOPE };
  } catch (error) {
    return failure("write_failed", error);
  }
}

function parseIndex(encoded) {
  if (typeof encoded !== "string") throw new TypeError("Project library index must be text");
  const index = JSON.parse(encoded);
  exactFields(index, INDEX_FIELDS, "Project library index");
  if (index.format !== LOCAL_LIBRARY_FORMAT || index.version !== LOCAL_LIBRARY_VERSION) {
    throw new RangeError("Unsupported project library index version");
  }
  if (index.storageScope !== LOCAL_LIBRARY_SCOPE) throw new TypeError("Project library scope is invalid");
  if (index.activeProjectId !== null && typeof index.activeProjectId !== "string") {
    throw new TypeError("Active project ID is invalid");
  }
  if (!Array.isArray(index.projects)) throw new TypeError("Project library entries must be an array");
  const ids = new Set();
  for (const project of index.projects) {
    exactFields(project, PROJECT_FIELDS, "Project library entry");
    if (typeof project.id !== "string" || project.id.length < 3 || ids.has(project.id)) {
      throw new TypeError("Project library IDs must be unique stable strings");
    }
    ids.add(project.id);
    validateProjectName(project.name);
    for (const field of ["createdAtUtc", "lastSavedAtUtc"]) {
      if (typeof project[field] !== "string" || !Number.isFinite(Date.parse(project[field]))) {
        throw new TypeError(`Project library ${field} is invalid`);
      }
    }
    if (!Number.isInteger(project.localSaveNumber) || project.localSaveNumber < 1) {
      throw new TypeError("Project library save number is invalid");
    }
  }
  if (index.activeProjectId !== null && !ids.has(index.activeProjectId)) {
    throw new TypeError("Active project must reference a library entry");
  }
  return structuredClone(index);
}

function tryParseIndex(encoded, label, errors) {
  if (encoded === null) return null;
  try {
    return parseIndex(encoded);
  } catch (error) {
    errors.push(`${label}: ${error.message}`);
    return null;
  }
}

function exactFields(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  if (Object.keys(value).sort().join("\u0000") !== [...expected].sort().join("\u0000")) {
    throw new TypeError(`${label} contains unsupported fields`);
  }
}

function failure(code, error) {
  return {
    ok: false,
    code,
    message: error instanceof Error ? error.message : String(error),
    storageScope: LOCAL_LIBRARY_SCOPE,
  };
}

function validateStorage(storage) {
  for (const method of ["getItem", "setItem", "removeItem"]) {
    if (typeof storage?.[method] !== "function") throw new TypeError(`Project library requires ${method}`);
  }
}
