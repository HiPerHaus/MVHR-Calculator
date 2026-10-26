import { floorPortTransform } from "../domain/spatial.mjs";
import { inspectFloorAreaOutline } from "../domain/floor-area.mjs";
import { deriveSweptCentreline } from "./duct-body-geometry.mjs";
import { routingCoordinationInputs } from "./routing-coordination.mjs";

export const AUTOMATIC_RADIAL_DIAMETER_MM = 90;
export const AUTOMATIC_RADIAL_CLEARANCE_MM = AUTOMATIC_RADIAL_DIAMETER_MM / 2;
export const AUTOMATIC_ROUTING_STYLES = Object.freeze(["direct", "building-aligned"]);

/**
 * Produces a disposable routing proposal. It never mutates the project and it
 * never treats the proposal as airflow, pressure-loss or installation proof.
 */
export function inspectAutomaticRadialRouting(project, floorId, options = {}) {
  const floor = project?.floors?.find((candidate) => candidate.id === floorId);
  if (!floor) return blocked("Choose an existing floor before routing.");
  const outline = project.floorAreaOutlines?.find((candidate) => candidate.floorId === floorId);
  if (!outline) return blocked("Draw and confirm a closed building outline before routing.");
  if ((outline.holes?.length ?? 0) > 0) {
    return blocked("Automatic routing does not yet support holes in the confirmed building outline. Marked routing exclusions are supported separately.");
  }
  const scaleEvidence = scaleEvidenceForFloor(project, floorId);
  if (scaleEvidence === "manual-project-grid") {
    return blocked("Calibrate the plan reference or import a CAD reference with explicit units before routing.", {
      scaleEvidence,
      outlineId: outline.id,
    });
  }

  const routingStyle = normalizeRoutingStyle(options);
  if (routingStyle === "building-aligned" && !Number.isFinite(options.buildingAxisRad)) {
    return blocked("Confirm the building axis before previewing Building-aligned routes.", {
      scaleEvidence,
      outlineId: outline.id,
      routingStyle,
    });
  }

  const polygon = inspectFloorAreaOutline(outline).polygon;
  const coordination = routingCoordinationInputs(project, floorId);
  const occupied = occupiedPortKeys(project);
  const ports = eligibleDn90Ports(project, floorId, occupied);
  const destinations = ports.filter((entry) => entry.terminal);
  const sources = ports.filter((entry) => !entry.terminal);
  const context = {
    scaleEvidence,
    outlineId: outline.id,
    routingStyle,
    buildingAxisRad: routingStyle === "building-aligned" ? options.buildingAxisRad : null,
  };
  if (destinations.length === 0) return nothing("No unconnected DN90 outlets are available on this floor.", context);
  if (sources.length === 0) {
    return {
      status: "partial",
      prerequisites: Object.freeze(context),
      proposals: Object.freeze([]),
      unresolved: Object.freeze(destinations.map((entry) => unresolved(entry, "No compatible free DN90 distribution port is available."))),
      notes: notes(),
    };
  }

  const candidates = [];
  for (const destination of destinations) {
    for (const source of sources) {
      if (!compatible(source, destination)) continue;
      const path = findContainedDuctPath(source.positionMm, destination.positionMm, polygon, AUTOMATIC_RADIAL_DIAMETER_MM, coordinationOptions(options, coordination, source, destination));
      if (path) candidates.push({ source, destination, path, lengthMm: pathLength(path) });
    }
  }
  candidates.sort((left, right) => left.lengthMm - right.lengthMm || candidateKey(left).localeCompare(candidateKey(right)));
  const usedSources = new Set();
  const usedDestinations = new Set();
  const proposals = [];
  for (const candidate of candidates) {
    if (usedSources.has(candidate.source.key) || usedDestinations.has(candidate.destination.key)) continue;
    const reserved = proposals.flatMap((proposal) => proposal.points.slice(1).map((point, index) => ({ start: proposal.points[index], end: point, radiusMm: AUTOMATIC_RADIAL_CLEARANCE_MM, routeId: `proposal-${proposal.destination.componentId}`, endpointComponentIds: [] })));
    const rerouted = findContainedDuctPath(candidate.source.positionMm, candidate.destination.positionMm, polygon, AUTOMATIC_RADIAL_DIAMETER_MM,
      coordinationOptions(options, { ...coordination, blockedSegments: [...coordination.blockedSegments, ...reserved] }, candidate.source, candidate.destination));
    if (!rerouted) continue;
    usedSources.add(candidate.source.key);
    usedDestinations.add(candidate.destination.key);
    proposals.push(Object.freeze({
      source: Object.freeze(endpoint(candidate.source)),
      destination: Object.freeze(endpoint(candidate.destination)),
      system: "mvhr",
      stream: candidate.destination.port.stream,
      role: candidate.destination.port.role,
      diameterMm: AUTOMATIC_RADIAL_DIAMETER_MM,
      clearanceMm: AUTOMATIC_RADIAL_CLEARANCE_MM,
      routingStyle,
      buildingAxisRad: context.buildingAxisRad,
      lengthMm: pathLength(rerouted),
      points: Object.freeze(rerouted.map((point) => Object.freeze({ x: point.x, y: point.y }))),
    }));
  }
  const unresolvedEntries = destinations
    .filter((entry) => !usedDestinations.has(entry.key))
    .map((entry) => unresolved(entry, compatibleSources(entry, sources).length === 0
      ? "No compatible free DN90 distribution port is available."
      : "No full-width DN90 route could avoid the building boundary, marked exclusions and modelled duct clearances."));
  return Object.freeze({
    status: proposals.length === 0 ? "partial" : unresolvedEntries.length ? "partial" : "ready",
    prerequisites: Object.freeze(context),
    proposals: Object.freeze(proposals),
    unresolved: Object.freeze(unresolvedEntries),
    notes: notes(),
  });
}

