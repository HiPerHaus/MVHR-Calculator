import { describeComponentGeometry } from "../editor/manufacturer-geometry.mjs";

const WIDTH = 1100;
const HEIGHT = 760;
const MARGIN = 58;

export function createDefaultThreeDView() {
  return Object.freeze({ azimuthRad: -Math.PI / 4, pitchRad: Math.PI / 5, zoom: 1, panX: 0, panY: 0 });
}

/** A deterministic drawing scene, not a BIM or clash-detection model. */
export function createThreeDDrawingScene(project, floorId) {
  const floor = project.floors.find((candidate) => candidate.id === floorId);
  if (!floor) throw new TypeError(`3D drawing floor not found: ${String(floorId)}`);
  const components = [];
  const routes = [];
  const exclusions = [];
  const diagnostics = [];
  const equipmentComponentIds = threeDEquipmentComponentIds(project, floorId);
  const visibleComponentIds = new Set(project.components
    .filter((component) => component.floorId === floorId && (isTerminal(component) || equipmentComponentIds.has(component.id)))
    .map((component) => component.id));

  for (const component of project.components.filter((candidate) => visibleComponentIds.has(candidate.id))) {
    const elevation = resolvedMeasurement(component.positionMm.z);
    const geometry = describeComponentGeometry(project, component);
    if (!elevation) {
      diagnostics.push({ objectId: component.id, issue: "Component elevation is unknown; it is not shown in 3D." });
      continue;
    }
    if (!geometry.solid) diagnostics.push({ objectId: component.id, issue: `${geometry.evidenceState}: ${geometry.evidenceSource}` });
    const displayHeightMm = geometry.dimensions.heightMm ?? Math.max(120, Math.min(420, Math.max(geometry.dimensions.widthMm, geometry.dimensions.depthMm) * 0.35));
    components.push({
      id: component.id,
      label: component.displayName ?? component.id,
      xMm: component.positionMm.x,
      yMm: component.positionMm.y,
      zMm: elevation.valueMm,
      elevationState: elevation.state,
      widthMm: geometry.dimensions.widthMm,
      depthMm: geometry.dimensions.depthMm,
      heightMm: geometry.dimensions.heightMm,
      displayHeightMm,
      yawRad: componentYaw(component.orientation),
      shape: geometry.shape,
      evidenceState: geometry.evidenceState,
      evidenceSource: geometry.evidenceSource,
      solid: geometry.solid,
      manufacturerAsset: geometry.manufacturerAsset,
      ports: geometry.ports.filter((port) => port.zMm !== null),
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
      diameterMm: route.connectionInterface?.outsideDiameterMm ?? route.connectionInterface?.nominalSizeMm ?? null,
      nominalSizeMm: route.connectionInterface?.nominalSizeMm ?? null,
      heightState: route.routingElevationMm?.state ?? commonPointState(route.points),
      parallelRunCount: route.parallelRunCount ?? 1,
      points,
      verticalTransitionCount: countVerticalSegments(points),
    });
  }
  for (const exclusion of (project.routingExclusions ?? []).filter((candidate) => candidate.floorId === floorId)) {
    const bottom = exclusion.verticalRange.mode === "solid-range" ? resolvedMeasurement(exclusion.verticalRange.bottomMm) : null;
    const top = exclusion.verticalRange.mode === "solid-range" ? resolvedMeasurement(exclusion.verticalRange.topMm) : null;
    exclusions.push({ id: exclusion.id, name: exclusion.name, kind: exclusion.kind, ...exclusion.geometry,
      heightMode: exclusion.verticalRange.mode, bottomZMm: bottom?.valueMm ?? null, topZMm: top?.valueMm ?? null,
      heightKnown: exclusion.verticalRange.mode === "solid-range" && Boolean(bottom && top) });
    if (exclusion.verticalRange.mode !== "solid-range" || !bottom || !top) diagnostics.push({ objectId: exclusion.id, issue: "Routing exclusion height is unresolved or all-height; its plan footprint is shown without an invented solid." });
  }
  const floorDatum = resolvedMeasurement(floor.transform.translationMm.z);
  return deepFreeze({
    floorId,
    floorName: floor.name,
    floorDatumMm: floorDatum?.valueMm ?? null,
    floorDatumState: floorDatum?.state ?? "unknown",
    floorOutline: floorOutline(project, floorId),
    components,
    routes,
    exclusions,
    heightItems: heightItems(project, floorId, visibleComponentIds),
    diagnostics,
    boundary: {
      purpose: "coordination-drawing",
      statement: "Reviewed manufacturer meshes are exact-article coordination geometry; other solids, wireframes and visually separated parallel runs are schematic. This output is not BIM, clash detection, fabrication geometry, airflow or pressure-loss certification.",
    },
  });
}

