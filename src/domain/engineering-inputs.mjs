export const ENGINEERING_INPUT_VERSION = "mvhr-engineering-inputs.v4";
export const ENGINEERING_MODES = Object.freeze(["low", "normal", "boost"]);

export function createEngineeringInputs() {
  return { version: ENGINEERING_INPUT_VERSION, floorDuties: [], networkDesigns: [] };
}

export function migrateEngineeringInputs(value) {
  if (value?.version === ENGINEERING_INPUT_VERSION) return structuredClone(value);
  if (value?.version === "mvhr-engineering-inputs.v3" && Array.isArray(value.floorDuties) && Array.isArray(value.networkDesigns)) {
    return {
      version: ENGINEERING_INPUT_VERSION,
      floorDuties: structuredClone(value.floorDuties),
      networkDesigns: value.networkDesigns.map(design => ({
        ...structuredClone(design),
        routeResistanceInputs: design.routeResistanceInputs.map(input => ({
          ...structuredClone(input),
          parallelResistanceModel: input.parallelResistanceModel ?? null,
        })),
        operatingPointModels: structuredClone(design.operatingPointModels ?? []),
      })),
    };
  }
  if (value?.version === "mvhr-engineering-inputs.v2" && Array.isArray(value.floorDuties) && Array.isArray(value.networkDesigns)) {
    return migrateEngineeringInputs({
      version: "mvhr-engineering-inputs.v3",
      floorDuties: structuredClone(value.floorDuties),
      networkDesigns: value.networkDesigns.map(design => ({
        ...structuredClone(design),
        routeResistanceInputs: design.routeResistanceInputs.map(input => ({
          ...structuredClone(input),
          crossSection: input.crossSection ?? { shape: "circular", internalDiameterMm: input.internalDiameterMm },
          routeGeometryFingerprint: input.routeGeometryFingerprint ?? null,
        })),
        componentResistanceInputs: design.componentResistanceInputs.map(input => ({
          ...structuredClone(input),
          passageId: input.passageId ?? null,
          componentConfigurationFingerprint: input.componentConfigurationFingerprint ?? null,
        })),
        fanCurves: design.fanCurves.map(curve => ({
          ...structuredClone(curve),
          unitConfigurationFingerprint: curve.unitConfigurationFingerprint ?? null,
          pressureConvention: curve.pressureConvention ?? null,
          filterCondition: curve.filterCondition ?? null,
        })),
      })),
    });
  }
  if (value?.version === "mvhr-engineering-inputs.v1" && Array.isArray(value.floorDuties)) {
    return { version: ENGINEERING_INPUT_VERSION, floorDuties: structuredClone(value.floorDuties), networkDesigns: [] };
  }
  throw new TypeError(`Unsupported engineering-input version: ${String(value?.version)}`);
}

export function unresolvedExternalStaticPressure(reason = "external static pressure duty not provided") {
  return { ...unresolvedPressureInput(reason), pressureConvention: null, filterCondition: null };
}

export function externalStaticPressureFromInput(valuePa, basis, source, filterCondition) {
  return { ...pressureInputFromPa(valuePa, basis, source), pressureConvention: "external-static", filterCondition: boundedText(filterCondition, "External static pressure filter condition", 240) };
}

export function unresolvedPressureInput(reason = "pressure loss not provided") {
  return normalizePressureInput({ state: "unresolved", valuePa: null, inputValue: null, inputUnit: null, basis: null, source: null, reason }, "Pressure loss");
}

export function pressureInputFromPa(valuePa, basis, source) {
  return normalizePressureInput({ state: "known", valuePa, inputValue: valuePa, inputUnit: "Pa", basis, source, reason: null }, "Pressure loss");
}

export function normalizeEngineeringInputs(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Engineering inputs must be an object");
  if (value.version !== ENGINEERING_INPUT_VERSION) throw new TypeError(`Unsupported engineering-input version: ${String(value.version)}`);
  if (!Array.isArray(value.floorDuties)) throw new TypeError("Engineering floor duties must be an array");
  if (!Array.isArray(value.networkDesigns)) throw new TypeError("Engineering network designs must be an array");
  const floorDuties = uniqueBy(value.floorDuties, normalizeFloorDuty, item => `${item.floorId}\u0000${item.mode}`, "floor duty");
  const networkDesigns = uniqueBy(value.networkDesigns, normalizeNetworkDesign, item => `${item.floorId}\u0000${item.mode}`, "network design");
  return { version: ENGINEERING_INPUT_VERSION, floorDuties, networkDesigns };
}

