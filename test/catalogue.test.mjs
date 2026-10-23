import assert from "node:assert/strict";
import test from "node:test";

import {
  CATALOGUE_CANDIDATES,
  CATALOGUE_ID,
  CATALOGUE_VERSION,
  COMFOTUBE_FLOW_90_EVIDENCE,
  COMFOWELL_320_PRESSURE_EVIDENCE,
  COMPONENT_CATALOGUE,
  DUCT_ROUTE_FAMILIES,
  TYPICAL_SYSTEM_GUIDANCE,
  createCatalogueComponent,
  deriveVentilationConnectionDemand,
  routeFamilyForKind,
  validateAttenuatorMountingChoice,
} from "../src/editor/component-catalogue.mjs";
import {
  DISTRIBUTION_BOX_PROFILES,
  inspectDistributionBoxDesign,
} from "../src/editor/distribution-box-design.mjs";
import {
  activateMechanicalTool,
  createMechanicalInteractionState,
  handleMechanicalCanvasClick,
} from "../src/editor/mechanical-controller.mjs";
import {
  applyCommand,
  createProject,
  deserializeProject,
  floorPortTransform,
  identityQuaternion,
  knownMm,
  serializeProject,
} from "../src/domain/spatial.mjs";

test("source-backed Q350 and Q450 records pin setout dimensions without inventing typed ports", () => {
  const q350 = COMPONENT_CATALOGUE.find((item) => item.productId === "ZEN-Q350HRV");
  const q450 = COMPONENT_CATALOGUE.find((item) => item.productId === "ZEN-Q450HRV");
  for (const item of [q350, q450]) {
    assert.equal(item.status, "verified-dimensional-setout-routable-ports-pending");
    assert.deepEqual(item.dimensions.body, { width: 725, depth: 570, height: 745 });
    assert.equal(item.dimensions.overallHeightWithTopConnections, 849.7);
    assert.equal(item.connectionSetout.nominalInternalDiameterMm, 160);
    assert.equal(item.connectionSetout.externalDiameterMm, 190);
    assert.equal(item.connectionSetout.frontToRearRowCentreSpacingMm, 280.5);
    assert.equal(item.connectionSetout.rearRowCentreOffsetFromBackMm, 123);
    assert.equal(item.connectionSetout.coordinateOriginStatus, "unverified");
    assert.equal(item.connectionSetout.localPortCoordinatesStatus, "unverified");
    assert.equal(item.connectionSetout.roleMapStatus, "unresolved-by-handedness");
    assert.equal(item.ports.length, 0);
  }
  assert.equal(COMPONENT_CATALOGUE.some((item) => item.productId?.includes("Q600")), false);
});

test("Q350 handed drawing profiles expose exact source-backed port centres and roles without claiming installation fit", () => {
  const left = COMPONENT_CATALOGUE.find((item) => item.id === "zehnder-q350-hrv-left-drawing-profile");
  const right = COMPONENT_CATALOGUE.find((item) => item.id === "zehnder-q350-erv-right-drawing-profile");

  assert.equal(left.manufacturerArticleCandidate, "471502110");
  assert.equal(right.manufacturerArticleCandidate, "471502111");
  assert.equal(left.localSkuCrosswalkStatus, "unverified");
  assert.equal(left.connectionSetout.coordinateOrigin, "centre-of-725-by-570-plan-body-envelope");
  assert.equal(left.connectionSetout.connectionScope, "drawing-only");
  assert.equal(left.connectionSetout.horizontalPortCentreSpacingMm, 580);
  assert.equal(left.ports.length, 4);
  assert.deepEqual(
    left.ports.map(({ key, positionMm, role }) => [key, positionMm, role]),
    [
      ["left-rear", { x: -290, y: -162, z: 0 }, "Dwelling extract"],
      ["left-front", { x: -290, y: 118.5, z: 0 }, "Dwelling supply"],
      ["right-rear", { x: 290, y: -162, z: 0 }, "Outdoor exhaust"],
      ["right-front", { x: 290, y: 118.5, z: 0 }, "Outdoor intake"],
    ],
  );
  assert.deepEqual(
    right.ports.map(({ key, role }) => [key, role]),
    [
      ["left-rear", "Outdoor intake"],
      ["left-front", "Outdoor exhaust"],
      ["right-rear", "Dwelling supply"],
      ["right-front", "Dwelling extract"],
    ],
  );
  assert.ok(left.ports.every((port) => (
    port.interface.boreMm === 160 &&
    port.interface.outsideDiameterMm === 190 &&
    port.interface.matingProfile === null &&
    port.interface.installationCompatibilityStatus === "unverified"
  )));
});

