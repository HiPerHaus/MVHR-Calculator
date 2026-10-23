import { validateProject } from "../domain/spatial.mjs";
import { routeFamilyForKind } from "./component-catalogue.mjs";

const COMMON_INSTALLATION_EVIDENCE = deepFreeze([
  requirement(
    "mating-profile",
    "Verified mating profiles for every component port, duct end and intervening fitting",
  ),
  requirement(
    "adapter-or-sleeve-decision",
    "Manufacturer-backed confirmation of whether an adapter or sleeve is required, plus its exact identity when required",
  ),
  requirement(
    "seal-method",
    "Specified joint seal and retention method for the selected products",
  ),
  requirement(
    "support-method",
    "Specified support method and spacing for the selected installation",
  ),
  requirement(
    "access-clearance",
    "Reviewed access and service-clearance requirements",
  ),
]);

const SYNTHETIC_ASSEMBLY_EVIDENCE = deepFreeze([
  requirement(
    "manufacturer-product-selection",
    "Exact manufacturer product identities for every generic assembly constituent",
  ),
  requirement(
    "internal-joint-compatibility",
    "Manufacturer-backed compatibility for each internal module joint",
  ),
  requirement(
    "acoustic-duty",
    "Attenuator selection against the project acoustic and airflow duty",
  ),
]);

/**
 * Derive installation-evidence records from persisted topology without changing
 * the project or promoting nominal-size agreement to physical compatibility.
 */
export function inspectConnectionAccessoryEvidence(project, floorId) {
  validateProject(project);
  const floor = project.floors.find((candidate) => candidate.id === floorId);
  if (!floor) throw new TypeError(`Connection-evidence floor not found: ${String(floorId)}`);

  const components = project.components.filter((component) => component.floorId === floorId);
  const componentById = new Map(components.map((component) => [component.id, component]));
  const items = [];

  for (const route of project.routes.filter((candidate) => candidate.floorId === floorId)) {
    items.push(inspectRoute(route, componentById));
  }
  for (const connection of project.connections) {
    const fromComponent = componentById.get(connection.from.componentId);
    const toComponent = componentById.get(connection.to.componentId);
    if (!fromComponent || !toComponent) continue;
    items.push(inspectDirectConnection(connection, fromComponent, toComponent));
  }

  items.sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
  const counts = countByStatus(items);
  return deepFreeze({
    floorId,
    floorName: floor.name,
    items,
    summary: {
      inspectedConnectionCount: items.length,
      routeConnectionCount: items.filter((item) => item.kind === "route").length,
      directConnectionCount: items.filter((item) => item.kind === "direct").length,
      installationReadyCount: counts.get("installation-evidence-complete") ?? 0,
      drawingOnlyCount: counts.get("drawing-topology-only") ?? 0,
      syntheticFixtureCount: counts.get("synthetic-fixture-only") ?? 0,
      explicitTransitionCount: counts.get("explicit-transition-required") ?? 0,
      incompleteTopologyCount: counts.get("incomplete-topology") ?? 0,
      unresolvedRequirementCount: items.reduce(
        (total, item) => total + item.accessoryDecision.requiredEvidence.length,
        0,
      ),
    },
    evidenceBoundary: "Nominal size and drawing-class agreement support drafting topology only. No adapter, sleeve, seal, support, clearance, acoustic duty or installed product fit is inferred or quantified.",
  });
}

function inspectRoute(route, componentById) {
  const family = routeFamilyForKind(route.ductKind);
  const endpoints = [
    inspectEndpoint(route.startAttachment, componentById),
    inspectEndpoint(route.endAttachment, componentById),
  ];
  const missingEndpoint = endpoints.some((endpoint) => endpoint === null);
  const interfaces = endpoints.filter(Boolean).map((endpoint) => endpoint.interface);
  const mismatch = interfaces.length === 2 && !interfacesCompatible(interfaces[0], interfaces[1]);
  const synthetic = endpoints.filter(Boolean).every((endpoint) => endpoint.catalogueEvidence.classification === "synthetic-fixture");
  const drawingOnly = [route.connectionInterface, family.connectionInterface, ...interfaces]
    .some((value) => value?.connectionScope === "drawing-only" || value?.installationCompatibilityStatus === "unverified");

  const status = missingEndpoint
    ? "incomplete-topology"
    : mismatch
      ? "explicit-transition-required"
      : drawingOnly
        ? "drawing-topology-only"
        : synthetic
          ? "synthetic-fixture-only"
          : "installation-evidence-incomplete";
  const requiredEvidence = requirementsFor(status, endpoints);
  return connectionItem({
    id: `route:${route.id}`,
    kind: "route",
    label: `${family.name} route ${route.id}`,
    service: serviceLabel(route.stream, route.role),
    status,
    endpoints,
    routeEvidence: {
      ductKind: route.ductKind,
      familyName: family.name,
      interface: cloneOrNull(route.connectionInterface ?? family.connectionInterface),
      connectionScope: route.connectionInterface?.connectionScope ?? family.connectionInterface?.connectionScope ?? null,
      installationCompatibilityStatus: route.connectionInterface?.installationCompatibilityStatus
        ?? family.connectionInterface?.installationCompatibilityStatus
        ?? "unverified",
    },
    verifiedFacts: routeFacts(route, family, endpoints, mismatch),
    requiredEvidence,
  });
}

