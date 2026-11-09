import { routeFamilyForKind } from "./component-catalogue.mjs";
import { deriveDuctBodyGeometry } from "./duct-body-geometry.mjs";

const EPS = 1e-6;

export function routingCoordinationInputs(project, floorId, options = {}) {
  const { clearSpacingMm, clearanceBasis, exclusions } = coordinationSettings(project, floorId);
  const excludedRouteIds = new Set(options.excludeRouteIds ?? []);
  const forbiddenPolygons = exclusions.map(exclusionPolygon);
  const blockedSegments = [];
  for (const route of project.routes ?? []) {
    if (route.floorId !== floorId || excludedRouteIds.has(route.id)) continue;
    const geometry = deriveDuctBodyGeometry(route, routeFamilyForKind(route.ductKind));
    if (!geometry.scaled) continue;
    for (const lane of geometry.lanes) {
      for (let index = 1; index < lane.length; index += 1) {
        blockedSegments.push({ start: planPoint(lane[index - 1]), end: planPoint(lane[index]), radiusMm: geometry.diameterMm / 2, routeId: route.id, diameterBasis: geometry.diameterBasis,
          endpointComponentIds: index === 1 ? [route.startAttachment?.componentId].filter(Boolean) : index === lane.length - 1 ? [route.endAttachment?.componentId].filter(Boolean) : [] });
      }
    }
  }
  return Object.freeze({
    forbiddenPolygons: Object.freeze(forbiddenPolygons),
    blockedSegments: Object.freeze(blockedSegments),
    clearSpacingMm,
    clearanceBasis,
    exclusions: Object.freeze(exclusions.map((item) => structuredClone(item))),
  });
}

export function inspectRoutingCoordination(project, floorId) {
  // Inspection needs settings, not the separately derived automatic-routing blockers.
  const inputs = coordinationSettings(project, floorId);
  const routes = (project.routes ?? []).filter((route) => route.floorId === floorId).map(routeEnvelope);
  const diagnostics = [];
  for (const route of routes) {
    const selfCrossing = selfCrossingDiagnostic(route, inputs.clearSpacingMm);
    if (selfCrossing) diagnostics.push(selfCrossing);
    for (const exclusion of inputs.exclusions) {
      if (!polylineNearPolygon(route.points, exclusionPolygon(exclusion), route.radiusMm)) continue;
      const vertical = routeObstacleVerticalStatus(route, exclusion);
      if (vertical === "clear") continue;
      const unknown = vertical === "unknown";
      diagnostics.push({
        id: `route-obstacle-${route.id}-${exclusion.id}`,
        code: unknown ? "route-obstacle-height-unverified" : "route-obstacle-clash",
        severity: unknown ? "warning" : "error",
        title: unknown ? "Route crosses an obstacle with unresolved height" : "Route clashes with a marked routing exclusion",
        detail: `${route.id} intersects ${exclusion.name} in plan. ${verticalDetail(route, exclusion, unknown)} Diameter basis: ${route.diameterBasis === "outside" ? "known outside diameter" : "nominal DN guide; external envelope unverified"}.`,
        routeId: route.id,
        exclusionId: exclusion.id,
      });
    }
  }
  for (let leftIndex = 0; leftIndex < routes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < routes.length; rightIndex += 1) {
      const left = routes[leftIndex], right = routes[rightIndex];
      if (shareAttachedEndpoint(left.route, right.route)) continue;
      const required = left.radiusMm + right.radiusMm + inputs.clearSpacingMm;
      if (polylineDistance(left.points, right.points) + EPS >= required) continue;
      const vertical = routePairVerticalStatus(left, right, required);
      if (vertical === "clear") continue;
      const unknown = vertical === "unknown";
      diagnostics.push({
        id: `route-clearance-${left.route.id}-${right.route.id}`,
        code: unknown ? "route-clearance-height-unverified" : "route-clearance-conflict",
        severity: unknown ? "warning" : "error",
        title: unknown ? "Duct crossing needs height review" : "Duct routes do not meet the modelled clearance",
        detail: `${left.route.id} and ${right.route.id} are closer in plan than their modelled radii${inputs.clearSpacingMm ? ` plus ${inputs.clearSpacingMm} mm clear spacing` : ""}. ${unknown ? "One or both route elevations are unknown, so an over/under crossing cannot be confirmed." : "Their known elevations overlap."} Diameter basis: ${diameterBasisLabel(left, right)}.`,
        routeId: left.route.id,
        otherRouteId: right.route.id,
      });
    }
  }
  return Object.freeze({ floorId, clearSpacingMm: inputs.clearSpacingMm, clearanceBasis: inputs.clearanceBasis, diagnostics: Object.freeze(diagnostics) });
}

