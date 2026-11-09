/**
 * Screen-space route picking for the manual CAD shell.
 *
 * Route geometry remains authoritative in floor-local millimetres. Picking is
 * deliberately measured in CSS pixels so the tolerance does not grow or
 * shrink when the shared camera zoom changes.
 */

export const ROUTE_PICK_TOLERANCE_CSS_PX = 12;

export function pickRouteAtClientPoint(routes, camera, rect, clientPoint, options = {}) {
  return pickRoutesAtClientPoint(routes, camera, rect, clientPoint, options)[0] ?? null;
}

export function pickRoutesAtClientPoint(routes, camera, rect, clientPoint, options = {}) {
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
  const pathsForRoute = options.pathsForRoute ?? (route => [pointsForRoute(route)]);
  if (typeof pathsForRoute !== "function") throw new TypeError("Route paths resolver must be a function");
  if (typeof pointsForRoute !== "function") throw new TypeError("Route points resolver must be a function");
  validateCamera(camera);
  validateRect(rect);
  const click = {
    x: finite(clientPoint?.x, "Client x"),
    y: finite(clientPoint?.y, "Client y"),
  };

  const hits = [];
  for (const route of routes) {
    if (!route?.id) continue;
    let distancePx = Infinity;
    for (const routePoints of pathsForRoute(route)) {
      if (!Array.isArray(routePoints) || routePoints.length < 2) continue;
      const points = routePoints.map(point => projectToClient(point, camera, rect, millimetresPerViewUnit));
      for (let index = 1; index < points.length; index += 1) {
        distancePx = Math.min(distancePx, pointToSegmentDistance(click, points[index - 1], points[index]));
      }
    }
    if (distancePx <= tolerancePx) {
      hits.push({ routeId: route.id, distancePx });
    }
  }
  return hits.sort((left, right) => left.distancePx - right.distancePx);
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

// Repeat clicks at the same screen position cycle all overlapping ducts.
// Model identity changes and camera/pointer movement start a fresh selection.
export function cycleRoutePick(hits, point, previous = null) {
  const ids = hits.map(hit => hit.routeId);
  if (!ids.length) return {routeId:null,cycle:null};
  const same = previous && Math.hypot(point.x-previous.x,point.y-previous.y)<=4 && ids.length===previous.ids.length && ids.every(id=>previous.ids.includes(id));
  const index = same ? (ids.indexOf(previous.routeId)+1)%ids.length : 0;
  return {routeId:ids[index],cycle:{...point,ids,routeId:ids[index]}};
}