function coordinationOptions(options, coordination, source, destination) {
  const componentIds = new Set([source.component.id, destination.component.id]);
  return {
    ...options,
    forbiddenPolygons: coordination.forbiddenPolygons,
    blockedSegments: coordination.blockedSegments.filter((segment) => !segment.endpointComponentIds?.some((id) => componentIds.has(id))),
    clearSpacingMm: coordination.clearSpacingMm,
  };
}

export function validateDuctPathInsideOutline(points, polygon, diameterMm = AUTOMATIC_RADIAL_DIAMETER_MM, options = {}) {
  if (!Array.isArray(points) || points.length < 2 || !Array.isArray(polygon) || polygon.length < 3) return false;
  const clearance = diameterMm / 2;
  return points.every((point) => validCentre(point, polygon, clearance, options)) &&
    points.slice(1).every((point, index) => validSegment(points[index], point, polygon, clearance, options));
}

export function findContainedDuctPath(start, end, polygon, diameterMm = AUTOMATIC_RADIAL_DIAMETER_MM, options = {}) {
  const routingStyle = normalizeRoutingStyle(options);
  if (routingStyle === "building-aligned") {
    if (!Number.isFinite(options.buildingAxisRad)) return null;
    const angle = options.buildingAxisRad;
    const frameOptions = {
      ...options,
      routingStyle: "building-aligned-frame",
      forbiddenPolygons: (options.forbiddenPolygons ?? []).map((obstacle) => obstacle.map((point) => rotatePoint(point, -angle))),
      blockedSegments: (options.blockedSegments ?? []).map((segment) => ({
        ...segment,
        start: rotatePoint(segment.start, -angle),
        end: rotatePoint(segment.end, -angle),
      })),
    };
    const framed = findContainedDuctPathInFrame(
      rotatePoint(start, -angle),
      rotatePoint(end, -angle),
      polygon.map((point) => rotatePoint(point, -angle)),
      diameterMm,
      frameOptions,
    );
    if (!framed) return null;
    const restored = framed.map((point) => rotatePoint(point, angle));
    return validateDuctPathInsideOutline(restored, polygon, diameterMm, options) ? restored : null;
  }
  return findContainedDuctPathInFrame(start, end, polygon, diameterMm, options);
}