export function exclusionPolygon(exclusion) {
  const { x, y, width, height } = exclusion.geometry;
  return Object.freeze([{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }].map(Object.freeze));
}

function coordinationSettings(project, floorId) {
  const setting = project.routingClearanceSettings?.find((candidate) => candidate.floorId === floorId);
  const clearSpacingMm = setting?.clearSpacingMm?.state === "unknown" ? 0 : setting?.clearSpacingMm?.valueMm ?? 0;
  return {
    clearSpacingMm,
    clearanceBasis: setting?.clearSpacingMm?.state === "unknown" || !setting ? "unset-zero-gap-only" : `${setting.clearSpacingMm.state}-${clearSpacingMm}mm`,
    exclusions: (project.routingExclusions ?? []).filter((candidate) => candidate.floorId === floorId),
  };
}

function selfCrossingDiagnostic(envelope, clearSpacingMm) {
  const { points, route } = envelope;
  const required = envelope.radiusMm * 2 + clearSpacingMm;
  const lengths = [0];
  for (let i = 1; i < points.length; i += 1) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  let overlaps = false;
  for (let i = 1; i < points.length && !overlaps; i += 1) {
    const a = points[i - 1], b = points[i];
    if (lengths[i] - lengths[i - 1] <= EPS) continue;
    for (let j = i + 1; j < points.length; j += 1) {
      const c = points[j - 1], d = points[j];
      if (lengths[j] - lengths[j - 1] <= EPS) continue;
      if (Math.max(a.x, b.x) + required + EPS < Math.min(c.x, d.x) || Math.max(c.x, d.x) + required + EPS < Math.min(a.x, b.x) || Math.max(a.y, b.y) + required + EPS < Math.min(c.y, d.y) || Math.max(c.y, d.y) + required + EPS < Math.min(a.y, b.y)) continue;
      if (j === i + 1) {
        // A shared vertex is normal; a reversal retraces positive duct length.
        const ux = b.x - a.x, uy = b.y - a.y, vx = d.x - c.x, vy = d.y - c.y;
        if (Math.abs(ux * vy - uy * vx) <= EPS && ux * vx + uy * vy < -EPS) overlaps = true;
      } else if (segmentsIntersect(a, b, c, d)) {
        overlaps = true;
      } else if (required > 0 && nonlocalEnvelopeOverlap(a, b, c, d, lengths[i - 1], lengths[j - 1], required)) {
        // Nearby samples on the same smooth elbow are one continuous body,
        // not a collision. Only compare envelopes separated along the route.
        overlaps = true;
      }
      if (overlaps) break;
    }
  }
  if (!overlaps) return null;
  const pointHeights = route.points.map((point) => point.z);
  const commonPointHeight = pointHeights.length > 0 && pointHeights.every((height) => height?.state !== "unknown" && Number.isFinite(height?.valueMm) && Math.abs(height.valueMm - pointHeights[0].valueMm) <= EPS);
  const knownHeight = envelope.elevation.state !== "unknown" && Number.isFinite(envelope.elevation.valueMm) || commonPointHeight;
  return {
    id: `route-self-crossing-${route.id}`,
    code: knownHeight ? "route-self-crossing" : "route-self-crossing-height-unverified",
    severity: "warning",
    title: knownHeight ? "Duct route crosses or overlaps itself" : "Duct self-crossing needs height review",
    detail: `${route.id} crosses or overlaps a separate part of its own plan path. ${knownHeight ? "The modelled route elevation does not separate these parts." : "A separating elevation is not confirmed; review any intended rise/drop or over/under crossing."} Visual overlap does not create a connection. Diameter basis: ${envelope.diameterBasis === "outside" ? "known outside diameter" : "nominal DN guide; external envelope unverified"}.`,
    routeId: route.id,
  };
}

function nonlocalEnvelopeOverlap(a, b, c, d, leftStart, rightStart, required) {
  const leftLength = Math.hypot(b.x - a.x, b.y - a.y), rightLength = Math.hypot(d.x - c.x, d.y - c.y);
  const projection = (p, start, end) => Math.max(0, Math.min(1, ((p.x - start.x) * (end.x - start.x) + (p.y - start.y) * (end.y - start.y)) / ((end.x - start.x) ** 2 + (end.y - start.y) ** 2)));
  // Endpoint projections include both ends of parallel overlaps. Taking only
  // the gap between segment indices would miss long, tight returning legs.
  const candidates = [[0, projection(a, c, d)], [1, projection(b, c, d)], [projection(c, a, b), 0], [projection(d, a, b), 1]];
  return candidates.some(([t, u]) => {
    const separation = rightStart + u * rightLength - leftStart - t * leftLength;
    return separation > required * 2 && Math.hypot(a.x + t * (b.x - a.x) - c.x - u * (d.x - c.x), a.y + t * (b.y - a.y) - c.y - u * (d.y - c.y)) + EPS < required;
  });
}

