import { deriveComponentPlanGraphic } from "../editor/component-plan-graphics.mjs";

const WIDTH = 1000;
const HEIGHT = 700;
const MARGIN = 55;

/** A deterministic drawing scene, not a BIM or clash-detection model. */
export function createThreeDDrawingScene(project, floorId) {
  const floor = project.floors.find((candidate) => candidate.id === floorId);
  if (!floor) throw new TypeError(`3D drawing floor not found: ${String(floorId)}`);
  const components = [];
  const routes = [];
  const diagnostics = [];
  const equipmentComponentIds = threeDEquipmentComponentIds(project, floorId);
  for (const component of project.components.filter((candidate) => candidate.floorId === floorId)) {
    if (!isTerminal(component) && !equipmentComponentIds.has(component.id)) continue;
    const elevation = resolvedMeasurement(component.positionMm.z);
    if (!elevation) {
      diagnostics.push({ objectId: component.id, issue: "Component elevation is unknown; it is not shown in 3D." });
      continue;
    }
    const dimensions = componentDimensions(component);
    const terminal = isTerminal(component);
    const heightMm = terminal ? 0 : dimensions.heightMm;
    if (!terminal && heightMm === null) {
      diagnostics.push({ objectId: component.id, issue: "Component height is unknown; its scaled footprint is shown as an open wireframe." });
    }
    components.push({
      id: component.id,
      label: component.displayName ?? component.id,
      xMm: component.positionMm.x,
      yMm: component.positionMm.y,
      zMm: elevation.valueMm,
      elevationState: elevation.state,
      widthMm: terminal ? 140 : dimensions.widthMm,
      depthMm: terminal ? 140 : dimensions.depthMm,
      heightMm,
      yawRad: componentYaw(component.orientation),
      kind: terminal ? "terminal" : component.displaySymbol?.cwProfile || component.mvhrDesignIntent?.layout === "unit-mounted-cw" ? "cw" : "equipment",
    });
  }
  for (const route of project.routes.filter((candidate) => candidate.floorId === floorId)) {
    const points = route3DPoints(route);
    if (!points) {
      diagnostics.push({ objectId: route.id, issue: "Route height or endpoint elevation is unknown; this route is not shown in 3D." });
      continue;
    }
    routes.push({
      id: route.id,
      label: `${route.stream} ${route.connectionInterface?.nominalSizeMm ? `DN${route.connectionInterface.nominalSizeMm}` : "duct"}`,
      stream: route.stream,
      diameterMm: route.connectionInterface?.nominalSizeMm ?? null,
      heightState: route.routingElevationMm?.state ?? commonPointState(route.points),
      points,
      verticalTransitionCount: countVerticalSegments(points),
    });
  }
  const floorDatum = resolvedMeasurement(floor.transform.translationMm.z);
  return Object.freeze({
    floorId,
    floorName: floor.name,
    floorDatumMm: floorDatum?.valueMm ?? null,
    floorDatumState: floorDatum?.state ?? "unknown",
    components: Object.freeze(components.map(deepFreeze)),
    routes: Object.freeze(routes.map(deepFreeze)),
    diagnostics: Object.freeze(diagnostics.map(deepFreeze)),
    boundary: Object.freeze({
      purpose: "coordination-drawing",
      statement: "Schematic 3D coordination view only; not BIM, clash detection, fabrication geometry, airflow or pressure-loss certification.",
    }),
  });
}