function findContainedDuctPathInFrame(start, end, polygon, diameterMm, options) {
  const clearance = diameterMm / 2;
  if (!validCentre(start, polygon, clearance, options) || !validCentre(end, polygon, clearance, options)) return null;
  const buildingAligned = options.routingStyle === "building-aligned-frame";
  if ((!buildingAligned || axisAligned(start, end)) && validSegment(start, end, polygon, clearance, options)) {
    return [planPoint(start), planPoint(end)];
  }
  if (buildingAligned) {
    for (const corner of [{ x: end.x, y: start.y }, { x: start.x, y: end.y }]) {
      const candidate = [planPoint(start), planPoint(corner), planPoint(end)];
      if (candidate.slice(1).every((point, index) => validSegment(candidate[index], point, polygon, clearance, options))) return candidate;
    }
  }
  for (const marginMm of options.marginsMm ?? [15, 35, 70]) {
    const controls = gridPath(start, end, polygon, clearance + marginMm, options.gridSpacingMm ?? 120, options, buildingAligned);
    if (!controls) continue;
    const simplified = buildingAligned
      ? simplifyCollinearPath(controls)
      : simplifyVisiblePath(controls, polygon, clearance + marginMm, options);
    const swept = deriveSweptCentreline(simplified, { sweepTrimRatio: 0.25, samplesPerCorner: 8 }).points;
    if (validateDuctPathInsideOutline(swept, polygon, diameterMm, options)) return simplified;
  }
  return null;
}

function gridPath(start, end, polygon, clearance, requestedSpacing, options, orthogonalOnly = false) {
  const minX = Math.min(...polygon.map((point) => point.x));
  const maxX = Math.max(...polygon.map((point) => point.x));
  const minY = Math.min(...polygon.map((point) => point.y));
  const maxY = Math.max(...polygon.map((point) => point.y));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const spacing = Math.max(requestedSpacing, Math.sqrt(width * height / 60_000));
  const nodes = [];
  const byGrid = new Map();
  const columns = Math.floor(width / spacing) + 1;
  const rows = Math.floor(height / spacing) + 1;
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const point = { x: Math.min(maxX, minX + column * spacing), y: Math.min(maxY, minY + row * spacing) };
      if (!validCentre(point, polygon, clearance, options)) continue;
      const node = { id: `${column}:${row}`, column, row, point };
      nodes.push(node);
      byGrid.set(node.id, node);
    }
  }
  const visibleFromStart = nodes.filter((node) =>
    (!orthogonalOnly || nearAxis(start, node.point, spacing)) && validSegment(start, node.point, polygon, clearance, options));
  const visibleToEnd = new Set(nodes.filter((node) =>
    (!orthogonalOnly || nearAxis(node.point, end, spacing)) && validSegment(node.point, end, polygon, clearance, options)).map((node) => node.id));
  if (!visibleFromStart.length || !visibleToEnd.size) return null;
  const open = new Set(visibleFromStart.map((node) => node.id));
  const distance = new Map(visibleFromStart.map((node) => [node.id, Math.hypot(node.point.x - start.x, node.point.y - start.y)]));
  const previous = new Map();
  while (open.size) {
    let current = null;
    let best = Infinity;
    for (const id of open) {
      const node = byGrid.get(id);
      const score = distance.get(id) + Math.hypot(node.point.x - end.x, node.point.y - end.y);
      if (score < best) { best = score; current = node; }
    }
    open.delete(current.id);
    if (visibleToEnd.has(current.id)) {
      const path = [current.point];
      let cursor = current.id;
      while (previous.has(cursor)) {
        cursor = previous.get(cursor);
        path.push(byGrid.get(cursor).point);
      }
      return [planPoint(start), ...path.reverse().map(planPoint), planPoint(end)];
    }
    for (const [dx, dy] of orthogonalOnly ? ORTHOGONAL_NEIGHBOURS : NEIGHBOURS) {
      const neighbour = byGrid.get(`${current.column + dx}:${current.row + dy}`);
      if (!neighbour || !validSegment(current.point, neighbour.point, polygon, clearance, options)) continue;
      const tentative = distance.get(current.id) + Math.hypot(neighbour.point.x - current.point.x, neighbour.point.y - current.point.y);
      if (tentative >= (distance.get(neighbour.id) ?? Infinity)) continue;
      distance.set(neighbour.id, tentative);
      previous.set(neighbour.id, current.id);
      open.add(neighbour.id);
    }
  }
  return null;
}

const NEIGHBOURS = Object.freeze([
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
]);
const ORTHOGONAL_NEIGHBOURS = Object.freeze([[-1, 0], [1, 0], [0, -1], [0, 1]]);

function nearAxis(start, end, spacing) {
  return Math.abs(start.x - end.x) <= spacing / 2 || Math.abs(start.y - end.y) <= spacing / 2;
}

function axisAligned(start, end) {
  return Math.abs(start.x - end.x) <= 1e-6 || Math.abs(start.y - end.y) <= 1e-6;
}