test("CW320 candidates retain verified named setout dimensions without becoming placeable parts", () => {
  const mountingSet = CATALOGUE_CANDIDATES.find((item) => item.productId === "ZEN-MSCW-320");
  const attenuator = CATALOGUE_CANDIDATES.find((item) => item.productId === "ZEN-ACWS-320");
  const radialPlate = CATALOGUE_CANDIDATES.find((item) => item.productId === "ZEN-MPCWM-320-6X90");
  const roundPlate = CATALOGUE_CANDIDATES.find((item) => item.productId === "ZEN-MP320-160");

  assert.equal(mountingSet.dimensions.setout.portCentreSpacingAlongAssemblyMm, 281);
  assert.equal(mountingSet.dimensions.setout.nominalConnectionDiameterMm, 160);
  assert.equal(attenuator.dimensions.setout.lengthMm, 500);
  assert.equal(attenuator.dimensions.setout.interfaceType, "rectangular-comfowell-module");
  assert.equal(radialPlate.dimensions.setout.branchCount, 6);
  assert.equal(radialPlate.manufacturerArticleCandidate, "990323613");
  assert.deepEqual(radialPlate.dimensions.setout.branchLayout, {
    rows: 2,
    columns: 3,
    horizontalPitchMm: 102.5,
    verticalPitchMm: 102.5,
  });
  assert.equal(radialPlate.dimensions.setout.edgeToFirstBranchCentreMm, null);
  assert.equal(roundPlate.dimensions.setout.nominalConnectionDiameterMm, 160);
  assert.equal(roundPlate.manufacturerArticleCandidate, "990323512");
  assert.equal(roundPlate.dimensions.setout.exactPortCentre, null);

  for (const item of [mountingSet, attenuator, radialPlate, roundPlate]) {
    assert.equal(item.placeable, false);
    assert.equal(item.status, "source-backed-dimensional-candidate-interface-pending");
    assert.equal(item.localSkuCrosswalkStatus, "unverified");
    assert.equal(item.ports.length, 0);
    assert.throws(() => createCatalogueComponent(item.id, {
      id: `blocked-${item.id}`,
      floorId: "floor-ground",
      xMm: 0,
      yMm: 0,
    }), /requires geometry and port evidence/);
  }
});

test("current UK ComfoWell profiles retain exact envelopes and interface types without inventing installed footprints", () => {
  assert.equal(DISTRIBUTION_BOX_PROFILES.length, 2);
  const cw320 = DISTRIBUTION_BOX_PROFILES.find((profile) => profile.family === "ComfoWell 320");
  const cw420 = DISTRIBUTION_BOX_PROFILES.find((profile) => profile.family === "ComfoWell 420");

  assert.equal(cw320.source.revision, "2026 V1");
  assert.equal(cw420.source.documentCode, "Comfowell420_Technical_Specification_2026_V1");
  assert.equal(cw420.source.revision, "2026 V1");
  assert.deepEqual(cw320.components.manifold.manufacturerEnvelopeMm, { height: 233, width: 336, depth: 253.8 });
  assert.deepEqual(cw420.components.manifold.manufacturerEnvelopeMm, { height: 233, width: 436, depth: 259 });
  assert.deepEqual(cw320.components.mountingPlate90.branchConnections.layout, { rows: 2, columns: 3 });
  assert.deepEqual(cw420.components.mountingPlate90.branchConnections.layout, { rows: 2, columns: 4 });
  assert.equal(cw320.components.mountingPlate90.branchConnections.drawingOutsideDiameterMm, 90.9);
  assert.equal(cw320.components.mountingPlate90.branchConnections.localCentresMm, null);
  assert.deepEqual(cw420.components.endPlate160.mainConnection.localCentreMm, { x: 0, y: 0 });
  assert.equal(cw420.components.endPlate160.mainConnection.installedDirection, null);
  assert.equal(cw320.connectionInterfaces.moduleJoint, "comfowell-clamping-strip");
  assert.equal(cw320.connectionInterfaces.branchSocket, "rapidlock-push-fit");
  assert.equal(cw320.installedPlanFootprint.state, "unresolved");
  assert.equal(cw320.placeable, false);
  assert.equal(cw320.routeReady, false);
});

