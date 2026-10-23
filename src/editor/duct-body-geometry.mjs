/**
 * Disposable plan rendering geometry for drawn duct routes.
 *
 * Authoritative route points and endpoint bindings remain untouched. Widths
 * use a known outside diameter when one exists; otherwise a nominal DN value
 * is only a labelled drawing guide, never an installation envelope.
 */

export const EPP_BEND_DRAWING_REFERENCE = Object.freeze({
  sourceUrl: "https://solutionair-online.co.nz/wp-content/uploads/2026/04/Datasheet-Utek-EPP-160-Bend.pdf",
  referenceArticle: "400480494",
  use: "shape-reference-only",
  ownerAmendment: "plain-ended-without-fixed-sleeve",
  dimensionsTransferredToInstalledProduct: false,
});

export const TWIN_SCHEMATIC_GAP_RATIO = 0.6;
export const TWIN_JOIN_MITER_LIMIT = 2;
export const SWEEP_TRIM_RATIO = 0.25;
export const SWEEP_SAMPLES_PER_CORNER = 8;

const EPSILON_MM = 1e-6;

export function deriveDuctBodyGeometry(route, family, options = {}) {
  const rigidEpp = /^epp-rigid-dn/.test(route?.ductKind ?? "");
  const displayDiameter = resolveDisplayDiameter(route?.connectionInterface, family?.connectionInterface);
  const sweep = rigidEpp ? deriveRigidEppCentreline(route?.points, displayDiameter?.valueMm ?? 160) : deriveSweptCentreline(route?.points, options);
  const presentation = { rigidEpp, elbows: sweep.elbows ?? [] };
  const centreline = sweep.points;
  const arrangement = normalizeArrangement(route?.parallelRunCount ?? null);
  const diameter = resolveDisplayDiameter(route?.connectionInterface, family?.connectionInterface);
  if (diameter === null) {
    return {
      ...presentation,
      arrangement,
      scaled: false,
      diameterMm: null,
      diameterBasis: "unknown",
      laneCentreOffsetMm: null,
      sampledCentreline: centreline,
      lanes: [centreline.map(clonePoint)],
      endpointPresentation: "authoritative-centreline-only",
      authoritativePolylineLengthMm: sweep.authoritativePolylineLengthMm,
      visualSweepLengthMm: sweep.visualSweepLengthMm,
      fallbackCornerCount: sweep.fallbackCornerCount,
    };
  }

  if (arrangement !== "twin") {
    return {
      ...presentation,
      arrangement,
      scaled: true,
      diameterMm: diameter.valueMm,
      diameterBasis: diameter.basis,
      laneCentreOffsetMm: 0,
      sampledCentreline: centreline,
      lanes: [centreline.map(clonePoint)],
      endpointPresentation: "authoritative-centreline-only",
      authoritativePolylineLengthMm: sweep.authoritativePolylineLengthMm,
      visualSweepLengthMm: sweep.visualSweepLengthMm,
      fallbackCornerCount: sweep.fallbackCornerCount,
    };
  }

  const gapRatio = finiteNonNegative(
    options.twinGapRatio ?? TWIN_SCHEMATIC_GAP_RATIO,
    "Twin schematic gap ratio",
  );
  const miterLimit = finitePositive(
    options.miterLimit ?? TWIN_JOIN_MITER_LIMIT,
    "Twin join miter limit",
  );
  const laneCentreOffsetMm = diameter.valueMm * (0.5 + gapRatio / 2);
  const twin = deriveTwinLanes(centreline, laneCentreOffsetMm, diameter.valueMm, miterLimit);
  return {
    ...presentation,
    arrangement,
    scaled: true,
    diameterMm: diameter.valueMm,
    diameterBasis: diameter.basis,
    laneCentreOffsetMm,
    sampledCentreline: twin.sampledCentreline,
    lanes: twin.lanes,
    endpointPresentation: "lanes-converge-to-one-authoritative-endpoint",
    authoritativePolylineLengthMm: sweep.authoritativePolylineLengthMm,
    visualSweepLengthMm: sweep.visualSweepLengthMm,
    fallbackCornerCount: sweep.fallbackCornerCount,
  };
}