function inspectDirectConnection(connection, fromComponent, toComponent) {
  const endpoints = [
    inspectEndpoint(connection.from, new Map([[fromComponent.id, fromComponent]])),
    inspectEndpoint(connection.to, new Map([[toComponent.id, toComponent]])),
  ];
  const mismatch = !interfacesCompatible(endpoints[0]?.interface, endpoints[1]?.interface);
  const synthetic = endpoints.every((endpoint) => endpoint?.catalogueEvidence.classification === "synthetic-fixture");
  const status = mismatch
    ? "explicit-transition-required"
    : synthetic
      ? "synthetic-fixture-only"
      : "installation-evidence-incomplete";
  return connectionItem({
    id: `connection:${connection.id}`,
    kind: "direct",
    label: `Direct connection ${connection.id}`,
    service: serviceLabel(endpoints[0]?.stream, endpoints[0]?.role),
    status,
    endpoints,
    routeEvidence: null,
    verifiedFacts: directFacts(connection, endpoints, mismatch),
    requiredEvidence: requirementsFor(status, endpoints),
  });
}

function connectionItem(value) {
  return {
    ...value,
    installationStatus: value.status === "explicit-transition-required"
      ? "blocked-pending-explicit-transition"
      : value.status === "incomplete-topology"
        ? "blocked-pending-complete-topology"
        : "unverified",
    accessoryDecision: {
      selectionStatus: "not-selected-evidence-incomplete",
      inferredItems: [],
      inferredQuantity: null,
      requiredEvidence: uniqueRequirements(value.requiredEvidence),
    },
  };
}

function inspectEndpoint(attachment, componentById) {
  if (!attachment) return null;
  const component = componentById.get(attachment.componentId);
  const port = component?.ports.find((candidate) => candidate.id === attachment.portId);
  if (!component || !port) return null;
  return {
    componentId: component.id,
    componentName: component.displayName ?? component.id,
    portId: port.id,
    stream: port.stream,
    role: port.role,
    interface: cloneOrNull(port.interface),
    catalogueEvidence: placedCatalogueEvidence(component),
  };
}

function placedCatalogueEvidence(component) {
  const snapshot = component.catalogueSnapshot ?? null;
  const sourceRecords = collectSourceRecords(snapshot?.source ?? null)
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  const classification = component.catalogueStatus === "synthetic-not-manufacturer-verified"
    ? "synthetic-fixture"
    : component.catalogueStatus?.startsWith("source-backed-")
      || component.catalogueStatus?.startsWith("verified-dimensional-")
      ? "source-backed-provisional"
      : "unclassified";
  return {
    classification,
    catalogueId: snapshot?.catalogueId ?? null,
    catalogueVersion: snapshot?.catalogueVersion ?? null,
    recordId: snapshot?.recordId ?? component.catalogueItemId ?? null,
    recordVersionId: snapshot?.recordVersionId ?? component.catalogueRecordVersionId ?? null,
    productId: snapshot?.productId ?? component.productId ?? null,
    manufacturer: snapshot?.manufacturer ?? component.manufacturer ?? null,
    manufacturerArticle: snapshot?.manufacturerArticle ?? snapshot?.manufacturerArticleCandidate ?? null,
    localSkuCrosswalkStatus: snapshot?.localSkuCrosswalkStatus ?? null,
    handing: snapshot?.handing ?? null,
    sourceRecords,
    knownDimensions: summarizeKnownDimensions(snapshot?.dimensions ?? null),
    connectionSetout: cloneOrNull(snapshot?.connectionSetout),
  };
}

function collectSourceRecords(source) {
  if (!source || typeof source !== "object") return [];
  if (typeof source.sourceId === "string") {
    return [{
      sourceId: source.sourceId,
      sourceKind: source.sourceKind ?? null,
      title: source.title ?? null,
      page: source.page ?? null,
      pages: Array.isArray(source.pages) ? [...source.pages] : null,
      releaseDate: source.releaseDate ?? null,
      verificationStatus: source.verificationStatus ?? null,
    }];
  }
  return Object.values(source).flatMap(collectSourceRecords);
}

