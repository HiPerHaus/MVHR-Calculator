import assert from "node:assert/strict";
import test from "node:test";
import { STUDIO_DESIGN_STAGES, normalizeStudioDesignStage, studioTaskForStage, transitionStudioDesignStage } from "../src/editor/studio-design-stages.mjs";

test("one Draw stage combines placement and routing without project data", () => {
  assert.deepEqual(STUDIO_DESIGN_STAGES, ["plan", "draw", "check", "export"]);
  assert.deepEqual(STUDIO_DESIGN_STAGES.map(studioTaskForStage), ["plan", "ventilation", "checks", "sheets"]);
  assert.deepEqual(transitionStudioDesignStage("draw", "draw"), { stage: "draw", task: "ventilation", changed: false });
  assert.deepEqual(transitionStudioDesignStage("plan", "draw"), { stage: "draw", task: "ventilation", changed: true });
  assert.throws(() => studioTaskForStage("detailed-design"), /Unsupported Studio design stage/);
});

test("legacy Place and Route sessions normalize to Draw", () => {
  for (const legacy of ["place", "route"]) {
    assert.equal(normalizeStudioDesignStage(legacy), "draw");
    assert.equal(studioTaskForStage(legacy), "ventilation");
    assert.deepEqual(transitionStudioDesignStage(legacy, "draw"), { stage: "draw", task: "ventilation", changed: false });
    assert.deepEqual(transitionStudioDesignStage("plan", legacy), { stage: "draw", task: "ventilation", changed: true });
  }
});
