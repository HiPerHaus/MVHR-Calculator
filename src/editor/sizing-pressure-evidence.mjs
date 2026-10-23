import { routeLengthSummary, validateProject } from "../domain/spatial.mjs";
import { inspectAirflowBalance } from "./airflow-balance.mjs";
import { Q350_PERFORMANCE_EVIDENCE } from "./component-catalogue.mjs";
import { auditVentilation } from "./ventilation-audit.mjs";

const EQUALITY_EPSILON_LPS = 1e-9;

/**
 * Evidence screen for Normal-mode unit screening input and pressure readiness.
 * This is deliberately not a pressure solver. It performs unit conversion,
 * exact source-statement alignment and explicit completeness checks only.
 */
export function inspectSizingPressureEvidence(project, floorId) {
  validateProject(project);
  const floor = project.floors.find((candidate) => candidate.id === floorId);
  if (!floor) throw new TypeError(`Sizing/pressure floor not found: ${String(floorId)}`);

  const airflow = inspectAirflowBalance(project, floorId);
  const audit = auditVentilation(project, floorId);
  const duty = project.engineeringInputs.floorDuties.find((candidate) => candidate.floorId === floorId) ?? null;
  const availableUnits = project.components
    .filter((component) => component.floorId === floorId && isMvhrUnit(component))
    .map(unitSummary)
    .sort((left, right) => left.name.localeCompare(right.name) || left.componentId.localeCompare(right.componentId));
  const selectedUnit = duty?.unitComponentId
    ? project.components.find((component) => component.id === duty.unitComponentId) ?? null
    : null;

  const assignedFlow = inspectAssignedFlow(airflow);
  const performance = selectedUnit === null
    ? unitPerformanceResult("blocked-unit-not-selected", null, assignedFlow, duty)
    : inspectSelectedUnit(selectedUnit, assignedFlow, duty);
  const networkPressure = inspectNetworkPressureReadiness(project, floorId, audit, duty);

  const blockers = [
    ...assignedFlow.blockers,
    ...(duty === null ? ["No Normal-mode engineering duty input is saved for this floor."] : []),
    ...(duty?.externalStaticPressure.state === "unresolved"
      ? [`External static pressure is unresolved: ${duty.externalStaticPressure.reason}.`]
      : []),
    ...performance.blockers,
    ...networkPressure.blockers,
  ];

  return deepFreeze({
    floorId,
    floorName: floor.name,
    mode: "normal",
    duty: duty === null ? null : structuredClone(duty),
    availableUnits,
    assignedFlow,
    unitPerformance: performance,
    networkPressure,
    status: blockers.length === 0 ? "review-required" : "blocked-incomplete-evidence",
    blockers: [...new Set(blockers)],
    evidenceBoundary: "The airflow value is the manual assigned room-target total used only as a screening input; it is not measured flow, not predicted flow and not a solved terminal allocation. This screen does not solve pressure. It never converts route drawings, visual sweeps, generic diameters or missing fittings into loss. Q350 comparison is limited to exact source statements for the supported article; it cannot interpolate a fan curve, establish whole-network suitability, approve product fit or establish compliance.",
  });
}

function inspectAssignedFlow(airflow) {
  const supply = airflow.totals.supply;
  const extract = airflow.totals.extract;
  const blockers = [];
  if (supply.spaceCount === 0 || extract.spaceCount === 0) {
    blockers.push("Both supply and extract spaces are required before deriving a Normal-mode manual room-target screening input.");
  }
  if (supply.assignedUnresolvedSpaceCount > 0 || extract.assignedUnresolvedSpaceCount > 0) {
    blockers.push("Every active supply and extract space needs an explicit assigned Normal airflow.");
  }
  const differenceLps = supply.assignedKnownLps - extract.assignedKnownLps;
  if (blockers.length === 0 && Math.abs(differenceLps) > EQUALITY_EPSILON_LPS) {
    blockers.push("Assigned supply and extract room-target totals differ; no tolerance or unit screening airflow is inferred.");
  }
  const completeAndEqual = blockers.length === 0;
  return {
    state: completeAndEqual ? "known-equal-assigned-totals" : "incomplete-or-unequal",
    supplyLps: supply.assignedKnownLps,
    extractLps: extract.assignedKnownLps,
    differenceLps,
    unitDutyAirflowM3h: completeAndEqual ? supply.assignedKnownLps * 3.6 : null,
    blockers,
  };
}

