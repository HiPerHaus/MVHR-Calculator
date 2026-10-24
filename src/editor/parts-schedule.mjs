import {componentQuoteCode,quoteCodeEvidence} from "./quote-product-codes.mjs";
import {deriveProjectAccessories} from "./project-accessories.mjs";
import {deriveRadialAccessories} from "./radial-accessories.mjs";
import { deriveEppTakeoff, deriveEppElbowStock, EPP_TAKEOFF_POLICY, deriveHrvEppConnectionAllowances, HRV_EPP_CONNECTION_ALLOWANCE_POLICY } from "./epp-takeoff.mjs";
import { routeLengthSummary, validateProject } from "../domain/spatial.mjs";
import {
  CATALOGUE_VERSION,
  COMPONENT_CATALOGUE,
  COMFOWELL_320_ARTICLE_EVIDENCE,
  routeFamilyForKind,
} from "./component-catalogue.mjs";

const VERIFIED_REGIONAL_STATUSES = new Set([
  "manufacturer-catalogue-verified-regional-match",
]);

const GENERIC_COMFOWELL_REFERENCE = Object.freeze({
  "generic-supply-remote-round-end-plate": "ZEN-MP320-160",
  "generic-extract-remote-round-end-plate": "ZEN-MP320-160",
  "generic-supply-remote-attenuator": "ZEN-ACWS-320",
  "generic-extract-remote-attenuator": "ZEN-ACWS-320",
  "generic-supply-remote-radial-plate": "ZEN-MPCWM-320-6X90",
  "generic-extract-remote-radial-plate": "ZEN-MPCWM-320-6X90",
});

/**
 * Derive a read-only active-floor parts and measured-route schedule.
 *
 * Component quantities count persisted component records. Assembly groups are
 * organisational only and never add a second quantity. Route quantities use
 * the saved authoritative control polyline, not display sweeps or inferred
 * fittings.
 */
export function createPartsSchedule(project, options = {}) {
  validateProject(project);
  const floorId = options.floorId;
  const floor = project.floors.find((candidate) => candidate.id === floorId);
  if (!floor) throw new TypeError(`Parts-schedule floor not found: ${String(floorId)}`);

  const components = project.components.filter((component) => component.floorId === floorId);
  const assemblies = project.equipmentAssemblies.filter((assembly) => assembly.floorId === floorId);
  const routes = project.routes.filter((route) => route.floorId === floorId);
  const assemblyByComponentId = new Map();
  for (const assembly of assemblies) {
    for (const componentId of assembly.componentIds) assemblyByComponentId.set(componentId, assembly.id);
  }

  const componentLines = componentScheduleLines(components, assemblyByComponentId);
  const routeLines = routeScheduleLines(routes);
  const eppTakeoff = deriveEppTakeoff(routes);
  const eppUnitConnectionAllowances = deriveHrvEppConnectionAllowances(routes, components);
  const unresolved = unresolvedScheduleItems(componentLines, routeLines);
  const summary = scheduleSummary(componentLines, routeLines, assemblies);

  return deepFreeze({
    kind: "drawing-parts-schedule",
    floorId,
    floorName: floor.name,
    componentLines,
    routeLines,
    projectAccessories:deriveProjectAccessories(project,{floorId,stubLengthMm:options.cwStubLengthMm}),
    radialAccessories:deriveRadialAccessories(project,{floorId,stubLengthMm:options.cwStubLengthMm}),
    eppTakeoff,
    eppUnitConnectionAllowances,
    eppUnitConnectionAllowancePolicy: HRV_EPP_CONNECTION_ALLOWANCE_POLICY,
    eppElbowStock: deriveEppElbowStock([...eppTakeoff, ...eppUnitConnectionAllowances]),
    eppTakeoffPolicy: EPP_TAKEOFF_POLICY,
    unresolved,
    summary,
    lengthBasis: "Saved route control-polyline centreline in plan. Single multiplies by 1 and Twin by 2. Display sweeps, bends, fittings, allowances and waste are excluded.",
    evidenceBoundary: "Placed quantities are exact model-record counts. Product identity, regional availability and compatibility remain provisional unless the line explicitly says verified regional catalogue match. This is not a price, order, fabrication or engineering schedule.",
  });
}

