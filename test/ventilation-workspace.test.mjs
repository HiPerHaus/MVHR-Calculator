import assert from "node:assert/strict";
import test from "node:test";
import { COMPONENT_CATALOGUE } from "../src/editor/component-catalogue.mjs";
import { catalogueEntryWorkspace, defaultVentilationWorkspace, normalizeVentilationWorkspace } from "../src/editor/ventilation-workspace.mjs";

test("every catalogue record remains available in exactly one tool workspace", () => {
  const central = COMPONENT_CATALOGUE.filter(item => catalogueEntryWorkspace(item) === "centralised");
  const decentral = COMPONENT_CATALOGUE.filter(item => catalogueEntryWorkspace(item) === "decentralised");
  assert.equal(central.length + decentral.length, COMPONENT_CATALOGUE.length);
  assert.ok(central.length > 0 && decentral.length > 0);
  assert.ok(decentral.some(item => item.id === "lunos-e2-60-decentralised"));
  assert.ok(decentral.some(item => item.decentralisedControllerSpecification));
  assert.ok(central.every(item => !item.decentralisedSpecification && !item.decentralisedControllerSpecification));
  for (const group of ["Units", "Terminals", "Attenuation & distribution", "Duct", "Fittings"]) assert.equal(catalogueEntryWorkspace({ group }), "centralised");
});

test("project defaults and saved mixed-project tab choice are presentation only", () => {
  const project = { ventilationDesignType: "mixed", components: [{ id: "c" }, { id: "d", decentralisedMvhr: {} }], routes: [{ id: "r" }] };
  const before = structuredClone(project);
  assert.equal(defaultVentilationWorkspace(project), "centralised");
  assert.equal(defaultVentilationWorkspace(project, "decentralised"), "decentralised");
  assert.equal(defaultVentilationWorkspace(project, null, "Decentralised controls"), "decentralised");
  assert.equal(defaultVentilationWorkspace({ ...project, ventilationDesignType: "decentralised" }), "decentralised");
  assert.equal(defaultVentilationWorkspace({ ...project, ventilationDesignType: "centralised" }), "centralised");
  assert.equal(defaultVentilationWorkspace({ ventilationDesignType: "unclassified", components: [{ decentralisedMvhr: {} }] }), "decentralised");
  assert.equal(defaultVentilationWorkspace({ ventilationDesignType: "unclassified", components: [] }), "centralised");
  assert.deepEqual(project, before);
  assert.throws(() => normalizeVentilationWorkspace("mixed"), /Unsupported ventilation workspace/);
});
