import assert from "node:assert/strict";
import test from "node:test";

import { studioTaskForStage, transitionStudioDesignStage } from "../src/editor/studio-design-stages.mjs";

test("design stages map to presentation tasks without project data", () => {
  assert.deepEqual(["plan", "place", "route", "check", "export"].map(studioTaskForStage), ["plan", "ventilation", "ventilation", "checks", "sheets"]);
  assert.deepEqual(transitionStudioDesignStage("place", "place"), { stage: "place", task: "ventilation", changed: false });
  assert.deepEqual(transitionStudioDesignStage("place", "route"), { stage: "route", task: "ventilation", changed: true });
  assert.throws(() => studioTaskForStage("detailed-design"), /Unsupported Studio design stage/);
});
