export const VENTILATION_PROJECT_TYPES = Object.freeze([
  "unclassified",
  "centralised",
  "decentralised",
  "mixed",
]);

export function normalizeVentilationProjectType(value) {
  if (!VENTILATION_PROJECT_TYPES.includes(value)) {
    throw new TypeError(`Unsupported ventilation project type: ${String(value)}`);
  }
  return value;
}

export function ventilationProjectTypeLabel(value) {
  const type = normalizeVentilationProjectType(value);
  return type === "centralised"
    ? "Centralised"
    : type === "decentralised"
      ? "Decentralised"
      : type === "mixed"
        ? "Mixed"
        : "Unclassified";
}

export function filterVentilationProjectEntries(entries, filter = "all") {
  if (!Array.isArray(entries)) throw new TypeError("Project entries must be an array");
  if (filter !== "all") normalizeVentilationProjectType(filter);
  return entries.filter((entry) => filter === "all" || entry?.ventilationDesignType === filter);
}

export function inspectVentilationProjectType(project) {
  if (!project || typeof project !== "object") throw new TypeError("Project is required");
  const selectedType = normalizeVentilationProjectType(project.ventilationDesignType);
  const components = Array.isArray(project.components) ? project.components : [];
  const decentralisedUnitCount = components.filter((component) => component?.decentralisedMvhr).length;
  const centralComponentCount = components.length - decentralisedUnitCount;
  const centralRouteCount = Array.isArray(project.routes) ? project.routes.length : 0;
  const centralConnectionCount = Array.isArray(project.connections) ? project.connections.length : 0;
  const centralAssemblyCount = Array.isArray(project.equipmentAssemblies) ? project.equipmentAssemblies.length : 0;
  const centralObjectCount = centralComponentCount + centralRouteCount + centralConnectionCount + centralAssemblyCount;
  const contentType = decentralisedUnitCount > 0 && centralObjectCount > 0
    ? "mixed"
    : decentralisedUnitCount > 0
      ? "decentralised"
      : centralObjectCount > 0
        ? "centralised"
        : "unclassified";
  const conflictsWithContent = selectedType !== "unclassified" && selectedType !== "mixed"
    && contentType !== "unclassified" && contentType !== selectedType;
  return Object.freeze({
    selectedType,
    selectedLabel: ventilationProjectTypeLabel(selectedType),
    contentType,
    contentLabel: ventilationProjectTypeLabel(contentType),
    conflictsWithContent,
    suggestedType: conflictsWithContent ? "mixed" : contentType,
    decentralisedUnitCount,
    centralObjectCount,
  });
}