export function normalizeFloorDuty(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Engineering floor duty must be an object");
  return {
    floorId: opaqueId(value.floorId, "Engineering duty floor ID"),
    mode: oneOf(value.mode, ENGINEERING_MODES, "Engineering duty mode"),
    unitComponentId: value.unitComponentId === null ? null : opaqueId(value.unitComponentId, "Engineering duty unit component ID"),
    externalStaticPressure: normalizeExternalStaticPressure(value.externalStaticPressure),
  };
}

export function normalizeNetworkDesign(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Engineering network design must be an object");
  const terminalAllocations = uniqueBy(value.terminalAllocations, normalizeTerminalAllocation, item => item.id, "terminal allocation");
  uniqueBy(terminalAllocations, item => item, item => `${item.componentId}\u0000${item.portId}`, "terminal endpoint allocation");
  return {
    floorId: opaqueId(value.floorId, "Engineering network floor ID"),
    mode: oneOf(value.mode, ENGINEERING_MODES, "Engineering network mode"),
    basis: boundedText(value.basis, "Engineering network basis", 500),
    source: boundedText(value.source, "Engineering network source", 500),
    sourceVersion: boundedText(value.sourceVersion, "Engineering network source version", 120),
    occupancy: normalizeOccupancy(value.occupancy),
    fluid: normalizeFluidProperties(value.fluid),
    terminalAllocations,
    routeResistanceInputs: uniqueBy(value.routeResistanceInputs, normalizeRouteResistanceInput, item => item.routeId, "route resistance input"),
    componentResistanceInputs: uniqueBy(value.componentResistanceInputs, normalizeComponentResistanceInput, item => `${item.componentId}\u0000${item.passageId ?? ""}`, "component resistance input"),
    fanCurves: uniqueBy(value.fanCurves, normalizeFanCurve, item => `${item.stream}\u0000${item.unitComponentId ?? "unresolved"}`, "fan curve"),
    operatingPointModels: uniqueBy(value.operatingPointModels ?? [], normalizeOperatingPointModel, item => `${item.stream}\u0000${item.unitComponentId}`, "operating-point model"),
  };
}

function normalizeOccupancy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Engineering occupancy input is required");
  const state = oneOf(value.state, ["unresolved", "known"], "Engineering occupancy state");
  if (state === "unresolved") return { state, persons: null, basis: null, source: null, reason: boundedText(value.reason, "Occupancy unresolved reason", 240) };
  const persons = finite(value.persons, "Occupancy persons");
  if (!Number.isInteger(persons) || persons < 0) throw new RangeError("Occupancy persons must be a non-negative integer");
  return { state, persons, basis: boundedText(value.basis, "Occupancy basis", 500), source: boundedText(value.source, "Occupancy source", 500), reason: null };
}

function normalizeFluidProperties(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Engineering fluid properties are required");
  return {
    densityKgM3: positive(value.densityKgM3, "Air density"),
    dynamicViscosityPaS: positive(value.dynamicViscosityPaS, "Air dynamic viscosity"),
    basis: boundedText(value.basis, "Fluid-property basis", 500),
    source: boundedText(value.source, "Fluid-property source", 500),
  };
}

function normalizeTerminalAllocation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Terminal allocation must be an object");
  const inputValue = positive(value.inputValue, "Terminal airflow input");
  const inputUnit = oneOf(value.inputUnit, ["l/s", "m3/h"], "Terminal airflow input unit");
  const valueLps = inputUnit === "l/s" ? inputValue : inputValue / 3.6;
  if (Object.hasOwn(value, "valueLps") && (!Number.isFinite(value.valueLps) || Math.abs(value.valueLps - valueLps) > 1e-9)) throw new TypeError("Terminal airflow canonical L/s value does not match its input");
  return {
    id: opaqueId(value.id, "Terminal allocation ID"),
    componentId: opaqueId(value.componentId, "Terminal allocation component ID"),
    portId: opaqueId(value.portId, "Terminal allocation port ID"),
    spaceKind: oneOf(value.spaceKind, ["room", "zone"], "Terminal allocation space kind"),
    spaceId: opaqueId(value.spaceId, "Terminal allocation space ID"),
    inputValue,
    inputUnit,
    valueLps,
    basis: boundedText(value.basis, "Terminal airflow basis", 500),
    source: boundedText(value.source, "Terminal airflow source", 500),
    terminalPressureLoss: normalizePressureInput(value.terminalPressureLoss, "Terminal pressure loss"),
  };
}

function normalizeRouteResistanceInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Route resistance input must be an object");
  const parallelFlowAssumption = oneOf(value.parallelFlowAssumption ?? "not-declared", ["not-declared", "not-applicable", "equal-split-declared", "unequal-resistance-model"], "Route parallel-flow assumption");
  const parallelResistanceModel = normalizeParallelResistanceModel(value.parallelResistanceModel ?? null);
  if (parallelFlowAssumption === "unequal-resistance-model" && parallelResistanceModel === null) throw new TypeError("Unequal parallel flow requires two evidenced branch resistance curves");
  if (parallelFlowAssumption !== "unequal-resistance-model" && parallelResistanceModel !== null) throw new TypeError("Parallel branch resistance curves require the unequal-resistance-model selection");
  const usesCompleteBranchCurves = parallelFlowAssumption === "unequal-resistance-model";
  const fittingKTotal = usesCompleteBranchCurves ? null : finite(value.fittingKTotal, "Route fitting K total");
  if (fittingKTotal !== null && fittingKTotal < 0) throw new RangeError("Route fitting K total must not be negative");
  return {
    routeId: opaqueId(value.routeId, "Route resistance route ID"),
    crossSection: normalizeRouteCrossSection(value.crossSection ?? {
      shape: "circular",
      internalDiameterMm: value.internalDiameterMm,
    }),
    parallelFlowAssumption,
    parallelResistanceModel,
    routeGeometryFingerprint: nullableBoundedText(value.routeGeometryFingerprint ?? null, "Route geometry fingerprint", 120),
    roughnessMm: usesCompleteBranchCurves ? null : nonNegative(value.roughnessMm, "Route roughness"),
    fittingKTotal,
    additionalPressureLoss: usesCompleteBranchCurves ? null : normalizePressureInput(value.additionalPressureLoss, "Route additional pressure loss"),
    basis: boundedText(value.basis, "Route resistance basis", 500),
    source: boundedText(value.source, "Route resistance source", 500),
  };
}

function normalizeRouteCrossSection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Route internal cross-section input must be an object");
  const shape = oneOf(value.shape, ["circular", "rectangular"], "Route internal cross-section shape");
  if (shape === "circular") return {
    shape,
    internalDiameterMm: positive(value.internalDiameterMm, "Route internal diameter"),
    internalWidthMm: null,
    internalHeightMm: null,
  };
  return {
    shape,
    internalDiameterMm: null,
    internalWidthMm: positive(value.internalWidthMm, "Route internal width"),
    internalHeightMm: positive(value.internalHeightMm, "Route internal height"),
  };
}

function normalizeComponentResistanceInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Component resistance input must be an object");
  return {
    componentId: opaqueId(value.componentId, "Component resistance component ID"),
    passageId: value.passageId === null || value.passageId === undefined ? null : opaqueId(value.passageId, "Component resistance passage ID"),
    componentConfigurationFingerprint: nullableBoundedText(value.componentConfigurationFingerprint ?? null, "Component configuration fingerprint", 120),
    pressureLoss: normalizePressureInput(value.pressureLoss, "Component pressure loss"),
    basis: boundedText(value.basis, "Component resistance basis", 500),
    source: boundedText(value.source, "Component resistance source", 500),
  };
}

