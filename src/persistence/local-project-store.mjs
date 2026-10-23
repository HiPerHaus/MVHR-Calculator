import {
  deserializeProject,
  serializeProject,
  validateProject,
} from "../domain/spatial.mjs";
import { inspectPortableEnvelopeBudget } from "./portable-envelope.mjs";

export const LOCAL_DRAFT_FORMAT = "hiper-studio-local-working-draft";
export const LOCAL_ADAPTER_VERSION = 1;
export const LOCAL_STORAGE_SCOPE = "device-local-prototype";

const RECORD_FIELDS = Object.freeze([
  "adapterVersion",
  "format",
  "localSaveNumber",
  "projectId",
  "projectJson",
  "savedAtUtc",
  "storageScope",
]);

/**
 * Journaled browser-local persistence for the bounded evaluation shell.
 *
 * A successful acknowledgement means only "Saved on this device". This
 * adapter has no account, tenant, permission, server-version or cloud-storage
 * authority. The interface is intentionally replaceable by a future
 * authenticated persistence boundary.
 */
export function createLocalProjectStore(storage, options = {}) {
  validateStorage(storage);
  const now = options.now ?? (() => new Date());
  const keyPrefix = options.keyPrefix ?? "hiper-studio:local-prototype";
  const portableMaximumBytes = options.portableMaximumBytes;

  return Object.freeze({
    load(projectId) {
      const keys = localProjectStorageKeys(projectId, keyPrefix);
      const errors = [];
      try {
        const currentRaw = storage.getItem(keys.current);
        const current = tryParseRecord(currentRaw, projectId, "current", errors);
        if (current) return loadSuccess(current, "current", errors, portableMaximumBytes);

        const previousRaw = storage.getItem(keys.previous);
        const previous = tryParseRecord(previousRaw, projectId, "previous", errors);
        if (previous) return loadSuccess(previous, "previous", errors, portableMaximumBytes);

        if (currentRaw === null && previousRaw === null) {
          return { ok: true, found: false, errors: [] };
        }
        return {
          ok: false,
          found: false,
          code: "invalid_local_draft",
          message: errors.join(" ") || "No valid local working draft was found.",
          errors,
        };
      } catch (error) {
        return storageFailure("read_failed", error, false);
      }
    },

    loadVersion(projectId, localSaveNumber) {
      if (!Number.isInteger(localSaveNumber) || localSaveNumber < 1) {
        throw new TypeError("Local save number must be a positive integer");
      }
      const keys = localProjectStorageKeys(projectId, keyPrefix);
      const errors = [];
      try {
        for (const [source, key] of [["current", keys.current], ["previous", keys.previous]]) {
          const record = tryParseRecord(storage.getItem(key), projectId, source, errors);
          if (record?.localSaveNumber === localSaveNumber) {
            return loadSuccess(record, source, errors, portableMaximumBytes);
          }
        }
        return {
          ok: false,
          found: false,
          code: "missing_local_revision",
          message: `Local save #${localSaveNumber} was not found for this project.`,
          errors,
        };
      } catch (error) {
        return storageFailure("read_failed", error, false);
      }
    },

    save(project) {
      const validated = structuredClone(validateProject(project));
      const keys = localProjectStorageKeys(validated.id, keyPrefix);
      let previousValid = null;
      try {
        const currentRaw = storage.getItem(keys.current);
        previousValid = tryParseRecord(currentRaw, validated.id, "current", []);
        const localSaveNumber = (previousValid?.localSaveNumber ?? 0) + 1;
        const record = createRecord(validated, localSaveNumber, now);
        const encoded = JSON.stringify(record);

        storage.setItem(keys.staging, encoded);
        parseRecord(storage.getItem(keys.staging), validated.id);
        if (previousValid) storage.setItem(keys.previous, currentRaw);
        storage.setItem(keys.current, encoded);
        const committed = parseRecord(storage.getItem(keys.current), validated.id);

        try {
          storage.removeItem(keys.staging);
        } catch {
          // A verified current record is already durable; stale staging is ignored.
        }

        return {
          ok: true,
          project: committed.project,
          projectId: committed.projectId,
          savedAtUtc: committed.savedAtUtc,
          localSaveNumber: committed.localSaveNumber,
          storageScope: LOCAL_STORAGE_SCOPE,
          companyAccountSaved: false,
          portableBudget: inspectPortableEnvelopeBudget(committed.projectJson, {
            maximumBytes: portableMaximumBytes,
          }),
        };
      } catch (error) {
        return storageFailure("write_failed", error, Boolean(previousValid));
      }
    },
  });
}