export function renderThreeDDrawingSvg(scene, options = {}) {
  const view = normalizeView(options.view ?? createDefaultThreeDView());
  const project = cameraProjector(view);
  const primitives = [];
  for (const component of scene.components) {
    const bottom = rectangleCorners(component).map((point) => ({ ...point, z: component.zMm }));
    const top = bottom.map((point) => ({ ...point, z: component.zMm + component.displayHeightMm }));
    const manufacturerMeshSets = component.manufacturerAsset ? manufacturerMeshWorldSets(component) : null;
    primitives.push({ type: "component", component, bottom, top, manufacturerMeshSets });
  }
  for (const route of scene.routes) primitives.push({ type: "route", route });
  for (const exclusion of scene.exclusions ?? []) primitives.push({ type: "exclusion", exclusion });
  const worldPoints = [
    ...scene.floorOutline.map((point) => ({ ...point, z: 0 })),
    ...primitives.flatMap((primitive) => primitive.type === "route" ? primitive.route.points : primitive.type === "exclusion" ? exclusionWorldPoints(primitive.exclusion) : primitive.manufacturerMeshSets ? primitive.manufacturerMeshSets.flatMap((set) => set.points) : [...primitive.bottom, ...primitive.top]),
  ];
  const transform = drawingTransform(worldPoints.map(project), view);
  const p = (point) => transform(project(point));
  const shapes = [];

  if (scene.floorOutline.length >= 3) {
    const floorPoints = scene.floorOutline.map((point) => p({ ...point, z: 0 }));
    shapes.push(`<polygon data-floor-outline="${escapeXml(scene.floorId)}" points="${pointList(floorPoints)}" fill="#edf2f1" stroke="#9ba9a6" stroke-width="1.4" opacity="0.72"/>`);
  }
  for (const primitive of primitives.filter((candidate) => candidate.type === "exclusion")) shapes.push(...exclusionSvg(primitive.exclusion, p));
  for (const primitive of primitives.filter((candidate) => candidate.type === "component")) shapes.push(...componentSvg(primitive, p, transform.scale));
  for (const primitive of primitives.filter((candidate) => candidate.type === "route")) shapes.push(routeSvg(primitive.route, p, transform.scale));

  const datumLabel = scene.floorDatumMm === null ? "Floor datum unknown" : `Floor datum ${fmt(scene.floorDatumMm)} mm (${scene.floorDatumState})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Schematic 3D MVHR coordination drawing" data-three-d-contract="2">
<defs><filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="2" dy="4" stdDeviation="4" flood-color="#21343b" flood-opacity="0.18"/></filter></defs>
<rect width="${WIDTH}" height="${HEIGHT}" fill="#fbfcfc"/>
${shapes.join("\n")}
<path d="M 58 682 L 152 682 M 58 682 L 100 645 M 58 682 L 58 592" stroke="#71848b" stroke-width="2" fill="none"/>
<text x="158" y="686" font-size="11" fill="#61747b">X</text><text x="104" y="642" font-size="11" fill="#61747b">Y</text><text x="50" y="587" font-size="11" fill="#61747b">Z</text>
<text x="24" y="28" font-size="18" font-weight="700" fill="#203b44">${escapeXml(scene.floorName)} · schematic 3D MVHR view · solid coordination</text>
<text x="24" y="48" font-size="11" fill="#53666d">${escapeXml(datumLabel)} · view ${fmt(view.azimuthRad * 180 / Math.PI)}° / ${fmt(view.pitchRad * 180 / Math.PI)}° · ${fmt(view.zoom * 100)}%</text>
<text x="24" y="739" font-size="10" fill="#6d7d83">${escapeXml(scene.boundary.statement)}</text>
</svg>`;
}

