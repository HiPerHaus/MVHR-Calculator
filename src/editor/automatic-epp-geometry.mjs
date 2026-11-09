import { previewDuctRouteGeometry } from "../domain/spatial.mjs";
import { routeFamilyForKind } from "./component-catalogue.mjs";
import { deriveDuctBodyGeometry } from "./duct-body-geometry.mjs";
import { validateDuctPathInsideOutline, validateDuctPathClearances } from "./automatic-radial-routing.mjs";

const EPS = 1e-6;

// Validate the exact disposable domain result, not a differently smoothed planner
// polyline. Keep command inputs separate so commit does not normalize twice.
export function inspectAutomaticEppGeometry(project, routeInput, polygon, options = {}) {
  const route = previewDuctRouteGeometry(project, routeInput);
  const body = deriveDuctBodyGeometry(route, routeFamilyForKind(route.ductKind));
  const diameterMm = body.diameterMm;
  const exteriorStart = isExternalEndpoint(project, route.startAttachment);
  const exteriorEnd = isExternalEndpoint(project, route.endAttachment);
  const external = ["intake", "exhaust"].includes(route.stream) && exteriorStart !== exteriorEnd;
  const valid = Number.isFinite(diameterMm) && body.lanes.every(lane => {
    if (!validateDuctPathClearances(lane, diameterMm, options)) return false;
    if (validateDuctPathInsideOutline(lane, polygon, diameterMm, options)) return true;
    // Only the final straight sampled leg, in the direction of the selected
    // external terminal, can leave the outline. All bends and other body
    // segments retain full drawing-width containment, including twin lanes.
    const outward = exteriorStart ? lane.slice().reverse() : lane;
    const interior = outward.slice(0, -1);
    if (interior.length === 1) interior.push(interior[0]);
    return external && validateDuctPathInsideOutline(interior, polygon, diameterMm, options) &&
      singleBoundaryExit(outward.at(-2), outward.at(-1), polygon, diameterMm / 2);
  });
  return Object.freeze({ valid, route, body, exteriorTermination: external });
}

function isExternalEndpoint(project, endpoint) {
  if (!endpoint) return false;
  const component = project.components.find(candidate => candidate.id === endpoint.componentId);
  return /external-grille/.test(component?.catalogueItemId ?? "");
}

// Split a straight terminal leg at every polygon intersection. Concave outlines
// cannot permit leaving, re-entering and leaving again under the terminal exception.
function singleBoundaryExit(start, end, polygon, radiusMm) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const values = [0, 1];
  const crossings = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const denominator = dx * ey - dy * ex;
    if (Math.abs(denominator) <= EPS) continue;
    const t = ((a.x - start.x) * ey - (a.y - start.y) * ex) / denominator;
    const u = ((a.x - start.x) * dy - (a.y - start.y) * dx) / denominator;
    if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) continue;
    crossings.push({ edge: index, t: Math.max(0, Math.min(1, t)) });
    values.push(Math.max(0, Math.min(1, t)));
  }
  if (!crossings.length) return false;
  values.sort((a, b) => a - b);
  let outside = false;
  let exitT = 1;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] - values[index - 1] <= EPS) continue;
    const t = (values[index] + values[index - 1]) / 2;
    const inside = pointInside({ x: start.x + dx * t, y: start.y + dy * t }, polygon);
    if (inside && outside) return false;
    if (!inside && !outside) { outside = true; exitT = values[index - 1]; }
  }
  // The exception is local to the actual exit. A terminal leg must not clip a
  // different boundary edge earlier, even if its centreline remains inside.
  if (crossings.some(crossing => Math.abs(crossing.t - exitT) > EPS)) return false;
  const exitEdges = new Set(crossings.map(crossing => crossing.edge));
  return polygon.every((a, index) => {
    if (exitEdges.has(index)) return true;
    const b = polygon[(index + 1) % polygon.length];
    return Math.min(pointSegmentDistance(start, a, b), pointSegmentDistance(end, a, b),
      pointSegmentDistance(a, start, end), pointSegmentDistance(b, start, end)) + EPS >= radiusMm;
  });
}

function pointSegmentDistance(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, squared = dx * dx + dy * dy;
  const t = squared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / squared));
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

function pointInside(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
