import { floorPortTransform } from "../domain/spatial.mjs";
import { deriveComponentPlanGraphic } from "./component-plan-graphics.mjs";
import { ZEHNDER_Q_DE_BIM_ASSETS } from "./generated/zehnder-q-de-bim-assets.mjs";

export const MANUFACTURER_GEOMETRY_CONTRACT_VERSION = 2;

export const MANUFACTURER_ASSET_IMPORT_REQUIREMENTS = Object.freeze({
  geometry: "IFC 4 file containing one placed instance of every required family/type",
  units: "Declared source units with millimetres preferred; no unit may be inferred from the filename",
  connectors: "Companion CSV or JSON with family, type, connector ID, XYZ, direction, system, nominal diameter and units",
  identity: "Manufacturer, product family, article/type identifier, source revision and export date",
  evidenceBoundary: "Revit template names and preview images are not geometry or connector evidence",
});

/**
 * Maps a saved component to the strongest geometry already supported by its
 * pinned catalogue snapshot. It does not parse native BIM and never promotes
 * a plan symbol or generic fixture to manufacturer geometry.
 */
export function describeComponentGeometry(project, component) {
  const manufacturerAsset = resolveManufacturerGeometryAsset(component);
  const terminal = isTerminal(component);
  const graphic = safeGraphic(component);
  const snapshotDimensions = component.catalogueSnapshot?.dimensions ?? null;
  const body = snapshotDimensions?.body ?? null;
  const mounted = graphic?.mountedDimensions ?? null;
  const bodyDimensions = positiveTriplet(body?.width, body?.depth, body?.height);
  const mountedDimensions = positiveTriplet(mounted?.widthMm, mounted?.depthMm, mounted?.heightMm);
  const planDimensions = positivePair(
    graphic?.drawingBoundsMm ? graphic.drawingBoundsMm.maxX - graphic.drawingBoundsMm.minX : graphic?.widthMm,
    graphic?.drawingBoundsMm ? graphic.drawingBoundsMm.maxY - graphic.drawingBoundsMm.minY : graphic?.depthMm,
  );

  let dimensions;
  let evidenceState;
  let evidenceSource;
  if (terminal) {
    dimensions = { widthMm: 140, depthMm: 140, heightMm: 24 };
    evidenceState = "schematic-placeholder";
    evidenceSource = "terminal drawing symbol; physical terminal envelope not provided";
  } else if (mountedDimensions) {
    dimensions = mountedDimensions;
    evidenceState = mounted?.envelopeStatus === "schematic-layout-allowance" ? "provisional-envelope" : "source-backed-envelope";
    evidenceSource = mounted.source ?? mounted.envelopeStatus ?? "saved mounted drawing envelope";
  } else if (bodyDimensions) {
    dimensions = bodyDimensions;
    evidenceState = classifyEvidence(snapshotDimensions?.evidenceStatus);
    evidenceSource = snapshotDimensions?.evidenceStatus ?? snapshotDimensions?.note ?? "pinned catalogue body envelope";
  } else if (planDimensions) {
    dimensions = { ...planDimensions, heightMm: null };
    evidenceState = "plan-only";
    evidenceSource = graphic?.evidenceBoundary ?? snapshotDimensions?.note ?? "saved plan symbol only";
  } else {
    dimensions = { widthMm: 200, depthMm: 200, heightMm: null };
    evidenceState = "unknown-placeholder";
    evidenceSource = "no physical or plan envelope is available; 200 mm wireframe is display-only";
  }

  const ports = (component.ports ?? []).map((port) => {
    const world = floorPortTransform(project, component.id, port.id).positionMm;
    return Object.freeze({
      id: port.id,
      role: port.role,
      stream: port.stream,
      family: port.interface?.family ?? null,
      nominalSizeMm: positive(port.interface?.nominalSizeMm),
      outsideDiameterMm: positive(port.interface?.outsideDiameterMm),
      xMm: world.x,
      yMm: world.y,
      zMm: resolvedMeasurementValue(world.z),
      coordinateEvidence: port.coordinateEvidence ?? component.catalogueSnapshot?.connectionSetout?.verificationStatus ?? "saved typed port coordinate",
    });
  });

  return deepFreeze({
    contractVersion: MANUFACTURER_GEOMETRY_CONTRACT_VERSION,
    componentId: component.id,
    catalogueItemId: component.catalogueItemId ?? component.catalogueSnapshot?.recordId ?? null,
    shape: terminal ? "terminal" : classifyShape(component, graphic),
    dimensions,
    evidenceState,
    evidenceSource,
    solid: dimensions.heightMm !== null && !["schematic-placeholder", "unknown-placeholder", "plan-only"].includes(evidenceState),
    manufacturerAsset,
    ports,
  });
}

/** Exact-identity lookup only. Similar family names or export/local articles never bind a German BIM asset. */
export function resolveManufacturerGeometryAsset(component) {
  const binding = component?.catalogueSnapshot?.manufacturerGeometryAsset ?? null;
  if (!binding?.assetId || !binding?.manufacturerArticle) return null;
  const asset = ZEHNDER_Q_DE_BIM_ASSETS[binding.assetId] ?? null;
  if (!asset || asset.manufacturerArticle !== binding.manufacturerArticle) return null;
  const snapshotArticle = component.catalogueSnapshot?.manufacturerArticle ?? null;
  if (snapshotArticle !== asset.manufacturerArticle) return null;
  return asset;
}

function classifyShape(component, graphic) {
  const identity = `${component.catalogueItemId ?? ""} ${component.displayName ?? ""} ${graphic?.graphicId ?? ""}`.toLowerCase();
  if (/cw|comfowell|radial|distribution|attenuator/.test(identity)) return "distribution";
  if (/q350|q450|q600|comfoair|aerofresh|ca200|mvhr|hrv|erv/.test(identity)) return "unit";
  return "equipment";
}

function classifyEvidence(status) {
  const value = String(status ?? "").toLowerCase();
  if (/manufacturer|manual|source/.test(value)) return "source-backed-envelope";
  if (/generic|provisional|schematic/.test(value)) return "provisional-envelope";
  return "catalogue-envelope";
}

function isTerminal(component) {
  return component.ports?.length === 1 && component.ports[0].system === "mvhr" && ["supply", "extract"].includes(component.ports[0].stream);
}

function safeGraphic(component) {
  try { return deriveComponentPlanGraphic(component); } catch { return null; }
}

function positive(value) { return Number.isFinite(value) && value > 0 ? value : null; }
function positivePair(width, depth) {
  const widthMm = positive(width), depthMm = positive(depth);
  return widthMm && depthMm ? { widthMm, depthMm } : null;
}
function positiveTriplet(width, depth, height) {
  const pair = positivePair(width, depth), heightMm = positive(height);
  return pair && heightMm ? { ...pair, heightMm } : null;
}
function resolvedMeasurementValue(value) {
  return value && ["known", "assumed"].includes(value.state) && Number.isFinite(value.valueMm) ? value.valueMm : null;
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