test("current UK distribution candidates stay separate, visible and blocked from placement and routing", () => {
  const ukCandidates = CATALOGUE_CANDIDATES.filter((item) => item.category === "source-backed-distribution-candidate");
  assert.equal(ukCandidates.length, 8);
  assert.deepEqual(
    ukCandidates.map((item) => item.manufacturerArticle),
    ["990323501", "990323531", "990323613", "990323512", "990323504", "990323620", "990323622", "990323627"],
  );
  const currentCw320Plate = ukCandidates.find((item) => item.manufacturerArticle === "990323613");
  const legacyLocalPlate = CATALOGUE_CANDIDATES.find((item) => item.productId === "ZEN-MPCWM-320-6X90");
  assert.notEqual(currentCw320Plate.id, legacyLocalPlate.id);
  assert.equal(currentCw320Plate.localSkuCrosswalkStatus, "not-assigned-current-uk-evidence-only");
  assert.equal(currentCw320Plate.australianAvailabilityStatus, "unverified-distinct-market-generation");
  assert.equal(currentCw320Plate.dimensions.body, null);
  assert.equal(currentCw320Plate.dimensions.installedPlanFootprint, null);
  assert.equal(currentCw320Plate.distributionDesign.routeReady, false);
  assert.equal(currentCw320Plate.ports.length, 0);
  assert.throws(() => createCatalogueComponent(currentCw320Plate.id, {
    id: "blocked-current-uk-plate",
    floorId: "floor-ground",
    xMm: 0,
    yMm: 0,
  }), /requires geometry and port evidence/);

  const inspection = inspectDistributionBoxDesign("zehnder-uk-comfowell-320-rapidlock-2026-v1");
  assert.equal(inspection.placeable, false);
  assert.equal(inspection.routeReady, false);
  assert.deepEqual(
    inspection.connectionSequence.map((connection) => connection.interface),
    ["round-duct-gasket-seal", "comfowell-clamping-strip", "comfowell-clamping-strip", "rapidlock-push-fit"],
  );
  assert.ok(inspection.connectionSequence.every((connection) => connection.routeReady === false));
  assert.ok(inspection.blockers.some((blocker) => /socket/i.test(blocker)));
});

test("current ComfoTube Flow 90 evidence retains exact identity data but no digitized pressure curve", () => {
  const candidate = CATALOGUE_CANDIDATES.find((item) => item.id === "comfotube-dn90-50m");
  assert.equal(COMFOTUBE_FLOW_90_EVIDENCE.manufacturerArticle, "990328101");
  assert.equal(COMFOTUBE_FLOW_90_EVIDENCE.source.documentCode, "Z-DE-V0825-CSY-TES-TS010-ComfoTube");
  assert.equal(COMFOTUBE_FLOW_90_EVIDENCE.source.revision, "V0825");
  assert.deepEqual(
    [COMFOTUBE_FLOW_90_EVIDENCE.outsideDiameterMm, COMFOTUBE_FLOW_90_EVIDENCE.insideDiameterMm],
    [90, 77],
  );
  assert.deepEqual(COMFOTUBE_FLOW_90_EVIDENCE.recommendedNormalVentilationMaximum, {
    airflowM3h: 45,
    airVelocityMs: 2.7,
    sourcePage: 2,
    meaning: "manufacturer-marked recommended maximum at normal ventilation",
  });
  assert.equal(COMFOTUBE_FLOW_90_EVIDENCE.pressureLossEvidence.sourcePage, 3);
  assert.equal(COMFOTUBE_FLOW_90_EVIDENCE.pressureLossEvidence.numericalPoints, null);
  assert.equal(COMFOTUBE_FLOW_90_EVIDENCE.pressureLossEvidence.calculable, false);
  assert.equal(COMFOTUBE_FLOW_90_EVIDENCE.pressureLossEvidence.interpolationPolicy, "blocked");
  assert.equal(candidate.manufacturerArticleCandidate, "990328101");
  assert.equal(candidate.localSkuCrosswalkStatus, "unverified");
  assert.equal(candidate.placeable, false);
  assert.throws(() => createCatalogueComponent(candidate.id, {
    id: "blocked-current-comfotube-flow",
    floorId: "floor-ground",
    xMm: 0,
    yMm: 0,
  }), /requires geometry and port evidence/);
});

