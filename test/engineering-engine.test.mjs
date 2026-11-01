import assert from "node:assert/strict";
import test from "node:test";

import {
  airflowTargetFromInput,
  applyCommand,
  createProject,
  deserializeProject,
  identityQuaternion,
  knownMm,
  serializeProject,
  unknownMm,
} from "../src/domain/spatial.mjs";
import { engineeringComponentFingerprint, engineeringRouteFingerprint, pressureInputFromPa, unresolvedPressureInput } from "../src/domain/engineering-inputs.mjs";
import { evaluateEngineeringNetwork } from "../src/editor/engineering-engine.mjs";
import { createEngineeringNetworkDraft } from "../src/editor/engineering-network-draft.mjs";
import { createEngineeringReport } from "../src/editor/engineering-report.mjs";
import { createEngineeringReportHtml } from "../src/editor/engineering-report-html.mjs";
import { deriveRoomBoundaries } from "../src/domain/rooms.mjs";
import { routeFamilyForKind } from "../src/editor/component-catalogue.mjs";

test("explicit terminal allocations propagate through typed routes without treating targets as achieved flow", () => {
  let project = engineeringFixture();
  project = setNetworkDesign(project, baseDesign());

  const result = evaluateEngineeringNetwork(project, "floor-ground", "normal");
  assert.equal(result.status, "blocked");
  assert.equal(result.streams.supply.designFlowLps, 10);
  assert.equal(result.streams.extract.designFlowLps, 10);
  assert.equal(result.routes.find(item => item.routeId === "route-supply").flowLps, 10);
  assert.equal(result.routes.find(item => item.routeId === "route-extract").flowLps, 10);
  assert.match(result.evidenceBoundary, /design-target evaluation only/i);
  assert.equal(result.spaceChecks.lines.every(line => line.state === "allocated"), true);
  assert.equal(result.diagnostics.some(item => item.code === "fan-curve-unresolved"), true);
});

test("m³/h inputs convert exactly to canonical L/s while retaining their declared unit", () => {
  let project = engineeringFixture();
  const design = baseDesign();
  design.terminalAllocations[0] = { ...design.terminalAllocations[0], inputValue: 36, inputUnit: "m3/h", valueLps: 10 };
  project = setNetworkDesign(project, design);
  const result = evaluateEngineeringNetwork(project, "floor-ground", "normal");
  const allocation = result.design.terminalAllocations.find(item => item.id === "allocation-supply");
  assert.equal(allocation.inputValue, 36);
  assert.equal(allocation.inputUnit, "m3/h");
  assert.equal(allocation.valueLps, 10);
  assert.equal(result.streams.supply.designFlowM3h, 36);
});

test("velocity uses internal area and twin runs divide physical flow without changing the allocation", () => {
  let project = engineeringFixture({ supplyRuns: 2 });
  const design = baseDesign();
  design.routeResistanceInputs = design.routeResistanceInputs.map(input => input.routeId === "route-supply" ? { ...input, parallelFlowAssumption: "equal-split-declared" } : input);
  project = setNetworkDesign(project, design);
  const result = evaluateEngineeringNetwork(project, "floor-ground", "normal");
  const route = result.routes.find(item => item.routeId === "route-supply");
  const expected = 0.005 / (Math.PI * 0.09 ** 2 / 4);
  assert.ok(Math.abs(route.velocityMps - expected) < 1e-12);
  assert.equal(route.flowLps, 10);
  assert.equal(route.flowPerRunLps, 5);
  assert.ok(Math.abs(route.pressureLossPa - 1.2973077407131606) < 1e-12);
  assert.equal(route.parallelFlowAssumption, "equal-split-declared");
});

test("Twin routes remain unresolved until equal flow is explicitly declared", () => {
  let project = engineeringFixture({ supplyRuns: 2 });
  project = setNetworkDesign(project, baseDesign());
  const result = evaluateEngineeringNetwork(project, "floor-ground", "normal");
  const route = result.routes.find(item => item.routeId === "route-supply");
  assert.equal(route.pressureLossPa, null);
  assert.equal(route.velocityMps, null);
  assert.equal(result.diagnostics.some(item => item.code === "parallel-flow-assumption-missing"), true);
});

test("rectangular velocity uses true internal area and hydraulic diameter only for friction", () => {
  let project = engineeringFixture();
  const design = baseDesign();
  design.routeResistanceInputs = design.routeResistanceInputs.map(input => input.routeId === "route-supply" ? {
    ...input,
    crossSection: { shape: "rectangular", internalWidthMm: 100, internalHeightMm: 50 },
  } : input);
  project = setNetworkDesign(project, design);
  const route = evaluateEngineeringNetwork(project, "floor-ground", "normal").routes.find(item => item.routeId === "route-supply");
  assert.equal(route.areaPerRunM2, 0.005);
  assert.equal(route.velocityMps, 2);
  assert.ok(Math.abs(route.hydraulicDiameterMm - 66.66666666666667) < 1e-12);
  assert.equal(route.crossSection.shape, "rectangular");
});

