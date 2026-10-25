import { inspectFloorAreaOutline } from "../domain/floor-area.mjs";
import { alignEppPortApproaches, constrainEppPlanPoints, hasHrvCeilingElbow } from "../domain/epp-plan-constraints.mjs";
import { floorPortTransform } from "../domain/spatial.mjs";
import { routeFamilyForKind } from "./component-catalogue.mjs";
import { deriveSweptCentreline } from "./duct-body-geometry.mjs";
import { findContainedDuctPath, validateDuctPathInsideOutline } from "./automatic-radial-routing.mjs";
import { routingCoordinationInputs } from "./routing-coordination.mjs";

export const AUTOMATIC_EPP_ROUTE_KINDS = Object.freeze(["epp-rigid-dn125", "epp-rigid-dn160"]);

/**
 * Returns one disposable, user-selected EPP proposal. It never chooses between
 * plausible equipment chains and never mutates the project.
 */
export function inspectAutomaticEppRouting(project, floorId, selection = {}, options = {}) {
  const floor = project?.floors?.find((candidate) => candidate.id === floorId);
  if (!floor) return blocked("Choose an existing floor before routing.");
  const outline = project.floorAreaOutlines?.find((candidate) => candidate.floorId === floorId);
  if (!outline) return blocked("Draw and confirm a closed building outline before routing.");
  if ((outline.holes?.length ?? 0) > 0) return blocked("Automatic EPP routing does not yet support holes in the confirmed building outline. Marked routing exclusions are supported separately.");
  const scaleEvidence = scaleEvidenceForFloor(project, floorId);
  if (scaleEvidence === "manual-project-grid") {
    return blocked("Calibrate the plan reference or import a CAD reference with explicit units before routing.", { scaleEvidence, outlineId: outline.id });
  }

  const polygon = inspectFloorAreaOutline(outline).polygon;
  const coordination = routingCoordinationInputs(project, floorId);
  const endpoints = eligibleEndpoints(project, floorId, occupiedPortKeys(project));
  const context = { scaleEvidence, outlineId: outline.id };
  if (endpoints.length < 2) return nothing("Place at least two free compatible EPP ports before routing.", endpoints, context);

  const start = endpoints.find((entry) => entry.key === selection.startKey) ?? null;
  const compatibleEnds = start ? endpoints.filter((entry) => entry.key !== start.key && compatiblePair(start, entry)) : [];
  if (!start || !selection.endKey) {
    return result("choose-endpoints", endpoints, compatibleEnds, null, start ? "Choose a compatible destination port." : "Choose the first EPP port.", context);
  }
  const end = compatibleEnds.find((entry) => entry.key === selection.endKey) ?? null;
  if (!end) return result("invalid-selection", endpoints, compatibleEnds, null, "Those ports are occupied or incompatible in size, service or connection class.", context);

  const exteriorCount = Number(start.externalTerminal) + Number(end.externalTerminal);
  if (["intake", "exhaust"].includes(start.port.stream) && exteriorCount !== 1) {
    return result("invalid-selection", endpoints, compatibleEnds, null, "Outdoor intake and exhaust routes must end at one explicitly placed matching external terminal.", context);
  }
  if (!["intake", "exhaust"].includes(start.port.stream) && exteriorCount !== 0) {
    return result("invalid-selection", endpoints, compatibleEnds, null, "An external terminal cannot be used for a dwelling supply or extract route.", context);
  }

  const diameterMm = start.routeFamily.connectionInterface.nominalSizeMm;
  const pathOptions = coordinationOptions(options, coordination, start, end);
  const planned = exteriorCount === 1
    ? planExternalTermination(start, end, polygon, diameterMm, pathOptions)
    : planInternal(start, end, polygon, diameterMm, pathOptions);
  if (!planned) return result("unresolved", endpoints, compatibleEnds, null, `No full-width DN${diameterMm} route could avoid the building boundary, marked exclusions and modelled duct clearances.`, context);

  const proposal = Object.freeze({
    source: publicEndpoint(start),
    destination: publicEndpoint(end),
    system: "mvhr",
    stream: start.port.stream,
    role: start.port.role,
    ductKind: start.routeFamily.id,
    connectionInterface: start.routeFamily.connectionInterface,
    diameterMm,
    clearanceMm: diameterMm / 2,
    lengthMm: pathLength(planned.points),
    points: Object.freeze(planned.points.map((point) => Object.freeze({ x: point.x, y: point.y }))),
    exteriorTermination: planned.exteriorTermination,
    geometryStatus: start.routeFamily.connectionInterface.connectionScope === "drawing-only" ? "drawing-only-fit-unverified" : "nominal-interface-only",
  });
  return result("ready", endpoints, compatibleEnds, proposal,
    planned.exteriorTermination
      ? `DN${diameterMm} preview ready. Interior duct width is checked; the final leg crosses the outline only to the selected external terminal.`
      : `DN${diameterMm} preview ready with its full drawing width inside the building outline.`, context);
}