test("ComfoWell 320 pressure graph stays blocked for the named DN160 six-by-90 chain", () => {
  assert.equal(COMFOWELL_320_PRESSURE_EVIDENCE.source.documentCode, "CDE-FLYERTS222");
  assert.equal(COMFOWELL_320_PRESSURE_EVIDENCE.source.revision, "V1116");
  assert.equal(COMFOWELL_320_PRESSURE_EVIDENCE.source.pressureGraphPage, 12);
  assert.equal(COMFOWELL_320_PRESSURE_EVIDENCE.familyMaximumNormalVentilationAirflowM3h, 240);
  assert.match(COMFOWELL_320_PRESSURE_EVIDENCE.graphConfigurationLabel, /DN150/);
  assert.equal(COMFOWELL_320_PRESSURE_EVIDENCE.numericalPoints, null);
  assert.equal(COMFOWELL_320_PRESSURE_EVIDENCE.calculable, false);
  assert.equal(COMFOWELL_320_PRESSURE_EVIDENCE.applicableToCurrentNamedDn160SixBy90Chain, false);
  assert.ok(COMFOWELL_320_PRESSURE_EVIDENCE.gaps.some((gap) => /no tabulated ordinates/i.test(gap)));
  assert.ok(COMFOWELL_320_PRESSURE_EVIDENCE.gaps.some((gap) => /DN150.*DN160/i.test(gap)));
});

test("Q600 is searchable evidence only with verified connection diameters and an unresolved variant conflict", () => {
  const q600Candidates = CATALOGUE_CANDIDATES.filter((item) => item.productId?.includes("Q600"));
  assert.deepEqual(q600Candidates.map((item) => item.productId), ["ZEN-Q600HRV", "ZEN-Q600ERV"]);
  for (const item of q600Candidates) {
    assert.equal(item.placeable, false);
    assert.equal(item.status, "source-backed-candidate-variant-conflict");
    assert.equal(item.dimensions.body, null);
    assert.equal(item.connectionEvidence.connectionCount, 4);
    assert.equal(item.connectionEvidence.insideDiameterMm, 180);
    assert.equal(item.connectionEvidence.outsideDiameterMm, 200);
    assert.equal(item.connectionEvidence.routable, false);
    assert.equal(item.variantEvidence.status, "unresolved-conflict");
    assert.equal(item.ports.length, 0);
    assert.throws(
      () => createCatalogueComponent(item.id, {
        id: `component-${item.id}`,
        floorId: "floor-ground",
        xMm: 0,
        yMm: 0,
      }),
      /requires geometry and port evidence/,
    );
  }
});

test("sanitized candidates retain verified identifiers while private price and performance values stay absent", () => {
  for (const [productId, expectedName] of [
    ["AER-300HRV", "Aerofresh 300"],
    ["AER-450HRV", "Aerofresh 450"],
    ["ZEN-ACWS-320", "CW-S 320"],
    ["ZEN-H-TVA90-300", "TVA-P"],
    ["AER-DUC-DN125-1MSL", "DN125"],
    ["AER-DUC-DN160-1MSL", "DN160"],
    ["DUCT150-6M", "flexible"],
  ]) {
    const item = CATALOGUE_CANDIDATES.find((candidate) => candidate.productId === productId);
    assert.ok(item, productId);
    assert.match(item.name, new RegExp(expectedName, "i"));
    assert.equal(item.placeable, false);
    assert.equal(
      item.status,
      productId === "ZEN-ACWS-320"
        ? "source-backed-dimensional-candidate-interface-pending"
        : "identifier-only-evidence-required",
    );
  }
  for (const item of [...COMPONENT_CATALOGUE, ...CATALOGUE_CANDIDATES, ...DUCT_ROUTE_FAMILIES]) {
    assert.deepEqual(item.commercial.pricing, {
      status: "private-source-not-imported",
      amount: null,
      currency: null,
      sourceRevision: null,
    });
    assert.equal(item.performance.values, null);
  }
});

