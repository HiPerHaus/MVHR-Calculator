import { inspectFloorAreaOutline } from "./floor-area.mjs";

export const DESIGN_STAGES = Object.freeze([
  "quick-quote",
  "preliminary-layout",
  "project-converted",
  "detailed-design",
]);

export function createDesignWorkflow() {
  return {
    stage: "quick-quote",
    convertedQuoteSnapshotId: null,
  };
}

export function createQuoteDraft() {
  return {
    currency: null,
    areaRatePerM2: null,
    fixedAllowance: null,
    markupPercent: null,
    scopeExclusions: [],
    scopeReviewed: false,
  };
}

export function normalizeDesignWorkflow(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Design workflow must be an object");
  }
  if (!DESIGN_STAGES.includes(value.stage)) {
    throw new TypeError(`Unsupported design stage: ${String(value.stage)}`);
  }
  return {
    stage: value.stage,
    convertedQuoteSnapshotId: optionalId(value.convertedQuoteSnapshotId, "Converted quote snapshot ID"),
  };
}

export function normalizeQuoteDraft(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Quote draft must be an object");
  }
  return {
    currency: optionalText(value.currency, "Quote currency", 12),
    areaRatePerM2: optionalNonNegative(value.areaRatePerM2, "Quote area rate"),
    fixedAllowance: optionalNonNegative(value.fixedAllowance, "Quote fixed allowance"),
    markupPercent: optionalNonNegative(value.markupPercent, "Quote markup percentage"),
    scopeExclusions: normalizeExclusions(value.scopeExclusions),
    scopeReviewed: value.scopeReviewed === true,
  };
}

export function inspectQuickQuote(project) {
  const outlineBasis = project.floorAreaOutlines.map((outline) => {
    const floor = project.floors.find((candidate) => candidate.id === outline.floorId);
    const inspection = inspectFloorAreaOutline(outline);
    return {
      floorId: outline.floorId,
      floorName: floor?.name ?? outline.floorId,
      outlineId: outline.id,
      outlineName: outline.name,
      areaMm2: inspection.areaMm2,
      perimeterMm: inspection.perimeterMm,
      scaleEvidence: scaleEvidenceForFloor(project, outline.floorId),
    };
  });
  const areaMm2 = outlineBasis.reduce((total, item) => total + item.areaMm2, 0);
  const missingCommercialInputs = [];
  const missingSpatialInputs = [];
  if (outlineBasis.length === 0) missingSpatialInputs.push("closed serviced-area outline");
  if (!project.quoteDraft.scopeReviewed) missingSpatialInputs.push("scope exclusions review");
  const commercial = null;
  return Object.freeze({
    areaMm2,
    areaM2: areaMm2 / 1_000_000,
    outlineBasis: Object.freeze(outlineBasis.map(Object.freeze)),
    missingSpatialInputs: Object.freeze(missingSpatialInputs),
    missingCommercialInputs: Object.freeze(missingCommercialInputs),
    spatialReady: missingSpatialInputs.length === 0,
    priced: false,
    commercial: commercial === null ? null : Object.freeze(commercial),
  });
}

export function createQuoteSnapshot(project, { id, createdAtUtc }) {
  const inspection = inspectQuickQuote(project);
  if (!inspection.spatialReady) {
    throw new TypeError(`Quote conversion still requires: ${inspection.missingSpatialInputs.join(", ")}`);
  }
  const outletComponents = project.components.filter(isMvhrOutlet);
  const knownRunCount = outletComponents.reduce(
    (total, component) => total + (component.ductRunCount ?? 0),
    0,
  );
  return normalizeQuoteSnapshot({
    id,
    createdAtUtc,
    status: "layout-baseline",
    areaMm2: inspection.areaMm2,
    outlineBasis: inspection.outlineBasis.map(({ floorId, outlineId, areaMm2, perimeterMm, scaleEvidence }) => ({
      floorId, outlineId, areaMm2, perimeterMm, scaleEvidence,
    })),
    commercialInputs: structuredClone(project.quoteDraft),
    commercial: null,
    preliminaryAllowances: {
      componentCount: project.components.length,
      equipmentAssemblyCount: project.equipmentAssemblies.length,
      routeCount: project.routes.length,
      outletCount: outletComponents.length,
      knownDuctRunCount: knownRunCount,
      unresolvedOutletRunCount: outletComponents.filter((component) => component.ductRunCount === null).length,
    },
  });
}