function inspectSelectedUnit(component, assignedFlow, duty) {
  const summary = unitSummary(component);
  const article = summary.manufacturerArticle;
  if (!Q350_PERFORMANCE_EVIDENCE.applicableManufacturerArticles.includes(article)) {
    return unitPerformanceResult(
      "blocked-no-reviewed-performance-evidence",
      summary,
      assignedFlow,
      duty,
      ["The selected unit has no reviewed manufacturer performance evidence in this catalogue version."],
    );
  }
  if (assignedFlow.unitDutyAirflowM3h === null) {
    return unitPerformanceResult(
      "blocked-airflow-duty-unresolved",
      summary,
      assignedFlow,
      duty,
      ["Complete, exactly equal manual assigned supply/extract room-target totals are required before unit screening."],
    );
  }
  if (assignedFlow.unitDutyAirflowM3h > Q350_PERFORMANCE_EVIDENCE.maximumPublishedAirflowM3h + 1e-9) {
    return unitPerformanceResult(
      "blocked-above-published-maximum-airflow",
      summary,
      assignedFlow,
      duty,
      [`The ${formatNumber(assignedFlow.unitDutyAirflowM3h)} m³/h duty exceeds the manufacturer's published 350 m³/h maximum air volume.`],
    );
  }
  if (!duty || duty.externalStaticPressure.state !== "known") {
    return unitPerformanceResult(
      "blocked-external-static-pressure-unresolved",
      summary,
      assignedFlow,
      duty,
      ["A sourced external-static pressure duty is required; missing pressure never becomes 0 Pa."],
    );
  }
  const point = Q350_PERFORMANCE_EVIDENCE.publishedOperatingPoints.find((candidate) => (
    Math.abs(candidate.airflowM3h - assignedFlow.unitDutyAirflowM3h) <= 1e-9 &&
    Math.abs(candidate.externalStaticPressurePa - duty.externalStaticPressure.valuePa) <= 1e-9
  ));
  if (point) {
    return unitPerformanceResult(
      "source-statement-alignment-review-required",
      summary,
      assignedFlow,
      duty,
      ["The manual room-target screening input aligns with one source statement for this article. It is not measured performance, a solved terminal flow or evidence of whole-network suitability; technical review is still required."],
      point,
    );
  }
  return unitPerformanceResult(
    "blocked-fan-curve-required",
    summary,
    assignedFlow,
    duty,
    ["This airflow/pressure combination is not one of the exact published evidence points. A checked fan curve and bounded interpolation method are required."],
  );
}

function unitPerformanceResult(status, unit, assignedFlow, duty, blockers = [], matchedPoint = null) {
  return {
    status,
    unit,
    dutyAirflowM3h: assignedFlow.unitDutyAirflowM3h,
    externalStaticPressurePa: duty?.externalStaticPressure.state === "known"
      ? duty.externalStaticPressure.valuePa
      : null,
    matchedPoint,
    manufacturerEvidence: structuredClone(Q350_PERFORMANCE_EVIDENCE),
    blockers,
  };
}

function inspectNetworkPressureReadiness(project, floorId, audit, duty) {
  const routes = project.routes.filter((route) => route.floorId === floorId);
  const unknownDevelopedRouteIds = routes
    .filter((route) => routeLengthSummary(route).developedMm === null)
    .map((route) => route.id);
  const routesWithoutReviewedLossData = routes.map((route) => route.id);
  const blockers = [];
  if (routes.length === 0) blockers.push("No connected route network exists for a pressure path review.");
  if (audit.diagnosticCounts.error + audit.diagnosticCounts.warning > 0) {
    blockers.push("The current topology audit has unresolved connection issues.");
  }
  if (unknownDevelopedRouteIds.length > 0) {
    blockers.push(`${unknownDevelopedRouteIds.length} route developed length${unknownDevelopedRouteIds.length === 1 ? " is" : "s are"} unresolved because elevation is unknown.`);
  }
  if (routesWithoutReviewedLossData.length > 0) {
    blockers.push("No placed route has a pinned, reviewed pressure-loss curve for its exact product variant.");
  }
  blockers.push(
    "Fitting identities and fitting-loss data are not modelled.",
    "Terminal pressure-loss data is not pinned to the placed terminals.",
    "Attenuator/manifold pressure-loss data is not pinned to the placed assembly variants.",
  );
  if (duty?.externalStaticPressure.state === "known") {
    blockers.push("The entered external-static duty is an external design input, not a result calculated from the drawn network.");
  }
  return {
    status: "blocked-no-supported-network-loss-method",
    routeCount: routes.length,
    unknownDevelopedRouteIds,
    routesWithoutReviewedLossData,
    calculatedPressureLossPa: null,
    blockers,
  };
}

function unitSummary(component) {
  const snapshot = component.catalogueSnapshot;
  return {
    componentId: component.id,
    name: component.displayName ?? component.id,
    productId: component.productId ?? snapshot?.productId ?? null,
    manufacturerArticle: snapshot?.manufacturerArticle ?? snapshot?.manufacturerArticleCandidate ?? null,
    recordVersionId: component.catalogueRecordVersionId ?? snapshot?.recordVersionId ?? null,
    evidenceStatus: component.catalogueStatus ?? snapshot?.status ?? "unclassified",
  };
}

function isMvhrUnit(component) {
  const roles = new Set(component.ports
    .filter((port) => port.system === "mvhr")
    .map((port) => port.role));
  return roles.has("Dwelling supply") && roles.has("Dwelling extract") ||
    component.catalogueItemId?.includes("q350") ||
    component.catalogueItemId?.includes("q450") ||
    component.catalogueItemId?.includes("q600");
}

function formatNumber(value) {
  return Number(value.toFixed(3)).toLocaleString("en-AU");
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