test("laminar flow uses 64/Re while transitional flow blocks an invented friction factor", () => {
  let laminarProject = engineeringFixture();
  const laminarDesign = baseDesign();
  laminarDesign.terminalAllocations[0] = { ...laminarDesign.terminalAllocations[0], inputValue: 1, valueLps: 1 };
  laminarProject = setNetworkDesign(laminarProject, laminarDesign);
  const laminar = evaluateEngineeringNetwork(laminarProject, "floor-ground", "normal").routes.find(item => item.routeId === "route-supply");
  assert.equal(laminar.frictionRegime, "laminar-circular");
  assert.ok(Math.abs(laminar.frictionFactor - 64 / laminar.reynoldsNumber) < 1e-12);

  let transitionalProject = engineeringFixture();
  const transitionalDesign = baseDesign();
  transitionalDesign.terminalAllocations[0] = { ...transitionalDesign.terminalAllocations[0], inputValue: 3, valueLps: 3 };
  transitionalProject = setNetworkDesign(transitionalProject, transitionalDesign);
  const transitionalResult = evaluateEngineeringNetwork(transitionalProject, "floor-ground", "normal");
  const transitional = transitionalResult.routes.find(item => item.routeId === "route-supply");
  assert.equal(transitional.frictionRegime, "transitional");
  assert.equal(transitional.frictionFactor, null);
  assert.equal(transitional.pressureLossPa, null);
  assert.equal(transitionalResult.diagnostics.some(item => item.code === "transitional-flow-unresolved"), true);
});

test("non-finite, reverse and zero engineering inputs fail before calculation", () => {
  const project = engineeringFixture();
  for (const badFlow of [0, -1, Number.NaN]) {
    const design = baseDesign();
    design.terminalAllocations[0] = { ...design.terminalAllocations[0], inputValue: badFlow, valueLps: badFlow };
    assert.throws(() => setNetworkDesign(project, design), /positive|finite/i);
  }
  for (const badDiameter of [0, -90, Number.NaN]) {
    const design = baseDesign();
    design.routeResistanceInputs[0] = { ...design.routeResistanceInputs[0], crossSection: { shape: "circular", internalDiameterMm: badDiameter } };
    assert.throws(() => setNetworkDesign(project, design), /diameter.*positive|diameter.*finite/i);
  }
});

test("extreme finite geometry and rectangular laminar flow fail closed without NaN or Infinity", () => {
  let tinyProject = engineeringFixture();
  const tinyDesign = baseDesign();
  tinyDesign.routeResistanceInputs[0].crossSection.internalDiameterMm = Number.MIN_VALUE;
  tinyProject = setNetworkDesign(tinyProject, tinyDesign);
  const tiny = evaluateEngineeringNetwork(tinyProject, "floor-ground", "normal");
  assert.equal(tiny.routes.find(item => item.routeId === "route-supply").pressureLossPa, null);
  assert.equal(tiny.diagnostics.some(item => item.code === "route-calculation-out-of-range"), true);
  assert.doesNotMatch(JSON.stringify(tiny), /NaN|Infinity/u);

  let rectangularProject = engineeringFixture();
  const rectangularDesign = baseDesign();
  rectangularDesign.terminalAllocations[0] = { ...rectangularDesign.terminalAllocations[0], inputValue: 0.1, valueLps: 0.1 };
  rectangularDesign.routeResistanceInputs[0].crossSection = { shape: "rectangular", internalWidthMm: 500, internalHeightMm: 500 };
  rectangularProject = setNetworkDesign(rectangularProject, rectangularDesign);
  const rectangular = evaluateEngineeringNetwork(rectangularProject, "floor-ground", "normal");
  assert.equal(rectangular.routes.find(item => item.routeId === "route-supply").pressureLossPa, null);
  assert.equal(rectangular.diagnostics.some(item => item.code === "rectangular-laminar-unresolved"), true);
});

test("Low and Boost require explicit positive coverage for every active ventilation space", () => {
  let project = engineeringFixture();
  const design = baseDesign();
  design.mode = "boost";
  design.terminalAllocations = design.terminalAllocations.filter(item => item.id === "allocation-supply");
  design.routeResistanceInputs = design.routeResistanceInputs.filter(item => item.routeId === "route-supply");
  project = setNetworkDesign(project, design);
  const result = evaluateEngineeringNetwork(project, "floor-ground", "boost");
  assert.equal(result.spaceChecks.lines.find(item => item.spaceId === "room-extract").state, "mode-allocation-missing");
  assert.equal(result.diagnostics.some(item => item.code === "mode-allocation-missing"), true);
});

test("supply and extract design totals expose an arithmetic imbalance without inventing a tolerance", () => {
  let project = engineeringFixture();
  const design = baseDesign();
  design.terminalAllocations[1] = { ...design.terminalAllocations[1], inputValue: 8, valueLps: 8 };
  project = setNetworkDesign(project, design);
  const result = evaluateEngineeringNetwork(project, "floor-ground", "normal");
  assert.equal(result.balance.state, "imbalance-review-required");
  assert.equal(result.balance.differenceLps, 2);
  assert.equal(result.diagnostics.some(item => item.code === "design-flow-imbalance" && item.severity === "warning"), true);
});

test("non-MVHR free routes do not contaminate the MVHR engineering graph", () => {
  let project = engineeringFixture();
  project = applyCommand(project, { type: "route.add", route: { id: "makeup-air-draft", floorId: "floor-ground", system: "rangehood-makeup-air", stream: "makeup", role: "Makeup air", ductKind: "generic-duct", connectionInterface: null, parallelRunCount: 1, startAttachment: null, endAttachment: null, points: [{ x: 0, y: 0, z: knownMm(2500, "test") }, { x: 1000, y: 0, z: knownMm(2500, "test") }] } });
  project = setNetworkDesign(project, baseDesign());
  const result = evaluateEngineeringNetwork(project, "floor-ground", "normal");
  assert.equal(result.routes.some(item => item.routeId === "makeup-air-draft"), false);
  assert.equal(result.diagnostics.some(item => item.target?.routeId === "makeup-air-draft"), false);
});

