import { designOptionProjects } from "../domain/design-options.mjs";
import { createSheetOutputDocument } from "./sheet-output.mjs";

// Export selection is independent from the editable option and tool workspace.
// null selects all real design options, never Centralised/Decentralised filters.
export function createDesignOptionOutput(project, { optionId = project.activeDesignOptionId, createSheet } = {}) {
  if (typeof createSheet !== "function") throw new TypeError("A sheet factory is required");
  const candidates = designOptionProjects(project);
  const selected = optionId === null ? candidates : candidates.filter(({ option }) => option.id === optionId);
  if (!selected.length) throw new TypeError("The selected design option is unavailable");
  const entries = selected.map(({ option, project: optionProject }) => ({
    option, project: optionProject, sheet: createSheet(optionProject, option),
  }));
  const output = createSheetOutputDocument(entries.map(entry => entry.sheet));
  // Drawing pages mark each independent option's plan/details/parts group.
  let entryIndex = -1;
  const pages = output.map(page => {
    if (page.kind === "drawing") entryIndex += 1;
    const { option } = entries[entryIndex];
    return Object.freeze({
      ...page, optionId: option.id, optionName: option.name, optionRevision: option.revision,
      label: `${option.name} · ${option.revision} · ${page.label}`,
    });
  });
  return { entries, pages };
}
