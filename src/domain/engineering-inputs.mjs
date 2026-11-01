export const ENGINEERING_INPUT_VERSION = "mvhr-engineering-inputs.v3";
export const ENGINEERING_MODES = Object.freeze(["low", "normal", "boost"]);

export function createEngineeringInputs() {
  return { version: ENGINEERING_INPUT_VERSION, floorDuties: [], networkDesigns: [] };
}

export function migrateEngineeringInputs(value) {
  if (value?.version === ENGINEERING_INPUT_VERSION) return structuredClone(value);
  if (value?.version === "mvhr-engineering-inputs.v2" && Array.isArray(value.floorDuties) && Array.isArray(value.networkDesigns)) {
    return {
      version: ENGINEERING_INPUT_VERSION,
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
    };
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
    fanCurves: uniqueBy(value.fanCurves, normalizeFanCurve, item => item.stream, "fan curve"),
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
  const fittingKTotal = finite(value.fittingKTotal, "Route fitting K total");
  if (fittingKTotal < 0) throw new RangeError("Route fitting K total must not be negative");
  return {
    routeId: opaqueId(value.routeId, "Route resistance route ID"),
    crossSection: normalizeRouteCrossSection(value.crossSection ?? {
      shape: "circular",
      internalDiameterMm: value.internalDiameterMm,
    }),
    parallelFlowAssumption: oneOf(value.parallelFlowAssumption ?? "not-declared", ["not-declared", "not-applicable", "equal-split-declared"], "Route parallel-flow assumption"),
    routeGeometryFingerprint: nullableBoundedText(value.routeGeometryFingerprint ?? null, "Route geometry fingerprint", 120),
    roughnessMm: nonNegative(value.roughnessMm, "Route roughness"),
    fittingKTotal,
    additionalPressureLoss: normalizePressureInput(value.additionalPressureLoss, "Route additional pressure loss"),
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

export function engineeringRouteFingerprint(route) {
  if (!route || typeof route !== "object") throw new TypeError("Route is required for an engineering fingerprint");
  return revisionFingerprint("route-geometry.v1", {
    id: route.id, ductKind: route.ductKind ?? null, stream: route.stream ?? null, role: route.role ?? null,
    parallelRunCount: route.parallelRunCount ?? null, startAttachment: route.startAttachment ?? null,
    endAttachment: route.endAttachment ?? null, connectionInterface: route.connectionInterface ?? null,
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

function revisionFingerprint(prefix, value) {
  const text = JSON.stringify(value);
  let left = 0x811c9dc5, right = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${prefix}:${left.toString(16).padStart(8, "0")}${right.toString(16).padStart(8, "0")}`;
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