// Fixed schematic radius keeps long EPP legs straight. It is not manufacturer fitting setout.
export function deriveRigidEppCentreline(points, diameterMm = 160) {
  const controls = normalizePlanPoints(points);
  const sampled = [clonePoint(controls[0])], elbows = [];
  let fallbackCornerCount = 0;
  for (let i = 1; i < controls.length - 1; i++) {
    const vertex = controls[i];
    const incoming = directionBetween(controls[i-1], vertex), outgoing = directionBetween(vertex, controls[i+1]);
    if (!incoming || !outgoing) { pushUniquePoint(sampled, vertex); continue; }
    const u = incoming.direction, v = outgoing.direction;
    const dot = Math.max(-1, Math.min(1, u.x*v.x + u.y*v.y));
    const angle = Math.acos(dot), degrees = angle * 180 / Math.PI;
    if (degrees < 0.5) { pushUniquePoint(sampled, vertex); continue; }
    const nominalAngle = Math.abs(degrees-90) <= 0.5 ? 90 : Math.abs(degrees-45) <= 0.5 ? 45 : null;
    const requestedTrim = diameterMm * Math.tan(angle/2);
    if (!nominalAngle || requestedTrim > Math.min(incoming.lengthMm*(i===1?0.9:0.45), outgoing.lengthMm*(i===controls.length-2?0.9:0.45))) {
      pushUniquePoint(sampled, vertex); fallbackCornerCount++;
      elbows.push({ angleDegrees: nominalAngle ?? degrees, drawable:false, vertex:clonePoint(vertex), seams:[] });
      continue;
    }
    const sign = Math.sign(u.x*v.y-u.y*v.x), trim = requestedTrim;
    const entry = { x:vertex.x-u.x*trim, y:vertex.y-u.y*trim };
    const exit = { x:vertex.x+v.x*trim, y:vertex.y+v.y*trim };
    const centre = { x:entry.x-u.y*diameterMm*sign, y:entry.y+u.x*diameterMm*sign };
    const startAngle = Math.atan2(entry.y-centre.y, entry.x-centre.x);
    pushUniquePoint(sampled, entry);
    const steps = nominalAngle === 90 ? 12 : 6;
    for (let step=1;step<=steps;step++) {
      const a = startAngle+sign*angle*step/steps;
      pushUniquePoint(sampled, {x:centre.x+diameterMm*Math.cos(a),y:centre.y+diameterMm*Math.sin(a)});
    }
    const seam = (p,d) => ({a:{x:p.x-d.y*diameterMm/2,y:p.y+d.x*diameterMm/2},b:{x:p.x+d.y*diameterMm/2,y:p.y-d.x*diameterMm/2}});
    const middleAngle = startAngle+sign*angle/2;
    const middle = {x:centre.x+diameterMm*Math.cos(middleAngle),y:centre.y+diameterMm*Math.sin(middleAngle)};
    const middleDirection = {x:-Math.sin(middleAngle)*sign,y:Math.cos(middleAngle)*sign};
    elbows.push({angleDegrees:nominalAngle, drawable:true, vertex:clonePoint(vertex), radiusMm:diameterMm,
      endStyle:"plain", fixedSleeve:false, entry, exit, seams:[seam(entry,u),seam(exit,v)],
      halfCutGuide:nominalAngle === 90 ? seam(middle,middleDirection) : null });
  }
  pushUniquePoint(sampled, controls.at(-1));
  return {points:sampled, elbows, authoritativePolylineLengthMm:planLength(controls),visualSweepLengthMm:planLength(sampled),fallbackCornerCount};
}

