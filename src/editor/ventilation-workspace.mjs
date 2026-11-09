// Presentation only: switching tool palettes never mutates a project or filters
// the shared plan, checks, quantities or exports.
export const VENTILATION_WORKSPACES = Object.freeze(["centralised", "decentralised"]);

export function normalizeVentilationWorkspace(value) {
  if (!VENTILATION_WORKSPACES.includes(value)) throw new TypeError(`Unsupported ventilation workspace: ${String(value)}`);
  return value;
}

export function catalogueEntryWorkspace(entry) {
  return entry?.decentralisedSpecification || entry?.decentralisedControllerSpecification
    || ["Decentralised MVHR", "Decentralised controls"].includes(entry?.group)
    ? "decentralised" : "centralised";
}

export function defaultVentilationWorkspace(project, saved = null, legacyGroup = null) {
  if (VENTILATION_WORKSPACES.includes(saved)) return saved;
  if (legacyGroup && catalogueEntryWorkspace({ group: legacyGroup }) === "decentralised") return "decentralised";
  if (project.ventilationDesignType === "decentralised") return "decentralised";
  if (project.ventilationDesignType === "centralised") return "centralised";
  const components = project.components ?? [];
  const hasDecentralised = components.some(component => component.decentralisedMvhr || component.decentralisedController);
  const hasCentralised = components.some(component => !component.decentralisedMvhr && !component.decentralisedController)
    || project.routes?.length > 0 || project.connections?.length > 0 || project.equipmentAssemblies?.length > 0;
  return hasDecentralised && !hasCentralised ? "decentralised" : "centralised";
}