test("fan evidence is bound to the evaluated unit and declared external-static condition", () => {
  let project = engineeringFixture();
  const reference = { ...terminal("q350-reference-only", "intake", "Reference only", 3000, 3000), catalogueItemId: "q350-reference-only" };
  project = add(project, reference);
  const design = baseDesign();
  design.fanCurves = [knownCurve("supply", [[20, 150], [50, 90]]), unresolvedCurve("extract")];
  design.fanCurves[0].unitComponentId = "q350-reference-only";
  project = setNetworkDesign(project, design);
  const result = evaluateEngineeringNetwork(project, "floor-ground", "normal");
  assert.equal(result.streams.supply.fanDuty.state, "unit-mismatch");
  assert.equal(result.diagnostics.some(item => item.code === "fan-curve-unit-mismatch"), true);
});

test("geometry edits invalidate route evidence rather than silently reusing old fitting assumptions", () => {
  let project = engineeringFixture();
  project = setNetworkDesign(project, baseDesign());
  const before = evaluateEngineeringNetwork(project, "floor-ground", "normal");
  const priorLoss = before.routes.find(item => item.routeId === "route-supply").pressureLossPa;

  project = applyCommand(project, {
    type: "route.insertPoint",
    routeId: "route-supply",
    segmentIndex: 0,
    point: { x: 5000, y: 3000, z: knownMm(2500, "test") },
  });
  const after = evaluateEngineeringNetwork(project, "floor-ground", "normal");
  const edited = after.routes.find(item => item.routeId === "route-supply");
  assert.equal(after.design.terminalAllocations.find(item => item.id === "allocation-supply").valueLps, 10);
  assert.ok(edited.developedLengthMm > 8000);
  assert.equal(edited.pressureLossPa, null);
  assert.equal(edited.diagnostics.some(item => item.code === "route-evidence-stale"), true);
  assert.ok(priorLoss > 0);
});

test("malformed duplicate terminal allocations fail closed before evaluation", () => {
  const project = engineeringFixture();
  const design = baseDesign();
  design.terminalAllocations.push({ ...structuredClone(design.terminalAllocations[0]), id: "allocation-supply-duplicate" });
  assert.throws(() => setNetworkDesign(project, design), /repeat terminal endpoint allocation/i);
});

test("missing resistance and missing terminal evidence remain unresolved rather than becoming zero", () => {
  let project = engineeringFixture();
  const design = baseDesign();
  design.routeResistanceInputs = design.routeResistanceInputs.filter(item => item.routeId !== "route-supply");
  design.terminalAllocations[0].terminalPressureLoss = unresolvedPressureInput("manufacturer pressure curve not provided");
  project = setNetworkDesign(project, design);

  const result = evaluateEngineeringNetwork(project, "floor-ground", "normal");
  assert.equal(result.routes.find(item => item.routeId === "route-supply").pressureLossPa, null);
  assert.equal(result.paths.find(item => item.allocationId === "allocation-supply").pressureLossPa, null);
  assert.equal(result.streams.supply.requiredExternalStaticPressurePa, null);
  assert.equal(result.diagnostics.some(item => item.code === "route-resistance-missing"), true);
  assert.equal(result.diagnostics.some(item => item.code === "terminal-loss-unresolved"), true);
});

test("fan curves interpolate only inside their verified domain and never extrapolate", () => {
  let project = engineeringFixture();
  const design = baseDesign();
  design.fanCurves = [
    knownCurve("supply", [[20, 120], [50, 60]]),
    knownCurve("extract", [[20, 120], [30, 80]]),
  ];
  project = setNetworkDesign(project, design);
  const result = evaluateEngineeringNetwork(project, "floor-ground", "normal");
  assert.equal(result.streams.supply.fanDuty.availableExternalStaticPressurePa, 88);
  assert.equal(result.streams.extract.fanDuty.state, "outside-verified-domain");
  assert.equal(result.streams.extract.fanDuty.availableExternalStaticPressurePa, null);
});

test("engineering inputs survive save and remain isolated between design options", () => {
  let project = engineeringFixture();
  project = setNetworkDesign(project, baseDesign());
  project = applyCommand(project, {
    type: "designOption.duplicate",
    id: "option-alternative",
    name: "Alternative",
    revision: "Working",
    copyScopes: ["plan", "rooms", "markup"],
    activate: true,
  });
  const copied = project.engineeringInputs.networkDesigns[0];
  assert.equal(copied.terminalAllocations[0].componentId.startsWith("option-alternative-copy-"), true);
  project = applyCommand(project, { type: "engineering.clearNetworkDesign", floorId: "floor-ground", mode: "normal" });
  assert.equal(project.engineeringInputs.networkDesigns.length, 0);
  project = applyCommand(project, { type: "designOption.switch", optionId: `${project.id}-option-1` });
  assert.equal(project.engineeringInputs.networkDesigns.length, 1);
  const reopened = deserializeProject(serializeProject(project));
  assert.equal(reopened.engineeringInputs.networkDesigns[0].mode, "normal");
});

