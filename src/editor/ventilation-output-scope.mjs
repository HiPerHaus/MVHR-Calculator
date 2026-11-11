import { componentVentilationWorkspace, normalizeVentilationWorkspace, ventilationWorkspaceIncludes } from "./ventilation-workspace.mjs";

// Read-only reporting view, not a valid replacement project or an engineering
// design. Validate the complete source before projecting; never save this view.
// Building geometry, references and independent design-option snapshots remain
// untouched. Quantities are derived afresh within the selected system.
export function ventilationOutputView(project, systemScope = "combined") {
  normalizeVentilationWorkspace(systemScope);
  if (systemScope === "combined") return project;
  const components = project.components.filter(component => ventilationWorkspaceIncludes(systemScope, componentVentilationWorkspace(component)));
  const ids = new Set(components.map(component => component.id));
  return {
    ...project, components,
    routes: systemScope === "centralised" ? project.routes : [],
    connections: project.connections.filter(connection => ids.has(connection.from.componentId) && ids.has(connection.to.componentId)),
    equipmentAssemblies: project.equipmentAssemblies.filter(assembly => assembly.componentIds.every(id => ids.has(id))),
    decentralisedCables: systemScope === "decentralised" ? project.decentralisedCables : [],
  };
}
