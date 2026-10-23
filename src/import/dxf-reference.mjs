/**
 * Bounded, dependency-free ASCII DXF reference adapter.
 *
 * This is deliberately not a general CAD parser. It accepts one declared
 * synthetic-fixture dialect (ASCII AC1015) and produces read-only reference
 * geometry. It never creates walls, rooms, connections, quantities, products,
 * approvals, or any other authoritative project object.
 */

export const DXF_IMPORTER = Object.freeze({
  id: "hiper-ascii-dxf-foundation",
  version: "0.1.0",
});
export const SUPPORTED_DXF_VERSIONS = Object.freeze(["AC1015"]);
export const SUPPORTED_DXF_ENTITIES = Object.freeze([
  "LINE",
  "LWPOLYLINE",
  "ARC",
  "CIRCLE",
  "TEXT",
  "INSERT",
]);
export const MAX_DXF_TEXT_BYTES = 4 * 1024 * 1024;
export const MAX_DXF_REFERENCE_ASSETS = 4;
export const MAX_TOTAL_DXF_REFERENCE_BYTES = 12 * 1024 * 1024;
export const MAX_DXF_GROUP_PAIRS = 250000;
export const MAX_DXF_SOURCE_ENTITIES = 50000;
export const MAX_DXF_EXPANDED_ENTITIES = 100000;
export const MAX_DXF_EXPANSION_VISITS = 200000;
export const MAX_DXF_VERTICES = 250000;
export const MAX_DXF_BLOCK_DEPTH = 8;
export const MAX_DXF_DIAGNOSTICS = 2000;
export const MAX_DXF_ABS_SOURCE_COORDINATE = 1e12;

const EPSILON = 1e-10;
const TWO_PI = Math.PI * 2;
const UNIT_CHOICES = Object.freeze({
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  ft: 304.8,
});
const DECLARED_UNITS = Object.freeze({
  1: { unit: "in", mmPerSourceUnit: UNIT_CHOICES.in },
  2: { unit: "ft", mmPerSourceUnit: UNIT_CHOICES.ft },
  4: { unit: "mm", mmPerSourceUnit: UNIT_CHOICES.mm },
  5: { unit: "cm", mmPerSourceUnit: UNIT_CHOICES.cm },
  6: { unit: "m", mmPerSourceUnit: UNIT_CHOICES.m },
});

export async function inspectAsciiDxf(sourceText, options = {}) {
  if (typeof sourceText !== "string") throw new TypeError("DXF source must be text");
  const fileName = requireText(options.fileName, "DXF filename", 255);
  if (sourceText.length > MAX_DXF_TEXT_BYTES) {
    throw new RangeError(`DXF source exceeds the ${MAX_DXF_TEXT_BYTES}-byte prototype limit`);
  }
  if (sourceText.includes("\0") || sourceText.startsWith("AutoCAD Binary DXF")) {
    throw new TypeError("Only plain-text ASCII DXF is accepted by this adapter");
  }
  for (let index = 0; index < sourceText.length; index += 1) {
    if (sourceText.charCodeAt(index) > 0x7f) {
      throw new TypeError("This bounded adapter accepts 7-bit ASCII DXF only; codepage text requires a later adapter");
    }
  }
  const sourceBytes = new TextEncoder().encode(sourceText);
  if (sourceBytes.byteLength < 1) throw new TypeError("DXF source is empty");
  if (sourceBytes.byteLength > MAX_DXF_TEXT_BYTES) {
    throw new RangeError(`DXF source exceeds the ${MAX_DXF_TEXT_BYTES}-byte prototype limit`);
  }
  const pairs = parseGroupPairs(sourceText);
  const diagnostics = [];
  const sections = collectSections(pairs, diagnostics);
  const header = inspectHeader(sections.get("HEADER") ?? [], diagnostics);
  const layers = inspectLayers(sections.get("TABLES") ?? [], diagnostics);
  const blocks = inspectBlocks(sections.get("BLOCKS") ?? [], diagnostics);
  if (diagnostics.length > MAX_DXF_DIAGNOSTICS) {
    throw new RangeError(`DXF exceeds the ${MAX_DXF_DIAGNOSTICS}-diagnostic prototype limit`);
  }
  const entityRecords = splitEntityRecords(sections.get("ENTITIES") ?? []);
  if (!sections.has("ENTITIES")) {
    diagnostics.push(diagnostic("error", "missing-entities-section", "DXF has no ENTITIES section"));
  }
  const sourceEntityCount = entityRecords.length + [...blocks.values()].reduce(
    (total, block) => total + block.entities.length,
    0,
  );
  if (sourceEntityCount > MAX_DXF_SOURCE_ENTITIES) {
    throw new RangeError(`DXF exceeds the ${MAX_DXF_SOURCE_ENTITIES}-entity prototype limit`);
  }
  const state = {
    blocks,
    diagnostics,
    expandedCount: 0,
    expansionVisits: 0,
    vertexCount: 0,
    sourceIndex: 0,
    omittedCount: 0,
  };
  const geometry = [];
  for (const record of entityRecords) {
    expandRecord(record, identityAffine(), [], null, 0, state, geometry);
  }
  const sourceBoundsUnits = geometryBounds(geometry);
  const layerMap = new Map(layers.map((layer) => [layer.name, { ...layer, entityCount: 0 }]));
  for (const item of geometry) {
    if (!layerMap.has(item.layer)) {
      layerMap.set(item.layer, {
        name: item.layer,
        flags: 0,
        colorIndex: null,
        entityCount: 0,
        declaredInTable: false,
      });
      pushDiagnostic(state, diagnostic(
        "warning",
        "undeclared-layer",
        `Geometry uses layer not declared in the LAYER table: ${item.layer}`,
        item,
      ));
    }
    layerMap.get(item.layer).entityCount += 1;
  }
  const finalLayers = [...layerMap.values()].sort((left, right) => compareText(left.name, right.name));
  const unsupportedVersion = !SUPPORTED_DXF_VERSIONS.includes(header.version);
  if (unsupportedVersion) {
    diagnostics.unshift(diagnostic(
      "error",
      "unsupported-dxf-version",
      header.version === null
        ? "DXF $ACADVER is missing"
        : `DXF version ${header.version} is not in the bounded ${SUPPORTED_DXF_VERSIONS.join(", ")} fixture dialect`,
    ));
  }
  if (diagnostics.length > MAX_DXF_DIAGNOSTICS) {
    throw new RangeError(`DXF exceeds the ${MAX_DXF_DIAGNOSTICS}-diagnostic prototype limit`);
  }
  const sha256 = await sha256Hex(sourceBytes);
  const blockingDiagnosticCount = diagnostics.filter((item) => item.severity === "error" && (
    item.code === "unsupported-dxf-version" ||
    item.code === "ambiguous-version" ||
    item.code === "missing-entities-section"
  )).length;
  return deepFreeze({
    kind: "dxf-import-candidate",
    source: {
      fileName,
      format: "dxf",
      encoding: "utf-8",
      byteLength: sourceBytes.byteLength,
      sha256,
      sourceText,
    },
    importer: { ...DXF_IMPORTER },
    dxfVersion: header.version,
    declaredUnits: header.units,
    requiresUnitChoice: header.units.status !== "declared-supported",
    layers: finalLayers,
    geometry,
    sourceBoundsUnits,
    counts: {
      groupPairs: pairs.length,
      sourceEntities: sourceEntityCount,
      expandedEntities: geometry.length,
      vertices: state.vertexCount,
      omittedEntities: state.omittedCount,
      diagnostics: diagnostics.length,
    },
    diagnostics,
    blockingDiagnosticCount,
    partialAcceptanceRequired: state.omittedCount > 0 || diagnostics.some((item) => (
      item.severity === "error" && ![
        "unsupported-dxf-version",
        "ambiguous-version",
        "missing-entities-section",
      ].includes(item.code)
    )),
  });
}