function routeEnvelope(route) {
  const geometry = deriveDuctBodyGeometry(route, routeFamilyForKind(route.ductKind));
  return { route, points: geometry.sampledCentreline.map(planPoint), radiusMm: (geometry.diameterMm ?? 0) / 2, diameterBasis: geometry.diameterBasis, elevation: route.routingElevationMm ?? { state: "unknown", valueMm: null } };
}
function routeObstacleVerticalStatus(route, exclusion) {
  if (exclusion.verticalRange.mode === "all-height") return "clash";
  const bottom = exclusion.verticalRange.bottomMm, top = exclusion.verticalRange.topMm;
  if (route.elevation.state === "unknown" || bottom.state === "unknown" || top.state === "unknown") return "unknown";
  return route.elevation.valueMm + route.radiusMm <= bottom.valueMm + EPS || route.elevation.valueMm - route.radiusMm >= top.valueMm - EPS ? "clear" : "clash";
}
function routePairVerticalStatus(left, right, required) {
  if (left.elevation.state === "unknown" || right.elevation.state === "unknown") return "unknown";
  return Math.abs(left.elevation.valueMm - right.elevation.valueMm) + EPS >= required ? "clear" : "clash";
}
function verticalDetail(route, exclusion, unknown) {
  if (exclusion.verticalRange.mode === "all-height") return "The exclusion is forbidden at every height.";
  if (unknown) return "The route elevation or obstacle range is unknown, so an over/under clearance cannot be confirmed.";
  return `The known route elevation overlaps the marked ${exclusion.verticalRange.bottomMm.valueMm}–${exclusion.verticalRange.topMm.valueMm} mm vertical range.`;
}
function diameterBasisLabel(left, right) { return [left, right].every((item) => item.diameterBasis === "outside") ? "known outside diameters" : "one or more nominal DN guides; external envelopes unverified"; }
function shareAttachedEndpoint(left, right) {
  const leftKeys = new Set([left.startAttachment, left.endAttachment].filter(Boolean).map(endpointKey));
  return [right.startAttachment, right.endAttachment].filter(Boolean).some((endpoint) => leftKeys.has(endpointKey(endpoint)));
}
function endpointKey(endpoint) { return `${endpoint.componentId}/${endpoint.portId}`; }
function planPoint(point) { return { x: point.x, y: point.y }; }
function polylineNearPolygon(points, polygon, radius) {
  for (let index = 1; index < points.length; index += 1) {
    if (pointInPolygon(points[index - 1], polygon) || pointInPolygon(points[index], polygon)) return true;
    for (let edge = 0; edge < polygon.length; edge += 1) if (segmentDistance(points[index - 1], points[index], polygon[edge], polygon[(edge + 1) % polygon.length]) < radius + EPS) return true;
  }
  return false;
}
function polylineDistance(left, right) {
  let distance = Infinity;
  for (let l = 1; l < left.length; l += 1) for (let r = 1; r < right.length; r += 1) distance = Math.min(distance, segmentDistance(left[l - 1], left[l], right[r - 1], right[r]));
  return distance;
}
function segmentDistance(a, b, c, d) { if (segmentsIntersect(a, b, c, d)) return 0; return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b)); }
function pointSegmentDistance(point, start, end) { const dx = end.x - start.x, dy = end.y - start.y, squared = dx * dx + dy * dy; if (!squared) return Math.hypot(point.x - start.x, point.y - start.y); const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / squared)); return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy); }
function segmentsIntersect(a, b, c, d) { const o = (p, q, r) => (q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x); const values = [o(a,b,c),o(a,b,d),o(c,d,a),o(c,d,b)]; return ((values[0] > EPS && values[1] < -EPS) || (values[0] < -EPS && values[1] > EPS)) && ((values[2] > EPS && values[3] < -EPS) || (values[2] < -EPS && values[3] > EPS)) || values.some((value) => Math.abs(value) <= EPS) && Math.min(pointSegmentDistance(a,c,d),pointSegmentDistance(b,c,d),pointSegmentDistance(c,a,b),pointSegmentDistance(d,a,b)) <= EPS; }
function pointInPolygon(point, polygon) { let inside = false; for (let i=0,j=polygon.length-1;i<polygon.length;j=i,i+=1) { const a=polygon[i],b=polygon[j]; if ((a.y>point.y)!==(b.y>point.y) && point.x < (b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x) inside=!inside; } return inside; }
