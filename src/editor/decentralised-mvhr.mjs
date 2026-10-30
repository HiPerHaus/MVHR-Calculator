const CATALOGUE_SOURCE = Object.freeze({
  sourceId: "hiper-haus-decentralised-range-2026-10-30",
  sourceKind: "owner-current-product-range-and-product-guides",
  rangeUrl: "https://www.hiperhaus.com.au/shop/decentralised-mvhr",
  verificationStatus: "product-identity-topology-and-listed-dimensions-reviewed",
});

const SCHEMATIC_SYMBOL = Object.freeze({
  shape: "box",
  widthMm: 320,
  heightMm: 140,
  scaleStatus: "schematic-not-to-scale",
  throughWall: true,
});

export function decentralisedMvhrRecords() {
  return [
    record({
      id: "aerofresh-30-compact-decentralised",
      versionId: "aerofresh-30-compact-decentralised.v1",
      manufacturer: "Aerofresh",
      name: "Aerofresh 30 Compact",
      guideUrl: "https://www.hiperhaus.com.au/docs/Aerofresh-30-Compact-Guide.pdf",
      operatingMode: "alternating-paired",
      wallOpeningReference: { valueMm: 160, basis: "HiPer guide wall-opening statement", status: "conflicts-with-sleeve-versus-core-manual-terminology" },
      wallDepthRangeMm: { minimum: 140, maximum: 280, basis: "standard hood" },
      accessoryWallDepthRangeMm: { minimum: 90, maximum: 280, basis: "XL hood only" },
      frontFaceMm: null,
      controller: { kind: "external", referenceRequired: true, note: "sMove can coordinate up to eight physical unit heads; one controller is supplied per kit, not per marker or pair." },
      evidenceBoundary: "Paired alternating operation is source-backed. The physical plan footprint, installed projection, kit composition and controller quantity are not inferred from one placed marker.",
    }),
    record({
      id: "zehnder-comfospot-50-decentralised",
      versionId: "zehnder-comfospot-50-decentralised.v1",
      manufacturer: "Zehnder",
      name: "ComfoSpot 50",
      guideUrl: "https://www.hiperhaus.com.au/docs/HiPer-Haus-ComfoSpot-50-Guide.pdf",
      operatingMode: "continuous-balanced",
      wallOpeningReference: { valueMm: 315, basis: "HiPer guide wall-sleeve statement", status: "reference-only-not-drill-diameter" },
      wallDepthRangeMm: null,
      frontFaceMm: { width: 380, height: 376 },
      controller: { kind: "integrated", referenceRequired: false, note: "Integrated control; optional sensor boards remain separate selections." },
      referenceAirflowM3h: [15, 25, 40, 50],
      evidenceBoundary: "Published airflow levels are catalogue reference data, not predicted or delivered project airflow. Wall thickness and installed plan projection remain unverified.",
    }),
    record({
      id: "zehnder-comfoair-70-decentralised",
      versionId: "zehnder-comfoair-70-decentralised.v1",
      manufacturer: "Zehnder",
      name: "ComfoAir 70",
      guideUrl: "https://www.hiperhaus.com.au/docs/HiPer-Haus-ComfoAir-70-Guide.pdf",
      operatingMode: "continuous-balanced",
      wallOpeningReference: { valueMm: 280, basis: "HiPer guide approximate core-opening statement", status: "conflicts-with-current-manual-reference" },
      wallDepthRangeMm: { minimum: 280, maximum: 600, basis: "listed wall thickness" },
      frontFaceMm: { width: 440, height: 660, depth: 145 },
      controller: { kind: "integrated", referenceRequired: false, note: "Integrated touch control; optional demand sensor remains a separate selection." },
      referenceAirflowM3h: [15, 25, 40, 65],
      evidenceBoundary: "The optional twin-room connection is not modelled in this first markup version. Published airflow levels are reference data, not predicted or delivered project airflow.",
    }),
    record({
      id: "lunos-e2-60-decentralised",
      versionId: "lunos-e2-60-decentralised.v1",
      manufacturer: "Lunos",
      name: "e2-60",
      guideUrl: "https://www.hiperhaus.com.au/docs/HiPer-Haus-Lunos-e2-60-Guide.pdf",
      operatingMode: "alternating-paired",
      wallOpeningReference: { valueMm: 162, basis: "HiPer guide approximate core-opening statement", status: "reference-only-not-drill-diameter" },
      wallDepthRangeMm: { minimum: 300, maximum: 500, basis: "listed wall tube" },
      frontFaceMm: { width: 180, height: 180 },
      controller: { kind: "external", referenceRequired: true, note: "Controller and power-supply variant must be recorded explicitly; no generic controller-per-pair count is inferred." },
      referenceAirflowM3h: null,
      evidenceBoundary: "Paired alternating operation is source-backed. Special model-specific groupings require review, so incomplete groups warn rather than fail. Published airflow variants are not used as a sizing default.",
    }),
  ];
}

export function isDecentralisedMvhrComponent(component) {
  return component?.decentralisedMvhr?.systemKind === "decentralised-through-wall";
}

