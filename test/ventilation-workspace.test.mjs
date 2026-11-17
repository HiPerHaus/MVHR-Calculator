import assert from "node:assert/strict";
import test from "node:test";
import { COMPONENT_CATALOGUE } from "../src/editor/component-catalogue.mjs";
import { componentVentilationWorkspace, catalogueEntryWorkspace, defaultVentilationWorkspace, normalizeVentilationWorkspace, ventilationWorkspaceIncludes, ventilationWorkspaceLabel } from "../src/editor/ventilation-workspace.mjs";

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
  assert.equal(defaultVentilationWorkspace(project), "combined");
  assert.equal(defaultVentilationWorkspace(project, "decentralised"), "decentralised");
  assert.equal(defaultVentilationWorkspace(project, null, "Decentralised controls"), "decentralised");
  assert.equal(defaultVentilationWorkspace({ ...project, ventilationDesignType: "decentralised" }), "decentralised");
  assert.equal(defaultVentilationWorkspace({ ...project, ventilationDesignType: "centralised" }), "centralised");
  assert.equal(defaultVentilationWorkspace({ ventilationDesignType: "unclassified", components: [{ decentralisedMvhr: {} }] }), "decentralised");
  assert.equal(defaultVentilationWorkspace({ ventilationDesignType: "unclassified", components: [] }), "centralised");
  assert.deepEqual(project, before);
  assert.throws(() => normalizeVentilationWorkspace("mixed"), /Unsupported ventilation workspace/);
});


test("Combined exposes both toolsets without becoming a project type", () => {
  assert.equal(normalizeVentilationWorkspace("combined"), "combined");
  assert.equal(ventilationWorkspaceLabel("combined"), "Combined");
  assert.equal(ventilationWorkspaceLabel("centralised"), "Centralised");
  assert.equal(ventilationWorkspaceLabel("decentralised"), "Decentralised");
  assert.throws(() => ventilationWorkspaceLabel("mixed"), /Unsupported ventilation workspace/);
  for (const item of COMPONENT_CATALOGUE) {
    const system = catalogueEntryWorkspace(item);
    assert.equal(ventilationWorkspaceIncludes("combined", system), true);
    assert.equal(ventilationWorkspaceIncludes(system, system), true);
    assert.equal(ventilationWorkspaceIncludes(system === "centralised" ? "decentralised" : "centralised", system), false);
  }
});

test("mixed content defaults to Combined while saved single-system choices stay authoritative", () => {
  const project = { ventilationDesignType: "unclassified", components: [{ id: "c" }, { id: "d", decentralisedMvhr: {} }] };
  const before = structuredClone(project);
  assert.equal(defaultVentilationWorkspace(project), "combined");
  for (const saved of ["centralised", "decentralised", "combined"]) {
    assert.equal(defaultVentilationWorkspace({ ...project, ventilationDesignType: "mixed" }, saved), saved);
  }
  assert.equal(defaultVentilationWorkspace({ components: [{ decentralisedController: {} }], routes: [{ id: "r" }] }), "combined");
  assert.equal(defaultVentilationWorkspace({ components: [] }, null, "Decentralised controls"), "decentralised");
  assert.deepEqual(project, before);
});


test("placed components have a stable workspace independent of catalogue groups", () => {
  const central = [{ id: "unit", category: "mvhr-unit-vertical" }, { id: "terminal" }, { id: "legacy" }];
  const decentral = [{ id: "wall-unit", decentralisedMvhr: {} }, { id: "controller", decentralisedController: {} }];
  const components = [...central, ...decentral];
  const before = structuredClone(components);
  assert.deepEqual(components.filter(c => ventilationWorkspaceIncludes("centralised", componentVentilationWorkspace(c))), central);
  assert.deepEqual(components.filter(c => ventilationWorkspaceIncludes("decentralised", componentVentilationWorkspace(c))), decentral);
  assert.deepEqual(components.filter(c => ventilationWorkspaceIncludes("combined", componentVentilationWorkspace(c))), components);
  assert.deepEqual(components, before);
});
