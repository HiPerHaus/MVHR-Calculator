import { createEngineeringInputs } from "./engineering-inputs.mjs";

export const DESIGN_OPTION_COPY_SCOPES = Object.freeze(["plan", "rooms", "markup"]);

const SNAPSHOT_COLLECTIONS = Object.freeze([
  "components",
  "equipmentAssemblies",
  "routes",
  "connections",
  "wallNodes",
  "walls",
  "floorAreaOutlines",
  "routingExclusions",
  "routingClearanceSettings",
  "rooms",
  "zones",
]);

const SNAPSHOT_FIELDS = Object.freeze([
  "ventilationDesignType",
  ...SNAPSHOT_COLLECTIONS,
  "engineeringInputs",
]);

export function createInitialDesignOptionState(project) {
  const id = `${project.id}-option-1`;
  return {
    activeDesignOptionId: id,
    designOptions: [{
      id,
      name: "Option A",
      revision: "Working",
      createdFromOptionId: null,
      snapshot: null,
    }],
  };
}

export function captureDesignOptionSnapshot(project) {
  const snapshot = { ventilationDesignType: project.ventilationDesignType };
  for (const field of SNAPSHOT_COLLECTIONS) snapshot[field] = structuredClone(project[field]);
  snapshot.engineeringInputs = structuredClone(project.engineeringInputs);
  return snapshot;
}

export function switchDesignOption(project, optionId) {
  if (optionId === project.activeDesignOptionId) return structuredClone(project);
  const next = synchronizeActiveDesignOption(project);
  const option = requireOption(next, optionId);
  applySnapshot(next, option.snapshot);
  next.activeDesignOptionId = option.id;
  option.snapshot = null;
  return next;
}

export function duplicateDesignOption(project, input) {
  const next = synchronizeActiveDesignOption(project);
  const source = requireOption(next, input.sourceOptionId ?? next.activeDesignOptionId);
  requireOpaqueId(input.id, "Design option ID");
  if (next.designOptions.some((option) => option.id === input.id)) {
    throw new TypeError(`Design option ID already exists: ${input.id}`);
  }
  const scopes = normalizeCopyScopes(input.copyScopes);
  const snapshot = duplicateSnapshot(source.snapshot, scopes, input.id);
  const option = {
    id: input.id,
    name: normalizeText(input.name, "Design option name", 80),
    revision: normalizeText(input.revision ?? "Working", "Design option revision", 40),
    createdFromOptionId: source.id,
    snapshot,
  };
  next.designOptions.push(option);
  if (input.activate !== false) {
    applySnapshot(next, snapshot);
    next.activeDesignOptionId = option.id;
    option.snapshot = null;
  } else {
    requireOption(next, next.activeDesignOptionId).snapshot = null;
  }
  return next;
}

export function updateDesignOption(project, input) {
  const next = structuredClone(project);
  const option = requireOption(next, input.optionId ?? next.activeDesignOptionId);
  option.name = normalizeText(input.name, "Design option name", 80);
  option.revision = normalizeText(input.revision, "Design option revision", 40);
  return next;
}

export function synchronizeActiveDesignOption(project) {
  const next = structuredClone(project);
  const active = requireOption(next, next.activeDesignOptionId);
  active.snapshot = captureDesignOptionSnapshot(next);
  return next;
}

export function designOptionProjects(project) {
  const synchronized = synchronizeActiveDesignOption(project);
  return synchronized.designOptions.map((option) => {
    const candidate = structuredClone(synchronized);
    applySnapshot(candidate, option.snapshot);
    candidate.activeDesignOptionId = option.id;
    requireOption(candidate, option.id).snapshot = null;
    return { option: structuredClone(option), project: candidate };
  });
}

export function validateDesignOptions(project, validateCandidate) {
  if (!Array.isArray(project.designOptions) || project.designOptions.length === 0) {
    throw new TypeError("Project requires at least one design option");
  }
  requireOpaqueId(project.activeDesignOptionId, "Active design option ID");
  const ids = new Set();
  for (const option of project.designOptions) {
    requireOpaqueId(option?.id, "Design option ID");
    if (ids.has(option.id)) throw new TypeError(`Duplicate design option ID: ${option.id}`);
    ids.add(option.id);
    normalizeText(option.name, "Design option name", 80);
    normalizeText(option.revision, "Design option revision", 40);
    if (option.createdFromOptionId !== null) requireOpaqueId(option.createdFromOptionId, "Design option source ID");
    if (option.id === project.activeDesignOptionId) {
      if (option.snapshot !== null) throw new TypeError("Active design option must use the current project design");
    } else {
      exactSnapshotFields(option.snapshot);
      const candidate = structuredClone(project);
      applySnapshot(candidate, option.snapshot);
      candidate.activeDesignOptionId = option.id;
      validateCandidate(candidate);
    }
  }
  if (!ids.has(project.activeDesignOptionId)) throw new TypeError("Active design option does not exist");
  return project;
}