function componentScheduleLines(components, assemblyByComponentId) {
  const byKey = new Map();
  for (const component of components) {
    const snapshot = component.catalogueSnapshot ?? null;
    const catalogueItem = COMPONENT_CATALOGUE.find(item => item.id === (snapshot?.recordId ?? component.catalogueItemId));
    const category = catalogueItem?.category;
    const section = category?.startsWith("mvhr-unit") ? "mvhr"
      : ["terminal", "external-grille"].includes(category) ? "terminals" : "equipment";
    const combinedGrille = category === "external-grille" && component.ports.some(port => port.stream === "intake") && component.ports.some(port => port.stream === "exhaust");
    const handing = combinedGrille ? (component.externalGrilleHanding ?? "left") : null;
    const key = [
      snapshot?.catalogueId ?? "no-catalogue",
      snapshot?.catalogueVersion ?? "no-catalogue-version",
      snapshot?.recordId ?? component.catalogueItemId ?? "no-record",
      snapshot?.recordVersionId ?? component.catalogueRecordVersionId ?? "no-record-version",
      component.productId ?? "no-product-id",
      component.catalogueStatus ?? "unclassified",
      handing ?? "no-handing",
    ].join("\u0000");
    let line = byKey.get(key);
    if (!line) {
      const classification = classifyComponentEvidence(component);
      line = {
        key,
        ref: null,
        section,
        handing,
        description: `${component.displayName ?? component.id}${handing ? ` · ${handing === "left" ? "Left" : "Right"}` : ""}`,
        manufacturer: component.manufacturer ?? null,
        productId: component.productId ?? null,
        partNumber: componentQuoteCode(component),
        partNumberSource: quoteCodeEvidence(componentQuoteCode(component)),
        manufacturerArticle: referenceManufacturerArticle(component),
        catalogueStatus: component.catalogueStatus ?? "unclassified",
        catalogueVersion: snapshot?.catalogueVersion ?? null,
        recordVersionId: snapshot?.recordVersionId ?? component.catalogueRecordVersionId ?? null,
        evidenceClass: classification.evidenceClass,
        matchStatus: classification.matchStatus,
        evidenceNote: classification.evidenceNote,
        quantity: 0,
        groupedQuantity: 0,
        independentQuantity: 0,
        componentIds: [],
        assemblyIds: [],
        referenceCandidate: unresolvedReferenceCandidate(component),
      };
      byKey.set(key, line);
    }
    line.quantity += 1;
    line.componentIds.push(component.id);
    const assemblyId = assemblyByComponentId.get(component.id) ?? null;
    if (assemblyId === null) {
      line.independentQuantity += 1;
    } else {
      line.groupedQuantity += 1;
      if (!line.assemblyIds.includes(assemblyId)) line.assemblyIds.push(assemblyId);
    }
  }
  return [...byKey.values()]
    .sort((left, right) => (
      left.description.localeCompare(right.description) || left.key.localeCompare(right.key)
    ))
    .map((line, index) => ({ ...line, ref: `P${String(index + 1).padStart(2, "0")}` }));
}