function summarizeKnownDimensions(dimensions) {
  if (!dimensions || dimensions.unit !== "mm") return null;
  const body = dimensions.body ?? null;
  const drawingEnvelope = dimensions.drawingEnvelope ?? null;
  return {
    unit: "mm",
    body: body ? {
      width: finiteOrNull(body.width),
      depth: finiteOrNull(body.depth),
      height: finiteOrNull(body.height),
    } : null,
    drawingEnvelope: drawingEnvelope ? {
      width: finiteOrNull(drawingEnvelope.width),
      depth: finiteOrNull(drawingEnvelope.depth),
    } : null,
    evidenceStatus: dimensions.evidenceStatus ?? null,
  };
}

function routeFacts(route, family, endpoints, mismatch) {
  const facts = [
    `Persisted ${serviceLabel(route.stream, route.role)} route using ${family.name}`,
  ];
  if (route.connectionInterface?.nominalSizeMm !== null && route.connectionInterface?.nominalSizeMm !== undefined) {
    facts.push(`Route nominal size DN${route.connectionInterface.nominalSizeMm}`);
  }
  const classes = endpoints.filter(Boolean).map((endpoint) => endpoint.interface?.drawingConnectionClass).filter(Boolean);
  if (classes.length === 2 && classes[0] === classes[1]) {
    facts.push(`Both endpoints share drawing connection class ${classes[0]}`);
  }
  if (!mismatch && endpoints.every(Boolean)) facts.push("Typed endpoint family and nominal size agree for drawing topology");
  for (const endpoint of endpoints.filter(Boolean)) {
    const setout = endpoint.catalogueEvidence.connectionSetout;
    if (setout?.nominalInternalDiameterMm && setout?.externalDiameterMm) {
      facts.push(`${endpoint.componentName} connection setout records ${setout.nominalInternalDiameterMm} mm inside and ${setout.externalDiameterMm} mm outside diameter`);
    }
  }
  return [...new Set(facts)];
}

function directFacts(connection, endpoints, mismatch) {
  const facts = [
    `Persisted direct connection ${connection.id}`,
    ...(connection.evidence ? [`Saved evidence note: ${connection.evidence}`] : []),
  ];
  if (!mismatch && endpoints.every(Boolean)) facts.push("Typed endpoint family and nominal size agree for drawing topology");
  return facts;
}

function requirementsFor(status, endpoints) {
  if (status === "incomplete-topology") {
    return [requirement("complete-topology", "Attach both route ends to typed component ports before installation evidence can be reviewed")];
  }
  if (status === "explicit-transition-required") {
    return [
      requirement("explicit-transition", "Select and model an exact compatible adapter or correct the endpoint interfaces"),
      ...COMMON_INSTALLATION_EVIDENCE,
    ];
  }
  const result = [...COMMON_INSTALLATION_EVIDENCE];
  if (status === "synthetic-fixture-only") result.unshift(...SYNTHETIC_ASSEMBLY_EVIDENCE);
  if (endpoints.some((endpoint) => endpoint?.catalogueEvidence.connectionSetout?.connectorOrientation)) {
    result.push(requirement(
      "field-connector-configuration",
      "Confirm the selected unit connector orientation and field configuration before installation",
    ));
  }
  if (endpoints.some((endpoint) => endpoint?.catalogueEvidence.classification === "source-backed-provisional")) {
    result.push(requirement(
      "local-product-crosswalk",
      "Verify the local product code, manufacturer article and selected variant crosswalk",
    ));
  }
  return result;
}

function interfacesCompatible(left, right) {
  if (!left || !right) return true;
  if (left.family !== right.family) {
    const drawingClassMatch = left.drawingConnectionClass
      && left.drawingConnectionClass === right.drawingConnectionClass;
    if (!drawingClassMatch) return false;
  }
  if (left.nominalSizeMm === null || left.nominalSizeMm === undefined) return true;
  if (right.nominalSizeMm === null || right.nominalSizeMm === undefined) return true;
  return left.nominalSizeMm === right.nominalSizeMm;
}

function uniqueRequirements(items) {
  const byCode = new Map();
  for (const item of items) byCode.set(item.code, item);
  return [...byCode.values()];
}

function countByStatus(items) {
  const counts = new Map();
  for (const item of items) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
  return counts;
}

function serviceLabel(stream, role) {
  return [role, stream].filter(Boolean).join(" · ") || "service pending";
}

function requirement(code, label) {
  return { code, label };
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function cloneOrNull(value) {
  return value === null || value === undefined ? null : structuredClone(value);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