export function createDxfReferenceRecords(candidate, settings) {
  validateCandidate(candidate);
  if (!settings || typeof settings !== "object") throw new TypeError("DXF acceptance settings are required");
  if (candidate.blockingDiagnosticCount > 0) {
    throw new TypeError("DXF candidate has blocking diagnostics and cannot be accepted");
  }
  if (candidate.partialAcceptanceRequired && settings.acceptPartial !== true) {
    throw new TypeError("DXF omissions require an explicit partial-import acceptance");
  }
  const includedLayers = normalizeIncludedLayers(settings.includedLayers, candidate.layers);
  const units = resolveUnits(candidate.declaredUnits, settings.unitChoice);
  const transform = normalizeReferenceTransform(settings.transform);
  const asset = {
    id: requireId(settings.assetId, "CAD reference asset ID"),
    kind: "cad-reference",
    format: "dxf",
    mediaType: "application/dxf",
    fileName: candidate.source.fileName,
    encoding: candidate.source.encoding,
    byteLength: candidate.source.byteLength,
    sha256: candidate.source.sha256,
    sourceText: candidate.source.sourceText,
    dxfVersion: candidate.dxfVersion,
    importer: structuredClone(candidate.importer),
    declaredUnits: structuredClone(candidate.declaredUnits),
    layers: structuredClone(candidate.layers),
    geometry: structuredClone(candidate.geometry),
    sourceBoundsUnits: structuredClone(candidate.sourceBoundsUnits),
    counts: structuredClone(candidate.counts),
    diagnostics: structuredClone(candidate.diagnostics),
    partialImportAccepted: candidate.partialAcceptanceRequired,
  };
  asset.derivedFingerprint = dxfAssetDerivedFingerprint(asset);
  const reference = {
    id: requireId(settings.referenceId, "Floor CAD reference ID"),
    floorId: requireId(settings.floorId, "Floor CAD reference floor ID"),
    assetId: asset.id,
    visible: settings.visible ?? true,
    locked: true,
    opacity: settings.opacity ?? 0.55,
    includedLayers,
    units,
    transform,
  };
  validateDxfAsset(asset);
  validateFloorDxfReference(reference, asset);
  return deepFreeze({ asset, reference });
}

export function validateDxfAsset(asset) {
  requireId(asset?.id, "CAD reference asset ID");
  if (asset.kind !== "cad-reference" || asset.format !== "dxf") {
    throw new TypeError("CAD reference asset must be a DXF reference");
  }
  if (asset.mediaType !== "application/dxf" || asset.encoding !== "utf-8") {
    throw new TypeError("DXF source media type and encoding are unsupported");
  }
  requireText(asset.fileName, "DXF filename", 255);
  requireText(asset.sourceText, "DXF source text", MAX_DXF_TEXT_BYTES);
  const byteLength = new TextEncoder().encode(asset.sourceText).byteLength;
  if (!Number.isInteger(asset.byteLength) || asset.byteLength !== byteLength) {
    throw new TypeError("DXF source byte-length claim must match the preserved source text");
  }
  if (byteLength > MAX_DXF_TEXT_BYTES) throw new RangeError("DXF source exceeds the prototype limit");
  if (!/^[a-f0-9]{64}$/.test(asset.sha256)) throw new TypeError("DXF SHA-256 must be lowercase hexadecimal");
  if (!/^fnv1a32-[a-f0-9]{8}$/.test(asset.derivedFingerprint)) {
    throw new TypeError("DXF derived-data fingerprint is invalid");
  }
  if (!SUPPORTED_DXF_VERSIONS.includes(asset.dxfVersion)) throw new TypeError("Persisted DXF version is unsupported");
  if (asset.importer?.id !== DXF_IMPORTER.id || asset.importer?.version !== DXF_IMPORTER.version) {
    throw new TypeError("Persisted DXF importer identity/version is unsupported");
  }
  validateDeclaredUnits(asset.declaredUnits);
  if (!Array.isArray(asset.layers) || !Array.isArray(asset.geometry) || !Array.isArray(asset.diagnostics)) {
    throw new TypeError("DXF layers, geometry and diagnostics must be arrays");
  }
  assertUnique(asset.layers.map((layer) => requireLayerName(layer?.name)), "DXF layer names");
  if (asset.geometry.length > MAX_DXF_EXPANDED_ENTITIES) throw new RangeError("DXF geometry exceeds the prototype limit");
  if (asset.diagnostics.length > MAX_DXF_DIAGNOSTICS) throw new RangeError("DXF diagnostics exceed the prototype limit");
  for (const item of asset.diagnostics) validateDiagnostic(item);
  for (const item of asset.geometry) validateGeometryItem(item);
  const computedBounds = geometryBounds(asset.geometry);
  if (!boundsEqual(computedBounds, asset.sourceBoundsUnits)) {
    throw new TypeError("DXF source bounds must agree with preserved geometry");
  }
  if (!asset.counts || asset.counts.expandedEntities !== asset.geometry.length) {
    throw new TypeError("DXF entity counts must agree with preserved geometry");
  }
  for (const field of ["groupPairs", "sourceEntities", "expandedEntities", "vertices", "omittedEntities", "diagnostics"]) {
    if (!Number.isInteger(asset.counts[field]) || asset.counts[field] < 0) {
      throw new TypeError(`DXF count is invalid: ${field}`);
    }
  }
  if (
    asset.counts.groupPairs > MAX_DXF_GROUP_PAIRS ||
    asset.counts.sourceEntities > MAX_DXF_SOURCE_ENTITIES ||
    asset.counts.expandedEntities > MAX_DXF_EXPANDED_ENTITIES ||
    asset.counts.vertices > MAX_DXF_VERTICES ||
    asset.counts.diagnostics !== asset.diagnostics.length
  ) {
    throw new RangeError("DXF persisted counts exceed or disagree with prototype limits");
  }
  if (typeof asset.partialImportAccepted !== "boolean") {
    throw new TypeError("DXF partial-import acceptance state is required");
  }
  if (dxfAssetDerivedFingerprint(asset) !== asset.derivedFingerprint) {
    throw new TypeError("DXF derived geometry/provenance fingerprint mismatch");
  }
  return structuredClone(asset);
}

