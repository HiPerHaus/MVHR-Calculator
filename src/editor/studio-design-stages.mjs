export const STUDIO_DESIGN_STAGES = Object.freeze(["plan", "place", "route", "check", "export"]);

const TASK_BY_STAGE = Object.freeze({
  plan: "plan",
  place: "ventilation",
  route: "ventilation",
  check: "checks",
  export: "sheets",
});

export function studioTaskForStage(stage) {
  if (!STUDIO_DESIGN_STAGES.includes(stage)) throw new TypeError(`Unsupported Studio design stage: ${String(stage)}`);
  return TASK_BY_STAGE[stage];
}

export function transitionStudioDesignStage(currentStage, requestedStage) {
  studioTaskForStage(requestedStage);
  return Object.freeze({
    stage: requestedStage,
    task: TASK_BY_STAGE[requestedStage],
    changed: currentStage !== requestedStage,
  });
}