function normalizeFanCurve(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Fan curve input is required");
  const state = oneOf(value.state, ["unresolved", "known"], "Fan curve state");
  const stream = oneOf(value.stream, ["supply", "extract"], "Fan curve stream");
  if (state === "unresolved") return { state, stream, unitComponentId: null, unitConfigurationFingerprint: null, pressureConvention: null, filterCondition: null, points: [], basis: null, source: null, sourceVersion: null, reason: boundedText(value.reason, "Fan curve unresolved reason", 240) };
  if (!Array.isArray(value.points) || value.points.length < 2) throw new TypeError("Known fan curve requires at least two points");
  const points = value.points.map(point => ({ airflowM3h: positive(point?.airflowM3h, "Fan-curve airflow"), externalStaticPressurePa: nonNegative(point?.externalStaticPressurePa, "Fan-curve pressure") })).sort((a, b) => a.airflowM3h - b.airflowM3h);
  for (let index = 1; index < points.length; index += 1) if (points[index].airflowM3h <= points[index - 1].airflowM3h) throw new TypeError("Fan-curve airflow points must be unique");
  const pressureConvention = value.pressureConvention === null || value.pressureConvention === undefined ? null : oneOf(value.pressureConvention, ["external-static"], "Fan-curve pressure convention");
  return { state, stream, unitComponentId: opaqueId(value.unitComponentId, "Fan-curve unit component ID"), unitConfigurationFingerprint: nullableBoundedText(value.unitConfigurationFingerprint ?? null, "Fan-curve unit configuration fingerprint", 120), pressureConvention, filterCondition: nullableBoundedText(value.filterCondition ?? null, "Fan-curve filter condition", 240), points, basis: boundedText(value.basis, "Fan-curve basis", 500), source: boundedText(value.source, "Fan-curve source", 500), sourceVersion: boundedText(value.sourceVersion, "Fan-curve source version", 120), reason: null };
}

function normalizeParallelResistanceModel(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Parallel resistance model must be an object or null");
  if (!Array.isArray(value.branches) || value.branches.length !== 2) throw new TypeError("Parallel resistance model requires exactly two physical branch curves");
  const branches = uniqueBy(value.branches, branch => ({
    id: opaqueId(branch?.id, "Parallel branch ID"),
    points: normalizeIncreasingPressurePoints(branch?.points, "Parallel branch curve"),
    basis: boundedText(branch?.basis, "Parallel branch basis", 500),
    source: boundedText(branch?.source, "Parallel branch source", 500),
    sourceVersion: boundedText(branch?.sourceVersion, "Parallel branch source version", 120),
  }), branch => branch.id, "parallel branch");
  return {
    scope: oneOf(value.scope ?? "complete-branch-pressure-loss", ["complete-branch-pressure-loss"], "Parallel resistance model scope"),
    branches,
  };
}

function normalizeOperatingPointModel(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Operating-point model must be an object");
  return {
    stream: oneOf(value.stream, ["supply", "extract"], "Operating-point stream"),
    unitComponentId: opaqueId(value.unitComponentId, "Operating-point unit component ID"),
    unitConfigurationFingerprint: nullableBoundedText(value.unitConfigurationFingerprint ?? null, "Operating-point unit configuration fingerprint", 120),
    networkConfigurationFingerprint: nullableBoundedText(value.networkConfigurationFingerprint ?? null, "Operating-point network configuration fingerprint", 120),
    systemPressurePoints: normalizeIncreasingPressurePoints(value.systemPressurePoints, "System pressure curve"),
    basis: boundedText(value.basis, "Operating-point basis", 500),
    source: boundedText(value.source, "Operating-point source", 500),
    sourceVersion: boundedText(value.sourceVersion, "Operating-point source version", 120),
  };
}

function normalizeIncreasingPressurePoints(value, label) {
  if (!Array.isArray(value) || value.length < 2) throw new TypeError(`${label} requires at least two points`);
  const points = value.map(point => ({
    flowLps: nonNegative(point?.flowLps, `${label} flow`),
    pressureLossPa: nonNegative(point?.pressureLossPa, `${label} pressure loss`),
  })).sort((left, right) => left.flowLps - right.flowLps);
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].flowLps <= points[index - 1].flowLps) throw new TypeError(`${label} flow points must be unique`);
    if (points[index].pressureLossPa <= points[index - 1].pressureLossPa) throw new TypeError(`${label} pressure loss must increase with flow`);
  }
  return points;
}

export function engineeringRouteFingerprint(route) {
  if (!route || typeof route !== "object") throw new TypeError("Route is required for an engineering fingerprint");
  return revisionFingerprint("route-geometry.v1", {
    id: route.id, ductKind: route.ductKind ?? null, stream: route.stream ?? null, role: route.role ?? null,
    parallelRunCount: route.parallelRunCount ?? null, startAttachment: route.startAttachment ?? null,
    endAttachment: route.endAttachment ?? null, connectionInterface: route.connectionInterface ?? null,
    routingElevationMm: route.routingElevationMm ?? null,
    points: route.points ?? [],
  });
}