export function dxfAssetDerivedFingerprint(asset) {
  const payload = {
    byteLength: asset.byteLength,
    counts: asset.counts,
    declaredUnits: asset.declaredUnits,
    diagnostics: asset.diagnostics,
    dxfVersion: asset.dxfVersion,
    encoding: asset.encoding,
    fileName: asset.fileName,
    format: asset.format,
    geometry: asset.geometry,
    importer: asset.importer,
    layers: asset.layers,
    mediaType: asset.mediaType,
    partialImportAccepted: asset.partialImportAccepted,
    sha256: asset.sha256,
    sourceBoundsUnits: asset.sourceBoundsUnits,
    sourceText: asset.sourceText,
  };
  return fnv1a32(stableStringify(payload));
}

export function validateFloorDxfReference(reference, asset) {
  requireId(reference?.id, "Floor CAD reference ID");
  requireId(reference?.floorId, "Floor CAD reference floor ID");
  requireId(reference?.assetId, "Floor CAD reference asset ID");
  if (asset && reference.assetId !== asset.id) throw new TypeError("Floor CAD reference asset identity does not match");
  if (typeof reference.visible !== "boolean" || reference.locked !== true) {
    throw new TypeError("CAD references require boolean visibility and a locked layer");
  }
  if (!Number.isFinite(reference.opacity) || reference.opacity < 0 || reference.opacity > 1) {
    throw new RangeError("CAD reference opacity must be between 0 and 1");
  }
  const availableLayers = asset?.layers ?? [];
  normalizeIncludedLayers(reference.includedLayers, availableLayers);
  validateResolvedUnits(reference.units);
  normalizeReferenceTransform(reference.transform);
  return structuredClone(reference);
}

export function transformDxfReferenceGeometry(asset, reference) {
  validateDxfAsset(asset);
  validateFloorDxfReference(reference, asset);
  const included = new Set(reference.includedLayers);
  const factor = reference.units.mmPerSourceUnit;
  const rotation = reference.transform.rotationRad;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const origin = reference.transform.localOriginSource;
  const translation = reference.transform.translationMm;
  const point = (source) => {
    const x = (source.x - origin.x) * factor;
    const y = (source.y - origin.y) * factor;
    const transformed = {
      x: translation.x + x * cosine - y * sine,
      y: translation.y + x * sine + y * cosine,
    };
    assertFiniteCoordinate(transformed.x, "Transformed DXF x", 1e15);
    assertFiniteCoordinate(transformed.y, "Transformed DXF y", 1e15);
    return transformed;
  };
  const geometry = asset.geometry.filter((item) => included.has(item.layer)).map((item) => {
    const common = {
      id: item.id,
      kind: item.kind,
      layer: item.layer,
      sourceEntityType: item.sourceEntityType,
      sourceHandle: item.sourceHandle,
      sourceLine: item.sourceLine,
      instancePath: structuredClone(item.instancePath),
      coordinateUnit: "mm",
    };
    if (item.kind === "line") return { ...common, start: point(item.start), end: point(item.end) };
    if (item.kind === "lwpolyline") {
      return {
        ...common,
        closed: item.closed,
        vertices: item.vertices.map((vertex) => ({ ...point(vertex), bulge: vertex.bulge })),
      };
    }
    if (item.kind === "arc") {
      return {
        ...common,
        center: point(item.center),
        radiusMm: item.radius * factor,
        startAngleRad: normalizeAngle(item.startAngleRad + rotation),
        endAngleRad: normalizeAngle(item.endAngleRad + rotation),
        counterClockwise: true,
      };
    }
    if (item.kind === "circle") {
      return { ...common, center: point(item.center), radiusMm: item.radius * factor };
    }
    return {
      ...common,
      insertion: point(item.insertion),
      heightMm: item.height * factor,
      rotationRad: normalizeAngle(item.rotationRad + rotation),
      text: item.text,
      styleName: item.styleName,
    };
  });
  return deepFreeze({
    referenceId: reference.id,
    assetId: asset.id,
    coordinateUnit: "mm",
    geometry,
    boundsMm: geometryBounds(geometry, true),
  });
}

export function dxfReferenceSnapPoints(asset, reference) {
  const transformed = transformDxfReferenceGeometry(asset, reference);
  const points = [];
  const add = (item, snapKind, point) => {
    points.push({
      referenceId: reference.id,
      assetId: asset.id,
      geometryId: item.id,
      layer: item.layer,
      sourceHandle: item.sourceHandle,
      snapKind,
      point: { x: point.x, y: point.y },
    });
  };
  for (const item of transformed.geometry) {
    if (item.kind === "line") {
      add(item, "endpoint", item.start);
      add(item, "endpoint", item.end);
    } else if (item.kind === "lwpolyline") {
      for (const vertex of item.vertices) add(item, "vertex", vertex);
    } else if (item.kind === "circle") {
      add(item, "center", item.center);
    } else if (item.kind === "arc") {
      add(item, "center", item.center);
      add(item, "endpoint", {
        x: item.center.x + item.radiusMm * Math.cos(item.startAngleRad),
        y: item.center.y + item.radiusMm * Math.sin(item.startAngleRad),
      });
      add(item, "endpoint", {
        x: item.center.x + item.radiusMm * Math.cos(item.endAngleRad),
        y: item.center.y + item.radiusMm * Math.sin(item.endAngleRad),
      });
    } else if (item.kind === "text") {
      add(item, "insertion", item.insertion);
    }
  }
  const unique = new Map();
  for (const snap of points) {
    const key = `${snap.geometryId}\u0000${snap.snapKind}\u0000${snap.point.x}\u0000${snap.point.y}`;
    if (!unique.has(key)) unique.set(key, snap);
  }
  return deepFreeze([...unique.values()]);
}

export function geometryBounds(geometry, millimetreGeometry = false) {
  if (!Array.isArray(geometry) || geometry.length === 0) return null;
  const bounds = [];
  for (const item of geometry) {
    if (item.kind === "line") bounds.push(pointsBounds([item.start, item.end]));
    else if (item.kind === "lwpolyline") bounds.push(polylineBounds(item));
    else if (item.kind === "circle") {
      const radius = millimetreGeometry ? item.radiusMm : item.radius;
      bounds.push({
        minX: item.center.x - radius,
        minY: item.center.y - radius,
        maxX: item.center.x + radius,
        maxY: item.center.y + radius,
      });
    } else if (item.kind === "arc") {
      const radius = millimetreGeometry ? item.radiusMm : item.radius;
      bounds.push(arcBounds(item.center, radius, item.startAngleRad, item.endAngleRad));
    } else if (item.kind === "text") {
      const height = millimetreGeometry ? item.heightMm : item.height;
      bounds.push(textBounds(item.insertion, height, item.rotationRad, item.text));
    }
  }
  return mergeBounds(bounds);
}