function simplifyCollinearPath(points) {
  if (points.length <= 2) return points.map(planPoint);
  const result = [planPoint(points[0])];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = result.at(-1);
    const current = points[index];
    const next = points[index + 1];
    if (Math.abs(orientation(previous, current, next)) <= 1e-6) continue;
    result.push(planPoint(current));
  }
  result.push(planPoint(points.at(-1)));
  return result;
}

function rotatePoint(point, angle) {
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  return { x: point.x * cosine - point.y * sine, y: point.x * sine + point.y * cosine };
}

function normalizeRoutingStyle(options) {
  const routingStyle = options.routingStyle ?? "direct";
  if (!AUTOMATIC_ROUTING_STYLES.includes(routingStyle) && routingStyle !== "building-aligned-frame") {
    throw new RangeError(`Unsupported automatic routing style: ${routingStyle}`);
  }
  return routingStyle;
}

export function suggestBuildingAxis(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 2) return null;
  let best = null;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index], end = polygon[(index + 1) % polygon.length];
    const lengthMm = Math.hypot(end.x - start.x, end.y - start.y);
    if (!(lengthMm > 0) || best && lengthMm <= best.lengthMm) continue;
    let angleRad = Math.atan2(end.y - start.y, end.x - start.x) % (Math.PI / 2);
    if (angleRad < 0) angleRad += Math.PI / 2;
    best = Object.freeze({ angleRad, lengthMm, edgeIndex: index });
  }
  return best;
}

function simplifyVisiblePath(points, polygon, clearance, options) {
  const result = [points[0]];
  let index = 0;
  while (index < points.length - 1) {
    let next = points.length - 1;
    while (next > index + 1 && !validSegment(points[index], points[next], polygon, clearance, options)) next -= 1;
    result.push(points[next]);
    index = next;
  }
  return result;
}

function validCentre(point, polygon, clearance, options = {}) {
  if (!pointInPolygon(point, polygon) || boundaryDistance(point, polygon) + 1e-6 < clearance) return false;
  for (const obstacle of options.forbiddenPolygons ?? []) {
    if (pointInPolygon(point, obstacle) || boundaryDistance(point, obstacle) + 1e-6 < clearance) return false;
  }
  for (const blocked of options.blockedSegments ?? []) {
    if (pointSegmentDistance(point, blocked.start, blocked.end) + 1e-6 < clearance + blocked.radiusMm + (options.clearSpacingMm ?? 0)) return false;
  }
  return true;
}