export function engineeringComponentFingerprint(component) {
  if (!component || typeof component !== "object") throw new TypeError("Component is required for an engineering fingerprint");
  return revisionFingerprint("component-configuration.v1", {
    id: component.id, catalogueItemId: component.catalogueItemId ?? null,
    catalogueRecordVersionId: component.catalogueRecordVersionId ?? null, productId: component.productId ?? null,
    manufacturerArticle: component.catalogueSnapshot?.manufacturerArticle ?? null,
    handing: component.catalogueSnapshot?.handing ?? null, ports: component.ports ?? [],
    engineeringPassages: component.engineeringPassages ?? [],
  });
}

export function engineeringSystemFingerprint(project, floorId, unitComponentId, stream) {
  if (!project || typeof project !== "object") throw new TypeError("Project is required for an engineering system fingerprint");
  const relatedStreams = stream === "supply" ? new Set(["supply", "intake"]) : stream === "extract" ? new Set(["extract", "exhaust"]) : null;
  if (!relatedStreams) throw new TypeError(`Engineering system fingerprint stream is invalid: ${String(stream)}`);
  const components = project.components.filter(component => component.floorId === floorId);
  const componentById = new Map(components.map(component => [component.id, component]));
  const portByEndpoint = new Map(components.flatMap(component => component.ports.map(port => [fingerprintEndpoint(component.id, port.id), port])));
  const adjacency = new Map();
  const addEdge = (left, right, identity) => {
    if (!adjacency.has(left)) adjacency.set(left, []);
    if (!adjacency.has(right)) adjacency.set(right, []);
    adjacency.get(left).push({ to: right, identity });
    adjacency.get(right).push({ to: left, identity });
  };
  for (const route of project.routes.filter(route => route.floorId === floorId && route.system === "mvhr" && relatedStreams.has(route.stream) && route.startAttachment && route.endAttachment)) addEdge(fingerprintEndpoint(route.startAttachment.componentId, route.startAttachment.portId), fingerprintEndpoint(route.endAttachment.componentId, route.endAttachment.portId), `route:${route.id}`);
  for (const connection of project.connections) {
    const left = fingerprintEndpoint(connection.from.componentId, connection.from.portId), right = fingerprintEndpoint(connection.to.componentId, connection.to.portId);
    if (!componentById.has(connection.from.componentId) || !componentById.has(connection.to.componentId) || !relatedStreams.has(portByEndpoint.get(left)?.stream) || !relatedStreams.has(portByEndpoint.get(right)?.stream)) continue;
    addEdge(left, right, `connection:${connection.id}`);
  }
  for (const component of components) for (const passage of component.engineeringPassages ?? []) {
    const left = fingerprintEndpoint(component.id, passage.fromPortId), right = fingerprintEndpoint(component.id, passage.toPortId);
    if (relatedStreams.has(portByEndpoint.get(left)?.stream) && relatedStreams.has(portByEndpoint.get(right)?.stream)) addEdge(left, right, `passage:${component.id}:${passage.id}`);
  }
  const unit = componentById.get(unitComponentId);
  const queue = unit?.ports.filter(port => relatedStreams.has(port.stream)).map(port => fingerprintEndpoint(unit.id, port.id)) ?? [];
  const visited = new Set(), edgeIds = new Set();
  while (queue.length) {
    const endpoint = queue.pop();
    if (visited.has(endpoint)) continue;
    visited.add(endpoint);
    for (const edge of adjacency.get(endpoint) ?? []) { edgeIds.add(edge.identity); if (!visited.has(edge.to)) queue.push(edge.to); }
  }
  const componentIds = new Set([...visited].map(endpoint => JSON.parse(endpoint)[0]));
  componentIds.add(unitComponentId);
  const routeIds = new Set([...edgeIds].filter(id => id.startsWith("route:")).map(id => id.slice(6)));
  const connectionIds = new Set([...edgeIds].filter(id => id.startsWith("connection:")).map(id => id.slice(11)));
  return revisionFingerprint("system-configuration.v1", {
    floorId, unitComponentId, stream,
    components: project.components.filter(component => componentIds.has(component.id)).map(component => ({ id: component.id, fingerprint: engineeringComponentFingerprint(component) })).sort((left, right) => left.id.localeCompare(right.id)),
    routes: project.routes.filter(route => routeIds.has(route.id)).map(route => ({ id: route.id, fingerprint: engineeringRouteFingerprint(route) })).sort((left, right) => left.id.localeCompare(right.id)),
    connections: project.connections.filter(connection => connectionIds.has(connection.id)).map(connection => ({ id: connection.id, from: connection.from, to: connection.to })).sort((left, right) => left.id.localeCompare(right.id)),
  });
}