function parseGroupPairs(sourceText) {
  const normalized = sourceText.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length % 2 !== 0) throw new TypeError("DXF group-code/value lines must occur in pairs");
  if (lines.length / 2 > MAX_DXF_GROUP_PAIRS) {
    throw new RangeError(`DXF exceeds the ${MAX_DXF_GROUP_PAIRS}-group-pair prototype limit`);
  }
  const pairs = [];
  for (let index = 0; index < lines.length; index += 2) {
    const codeText = lines[index].trim();
    if (!/^-?\d+$/.test(codeText)) throw new TypeError(`Invalid DXF group code at line ${index + 1}`);
    const code = Number.parseInt(codeText, 10);
    if (code < -5 || code > 1071) throw new RangeError(`DXF group code is out of range at line ${index + 1}`);
    pairs.push({ code, value: lines[index + 1].trimEnd(), line: index + 1 });
  }
  return pairs;
}

function collectSections(pairs, diagnostics) {
  const sections = new Map();
  let sawEof = false;
  for (let index = 0; index < pairs.length;) {
    const pair = pairs[index];
    if (pair.code === 0 && upper(pair.value) === "EOF") {
      sawEof = true;
      index += 1;
      continue;
    }
    if (pair.code !== 0 || upper(pair.value) !== "SECTION") {
      index += 1;
      continue;
    }
    const namePair = pairs[index + 1];
    if (namePair?.code !== 2) throw new TypeError(`DXF SECTION at line ${pair.line} is missing its name`);
    const name = upper(namePair.value);
    if (sections.has(name)) throw new TypeError(`DXF section is duplicated: ${name}`);
    const start = index + 2;
    let end = start;
    while (end < pairs.length && !(pairs[end].code === 0 && upper(pairs[end].value) === "ENDSEC")) end += 1;
    if (end === pairs.length) throw new TypeError(`DXF section is not terminated: ${name}`);
    sections.set(name, pairs.slice(start, end));
    index = end + 1;
  }
  if (!sawEof) diagnostics.push(diagnostic("warning", "missing-eof", "DXF has no explicit EOF marker"));
  return sections;
}

function inspectHeader(pairs, diagnostics) {
  const variables = new Map();
  for (let index = 0; index < pairs.length; index += 1) {
    if (pairs[index].code !== 9) continue;
    const name = upper(pairs[index].value);
    const values = [];
    for (index += 1; index < pairs.length && pairs[index].code !== 9; index += 1) values.push(pairs[index]);
    index -= 1;
    if (!variables.has(name)) variables.set(name, []);
    variables.get(name).push(values);
  }
  const versions = (variables.get("$ACADVER") ?? []).map((values) => firstValue(values, 1)).filter(Boolean);
  if (new Set(versions).size > 1) diagnostics.push(diagnostic("error", "ambiguous-version", "DXF declares conflicting $ACADVER values"));
  const version = versions[0] ?? null;
  const unitCodes = (variables.get("$INSUNITS") ?? []).map((values) => {
    const value = firstValue(values, 70);
    return value === null ? null : strictInteger(value, "$INSUNITS");
  }).filter((value) => value !== null);
  let units;
  if (new Set(unitCodes).size > 1) {
    units = { status: "ambiguous", code: null, unit: null, mmPerSourceUnit: null };
    diagnostics.push(diagnostic("warning", "ambiguous-units", "DXF declares conflicting $INSUNITS values; a user unit choice is required"));
  } else {
    const code = unitCodes[0] ?? null;
    const declared = code === null ? null : DECLARED_UNITS[code];
    if (declared) units = { status: "declared-supported", code, ...declared };
    else {
      units = { status: code === null ? "missing" : code === 0 ? "unitless" : "unsupported", code, unit: null, mmPerSourceUnit: null };
      diagnostics.push(diagnostic(
        "warning",
        "units-choice-required",
        code === null
          ? "DXF $INSUNITS is missing; a user unit choice is required"
          : `DXF $INSUNITS code ${code} is not accepted automatically; a user unit choice is required`,
      ));
    }
  }
  return { version, units };
}

function inspectLayers(pairs, diagnostics) {
  const layers = [];
  const names = new Set();
  let inLayerTable = false;
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];
    if (pair.code === 0 && upper(pair.value) === "TABLE" && pairs[index + 1]?.code === 2) {
      inLayerTable = upper(pairs[index + 1].value) === "LAYER";
      index += 1;
      continue;
    }
    if (pair.code === 0 && upper(pair.value) === "ENDTAB") {
      inLayerTable = false;
      continue;
    }
    if (!inLayerTable || pair.code !== 0 || upper(pair.value) !== "LAYER") continue;
    const end = nextZeroIndex(pairs, index + 1);
    const record = pairs.slice(index, end);
    const name = requireLayerName(firstValue(record, 2));
    if (names.has(name)) diagnostics.push(diagnostic("warning", "duplicate-layer", `DXF layer table repeats ${name}`, { sourceLine: pair.line }));
    else {
      names.add(name);
      const colorRaw = firstValue(record, 62);
      layers.push({
        name,
        flags: optionalInteger(record, 70, 0, "Layer flags"),
        colorIndex: colorRaw === null ? null : strictInteger(colorRaw, "Layer color index"),
        entityCount: 0,
        declaredInTable: true,
      });
    }
    index = end - 1;
  }
  return layers;
}

function inspectBlocks(pairs, diagnostics) {
  const blocks = new Map();
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];
    if (pair.code !== 0 || upper(pair.value) !== "BLOCK") continue;
    let end = index + 1;
    while (end < pairs.length && !(pairs[end].code === 0 && upper(pairs[end].value) === "ENDBLK")) end += 1;
    if (end === pairs.length) throw new TypeError(`DXF BLOCK at line ${pair.line} is not terminated`);
    const content = pairs.slice(index + 1, end);
    const firstEntity = content.findIndex((item) => item.code === 0);
    const header = firstEntity === -1 ? content : content.slice(0, firstEntity);
    const entityPairs = firstEntity === -1 ? [] : content.slice(firstEntity);
    const name = requireText(firstValue(header, 2), "DXF block name", 255);
    if (blocks.has(name)) {
      diagnostics.push(diagnostic("error", "duplicate-block", `DXF block name is duplicated: ${name}`, { sourceLine: pair.line }));
    } else {
      const baseZ = numericValue(header, 30, 0, "Block base z");
      const unsupportedBase = Math.abs(baseZ) > EPSILON;
      if (unsupportedBase) {
        diagnostics.push(diagnostic(
          "error",
          "nonplanar-block-base",
          `Block ${name} has a non-planar base point and cannot be expanded`,
          { sourceLine: pair.line },
        ));
      }
      blocks.set(name, {
        name,
        sourceLine: pair.line,
        unsupportedBase,
        base: {
          x: numericValue(header, 10, 0, "Block base x"),
          y: numericValue(header, 20, 0, "Block base y"),
        },
        entities: splitEntityRecords(entityPairs),
      });
    }
    index = end;
  }
  return blocks;
}

function splitEntityRecords(pairs) {
  const records = [];
  for (let index = 0; index < pairs.length;) {
    if (pairs[index].code !== 0) {
      index += 1;
      continue;
    }
    const end = nextZeroIndex(pairs, index + 1);
    const type = upper(pairs[index].value);
    if (type !== "ENDSEC" && type !== "ENDBLK" && type !== "SEQEND") {
      records.push({ type, pairs: pairs.slice(index, end), sourceLine: pairs[index].line });
    }
    index = end;
  }
  return records;
}