export function deriveSweptCentreline(points, options = {}) {
  const controlPoints = normalizePlanPoints(points);
  const trimRatio = finiteInRange(
    options.sweepTrimRatio ?? SWEEP_TRIM_RATIO,
    0,
    0.49,
    "Sweep trim ratio",
  );
  const samplesPerCorner = integerInRange(
    options.samplesPerCorner ?? SWEEP_SAMPLES_PER_CORNER,
    2,
    32,
    "Sweep samples per corner",
  );
  const swept = [clonePoint(controlPoints[0])];
  let fallbackCornerCount = 0;
  for (let index = 1; index < controlPoints.length - 1; index += 1) {
    const previous = controlPoints[index - 1];
    const control = controlPoints[index];
    const next = controlPoints[index + 1];
    const incoming = directionBetween(previous, control);
    const outgoing = directionBetween(control, next);
    if (!incoming || !outgoing) {
      pushUniquePoint(swept, control);
      fallbackCornerCount += 1;
      continue;
    }
    const dot = incoming.direction.x * outgoing.direction.x + incoming.direction.y * outgoing.direction.y;
    const cross = incoming.direction.x * outgoing.direction.y - incoming.direction.y * outgoing.direction.x;
    if (Math.abs(cross) <= 1e-8 && dot > 0.999999) {
      pushUniquePoint(swept, control);
      continue;
    }
    if (Math.abs(cross) <= 1e-5 && dot < -0.999) {
      pushUniquePoint(swept, control);
      fallbackCornerCount += 1;
      continue;
    }
    const trimMm = Math.min(incoming.lengthMm, outgoing.lengthMm) * trimRatio;
    if (trimMm <= EPSILON_MM) {
      pushUniquePoint(swept, control);
      fallbackCornerCount += 1;
      continue;
    }
    const entry = {
      x: control.x - incoming.direction.x * trimMm,
      y: control.y - incoming.direction.y * trimMm,
    };
    const exit = {
      x: control.x + outgoing.direction.x * trimMm,
      y: control.y + outgoing.direction.y * trimMm,
    };
    pushUniquePoint(swept, entry);
    for (let step = 1; step <= samplesPerCorner; step += 1) {
      const t = step / samplesPerCorner;
      const inverse = 1 - t;
      pushUniquePoint(swept, {
        x: inverse * inverse * entry.x + 2 * inverse * t * control.x + t * t * exit.x,
        y: inverse * inverse * entry.y + 2 * inverse * t * control.y + t * t * exit.y,
      });
    }
  }
  pushUniquePoint(swept, controlPoints.at(-1));
  return {
    points: swept,
    authoritativePolylineLengthMm: planLength(controlPoints),
    visualSweepLengthMm: planLength(swept),
    fallbackCornerCount,
  };
}

export function ductBodyDisplayLabel(geometry) {
  if (!geometry?.scaled) return "Diameter unknown · centreline only";
  const diameter = `${formatMillimetres(geometry.diameterMm)} mm`;
  const basis = geometry.diameterBasis === "outside"
    ? `${diameter} known outside diameter`
    : `${diameter} nominal DN guide · not an outside envelope`;
  if (geometry.arrangement === "twin") {
    return `Twin · ${basis} · parallel sweep spacing is schematic, converging to one typed endpoint`;
  }
  if (geometry.arrangement === "single") return `Single · ${basis}`;
  return `Arrangement not set · ${basis} shown dashed`;
}

function resolveDisplayDiameter(routeInterface, familyInterface) {
  for (const value of [routeInterface, familyInterface]) {
    if (Number.isFinite(value?.outsideDiameterMm) && value.outsideDiameterMm > 0) {
      return { valueMm: value.outsideDiameterMm, basis: "outside" };
    }
  }
  for (const value of [routeInterface, familyInterface]) {
    if (Number.isFinite(value?.nominalSizeMm) && value.nominalSizeMm > 0) {
      return { valueMm: value.nominalSizeMm, basis: "nominal" };
    }
  }
  return null;
}