function componentSvg(primitive, p, scale) {
  const { component, bottom, top } = primitive;
  const bottomPoints = bottom.map(p), topPoints = top.map(p);
  const palette = componentPalette(component);
  const lines = [];
  if (primitive.manufacturerMeshSets) {
    lines.push(...manufacturerMeshSvg(primitive, p));
  } else if (component.solid) {
    for (let index = 0; index < 4; index += 1) {
      const next = (index + 1) % 4;
      lines.push(`<polygon points="${pointList([bottomPoints[index], bottomPoints[next], topPoints[next], topPoints[index]])}" fill="${palette.side}" stroke="#52646a" stroke-width="1" opacity="0.96"/>`);
    }
    lines.push(`<polygon data-component-id="${escapeXml(component.id)}" points="${pointList(topPoints)}" fill="${palette.top}" stroke="#354d56" stroke-width="1.5" filter="url(#soft-shadow)"/>`);
    const centre = p({ x: component.xMm, y: component.yMm, z: component.zMm + component.displayHeightMm * 0.55 });
    if (component.shape === "unit") {
      const radius = Math.max(4, Math.min(13, component.widthMm * scale * 0.055));
      lines.push(`<circle cx="${fmt(centre.x - radius * 1.4)}" cy="${fmt(centre.y)}" r="${fmt(radius)}" fill="#f8fbfb" stroke="#6c7e84"/><circle cx="${fmt(centre.x + radius * 1.4)}" cy="${fmt(centre.y)}" r="${fmt(radius)}" fill="#f8fbfb" stroke="#6c7e84"/>`);
    }
  } else {
    lines.push(...wireframeBox(bottomPoints, topPoints, component.id));
  }
  for (const port of component.ports) {
    const centre = p({ x: port.xMm, y: port.yMm, z: port.zMm });
    const radius = Math.max(3, Math.min(12, (port.outsideDiameterMm ?? port.nominalSizeMm ?? 40) * scale * 0.28));
    lines.push(`<ellipse data-component-port="${escapeXml(component.id)}/${escapeXml(port.id)}" cx="${fmt(centre.x)}" cy="${fmt(centre.y)}" rx="${fmt(radius)}" ry="${fmt(Math.max(2, radius * 0.46))}" fill="${streamColour(port.stream)}" stroke="#ffffff" stroke-width="1.5"/>`);
  }
  const labelPoint = p({ x: component.xMm, y: component.yMm, z: component.zMm + component.displayHeightMm + 90 });
  lines.push(`<text x="${fmt(labelPoint.x)}" y="${fmt(labelPoint.y)}" text-anchor="middle" font-size="11" fill="#243c45" stroke="#fff" stroke-width="3" paint-order="stroke">${escapeXml(component.label)}</text>`);
  if (!component.solid) lines.push(`<text x="${fmt(labelPoint.x)}" y="${fmt(labelPoint.y + 13)}" text-anchor="middle" font-size="9" fill="#8a5d26">SCHEMATIC / HEIGHT UNKNOWN</text>`);
  return lines;
}

function manufacturerMeshWorldSets(component) {
  const cosine = Math.cos(component.yawRad), sine = Math.sin(component.yawRad);
  return component.manufacturerAsset.meshSets.map((set) => ({
    colour: set.colour,
    points: set.points.map(([x, y, z]) => ({
      x: component.xMm + x * cosine - y * sine,
      y: component.yMm + x * sine + y * cosine,
      z: component.zMm + z,
    })),
    faces: set.faces,
  }));
}

