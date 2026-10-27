import {normalizeCompanyProfile,validateLogoDataUrl} from "../persistence/company-profile.mjs";
import { CA200_GRAPHIC_ID, ca200Shapes } from "../editor/ca200-profile.mjs";
import { deriveHrvCeilingElbows, hrvCeilingElbowShapes } from "../editor/hrv-ceiling-elbows.mjs";
import { STANDALONE_CW_GRAPHIC_ID, standaloneCwShapes } from "../editor/standalone-cw.mjs";
import {
  referenceScaleMmPerPixel,
  serializeProject,
  sourcePointToWorld,
  validateProject,
} from "../domain/spatial.mjs";
import { transformDxfReferenceGeometry } from "../import/dxf-reference.mjs";
import { deriveDuctBodyGeometry } from "../editor/duct-body-geometry.mjs";
import { routeFamilyForKind } from "../editor/component-catalogue.mjs";
import {
  EXTERNAL_GRILLE_PLAN_GRAPHIC_ID,
  externalGrilleShapes,
  LUNA_GRILLE_PLAN_GRAPHIC_ID,
  WALL_GRILLE_PLAN_GRAPHIC_ID,
  GENERIC_CW_PLAN_GRAPHIC_ID,
  Q350_PLAN_GRAPHIC_ID,
  deriveComponentPlanGraphic,
  mountedCwShapes,
  q350PortLabelLayout,
  q350CasingPath,
} from "../editor/component-plan-graphics.mjs";
import { createPartsSchedule } from "../editor/parts-schedule.mjs";

export const A3_DIMENSIONS_MM = Object.freeze({ short: 297, long: 420 });
export const SHEET_TEMPLATE_ID = "hiper-a3-plan-sidebar-v3";
export const ISSUE_STATUSES = Object.freeze([
  "Preliminary — not for construction",
  "Issued for review — not for construction",
]);

const XML_NAMESPACE = "http://www.w3.org/2000/svg";
const PAGE_MARGIN_MM = 10;
const TITLE_BLOCK_WIDTH_MM = 75;
const DRAWING_GAP_MM = 5;
const SCHEDULE_GAP_MM = 4;
const SCHEDULE_HEIGHT_MM = 82;
const DRAWING_PADDING_MM = 6;
const MAX_LEGEND_ITEMS = 20;
const MAX_SHEET_SCHEDULE_LINES = 14;
const STANDARD_SCALE_DENOMINATORS = Object.freeze([
  1, 2, 5, 10, 20, 25, 40, 50, 60, 75, 100, 125, 150, 200, 250, 400, 500, 750, 1000, 1500, 2000, 2500, 5000, 10000,
]);

export function a3PageBounds(orientation = "landscape") {
  if (orientation !== "landscape" && orientation !== "portrait") {
    throw new TypeError("A3 orientation must be landscape or portrait");
  }
  const widthMm = orientation === "landscape" ? A3_DIMENSIONS_MM.long : A3_DIMENSIONS_MM.short;
  const heightMm = orientation === "landscape" ? A3_DIMENSIONS_MM.short : A3_DIMENSIONS_MM.long;
  return Object.freeze({ xMm: 0, yMm: 0, widthMm, heightMm, orientation });
}

export function createA3SheetModel(project, metadata) {
  const sourceProject = structuredClone(validateProject(structuredClone(project)));
  const normalized = normalizeMetadata(sourceProject, metadata);
  const page = a3PageBounds(normalized.orientation);
  const printableBounds = Object.freeze({
    xMm: PAGE_MARGIN_MM,
    yMm: PAGE_MARGIN_MM,
    widthMm: page.widthMm - PAGE_MARGIN_MM * 2,
    heightMm: page.heightMm - PAGE_MARGIN_MM * 2,
  });
  const sidebarX=printableBounds.xMm+printableBounds.widthMm-TITLE_BLOCK_WIDTH_MM;
  const titleBlockBounds=Object.freeze({xMm:sidebarX,yMm:printableBounds.yMm+printableBounds.heightMm-128,widthMm:TITLE_BLOCK_WIDTH_MM,heightMm:128});
  const legendBounds=Object.freeze({xMm:sidebarX,yMm:printableBounds.yMm,widthMm:TITLE_BLOCK_WIDTH_MM,heightMm:printableBounds.heightMm-128});
  const scheduleBounds=Object.freeze({xMm:printableBounds.xMm,yMm:printableBounds.yMm+printableBounds.heightMm-SCHEDULE_HEIGHT_MM,widthMm:printableBounds.widthMm-TITLE_BLOCK_WIDTH_MM-DRAWING_GAP_MM,heightMm:SCHEDULE_HEIGHT_MM});
  const drawingBounds=Object.freeze({xMm:printableBounds.xMm,yMm:printableBounds.yMm,widthMm:printableBounds.widthMm-TITLE_BLOCK_WIDTH_MM-(normalized.includeSchedule?DRAWING_GAP_MM:0),heightMm:printableBounds.heightMm-(normalized.includeSchedule?SCHEDULE_HEIGHT_MM+SCHEDULE_GAP_MM:0)});
  const partsSchedule = createPartsSchedule(sourceProject, { floorId: normalized.floorId });
  const printScene = buildPrintScene(sourceProject, normalized.floorId, partsSchedule);
  const fit = calculateSheetFit(printScene.modelBoundsMm, drawingBounds, {
    forceNotToScale: printScene.hasUncalibratedReference,
  });
  const projectJson = serializeProject(sourceProject);
  const sourceFingerprint = fnv1a32(projectJson);
  const printSceneFingerprint = fnv1a32(JSON.stringify({
    templateId: SHEET_TEMPLATE_ID,
    sourceFingerprint,
    metadata: normalized,
    page,
    printableBounds,
    drawingBounds,
    scheduleBounds,
    titleBlockBounds,
    legendBounds,
    printScene,
    partsSchedule,
    fit,
  }));

  return deepFreeze({
    kind: "working-draft-sheet-preview",
    templateId: SHEET_TEMPLATE_ID,
    sourceProjectId: sourceProject.id,
    sourceProjectFingerprint: sourceFingerprint,
    printSceneFingerprint,
    metadata: normalized,
    page,
    printableBounds,
    drawingBounds,
    scheduleBounds,
    titleBlockBounds,
    legendBounds,
    printScene,
    partsSchedule,
    fit,
  });
}

export function calculateSheetFit(modelBoundsMm, drawingBounds, options = {}) {
  const inner = {
    xMm: drawingBounds.xMm + DRAWING_PADDING_MM,
    yMm: drawingBounds.yMm + DRAWING_PADDING_MM,
    widthMm: Math.max(1, drawingBounds.widthMm - DRAWING_PADDING_MM * 2),
    heightMm: Math.max(1, drawingBounds.heightMm - DRAWING_PADDING_MM * 2),
  };
  if (!modelBoundsMm) {
    return deepFreeze({
      kind: "not-to-scale",
      label: "NTS — no printable geometry",
      denominator: null,
      modelMmPerSheetMm: null,
      innerBounds: inner,
      modelBoundsMm: null,
      transform: null,
    });
  }
  const modelWidth = Math.max(1, modelBoundsMm.maxX - modelBoundsMm.minX);
  const modelHeight = Math.max(1, modelBoundsMm.maxY - modelBoundsMm.minY);
  const requiredDenominator = Math.max(modelWidth / inner.widthMm, modelHeight / inner.heightMm);
  const denominator = chooseScaleDenominator(requiredDenominator);
  const transform = {
    scale: 1 / denominator,
    offsetX: inner.xMm + (inner.widthMm - modelWidth / denominator) / 2 - modelBoundsMm.minX / denominator,
    offsetY: inner.yMm + (inner.heightMm - modelHeight / denominator) / 2 - modelBoundsMm.minY / denominator,
  };
  if (options.forceNotToScale) {
    return deepFreeze({
      kind: "not-to-scale",
      label: "NTS — uncalibrated reference present",
      denominator: null,
      modelMmPerSheetMm: null,
      fitDenominator: denominator,
      innerBounds: inner,
      modelBoundsMm: structuredClone(modelBoundsMm),
      transform,
    });
  }
  return deepFreeze({
    kind: "numeric",
    label: `1:${formatNumber(denominator)}`,
    denominator,
    modelMmPerSheetMm: denominator,
    innerBounds: inner,
    modelBoundsMm: structuredClone(modelBoundsMm),
    transform,
  });
}

export function renderA3SheetSvg(sheet) {
  validateSheetModel(sheet);
  const { widthMm, heightMm } = sheet.page;
  const drawing = sheet.drawingBounds;
  const title = sheet.titleBlockBounds;
  const body = [];
  body.push(`<svg xmlns="${XML_NAMESPACE}" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${widthMm} ${heightMm}" role="img" aria-labelledby="sheet-title sheet-desc">`);
  body.push(`<title id="sheet-title">${escapeXml(sheet.metadata.drawingTitle)}</title>`);
  body.push(`<desc id="sheet-desc">A3 ${sheet.page.orientation} working-draft drawing preview. ${escapeXml(sheet.metadata.status)}.</desc>`);
  body.push("<defs>");
  body.push(`<clipPath id="drawing-clip"><rect x="${drawing.xMm}" y="${drawing.yMm}" width="${drawing.widthMm}" height="${drawing.heightMm}"/></clipPath>`);
  body.push("</defs>");
  body.push("<rect width=\"100%\" height=\"100%\" fill=\"white\"/>");
  body.push(`<rect x="${sheet.printableBounds.xMm}" y="${sheet.printableBounds.yMm}" width="${sheet.printableBounds.widthMm}" height="${sheet.printableBounds.heightMm}" fill="none" stroke="#17242b" stroke-width="0.5"/>`);
  body.push(`<g id="drawing-content" clip-path="url(#drawing-clip)">`);
  body.push(renderPrintScene(sheet));
  body.push("</g>");
  body.push(renderWatermark(sheet));
  if(sheet.metadata.includeSchedule)body.push(renderPartsSchedule(sheet));
  body.push(renderSheetLegend(sheet,sheet.legendBounds));
  body.push(renderTitleBlock(sheet, title));
  body.push("</svg>");
  return body.join("");
}