function eligibleEndpoints(project, floorId, occupied) {
  const entries = [];
  for (const component of project.components ?? []) {
    if (component.floorId !== floorId) continue;
    for (const port of component.ports ?? []) {
      const key = `${component.id}/${port.id}`;
      if (occupied.has(key) || port.system !== "mvhr") continue;
      for (const ductKind of AUTOMATIC_EPP_ROUTE_KINDS) {
        const routeFamily = routeFamilyForKind(ductKind);
        if (!interfaceCompatible(routeFamily.connectionInterface, port.interface)) continue;
        const transform = floorPortTransform(project, component.id, port.id);
        entries.push({
          key, component, port, routeFamily,
          positionMm: transform.positionMm,
          direction: hasHrvCeilingElbow(component, port) ? null : transform.direction,
          externalTerminal: /external-grille/.test(component.catalogueItemId ?? ""),
        });
        break;
      }
    }
  }
  return entries.sort((left, right) => endpointLabel(left).localeCompare(endpointLabel(right)));
}

function compatiblePair(left, right) {
  if (left.component.id === right.component.id) return false;
  if (left.port.system !== right.port.system || left.port.stream !== right.port.stream || left.port.role !== right.port.role) return false;
  if (left.routeFamily.id !== right.routeFamily.id) return false;
  if (!interfaceCompatible(left.port.interface, right.port.interface)) return false;
  if (["intake", "exhaust"].includes(left.port.stream)) return left.externalTerminal !== right.externalTerminal;
  return !left.externalTerminal && !right.externalTerminal;
}

function interfaceCompatible(left, right) {
  if (!left || !right) return false;
  const samePhysicalFamily = left.family === right.family;
  const sameDrawingClass = left.drawingConnectionClass && left.drawingConnectionClass === right.drawingConnectionClass;
  if (!samePhysicalFamily && !sameDrawingClass) return false;
  if (left.nominalSizeMm !== null && right.nominalSizeMm !== null && left.nominalSizeMm !== right.nominalSizeMm) return false;
  if (!samePhysicalFamily && left.connectionScope !== "drawing-only" && right.connectionScope !== "drawing-only") return false;
  return true;
}

function planInternal(start, end, polygon, diameterMm, options) {
  const controls = findContainedDuctPath(start.positionMm, end.positionMm, polygon, diameterMm, options);
  if (!controls) return null;
  const points = alignAndConstrain(controls, start, end, diameterMm);
  return validateSwept(points, polygon, diameterMm, options) ? { points, exteriorTermination: false } : null;
}

function planExternalTermination(start, end, polygon, diameterMm, options) {
  const externalIsStart = start.externalTerminal;
  const external = externalIsStart ? start : end;
  const internal = externalIsStart ? end : start;
  const entry = closestBoundaryPoint(external.positionMm, polygon);
  const inner = interiorPointNear(entry, polygon, diameterMm / 2 + 25);
  if (!inner) return null;
  const controls = findContainedDuctPath(internal.positionMm, inner, polygon, diameterMm, options);
  if (!controls) return null;
  let points = [...controls, external.positionMm];
  if (externalIsStart) points = points.reverse();
  points = alignAndConstrain(points, start, end, diameterMm);
  const interior = externalIsStart ? points.slice(1) : points.slice(0, -1);
  if (interior.length < 2 || !validateSwept(interior, polygon, diameterMm, options)) return null;
  return { points, exteriorTermination: true };
}