test("schema 23 engineering duties migrate without inventing network results in active or inactive options", () => {
  let project = engineeringFixture();
  project = applyCommand(project, {
    type: "designOption.duplicate",
    id: "option-migration-alternative",
    name: "Alternative",
    revision: "Working",
    copyScopes: ["plan", "rooms", "markup"],
    activate: true,
  });
  const legacy = structuredClone(project);
  legacy.schemaVersion = 23;
  legacy.engineeringInputs = { version: "mvhr-engineering-inputs.v1", floorDuties: [] };
  for (const option of legacy.designOptions) {
    if (option.snapshot) option.snapshot.engineeringInputs = { version: "mvhr-engineering-inputs.v1", floorDuties: [] };
  }

  const migrated = deserializeProject(JSON.stringify(legacy));
  assert.equal(migrated.schemaVersion, 25);
  assert.deepEqual(migrated.engineeringInputs, { version: "mvhr-engineering-inputs.v3", floorDuties: [], networkDesigns: [] });
  assert.equal(migrated.designOptions.filter(option => option.snapshot).every(option => option.snapshot.engineeringInputs.version === "mvhr-engineering-inputs.v3"), true);
  assert.equal(migrated.designOptions.filter(option => option.snapshot).every(option => option.snapshot.engineeringInputs.networkDesigns.length === 0), true);
});

test("schema 24 route inputs reopen into v3 without dereferencing the old diameter shape", () => {
  let project = engineeringFixture();
  project = setNetworkDesign(project, baseDesign());
  const legacy = structuredClone(project);
  legacy.schemaVersion = 24;
  legacy.engineeringInputs.version = "mvhr-engineering-inputs.v2";
  for (const component of legacy.components) delete component.engineeringPassages;
  for (const input of legacy.engineeringInputs.networkDesigns[0].routeResistanceInputs) {
    input.internalDiameterMm = input.crossSection.internalDiameterMm;
    delete input.crossSection;
    delete input.routeGeometryFingerprint;
  }
  for (const input of legacy.engineeringInputs.networkDesigns[0].componentResistanceInputs) delete input.componentConfigurationFingerprint;
  for (const curve of legacy.engineeringInputs.networkDesigns[0].fanCurves) {
    delete curve.unitConfigurationFingerprint; delete curve.pressureConvention; delete curve.filterCondition;
  }
  const reopened = deserializeProject(JSON.stringify(legacy));
  assert.equal(reopened.schemaVersion, 25);
  assert.equal(reopened.engineeringInputs.version, "mvhr-engineering-inputs.v3");
  assert.equal(reopened.engineeringInputs.networkDesigns[0].routeResistanceInputs[0].crossSection.shape, "circular");
  const result = evaluateEngineeringNetwork(reopened, "floor-ground", "normal");
  assert.equal(result.status, "blocked");
  assert.equal(result.diagnostics.some(item => item.code === "route-evidence-stale"), true);
});

test("draft creation copies one explicit terminal target and requires a user factor for non-Normal modes", () => {
  const project = engineeringFixture();
  const normal = createEngineeringNetworkDraft(project, "floor-ground", "normal");
  assert.deepEqual(normal.design.terminalAllocations.map(item => item.valueLps), [10, 10]);
  assert.equal(normal.design.terminalAllocations.every(item => item.terminalPressureLoss.state === "unresolved"), true);
  const boost = createEngineeringNetworkDraft(project, "floor-ground", "boost", { normalTargetFactor: 1.3 });
  assert.deepEqual(boost.design.terminalAllocations.map(item => item.valueLps), [13, 13]);
  assert.match(boost.evidenceBoundary, /does not infer.*product resistance.*achieved airflow/i);
  assert.throws(() => createEngineeringNetworkDraft(project, "floor-ground", "low"), /positive number/);
});

test("engineering report is option-scoped, preliminary and distinct from commissioning", () => {
  let project = engineeringFixture();
  project = setNetworkDesign(project, baseDesign());
  const report = createEngineeringReport(project, "floor-ground", "normal");
  assert.equal(report.project.designOptionId, project.activeDesignOptionId);
  assert.equal(report.issue.purpose, "preliminary-engineering-review");
  assert.equal(report.issue.constructionStatus, "not-for-construction");
  assert.equal(report.issue.commissioningStatus, "not-commissioned");
  assert.equal(report.routeResults.length, 2);
  assert.match(report.evidenceBoundary, /not predicted delivery/i);
  const html = createEngineeringReportHtml(project, "floor-ground", "normal");
  assert.match(html, /PRELIMINARY · REVIEW REQUIRED · NOT FOR CONSTRUCTION/);
  assert.match(html, /Terminal design allocations/);
  assert.match(html, /Assigned design-flow balance/);
  assert.match(html, /Arithmetic equality only; no compliance tolerance inferred/);
  assert.match(html, /Critical path and fan-duty screening/);
  assert.match(html, /not solve achieved airflow/i);
});