function routeScheduleLines(routes) {
  const byKey = new Map();
  for (const route of routes) {
    const family = routeFamilyForKind(route.ductKind);
    const key = `${route.ductKind}\u0000${route.stream}`;
    let line = byKey.get(key);
    if (!line) {
      line = {
        key,
        ref: null,
        ductKind: route.ductKind,
        description: family.name,
        stream: route.stream,
        nominalSizeMm: family.connectionInterface?.nominalSizeMm ?? null,
        interfaceFamily: family.connectionInterface?.family ?? null,
        routeCount: 0,
        routeIds: [],
        arrangements: {
          single: { routeCount: 0, savedCentrelinePlanMm: 0 },
          twin: { routeCount: 0, savedCentrelinePlanMm: 0 },
          unset: { routeCount: 0, savedCentrelinePlanMm: 0 },
        },
        savedCentrelinePlanMm: 0,
        knownMultipliedPlanMm: 0,
        pendingParallelRunRouteCount: 0,
        pendingParallelRunCentrelineMm: 0,
        knownMultipliedDevelopedMm: 0,
        unknownDevelopedRouteCount: 0,
        developedQuantityMm: 0,
        developedQuantityState: "known",
        productMatchStatus: "route-class-only-product-unmatched",
      };
      byKey.set(key, line);
    }
    const length = routeLengthSummary(route);
    const arrangement = route.parallelRunCount === 1
      ? "single"
      : route.parallelRunCount === 2
        ? "twin"
        : "unset";
    const multiplier = arrangement === "single" ? 1 : arrangement === "twin" ? 2 : null;
    line.routeCount += 1;
    line.routeIds.push(route.id);
    line.savedCentrelinePlanMm += length.projectedMm;
    line.arrangements[arrangement].routeCount += 1;
    line.arrangements[arrangement].savedCentrelinePlanMm += length.projectedMm;
    if (multiplier === null) {
      line.pendingParallelRunRouteCount += 1;
      line.pendingParallelRunCentrelineMm += length.projectedMm;
    } else {
      line.knownMultipliedPlanMm += length.projectedMm * multiplier;
    }
    if (length.developedMm === null || multiplier === null) {
      line.unknownDevelopedRouteCount += 1;
      line.developedQuantityState = "incomplete";
      line.developedQuantityMm = null;
    } else {
      line.knownMultipliedDevelopedMm += length.developedMm * multiplier;
      if (line.developedQuantityState === "known") {
        line.developedQuantityMm = line.knownMultipliedDevelopedMm;
      }
    }
  }
  return [...byKey.values()]
    .sort((left, right) => (
      left.description.localeCompare(right.description) || left.stream.localeCompare(right.stream)
    ))
    .map((line, index) => ({ ...line, ref: `D${String(index + 1).padStart(2, "0")}` }));
}

function classifyComponentEvidence(component) {
  if (VERIFIED_REGIONAL_STATUSES.has(component.catalogueStatus)) {
    return {
      evidenceClass: "verified-catalogue",
      matchStatus: "verified-regional-catalogue-match",
      evidenceNote: "Placed snapshot carries an explicit verified regional catalogue match.",
    };
  }
  if (
    component.catalogueStatus?.startsWith("source-backed-") ||
    component.catalogueStatus?.startsWith("verified-dimensional-")
  ) {
    return {
      evidenceClass: "source-backed-provisional",
      matchStatus: "local-product-crosswalk-or-installation-review-required",
      evidenceNote: "The placed snapshot has source-backed drawing evidence, but the local product crosswalk or installation compatibility is not verified.",
    };
  }
  return {
    evidenceClass: "unmatched-provisional",
    matchStatus: "no-verified-manufacturer-product-match",
    evidenceNote: "This is a generic or otherwise unmatched placed record and must not be ordered as a manufacturer product.",
  };
}

function referenceManufacturerArticle(component) {
  const snapshot = component.catalogueSnapshot;
  const pinnedArticle = snapshot?.manufacturerArticle ?? snapshot?.manufacturerArticleCandidate ?? null;
  if (pinnedArticle) return pinnedArticle;
  if (!snapshot?.recordId || !snapshot?.recordVersionId) return null;
  const current = COMPONENT_CATALOGUE.find((item) => (
    item.id === snapshot.recordId && item.versionId === snapshot.recordVersionId
  ));
  return current?.manufacturerArticle ?? current?.manufacturerArticleCandidate ?? null;
}