test("placed components carry an immutable catalogue-version snapshot inside the project", () => {
  const component = createCatalogueComponent("zehnder-q350-hrv-setout", {
    id: "component-q350",
    floorId: "floor-ground",
    xMm: 1200,
    yMm: 2400,
  });
  assert.equal(component.catalogueSnapshot.catalogueId, CATALOGUE_ID);
  assert.equal(component.catalogueSnapshot.catalogueVersion, CATALOGUE_VERSION);
  assert.equal(component.catalogueSnapshot.recordVersionId, component.catalogueRecordVersionId);
  assert.equal(component.catalogueSnapshot.productId, "ZEN-Q350HRV");
  assert.equal(component.catalogueSnapshot.connectionSetout.frontToRearRowCentreSpacingMm, 280.5);
  assert.equal(component.catalogueSnapshot.connectionSetout.localPortCoordinatesStatus, "unverified");
  assert.equal(component.ports.length, 0);

  let project = projectWithFloor();
  project = applyCommand(project, { type: "component.add", component });
  const reopened = deserializeProject(serializeProject(project));
  assert.deepEqual(reopened.components[0].catalogueSnapshot, component.catalogueSnapshot);
});

test("generic attenuation fixtures bridge DN160 EPP mains to independently typed DN90 radial branches", () => {
  const supply = createCatalogueComponent("generic-supply-attenuation-distribution-160", {
    id: "component-supply-manifold",
    floorId: "floor-ground",
    xMm: 0,
    yMm: 0,
  });
  assert.equal(supply.ports.length, 7);
  assert.deepEqual(supply.ports[0].interface, {
    family: "rigid-epp",
    nominalSizeMm: 160,
    boreMm: null,
    outsideDiameterMm: null,
    matingProfile: null,
    verificationStatus: "generic-test-fixture-only",
    drawingConnectionClass: "circular-dn160",
    installationCompatibilityStatus: "unverified",
  });
  assert.ok(supply.ports.slice(1).every((port) => (
    port.interface.family === "semi-rigid-pe" && port.interface.nominalSizeMm === 90
  )));
  assert.equal(TYPICAL_SYSTEM_GUIDANCE.attenuatorCount, 2);
  assert.equal(TYPICAL_SYSTEM_GUIDANCE.automaticPlacement, false);
  assert.equal(TYPICAL_SYSTEM_GUIDANCE.automaticQuantity, false);
});

test("terminal duct-run demand counts supply and extract independently without inventing CW recommendations", () => {
  let project = projectWithFloor();
  for (const [catalogueId, componentId] of [
    ["synthetic-supply-terminal", "supply-a"],
    ["synthetic-supply-terminal", "supply-b"],
    ["synthetic-extract-terminal", "extract-a"],
  ]) {
    project = applyCommand(project, {
      type: "component.add",
      component: createCatalogueComponent(catalogueId, {
        id: componentId,
        floorId: "floor-ground",
        xMm: 0,
        yMm: 0,
      }),
    });
  }
  project = applyCommand(project, {
    type: "component.setDuctRunCount",
    componentId: "supply-a",
    ductRunCount: 2,
  });
  project = applyCommand(project, {
    type: "component.setDuctRunCount",
    componentId: "extract-a",
    ductRunCount: 1,
  });

  const demand = deriveVentilationConnectionDemand(project);
  assert.deepEqual(demand.supply, {
    outletCount: 2,
    knownRunCount: 2,
    outletsMissingRunCount: 1,
  });
  assert.deepEqual(demand.extract, {
    outletCount: 1,
    knownRunCount: 1,
    outletsMissingRunCount: 0,
  });
  assert.equal(demand.cwSuggestion.status, "evidence-pending");
  assert.deepEqual(demand.cwSuggestion.recommendations, []);
  assert.throws(() => applyCommand(project, {
    type: "component.setDuctRunCount",
    componentId: "component-unit-missing",
    ductRunCount: 1,
  }), /Component not found/);
});