test("critical paths include each explicit outdoor system boundary once", () => {
  let project = engineeringFixture();
  project = add(project, terminal("outside-intake", "intake", "Outdoor intake", 0, 1000));
  project = add(project, terminal("outside-exhaust", "exhaust", "Outdoor exhaust", 0, 3000));
  project = addBoundaryRoute(project, "route-intake", "unit-intake", "outside-intake", "outside-intake-port", "intake", "Outdoor intake", 1000);
  project = addBoundaryRoute(project, "route-exhaust", "unit-exhaust", "outside-exhaust", "outside-exhaust-port", "exhaust", "Outdoor exhaust", 3000);
  const design = baseDesign();
  design.routeResistanceInputs.push(routeInput("route-intake"), routeInput("route-exhaust"));
  design.componentResistanceInputs.push(componentLoss("outside-intake", 3), componentLoss("outside-exhaust", 4));
  design.fanCurves = [knownCurve("supply", [[20, 150], [50, 90]]), knownCurve("extract", [[20, 150], [50, 90]])];
  project = setNetworkDesign(project, design);

  const result = evaluateEngineeringNetwork(project, "floor-ground", "normal");
  assert.deepEqual(result.paths.find(item => item.stream === "supply").routeIds, ["route-intake", "route-supply"]);
  assert.deepEqual(result.paths.find(item => item.stream === "extract").routeIds, ["route-exhaust", "route-extract"]);
  assert.equal(result.routes.find(item => item.routeId === "route-intake").flowLps, 10);
  assert.ok(result.streams.supply.requiredExternalStaticPressurePa > result.routes.find(item => item.routeId === "route-supply").pressureLossPa);
  assert.notEqual(result.streams.supply.fanDuty.marginPa, null);
});

test("terminal losses are not double-counted as inline component losses", () => {
  let project = engineeringFixture();
  project = add(project, terminal("outside-intake", "intake", "Outdoor intake", 0, 1000));
  project = add(project, terminal("outside-exhaust", "exhaust", "Outdoor exhaust", 0, 3000));
  project = addBoundaryRoute(project, "route-intake", "unit-intake", "outside-intake", "outside-intake-port", "intake", "Outdoor intake", 1000);
  project = addBoundaryRoute(project, "route-exhaust", "unit-exhaust", "outside-exhaust", "outside-exhaust-port", "exhaust", "Outdoor exhaust", 3000);
  const design = baseDesign();
  design.routeResistanceInputs.push(routeInput("route-intake"), routeInput("route-exhaust"));
  design.componentResistanceInputs.push(componentLoss("outside-intake", 3), componentLoss("outside-exhaust", 4), componentLoss("terminal-supply", 999));
  design.fanCurves = [knownCurve("supply", [[20, 150], [50, 90]]), knownCurve("extract", [[20, 150], [50, 90]])];
  project = setNetworkDesign(project, design);
  const path = evaluateEngineeringNetwork(project, "floor-ground", "normal").paths.find(item => item.allocationId === "allocation-supply");
  assert.equal(path.inlineComponentIds.includes("terminal-supply"), false);
  assert.ok(path.pressureLossPa < 999);
});

test("component configuration edits invalidate pinned component-loss evidence", () => {
  let project = engineeringFixture();
  project = add(project, terminal("outside-intake", "intake", "Outdoor intake", 0, 1000));
  project = add(project, terminal("outside-exhaust", "exhaust", "Outdoor exhaust", 0, 3000));
  project = addBoundaryRoute(project, "route-intake", "unit-intake", "outside-intake", "outside-intake-port", "intake", "Outdoor intake", 1000);
  project = addBoundaryRoute(project, "route-exhaust", "unit-exhaust", "outside-exhaust", "outside-exhaust-port", "exhaust", "Outdoor exhaust", 3000);
  const design = baseDesign();
  design.routeResistanceInputs.push(routeInput("route-intake"), routeInput("route-exhaust"));
  design.componentResistanceInputs.push(componentLoss("outside-intake", 3), componentLoss("outside-exhaust", 4));
  project = setNetworkDesign(project, design);
  const changed = structuredClone(project);
  changed.components.find(component => component.id === "outside-intake").ports[0].definitionId += "-changed-configuration";
  project = deserializeProject(JSON.stringify(changed));
  const result = evaluateEngineeringNetwork(project, "floor-ground", "normal");
  assert.equal(result.diagnostics.some(item => item.code === "component-evidence-stale" && item.target.componentId === "outside-intake"), true);
});

test("a verified fan curve below the calculated duty is a blocking result, not a pass", () => {
  let project = engineeringFixture();
  project = add(project, terminal("outside-intake", "intake", "Outdoor intake", 0, 1000));
  project = add(project, terminal("outside-exhaust", "exhaust", "Outdoor exhaust", 0, 3000));
  project = addBoundaryRoute(project, "route-intake", "unit-intake", "outside-intake", "outside-intake-port", "intake", "Outdoor intake", 1000);
  project = addBoundaryRoute(project, "route-exhaust", "unit-exhaust", "outside-exhaust", "outside-exhaust-port", "exhaust", "Outdoor exhaust", 3000);
  const design = baseDesign();
  design.routeResistanceInputs.push(routeInput("route-intake"), routeInput("route-exhaust"));
  design.componentResistanceInputs.push(componentLoss("outside-intake", 3), componentLoss("outside-exhaust", 4));
  design.fanCurves = [knownCurve("supply", [[20, 0], [50, 0]]), knownCurve("extract", [[20, 0], [50, 0]])];
  project = setNetworkDesign(project, design);

  const result = evaluateEngineeringNetwork(project, "floor-ground", "normal");
  assert.equal(result.status, "blocked");
  assert.equal(result.streams.supply.fanDuty.state, "insufficient-at-design-duty");
  assert.ok(result.streams.supply.fanDuty.marginPa < 0);
  assert.equal(result.diagnostics.some(item => item.code === "fan-duty-insufficient"), true);
});

test("branches accumulate explicit terminal flows while shared sections are counted once per path", () => {
  let project = engineeringFixture();
  project = applyCommand(project, { type: "route.delete", routeId: "route-supply" });
  project = add(project, manifold());
  project = add(project, terminal("terminal-supply-2", "supply", "Dwelling supply", 9000, 2000));
  project = applyCommand(project, { type: "terminal.assignRoom", roomId: "room-supply", componentId: "terminal-supply-2", portId: "terminal-supply-2-port" });
  project = connectRoute(project, "route-supply-main", "unit", "unit-supply", "manifold", "manifold-main", "supply", "Dwelling supply", [[1000,1000],[4000,1000]]);
  project = connectRoute(project, "route-supply-a", "manifold", "manifold-a", "terminal-supply", "terminal-supply-port", "supply", "Dwelling supply", [[4000,1100],[9000,1000]]);
  project = connectRoute(project, "route-supply-b", "manifold", "manifold-b", "terminal-supply-2", "terminal-supply-2-port", "supply", "Dwelling supply", [[4000,1200],[9000,2000]]);
  const design = baseDesign();
  design.terminalAllocations[0] = { ...design.terminalAllocations[0], inputValue: 4, valueLps: 4 };
  design.terminalAllocations.push({ ...allocation("allocation-supply-2", "terminal-supply-2", "terminal-supply-2-port", "room-supply"), inputValue: 6, valueLps: 6 });
  design.routeResistanceInputs = ["route-supply-main", "route-supply-a", "route-supply-b", "route-extract"].map(routeInput);
  design.componentResistanceInputs = [componentLoss("manifold", 2, "manifold-passage-1"), componentLoss("manifold", 3, "manifold-passage-2")];
  project = setNetworkDesign(project, design);

  const result = evaluateEngineeringNetwork(project, "floor-ground", "normal");
  assert.equal(result.routes.find(item => item.routeId === "route-supply-main").flowLps, 10);
  assert.equal(result.routes.find(item => item.routeId === "route-supply-a").flowLps, 4);
  assert.equal(result.routes.find(item => item.routeId === "route-supply-b").flowLps, 6);
  assert.equal(result.paths.filter(item => item.stream === "supply").every(item => item.inlineComponentIds.includes("manifold")), true);
  assert.equal(result.paths.filter(item => item.stream === "supply").every(item => new Set(item.routeIds).size === item.routeIds.length), true);
});

test("multiple unit roots fail closed while a different floor remains independently not configured", () => {
  let project = engineeringFixture();
  project = add(project, secondUnit());
  project = setNetworkDesign(project, baseDesign());
  const ground = evaluateEngineeringNetwork(project, "floor-ground", "normal");
  assert.equal(ground.status, "blocked");
  assert.equal(ground.diagnostics.some(item => item.code === "root-count-invalid" && /multi-unit/i.test(item.message)), true);

  project = applyCommand(project, { type: "floor.add", floor: { id: "floor-upper", name: "Upper Floor", transform: { translationMm: { x: 0, y: 0, z: knownMm(3000, "test") }, orientation: identityQuaternion() } } });
  const upper = evaluateEngineeringNetwork(project, "floor-upper", "normal");
  assert.equal(upper.status, "not-configured");
  assert.equal(upper.routes.length, 0);
});

test("a side-loop is warned without blocking an independently unique terminal path", () => {
  let project = engineeringFixture();
  project = applyCommand(project, { type: "route.delete", routeId: "route-supply" });
  project = add(project, manifold());
  project = add(project, loopComponent());
  project = connectRoute(project, "route-supply-main", "unit", "unit-supply", "manifold", "manifold-main", "supply", "Dwelling supply", [[1000,1000],[4000,1000]]);
  project = connectRoute(project, "route-supply-terminal", "manifold", "manifold-a", "terminal-supply", "terminal-supply-port", "supply", "Dwelling supply", [[4000,1100],[9000,1000]]);
  project = connectRoute(project, "route-loop-a", "manifold", "manifold-c", "loop-component", "loop-a", "supply", "Dwelling supply", [[4000,1300],[5000,1300]]);
  project = connectRoute(project, "route-loop-b", "loop-component", "loop-b", "manifold", "manifold-d", "supply", "Dwelling supply", [[5000,1400],[4000,1400]]);
  const design = baseDesign();
  design.routeResistanceInputs = ["route-supply-main", "route-supply-terminal", "route-loop-a", "route-loop-b", "route-extract"].map(routeInput);
  project = setNetworkDesign(project, design);

  const result = evaluateEngineeringNetwork(project, "floor-ground", "normal");
  assert.equal(result.diagnostics.some(item => item.code === "unsupported-cycle-present"), true);
  assert.equal(result.allocations.find(item => item.id === "allocation-supply").graphStatus, "connected-unique-path");
});