export function inspectDecentralisedMvhr(project, floorId) {
  const components = (project?.components ?? []).filter((component) => (
    component.floorId === floorId && isDecentralisedMvhrComponent(component)
  ));
  const diagnostics = [];
  const pairGroups = groupByNonEmpty(components, (component) => component.decentralisedMvhr.pairGroupId);
  const controllerGroups = groupByNonEmpty(components, (component) => component.decentralisedMvhr.controllerReference);

  for (const component of components) {
    const metadata = component.decentralisedMvhr;
    if (metadata.roomId === null && metadata.zoneId === null) diagnostics.push(issue(
      "decentralised-space-unassigned", "warning", "Decentralised unit has no room or zone", `${component.displayName} is placed but not associated with a room or zone.`, component.id,
    ));
    if (metadata.operatingMode === "alternating-paired" && metadata.pairGroupId === null) diagnostics.push(issue(
      "decentralised-pair-unassigned", "warning", "Alternating unit needs a pair or group", `${component.displayName} needs an explicit pair/group reference. No partner is inferred by proximity.`, component.id,
    ));
    if (metadata.controllerReferenceRequired && metadata.controllerReference === null) diagnostics.push(issue(
      "decentralised-controller-unassigned", "warning", "Controller association is not recorded", `${component.displayName} needs an explicit controller reference. No controller quantity is inferred.`, component.id,
    ));
  }

  for (const [pairGroupId, members] of pairGroups) {
    const alternating = members.filter((component) => component.decentralisedMvhr.operatingMode === "alternating-paired");
    if (alternating.length !== members.length) diagnostics.push(issue(
      "decentralised-pair-mode-mixed", "warning", "Pair/group mixes operating modes", `${pairGroupId} contains both alternating and continuous-balanced units; compatibility is not assessed.`, members[0].id,
    ));
    if (alternating.length > 0 && members.length !== 2) diagnostics.push(issue(
      "decentralised-pair-count-review", "warning", "Alternating group quantity needs review", `${pairGroupId} contains ${members.length} physical unit markers. A normal pair has two; model-specific alternatives are not rejected automatically.`, members[0].id,
    ));
    if (new Set(members.map((component) => component.catalogueItemId)).size > 1) diagnostics.push(issue(
      "decentralised-pair-model-review", "warning", "Pair/group model compatibility is not assessed", `${pairGroupId} contains more than one catalogue model. Confirm the exact controller and product combination.`, members[0].id,
    ));
  }

  return deepFreeze({
    floorId,
    unitCount: components.length,
    alternatingUnitCount: components.filter((component) => component.decentralisedMvhr.operatingMode === "alternating-paired").length,
    continuousBalancedUnitCount: components.filter((component) => component.decentralisedMvhr.operatingMode === "continuous-balanced").length,
    pairGroupCount: pairGroups.size,
    controllerReferenceCount: controllerGroups.size,
    pairGroups: [...pairGroups].map(([id, members]) => ({ id, componentIds: members.map((component) => component.id), physicalUnitCount: members.length })),
    controllerGroups: [...controllerGroups].map(([id, members]) => ({ id, componentIds: members.map((component) => component.id), physicalUnitCount: members.length })),
    diagnostics,
    evidenceBoundary: "Physical unit markers, explicit room/zone, pair/group and controller references only. Wall suitability, clearances, electrical design, compliance, product compatibility and delivered airflow are not assessed.",
  });
}

function record(value) {
  const source = { ...CATALOGUE_SOURCE, guideUrl: value.guideUrl };
  return {
    id: value.id,
    versionId: value.versionId,
    group: "Decentralised MVHR",
    category: "decentralised-mvhr-unit",
    manufacturer: value.manufacturer,
    productId: null,
    manufacturerArticle: null,
    name: `${value.manufacturer} ${value.name}`,
    status: "source-backed-current-range-identity-topology-only",
    source,
    dimensions: {
      unit: "mm",
      body: value.frontFaceMm,
      drawingEnvelope: null,
      penetrationDiameterMm: null,
      wallOpeningReference: value.wallOpeningReference,
      penetrationNote: "Confirm the current exact product and installation manual before selecting or drilling a wall opening.",
      wallDepthRangeMm: value.wallDepthRangeMm,
      accessoryWallDepthRangeMm: value.accessoryWallDepthRangeMm ?? null,
      evidenceStatus: "listed-dimensions-retained-separately-from-schematic-plan-marker",
      note: "The plan marker is schematic and not a scaled installed footprint.",
    },
    symbol: { ...SCHEMATIC_SYMBOL, modelCode: value.name },
    ports: [],
    decentralisedSpecification: {
      systemKind: "decentralised-through-wall",
      operatingMode: value.operatingMode,
      controller: value.controller,
      referenceAirflowM3h: value.referenceAirflowM3h ?? null,
      airflowUse: "catalogue-reference-only-excluded-from-project-totals",
      wallOpeningDiameterMm: null,
      wallDepthRangeMm: value.wallDepthRangeMm,
      frontFaceMm: value.frontFaceMm,
      evidenceBoundary: value.evidenceBoundary,
    },
    note: value.evidenceBoundary,
  };
}

function groupByNonEmpty(components, selector) {
  const groups = new Map();
  for (const component of components) {
    const value = selector(component);
    if (value === null) continue;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(component);
  }
  return groups;
}

function issue(code, severity, title, detail, componentId) {
  return { id: `${code}:${componentId}`, code, severity, title, detail, componentId, portId: null, routeId: null, assemblyId: null };
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