function validSegment(start, end, polygon, clearance, options = {}) {
  if (!validCentre(start, polygon, clearance, options) || !validCentre(end, polygon, clearance, options)) return false;
  for (let index = 0; index < polygon.length; index += 1) {
    const edgeStart = polygon[index], edgeEnd = polygon[(index + 1) % polygon.length];
    if (segmentsIntersect(start, end, edgeStart, edgeEnd)) return false;
    const distance = Math.min(
      pointSegmentDistance(start, edgeStart, edgeEnd),
      pointSegmentDistance(end, edgeStart, edgeEnd),
      pointSegmentDistance(edgeStart, start, end),
      pointSegmentDistance(edgeEnd, start, end),
    );
    if (distance + 1e-6 < clearance) return false;
  }
  if (!pointInPolygon({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, polygon)) return false;
  for (const obstacle of options.forbiddenPolygons ?? []) {
    if (pointInPolygon(start, obstacle) || pointInPolygon(end, obstacle)) return false;
    for (let index = 0; index < obstacle.length; index += 1) {
      const edgeStart = obstacle[index], edgeEnd = obstacle[(index + 1) % obstacle.length];
      if (segmentDistance(start, end, edgeStart, edgeEnd) + 1e-6 < clearance) return false;
    }
  }
  for (const blocked of options.blockedSegments ?? []) {
    if (segmentDistance(start, end, blocked.start, blocked.end) + 1e-6 < clearance + blocked.radiusMm + (options.clearSpacingMm ?? 0)) return false;
  }
  return true;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i], b = polygon[j];
    if (pointSegmentDistance(point, a, b) <= 1e-6) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function boundaryDistance(point, polygon) {
  let distance = Infinity;
  for (let index = 0; index < polygon.length; index += 1) {
    distance = Math.min(distance, pointSegmentDistance(point, polygon[index], polygon[(index + 1) % polygon.length]));
  }
  return distance;
}

function pointSegmentDistance(point, start, end) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const squared = dx * dx + dy * dy;
  if (squared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / squared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function segmentDistance(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

function segmentsIntersect(a, b, c, d) {
  const first = orientation(a, b, c), second = orientation(a, b, d);
  const third = orientation(c, d, a), fourth = orientation(c, d, b);
  if (((first > 1e-6 && second < -1e-6) || (first < -1e-6 && second > 1e-6)) &&
      ((third > 1e-6 && fourth < -1e-6) || (third < -1e-6 && fourth > 1e-6))) return true;
  return Math.abs(first) <= 1e-6 && pointSegmentDistance(c, a, b) <= 1e-6 ||
    Math.abs(second) <= 1e-6 && pointSegmentDistance(d, a, b) <= 1e-6 ||
    Math.abs(third) <= 1e-6 && pointSegmentDistance(a, c, d) <= 1e-6 ||
    Math.abs(fourth) <= 1e-6 && pointSegmentDistance(b, c, d) <= 1e-6;
}

function orientation(a, b, c) { return (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x); }

function eligibleDn90Ports(project, floorId, occupied) {
  const entries = [];
  for (const component of project.components ?? []) {
    if (component.floorId !== floorId) continue;
    const eligible = component.ports.filter(isDn90MvhrPort);
    const terminal = component.ports.length === 1 && eligible.length === 1;
    for (const port of eligible) {
      const key = `${component.id}/${port.id}`;
      if (occupied.has(key)) continue;
      entries.push({ component, port, key, terminal, positionMm: floorPortTransform(project, component.id, port.id).positionMm });
    }
  }
  return entries;
}

function isDn90MvhrPort(port) {
  return port.system === "mvhr" && ["supply", "extract"].includes(port.stream) &&
    port.interface?.family === "semi-rigid-pe" && port.interface?.nominalSizeMm === 90;
}

function occupiedPortKeys(project) {
  const keys = new Set();
  for (const route of project.routes ?? []) for (const endpoint of [route.startAttachment, route.endAttachment]) {
    if (endpoint) keys.add(`${endpoint.componentId}/${endpoint.portId}`);
  }
  for (const connection of project.connections ?? []) for (const endpoint of [connection.from, connection.to]) {
    if (endpoint) keys.add(`${endpoint.componentId}/${endpoint.portId}`);
  }
  return keys;
}

function compatible(source, destination) {
  return source.port.system === destination.port.system && source.port.stream === destination.port.stream &&
    source.port.role === destination.port.role && source.port.interface.family === destination.port.interface.family &&
    source.port.interface.nominalSizeMm === destination.port.interface.nominalSizeMm;
}

function compatibleSources(destination, sources) { return sources.filter((source) => compatible(source, destination)); }
function endpoint(entry) { return { componentId: entry.component.id, portId: entry.port.id, displayName: entry.component.displayName ?? entry.component.id }; }
function unresolved(entry, reason) { return Object.freeze({ ...endpoint(entry), stream: entry.port.stream, reason }); }
function candidateKey(candidate) { return `${candidate.destination.key}|${candidate.source.key}`; }
function planPoint(point) { return { x: point.x, y: point.y }; }
function pathLength(points) { return points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0); }
function scaleEvidenceForFloor(project, floorId) {
  if (project.floorReferences?.some((reference) => reference.floorId === floorId && reference.calibration !== null)) return "calibrated-image";
  if (project.floorCadReferences?.some((reference) => reference.floorId === floorId)) return "explicit-cad-units";
  return "manual-project-grid";
}
function notes() { return Object.freeze(["The complete modelled duct width is checked against the building boundary, marked exclusions and configured spacing from existing modelled routes.", "Geometric route only; unknown external envelopes, unmarked structure, airflow, pressure loss, supports and installation clearances are not certified."]); }
function blocked(reason, prerequisites = {}) { return Object.freeze({ status: "blocked", prerequisites: Object.freeze(prerequisites), proposals: Object.freeze([]), unresolved: Object.freeze([]), notes: Object.freeze([reason, ...notes()]) }); }
function nothing(reason, prerequisites) { return Object.freeze({ status: "nothing-to-route", prerequisites: Object.freeze(prerequisites), proposals: Object.freeze([]), unresolved: Object.freeze([]), notes: Object.freeze([reason, ...notes()]) }); }