function engineeringFixture({ supplyRuns = 1 } = {}) {
  let project = applyCommand(createProject("engineering-engine-fixture"), { type: "floor.add", floor: floor() });
  project = applyCommand(project, wallChainLeft());
  project = applyCommand(project, wallChainRight());
  const boundaries = deriveRoomBoundaries(project, "floor-ground").candidates;
  const supplyBoundary = boundaries.find(candidate => candidate.centroidMm.x < 5000).key;
  const extractBoundary = boundaries.find(candidate => candidate.centroidMm.x > 5000).key;
  project = applyCommand(project, { type: "room.createFromBoundary", roomId: "room-supply", floorId: "floor-ground", boundaryKey: supplyBoundary, name: "Bedroom", use: "bedroom", ventilationRole: "supply" });
  project = applyCommand(project, { type: "room.updateMetadata", roomId: "room-supply", name: "Bedroom", use: "bedroom", ventilationRole: "supply", airflowTargets: targets(10) });

  project = applyCommand(project, { type: "room.createFromBoundary", roomId: "room-extract", floorId: "floor-ground", boundaryKey: extractBoundary, name: "Bathroom", use: "bathroom", ventilationRole: "extract" });
  project = applyCommand(project, { type: "room.updateMetadata", roomId: "room-extract", name: "Bathroom", use: "bathroom", ventilationRole: "extract", airflowTargets: targets(10) });
  project = add(project, unit());
  project = add(project, terminal("terminal-supply", "supply", "Dwelling supply", 9000, 1000));
  project = add(project, terminal("terminal-extract", "extract", "Dwelling extract", 9000, 3000));
  project = applyCommand(project, { type: "terminal.assignRoom", roomId: "room-supply", componentId: "terminal-supply", portId: "terminal-supply-port" });
  project = applyCommand(project, { type: "terminal.assignRoom", roomId: "room-extract", componentId: "terminal-extract", portId: "terminal-extract-port" });
  project = addRoute(project, "route-supply", "unit-supply", "terminal-supply", "terminal-supply-port", "supply", "Dwelling supply", 1000, supplyRuns);
  project = addRoute(project, "route-extract", "unit-extract", "terminal-extract", "terminal-extract-port", "extract", "Dwelling extract", 3000, 1);
  return project;
}

function baseDesign() {
  return {
    floorId: "floor-ground",
    mode: "normal",
    basis: "Hand-checkable engineering fixture",
    source: "Synthetic deterministic test input",
    sourceVersion: "1",
    occupancy: { state: "known", persons: 2, basis: "Synthetic fixture", source: "Test input", reason: null },
    fluid: { densityKgM3: 1.2, dynamicViscosityPaS: 0.000018, basis: "Declared test condition", source: "Synthetic test input" },
    terminalAllocations: [
      allocation("allocation-supply", "terminal-supply", "terminal-supply-port", "room-supply"),
      allocation("allocation-extract", "terminal-extract", "terminal-extract-port", "room-extract"),
    ],
    routeResistanceInputs: [routeInput("route-supply"), routeInput("route-extract")],
    componentResistanceInputs: [],
    fanCurves: [unresolvedCurve("supply"), unresolvedCurve("extract")],
  };
}