function manufacturerMeshSvg(primitive, p) {
  const faces = [];
  for (const set of primitive.manufacturerMeshSets) {
    for (const face of set.faces) {
      const projected = face.map((index) => p(set.points[index])).filter(Boolean);
      if (projected.length < 3) continue;
      faces.push({
        points: projected,
        depth: projected.reduce((total, point) => total + (point.depth ?? 0), 0) / projected.length,
        colour: set.colour,
      });
    }
  }
  faces.sort((left, right) => left.depth - right.depth);
  const asset = primitive.component.manufacturerAsset;
  const componentId = escapeXml(primitive.component.id);
  return [
    `<g data-component-id="${componentId}" data-manufacturer-geometry="${escapeXml(asset.assetId)}" data-manufacturer-article="${escapeXml(asset.manufacturerArticle)}">`,
    ...faces.map((face) => `<polygon points="${pointList(face.points)}" fill="${escapeXml(face.colour)}" stroke="#526066" stroke-width="0.32" stroke-linejoin="round"/>`),
    `</g>`,
  ];
}

function exclusionWorldPoints(exclusion) {
  const bottom = exclusion.heightKnown ? exclusion.bottomZMm : 0;
  const top = exclusion.heightKnown ? exclusion.topZMm : bottom;
  const corners = [{x:exclusion.x,y:exclusion.y},{x:exclusion.x+exclusion.width,y:exclusion.y},{x:exclusion.x+exclusion.width,y:exclusion.y+exclusion.height},{x:exclusion.x,y:exclusion.y+exclusion.height}];
  return [...corners.map((point)=>({...point,z:bottom})),...corners.map((point)=>({...point,z:top}))];
}

function exclusionSvg(exclusion, p) {
  const points = exclusionWorldPoints(exclusion), bottom = points.slice(0,4).map(p), top = points.slice(4).map(p);
  const lines = [];
  if (exclusion.heightKnown) {
    for(let index=0;index<4;index+=1){const next=(index+1)%4;lines.push(`<polygon points="${pointList([bottom[index],bottom[next],top[next],top[index]])}" fill="#d7843b" stroke="#8b4b1e" stroke-width="1" opacity="0.28"/>`);}
    lines.push(`<polygon data-routing-exclusion="${escapeXml(exclusion.id)}" points="${pointList(top)}" fill="#e6a15f" stroke="#8b4b1e" stroke-width="1.5" opacity="0.46"/>`);
  } else {
    lines.push(`<polygon data-routing-exclusion="${escapeXml(exclusion.id)}" points="${pointList(bottom)}" fill="#e6a15f" stroke="#8b4b1e" stroke-width="1.5" stroke-dasharray="7 4" opacity="0.36"/>`);
  }
  const label=p({x:exclusion.x+exclusion.width/2,y:exclusion.y+exclusion.height/2,z:exclusion.heightKnown?exclusion.topZMm:0});
  lines.push(`<text x="${fmt(label.x)}" y="${fmt(label.y)}" text-anchor="middle" font-size="10" fill="#6f3213" stroke="#fff" stroke-width="3" paint-order="stroke">${escapeXml(exclusion.name)} · ${exclusion.heightKnown?`${fmt(exclusion.bottomZMm)}–${fmt(exclusion.topZMm)} mm`:"height unresolved"}</text>`);
  return lines;
}

