import assert from "node:assert/strict";
import test from "node:test";

import { createDesignCheckSummary } from "../src/editor/design-check-summary.mjs";

test("design check groups existing evidence and keeps pressure not calculated", () => {
  const summary = createDesignCheckSummary({
    parts: { componentCount: 1 }, routes: { routeCount: 1 },
    diagnostics: [
      { id: "route:r1", code: "route-incomplete", severity: "warning", title: "Route has a free end", detail: "Free end", routeId: "r1", componentId: null },
      { id: "component:c1", code: "role", severity: "error", title: "Role mismatch", detail: "Mismatch", routeId: null, componentId: "c1" },
    ],
  }, {
    lines: [{ id: "room-1", kind: "room", name: "Bedroom" }],
    missingAssignedTargetSpaceIds: ["room-1"], targetWithoutTerminalSpaceIds: [], terminalWithoutTargetSpaceIds: [], unassignedTerminals: [],
  });
  assert.equal(summary.counts.errors, 1);
  assert.equal(summary.counts.warnings, 2);
  assert.equal(summary.counts.notCalculated, 1);
  assert.deepEqual(summary.groups.errors[0].target, { kind: "component", id: "c1" });
  assert.deepEqual(summary.groups.warnings[0].target, { kind: "route", id: "r1" });
  assert.deepEqual(summary.groups.warnings[1].target, { kind: "room", id: "room-1" });
  assert.equal(summary.groups.notCalculated[0].code, "network-pressure-not-calculated");
});

test("an empty design is a warning rather than a green pass", () => {
  const summary = createDesignCheckSummary({ parts: { componentCount: 0 }, routes: { routeCount: 0 }, diagnostics: [] }, {
    lines: [], missingAssignedTargetSpaceIds: [], targetWithoutTerminalSpaceIds: [], terminalWithoutTargetSpaceIds: [], unassignedTerminals: [],
  });
  assert.equal(summary.status, "warnings");
  assert.equal(summary.groups.warnings[0].code, "ventilation-model-empty");
});

test("engineering topology faults are errors while missing evidence remains not calculated", () => {
  const summary = createDesignCheckSummary({ parts: { componentCount: 1 }, routes: { routeCount: 1 }, diagnostics: [] }, {
    lines: [], missingAssignedTargetSpaceIds: [], targetWithoutTerminalSpaceIds: [], terminalWithoutTargetSpaceIds: [], unassignedTerminals: [],
  }, {
    status: "blocked",
    diagnostics: [
      { code: "allocation-disconnected", severity: "error", message: "Terminal path is disconnected", target: { componentId: "terminal-1" } },
      { code: "route-resistance-missing", severity: "error", message: "Resistance evidence is missing", target: { routeId: "route-1" } },
      { code: "fan-duty-insufficient", severity: "error", message: "Fan duty is below the calculated requirement", target: {} },
    ],
  });
  assert.equal(summary.groups.errors.some(item => item.code === "allocation-disconnected"), true);
  assert.equal(summary.groups.errors.some(item => item.code === "fan-duty-insufficient"), true);
  assert.equal(summary.groups.notCalculated.some(item => item.code === "route-resistance-missing"), true);
  assert.deepEqual(summary.groups.notCalculated.find(item => item.code === "route-resistance-missing").target, { kind: "route", id: "route-1" });
});