function duplicateSnapshot(source, scopes, optionId) {
  const copyPlan = scopes.includes("plan") || scopes.includes("rooms");
  const copyRooms = scopes.includes("rooms");
  const copyMarkup = scopes.includes("markup");
  const snapshot = emptySnapshot();
  if (copyPlan) {
    for (const field of ["wallNodes", "walls", "floorAreaOutlines", "routingExclusions", "routingClearanceSettings"]) {
      snapshot[field] = structuredClone(source[field]);
    }
  }
  if (copyRooms) {
    snapshot.rooms = structuredClone(source.rooms);
    snapshot.zones = structuredClone(source.zones);
  }
  if (copyMarkup) {
    snapshot.ventilationDesignType = source.ventilationDesignType;
    for (const field of ["components", "equipmentAssemblies", "routes", "connections"]) {
      snapshot[field] = structuredClone(source[field]);
    }
    snapshot.engineeringInputs = structuredClone(source.engineeringInputs);
  }
  return remapSnapshotIdentities(snapshot, optionId);
}

function emptySnapshot() {
  const snapshot = { ventilationDesignType: "unclassified" };
  for (const field of SNAPSHOT_COLLECTIONS) snapshot[field] = [];
  snapshot.engineeringInputs = createEngineeringInputs();
  return snapshot;
}

function remapSnapshotIdentities(snapshot, optionId) {
  const identities = new Set();
  for (const field of SNAPSHOT_COLLECTIONS) collectEntityIds(snapshot[field], identities);
  const remap = new Map([...identities].map((id, index) => [id, `${optionId}-copy-${index + 1}`]));
  for (const component of snapshot.components) {
    for (const port of component.ports ?? []) {
      const mappedComponentId = remap.get(component.id);
      const mappedPortId = remap.get(port.id);
      if (mappedComponentId && mappedPortId) {
        remap.set(`derived from ${component.id}/${port.id}`, `derived from ${mappedComponentId}/${mappedPortId}`);
      }
    }
  }
  return replaceMappedStrings(snapshot, remap);
}

function collectEntityIds(value, identities) {
  if (Array.isArray(value)) {
    value.forEach((child) => collectEntityIds(child, identities));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (typeof value.id === "string") identities.add(value.id);
  Object.values(value).forEach((child) => collectEntityIds(child, identities));
}

function replaceMappedStrings(value, remap) {
  if (typeof value === "string") return remap.get(value) ?? value;
  if (Array.isArray(value)) return value.map((child) => replaceMappedStrings(child, remap));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replaceMappedStrings(child, remap)]));
}

function applySnapshot(project, snapshot) {
  exactSnapshotFields(snapshot);
  for (const field of SNAPSHOT_FIELDS) project[field] = structuredClone(snapshot[field]);
  return project;
}

function exactSnapshotFields(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError("Design option snapshot must be an object");
  }
  const actual = Object.keys(snapshot).sort();
  const expected = [...SNAPSHOT_FIELDS].sort();
  if (actual.join("\u0000") !== expected.join("\u0000")) {
    throw new TypeError("Design option snapshot contains unsupported fields");
  }
  for (const field of SNAPSHOT_COLLECTIONS) {
    if (!Array.isArray(snapshot[field])) throw new TypeError(`Design option ${field} must be an array`);
  }
  if (!snapshot.engineeringInputs || typeof snapshot.engineeringInputs !== "object") {
    throw new TypeError("Design option engineering inputs are required");
  }
}

function normalizeCopyScopes(value) {
  if (!Array.isArray(value)) throw new TypeError("Design option copy scopes must be an array");
  const scopes = [...new Set(value)];
  for (const scope of scopes) {
    if (!DESIGN_OPTION_COPY_SCOPES.includes(scope)) throw new TypeError(`Unsupported design option copy scope: ${scope}`);
  }
  return scopes;
}

function requireOption(project, optionId) {
  requireOpaqueId(optionId, "Design option ID");
  const option = project.designOptions.find((candidate) => candidate.id === optionId);
  if (!option) throw new TypeError(`Design option not found: ${optionId}`);
  return option;
}

function normalizeText(value, label, maximumLength) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required`);
  const normalized = value.trim();
  if (normalized.length > maximumLength) throw new RangeError(`${label} exceeds ${maximumLength} characters`);
  return normalized;
}

function requireOpaqueId(value, label) {
  if (typeof value !== "string" || value.trim().length < 3) throw new TypeError(`${label} must be an opaque string`);
}