export function normalizeQuoteSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Quote snapshot must be an object");
  }
  const id = requiredId(value.id, "Quote snapshot ID");
  const status = oneOf(value.status, ["layout-baseline", "priced-local-baseline", "commercial-inputs-missing"], "Quote snapshot status");
  const createdAtUtc = normalizeUtc(value.createdAtUtc, "Quote snapshot time");
  const areaMm2 = nonNegative(value.areaMm2, "Quote snapshot area");
  if (!Array.isArray(value.outlineBasis)) throw new TypeError("Quote outline basis must be an array");
  const outlineBasis = value.outlineBasis.map((item) => ({
    floorId: requiredId(item?.floorId, "Quote floor ID"),
    outlineId: requiredId(item?.outlineId, "Quote outline ID"),
    areaMm2: nonNegative(item?.areaMm2, "Quote outline area"),
    perimeterMm: nonNegative(item?.perimeterMm, "Quote outline perimeter"),
    scaleEvidence: oneOf(item?.scaleEvidence, ["calibrated-image", "explicit-cad-units", "manual-project-grid"], "Quote scale evidence"),
  }));
  const commercialInputs = normalizeQuoteDraft(value.commercialInputs);
  const commercial = value.commercial === null ? null : normalizeCommercial(value.commercial);
  if (status === "priced-local-baseline" && commercial === null) {
    throw new TypeError("Priced quote snapshot status and commercial total must agree");
  }
  if (status === "layout-baseline" && commercial !== null) {
    throw new TypeError("Layout baseline cannot introduce a commercial total");
  }
  if (outlineBasis.length === 0 || areaMm2 <= 0) {
    throw new TypeError("Quote snapshot requires a non-zero serviced-area basis");
  }
  if (!commercialInputs.scopeReviewed) {
    throw new TypeError("Quote snapshot requires an explicit scope review");
  }
  const basisAreaMm2 = outlineBasis.reduce((total, item) => total + item.areaMm2, 0);
  if (Math.abs(basisAreaMm2 - areaMm2) > 1e-6) {
    throw new TypeError("Quote snapshot area must equal its frozen outline basis");
  }
  if (commercial !== null) {
    if ([commercialInputs.currency, commercialInputs.areaRatePerM2, commercialInputs.fixedAllowance, commercialInputs.markupPercent].some((item) => item === null)) {
      throw new TypeError("Priced quote snapshot requires every commercial input");
    }
    const expected = calculateCommercial(areaMm2, commercialInputs);
    for (const field of ["areaSubtotal", "fixedAllowance", "subtotalBeforeMarkup", "markupPercent", "markupAmount", "total"]) {
      if (Math.abs(commercial[field] - expected[field]) > 1e-8) {
        throw new TypeError(`Quote snapshot commercial ${field} does not match its frozen inputs`);
      }
    }
    if (commercial.currency !== expected.currency) {
      throw new TypeError("Quote snapshot currency does not match its frozen inputs");
    }
  }
  const allowance = value.preliminaryAllowances;
  if (!allowance || typeof allowance !== "object" || Array.isArray(allowance)) {
    throw new TypeError("Quote preliminary allowances must be an object");
  }
  const preliminaryAllowances = {};
  for (const field of ["componentCount", "equipmentAssemblyCount", "routeCount", "outletCount", "knownDuctRunCount", "unresolvedOutletRunCount"]) {
    preliminaryAllowances[field] = nonNegativeInteger(allowance[field], `Quote ${field}`);
  }
  return { id, createdAtUtc, status, areaMm2, outlineBasis, commercialInputs, commercial, preliminaryAllowances };
}

