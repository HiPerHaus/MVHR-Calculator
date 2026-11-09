export const STUDIO_DESIGN_STAGES = Object.freeze(["plan", "draw", "check", "export"]);

// Place and Route were two entries into the same canvas. Accept saved view names
// without changing the project, then present the single Draw workspace.
export function normalizeStudioDesignStage(stage) {
  const normalized = stage === "place" || stage === "route" ? "draw" : stage;
  if (!STUDIO_DESIGN_STAGES.includes(normalized)) throw new TypeError(`Unsupported Studio design stage: ${String(stage)}`);
  return normalized;
}

const TASK_BY_STAGE = Object.freeze({ plan: "plan", draw: "ventilation", check: "checks", export: "sheets" });

export function studioTaskForStage(stage) {
  return TASK_BY_STAGE[normalizeStudioDesignStage(stage)];
}

export function transitionStudioDesignStage(currentStage, requestedStage) {
  const stage = normalizeStudioDesignStage(requestedStage);
  return Object.freeze({ stage, task: TASK_BY_STAGE[stage], changed: normalizeStudioDesignStage(currentStage) !== stage });
}