export function renderThreeDDrawingSvg(scene) {
  const primitives = [];
  for (const component of scene.components) {
    const bottom = rectangleCorners(component).map((point) => ({ ...point, z: component.zMm }));
    const topZ = component.heightMm === null ? component.zMm : component.zMm + component.heightMm;
    const top = bottom.map((point) => ({ ...point, z: topZ }));
    primitives.push({ type: "component", component, bottom, top });
  }
  for (const route of scene.routes) primitives.push({ type: "route", route });
  const projected = primitives.flatMap((primitive) => primitive.type === "route"
    ? primitive.route.points.map(projectIso)
    : [...primitive.bottom, ...primitive.top].map(projectIso));
  const transform = drawingTransform(projected);
  const p = (point) => transform(projectIso(point));
  const lines = [];
  const polygons = [];
  for (const primitive of primitives) {
    if (primitive.type === "route") {
      const route = primitive.route;
      const points = route.points.map(p).map((point) => `${fmt(point.x)},${fmt(point.y)}`).join(" ");
      const colour = route.stream === "supply" ? "#2768d8" : route.stream === "extract" ? "#c54848" : "#60737b";
      const width = Math.max(2, Math.min(12, (route.diameterMm ?? 40) * transform.scale / 2));
      lines.push(`<polyline data-route-id="${escapeXml(route.id)}" points="${points}" fill="none" stroke="${colour}" stroke-width="${fmt(width)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.82"/>`);
      lines.push(`<polyline points="${points}" fill="none" stroke="#ffffff" stroke-width="1" stroke-dasharray="5 4" opacity="0.7"/>`);
      continue;
    }
    const { component, bottom, top } = primitive;
    const bottomPoints = bottom.map(p);
    const topPoints = top.map(p);
    const fill = component.kind === "cw" ? "#d6e4e9" : component.kind === "terminal" ? "#f4c7a7" : "#cdd7da";
    if (component.heightMm !== null && component.heightMm > 0) {
      for (let index = 0; index < 4; index += 1) {
        const next = (index + 1) % 4;
        polygons.push(`<polygon points="${pointList([bottomPoints[index], bottomPoints[next], topPoints[next], topPoints[index]])}" fill="${fill}" stroke="#53666d" stroke-width="1" opacity="0.88"/>`);
      }
      polygons.push(`<polygon data-component-id="${escapeXml(component.id)}" points="${pointList(topPoints)}" fill="${fill}" stroke="#354d56" stroke-width="1.4"/>`);
    } else {
      polygons.push(`<polygon data-component-id="${escapeXml(component.id)}" points="${pointList(topPoints)}" fill="${fill}" fill-opacity="0.35" stroke="#53666d" stroke-width="1.5" stroke-dasharray="5 3"/>`);
    }
    const labelPoint = p({ x: component.xMm, y: component.yMm, z: top[0].z + 80 });
    lines.push(`<text x="${fmt(labelPoint.x)}" y="${fmt(labelPoint.y)}" text-anchor="middle" font-size="11" fill="#243c45" stroke="#fff" stroke-width="3" paint-order="stroke">${escapeXml(component.label)}</text>`);
  }
  const datumLabel = scene.floorDatumMm === null ? "Floor datum unknown" : `Floor datum ${fmt(scene.floorDatumMm)} mm (${scene.floorDatumState})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Schematic 3D MVHR coordination drawing">
<rect width="${WIDTH}" height="${HEIGHT}" fill="#f8fbfc"/>
<path d="M 55 630 L 145 630 M 55 630 L 95 595 M 55 630 L 55 545" stroke="#7b8c92" stroke-width="2" fill="none"/>
<text x="151" y="634" font-size="11" fill="#61747b">X</text><text x="99" y="592" font-size="11" fill="#61747b">Y</text><text x="48" y="540" font-size="11" fill="#61747b">Z</text>
${polygons.join("\n")}
${lines.join("\n")}
<text x="24" y="28" font-size="18" font-weight="700" fill="#203b44">${escapeXml(scene.floorName)} · schematic 3D MVHR view</text>
<text x="24" y="48" font-size="11" fill="#53666d">${escapeXml(datumLabel)} · solid = entered/known height · dashed footprint = product height unknown</text>
<text x="24" y="680" font-size="10" fill="#6d7d83">${escapeXml(scene.boundary.statement)}</text>
</svg>`;
}

function route3DPoints(route) {
  const endpointStart = resolvedMeasurement(route.points[0]?.z);
  const endpointEnd = resolvedMeasurement(route.points.at(-1)?.z);
  const routing = resolvedMeasurement(route.routingElevationMm);
  if (routing && endpointStart && endpointEnd) {
    const start = route.points[0], end = route.points.at(-1);
    return unique3D([
      { x: start.x, y: start.y, z: endpointStart.valueMm },
      { x: start.x, y: start.y, z: routing.valueMm },
      ...route.points.slice(1, -1).map((point) => ({ x: point.x, y: point.y, z: routing.valueMm })),
      { x: end.x, y: end.y, z: routing.valueMm },
      { x: end.x, y: end.y, z: endpointEnd.valueMm },
    ]);
  }
  const resolved = route.points.map((point) => resolvedMeasurement(point.z));
  if (resolved.some((value) => value === null)) return null;
  return route.points.map((point, index) => ({ x: point.x, y: point.y, z: resolved[index].valueMm }));
}

