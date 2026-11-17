import { normalizeVentilationWorkspace, ventilationWorkspaceLabel } from "../editor/ventilation-workspace.mjs";
import { designOptionProjects } from "../domain/design-options.mjs";
import { createSheetOutputDocument } from "./sheet-output.mjs";

// Design options and output system scope are independent selections.
// null selects all real design options; a scope never creates a design option.
export function createDesignOptionOutput(project, { optionId = project.activeDesignOptionId, systemScope = "combined", createSheet } = {}) {
  normalizeVentilationWorkspace(systemScope);
  if (typeof createSheet !== "function") throw new TypeError("A sheet factory is required");
  const candidates = designOptionProjects(project);
  const selected = optionId === null ? candidates : candidates.filter(({ option }) => option.id === optionId);
  if (!selected.length) throw new TypeError("The selected design option is unavailable");
  const entries = selected.flatMap(({ option, project: optionProject }) => optionProject.floors.map(floor => ({
    option, project: optionProject, floor, sheet: createSheet(optionProject, option, { systemScope, floorId: floor.id }),
  })));
  if (!entries.length) throw new TypeError("The project has no floor to export");
  const output = createSheetOutputDocument(entries.map(entry => entry.sheet));
  // Each drawing starts a storey's plan, installation details and parts group.
  let entryIndex = -1;
  const pages = output.map(page => {
    if (page.kind === "drawing") entryIndex += 1;
    const { option, floor, project: optionProject } = entries[entryIndex];
    const floorLabel = optionProject.floors.length > 1 ? ` · ${floor.name}` : "";
    return Object.freeze({
      ...page, systemScope, pageKey: JSON.stringify([option.id, floor.id, systemScope, page.kind, page.partsPageNumber ?? 0]), floorId: floor.id, optionId: option.id, optionName: option.name, optionRevision: option.revision,
      pageDescription: page.pageDescription + floorLabel,
      label: `${option.name} · ${option.revision} · ${ventilationWorkspaceLabel(systemScope)} · ${page.label}${floorLabel}`,
    });
  });
  return { entries, pages };
}