function alignAndConstrain(points, start, end, diameterMm) {
  const constrained = constrainEppPlanPoints(points.map((point) => ({ x: point.x, y: point.y })));
  return alignEppPortApproaches(constrained, start.direction, end.direction, Math.max(500, diameterMm * 4));
}

function validateSwept(points, polygon, diameterMm, options) {
  if (!validateDuctPathInsideOutline(points, polygon, diameterMm, options)) return false;
  const swept = deriveSweptCentreline(points, { sweepTrimRatio: 0.25, samplesPerCorner: 8 }).points;
  return validateDuctPathInsideOutline(swept, polygon, diameterMm, options);
}

function coordinationOptions(options, coordination, start, end) {
  const componentIds = new Set([start.component.id, end.component.id]);
  return { ...options, forbiddenPolygons: coordination.forbiddenPolygons,
    blockedSegments: coordination.blockedSegments.filter((segment) => !segment.endpointComponentIds?.some((id) => componentIds.has(id))),
    clearSpacingMm: coordination.clearSpacingMm };
}

function closestBoundaryPoint(point, polygon) {
  let best = null;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const denominator = dx * dx + dy * dy;
    const t = denominator ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator)) : 0;
    const candidate = { x: a.x + t * dx, y: a.y + t * dy };
    const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
    if (!best || distance < best.distance) best = { ...candidate, distance };
  }
  return best;
}

function interiorPointNear(entry, polygon, distance) {
  for (let step = 1; step <= 6; step += 1) {
    const radius = distance * step;
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
      const point = { x: entry.x + Math.cos(angle) * radius, y: entry.y + Math.sin(angle) * radius };
      if (validateDuctPathInsideOutline([point, point], polygon, distance * 2)) return point;
    }
  }
  return null;
}

function occupiedPortKeys(project) {
  const keys = new Set();
  for (const route of project.routes ?? []) for (const endpoint of [route.startAttachment, route.endAttachment]) if (endpoint) keys.add(`${endpoint.componentId}/${endpoint.portId}`);
  for (const connection of project.connections ?? []) for (const endpoint of [connection.from, connection.to]) if (endpoint) keys.add(`${endpoint.componentId}/${endpoint.portId}`);
  return keys;
}

function scaleEvidenceForFloor(project, floorId) {
  if (project.floorReferences?.some((reference) => reference.floorId === floorId && reference.calibration !== null)) return "calibrated-image";
  if (project.floorCadReferences?.some((reference) => reference.floorId === floorId)) return "explicit-cad-units";
  return "manual-project-grid";
}

function endpointLabel(entry) {
  return `${entry.component.displayName ?? entry.component.id} · ${entry.port.role} · DN${entry.routeFamily.connectionInterface.nominalSizeMm}`;
}
function publicEndpoint(entry) {
  return Object.freeze({ key: entry.key, componentId: entry.component.id, portId: entry.port.id, displayName: entry.component.displayName ?? entry.component.id, label: endpointLabel(entry), stream: entry.port.stream, role: entry.port.role, ductKind: entry.routeFamily.id, nominalSizeMm: entry.routeFamily.connectionInterface.nominalSizeMm, externalTerminal: entry.externalTerminal });
}
function publicEndpoints(entries) { return Object.freeze(entries.map(publicEndpoint)); }
function pathLength(points) { return points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0); }
function notes() { return Object.freeze(["Geometric route only; airflow, pressure loss, supports, obstacle clearance and installation fit are not certified."]); }
function result(status, endpoints, compatibleEnds, proposal, message, prerequisites) {
  return Object.freeze({ status, prerequisites: Object.freeze(prerequisites), endpoints: publicEndpoints(endpoints), compatibleEnds: publicEndpoints(compatibleEnds), proposal, message, notes: notes() });
}
function blocked(message, prerequisites = {}) { return result("blocked", [], [], null, message, prerequisites); }
function nothing(message, endpoints, prerequisites) { return result("nothing-to-route", endpoints, [], null, message, prerequisites); }