function expandRecord(record, affine, instancePath, inheritedLayer, depth, state, output) {
  state.expansionVisits += 1;
  if (state.expansionVisits > MAX_DXF_EXPANSION_VISITS) {
    throw new RangeError(`DXF expansion exceeds the ${MAX_DXF_EXPANSION_VISITS}-visit prototype limit`);
  }
  state.sourceIndex += 1;
  const sourceIndex = state.sourceIndex;
  const common = entityCommon(record, sourceIndex, inheritedLayer);
  if (common.paperSpace) {
    state.omittedCount += 1;
    pushDiagnostic(state, diagnostic("warning", "paper-space-omitted", "Paper-space entity is outside the supported model-space subset", common));
    return;
  }
  if (!common.planar) {
    state.omittedCount += 1;
    pushDiagnostic(state, diagnostic("warning", "nonplanar-entity-omitted", "Non-planar entity is outside the 2D reference subset", common));
    return;
  }
  if (record.type === "INSERT") {
    expandInsert(record, common, affine, instancePath, depth, state, output);
    return;
  }
  if (!SUPPORTED_DXF_ENTITIES.includes(record.type)) {
    state.omittedCount += 1;
    pushDiagnostic(state, diagnostic("warning", "unsupported-entity", `Unsupported DXF entity omitted: ${record.type}`, common));
    return;
  }
  try {
    const item = parseSupportedEntity(record, common, state);
    const transformed = transformSourceGeometry(item, affine);
    transformed.instancePath = structuredClone(instancePath);
    state.expandedCount += 1;
    if (state.expandedCount > MAX_DXF_EXPANDED_ENTITIES) {
      throw new RangeError(`DXF expansion exceeds the ${MAX_DXF_EXPANDED_ENTITIES}-entity prototype limit`);
    }
    output.push(transformed);
  } catch (error) {
    if (error instanceof RangeError && /prototype limit/.test(error.message)) throw error;
    state.omittedCount += 1;
    pushDiagnostic(state, diagnostic("error", "malformed-supported-entity", error.message, common));
  }
}

function expandInsert(record, common, parentAffine, instancePath, depth, state, output) {
  if (depth >= MAX_DXF_BLOCK_DEPTH) {
    state.omittedCount += 1;
    pushDiagnostic(state, diagnostic("error", "block-depth-limit", `Block nesting exceeds ${MAX_DXF_BLOCK_DEPTH}`, common));
    return;
  }
  const blockName = requireText(firstValue(record.pairs, 2), "INSERT block name", 255);
  const block = state.blocks.get(blockName);
  if (!block) {
    state.omittedCount += 1;
    pushDiagnostic(state, diagnostic("error", "missing-block", `INSERT references missing block: ${blockName}`, common));
    return;
  }
  if (block.unsupportedBase) {
    state.omittedCount += 1;
    pushDiagnostic(state, diagnostic("error", "nonplanar-block-insert", `INSERT uses non-planar block: ${blockName}`, common));
    return;
  }
  if (instancePath.some((entry) => entry.blockName === blockName)) {
    state.omittedCount += 1;
    pushDiagnostic(state, diagnostic("error", "cyclic-block", `Cyclic block INSERT omitted: ${blockName}`, common));
    return;
  }
  const columns = optionalInteger(record.pairs, 70, 1, "INSERT column count");
  const rows = optionalInteger(record.pairs, 71, 1, "INSERT row count");
  if (columns !== 1 || rows !== 1) {
    state.omittedCount += 1;
    pushDiagnostic(state, diagnostic("warning", "insert-array-unsupported", "INSERT arrays are outside the bounded subset", common));
    return;
  }
  const scaleX = numericValue(record.pairs, 41, 1, "INSERT x scale");
  const scaleY = numericValue(record.pairs, 42, 1, "INSERT y scale");
  const scaleZ = numericValue(record.pairs, 43, 1, "INSERT z scale");
  if (scaleX <= 0 || Math.abs(scaleX - scaleY) > EPSILON || Math.abs(scaleZ - 1) > EPSILON) {
    state.omittedCount += 1;
    pushDiagnostic(state, diagnostic("warning", "insert-transform-unsupported", "INSERT requires positive uniform XY scale and unit Z scale", common));
    return;
  }
  const insertion = {
    x: coordinateValue(record.pairs, 10, 0, "INSERT x"),
    y: coordinateValue(record.pairs, 20, 0, "INSERT y"),
  };
  const rotationRad = degreesToRadians(numericValue(record.pairs, 50, 0, "INSERT rotation"));
  const local = insertionAffine(insertion, block.base, scaleX, rotationRad);
  const composed = composeAffine(parentAffine, local);
  const entry = { blockName, insertHandle: common.sourceHandle, sourceLine: common.sourceLine };
  for (const child of block.entities) {
    expandRecord(child, composed, [...instancePath, entry], common.layer, depth + 1, state, output);
  }
}

function parseSupportedEntity(record, common, state) {
  const base = {
    id: `${common.sourceHandle}:${state.expandedCount + 1}`,
    layer: common.layer,
    sourceEntityType: record.type,
    sourceHandle: common.sourceHandle,
    sourceLine: common.sourceLine,
    instancePath: [],
  };
  if (record.type === "LINE") {
    const endElevation = numericValue(record.pairs, 31, 0, "LINE end elevation");
    if (Math.abs(endElevation) > EPSILON) throw new TypeError("Non-planar LINE is outside the 2D subset");
    return {
      ...base,
      kind: "line",
      start: pointFromCodes(record.pairs, 10, 20, "LINE start"),
      end: pointFromCodes(record.pairs, 11, 21, "LINE end"),
    };
  }
  if (record.type === "LWPOLYLINE") return parseLwPolyline(record, base, state);
  if (record.type === "CIRCLE") {
    return {
      ...base,
      kind: "circle",
      center: pointFromCodes(record.pairs, 10, 20, "CIRCLE center"),
      radius: positiveNumber(record.pairs, 40, "CIRCLE radius"),
    };
  }
  if (record.type === "ARC") {
    return {
      ...base,
      kind: "arc",
      center: pointFromCodes(record.pairs, 10, 20, "ARC center"),
      radius: positiveNumber(record.pairs, 40, "ARC radius"),
      startAngleRad: normalizeAngle(degreesToRadians(numericValue(record.pairs, 50, null, "ARC start angle"))),
      endAngleRad: normalizeAngle(degreesToRadians(numericValue(record.pairs, 51, null, "ARC end angle"))),
      counterClockwise: true,
    };
  }
  const horizontal = optionalInteger(record.pairs, 72, 0, "TEXT horizontal alignment");
  const vertical = optionalInteger(record.pairs, 73, 0, "TEXT vertical alignment");
  if (horizontal !== 0 || vertical !== 0) throw new TypeError("Aligned TEXT is outside the bounded subset");
  return {
    ...base,
    kind: "text",
    insertion: pointFromCodes(record.pairs, 10, 20, "TEXT insertion"),
    height: positiveNumber(record.pairs, 40, "TEXT height"),
    rotationRad: normalizeAngle(degreesToRadians(numericValue(record.pairs, 50, 0, "TEXT rotation"))),
    text: requireText(firstValue(record.pairs, 1), "TEXT value", 2048),
    styleName: requireText(firstValue(record.pairs, 7) ?? "STANDARD", "TEXT style", 255),
  };
}