export function escapeXml(value) {
  return sanitizeXmlText(value, "SVG text").replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function wrapSheetText(value, maxCharacters, maxLines) {
  const text = sanitizeXmlText(value, "Sheet text");
  if (!Number.isInteger(maxCharacters) || maxCharacters < 2) {
    throw new TypeError("Maximum characters must be an integer of at least two");
  }
  if (!Number.isInteger(maxLines) || maxLines < 1) {
    throw new TypeError("Maximum lines must be a positive integer");
  }
  const words = text.split(/\s+/u).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const pieces = splitLongWord(word, maxCharacters);
    for (const piece of pieces) {
      const candidate = current ? `${current} ${piece}` : piece;
      if ([...candidate].length <= maxCharacters) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = piece;
      }
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    const final = [...lines.at(-1)];
    lines[lines.length - 1] = `${final.slice(0, Math.max(1, maxCharacters - 1)).join("")}…`;
  }
  return lines.length ? lines : [""];
}

function rasterDataUrl(value) {
  if(typeof value!=="string" || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new TypeError("Sheet image must be an embedded PNG or JPEG");
  return value;
}

function buildPrintScene(project, floorId, partsSchedule) {
  const floor = project.floors.find((candidate) => candidate.id === floorId);
  if (!floor) throw new TypeError(`Sheet floor not found: ${floorId}`);
  const componentRefById = new Map(partsSchedule.componentLines.flatMap((line) => (
    line.componentIds.map((componentId) => [componentId, line.ref])
  )));
  const routeRefById = new Map(partsSchedule.routeLines.flatMap((line) => (
    line.routeIds.map((routeId) => [routeId, line.ref])
  )));
  const nodesById = new Map(project.wallNodes.map((node) => [node.id, node]));
  const walls = project.walls.filter((wall) => wall.floorId === floorId).map((wall) => ({
    id: wall.id,
    start: planPoint(nodesById.get(wall.startNodeId)?.positionMm, `Wall ${wall.id} start`),
    end: planPoint(nodesById.get(wall.endNodeId)?.positionMm, `Wall ${wall.id} end`),
    thicknessMm: wall.thicknessMm,
    classification: wall.classification,
  }));
  const floorAreas=project.floorAreaOutlines.filter(outline=>outline.floorId===floorId).map(outline=>({
    id:outline.id,name:sanitizeXmlText(outline.name,"Building area name"),
    vertices:outline.vertices.map(vertex=>planPoint(vertex.positionMm,"Building area vertex")),
  }));
  const routingExclusions=(project.routingExclusions??[]).filter(exclusion=>exclusion.floorId===floorId).map(exclusion=>({
    id:exclusion.id,name:sanitizeXmlText(exclusion.name,"Routing exclusion name"),kind:exclusion.kind,
    geometry:{...exclusion.geometry},heightMode:exclusion.verticalRange.mode,
  }));
  const routes = project.routes.filter((route) => route.floorId === floorId).map((route) => {
    const family = routeFamilyForKind(route.ductKind);
    const geometry = deriveDuctBodyGeometry(route, family);
    return {
      id: route.id,
      scheduleRef: routeRefById.get(route.id) ?? "D??",
      ductKind: route.ductKind,
      familyName: family.name,
      stream: route.stream,
      role: route.role,
      arrangement: geometry.arrangement,
      diameterMm: geometry.diameterMm,
      diameterBasis: geometry.diameterBasis,
      scaled: geometry.scaled,
      elbows: geometry.elbows,
      sampledCentreline: geometry.sampledCentreline.map((point) => planPoint(point, `Route ${route.id} sweep point`)),
      lanes: geometry.lanes.map((lane) => lane.map((point) => planPoint(point, `Route ${route.id} body point`))),
    };
  });
  const components = project.components.filter((component) => component.floorId === floorId).map((component) => ({
    id: component.id,
    scheduleRef: componentRefById.get(component.id) ?? "P??",
    displayName: sanitizeXmlText(component.displayName ?? component.id, "Component display name"),
    catalogueStatus: sanitizeXmlText(component.catalogueStatus ?? "unclassified", "Component status"),
    positionMm: planPoint(component.positionMm, `Component ${component.id} position`),
    yawRad: quaternionYaw(component.orientation),
    symbol: normalizeSymbol(component.displaySymbol),
    planGraphic: deriveComponentPlanGraphic(component),
  }));
  let hasUncalibratedReference = false;
  const references = project.floorReferences.filter((reference) => reference.floorId === floorId && reference.visible).map((reference) => {
    const asset = project.referenceAssets.find((candidate) => candidate.id === reference.assetId);
    if (!asset) throw new TypeError(`Reference asset not found: ${reference.assetId}`);
    const scaleMmPerPixel = referenceScaleMmPerPixel(reference);
    if (scaleMmPerPixel === null) hasUncalibratedReference = true;
    return {
      id: reference.id,
      fileName: sanitizeXmlText(asset.fileName, "Reference filename"),
      dataUrl: asset.dataUrl,
      widthPx: asset.widthPx,
      heightPx: asset.heightPx,
      opacity: reference.opacity,
      cropSourceRectPx: reference.cropSourceRectPx === null ? null : { ...reference.cropSourceRectPx },
      translationMm: planPoint(reference.transform.translationMm, `Reference ${reference.id} translation`),
      rotationRad: reference.transform.rotationRad,
      scaleMmPerPixel,
      displayMmPerPixel: scaleMmPerPixel ?? 1,
      calibrated: scaleMmPerPixel !== null,
    };
  });
  const cadReferences = project.floorCadReferences.filter((reference) => (
    reference.floorId === floorId && reference.visible
  )).map((reference) => {
    const asset = project.cadReferenceAssets.find((candidate) => candidate.id === reference.assetId);
    if (!asset) throw new TypeError(`CAD reference asset not found: ${reference.assetId}`);
    const transformed = transformDxfReferenceGeometry(asset, reference);
    return {
      id: reference.id,
      fileName: sanitizeXmlText(asset.fileName, "CAD reference filename"),
      opacity: reference.opacity,
      includedLayers: [...reference.includedLayers],
      units: reference.units.unit,
      geometry: transformed.geometry,
      boundsMm: transformed.boundsMm,
      partialImportAccepted: asset.partialImportAccepted,
      omittedEntities: asset.counts.omittedEntities,
      diagnosticCount: asset.diagnostics.length,
    };
  });
  const allBounds = [
    ...walls.map(wallBounds),
    ...floorAreas.map(outline=>pointsBounds(outline.vertices)),
    ...routingExclusions.map(exclusion=>({minX:exclusion.geometry.x,minY:exclusion.geometry.y,maxX:exclusion.geometry.x+exclusion.geometry.width,maxY:exclusion.geometry.y+exclusion.geometry.height})),
    ...routes.map(routeBounds),
    ...components.map(componentBounds),
    ...references.map(referenceBounds),
    ...cadReferences.map((reference) => reference.boundsMm),
  ].filter(Boolean);
  return deepFreeze({
    floorId,
    floorName: sanitizeXmlText(floor.name, "Floor name"),
    walls,
    floorAreas,
    routingExclusions,
    routes,
    components,
    hrvCeilingElbows: deriveHrvCeilingElbows(project.routes.filter(route=>route.floorId===floorId),project.components.filter(component=>component.floorId===floorId)),
    references,
    cadReferences,
    legend: buildLegend({ walls, floorAreas, routingExclusions, routes, components, references, cadReferences }),
    hasUncalibratedReference,
    hasPartialCadReference: cadReferences.some((reference) => reference.partialImportAccepted),
    modelBoundsMm: mergeBounds(allBounds),
  });
}

function buildLegend(scene) {
  const legend = [];
  if(scene.floorAreas.length)legend.push({key:"building-area",label:"Building area — preliminary outline"});
  if(scene.routingExclusions?.length)legend.push({key:"routing-exclusion",label:"Routing exclusion — user marked coordination area"});
  if (scene.walls.some((wall) => wall.classification === "physical")) {
    legend.push({ key: "wall", label: "Wall — authoritative model geometry" });
  }
  if (scene.walls.some((wall) => wall.classification === "virtual")) {
    legend.push({ key: "wall-virtual", label: "Virtual wall — authoritative model boundary" });
  }
  for (const [stream, label] of [
    ["supply", "Supply duct — drawing route"],
    ["extract", "Extract duct — drawing route"],
    ["intake", "Outdoor intake duct — drawing route"],
    ["exhaust", "Outdoor exhaust duct — drawing route"],
  ]) {
    if (scene.routes.some((route) => route.stream === stream)) {
      legend.push({ key: `service-${stream}`, label });
    }
  }
  const seen=new Set();
  for(const component of scene.components){
    const g=component.planGraphic;
    const key=g?.graphicId===LUNA_GRILLE_PLAN_GRAPHIC_ID?`luna-${g.stream}`:g?.graphicId===WALL_GRILLE_PLAN_GRAPHIC_ID?`wall-grille-${g.stream}`:g?.graphicId===Q350_PLAN_GRAPHIC_ID || g?.graphicId===CA200_GRAPHIC_ID?`mvhr${g.mountedCw?'cw':''}`:g?.graphicId===STANDALONE_CW_GRAPHIC_ID?`cw-${g.stream}`:g?.graphicId===EXTERNAL_GRILLE_PLAN_GRAPHIC_ID?`external-grille-${g.combined?'combined':g.ports[0]?.stream??'individual'}`:'component';
    if(seen.has(key))continue;seen.add(key);
    const label=key.startsWith('luna')?`Ceiling mounted ${g.stream} grille`:key.startsWith('wall-grille')?`Wall / bulkhead ${g.stream} grille`:key.startsWith('mvhr')?`MVHR unit${g.mountedCw?' with ComfoWell':''}`:key.startsWith('cw-')?`${g.stream} CW attenuator / manifold`:key.startsWith('external-grille-')?(g.combined?'Combined outdoor intake / exhaust grille':`Separate outdoor ${g.ports[0]?.stream??''} grille`):"Placed component — P reference links to parts schedule";
    legend.push({key,label,graphic:g});
  }
  if (scene.references.some((reference) => !reference.calibrated)) {
    legend.push({ key: "reference-uncalibrated", label: "Uncalibrated PNG reference — display only, NTS" });
  }
  if (scene.cadReferences.length > 0) {
    legend.push({ key: "cad-reference", label: "Synthetic AC1015 DXF reference — locked underlay, not walls" });
  }
  if (scene.cadReferences.some((reference) => reference.partialImportAccepted)) {
    legend.push({ key: "cad-reference-warning", label: "DXF reference has accepted unsupported-content omissions" });
  }
  if (legend.length > MAX_LEGEND_ITEMS) {
    throw new RangeError(`Used-symbol legend exceeds the ${MAX_LEGEND_ITEMS}-item A3 title-block limit`);
  }
  return legend;
}

function renderPrintScene(sheet) {
  const scene = sheet.printScene;
  const transform = sheet.fit.transform;
  if (!transform) return renderEmptyDrawing(sheet);
  const out = [];
  for (const reference of scene.references) out.push(renderReference(reference, transform));
  for (const reference of scene.cadReferences) out.push(renderCadReference(reference, transform));
  for(const outline of scene.floorAreas){
    const path=[outline.vertices].map(vertices=>`M ${vertices.map(point=>`${mapX(point.x,transform)} ${mapY(point.y,transform)}`).join(" L ")} Z`).join(" ");
    out.push(`<path data-kind="building-area" data-id="${escapeXml(outline.id)}" d="${path}" fill="#e7b459" fill-opacity="0.05" fill-rule="evenodd" stroke="#a77927" stroke-width="0.4" stroke-dasharray="2 1"><title>${escapeXml(outline.name)} — preliminary building area</title></path>`);
  }
  for(const exclusion of scene.routingExclusions??[]){
    const g=exclusion.geometry;
    out.push(`<rect data-kind="routing-exclusion" data-id="${escapeXml(exclusion.id)}" x="${mapX(g.x,transform)}" y="${mapY(g.y,transform)}" width="${formatNumber(g.width*transform.scale)}" height="${formatNumber(g.height*transform.scale)}" fill="#e6a15f" fill-opacity="0.18" stroke="#a5521d" stroke-width="0.5" stroke-dasharray="2 1"><title>${escapeXml(exclusion.name)} — ${escapeXml(exclusion.kind)} — ${escapeXml(exclusion.heightMode)}</title></rect>`);
  }
  for (const wall of scene.walls) {
    const dash = wall.classification === "virtual" ? ' stroke-dasharray="2 1.2"' : "";
    out.push(`<line data-kind="wall" data-wall-classification="${escapeXml(wall.classification)}" data-id="${escapeXml(wall.id)}" x1="${mapX(wall.start.x, transform)}" y1="${mapY(wall.start.y, transform)}" x2="${mapX(wall.end.x, transform)}" y2="${mapY(wall.end.y, transform)}" stroke="#26373f" stroke-width="${formatNumber(Math.max(0.35, wall.thicknessMm * transform.scale))}" stroke-linecap="square"${dash}/>`);
  }
  for (const route of scene.routes.filter(route=>!/^epp-rigid-dn/.test(route.ductKind) && route.ductKind!=="semi-rigid-radial")) out.push(withoutDrawingLabels(renderRoute(route, transform)));
  for (const component of scene.components.filter(component => component.planGraphic?.graphicId !== LUNA_GRILLE_PLAN_GRAPHIC_ID)) out.push(withoutDrawingLabels(renderComponent(component, transform)));
  for (const route of scene.routes.filter(route=>/^epp-rigid-dn/.test(route.ductKind) || route.ductKind==="semi-rigid-radial")) out.push(withoutDrawingLabels(renderRoute(route, transform)));
  for(const elbow of scene.hrvCeilingElbows??[]) {
    const shapes=hrvCeilingElbowShapes(elbow).map(shape=>`<${shape.tag} ${Object.entries(shape.attributes).map(([key,value])=>`${key}="${escapeXml(String(value))}"`).join(" ")}/>`).join("");
    out.push(withoutDrawingLabels(`<g data-kind="hrv-ceiling-elbow" data-route-id="${escapeXml(elbow.routeId)}" transform="translate(${mapX(elbow.xMm,transform)} ${mapY(elbow.yMm,transform)}) rotate(${formatNumber(elbow.angleDegrees)}) scale(${formatNumber(transform.scale)})">${shapes}</g><text x="${mapX(elbow.xMm,transform)}" y="${formatNumber(Number(mapY(elbow.yMm-elbow.nominalSizeMm/2,transform))-1)}" font-size="2" text-anchor="middle" fill="#29434d">90° ↑</text>`));
  }
  for (const component of scene.components.filter(component => component.planGraphic?.graphicId === LUNA_GRILLE_PLAN_GRAPHIC_ID)) out.push(withoutDrawingLabels(renderComponent(component, transform)));
  if (scene.references.some((reference) => !reference.calibrated)) {
    out.push(`<text x="${formatNumber(sheet.drawingBounds.xMm + 4)}" y="${formatNumber(sheet.drawingBounds.yMm + sheet.drawingBounds.heightMm - 4)}" fill="#a14a2b" font-size="3.2">UNCALIBRATED REFERENCE · DISPLAY ONLY · NOT TO SCALE</text>`);
  }
  if (scene.hasPartialCadReference) {
    const warningY = sheet.drawingBounds.yMm + sheet.drawingBounds.heightMm - (
      scene.references.some((reference) => !reference.calibrated) ? 8 : 4
    );
    out.push(`<text data-kind="cad-reference-warning" x="${formatNumber(sheet.drawingBounds.xMm + 4)}" y="${formatNumber(warningY)}" fill="#a14a2b" font-size="3.2">DXF REFERENCE · UNSUPPORTED CONTENT OMITTED · REVIEW DIAGNOSTICS</text>`);
  }
  return out.join("");
}

function withoutDrawingLabels(svg) {
  return svg.replace(/<text\b[^>]*>[\s\S]*?<\/text>/g, "");
}

function renderRoute(route, transform) {
  const color = routeServiceColor(route.stream);
  const dash = route.arrangement === "unset"
    ? ' stroke-dasharray="2.2 1.4"'
    : route.ductKind === "semi-rigid-radial"
      ? ' stroke-dasharray="2.2 1.2"'
      : route.ductKind === "flexible-round-dn150"
        ? ' stroke-dasharray="3 1 0.6 1"'
        : "";
  const bodyWidth = route.scaled
    ? Math.max(0.45, route.diameterMm * transform.scale)
    : 0.55;
  const out = [`<g data-kind="route" data-route-kind="${escapeXml(route.ductKind)}" data-route-arrangement="${escapeXml(route.arrangement)}" data-service="${escapeXml(route.stream)}" data-id="${escapeXml(route.id)}" data-schedule-ref="${escapeXml(route.scheduleRef)}">`];
  for (const lane of route.lanes) {
    const points = sheetPointString(lane, transform);
    out.push(`<polyline data-kind="route-underlay" points="${points}" fill="none" stroke="white" stroke-width="${formatNumber(bodyWidth + 0.9)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    out.push(`<polyline data-kind="route-body" points="${points}" fill="none" stroke="${color}" stroke-opacity="${route.arrangement === "unset" ? "0.38" : "0.66"}" stroke-width="${formatNumber(bodyWidth)}" stroke-linecap="round" stroke-linejoin="round"${dash}/>`);
  }
  const axisPoints = sheetPointString(route.sampledCentreline, transform);
  out.push(`<polyline data-kind="route-axis" points="${axisPoints}" fill="none" stroke="${color}" stroke-width="0.38" stroke-linecap="round" stroke-linejoin="round"${dash}/>`);
  for (const elbow of route.elbows ?? []) {
    for (const seam of elbow.seams) out.push(`<line data-kind="epp-elbow-joint" x1="${mapX(seam.a.x,transform)}" y1="${mapY(seam.a.y,transform)}" x2="${mapX(seam.b.x,transform)}" y2="${mapY(seam.b.y,transform)}" stroke="#263f46" stroke-width="0.25"/>`);
    if (elbow.halfCutGuide) {
      const cut = elbow.halfCutGuide;
      out.push(`<line data-kind="epp-half-cut-guide" x1="${mapX(cut.a.x,transform)}" y1="${mapY(cut.a.y,transform)}" x2="${mapX(cut.b.x,transform)}" y2="${mapY(cut.b.y,transform)}" stroke="#263f46" stroke-width="0.2" stroke-dasharray="0.7 0.4"/>`);
    }
    out.push(`<text data-kind="epp-bend-angle" x="${mapX(elbow.vertex.x,transform)}" y="${formatNumber(Number(mapY(elbow.vertex.y,transform))-2)}" font-size="2" fill="#263f46" stroke="white" stroke-width="0.6" paint-order="stroke">${elbow.drawable ? `${elbow.angleDegrees}°` : "Review bend"}</text>`);
  }
  const labelPoint = route.sampledCentreline[Math.floor((route.sampledCentreline.length - 1) / 2)];
  if (labelPoint) {
    const label = `${route.scheduleRef} · ${serviceLabel(route.stream)} · ${route.arrangement === "twin" ? "Twin" : route.arrangement === "single" ? "Single" : "Not set"}`;
    out.push(`<text data-kind="route-label" x="${mapX(labelPoint.x, transform)}" y="${formatNumber(Number(mapY(labelPoint.y, transform)) - 2.2)}" text-anchor="middle" fill="${color}" stroke="white" stroke-width="0.9" paint-order="stroke" font-size="2.4" font-weight="700">${escapeXml(label)}</text>`);
  }
  out.push("</g>");
  return out.join("");
}

function renderReference(reference, transform) {
  const cosine = Math.cos(reference.rotationRad);
  const sine = Math.sin(reference.rotationRad);
  const scale = reference.displayMmPerPixel * transform.scale;
  const a = cosine * scale;
  const b = sine * scale;
  const c = -sine * scale;
  const d = cosine * scale;
  const e = transform.offsetX + reference.translationMm.x * transform.scale;
  const f = transform.offsetY + reference.translationMm.y * transform.scale;
  const calibration = reference.calibrated ? "calibrated" : "uncalibrated-display-only";
  const matrix = [a, b, c, d, e, f].map(formatNumber).join(" ");
  const image = `<image data-kind="reference" data-calibration="${calibration}" data-id="${escapeXml(reference.id)}" href="${rasterDataUrl(reference.dataUrl)}" width="${reference.widthPx}" height="${reference.heightPx}" opacity="${formatNumber(reference.opacity)}" preserveAspectRatio="none"`;
  if (!reference.cropSourceRectPx) return `${image} transform="matrix(${matrix})"/>`;
  const crop = reference.cropSourceRectPx;
  const clipId = `sheet-reference-crop-${reference.id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  return `<g data-kind="cropped-reference" transform="matrix(${matrix})"><defs><clipPath id="${escapeXml(clipId)}" clipPathUnits="userSpaceOnUse"><rect x="${formatNumber(crop.x)}" y="${formatNumber(crop.y)}" width="${formatNumber(crop.width)}" height="${formatNumber(crop.height)}"/></clipPath></defs>${image} data-crop="${[crop.x, crop.y, crop.width, crop.height].map(formatNumber).join(" ")}" clip-path="url(#${escapeXml(clipId)})"/></g>`;
}

function renderCadReference(reference, transform) {
  const warning = reference.partialImportAccepted ? "partial" : "complete";
  const body = reference.geometry.map((item) => renderCadGeometry(item, transform)).join("");
  return `<g data-kind="cad-reference" data-id="${escapeXml(reference.id)}" data-import-state="${warning}" data-source-units="${escapeXml(reference.units)}" data-layers="${escapeXml(reference.includedLayers.join(","))}" opacity="${formatNumber(reference.opacity)}">${body}</g>`;
}

function renderCadGeometry(item, transform) {
  const attributes = `data-cad-kind="${escapeXml(item.kind)}" data-cad-layer="${escapeXml(item.layer)}" data-source-handle="${escapeXml(item.sourceHandle ?? "")}"`;
  if (item.kind === "line") {
    return `<line ${attributes} x1="${mapX(item.start.x, transform)}" y1="${mapY(item.start.y, transform)}" x2="${mapX(item.end.x, transform)}" y2="${mapY(item.end.y, transform)}" fill="none" stroke="#657d86" stroke-width="0.35"/>`;
  }
  if (item.kind === "lwpolyline") {
    return `<path ${attributes} d="${dxfPolylinePath(item.vertices, item.closed, transform)}" fill="none" stroke="#657d86" stroke-width="0.35"/>`;
  }
  if (item.kind === "circle") {
    return `<circle ${attributes} cx="${mapX(item.center.x, transform)}" cy="${mapY(item.center.y, transform)}" r="${formatNumber(item.radiusMm * transform.scale)}" fill="none" stroke="#657d86" stroke-width="0.35"/>`;
  }
  if (item.kind === "arc") {
    return `<path ${attributes} d="${dxfArcPath(item.center, item.radiusMm, item.startAngleRad, item.endAngleRad, transform)}" fill="none" stroke="#657d86" stroke-width="0.35"/>`;
  }
  const x = mapX(item.insertion.x, transform);
  const y = mapY(item.insertion.y, transform);
  const angle = item.rotationRad * 180 / Math.PI;
  return `<text ${attributes} x="${x}" y="${y}" transform="rotate(${formatNumber(angle)} ${x} ${y})" font-size="${formatNumber(Math.max(1.5, item.heightMm * transform.scale))}" fill="#657d86">${escapeXml(item.text)}</text>`;
}

function dxfArcPath(center, radius, startAngle, endAngle, transform) {
  const start = { x: center.x + radius * Math.cos(startAngle), y: center.y + radius * Math.sin(startAngle) };
  const end = { x: center.x + radius * Math.cos(endAngle), y: center.y + radius * Math.sin(endAngle) };
  const delta = positiveAngleDelta(startAngle, endAngle);
  const sheetRadius = formatNumber(radius * transform.scale);
  return `M ${mapX(start.x, transform)} ${mapY(start.y, transform)} A ${sheetRadius} ${sheetRadius} 0 ${delta > Math.PI ? 1 : 0} 1 ${mapX(end.x, transform)} ${mapY(end.y, transform)}`;
}

function dxfPolylinePath(vertices, closed, transform) {
  if (!vertices.length) return "";
  const commands = [`M ${mapX(vertices[0].x, transform)} ${mapY(vertices[0].y, transform)}`];
  const segmentCount = closed ? vertices.length : vertices.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    if (Math.abs(start.bulge) < 1e-12) {
      commands.push(`L ${mapX(end.x, transform)} ${mapY(end.y, transform)}`);
      continue;
    }
    const chord = Math.hypot(end.x - start.x, end.y - start.y);
    const radius = chord * (1 + start.bulge ** 2) / (4 * Math.abs(start.bulge));
    const includedAngle = 4 * Math.atan(start.bulge);
    const sheetRadius = formatNumber(radius * transform.scale);
    commands.push(`A ${sheetRadius} ${sheetRadius} 0 ${Math.abs(includedAngle) > Math.PI ? 1 : 0} ${start.bulge > 0 ? 1 : 0} ${mapX(end.x, transform)} ${mapY(end.y, transform)}`);
  }
  if (closed) commands.push("Z");
  return commands.join(" ");
}

function positiveAngleDelta(start, end) {
  const delta = (end - start) % (Math.PI * 2);
  return delta < 0 ? delta + Math.PI * 2 : delta;
}

function renderComponent(component, transform) {
  const x = mapX(component.positionMm.x, transform);
  const y = mapY(component.positionMm.y, transform);
  const angle = component.yawRad * 180 / Math.PI;
  if (component.planGraphic?.graphicId === Q350_PLAN_GRAPHIC_ID) {
    return renderQ350Component(component, transform, x, y, angle);
  }
  if (component.planGraphic?.graphicId === GENERIC_CW_PLAN_GRAPHIC_ID) {
    return renderGenericCwComponent(component, transform, x, y, angle);
  }
  if(component.planGraphic?.graphicId===CA200_GRAPHIC_ID) {
    const graphic=component.planGraphic;
    const shapes=ca200Shapes(graphic).map(shape=>`<${shape.tag} ${Object.entries(shape.attributes).map(([key,value])=>`${key}="${escapeXml(String(value))}"`).join(" ")}>${shape.text?escapeXml(shape.text):""}</${shape.tag}>`).join("");
    return `<g data-kind="component" data-id="${escapeXml(component.id)}" data-plan-graphic="${graphic.graphicId}" transform="translate(${x} ${y}) rotate(${formatNumber(angle)})"><g transform="scale(${formatNumber(transform.scale)})">${shapes}</g><text x="0" y="${formatNumber(graphic.depthMm*transform.scale/2+5)}" text-anchor="middle" font-size="2.7" fill="#29434d">${escapeXml(component.scheduleRef)} · CA200 · ${graphic.handing}</text></g>`;
  }
  if(component.planGraphic?.graphicId===STANDALONE_CW_GRAPHIC_ID) {
    const graphic=component.planGraphic;
    const shapes=standaloneCwShapes(graphic).map(shape=>`<${shape.tag} ${Object.entries(shape.attributes).map(([key,value])=>`${key}="${escapeXml(String(value))}"`).join(" ")}>${shape.text?escapeXml(shape.text):""}</${shape.tag}>`).join("");
    return `<g data-kind="component" data-id="${escapeXml(component.id)}" data-plan-graphic="${graphic.graphicId}" transform="translate(${x} ${y}) rotate(${formatNumber(angle)})"><g transform="scale(${formatNumber(transform.scale)})">${shapes}</g><text x="0" y="${formatNumber(graphic.depthMm*transform.scale/2+5)}" text-anchor="middle" font-size="2.7" fill="#29434d">${escapeXml(component.scheduleRef)} · ${graphic.stream}</text></g>`;
  }
  if(component.planGraphic?.graphicId===EXTERNAL_GRILLE_PLAN_GRAPHIC_ID) {
    const graphic=component.planGraphic;
    const shapes=externalGrilleShapes(graphic).map(shape=>`<${shape.tag} ${Object.entries(shape.attributes).map(([key,value])=>`${key}="${escapeXml(String(value))}"`).join(" ")}>${shape.text?escapeXml(shape.text):""}</${shape.tag}>`).join("");
    return `<g data-kind="component" data-id="${escapeXml(component.id)}" data-plan-graphic="${graphic.graphicId}" data-external-grille-handing="${graphic.handing}" transform="translate(${x} ${y}) rotate(${formatNumber(angle)})"><g transform="scale(${formatNumber(transform.scale)})">${shapes}</g><text x="0" y="${formatNumber(graphic.depthMm*transform.scale/2+3)}" text-anchor="middle" font-size="2.7" fill="#29434d">${escapeXml(component.scheduleRef)}</text></g>`;
  }
  if ([WALL_GRILLE_PLAN_GRAPHIC_ID, LUNA_GRILLE_PLAN_GRAPHIC_ID].includes(component.planGraphic?.graphicId)) {
    const graphic = component.planGraphic;
    return `<g data-kind="component" data-id="${escapeXml(component.id)}" data-plan-graphic="${graphic.graphicId}" data-service="${graphic.stream}" transform="translate(${x} ${y}) rotate(${formatNumber(angle)})"><g transform="scale(${formatNumber(transform.scale)})" fill="none" stroke="${graphic.colour}" stroke-width="1.5" vector-effect="non-scaling-stroke">${graphic.paths.map((d, index) => `<path d="${d}" fill="${graphic.graphicId === LUNA_GRILLE_PLAN_GRAPHIC_ID && index === 0 ? "white" : "none"}" stroke-width="${graphic.strokeWidths?.[index] ?? 1.5}" vector-effect="non-scaling-stroke"/>`).join("")}</g><text x="0" y="${formatNumber(graphic.depthMm * transform.scale / 2 + 3)}" text-anchor="middle" fill="#29434d" font-size="2.7">${escapeXml(component.scheduleRef)}</text></g>`;
  }
  const width = component.symbol.widthMm * transform.scale;
  const height = component.symbol.heightMm * transform.scale;
  const shape = component.symbol.shape === "circle"
    ? `<circle cx="0" cy="0" r="${formatNumber(width / 2)}"/>`
    : `<rect x="${formatNumber(-width / 2)}" y="${formatNumber(-height / 2)}" width="${formatNumber(width)}" height="${formatNumber(height)}"/>`;
  return `<g data-kind="component" data-id="${escapeXml(component.id)}" data-schedule-ref="${escapeXml(component.scheduleRef)}" transform="translate(${x} ${y}) rotate(${formatNumber(angle)})" fill="white" stroke="#2f5966" stroke-width="0.45">${shape}<text x="0" y="0.9" text-anchor="middle" fill="#29434d" stroke="none" font-size="2.7" font-weight="700">${escapeXml(component.scheduleRef)}</text></g>`;
}

function renderQ350Component(component, transform, x, y, angle) {
  const graphic = component.planGraphic;
  const scale = transform.scale;
  const panel = graphic.centrePanel;
  const out = [
    `<g data-kind="component" data-plan-graphic="${escapeXml(graphic.graphicId)}" data-q350-handing="${escapeXml(graphic.handing)}" data-id="${escapeXml(component.id)}" data-schedule-ref="${escapeXml(component.scheduleRef)}" transform="translate(${x} ${y}) rotate(${formatNumber(angle)})">`,
    `<g transform="scale(${formatNumber(scale)})">`,
    `<path d="${q350CasingPath(graphic)}" fill="#f7f9f9" stroke="#2f5966" stroke-width="${formatNumber(18)}"/>`,
    `<rect x="${formatNumber(-graphic.widthMm / 2 + 14)}" y="${formatNumber(-graphic.depthMm / 2 + 14)}" width="${formatNumber(graphic.widthMm - 28)}" height="${formatNumber(graphic.depthMm - 43)}" rx="20" fill="#eef1f1" stroke="#9ba9ad" stroke-width="8"/>`,
    `<rect x="${formatNumber(panel.xMm)}" y="${formatNumber(panel.yMm)}" width="${formatNumber(panel.widthMm)}" height="${formatNumber(panel.heightMm)}" rx="${formatNumber(panel.cornerRadiusMm)}" fill="#d6dcdd" stroke="#788b91" stroke-width="6"/>`,
    `<line x1="${formatNumber(panel.xMm)}" y1="${formatNumber(panel.yMm + 20)}" x2="${formatNumber(panel.xMm)}" y2="${formatNumber(panel.yMm + panel.heightMm - 20)}" stroke="#a8b3b6" stroke-width="5"/>`,
    `<line x1="${formatNumber(panel.xMm + panel.widthMm)}" y1="${formatNumber(panel.yMm + 20)}" x2="${formatNumber(panel.xMm + panel.widthMm)}" y2="${formatNumber(panel.yMm + panel.heightMm - 20)}" stroke="#a8b3b6" stroke-width="5"/>`,
  ];
  for (const port of graphic.ports) {
    if (graphic.mountedCw && ["supply", "extract"].includes(port.stream)) continue;
    const outsideDiameterMm = port.displayOutsideDiameterMm ?? port.outsideDiameterMm ?? port.nominalDiameterMm;
    const boreDiameterMm = port.boreDiameterMm ?? port.nominalDiameterMm;
    if (outsideDiameterMm) {
      out.push(`<circle data-q350-port-role="${escapeXml(port.role)}" cx="${formatNumber(port.xMm)}" cy="${formatNumber(port.yMm)}" r="${formatNumber(outsideDiameterMm / 2)}" fill="#536168" stroke="#24343a" stroke-width="7"/>`);
    }
    if (boreDiameterMm) {
      out.push(`<circle cx="${formatNumber(port.xMm)}" cy="${formatNumber(port.yMm)}" r="${formatNumber(boreDiameterMm / 2)}" fill="${routeServiceColor(port.stream)}" fill-opacity="0.42" stroke="#f4f7f7" stroke-width="5"/>`);
    }
  }
  out.push(
    `<line x1="0" y1="${formatNumber(graphic.frontCue.yMm - 34)}" x2="0" y2="${formatNumber(graphic.frontCue.arrowTipYmm)}" stroke="#445960" stroke-width="6"/>`,
    `<path d="M -10 ${formatNumber(graphic.frontCue.arrowTipYmm - 15)} L 0 ${formatNumber(graphic.frontCue.arrowTipYmm)} L 10 ${formatNumber(graphic.frontCue.arrowTipYmm - 15)} Z" fill="#445960"/>`,
    `<rect x="${formatNumber(graphic.badge.xMm)}" y="${formatNumber(graphic.badge.yMm)}" width="${formatNumber(graphic.badge.widthMm)}" height="${formatNumber(graphic.badge.heightMm)}" rx="2" fill="#d83536"/>`,
    ...mountedCwShapes(graphic).map(shape => `<${shape.tag} ${Object.entries(shape.attributes).map(([key,value]) => `${key}="${escapeXml(String(value))}"`).join(" ")}/>`),
    "</g>",
  );
  for (const port of graphic.ports) {
    if (graphic.mountedCw && ["supply", "extract"].includes(port.stream)) continue;
    const layout = q350PortLabelLayout(port);
    out.push(`<line x1="${formatNumber(layout.leaderStartXmm*scale)}" y1="${formatNumber(layout.yMm*scale)}" x2="${formatNumber(layout.leaderEndXmm*scale)}" y2="${formatNumber(layout.yMm*scale)}" stroke="#52666e" stroke-width="0.2"/>`);
    out.push(`<text data-kind="q350-port-code" x="${formatNumber(layout.xMm * scale)}" y="${formatNumber(layout.yMm * scale)}" dominant-baseline="middle" text-anchor="${layout.anchor}" fill="#182d35" stroke="white" stroke-width="0.45" paint-order="stroke" font-size="1.45" font-weight="800">${escapeXml(port.code)}</text>`);
  }
  out.push(
    `<text x="0" y="0.65" text-anchor="middle" fill="#29434d" stroke="white" stroke-width="0.55" paint-order="stroke" font-size="1.9" font-weight="800">${escapeXml(component.scheduleRef)}</text>`,
    `<text x="0" y="2.35" text-anchor="middle" fill="#52666e" stroke="white" stroke-width="0.45" paint-order="stroke" font-size="1.3" font-weight="800">${escapeXml(graphic.shortModelName ?? "Q350")} ${escapeXml(graphic.handingLabel)}</text>`,
    `<text x="0" y="${formatNumber((graphic.frontCue.yMm - 42) * scale)}" text-anchor="middle" fill="#445960" stroke="white" stroke-width="0.35" paint-order="stroke" font-size="1.1" font-weight="800">FRONT</text>`,
    "</g>",
  );
  return out.join("");
}

function renderGenericCwComponent(component, transform, x, y, angle) {
  const graphic = component.planGraphic;
  const scale = transform.scale;
  const halfWidth = graphic.widthMm / 2;
  const halfDepth = graphic.depthMm / 2;
  const inset = graphic.casingInsetMm;
  const out = [
    `<g data-kind="component" data-plan-graphic="${escapeXml(graphic.graphicId)}" data-generic-cw-part="${escapeXml(graphic.partType)}" data-generic-cw-service="${escapeXml(graphic.stream)}" data-generic-cw-status="provisional" data-id="${escapeXml(component.id)}" data-schedule-ref="${escapeXml(component.scheduleRef)}" transform="translate(${x} ${y}) rotate(${formatNumber(angle)})">`,
    `<g transform="scale(${formatNumber(scale)})">`,
    `<rect x="${formatNumber(-halfWidth)}" y="${formatNumber(-halfDepth)}" width="${formatNumber(graphic.widthMm)}" height="${formatNumber(graphic.depthMm)}" rx="8" fill="#f2f5f5" stroke="#3b555e" stroke-width="5"/>`,
    `<rect x="${formatNumber(-halfWidth + inset)}" y="${formatNumber(-halfDepth + inset)}" width="${formatNumber(graphic.widthMm - inset * 2)}" height="${formatNumber(graphic.depthMm - inset * 2)}" rx="5" fill="#dce2e3" stroke="#87979c" stroke-width="4"/>`,
  ];
  for (const xMm of [-halfWidth + graphic.railWidthMm, halfWidth - graphic.railWidthMm]) {
    out.push(`<line x1="${formatNumber(xMm)}" y1="${formatNumber(-halfDepth + 8)}" x2="${formatNumber(xMm)}" y2="${formatNumber(halfDepth - 8)}" stroke="#61757c" stroke-width="9"/>`);
  }
  if (graphic.partType === "attenuator" || graphic.partType === "combined") {
    out.push(
      `<rect x="${formatNumber(-halfWidth + 42)}" y="${formatNumber(-halfDepth + 38)}" width="${formatNumber(graphic.widthMm - 84)}" height="${formatNumber(graphic.depthMm - 76)}" rx="10" fill="#e9eded" stroke="#798c92" stroke-width="5"/>`,
      `<line x1="${formatNumber(-halfWidth + 55)}" y1="${formatNumber(-halfDepth + 54)}" x2="${formatNumber(-halfWidth + 55)}" y2="${formatNumber(halfDepth - 54)}" stroke="#a4b0b3" stroke-width="4"/>`,
      `<line x1="${formatNumber(halfWidth - 55)}" y1="${formatNumber(-halfDepth + 54)}" x2="${formatNumber(halfWidth - 55)}" y2="${formatNumber(halfDepth - 54)}" stroke="#a4b0b3" stroke-width="4"/>`,
    );
  }
  for (const port of graphic.ports) {
    if (port.family === "rigid-epp") {
      const radius = port.outsideDiameterMm ? port.outsideDiameterMm / 2 : 28;
      out.push(
        `<circle data-generic-cw-port-role="${escapeXml(port.role)}" data-diameter-basis="${port.outsideDiameterMm ? "outside-diameter" : "symbolic-not-outside-diameter"}" cx="${formatNumber(port.xMm)}" cy="${formatNumber(port.yMm)}" r="${formatNumber(radius)}" fill="#526168" stroke="#263a42" stroke-width="7"/>`,
        `<circle cx="${formatNumber(port.xMm)}" cy="${formatNumber(port.yMm)}" r="${formatNumber(Math.max(12, radius - 9))}" fill="${routeServiceColor(port.stream)}" fill-opacity="0.58" stroke="#f3f6f6" stroke-width="5"/>`,
      );
    } else if (port.family === "semi-rigid-pe") {
      out.push(`<circle data-generic-cw-radial-port="${escapeXml(port.id ?? "")}" cx="${formatNumber(port.xMm)}" cy="${formatNumber(port.yMm)}" r="17" fill="${routeServiceColor(port.stream)}" fill-opacity="0.62" stroke="#394e56" stroke-width="5"/>`);
    }
  }
  if (graphic.partType === "attenuator" || graphic.partType === "combined") {
    const arrowStart = -34 * graphic.flowDirectionX;
    const arrowEnd = 34 * graphic.flowDirectionX;
    out.push(
      `<line x1="${formatNumber(arrowStart)}" y1="60" x2="${formatNumber(arrowEnd)}" y2="60" stroke="#52676f" stroke-width="6"/>`,
      `<path d="M ${formatNumber(arrowEnd - 12 * graphic.flowDirectionX)} 50 L ${formatNumber(arrowEnd)} 60 L ${formatNumber(arrowEnd - 12 * graphic.flowDirectionX)} 70 Z" fill="#52676f"/>`,
    );
  }
  out.push("</g>");
  if (graphic.partType === "attenuator" || graphic.partType === "combined") {
    out.push(
      `<text x="0" y="-1.35" text-anchor="middle" fill="#52676f" stroke="white" stroke-width="0.35" paint-order="stroke" font-size="1.05" font-weight="800">GENERIC · PROVISIONAL</text>`,
      `<text x="0" y="0.15" text-anchor="middle" fill="#233b44" stroke="white" stroke-width="0.4" paint-order="stroke" font-size="1.25" font-weight="900">${escapeXml(component.scheduleRef)} · ${escapeXml(genericCwSheetPartLabel(graphic.partType))}</text>`,
      `<text x="0" y="1.65" text-anchor="middle" fill="${routeServiceColor(graphic.stream)}" stroke="white" stroke-width="0.35" paint-order="stroke" font-size="1.05" font-weight="800">${escapeXml(graphic.serviceLabel)}</text>`,
    );
  } else {
    out.push(`<text x="0" y="0.3" text-anchor="middle" transform="rotate(90)" fill="#233b44" stroke="white" stroke-width="0.35" paint-order="stroke" font-size="0.95" font-weight="900">${escapeXml(component.scheduleRef)} · ${escapeXml(genericCwSheetPartLabel(graphic.partType))}</text>`);
  }
  out.push("</g>");
  return out.join("");
}

function genericCwSheetPartLabel(partType) {
  if (partType === "round-end-plate") return "MAIN PLATE";
  if (partType === "attenuator") return "ATTENUATOR";
  if (partType === "radial-plate") return "6×DN90 PLATE";
  return "ATTENUATOR / MANIFOLD";
}

function renderWatermark(sheet) {
  const drawing = sheet.drawingBounds;
  const centerX = drawing.xMm + drawing.widthMm / 2;
  const centerY = drawing.yMm + drawing.heightMm / 2;
  return `<text data-kind="draft-watermark" clip-path="url(#drawing-clip)" x="${formatNumber(centerX)}" y="${formatNumber(centerY)}" text-anchor="middle" transform="rotate(-28 ${formatNumber(centerX)} ${formatNumber(centerY)})" fill="#c34d35" fill-opacity="0.11" font-size="17" font-weight="700">DRAFT PREVIEW · NOT FOR CONSTRUCTION</text>`;
}

function renderPartsSchedule(sheet) {
  const bounds = sheet.scheduleBounds;
  const schedule = sheet.partsSchedule;
  const x = bounds.xMm;
  const y = bounds.yMm;
  const columns = [x + 3, x + 19, x + 39, x + 143, x + 219];
  const rows = [
    ...schedule.componentLines.map((line) => ({
      ref: line.ref,
      kind: "PART",
      description: line.description,
      identifier: line.manufacturerArticle
        ? `${line.productId ?? "Local ID pending"} · art ${line.manufacturerArticle}`
        : line.productId ?? "Unmatched product",
      quantity: `${line.quantity} · ${scheduleEvidenceLabel(line.evidenceClass)}`,
    })),
    ...schedule.routeLines.map((line) => ({
      ref: line.ref,
      kind: "DUCT",
      description: `${serviceLabel(line.stream)} · ${line.description}`,
      identifier: `${line.nominalSizeMm ? `DN${line.nominalSizeMm}` : "size pending"} · S${line.arrangements.single.routeCount}/T${line.arrangements.twin.routeCount}/U${line.arrangements.unset.routeCount}`,
      quantity: line.pendingParallelRunRouteCount > 0
        ? `${formatMetres(line.knownMultipliedPlanMm)} known + ${line.pendingParallelRunRouteCount} unset`
        : `${formatMetres(line.knownMultipliedPlanMm)} plan qty`,
    })),
  ];
  for (const line of schedule.eppTakeoff) {
    rows.push({ ref: "EPP", kind: "ALLOW", description: `DN${line.nominalSizeMm} ${serviceLabel(line.stream)} · ${line.routeId}`,
      identifier: line.basis === "plan-only-allowance" ? "Plan only; rises/bends pending" : "Centreline; no fitting deductions",
      quantity: line.stockLengthQuantity === null ? "Run count pending" : `${line.stockLengthQuantity}x1m / ${line.elbow90Quantity}x90 ${line.elbow45Quantity}x45 / ${line.extraSleeveQuantity} sleeves${line.otherBendQuantity ? " + review bends" : ""}` });
  }
  for (const line of schedule.eppUnitConnectionAllowances) rows.push({ref:"HRV",kind:"ALLOW",description:`DN${line.nominalSizeMm} ${serviceLabel(line.stream)} · ${line.componentId}`,
    identifier:"Unit to ceiling; heights pending",quantity:"1x1m / 1x90 / 4 sleeves"});
  for (const stock of schedule.eppElbowStock) rows.push({ref:"EPP",kind:"STOCK",description:`DN${stock.nominalSizeMm} 90° elbow stock`,identifier:"45° = half of 90° elbow",quantity:`${stock.elbow90StockQuantity} elbows / ${stock.spareHalfQuantity} spare half${stock.pendingRouteCount ? " + pending" : ""}`});
  const visibleRows = rows.slice(0, MAX_SHEET_SCHEDULE_LINES);
  const omittedCount = rows.length - visibleRows.length;
  if (omittedCount > 0) {
    visibleRows[visibleRows.length - 1] = {
      ref: "…",
      kind: "MORE",
      description: `${omittedCount + 1} additional schedule lines`,
      identifier: "See in-app schedule",
      quantity: "Not omitted from model",
    };
  }

  const out = [`<g id="parts-schedule" data-kind="parts-schedule">`];
  out.push(`<rect x="${x}" y="${y}" width="${bounds.widthMm}" height="${bounds.heightMm}" fill="white" stroke="#17242b" stroke-width="0.5"/>`);
  out.push(`<text x="${x + 3}" y="${y + 5}" font-size="3.5" font-weight="700" fill="#17242b">MODEL PARTS &amp; MEASURED DUCT SCHEDULE</text>`);
  out.push(`<text x="${x + bounds.widthMm - 3}" y="${y + 5}" text-anchor="end" font-size="2.2" fill="#6a7478">DRAWING QUANTITIES · NOT A PROCUREMENT BOM</text>`);
  out.push(`<line x1="${x}" y1="${y + 8}" x2="${x + bounds.widthMm}" y2="${y + 8}" stroke="#687880" stroke-width="0.25"/>`);
  for (let index = 1; index < columns.length; index += 1) {
    out.push(`<line x1="${columns[index] - 2}" y1="${y + 8}" x2="${columns[index] - 2}" y2="${y + bounds.heightMm - 11}" stroke="#c4ced2" stroke-width="0.2"/>`);
  }
  const headerY = y + 12;
  for (const [index, label] of ["REF", "TYPE", "DESCRIPTION", "ID / ARTICLE", "QUANTITY / BASIS"].entries()) {
    out.push(`<text x="${columns[index]}" y="${headerY}" font-size="2.2" font-weight="700" fill="#52646c">${label}</text>`);
  }
  let cursorY = y + 16;
  if (visibleRows.length === 0) {
    out.push(`<text x="${x + 3}" y="${cursorY}" font-size="2.5" fill="#6a7478">No placed ventilation parts or measured duct routes on this floor.</text>`);
  }
  for (const row of visibleRows) {
    out.push(`<line x1="${x}" y1="${cursorY - 2.8}" x2="${x + bounds.widthMm}" y2="${cursorY - 2.8}" stroke="#e0e6e8" stroke-width="0.18"/>`);
    const values = [
      row.ref,
      row.kind,
      wrapSheetText(row.description, 58, 1)[0],
      wrapSheetText(row.identifier, 38, 1)[0],
      wrapSheetText(row.quantity, 40, 1)[0],
    ];
    for (let index = 0; index < values.length; index += 1) {
      out.push(`<text x="${columns[index]}" y="${cursorY}" font-size="2.35" fill="#263b43">${escapeXml(values[index])}</text>`);
    }
    cursorY += 4;
  }
  out.push(`<line x1="${x}" y1="${y + bounds.heightMm - 11}" x2="${x + bounds.widthMm}" y2="${y + bounds.heightMm - 11}" stroke="#687880" stroke-width="0.25"/>`);
  out.push(`<text x="${x + 3}" y="${y + bounds.heightMm - 7}" font-size="2.15" fill="#5d6d74">Lengths use the saved centreline × Single/Twin. Display sweeps, bends, fittings, allowances and waste are excluded.</text>`);
  out.push(`<text x="${x + 3}" y="${y + bounds.heightMm - 3}" font-size="2.15" fill="#a14a2b">Provisional/unmatched items require product, regional availability and compatibility review before ordering or construction.</text>`);
  out.push("</g>");
  return out.join("");
}

function renderSheetLegend(sheet,bounds){
 const {xMm:x,yMm:y,widthMm:w,heightMm:h}=bounds;
 const out=[`<g id="sheet-key"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white" stroke="#687880" stroke-width="0.3"/><text x="${x+w/2}" y="${y+8}" text-anchor="middle" font-size="4" font-weight="700">SYMBOL KEY</text>`];
 let cy=y+15;
 const items=sheet.printScene.legend.length?sheet.printScene.legend:[{key:"empty",label:"No symbols placed"}];
 const rowHeight=Math.min(10,(h-20)/items.length),fontSize=Math.min(2.7,rowHeight*.29),lineHeight=fontSize*1.25;
 for(const item of items){out.push(`<title>${escapeXml(item.label)}</title>`);const lines=wrapSheetText(item.label,35,2),glyphScale=Math.min(1,rowHeight/9),gx=x+w-15,gy=cy+rowHeight/2;out.push(`<g transform="translate(${gx} ${gy}) scale(${glyphScale}) translate(${-gx} ${-gy})">${legendSwatch(item.key,gx,gy,item)}</g>`);out.push(renderTextLines(lines,x+4,cy+rowHeight/2-(lines.length-1)*lineHeight/2+fontSize*.3,fontSize,lineHeight));cy+=rowHeight;}
 out.push('</g>');return out.join('');
}
function renderTitleBlock(sheet,bounds){
 const {xMm:x,yMm:y,widthMm:w,heightMm:h}=bounds,c=sheet.metadata.company;
 const out=[`<g id="title-block"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white" stroke="#687880" stroke-width="0.3"/>`];
 let cy=y+4;
 if(sheet.metadata.companyLogoDataUrl){out.push(`<image data-kind="company-logo" href="${rasterDataUrl(sheet.metadata.companyLogoDataUrl)}" x="${x+4}" y="${cy}" width="${w-8}" height="17" preserveAspectRatio="xMidYMid meet"/>`);cy+=20;}
 else {out.push(renderTextLines(wrapSheetText(c.companyName||'Company details not set',32,2),x+4,cy+5,4.8,5.3));cy+=16;}
 const contact=[sheet.metadata.companyLogoDataUrl?c.companyName:'',c.address,[c.phone,c.email].filter(Boolean).join(' · '),c.website,[c.contactName,c.contactPhone||c.contactEmail].filter(Boolean).join(' · ')].filter(Boolean).join(' · ');
 out.push(renderTextLines(wrapSheetText(contact,49,4),x+4,cy,2.3,3.1));cy=y+36;
 const rows=[['PROJECT',sheet.metadata.projectName],['CLIENT',sheet.metadata.clientName],['ADDRESS',sheet.metadata.siteName],['DRAWING',sheet.metadata.drawingTitle]];
 for(const [label,value] of rows){out.push(`<line x1="${x}" y1="${cy}" x2="${x+w}" y2="${cy}" stroke="#a2aaad" stroke-width="0.2"/><text x="${x+3}" y="${cy+3}" font-size="1.9" fill="#687880">${label}</text>`);const lines=wrapSheetText(value||'—',38,label==='ADDRESS'?3:2);out.push(renderTextLines(lines,x+3,cy+6.5,2.8,3.3));cy+=label==='ADDRESS'?17:13;}
 out.push(`<line x1="${x}" y1="${cy}" x2="${x+w}" y2="${cy}" stroke="#a2aaad" stroke-width="0.2"/>`);
 out.push(renderTextLines(wrapSheetText(`${sheet.metadata.drawingId} · Rev ${sheet.metadata.revision}`,43,1),x+3,cy+5,2.8,3.2));
 out.push(renderTextLines(wrapSheetText(`${sheet.metadata.issueDate} · ${sheet.fit.label} · ${sheet.printScene.floorName}`,47,1),x+3,cy+10,2.5,3.1));
 out.push(renderTextLines(wrapSheetText(`DRAWN BY ${sheet.metadata.drawnBy||'—'} · CHECKED BY ${sheet.metadata.checkedBy||'—'}`,48,1),x+3,cy+15,2.4,3));
 out.push(renderTextLines(wrapSheetText(sheet.metadata.status,43,2),x+3,y+h-10,2.6,3.3));
 out.push(`<text x="${x+3}" y="${y+h-2}" font-size="1.8" fill="#687880">A3 · Print at 100% · Verify scale before use</text></g>`);return out.join('');
}

function renderTextLines(lines, x, y, fontSize, lineHeight) {
  return `<text x="${formatNumber(x)}" y="${formatNumber(y)}" font-size="${formatNumber(fontSize)}" fill="#17242b">${lines.map((line, index) => `<tspan x="${formatNumber(x)}" dy="${index === 0 ? 0 : formatNumber(lineHeight)}">${escapeXml(line)}</tspan>`).join("")}</text>`;
}

function legendSwatch(key, x, y,item={}) {
  const g=item.graphic;
  if(key.startsWith('luna-')||key.startsWith('wall-grille-')){
    const scale=Math.min(11/g.widthMm,8/g.depthMm);
    return `<g data-kind="legend-terminal" transform="translate(${x+2.5} ${y}) scale(${scale})" fill="none" stroke="${g.colour}" stroke-width="${.3/scale}">${g.paths.map(d=>`<path d="${d}"/>`).join('')}</g>`;
  }
  if(key.startsWith('mvhr'))return `<g data-kind="legend-mvhr"><rect x="${x-2}" y="${y-4}" width="12" height="8" fill="#dce2e3" stroke="#29434d" stroke-width=".3"/>${[[-.5,-2],[-.5,2],[7,-2],[7,2]].map(([dx,dy])=>`<circle cx="${x+dx}" cy="${y+dy}" r="1.2" fill="white" stroke="#29434d" stroke-width=".3"/>`).join('')}${key==='mvhrcw'?`<rect x="${x-2}" y="${y-4}" width="5" height="8" fill="#666"/>${[-1,1].flatMap(dx=>[-2.5,-.9,.9,2.5].map(dy=>`<circle cx="${x+dx+.5}" cy="${y+dy}" r=".55" fill="none" stroke="${dy<0?'#ff303c':'#2838ff'}" stroke-width=".3"/>`)).join('')}`:''}</g>`;
  if(key.startsWith('cw-'))return `<rect x="${x-2}" y="${y-2.5}" width="11" height="5" fill="#ecefef" stroke="${key.includes('supply')?'#2782b5':'#c15c41'}" stroke-width=".5"/>`;
  if(key.startsWith('external-grille-')) {
    const scale=Math.min(12/g.widthMm,8/g.depthMm);
    const shapes=externalGrilleShapes(g).filter(shape=>shape.tag!=="text").map(shape=>`<${shape.tag} ${Object.entries(shape.attributes).map(([key,value])=>`${key}="${escapeXml(String(value))}"`).join(" ")}/>`).join("");
    return `<g data-kind="legend-external-grille" data-grille-type="${g.combined?'combined':g.ports[0]?.stream??'individual'}" transform="translate(${x+3} ${y}) scale(${scale})">${shapes}</g>`;
  }

  if(key==="building-area")return `<line x1="${x}" y1="${y}" x2="${x+8}" y2="${y}" stroke="#a77927" stroke-width=".4" stroke-dasharray="2 1"/>`;
  if (key === "wall") return `<line x1="${formatNumber(x)}" y1="${formatNumber(y)}" x2="${formatNumber(x + 5)}" y2="${formatNumber(y)}" stroke="#26373f" stroke-width="1.2"/>`;
  if (key === "wall-virtual") return `<line x1="${formatNumber(x)}" y1="${formatNumber(y)}" x2="${formatNumber(x + 5)}" y2="${formatNumber(y)}" stroke="#26373f" stroke-width="0.7" stroke-dasharray="1.4 0.8"/>`;
  if (key.startsWith("service-")) return `<line x1="${formatNumber(x)}" y1="${formatNumber(y)}" x2="${formatNumber(x + 5)}" y2="${formatNumber(y)}" stroke="${routeServiceColor(key.slice("service-".length))}" stroke-width="1.2" stroke-linecap="round"/>`;
  if (key === "route-semi-rigid") return `<line x1="${formatNumber(x)}" y1="${formatNumber(y)}" x2="${formatNumber(x + 5)}" y2="${formatNumber(y)}" stroke="#397181" stroke-width="0.6" stroke-dasharray="1.4 0.8"/>`;
  if (key === "route-generic") return `<line x1="${formatNumber(x)}" y1="${formatNumber(y)}" x2="${formatNumber(x + 5)}" y2="${formatNumber(y)}" stroke="#397181" stroke-width="0.6"/>`;
  if (key.startsWith("reference") || key.startsWith("cad-reference")) return `<rect x="${formatNumber(x)}" y="${formatNumber(y - 1.7)}" width="5" height="3.4" fill="#dfe7e9" stroke="#607d86" stroke-width="0.3"/>`;
  return `<circle cx="${formatNumber(x + 2.5)}" cy="${formatNumber(y)}" r="1.7" fill="white" stroke="#2f5966" stroke-width="0.4"/>`;
}

function renderEmptyDrawing(sheet) {
  const x = sheet.drawingBounds.xMm + sheet.drawingBounds.widthMm / 2;
  const y = sheet.drawingBounds.yMm + sheet.drawingBounds.heightMm / 2;
  return `<text x="${formatNumber(x)}" y="${formatNumber(y)}" text-anchor="middle" fill="#687880" font-size="4">No printable geometry in this working draft</text>`;
}

function normalizeMetadata(project, metadata) {
  if (!metadata || typeof metadata !== "object") throw new TypeError("Sheet metadata is required");
  const floorId = sanitizeXmlText(metadata.floorId, "Floor ID", true);
  if (!project.floors.some((floor) => floor.id === floorId)) {
    throw new TypeError(`Sheet floor not found: ${floorId}`);
  }
  const issueDate = sanitizeXmlText(metadata.issueDate, "Issue date", true);
  const parsedDate = new Date(`${issueDate}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(issueDate) ||
    !Number.isFinite(parsedDate.valueOf()) ||
    parsedDate.toISOString().slice(0, 10) !== issueDate
  ) {
    throw new TypeError("Issue date must use YYYY-MM-DD");
  }
  const status = sanitizeXmlText(metadata.status, "Sheet status", true);
  if (!ISSUE_STATUSES.includes(status)) {
    throw new TypeError("Sheet status must be Preliminary or Issued for review, both not for construction");
  }
  return {
    orientation: metadata.orientation ?? "landscape",
    includeSchedule:metadata.includeSchedule===true,
    company:normalizeCompanyProfile(metadata.company),
    companyLogoDataUrl:validateLogoDataUrl(metadata.companyLogoDataUrl),
    floorId,
    projectName: sanitizeXmlText(metadata.projectName ?? project.projectDetails?.name, "Project name", true),
    siteName: sanitizeXmlText(metadata.siteName ?? project.projectDetails?.address ?? "Not set", "Site name"),
    clientName: sanitizeXmlText(metadata.clientName ?? project.projectDetails?.clientName ?? "Not set", "Client name"),
    drawingTitle: sanitizeXmlText(metadata.drawingTitle, "Drawing title", true),
    drawingId: sanitizeXmlText(metadata.drawingId, "Drawing ID", true),
    issueDate,
    status,
    revision: sanitizeXmlText(metadata.revision, "Revision", true),
    revisionText: sanitizeXmlText(metadata.revisionText, "Revision text", true),
    drawnBy: sanitizeXmlText(metadata.drawnBy ?? "", "Drawn by"),
    checkedBy: sanitizeXmlText(metadata.checkedBy ?? "", "Checked by"),
  };
}

function validateSheetModel(sheet) {
  if (!sheet || sheet.kind !== "working-draft-sheet-preview") throw new TypeError("A valid sheet preview model is required");
  if (sheet.templateId !== SHEET_TEMPLATE_ID) throw new TypeError("Unsupported sheet template");
  a3PageBounds(sheet.page?.orientation);
  if (!sheet.printScene || !sheet.fit || !sheet.metadata || !sheet.partsSchedule || !sheet.scheduleBounds) {
    throw new TypeError("Sheet model is incomplete");
  }
}

function chooseScaleDenominator(required) {
  for (const denominator of STANDARD_SCALE_DENOMINATORS) {
    if (denominator + 1e-9 >= required) return denominator;
  }
  return Math.ceil(required / 10000) * 10000;
}

function routeBounds(route) {
  const bounds = route.lanes.map(pointsBounds).filter(Boolean);
  if (!bounds.length) return null;
  const merged = mergeBounds(bounds);
  const padding = route.scaled && route.diameterMm !== null ? route.diameterMm / 2 : 0;
  return {
    minX: merged.minX - padding,
    minY: merged.minY - padding,
    maxX: merged.maxX + padding,
    maxY: merged.maxY + padding,
  };
}

function wallBounds(wall) {
  const padding = wall.thicknessMm / 2;
  return {
    minX: Math.min(wall.start.x, wall.end.x) - padding,
    minY: Math.min(wall.start.y, wall.end.y) - padding,
    maxX: Math.max(wall.start.x, wall.end.x) + padding,
    maxY: Math.max(wall.start.y, wall.end.y) + padding,
  };
}

function pointsBounds(points) {
  if (!points.length) return null;
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function componentBounds(component) {
  const halfWidth = component.symbol.widthMm / 2;
  const halfHeight = component.symbol.heightMm / 2;
  const bounds = component.planGraphic?.drawingBoundsMm ?? { minX: -halfWidth, maxX: halfWidth, minY: -halfHeight, maxY: halfHeight };
  const corners = [
    { x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY }, { x: bounds.minX, y: bounds.maxY },
  ].map((point) => rotateTranslate(point, component.yawRad, component.positionMm));
  return pointsBounds(corners);
}

function referenceBounds(reference) {
  const crop = reference.cropSourceRectPx;
  const minX = crop?.x ?? 0;
  const minY = crop?.y ?? 0;
  const maxX = crop ? crop.x + crop.width : reference.widthPx;
  const maxY = crop ? crop.y + crop.height : reference.heightPx;
  const corners = [
    { x: minX, y: minY }, { x: maxX, y: minY },
    { x: maxX, y: maxY }, { x: minX, y: maxY },
  ].map((point) => sourcePointToWorld({
    translationMm: reference.translationMm,
    rotationRad: reference.rotationRad,
  }, point, reference.displayMmPerPixel));
  return pointsBounds(corners);
}

function mergeBounds(bounds) {
  if (!bounds.length) return null;
  return {
    minX: Math.min(...bounds.map((bound) => bound.minX)),
    minY: Math.min(...bounds.map((bound) => bound.minY)),
    maxX: Math.max(...bounds.map((bound) => bound.maxX)),
    maxY: Math.max(...bounds.map((bound) => bound.maxY)),
  };
}

function rotateTranslate(point, rotationRad, translation) {
  const cosine = Math.cos(rotationRad);
  const sine = Math.sin(rotationRad);
  return {
    x: translation.x + point.x * cosine - point.y * sine,
    y: translation.y + point.x * sine + point.y * cosine,
  };
}

function quaternionYaw(quaternion) {
  return Math.atan2(
    2 * (quaternion.w * quaternion.z + quaternion.x * quaternion.y),
    1 - 2 * (quaternion.y * quaternion.y + quaternion.z * quaternion.z),
  );
}

function normalizeSymbol(symbol) {
  const shape = symbol?.shape === "circle" ? "circle" : "box";
  const widthMm = Number.isFinite(symbol?.widthMm) && symbol.widthMm > 0 ? symbol.widthMm : 700;
  const heightMm = Number.isFinite(symbol?.heightMm) && symbol.heightMm > 0 ? symbol.heightMm : widthMm;
  return { shape, widthMm, heightMm };
}

function planPoint(value, label) {
  if (!Number.isFinite(value?.x) || !Number.isFinite(value?.y)) {
    throw new TypeError(`${label} must contain finite XY coordinates`);
  }
  return { x: value.x, y: value.y };
}

function mapX(value, transform) {
  return formatNumber(transform.offsetX + value * transform.scale);
}

function mapY(value, transform) {
  return formatNumber(transform.offsetY + value * transform.scale);
}

function sheetPointString(points, transform) {
  return points.map((point) => `${mapX(point.x, transform)},${mapY(point.y, transform)}`).join(" ");
}

function routeServiceColor(stream) {
  if (stream === "supply") return "#5b9dca";
  if (stream === "extract") return "#c27a65";
  if (stream === "intake" || stream === "outdoor-intake") return "#65a587";
  if (stream === "exhaust" || stream === "outdoor-exhaust") return "#92768c";
  return "#687880";
}

function serviceLabel(stream) {
  if (stream === "supply") return "Supply";
  if (stream === "extract") return "Extract";
  if (stream === "intake" || stream === "outdoor-intake") return "Outdoor intake";
  if (stream === "exhaust" || stream === "outdoor-exhaust") return "Outdoor exhaust";
  return String(stream).replaceAll("-", " ");
}

function scheduleEvidenceLabel(evidenceClass) {
  if (evidenceClass === "verified-catalogue") return "verified";
  if (evidenceClass === "source-backed-provisional") return "source-backed provisional";
  return "unmatched provisional";
}

function formatMetres(valueMm) {
  if (!Number.isFinite(valueMm)) throw new TypeError("Schedule length must be finite");
  return `${formatNumber(Math.round(valueMm) / 1000)} m`;
}

function splitLongWord(word, maximum) {
  const characters = [...word];
  if (characters.length <= maximum) return [word];
  const pieces = [];
  for (let index = 0; index < characters.length; index += maximum) {
    pieces.push(characters.slice(index, index + maximum).join(""));
  }
  return pieces;
}

function sanitizeXmlText(value, label, required = false) {
  if (typeof value !== "string") throw new TypeError(`${label} must be text`);
  let normalized = "";
  for (const character of value.normalize("NFC")) {
    const code = character.codePointAt(0);
    const valid = code === 0x9 || code === 0xa || code === 0xd ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff);
    const nonCharacter = (code >= 0xfdd0 && code <= 0xfdef) || (code & 0xffff) >= 0xfffe;
    normalized += valid && !nonCharacter ? character : "�";
  }
  normalized = normalized.replace(/[\t\r\n ]+/gu, " ").trim();
  if (required && !normalized) throw new TypeError(`${label} is required`);
  if ([...normalized].length > 500) normalized = `${[...normalized].slice(0, 499).join("")}…`;
  return normalized;
}

function fnv1a32(value) {
  let hash = 0x811c9dc5;
  const bytes = new TextEncoder().encode(value);
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) throw new TypeError("SVG numeric value must be finite");
  const rounded = Math.round(value * 1000000) / 1000000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