test("unit mounting policy blocks Aerofresh 300 direct mounting and does not infer Q600 compatibility", () => {
  const af300Direct = validateAttenuatorMountingChoice("aerofresh-300", "direct-unit-mounted");
  const af300Remote = validateAttenuatorMountingChoice("aerofresh-300", "remote-via-epp");
  assert.equal(af300Direct.allowed, false);
  assert.equal(af300Remote.allowed, true);
  assert.equal(af300Remote.nominalEppSizeMm, 125);

  for (const family of ["aerofresh-450", "zehnder-q350", "zehnder-q450"]) {
    assert.equal(validateAttenuatorMountingChoice(family, "direct-unit-mounted").allowed, true);
    assert.equal(validateAttenuatorMountingChoice(family, "remote-via-epp").nominalEppSizeMm, 160);
  }
  assert.throws(
    () => validateAttenuatorMountingChoice("zehnder-q600", "remote-via-epp"),
    /No approved mounting policy/,
  );
});

test("route authoring enforces available family and nominal-size compatibility", () => {
  let state = activateMechanicalTool(createMechanicalInteractionState(), "route", {
    ductKind: "epp-rigid-dn160",
  });
  const wrongStart = handleMechanicalCanvasClick(state, {
    point: { x: 0, y: 0 },
    hit: portHit("terminal-a", "port-a", "supply", "Dwelling supply", "semi-rigid-pe", 90),
  });
  assert.equal(wrongStart.state.routeDraft, null);
  assert.match(wrongStart.message, /does not match/);

  const started = handleMechanicalCanvasClick(state, {
    point: { x: 0, y: 0 },
    hit: portHit("unit-a", "port-a", "supply", "Dwelling supply", "rigid-epp", 160),
  });
  assert.ok(started.state.routeDraft);
  const wrongSize = handleMechanicalCanvasClick(started.state, {
    point: { x: 1000, y: 0 },
    hit: portHit("unit-b", "port-b", "supply", "Dwelling supply", "rigid-epp", 125),
  });
  assert.equal(wrongSize.intent, null);
  assert.match(wrongSize.message, /incompatible/);

  const completed = handleMechanicalCanvasClick(started.state, {
    point: { x: 1000, y: 0 },
    hit: portHit("unit-c", "port-c", "supply", "Dwelling supply", "rigid-epp", 160),
  });
  assert.equal(completed.intent.ductKind, "epp-rigid-dn160");
  assert.equal(completed.intent.connectionInterface.nominalSizeMm, 160);
});