function parseLwPolyline(record, base, state) {
  const elevation = numericValue(record.pairs, 38, 0, "LWPOLYLINE elevation");
  if (Math.abs(elevation) > EPSILON) throw new TypeError("Elevated LWPOLYLINE is outside the 2D subset");
  const constantWidth = numericValue(record.pairs, 43, 0, "LWPOLYLINE constant width");
  if (Math.abs(constantWidth) > EPSILON) throw new TypeError("Wide LWPOLYLINE is outside the bounded subset");
  const vertices = [];
  for (const pair of record.pairs) {
    if (pair.code === 10) vertices.push({ x: strictCoordinate(pair.value, "LWPOLYLINE vertex x"), y: null, bulge: 0 });
    else if (pair.code === 20) {
      if (!vertices.length || vertices.at(-1).y !== null) throw new TypeError("LWPOLYLINE y coordinate has no matching x coordinate");
      vertices.at(-1).y = strictCoordinate(pair.value, "LWPOLYLINE vertex y");
    } else if (pair.code === 42) {
      if (!vertices.length) throw new TypeError("LWPOLYLINE bulge has no vertex");
      vertices.at(-1).bulge = strictFinite(pair.value, "LWPOLYLINE bulge");
    } else if ((pair.code === 40 || pair.code === 41) && Math.abs(strictFinite(pair.value, "LWPOLYLINE width")) > EPSILON) {
      throw new TypeError("Variable-width LWPOLYLINE is outside the bounded subset");
    }
  }
  if (vertices.length < 2 || vertices.some((vertex) => vertex.y === null)) {
    throw new TypeError("LWPOLYLINE requires at least two complete XY vertices");
  }
  const declaredCount = optionalInteger(record.pairs, 90, vertices.length, "LWPOLYLINE vertex count");
  if (declaredCount !== vertices.length) throw new TypeError("LWPOLYLINE vertex count does not match its coordinate records");
  state.vertexCount += vertices.length;
  if (state.vertexCount > MAX_DXF_VERTICES) {
    throw new RangeError(`DXF exceeds the ${MAX_DXF_VERTICES}-vertex prototype limit`);
  }
  const flags = optionalInteger(record.pairs, 70, 0, "LWPOLYLINE flags");
  return { ...base, kind: "lwpolyline", closed: Boolean(flags & 1), vertices };
}

function entityCommon(record, sourceIndex, inheritedLayer) {
  const handle = firstValue(record.pairs, 5) ?? `line-${record.sourceLine}-entity-${sourceIndex}`;
  const rawLayer = requireLayerName(firstValue(record.pairs, 8) ?? "0");
  const layer = rawLayer === "0" && inheritedLayer ? inheritedLayer : rawLayer;
  const layout = firstValue(record.pairs, 410);
  const paperSpace = optionalInteger(record.pairs, 67, 0, "Paper-space flag") === 1 ||
    (layout !== null && upper(layout) !== "MODEL");
  const normal = {
    x: numericValue(record.pairs, 210, 0, "Extrusion x"),
    y: numericValue(record.pairs, 220, 0, "Extrusion y"),
    z: numericValue(record.pairs, 230, 1, "Extrusion z"),
  };
  const planar = Math.abs(normal.x) <= EPSILON && Math.abs(normal.y) <= EPSILON && Math.abs(normal.z - 1) <= EPSILON &&
    Math.abs(numericValue(record.pairs, 30, 0, "Entity elevation")) <= EPSILON;
  return {
    sourceEntityType: record.type,
    sourceHandle: requireText(String(handle), "DXF entity handle", 255),
    sourceLine: record.sourceLine,
    layer,
    paperSpace,
    planar,
  };
}

function transformSourceGeometry(item, affine) {
  const common = { ...item, layer: item.layer };
  if (item.kind === "line") return { ...common, start: applyAffine(affine, item.start), end: applyAffine(affine, item.end) };
  if (item.kind === "lwpolyline") {
    return { ...common, vertices: item.vertices.map((vertex) => ({ ...applyAffine(affine, vertex), bulge: vertex.bulge })) };
  }
  if (item.kind === "circle") {
    return { ...common, center: applyAffine(affine, item.center), radius: item.radius * affine.scale };
  }
  if (item.kind === "arc") {
    return {
      ...common,
      center: applyAffine(affine, item.center),
      radius: item.radius * affine.scale,
      startAngleRad: normalizeAngle(item.startAngleRad + affine.rotationRad),
      endAngleRad: normalizeAngle(item.endAngleRad + affine.rotationRad),
    };
  }
  return {
    ...common,
    insertion: applyAffine(affine, item.insertion),
    height: item.height * affine.scale,
    rotationRad: normalizeAngle(item.rotationRad + affine.rotationRad),
  };
}

function identityAffine() {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, scale: 1, rotationRad: 0 };
}

function insertionAffine(insertion, base, scale, rotationRad) {
  const cosine = Math.cos(rotationRad) * scale;
  const sine = Math.sin(rotationRad) * scale;
  return {
    a: cosine,
    b: sine,
    c: -sine,
    d: cosine,
    e: insertion.x - cosine * base.x + sine * base.y,
    f: insertion.y - sine * base.x - cosine * base.y,
    scale,
    rotationRad,
  };
}

function composeAffine(parent, child) {
  return {
    a: parent.a * child.a + parent.c * child.b,
    b: parent.b * child.a + parent.d * child.b,
    c: parent.a * child.c + parent.c * child.d,
    d: parent.b * child.c + parent.d * child.d,
    e: parent.a * child.e + parent.c * child.f + parent.e,
    f: parent.b * child.e + parent.d * child.f + parent.f,
    scale: parent.scale * child.scale,
    rotationRad: normalizeAngle(parent.rotationRad + child.rotationRad),
  };
}

function applyAffine(affine, point) {
  const transformed = {
    x: affine.a * point.x + affine.c * point.y + affine.e,
    y: affine.b * point.x + affine.d * point.y + affine.f,
  };
  assertFiniteCoordinate(transformed.x, "Expanded DXF x");
  assertFiniteCoordinate(transformed.y, "Expanded DXF y");
  return transformed;
}

function normalizeIncludedLayers(value, availableLayers) {
  if (!Array.isArray(value) || value.length < 1) {
    throw new TypeError("DXF acceptance requires an explicit non-empty layer selection");
  }
  const names = value.map(requireLayerName);
  assertUnique(names, "Included DXF layers");
  const available = new Set(availableLayers.map((layer) => layer.name));
  for (const name of names) if (!available.has(name)) throw new TypeError(`DXF layer is not available: ${name}`);
  return [...names].sort(compareText);
}