function allocation(id, componentId, portId, spaceId) {
  return { id, componentId, portId, spaceKind: "room", spaceId, inputValue: 10, inputUnit: "l/s", valueLps: 10, basis: "Explicit test allocation", source: "Synthetic room schedule", terminalPressureLoss: pressureInputFromPa(5, "Declared test fitting loss", "Synthetic fixture") };
}
function routeInput(routeId) { return { routeId, crossSection: { shape: "circular", internalDiameterMm: 90 }, parallelFlowAssumption: "not-applicable", roughnessMm: 0.1, fittingKTotal: 0, additionalPressureLoss: pressureInputFromPa(0, "No additional synthetic losses", "Synthetic fixture"), basis: "Synthetic smooth circular duct", source: "Hand-checkable fixture" }; }
function componentLoss(componentId, valuePa, passageId = null) { return { componentId, passageId, pressureLoss: pressureInputFromPa(valuePa, "Synthetic terminal loss", "Hand-checkable fixture"), basis: "Synthetic test component", source: "Hand-checkable fixture" }; }
function unresolvedCurve(stream) { return { state: "unresolved", stream, unitComponentId: null, points: [], basis: null, source: null, sourceVersion: null, reason: "verified manufacturer curve not provided" }; }
function knownCurve(stream, points) { return { state: "known", stream, unitComponentId: "unit", unitConfigurationFingerprint: null, pressureConvention: "external-static", filterCondition: "Synthetic clean-filter condition", points: points.map(([airflowM3h, externalStaticPressurePa]) => ({ airflowM3h, externalStaticPressurePa })), basis: "Synthetic interpolation fixture", source: "Test-only fan curve", sourceVersion: "1", reason: null }; }
function setNetworkDesign(project, design) {
  const hydrated = structuredClone(design);
  hydrated.routeResistanceInputs = hydrated.routeResistanceInputs.map(input => ({ ...input, routeGeometryFingerprint: engineeringRouteFingerprint(project.routes.find(route => route.id === input.routeId)) }));
  hydrated.componentResistanceInputs = hydrated.componentResistanceInputs.map(input => ({ ...input, componentConfigurationFingerprint: engineeringComponentFingerprint(project.components.find(component => component.id === input.componentId)) }));
  hydrated.fanCurves = hydrated.fanCurves.map(curve => curve.state === "known" ? ({ ...curve, unitConfigurationFingerprint: engineeringComponentFingerprint(project.components.find(component => component.id === curve.unitComponentId)) }) : curve);
  return applyCommand(project, { type: "engineering.setNetworkDesign", design: hydrated });
}
function targets(value) { return { normal: { required: airflowTargetFromInput(value, "l/s", "Synthetic target", "Test fixture"), assigned: airflowTargetFromInput(value, "l/s", "Synthetic assignment", "Test fixture") } }; }
function floor() { return { id: "floor-ground", name: "Ground Floor", transform: { translationMm: { x: 0, y: 0, z: knownMm(0, "test datum") }, orientation: identityQuaternion() } }; }
function chain(nodeIds, wallIds, points) { return { type: "wall.addChain", floorId: "floor-ground", nodeIds, wallIds, points: points.map(([x,y]) => ({ x, y, z: unknownMm("test") })), splits: [], thicknessMm: 140, heightMm: unknownMm("test"), referenceLine: "centreline", classification: "physical" }; }
function wallChainLeft() { return chain(["node-1", "node-2", "node-3", "node-4", "node-1"], ["wall-1", "wall-2", "wall-3", "wall-4"], [[0,0],[5000,0],[5000,5000],[0,5000],[0,0]]); }
function wallChainRight() { return chain(["node-2", "node-5", "node-6", "node-3"], ["wall-5", "wall-6", "wall-7"], [[5000,0],[10000,0],[10000,5000],[5000,5000]]); }
function add(project, component) { return applyCommand(project, { type: "component.add", component }); }
function interface90() { return structuredClone(routeFamilyForKind("semi-rigid-radial").connectionInterface); }
function port(id, x, y, stream, role) { return { id, definitionId: `${id}-definition`, positionMm: { x, y, z: 0 }, direction: { x: 1, y: 0, z: 0 }, system: "mvhr", stream, role, connectionInterface: interface90() }; }
function unit() { return { id: "unit", floorId: "floor-ground", positionMm: { x: 1000, y: 2000, z: knownMm(2500, "test") }, orientation: identityQuaternion(), ports: [port("unit-supply", 0, -1000, "supply", "Dwelling supply"), port("unit-extract", 0, 1000, "extract", "Dwelling extract"), port("unit-intake", -200, -1000, "intake", "Outdoor intake"), port("unit-exhaust", -200, 1000, "exhaust", "Outdoor exhaust")] }; }
function secondUnit() { return { id: "unit-second", floorId: "floor-ground", positionMm: { x: 2000, y: 2000, z: knownMm(2500, "test") }, orientation: identityQuaternion(), ports: [port("unit-second-supply", 0, -1000, "supply", "Dwelling supply"), port("unit-second-extract", 0, 1000, "extract", "Dwelling extract"), port("unit-second-intake", -200, -1000, "intake", "Outdoor intake"), port("unit-second-exhaust", -200, 1000, "exhaust", "Outdoor exhaust")] }; }
function terminal(id, stream, role, x, y) { return { id, floorId: "floor-ground", positionMm: { x, y, z: knownMm(2500, "test") }, orientation: identityQuaternion(), ports: [port(`${id}-port`, 0, 0, stream, role)] }; }
function manifold() { return { id: "manifold", floorId: "floor-ground", positionMm: { x: 4000, y: 1000, z: knownMm(2500, "test") }, orientation: identityQuaternion(), ports: [port("manifold-main", 0, 0, "supply", "Dwelling supply"), port("manifold-a", 0, 100, "supply", "Dwelling supply"), port("manifold-b", 0, 200, "supply", "Dwelling supply"), port("manifold-c", 0, 300, "supply", "Dwelling supply"), port("manifold-d", 0, 400, "supply", "Dwelling supply")], engineeringPassages: ["manifold-a", "manifold-b", "manifold-c", "manifold-d"].map((toPortId, index) => ({ id: `manifold-passage-${index + 1}`, fromPortId: "manifold-main", toPortId, basis: "Explicit synthetic manifold topology" })) }; }
function loopComponent() { return { id: "loop-component", floorId: "floor-ground", positionMm: { x: 5000, y: 1350, z: knownMm(2500, "test") }, orientation: identityQuaternion(), ports: [port("loop-a", 0, 0, "supply", "Dwelling supply"), port("loop-b", 0, 100, "supply", "Dwelling supply")], engineeringPassages: [{ id: "loop-passage", fromPortId: "loop-a", toPortId: "loop-b", basis: "Explicit synthetic loop topology" }] }; }
function addRoute(project, id, unitPortId, terminalId, terminalPortId, stream, role, y, parallelRunCount) { return applyCommand(project, { type: "route.add", route: { id, floorId: "floor-ground", system: "mvhr", stream, role, ductKind: "semi-rigid-radial", connectionInterface: interface90(), parallelRunCount, startAttachment: { componentId: "unit", portId: unitPortId }, endAttachment: { componentId: terminalId, portId: terminalPortId }, points: [{ x: 1000, y, z: knownMm(2500, "test") }, { x: 9000, y, z: knownMm(2500, "test") }] } }); }
function addBoundaryRoute(project, id, unitPortId, terminalId, terminalPortId, stream, role, y) { return applyCommand(project, { type: "route.add", route: { id, floorId: "floor-ground", system: "mvhr", stream, role, ductKind: "semi-rigid-radial", connectionInterface: interface90(), parallelRunCount: 1, startAttachment: { componentId: "unit", portId: unitPortId }, endAttachment: { componentId: terminalId, portId: terminalPortId }, points: [{ x: 800, y, z: knownMm(2500, "test") }, { x: 0, y, z: knownMm(2500, "test") }] } }); }
function connectRoute(project, id, startComponentId, startPortId, endComponentId, endPortId, stream, role, points) { return applyCommand(project, { type: "route.add", route: { id, floorId: "floor-ground", system: "mvhr", stream, role, ductKind: "semi-rigid-radial", connectionInterface: interface90(), parallelRunCount: 1, startAttachment: { componentId: startComponentId, portId: startPortId }, endAttachment: { componentId: endComponentId, portId: endPortId }, points: points.map(([x,y]) => ({ x, y, z: knownMm(2500, "test") })) } }); }
