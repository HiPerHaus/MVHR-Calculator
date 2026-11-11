import test from "node:test";
import assert from "node:assert/strict";
import { applyCommand, createProject, identityQuaternion, knownMm, unknownMm, serializeProject } from "../src/domain/spatial.mjs";
import { externalStaticPressureFromInput } from "../src/domain/engineering-inputs.mjs";
import { createCatalogueComponent, routeFamilyForKind } from "../src/editor/component-catalogue.mjs";
import { createConfiguredMvhrComponent } from "../src/editor/mvhr-placement.mjs";
import { createEngineeringNetworkDraft } from "../src/editor/engineering-network-draft.mjs";
import { createPartsSchedule } from "../src/editor/parts-schedule.mjs";
import { ventilationOutputView } from "../src/editor/ventilation-output-scope.mjs";
import { createA3SheetModel } from "../src/sheets/a3-sheet.mjs";
import { createDesignOptionOutput } from "../src/sheets/design-option-output.mjs";
import { createPartsCsvRows } from "../src/sheets/parts-csv-export.mjs";

function fixture() {
  let p = createProject("system-export");
  for (const id of ["ground", "upper"]) p = applyCommand(p, { type: "floor.add", floor: { id, name: id, transform: { translationMm: { x: 0, y: 0, z: knownMm(0, "test") }, orientation: identityQuaternion() } } });
  for (const [record, id] of [["aerofresh-30-compact-decentralised", "head"], ["aerofresh-smove-controller-decentralised", "controller"]]) p = applyCommand(p, { type: "component.add", component: createCatalogueComponent(record, { id, floorId: "ground", xMm: id === "controller" ? 2000 : 1000, yMm: 1000 }) });
  p = applyCommand(p, { type: "decentralisedCable.add", cable: { id: "cable", floorId: "ground", controllerId: "controller", unitComponentId: "head", cableKind: "combined-power-control", topologyStatus: "verified-synchronised-pairs", maximumRouteLengthMm: null, specification: { status: "candidate-manual-mirror", label: "LiYY 3 × 0.75 mm²", source: "test fixture" }, points: [{ x: 2000, y: 1000 }, { x: 1000, y: 1000 }] } });
  p = applyCommand(p, { type: "component.add", component: createConfiguredMvhrComponent({ model: "q350-hrv", mounting: "vertical", handing: "left", layout: "unit-mounted-cw", cwSize: "320" }, { id: "unit", floorId: "upper", xMm: 2000, yMm: 2000 }) });
  p = applyCommand(p, { type: "component.add", component: createCatalogueComponent("luna-supply", { id: "luna", floorId: "upper", xMm: 3000, yMm: 3000 }) });
  const kind = "semi-rigid-radial", family = routeFamilyForKind(kind);
  p = applyCommand(p, { type: "route.add", route: { id: "duct", floorId: "upper", system: "mvhr", stream: "supply", role: "Dwelling supply", ductKind: kind, connectionInterface: family.connectionInterface, parallelRunCount: null, startAttachment: null, endAttachment: null, points: [{ x: 0, y: 0, z: unknownMm("test unknown") }, { x: 5000, y: 0, z: unknownMm("test unknown") }] } });
  p = applyCommand(p, { type: "engineering.setFloorDuty", duty: { floorId: "upper", mode: "normal", unitComponentId: "unit", externalStaticPressure: externalStaticPressureFromInput(100, "test", "test source", "clean filters") } });
  p = applyCommand(p, { type: "engineering.setNetworkDesign", design: createEngineeringNetworkDraft(p, "upper").design });
  return p;
}
const makeSheet = (p, option, { systemScope = "combined" } = {}) => createA3SheetModel(p, { floorId: "upper", systemScope, orientation: "landscape", projectName: "QA", drawingTitle: `${option.name} ${systemScope}`, drawingId: "V-QA", issueDate: "2026-11-11", revision: option.revision, revisionText: "Working", status: "Preliminary — not for construction" });
const componentIds = sheet => sheet.componentLines.flatMap(row => row.componentIds).sort();

test("each system has exactly its model components, cables, ducts and allowances; Combined is their union", () => {
  const p = fixture(), before = serializeProject(p);
  const all = Object.fromEntries(["centralised", "decentralised", "combined"].map(systemScope => [systemScope, p.floors.map(f => createPartsSchedule(p, { floorId: f.id, systemScope }))]));
  const ids = scope => all[scope].flatMap(componentIds).sort();
  assert.deepEqual(ids("centralised"), ["luna", "unit"]);
  assert.deepEqual(ids("decentralised"), ["controller", "head"]);
  assert.deepEqual(ids("combined"), [...ids("centralised"), ...ids("decentralised")].sort());
  assert.equal(all.centralised.flatMap(s => s.decentralisedCableLines).length, 0);
  assert.equal(all.decentralised.flatMap(s => s.routeLines).length, 0);
  assert.equal(all.decentralised[0].decentralisedCableLines[0].planLengthMm, 1000);
  for (const scope of ["centralised", "combined"]) {
    assert.equal(all[scope][0].projectAccessories.jobLines.length, 0);
    assert.equal(all[scope][1].projectAccessories.jobLines.find(row => row.code === "ZEN-C90-CSET").quantity, 3);
    assert.equal(all[scope][1].projectAccessories.unitLines.find(row => row.code === "HRV-DRAIN").quantity, 1);
  }
  assert.equal(all.decentralised.flatMap(s => [...s.projectAccessories.jobLines, ...s.projectAccessories.unitLines, ...s.projectAccessories.cwLines]).length, 0);
  assert.equal(all.centralised[1].routeLines[0].pendingParallelRunRouteCount, 1);
  assert.equal(serializeProject(p), before, "Engineering input references and model must remain intact");
});

test("CSV system scope matches floor schedules and counts project packs once without another system", () => {
  const p = fixture();
  const c = createPartsCsvRows(p, { systemScope: "centralised" }), d = createPartsCsvRows(p, { systemScope: "decentralised" });
  assert.equal(c.filter(row => row.partNumber === "ZEN-C90-CSET").length, 1);
  assert.equal(c.find(row => row.partNumber === "ZEN-C90-CSET").floorName, "upper");
  assert.ok(c.some(row => row.partNumber === "ZEN-Q350HRV"));
  assert.ok(c.some(row => row.quantity === "Pending"));
  assert.ok(!c.some(row => row.kind === "decentralised-cable" || /AeroFresh 30/.test(row.description)));
  assert.ok(d.some(row => row.kind === "decentralised-cable" && row.quantity === "1.00"));
  assert.ok(!d.some(row => row.partNumber?.startsWith("ZEN-") || row.kind === "route-measurement"));
  assert.match(d[0].scope, /Decentralised/);
});

test("system projection preserves shared geometry, source fingerprints and engineering data", () => {
  const p = fixture(), before = serializeProject(p), option = p.designOptions[0];
  const central = makeSheet(p, option, { systemScope: "centralised" });
  const dec = makeSheet(p, option, { systemScope: "decentralised" });
  assert.equal(central.sourceProjectFingerprint, dec.sourceProjectFingerprint);
  assert.deepEqual(central.printScene.components.map(c => c.id), ["unit", "luna"]);
  assert.deepEqual(dec.printScene.components, []);
  assert.equal(dec.printScene.routes.length, 0);
  assert.deepEqual(dec.printScene.floorArea, central.printScene.floorArea);
  assert.deepEqual(ventilationOutputView(p, "decentralised").engineeringInputs, p.engineeringInputs);
  assert.equal(serializeProject(p), before);
  assert.throws(() => ventilationOutputView(p, "typo"), /Unsupported/);
});

test("all options scope independently, details contain no other system, and keys do not share page choices", () => {
  let p = fixture();
  p = applyCommand(p, { type: "designOption.duplicate", id: "empty", name: "Empty", copyScopes: ["plan"], activate: false });
  const before = serializeProject(p);
  const byScope = Object.fromEntries(["centralised", "decentralised", "combined"].map(systemScope => [systemScope, createDesignOptionOutput(p, { optionId: null, systemScope, createSheet: makeSheet })]));
  for (const [scope, output] of Object.entries(byScope)) {
    assert.equal(output.entries.length, 2);
    assert.equal(output.entries[1].sheet.printScene.components.length, 0);
    assert.ok(output.pages.every(page => page.systemScope === scope));
    assert.equal(output.pages.filter(page => page.kind === "drawing").length, 2);
  }
  const decDetails = byScope.decentralised.pages.find(page => page.kind === "installation-details").svg;
  assert.match(decDetails, /DECENTRALISED INSTALLATION DETAILS/);
  assert.doesNotMatch(decDetails, /data-illustration|data-detail-id="q-cw320"|128 horizontal|Ducts within thermal envelope/);
  assert.match(byScope.centralised.pages[1].svg, /data-detail-id="q-cw320"/);
  assert.notEqual(byScope.centralised.pages[0].pageKey, byScope.decentralised.pages[0].pageKey);
  assert.equal(serializeProject(p), before);
});