function unresolvedReferenceCandidate(component) {
  const localProductId = GENERIC_COMFOWELL_REFERENCE[component.catalogueItemId];
  if (!localProductId) return null;
  const evidence = COMFOWELL_320_ARTICLE_EVIDENCE.find((item) => item.localProductId === localProductId);
  if (!evidence) return null;
  return {
    status: "reference-only-not-a-match",
    localProductId: evidence.localProductId,
    manufacturerItem: evidence.manufacturerItem,
    manufacturerArticle: evidence.manufacturerArticle,
    manufacturerIdentityStatus: evidence.manufacturerIdentityStatus,
    localSkuCrosswalkStatus: evidence.localSkuCrosswalkStatus,
    australianAvailabilityStatus: evidence.australianAvailabilityStatus,
    installationCompatibilityStatus: evidence.installationCompatibilityStatus,
    note: "Official manufacturer identity is known, but this generic placed component has not been replaced or matched to that product.",
  };
}

function unresolvedScheduleItems(componentLines, routeLines) {
  const result = [];
  for (const line of componentLines) {
    if (line.evidenceClass !== "verified-catalogue") {
      result.push({
        code: "component-product-match-unresolved",
        ref: line.ref,
        detail: `${line.description}: ${line.evidenceNote}`,
      });
    }
    if (line.referenceCandidate) {
      result.push({
        code: "reference-candidate-not-selected",
        ref: line.ref,
        detail: `${line.referenceCandidate.manufacturerItem} article ${line.referenceCandidate.manufacturerArticle} is reference evidence only; Australian crosswalk, availability and installed compatibility remain unresolved.`,
      });
    }
  }
  for (const line of routeLines) {
    if (line.pendingParallelRunRouteCount > 0) {
      result.push({
        code: "route-parallel-run-count-unset",
        ref: line.ref,
        detail: `${line.pendingParallelRunRouteCount} route arrangement${line.pendingParallelRunRouteCount === 1 ? " is" : "s are"} unset; multiplied duct quantity is incomplete.`,
      });
    }
    if (line.unknownDevelopedRouteCount > 0) {
      result.push({
        code: "route-developed-length-unknown",
        ref: line.ref,
        detail: `${line.unknownDevelopedRouteCount} route${line.unknownDevelopedRouteCount === 1 ? " has" : "s have"} unknown elevation or run count; developed duct quantity is incomplete.`,
      });
    }
  }
  return result;
}

function scheduleSummary(componentLines, routeLines, assemblies) {
  const quantityFor = (evidenceClass) => componentLines
    .filter((line) => line.evidenceClass === evidenceClass)
    .reduce((sum, line) => sum + line.quantity, 0);
  return {
    componentQuantity: componentLines.reduce((sum, line) => sum + line.quantity, 0),
    verifiedComponentQuantity: quantityFor("verified-catalogue"),
    sourceBackedProvisionalQuantity: quantityFor("source-backed-provisional"),
    unmatchedProvisionalQuantity: quantityFor("unmatched-provisional"),
    assemblyGroupCount: assemblies.length,
    routeCount: routeLines.reduce((sum, line) => sum + line.routeCount, 0),
    savedCentrelinePlanMm: routeLines.reduce((sum, line) => sum + line.savedCentrelinePlanMm, 0),
    knownMultipliedPlanMm: routeLines.reduce((sum, line) => sum + line.knownMultipliedPlanMm, 0),
    pendingParallelRunRouteCount: routeLines.reduce((sum, line) => sum + line.pendingParallelRunRouteCount, 0),
    unknownDevelopedRouteCount: routeLines.reduce((sum, line) => sum + line.unknownDevelopedRouteCount, 0),
    catalogueVersionAtGeneration: CATALOGUE_VERSION,
  };
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