function routeSvg(route, p, scale) {
  const path = smoothPath(route.points.map(p));
  const colour = streamColour(route.stream);
  const width = Math.max(4, Math.min(28, (route.diameterMm ?? 40) * scale));
  const offsets = route.parallelRunCount === 2 ? [-width * 0.72, width * 0.72] : [0];
  return offsets.map((offset, index) => `<g data-route-id="${escapeXml(route.id)}" data-route-run="${index + 1}" transform="translate(0 ${fmt(offset)})">
<path d="${path}" fill="none" stroke="#31464d" stroke-width="${fmt(width + 3)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
<path d="${path}" fill="none" stroke="${colour}" stroke-width="${fmt(width)}" stroke-linecap="round" stroke-linejoin="round"/>
<path d="${path}" fill="none" stroke="#ffffff" stroke-width="${fmt(Math.max(1, width * 0.16))}" stroke-linecap="round" opacity="0.45"/>
</g>`).join("\n");
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

function heightItems(project, floorId, visibleComponentIds) {
  const items = [];
  const assemblyMemberIds = new Set();
  for (const assembly of project.equipmentAssemblies.filter((candidate) => candidate.floorId === floorId)) {
    const memberIds = assembly.componentIds.filter((id) => visibleComponentIds.has(id));
    if (!memberIds.length) continue;
    memberIds.forEach((id) => assemblyMemberIds.add(id));
    const members = memberIds.map((id) => project.components.find((component) => component.id === id));
    items.push({ kind: "assembly", id: assembly.id, label: assembly.displayName ?? assembly.name ?? `Equipment assembly ${assembly.id}`, measurement: commonMeasurement(members.map((component) => component.positionMm.z)) });
    for (const component of members) {
      items.push({
        kind: "assembly-component",
        id: component.id,
        assemblyId: assembly.id,
        label: component.displayName ?? component.id,
        measurement: measurementForControl(component.positionMm.z),
      });
    }
  }
  for (const component of project.components.filter((candidate) => visibleComponentIds.has(candidate.id) && !assemblyMemberIds.has(candidate.id))) {
    items.push({ kind: "component", id: component.id, label: component.displayName ?? component.id, measurement: measurementForControl(component.positionMm.z) });
  }
  for (const route of project.routes.filter((candidate) => candidate.floorId === floorId)) {
    items.push({ kind: "route", id: route.id, label: `${route.stream} ${route.connectionInterface?.nominalSizeMm ? `DN${route.connectionInterface.nominalSizeMm}` : "duct"} · ${route.id}`, measurement: measurementForControl(route.routingElevationMm) });
  }
  return items;
}

function floorOutline(project, floorId) {
  const outline = project.floorAreaOutlines?.find((candidate) => candidate.floorId === floorId);
  return outline?.vertices?.map((vertex) => ({ x: vertex.positionMm.x, y: vertex.positionMm.y })) ?? [];
}

function normalizeView(view) {
  return {
    azimuthRad: finite(view.azimuthRad, "3D view azimuth"),
    pitchRad: clamp(finite(view.pitchRad, "3D view pitch"), 0.15, 1.35),
    zoom: clamp(finite(view.zoom, "3D view zoom"), 0.35, 4),
    panX: finite(view.panX, "3D view pan x"),
    panY: finite(view.panY, "3D view pan y"),
  };
}
function cameraProjector(view) {
  const cosine = Math.cos(view.azimuthRad), sine = Math.sin(view.azimuthRad);
  const pitchCosine = Math.cos(view.pitchRad), pitchSine = Math.sin(view.pitchRad);
  return (point) => {
    const x = point.x * cosine - point.y * sine;
    const depth = point.x * sine + point.y * cosine;
    return { x, y: depth * pitchSine - point.z * pitchCosine, depth: depth * pitchCosine + point.z * pitchSine };
  };
}
function drawingTransform(points, view) {
  const safe = points.length ? points : [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  const minX = Math.min(...safe.map((point) => point.x)), maxX = Math.max(...safe.map((point) => point.x));
  const minY = Math.min(...safe.map((point) => point.y)), maxY = Math.max(...safe.map((point) => point.y));
  const fittedScale = Math.min((WIDTH - 2 * MARGIN) / Math.max(1, maxX - minX), (HEIGHT - 2 * MARGIN - 45) / Math.max(1, maxY - minY));
  const scale = fittedScale * view.zoom;
  const offsetX = (WIDTH - (maxX - minX) * scale) / 2 - minX * scale + view.panX;
  const offsetY = (HEIGHT - 35 - (maxY - minY) * scale) / 2 - minY * scale + view.panY;
  const transform = (point) => ({ x: point.x * scale + offsetX, y: point.y * scale + offsetY, depth: point.depth });
  transform.scale = scale;
  return transform;
}

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
function isTerminal(component) { return component.ports?.length === 1 && component.ports[0].system === "mvhr" && ["supply", "extract"].includes(component.ports[0].stream); }
function componentYaw(q) { return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z)); }
function rectangleCorners(component) {
  const halfWidth = component.widthMm / 2, halfDepth = component.depthMm / 2;
  const cosine = Math.cos(component.yawRad), sine = Math.sin(component.yawRad);
  return [[-halfWidth, -halfDepth], [halfWidth, -halfDepth], [halfWidth, halfDepth], [-halfWidth, halfDepth]].map(([x, y]) => ({ x: component.xMm + x * cosine - y * sine, y: component.yMm + x * sine + y * cosine }));
}
function wireframeBox(bottom, top, id) {
  const lines = [`<polygon data-component-id="${escapeXml(id)}" points="${pointList(top)}" fill="#eef2f2" fill-opacity="0.28" stroke="#7d694e" stroke-width="1.5" stroke-dasharray="5 3"/>`];
  for (let index = 0; index < 4; index += 1) lines.push(`<line x1="${fmt(bottom[index].x)}" y1="${fmt(bottom[index].y)}" x2="${fmt(top[index].x)}" y2="${fmt(top[index].y)}" stroke="#7d694e" stroke-width="1.2" stroke-dasharray="5 3"/>`);
  return lines;
}
function componentPalette(component) {
  if (component.shape === "distribution") return { top: "#d6e2e5", side: "#aebfc4" };
  if (component.shape === "terminal") return { top: "#f1c7a9", side: "#d8a981" };
  return { top: "#dfe6e7", side: "#bfcacc" };
}
function streamColour(stream) { return stream === "supply" ? "#2671d9" : stream === "extract" ? "#d24d4d" : stream === "intake" ? "#4da67f" : stream === "exhaust" ? "#9066b1" : "#60737b"; }
function smoothPath(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
  let path = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index], next = points[index + 1];
    const midpoint = { x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 };
    path += ` Q ${fmt(current.x)} ${fmt(current.y)} ${fmt(midpoint.x)} ${fmt(midpoint.y)}`;
  }
  const end = points.at(-1);
  return `${path} T ${fmt(end.x)} ${fmt(end.y)}`;
}
function commonMeasurement(values) {
  const controls = values.map(measurementForControl), first = controls[0];
  return controls.every((value) => value.state === first.state && value.valueMm === first.valueMm) ? first : { state: "mixed", valueMm: null, reason: "assembly members have different elevations" };
}
function measurementForControl(value) {
  const resolved = resolvedMeasurement(value);
  return resolved ? { ...resolved, reason: value.reason ?? null } : { state: "unknown", valueMm: null, reason: value?.reason ?? "height not set" };
}
function resolvedMeasurement(value) { return value && ["known", "assumed"].includes(value.state) && Number.isFinite(value.valueMm) ? { state: value.state, valueMm: value.valueMm } : null; }
function commonPointState(points) { const states = new Set(points.map((point) => point.z?.state)); return states.size === 1 ? [...states][0] : "mixed"; }
function unique3D(points) { return points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y || point.z !== points[index - 1].z); }
function countVerticalSegments(points) { return points.slice(1).filter((point, index) => point.x === points[index].x && point.y === points[index].y && point.z !== points[index].z).length; }
function pointList(points) { return points.map((point) => `${fmt(point.x)},${fmt(point.y)}`).join(" "); }
function finite(value, label) { if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`); return value; }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function fmt(value) { return Number(value.toFixed(2)); }
function escapeXml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;"); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }
