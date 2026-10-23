/**
 * Screen-space route picking for the manual CAD shell.
 *
 * Route geometry remains authoritative in floor-local millimetres. Picking is
 * deliberately measured in CSS pixels so the tolerance does not grow or
 * shrink when the shared camera zoom changes.
 */

export const ROUTE_PICK_TOLERANCE_CSS_PX = 12;

export function pickRouteAtClientPoint(routes, camera, rect, clientPoint, options = {}) {
  if (!Array.isArray(routes)) throw new TypeError("Routes must be an array");
  const tolerancePx = finitePositive(
    options.tolerancePx ?? ROUTE_PICK_TOLERANCE_CSS_PX,
    "Route pick tolerance",
  );
  const millimetresPerViewUnit = finitePositive(
    options.millimetresPerViewUnit ?? 10,
    "Millimetres per view unit",
  );
  const pointsForRoute = options.pointsForRoute ?? ((route) => route.points);
  if (typeof pointsForRoute !== "function") throw new TypeError("Route points resolver must be a function");
  validateCamera(camera);
  validateRect(rect);
  const click = {
    x: finite(clientPoint?.x, "Client x"),
    y: finite(clientPoint?.y, "Client y"),
  };

  let nearest = null;
  for (const route of routes) {
    const routePoints = pointsForRoute(route);
    if (!route?.id || !Array.isArray(routePoints) || routePoints.length < 2) continue;
    const points = routePoints.map((point) => projectToClient(
      point,
      camera,
      rect,
      millimetresPerViewUnit,
    ));
    let distancePx = Infinity;
    for (let index = 1; index < points.length; index += 1) {
      distancePx = Math.min(distancePx, pointToSegmentDistance(click, points[index - 1], points[index]));
    }
    if (distancePx <= tolerancePx && (nearest === null || distancePx < nearest.distancePx)) {
      nearest = { routeId: route.id, distancePx };
    }
  }
  return nearest;
}

function projectToClient(point, camera, rect, millimetresPerViewUnit) {
  const viewX = finite(point?.x, "Route point x") / millimetresPerViewUnit;
  const viewY = finite(point?.y, "Route point y") / millimetresPerViewUnit;
  return {
    x: rect.left + ((viewX - camera.x) / camera.width) * rect.width,
    y: rect.top + ((viewY - camera.y) / camera.height) * rect.height,
  };
}

function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
  ));
  return Math.hypot(
    point.x - (start.x + projection * dx),
    point.y - (start.y + projection * dy),
  );
}

function validateCamera(camera) {
  finite(camera?.x, "Camera x");
  finite(camera?.y, "Camera y");
  finitePositive(camera?.width, "Camera width");
  finitePositive(camera?.height, "Camera height");
}

function validateRect(rect) {
  finite(rect?.left, "Canvas left");
  finite(rect?.top, "Canvas top");
  finitePositive(rect?.width, "Canvas width");
  finitePositive(rect?.height, "Canvas height");
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function finitePositive(value, label) {
  const normalized = finite(value, label);
  if (normalized <= 0) throw new RangeError(`${label} must be positive`);
  return normalized;
}