function directionBetween(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthMm = Math.hypot(dx, dy);
  if (lengthMm <= EPSILON_MM) return null;
  return { lengthMm, direction: { x: dx / lengthMm, y: dy / lengthMm } };
}

function pushUniquePoint(points, point) {
  const previous = points.at(-1);
  if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) <= EPSILON_MM) return;
  points.push(clonePoint(point));
}

function planLength(points) {
  let lengthMm = 0;
  for (let index = 1; index < points.length; index += 1) {
    lengthMm += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return lengthMm;
}

function deriveTwinLanes(centreline, offsetMm, diameterMm, miterLimit) {
  const metrics = polylineMetrics(centreline);
  if (metrics.totalLengthMm <= EPSILON_MM) {
    return {
      sampledCentreline: centreline,
      lanes: [centreline.map(clonePoint), centreline.map(clonePoint)],
    };
  }
  const taperLengthMm = Math.min(
    metrics.totalLengthMm / 2,
    Math.max(diameterMm * 1.5, metrics.totalLengthMm * 0.12),
  );
  const distances = uniqueSortedDistances([
    ...metrics.cumulativeMm,
    taperLengthMm,
    metrics.totalLengthMm / 2,
    metrics.totalLengthMm - taperLengthMm,
  ], metrics.totalLengthMm);
  const samples = distances.map((distanceMm) => samplePolyline(
    centreline,
    metrics,
    distanceMm,
  ));
  const sampledCentreline = samples.map((sample) => clonePoint(sample.point));
  const lanes = [-1, 1].map((side) => samples.map((sample) => {
    const ramp = taperLengthMm <= EPSILON_MM
      ? 0
      : Math.min(1, sample.distanceMm / taperLengthMm, (metrics.totalLengthMm - sample.distanceMm) / taperLengthMm);
    const offset = joinOffsetVector(sample, offsetMm * Math.max(0, ramp), miterLimit);
    return {
      x: sample.point.x + offset.x * side,
      y: sample.point.y + offset.y * side,
    };
  }));
  lanes[0][0] = clonePoint(centreline[0]);
  lanes[1][0] = clonePoint(centreline[0]);
  lanes[0][lanes[0].length - 1] = clonePoint(centreline.at(-1));
  lanes[1][lanes[1].length - 1] = clonePoint(centreline.at(-1));
  return { sampledCentreline, lanes };
}

function polylineMetrics(points) {
  const cumulativeMm = [0];
  const segments = [];
  let totalLengthMm = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthMm = Math.hypot(dx, dy);
    const direction = lengthMm <= EPSILON_MM
      ? null
      : { x: dx / lengthMm, y: dy / lengthMm };
    segments.push({ start, end, lengthMm, direction });
    totalLengthMm += lengthMm;
    cumulativeMm.push(totalLengthMm);
  }
  return { cumulativeMm, segments, totalLengthMm };
}

function samplePolyline(points, metrics, distanceMm) {
  const lastIndex = points.length - 1;
  if (distanceMm <= EPSILON_MM) {
    return sampleAtVertex(points, metrics, 0, 0);
  }
  if (distanceMm >= metrics.totalLengthMm - EPSILON_MM) {
    return sampleAtVertex(points, metrics, lastIndex, metrics.totalLengthMm);
  }
  for (let vertexIndex = 1; vertexIndex < lastIndex; vertexIndex += 1) {
    if (Math.abs(distanceMm - metrics.cumulativeMm[vertexIndex]) <= EPSILON_MM) {
      return sampleAtVertex(points, metrics, vertexIndex, distanceMm);
    }
  }
  let segmentIndex = metrics.segments.findIndex((segment, index) => (
    segment.lengthMm > EPSILON_MM && distanceMm < metrics.cumulativeMm[index + 1] - EPSILON_MM
  ));
  if (segmentIndex < 0) {
    segmentIndex = metrics.segments.findIndex((segment) => segment.lengthMm > EPSILON_MM);
  }
  const segment = metrics.segments[segmentIndex];
  const localDistanceMm = distanceMm - metrics.cumulativeMm[segmentIndex];
  const fraction = Math.max(0, Math.min(1, localDistanceMm / segment.lengthMm));
  const normal = normalForDirection(segment.direction);
  return {
    point: {
      x: segment.start.x + (segment.end.x - segment.start.x) * fraction,
      y: segment.start.y + (segment.end.y - segment.start.y) * fraction,
    },
    distanceMm,
    previousNormal: normal,
    nextNormal: normal,
  };
}