function resolveUnits(declaredUnits, choice) {
  validateDeclaredUnits(declaredUnits);
  if (declaredUnits.status === "declared-supported") {
    if (choice !== undefined && choice !== declaredUnits.unit) {
      throw new TypeError(`DXF unit choice conflicts with declared ${declaredUnits.unit} units`);
    }
    return {
      source: "declared",
      unit: declaredUnits.unit,
      mmPerSourceUnit: declaredUnits.mmPerSourceUnit,
      declaredCode: declaredUnits.code,
    };
  }
  if (!Object.hasOwn(UNIT_CHOICES, choice)) {
    throw new TypeError("DXF with unknown, unitless or ambiguous units requires an explicit unit choice");
  }
  return {
    source: "user-confirmed",
    unit: choice,
    mmPerSourceUnit: UNIT_CHOICES[choice],
    declaredCode: declaredUnits.code,
  };
}

function normalizeReferenceTransform(transform) {
  if (!transform || typeof transform !== "object") throw new TypeError("DXF source-to-floor transform is required");
  return {
    localOriginSource: {
      x: finiteCoordinate(transform.localOriginSource?.x, "DXF local-origin x"),
      y: finiteCoordinate(transform.localOriginSource?.y, "DXF local-origin y"),
    },
    translationMm: {
      x: finiteCoordinate(transform.translationMm?.x, "DXF translation x", 1e15),
      y: finiteCoordinate(transform.translationMm?.y, "DXF translation y", 1e15),
    },
    rotationRad: finiteNumber(transform.rotationRad, "DXF rotation"),
  };
}

function validateResolvedUnits(units) {
  if (!units || (units.source !== "declared" && units.source !== "user-confirmed")) {
    throw new TypeError("DXF unit resolution source is invalid");
  }
  if (!Object.hasOwn(UNIT_CHOICES, units.unit) || units.mmPerSourceUnit !== UNIT_CHOICES[units.unit]) {
    throw new TypeError("DXF resolved unit conversion is invalid");
  }
  if (units.source === "declared") {
    const declared = DECLARED_UNITS[units.declaredCode];
    if (!declared || declared.unit !== units.unit) throw new TypeError("DXF declared unit resolution is inconsistent");
  }
  return units;
}

function validateDeclaredUnits(units) {
  if (!units || !["declared-supported", "missing", "unitless", "unsupported", "ambiguous"].includes(units.status)) {
    throw new TypeError("DXF declared units state is invalid");
  }
  if (units.status === "declared-supported") {
    const declared = DECLARED_UNITS[units.code];
    if (!declared || units.unit !== declared.unit || units.mmPerSourceUnit !== declared.mmPerSourceUnit) {
      throw new TypeError("DXF declared unit conversion is inconsistent");
    }
  } else if (units.unit !== null || units.mmPerSourceUnit !== null) {
    throw new TypeError("Unresolved DXF units cannot contain a conversion");
  }
  return units;
}

function validateCandidate(candidate) {
  if (!candidate || candidate.kind !== "dxf-import-candidate") throw new TypeError("DXF import candidate is required");
  if (candidate.importer?.id !== DXF_IMPORTER.id || candidate.importer?.version !== DXF_IMPORTER.version) {
    throw new TypeError("DXF candidate importer identity is unsupported");
  }
  if (!Array.isArray(candidate.geometry) || !Array.isArray(candidate.layers) || !Array.isArray(candidate.diagnostics)) {
    throw new TypeError("DXF candidate is incomplete");
  }
}

function validateDiagnostic(item) {
  if (!item || !["warning", "error"].includes(item.severity)) throw new TypeError("DXF diagnostic severity is invalid");
  requireText(item.code, "DXF diagnostic code", 128);
  requireText(item.message, "DXF diagnostic message", 2048);
  for (const field of ["sourceEntityType", "sourceHandle", "layer"]) {
    if (item[field] !== null) requireText(item[field], `DXF diagnostic ${field}`, 255);
  }
  if (item.sourceLine !== null && (!Number.isInteger(item.sourceLine) || item.sourceLine < 1)) {
    throw new TypeError("DXF diagnostic source line is invalid");
  }
}

function validateGeometryItem(item) {
  requireId(item?.id, "DXF geometry ID");
  requireLayerName(item.layer);
  requireText(item.sourceEntityType, "DXF source entity type", 64);
  requireText(item.sourceHandle, "DXF source handle", 255);
  if (!Number.isInteger(item.sourceLine) || item.sourceLine < 1) throw new TypeError("DXF source line must be positive");
  if (!Array.isArray(item.instancePath) || item.instancePath.length > MAX_DXF_BLOCK_DEPTH) {
    throw new TypeError("DXF block-instance provenance is invalid");
  }
  for (const entry of item.instancePath) {
    requireText(entry?.blockName, "DXF block name", 255);
    requireText(entry?.insertHandle, "DXF insert handle", 255);
  }
  if (item.kind === "line") {
    validatePoint(item.start, "DXF line start");
    validatePoint(item.end, "DXF line end");
  } else if (item.kind === "lwpolyline") {
    if (typeof item.closed !== "boolean" || !Array.isArray(item.vertices) || item.vertices.length < 2) {
      throw new TypeError("DXF polyline geometry is invalid");
    }
    for (const vertex of item.vertices) {
      validatePoint(vertex, "DXF polyline vertex");
      finiteNumber(vertex.bulge, "DXF polyline bulge");
    }
  } else if (item.kind === "arc") {
    validatePoint(item.center, "DXF arc center");
    positiveFinite(item.radius, "DXF arc radius");
    finiteNumber(item.startAngleRad, "DXF arc start angle");
    finiteNumber(item.endAngleRad, "DXF arc end angle");
    if (item.counterClockwise !== true) throw new TypeError("DXF arcs must retain counter-clockwise direction");
  } else if (item.kind === "circle") {
    validatePoint(item.center, "DXF circle center");
    positiveFinite(item.radius, "DXF circle radius");
  } else if (item.kind === "text") {
    validatePoint(item.insertion, "DXF text insertion");
    positiveFinite(item.height, "DXF text height");
    finiteNumber(item.rotationRad, "DXF text rotation");
    requireText(item.text, "DXF text", 2048);
    requireText(item.styleName, "DXF text style", 255);
  } else {
    throw new TypeError(`Unsupported persisted DXF geometry kind: ${String(item.kind)}`);
  }
  return item;
}

function polylineBounds(item) {
  const bounds = [pointsBounds(item.vertices)];
  const segmentCount = item.closed ? item.vertices.length : item.vertices.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const start = item.vertices[index];
    const end = item.vertices[(index + 1) % item.vertices.length];
    if (Math.abs(start.bulge) <= EPSILON) continue;
    const arc = arcFromBulge(start, end, start.bulge);
    bounds.push(arcBounds(arc.center, arc.radius, arc.startAngleRad, arc.endAngleRad));
  }
  return mergeBounds(bounds);
}

