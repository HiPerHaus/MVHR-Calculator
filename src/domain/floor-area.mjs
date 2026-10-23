const GEOMETRY_EPSILON_MM = 1e-6;
const MIN_NONZERO_AREA_MM2 = 1;

export const MAX_FLOOR_AREA_VERTICES = 256;

export function inspectFloorAreaOutline(outline) {
  const points = outline.vertices.map((vertex) => ({
    x: vertex.positionMm.x,
    y: vertex.positionMm.y,
  }));
  assertSimpleFloorAreaPolygon(points);
  return Object.freeze({
    areaMm2: polygonAreaMm2(points),
    perimeterMm: polygonPerimeterMm(points),
    centroidMm: Object.freeze(polygonCentroidMm(points)),
    polygon: Object.freeze(points.map((point) => Object.freeze(point))),
  });
}

export function assertSimpleFloorAreaPolygon(points, label = "Floor area outline") {
  if (!Array.isArray(points)) throw new TypeError(`${label} vertices must be an array`);
  if (points.length < 3) throw new RangeError(`${label} requires at least three vertices`);
  if (points.length > MAX_FLOOR_AREA_VERTICES) {
    throw new RangeError(`${label} exceeds the ${MAX_FLOOR_AREA_VERTICES}-vertex prototype limit`);
  }
  for (const [index, point] of points.entries()) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
      throw new TypeError(`${label} vertex ${index + 1} must use finite millimetre coordinates`);
    }
  }
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      if (samePoint(points[left], points[right])) {
        throw new RangeError(`${label} cannot repeat a vertex`);
      }
    }
  }
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      if (
        first === second || firstNext === second || secondNext === first ||
        (first === 0 && secondNext === 0)
      ) continue;
      if (segmentsIntersect(points[first], points[firstNext], points[second], points[secondNext])) {
        throw new RangeError(`${label} cannot self-intersect or self-touch`);
      }
    }
  }
  if (polygonAreaMm2(points) <= MIN_NONZERO_AREA_MM2) {
    throw new RangeError(`${label} must enclose a non-degenerate area`);
  }
  return points;
}

export function polygonAreaMm2(points) {
  return Math.abs(signedDoubleArea(points)) / 2;
}

export function polygonPerimeterMm(points) {
  let perimeter = 0;
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    perimeter += Math.hypot(end.x - start.x, end.y - start.y);
  }
  return perimeter;
}

export function polygonCentroidMm(points) {
  const doubleArea = signedDoubleArea(points);
  if (Math.abs(doubleArea) <= GEOMETRY_EPSILON_MM) {
    throw new RangeError("Floor area outline must enclose a non-degenerate area");
  }
  let x = 0;
  let y = 0;
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const cross = start.x * end.y - end.x * start.y;
    x += (start.x + end.x) * cross;
    y += (start.y + end.y) * cross;
  }
  return { x: x / (3 * doubleArea), y: y / (3 * doubleArea) };
}

function signedDoubleArea(points) {
  let value = 0;
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    value += start.x * end.y - end.x * start.y;
  }
  return value;
}

function segmentsIntersect(a, b, c, d) {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (
    oppositeSigns(abC, abD) &&
    oppositeSigns(cdA, cdB)
  ) return true;
  return (
    (nearZero(abC) && pointOnSegment(c, a, b)) ||
    (nearZero(abD) && pointOnSegment(d, a, b)) ||
    (nearZero(cdA) && pointOnSegment(a, c, d)) ||
    (nearZero(cdB) && pointOnSegment(b, c, d))
  );
}

function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(point, start, end) {
  return (
    point.x >= Math.min(start.x, end.x) - GEOMETRY_EPSILON_MM &&
    point.x <= Math.max(start.x, end.x) + GEOMETRY_EPSILON_MM &&
    point.y >= Math.min(start.y, end.y) - GEOMETRY_EPSILON_MM &&
    point.y <= Math.max(start.y, end.y) + GEOMETRY_EPSILON_MM
  );
}

function samePoint(left, right) {
  return Math.abs(left.x - right.x) <= GEOMETRY_EPSILON_MM &&
    Math.abs(left.y - right.y) <= GEOMETRY_EPSILON_MM;
}

function nearZero(value) {
  return Math.abs(value) <= GEOMETRY_EPSILON_MM;
}

function oppositeSigns(left, right) {
  return (left > GEOMETRY_EPSILON_MM && right < -GEOMETRY_EPSILON_MM) ||
    (left < -GEOMETRY_EPSILON_MM && right > GEOMETRY_EPSILON_MM);
}