export function inspectDetailedDesign(project) {
  const snapshot = project.workflow.convertedQuoteSnapshotId === null
    ? null
    : project.quoteSnapshots.find((candidate) => candidate.id === project.workflow.convertedQuoteSnapshotId) ?? null;
  const outlets = project.components.filter(isMvhrOutlet);
  const assigned = new Set([...project.rooms, ...project.zones].flatMap((space) => (
    space.terminalAssociations.map((association) => association.componentId)
  )));
  const current = {
    componentCount: project.components.length,
    equipmentAssemblyCount: project.equipmentAssemblies.length,
    routeCount: project.routes.length,
    outletCount: outlets.length,
    knownDuctRunCount: outlets.reduce((total, component) => total + (component.ductRunCount ?? 0), 0),
    unresolvedOutletRunCount: outlets.filter((component) => component.ductRunCount === null).length,
  };
  const differences = snapshot === null ? null : Object.fromEntries(
    Object.keys(current).map((field) => [field, current[field] - snapshot.preliminaryAllowances[field]]),
  );
  return Object.freeze({
    snapshot,
    current: Object.freeze(current),
    differences: differences === null ? null : Object.freeze(differences),
    roomCount: project.rooms.length,
    zoneCount: project.zones.length,
    assignedOutletCount: outlets.filter((component) => assigned.has(component.id)).length,
    unassignedOutletCount: outlets.filter((component) => !assigned.has(component.id)).length,
    unresolvedRequirements: Object.freeze([
      ...(outlets.length > 0 ? ["Room airflow inputs may remain unresolved; manufacturer capacity and pressure methods are incomplete."] : []),
      ...(current.unresolvedOutletRunCount > 0 ? ["One or more outlets still have no Single/Twin duct selection."] : []),
    ]),
  });
}

export function inferredLegacyWorkflow(project) {
  return {
    stage: project.rooms?.length || project.zones?.length
      ? "detailed-design"
      : project.components?.length || project.routes?.length || project.equipmentAssemblies?.length
        ? "preliminary-layout"
        : "quick-quote",
    convertedQuoteSnapshotId: null,
  };
}

function scaleEvidenceForFloor(project, floorId) {
  if (project.floorReferences.some((reference) => reference.floorId === floorId && reference.calibration !== null)) {
    return "calibrated-image";
  }
  if (project.floorCadReferences.some((reference) => reference.floorId === floorId)) {
    return "explicit-cad-units";
  }
  return "manual-project-grid";
}

function calculateCommercial(areaMm2, draft) {
  const areaSubtotal = areaMm2 / 1_000_000 * draft.areaRatePerM2;
  const subtotalBeforeMarkup = areaSubtotal + draft.fixedAllowance;
  const markupAmount = subtotalBeforeMarkup * draft.markupPercent / 100;
  return {
    currency: draft.currency,
    areaSubtotal,
    fixedAllowance: draft.fixedAllowance,
    subtotalBeforeMarkup,
    markupPercent: draft.markupPercent,
    markupAmount,
    total: subtotalBeforeMarkup + markupAmount,
  };
}

function normalizeCommercial(value) {
  const result = { currency: optionalText(value.currency, "Quote currency", 12) };
  if (result.currency === null) throw new TypeError("Priced quote snapshot requires a currency");
  for (const field of ["areaSubtotal", "fixedAllowance", "subtotalBeforeMarkup", "markupPercent", "markupAmount", "total"]) {
    result[field] = nonNegative(value[field], `Quote commercial ${field}`);
  }
  return result;
}

function isMvhrOutlet(component) {
  return component.ports?.length === 1 && component.ports[0].system === "mvhr" &&
    (component.ports[0].stream === "supply" || component.ports[0].stream === "extract");
}

function normalizeExclusions(value) {
  if (!Array.isArray(value)) throw new TypeError("Quote scope exclusions must be an array");
  if (value.length > 50) throw new RangeError("Quote scope exclusions exceed the 50-item limit");
  return value.map((item) => {
    if (typeof item !== "string" || item.trim().length === 0 || item.trim().length > 240) {
      throw new TypeError("Each quote scope exclusion must be non-empty text up to 240 characters");
    }
    return item.trim();
  });
}

function optionalText(value, label, maxLength) {
  if (value === null) return null;
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > maxLength) {
    throw new TypeError(`${label} must be null or non-empty text up to ${maxLength} characters`);
  }
  return value.trim().toUpperCase();
}

function optionalNonNegative(value, label) {
  return value === null ? null : nonNegative(value, label);
}

function nonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be a non-negative finite number`);
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative integer`);
  return value;
}

function oneOf(value, choices, label) {
  if (!choices.includes(value)) throw new TypeError(`${label} must be one of: ${choices.join(", ")}`);
  return value;
}

function optionalId(value, label) {
  return value === null ? null : requiredId(value, label);
}

function requiredId(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${label} must be a non-empty opaque string`);
  }
  return value;
}

function normalizeUtc(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO date-time string`);
  }
  return value;
}