function sampleAtVertex(points, metrics, vertexIndex, distanceMm) {
  const previousDirection = nearestDirection(metrics.segments, vertexIndex - 1, -1);
  const nextDirection = nearestDirection(metrics.segments, vertexIndex, 1);
  const fallback = previousDirection ?? nextDirection ?? { x: 1, y: 0 };
  return {
    point: clonePoint(points[vertexIndex]),
    distanceMm,
    previousNormal: normalForDirection(previousDirection ?? fallback),
    nextNormal: normalForDirection(nextDirection ?? fallback),
  };
}

function nearestDirection(segments, startIndex, step) {
  for (let index = startIndex; index >= 0 && index < segments.length; index += step) {
    if (segments[index].direction) return segments[index].direction;
  }
  return null;
}

function joinOffsetVector(sample, offsetMm, miterLimit) {
  if (offsetMm <= EPSILON_MM) return { x: 0, y: 0 };
  const sum = {
    x: sample.previousNormal.x + sample.nextNormal.x,
    y: sample.previousNormal.y + sample.nextNormal.y,
  };
  const magnitude = Math.hypot(sum.x, sum.y);
  if (magnitude <= EPSILON_MM) {
    return { x: sample.nextNormal.x * offsetMm, y: sample.nextNormal.y * offsetMm };
  }
  const miter = { x: sum.x / magnitude, y: sum.y / magnitude };
  const denominator = Math.abs(miter.x * sample.nextNormal.x + miter.y * sample.nextNormal.y);
  const requestedLength = denominator <= EPSILON_MM ? offsetMm : offsetMm / denominator;
  const appliedLength = Math.min(requestedLength, offsetMm * miterLimit);
  return { x: miter.x * appliedLength, y: miter.y * appliedLength };
}

function normalForDirection(direction) {
  return { x: -direction.y, y: direction.x };
}

function uniqueSortedDistances(values, totalLengthMm) {
  return values
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= totalLengthMm)
    .sort((left, right) => left - right)
    .filter((value, index, sorted) => index === 0 || Math.abs(value - sorted[index - 1]) > EPSILON_MM);
}

function normalizePlanPoints(points) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new TypeError("Duct body geometry requires at least two route points");
  }
  return points.map((point) => ({
    x: finite(point?.x, "Route point x"),
    y: finite(point?.y, "Route point y"),
  }));
}

function normalizeArrangement(value) {
  if (value === 1) return "single";
  if (value === 2) return "twin";
  if (value === null) return "unset";
  throw new RangeError("Route arrangement must be null, 1, or 2");
}

function clonePoint(point) {
  return { x: point.x, y: point.y };
}

function formatMillimetres(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
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

function finiteNonNegative(value, label) {
  const normalized = finite(value, label);
  if (normalized < 0) throw new RangeError(`${label} must be non-negative`);
  return normalized;
}


function finiteInRange(value, minimum, maximum, label) {
  const normalized = finite(value, label);
  if (normalized < minimum || normalized > maximum) {
    throw new RangeError(`${label} must be from ${minimum} through ${maximum}`);
  }
  return normalized;
}

function integerInRange(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}
