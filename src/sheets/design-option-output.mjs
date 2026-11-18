import { normalizeVentilationWorkspace, ventilationWorkspaceLabel } from "../editor/ventilation-workspace.mjs";
import { designOptionProjects } from "../domain/design-options.mjs";
import { createSheetOutputDocument, selectSheetOutputPages } from "./sheet-output.mjs";

// Design options and output system scope are independent selections.
// null selects all real design options; a scope never creates a design option.
export function createDesignOptionOutput(project, { optionId = project.activeDesignOptionId, systemScope = "combined", createSheet } = {}) {
  normalizeVentilationWorkspace(systemScope);
  if (typeof createSheet !== "function") throw new TypeError("A sheet factory is required");
  const candidates = designOptionProjects(project);
  const selected = optionId === null ? candidates : candidates.filter(({ option }) => option.id === optionId);
  if (!selected.length) throw new TypeError("The selected design option is unavailable");
  const entries = selected.flatMap(({ option, project: optionProject }) => {
    const floors = optionProject.floors.map(floor => ({
      option, project: optionProject, floor, sheet: createSheet(optionProject, option, { systemScope, floorId: floor.id }),
    }));
    const sharedDenominator = Math.max(0, ...floors.map(({ sheet }) => sheet.fit?.denominator ?? 0));
    return floors.map(entry => {
      const denominator = entry.sheet.fit?.denominator;
      if (!denominator || denominator === sharedDenominator) return entry;
      return {
        ...entry,
        sheet: createSheet(optionProject, option, { systemScope, floorId: entry.floor.id, minimumScaleDenominator: sharedDenominator }),
      };
    });
  });
  if (!entries.length) throw new TypeError("The project has no floor to export");
  const output = createSheetOutputDocument(entries.map(entry => entry.sheet));
  // Each drawing starts a storey's plan, installation details and parts group.
  let entryIndex = -1;
  const pages = output.map(page => {
    if (page.kind === "drawing") entryIndex += 1;
    const { option, floor, project: optionProject } = entries[entryIndex];
    const floorLabel = optionProject.floors.length > 1 ? ` · ${floor.name}` : "";
    return Object.freeze({
      ...page, systemScope, pageKey: JSON.stringify([option.id, floor.id, systemScope, page.kind, page.partsPageNumber ?? page.airflowPageNumber ?? page.installationPageNumber ?? 0]), floorId: floor.id, optionId: option.id, optionName: option.name, optionRevision: option.revision,
      pageDescription: page.pageDescription + floorLabel,
      label: `${option.name} · ${option.revision} · ${ventilationWorkspaceLabel(systemScope)} · ${page.label}${floorLabel}`,
    });
  });
  if (!selected.some(({ project }) => project.floors.length > 1)) return { entries, pages };

  const pageKinds = ["drawing", "installation-details", "q-series-electrical", "airflows", "parts-list"];
  const ordered = selected.flatMap(({ option }) => pageKinds.flatMap(kind =>
    pages.filter(page => page.optionId === option.id && page.kind === kind),
  ));
  const renumbered = selectSheetOutputPages(ordered, ordered.map((_, index) => index));
  return { entries, pages: renumbered.map((page, index) => {
    const { sourcePageNumber, ...numberedPage } = page;
    const source = ordered[index];
    return Object.freeze({
      ...numberedPage,
      label: source.label.replace(` · Page ${sourcePageNumber} ·`, ` · Page ${page.pageNumber} ·`),
    });
  }) };
}