function textBounds(insertion, height, rotationRad, text) {
  const width = Math.max(height, [...text].length * height * 0.7);
  const corners = [
    { x: 0, y: -height },
    { x: width, y: -height },
    { x: width, y: height * 0.25 },
    { x: 0, y: height * 0.25 },
  ].map((point) => {
    const cosine = Math.cos(rotationRad);
    const sine = Math.sin(rotationRad);
    return {
      x: insertion.x + point.x * cosine - point.y * sine,
      y: insertion.y + point.x * sine + point.y * cosine,
    };
  });
  return pointsBounds(corners);
}

function arcFromBulge(start, end, bulge) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);
  if (chord <= EPSILON) throw new TypeError("Bulged LWPOLYLINE segment has coincident endpoints");
  const radius = chord * (1 + bulge * bulge) / (4 * Math.abs(bulge));
  const offset = chord * (1 - bulge * bulge) / (4 * bulge);
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const center = { x: midpoint.x - dy / chord * offset, y: midpoint.y + dx / chord * offset };
  assertFiniteCoordinate(center.x, "Bulge arc center x");
  assertFiniteCoordinate(center.y, "Bulge arc center y");
  let startAngleRad = normalizeAngle(Math.atan2(start.y - center.y, start.x - center.x));
  let endAngleRad = normalizeAngle(Math.atan2(end.y - center.y, end.x - center.x));
  if (bulge < 0) [startAngleRad, endAngleRad] = [endAngleRad, startAngleRad];
  return { center, radius, startAngleRad, endAngleRad };
}

function arcBounds(center, radius, startAngleRad, endAngleRad) {
  const angles = [startAngleRad, endAngleRad];
  for (const candidate of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    if (angleWithinCounterClockwiseSweep(candidate, startAngleRad, endAngleRad)) angles.push(candidate);
  }
  return pointsBounds(angles.map((angle) => ({
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  })));
}

function angleWithinCounterClockwiseSweep(candidate, start, end) {
  const sweep = normalizeAngle(end - start);
  const offset = normalizeAngle(candidate - start);
  return offset <= sweep + EPSILON;
}

function pointsBounds(points) {
  return {
    minX: cleanNearZero(Math.min(...points.map((point) => point.x))),
    minY: cleanNearZero(Math.min(...points.map((point) => point.y))),
    maxX: cleanNearZero(Math.max(...points.map((point) => point.x))),
    maxY: cleanNearZero(Math.max(...points.map((point) => point.y))),
  };
}

function mergeBounds(bounds) {
  if (!bounds.length) return null;
  return {
    minX: Math.min(...bounds.map((value) => value.minX)),
    minY: Math.min(...bounds.map((value) => value.minY)),
    maxX: Math.max(...bounds.map((value) => value.maxX)),
    maxY: Math.max(...bounds.map((value) => value.maxY)),
  };
}

function boundsEqual(left, right) {
  if (left === null || right === null) return left === right;
  return ["minX", "minY", "maxX", "maxY"].every((key) => (
    Number.isFinite(right[key]) && Math.abs(left[key] - right[key]) <= 1e-9
  ));
}

function cleanNearZero(value) {
  return Math.abs(value) <= 1e-9 ? 0 : value;
}

function pointFromCodes(pairs, xCode, yCode, label) {
  return {
    x: coordinateValue(pairs, xCode, null, `${label} x`),
    y: coordinateValue(pairs, yCode, null, `${label} y`),
  };
}

function positiveNumber(pairs, code, label) {
  const value = numericValue(pairs, code, null, label);
  return positiveFinite(value, label);
}

function numericValue(pairs, code, fallback, label) {
  const raw = firstValue(pairs, code);
  if (raw === null) {
    if (fallback === null) throw new TypeError(`${label} is required`);
    return fallback;
  }
  return strictFinite(raw, label);
}

function coordinateValue(pairs, code, fallback, label) {
  const value = numericValue(pairs, code, fallback, label);
  assertFiniteCoordinate(value, label);
  return value;
}

function optionalInteger(pairs, code, fallback, label) {
  const value = firstValue(pairs, code);
  return value === null ? fallback : strictInteger(value, label);
}

function strictInteger(value, label) {
  if (typeof value !== "string" || !/^[+-]?\d+$/.test(value.trim())) throw new TypeError(`${label} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new RangeError(`${label} exceeds the safe integer range`);
  return parsed;
}

function strictFinite(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required`);
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} must be finite`);
  return parsed;
}

function finiteNumber(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function finiteCoordinate(value, label, maximum = MAX_DXF_ABS_SOURCE_COORDINATE) {
  finiteNumber(value, label);
  assertFiniteCoordinate(value, label, maximum);
  return value;
}

function assertFiniteCoordinate(value, label, maximum = MAX_DXF_ABS_SOURCE_COORDINATE) {
  if (!Number.isFinite(value) || Math.abs(value) > maximum) {
    throw new RangeError(`${label} exceeds the bounded coordinate range`);
  }
}

function positiveFinite(value, label) {
  finiteNumber(value, label);
  if (value <= 0) throw new RangeError(`${label} must be positive`);
  return value;
}

function strictCoordinate(value, label) {
  const parsed = strictFinite(value, label);
  assertFiniteCoordinate(parsed, label);
  return parsed;
}

function validatePoint(point, label) {
  finiteCoordinate(point?.x, `${label} x`);
  finiteCoordinate(point?.y, `${label} y`);
}

function firstValue(pairs, code) {
  const pair = pairs.find((candidate) => candidate.code === code);
  return pair ? pair.value.trim() : null;
}

function nextZeroIndex(pairs, start) {
  let index = start;
  while (index < pairs.length && pairs[index].code !== 0) index += 1;
  return index;
}

function requireText(value, label, maximumLength) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required`);
  const text = value.trim();
  if ([...text].length > maximumLength) throw new RangeError(`${label} exceeds the bounded length`);
  return text;
}

function requireLayerName(value) {
  return requireText(value, "DXF layer name", 255);
}

function requireId(value, label) {
  return requireText(value, label, 255);
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) throw new TypeError(`${label} must be unique`);
}

function upper(value) {
  return String(value).trim().toUpperCase();
}

function degreesToRadians(value) {
  return value * Math.PI / 180;
}

function normalizeAngle(value) {
  const normalized = value % TWO_PI;
  return normalized < 0 ? normalized + TWO_PI : normalized;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function diagnostic(severity, code, message, source = {}) {
  return {
    severity,
    code,
    message,
    sourceEntityType: source.sourceEntityType ?? null,
    sourceHandle: source.sourceHandle ?? null,
    sourceLine: source.sourceLine ?? null,
    layer: source.layer ?? null,
  };
}

function pushDiagnostic(state, value) {
  if (state.diagnostics.length >= MAX_DXF_DIAGNOSTICS) {
    throw new RangeError(`DXF exceeds the ${MAX_DXF_DIAGNOSTICS}-diagnostic prototype limit`);
  }
  state.diagnostics.push(value);
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("SHA-256 is unavailable in this environment");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fnv1a32(value) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function stableStringify(value) {
  return JSON.stringify(sortObject(value));
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
