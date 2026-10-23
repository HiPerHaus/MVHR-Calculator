export const ENGINEERING_INPUT_VERSION = "mvhr-engineering-inputs.v1";

export function createEngineeringInputs() {
  return {
    version: ENGINEERING_INPUT_VERSION,
    floorDuties: [],
  };
}

export function unresolvedExternalStaticPressure(reason = "external static pressure duty not provided") {
  return normalizeExternalStaticPressure({
    state: "unresolved",
    valuePa: null,
    inputValue: null,
    inputUnit: null,
    pressureConvention: null,
    basis: null,
    source: null,
    filterCondition: null,
    reason,
  });
}

export function externalStaticPressureFromInput(valuePa, basis, source, filterCondition) {
  return normalizeExternalStaticPressure({
    state: "known",
    valuePa,
    inputValue: valuePa,
    inputUnit: "Pa",
    pressureConvention: "external-static",
    basis,
    source,
    filterCondition,
    reason: null,
  });
}

export function normalizeEngineeringInputs(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Engineering inputs must be an object");
  }
  if (value.version !== ENGINEERING_INPUT_VERSION) {
    throw new TypeError(`Unsupported engineering-input version: ${String(value.version)}`);
  }
  if (!Array.isArray(value.floorDuties)) {
    throw new TypeError("Engineering floor duties must be an array");
  }
  const floorIds = new Set();
  const floorDuties = value.floorDuties.map((duty) => {
    const normalized = normalizeFloorDuty(duty);
    if (floorIds.has(normalized.floorId)) {
      throw new TypeError(`Engineering inputs repeat floor duty: ${normalized.floorId}`);
    }
    floorIds.add(normalized.floorId);
    return normalized;
  });
  return { version: ENGINEERING_INPUT_VERSION, floorDuties };
}

export function normalizeFloorDuty(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Engineering floor duty must be an object");
  }
  return {
    floorId: opaqueId(value.floorId, "Engineering duty floor ID"),
    mode: oneOf(value.mode, ["normal"], "Engineering duty mode"),
    unitComponentId: value.unitComponentId === null
      ? null
      : opaqueId(value.unitComponentId, "Engineering duty unit component ID"),
    externalStaticPressure: normalizeExternalStaticPressure(value.externalStaticPressure),
  };
}

export function normalizeExternalStaticPressure(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("External static pressure input must be an object");
  }
  const state = oneOf(value.state, ["unresolved", "known"], "External static pressure state");
  if (state === "unresolved") {
    for (const field of ["valuePa", "inputValue", "inputUnit", "pressureConvention", "basis", "source", "filterCondition"]) {
      if (value[field] !== null) {
        throw new TypeError(`Unresolved external static pressure cannot contain ${field}`);
      }
    }
    return {
      state,
      valuePa: null,
      inputValue: null,
      inputUnit: null,
      pressureConvention: null,
      basis: null,
      source: null,
      filterCondition: null,
      reason: boundedText(value.reason, "External static pressure unresolved reason", 240),
    };
  }
  const inputValue = finite(value.inputValue, "External static pressure input");
  if (inputValue < 0) throw new RangeError("External static pressure input must not be negative");
  if (value.inputUnit !== "Pa") throw new TypeError("External static pressure input unit must be Pa");
  if (value.pressureConvention !== "external-static") {
    throw new TypeError("Pressure convention must be external-static");
  }
  if (!Number.isFinite(value.valuePa) || Math.abs(value.valuePa - inputValue) > 1e-9) {
    throw new TypeError("External static pressure canonical Pa value does not match its input");
  }
  if (value.reason !== null && value.reason !== undefined) {
    throw new TypeError("Known external static pressure cannot contain an unresolved reason");
  }
  return {
    state,
    valuePa: inputValue,
    inputValue,
    inputUnit: "Pa",
    pressureConvention: "external-static",
    basis: boundedText(value.basis, "External static pressure basis", 500),
    source: boundedText(value.source, "External static pressure source", 500),
    filterCondition: boundedText(value.filterCondition, "External static pressure filter condition", 240),
    reason: null,
  };
}

function opaqueId(value, label) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 240 || /[\u0000-\u001f]/u.test(value)) {
    throw new TypeError(`${label} must be non-empty bounded text`);
  }
  return value;
}

function boundedText(value, label, maximum) {
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > maximum) {
    throw new TypeError(`${label} must be non-empty text up to ${maximum} characters`);
  }
  return value.trim();
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function oneOf(value, choices, label) {
  if (!choices.includes(value)) throw new TypeError(`${label} is invalid: ${String(value)}`);
  return value;
}