function fingerprintEndpoint(componentId, portId) { return JSON.stringify([componentId, portId]); }

function revisionFingerprint(prefix, value) {
  const text = JSON.stringify(canonicalFingerprintValue(value));
  let left = 0x811c9dc5, right = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${prefix}:${left.toString(16).padStart(8, "0")}${right.toString(16).padStart(8, "0")}`;
}

function canonicalFingerprintValue(value) {
  if (Array.isArray(value)) return value.map(canonicalFingerprintValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonicalFingerprintValue(value[key])]));
}

export function normalizeExternalStaticPressure(value) {
  const normalized = normalizePressureInput(value, "External static pressure");
  if (normalized.state === "unresolved") {
    for (const field of ["pressureConvention", "filterCondition"]) if (value[field] !== null) throw new TypeError(`Unresolved external static pressure cannot contain ${field}`);
    return { ...normalized, pressureConvention: null, filterCondition: null };
  }
  if (value.pressureConvention !== "external-static") throw new TypeError("Pressure convention must be external-static");
  return { ...normalized, pressureConvention: "external-static", filterCondition: boundedText(value.filterCondition, "External static pressure filter condition", 240) };
}

function normalizePressureInput(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} input must be an object`);
  const state = oneOf(value.state, ["unresolved", "known"], `${label} state`);
  if (state === "unresolved") {
    for (const field of ["valuePa", "inputValue", "inputUnit", "basis", "source"]) if (value[field] !== null) throw new TypeError(`Unresolved ${label.toLowerCase()} cannot contain ${field}`);
    return { state, valuePa: null, inputValue: null, inputUnit: null, basis: null, source: null, reason: boundedText(value.reason, `${label} unresolved reason`, 240) };
  }
  const inputValue = nonNegative(value.inputValue, `${label} input`);
  if (value.inputUnit !== "Pa") throw new TypeError(`${label} input unit must be Pa`);
  if (!Number.isFinite(value.valuePa) || Math.abs(value.valuePa - inputValue) > 1e-9) throw new TypeError(`${label} canonical Pa value does not match its input`);
  if (value.reason !== null && value.reason !== undefined) throw new TypeError(`Known ${label.toLowerCase()} cannot contain an unresolved reason`);
  return { state, valuePa: inputValue, inputValue, inputUnit: "Pa", basis: boundedText(value.basis, `${label} basis`, 500), source: boundedText(value.source, `${label} source`, 500), reason: null };
}

function uniqueBy(values, normalizer, key, label) {
  if (!Array.isArray(values)) throw new TypeError(`Engineering ${label}s must be an array`);
  const seen = new Set();
  return values.map(value => { const normalized = normalizer(value); const identity = key(normalized); if (seen.has(identity)) throw new TypeError(`Engineering inputs repeat ${label}: ${identity}`); seen.add(identity); return normalized; });
}

function opaqueId(value, label) { if (typeof value !== "string" || value.trim().length === 0 || value.length > 240 || /[\u0000-\u001f]/u.test(value)) throw new TypeError(`${label} must be non-empty bounded text`); return value; }
function boundedText(value, label, maximum) { if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > maximum) throw new TypeError(`${label} must be non-empty text up to ${maximum} characters`); return value.trim(); }
function nullableBoundedText(value, label, maximum) { return value === null ? null : boundedText(value, label, maximum); }
function finite(value, label) { if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`); return value; }
function positive(value, label) { const number = finite(value, label); if (number <= 0) throw new RangeError(`${label} must be positive`); return number; }
function nonNegative(value, label) { const number = finite(value, label); if (number < 0) throw new RangeError(`${label} must not be negative`); return number; }
function oneOf(value, choices, label) { if (!choices.includes(value)) throw new TypeError(`${label} is invalid: ${String(value)}`); return value; }
