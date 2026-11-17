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
  const entries = selected.map(({ option, project: optionProject }) => ({
    option, project: optionProject, sheet: createSheet(optionProject, option, { systemScope }),
  }));
  const output = createSheetOutputDocument(entries.map(entry => entry.sheet));
  // Drawing pages mark each independent option's plan/details/parts group.
  let entryIndex = -1;
  const pages = output.map(page => {
    if (page.kind === "drawing") entryIndex += 1;
    const { option } = entries[entryIndex];
    return Object.freeze({
      ...page, systemScope, pageKey: JSON.stringify([option.id, systemScope, page.kind, page.partsPageNumber ?? 0]), optionId: option.id, optionName: option.name, optionRevision: option.revision,
      label: `${option.name} · ${option.revision} · ${ventilationWorkspaceLabel(systemScope)} · ${page.label}`,
    });
  });
  return { entries, pages };
}
