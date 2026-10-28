import test from "node:test";
import assert from "node:assert/strict";
import {
  routeVisibilityGroup,
  ventilationVisibilityGroup,
  VENTILATION_VISIBILITY_GROUPS,
} from "../src/editor/ventilation-visibility.mjs";

test("ventilation view groups keep ductwork, equipment and annotations distinct", () => {
  assert.deepEqual(VENTILATION_VISIBILITY_GROUPS, [
    ["dn90", "90 mm duct"],
    ["epp", "EPP"],
    ["hrv", "HRV"],
    ["distribution", "distribution & attenuators"],
    ["terminals", "outlets"],
    ["external", "external grilles"],
    ["other", "other components"],
    ["bend-labels", "bend labels"],
  ]);
  assert.equal(routeVisibilityGroup({ ductKind: "semi-rigid-radial" }), "dn90");
  assert.equal(routeVisibilityGroup({ ductKind: "epp-rigid-dn160" }), "epp");
  assert.equal(routeVisibilityGroup({ ductKind: "generic-duct" }), "other");
});

test("ventilation component grouping follows catalogue category without changing the model", () => {
  assert.equal(ventilationVisibilityGroup({ category: "mvhr-unit-vertical" }), "hrv");
  assert.equal(ventilationVisibilityGroup({ category: "distribution-box" }), "distribution");
  assert.equal(ventilationVisibilityGroup({ category: "attenuator-manifold" }), "distribution");
  assert.equal(ventilationVisibilityGroup({ category: "terminal" }), "terminals");
  assert.equal(ventilationVisibilityGroup({ category: "external-grille" }), "external");
  assert.equal(ventilationVisibilityGroup({ category: "unknown-import" }), "other");
});