export function localProjectStorageKeys(projectId, keyPrefix = "hiper-studio:local-prototype") {
  if (typeof projectId !== "string" || projectId.trim().length < 3) {
    throw new TypeError("Project ID is required for local storage");
  }
  const root = `${keyPrefix}:${encodeURIComponent(projectId)}`;
  return {
    current: `${root}:current`,
    previous: `${root}:previous`,
    staging: `${root}:staging`,
  };
}

export function parseLocalProjectRecord(encoded, expectedProjectId) {
  return parseRecord(encoded, expectedProjectId);
}

function createRecord(project, localSaveNumber, now) {
  const date = now();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TypeError("Local save clock must return a valid Date");
  }
  return {
    format: LOCAL_DRAFT_FORMAT,
    adapterVersion: LOCAL_ADAPTER_VERSION,
    storageScope: LOCAL_STORAGE_SCOPE,
    projectId: project.id,
    localSaveNumber,
    savedAtUtc: date.toISOString(),
    projectJson: serializeProject(project),
  };
}

function parseRecord(encoded, expectedProjectId) {
  if (typeof encoded !== "string") {
    throw new TypeError("Local project record must be a string");
  }
  const record = JSON.parse(encoded);
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("Local project record must be an object");
  }
  const actualFields = Object.keys(record).sort();
  const expectedFields = [...RECORD_FIELDS].sort();
  if (actualFields.join("\u0000") !== expectedFields.join("\u0000")) {
    throw new TypeError("Local project record contains unsupported or authority-bearing fields");
  }
  if (record.format !== LOCAL_DRAFT_FORMAT) {
    throw new TypeError("Unsupported local project record format");
  }
  if (record.adapterVersion !== LOCAL_ADAPTER_VERSION) {
    throw new RangeError(`Unsupported local adapter version: ${String(record.adapterVersion)}`);
  }
  if (record.storageScope !== LOCAL_STORAGE_SCOPE) {
    throw new TypeError("Local project record storage scope is invalid");
  }
  if (record.projectId !== expectedProjectId) {
    throw new TypeError("Local project record does not match the requested project");
  }
  if (!Number.isInteger(record.localSaveNumber) || record.localSaveNumber < 1) {
    throw new TypeError("Local save number must be a positive integer");
  }
  if (typeof record.savedAtUtc !== "string" || !Number.isFinite(Date.parse(record.savedAtUtc))) {
    throw new TypeError("Local save timestamp is invalid");
  }
  const project = structuredClone(deserializeProject(record.projectJson));
  if (project.id !== record.projectId) {
    throw new TypeError("Local project record project identity is inconsistent");
  }
  return { ...record, project };
}

function tryParseRecord(encoded, projectId, label, errors) {
  if (encoded === null) return null;
  try {
    return parseRecord(encoded, projectId);
  } catch (error) {
    errors.push(`${label}: ${error.message}`);
    return null;
  }
}

function loadSuccess(record, source, errors, portableMaximumBytes) {
  return {
    ok: true,
    found: true,
    project: record.project,
    projectId: record.projectId,
    savedAtUtc: record.savedAtUtc,
    localSaveNumber: record.localSaveNumber,
    storageScope: LOCAL_STORAGE_SCOPE,
    companyAccountSaved: false,
    source,
    recoveredFromInvalidCurrent: source === "previous",
    errors,
    portableBudget: inspectPortableEnvelopeBudget(serializeProject(record.project), {
      maximumBytes: portableMaximumBytes,
    }),
  };
}

function storageFailure(code, error, previousValidRetained) {
  return {
    ok: false,
    found: false,
    code,
    message: error instanceof Error ? error.message : String(error),
    previousValidRetained,
    companyAccountSaved: false,
  };
}

function validateStorage(storage) {
  for (const method of ["getItem", "setItem", "removeItem"]) {
    if (typeof storage?.[method] !== "function") {
      throw new TypeError(`Local storage adapter requires ${method}`);
    }
  }
}