test("Q350 nominal DN160 drawing routes remain explicit drawing-only links across unverified physical families", () => {
  const unit = createCatalogueComponent("zehnder-q350-hrv-left-drawing-profile", {
    id: "component-q350-left",
    floorId: "floor-ground",
    xMm: 0,
    yMm: 0,
  });
  const manifold = createCatalogueComponent("generic-supply-attenuation-distribution-160", {
    id: "component-drawing-manifold",
    floorId: "floor-ground",
    xMm: 2000,
    yMm: 0,
  });
  const start = unit.ports.find((port) => port.role === "Dwelling supply");
  const end = manifold.ports.find((port) => port.role === "Dwelling supply" && port.interface.nominalSizeMm === 160);
  const routeFamily = routeFamilyForKind("epp-rigid-dn160");
  assert.equal(start.interface.family, "zehnder-q-tr-rotating-round");
  assert.equal(end.interface.family, "rigid-epp");
  assert.equal(routeFamily.connectionInterface.connectionScope, "drawing-only");

  let state = activateMechanicalTool(createMechanicalInteractionState(), "route", {
    ductKind: "epp-rigid-dn160",
  });
  const started = handleMechanicalCanvasClick(state, {
    point: { x: -290, y: 118.5 },
    hit: { kind: "port", componentId: unit.id, portId: start.id, ...start, occupied: false },
  });
  assert.ok(started.state.routeDraft);
  const completed = handleMechanicalCanvasClick(started.state, {
    point: { x: 1640, y: 0 },
    hit: { kind: "port", componentId: manifold.id, portId: end.id, ...end, occupied: false },
  });
  assert.equal(completed.intent.type, "route.commit");
  assert.equal(completed.intent.connectionInterface.installationCompatibilityStatus, "unverified");

  let project = projectWithFloor();
  project = applyCommand(project, { type: "component.add", component: unit });
  project = applyCommand(project, { type: "component.add", component: manifold });
  project = applyCommand(project, {
    type: "route.add",
    route: {
      id: "route-q350-drawing-only",
      floorId: "floor-ground",
      system: "mvhr",
      stream: "supply",
      role: "Dwelling supply",
      ductKind: "epp-rigid-dn160",
      connectionInterface: routeFamily.connectionInterface,
      startAttachment: { componentId: unit.id, portId: start.id },
      endAttachment: { componentId: manifold.id, portId: end.id },
      points: [
        floorPortTransform(project, unit.id, start.id).positionMm,
        floorPortTransform(project, manifold.id, end.id).positionMm,
      ],
    },
  });
  assert.equal(project.routes[0].connectionInterface.connectionScope, "drawing-only");
});

test("new route families validate and round-trip without changing legacy generic routes", () => {
  assert.equal(routeFamilyForKind("epp-rigid-dn125").connectionInterface.nominalSizeMm, 125);
  assert.equal(routeFamilyForKind("epp-rigid-dn160").connectionInterface.nominalSizeMm, 160);
  assert.equal(routeFamilyForKind("flexible-round-dn150").connectionInterface.family, "flexible-round");
  assert.throws(() => routeFamilyForKind("epp-rigid-dn200"), /Unsupported route duct kind/);

  let project = projectWithFloor();
  const unit = createCatalogueComponent("synthetic-mvhr-placeholder", {
    id: "component-unit",
    floorId: "floor-ground",
    xMm: 0,
    yMm: 0,
  });
  const manifold = createCatalogueComponent("generic-supply-attenuation-distribution-160", {
    id: "component-manifold",
    floorId: "floor-ground",
    xMm: 2000,
    yMm: 0,
  });
  project = applyCommand(project, { type: "component.add", component: unit });
  project = applyCommand(project, { type: "component.add", component: manifold });
  const start = unit.ports.find((port) => port.stream === "supply");
  const end = manifold.ports.find((port) => port.interface.family === "rigid-epp");
  project = applyCommand(project, {
    type: "route.add",
    route: {
      id: "route-epp-160",
      floorId: "floor-ground",
      system: "mvhr",
      stream: "supply",
      role: "Dwelling supply",
      ductKind: "epp-rigid-dn160",
      connectionInterface: routeFamilyForKind("epp-rigid-dn160").connectionInterface,
      startAttachment: { componentId: unit.id, portId: start.id },
      endAttachment: { componentId: manifold.id, portId: end.id },
      points: [
        floorPortTransform(project, unit.id, start.id).positionMm,
        floorPortTransform(project, manifold.id, end.id).positionMm,
      ],
    },
  });
  assert.deepEqual(deserializeProject(serializeProject(project)), project);
});

function projectWithFloor() {
  return applyCommand(createProject("project-catalogue-test"), {
    type: "floor.add",
    floor: {
      id: "floor-ground",
      name: "Ground Floor",
      transform: {
        translationMm: { x: 0, y: 0, z: knownMm(0, "catalogue test datum") },
        orientation: identityQuaternion(),
      },
    },
  });
}

function portHit(componentId, portId, stream, role, family, nominalSizeMm) {
  return {
    kind: "port",
    componentId,
    portId,
    system: "mvhr",
    stream,
    role,
    interface: { family, nominalSizeMm },
  };
}