function componentDimensions(component) {
  const body = component.catalogueSnapshot?.dimensions?.body;
  const graphic = safeGraphic(component);
  const bounds = graphic?.drawingBoundsMm;
  return {
    widthMm: positive(body?.width) ?? (bounds ? bounds.maxX - bounds.minX : null) ?? positive(graphic?.widthMm) ?? positive(component.displaySymbol?.widthMm) ?? 200,
    depthMm: positive(body?.depth) ?? (bounds ? bounds.maxY - bounds.minY : null) ?? positive(graphic?.depthMm) ?? positive(component.displaySymbol?.heightMm) ?? 200,
    heightMm: positive(graphic?.mountedDimensions?.heightMm) ?? positive(body?.height),
  };
}

function safeGraphic(component) { try { return deriveComponentPlanGraphic(component); } catch { return null; } }
function isTerminal(component) { return component.ports?.length === 1 && component.ports[0].system === "mvhr" && ["supply", "extract"].includes(component.ports[0].stream); }
function threeDEquipmentComponentIds(project, floorId) {
  const ids = new Set(project.components.filter((component) => component.floorId === floorId && (
    component.mvhrDesignIntent || /mvhr|hrv|erv|cw|comfowell/i.test(`${component.catalogueItemId ?? ""} ${component.displayName ?? ""}`) ||
    component.ports?.some((port) => port.system === "mvhr" && port.interface?.family === "semi-rigid-pe")
  )).map((component) => component.id));
  for (const assembly of project.equipmentAssemblies.filter((candidate) => candidate.floorId === floorId)) {
    if (assembly.componentIds.some((componentId) => ids.has(componentId))) assembly.componentIds.forEach((componentId) => ids.add(componentId));
  }
  return ids;
}
function resolvedMeasurement(value) { return value && ["known", "assumed"].includes(value.state) && Number.isFinite(value.valueMm) ? { state: value.state, valueMm: value.valueMm } : null; }
function commonPointState(points) { const states = new Set(points.map((point) => point.z?.state)); return states.size === 1 ? [...states][0] : "mixed"; }
function positive(value) { return Number.isFinite(value) && value > 0 ? value : null; }
function componentYaw(q) { return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z)); }
function rectangleCorners(component) {
  const halfWidth = component.widthMm / 2, halfDepth = component.depthMm / 2;
  const cosine = Math.cos(component.yawRad), sine = Math.sin(component.yawRad);
  return [[-halfWidth,-halfDepth],[halfWidth,-halfDepth],[halfWidth,halfDepth],[-halfWidth,halfDepth]].map(([x,y]) => ({ x: component.xMm + x*cosine-y*sine, y: component.yMm+x*sine+y*cosine }));
}
function projectIso(point) { return { x: (point.x - point.y) * Math.SQRT1_2, y: (point.x + point.y) * 0.408248 - point.z * 0.82 }; }
function drawingTransform(points) {
  const safe = points.length ? points : [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  const minX = Math.min(...safe.map((point) => point.x)), maxX = Math.max(...safe.map((point) => point.x));
  const minY = Math.min(...safe.map((point) => point.y)), maxY = Math.max(...safe.map((point) => point.y));
  const scale = Math.min((WIDTH - 2*MARGIN) / Math.max(1, maxX-minX), (HEIGHT - 2*MARGIN-45) / Math.max(1, maxY-minY));
  const offsetX = (WIDTH - (maxX-minX)*scale)/2 - minX*scale;
  const offsetY = (HEIGHT - 35 - (maxY-minY)*scale)/2 - minY*scale;
  const transform = (point) => ({ x: point.x*scale+offsetX, y: point.y*scale+offsetY });
  transform.scale = scale;
  return transform;
}
function unique3D(points) { return points.filter((point, index) => index === 0 || point.x !== points[index-1].x || point.y !== points[index-1].y || point.z !== points[index-1].z); }
function countVerticalSegments(points) { return points.slice(1).filter((point,index) => point.x === points[index].x && point.y === points[index].y && point.z !== points[index].z).length; }
function pointList(points) { return points.map((point) => `${fmt(point.x)},${fmt(point.y)}`).join(" "); }
function fmt(value) { return Number(value.toFixed(2)); }
function escapeXml(value) { return String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&apos;"); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }
