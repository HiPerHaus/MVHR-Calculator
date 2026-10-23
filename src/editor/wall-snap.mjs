const GEOMETRY_EPSILON_MM = 1e-6;

/**
 * Expands a wall-chain command so exact intersections with committed walls
 * become explicit shared nodes and wall splits. This is a user-intent helper
 * for Snap On, not a repair pass over persisted geometry.
 */
export function planSnappedWallChain(project, command, options = {}) {
  requireWallCollections(project);
  requireChainArrays(command);
  const idPrefix = requireId(options.idPrefix, "Wall snap ID prefix");
  const result = structuredClone(command);
  const existingWalls = project.walls.filter((wall) => {
    if (wall.floorId !== command.floorId) return false;
    if (command.classification !== "virtual") return true;
    return wall.classification === "physical" || wall.parentRoomId === command.parentRoomId;
  });
  const nodeById = new Map(project.wallNodes.map((node) => [node.id, node]));
  const occupiedIds = new Set([
    ...project.wallNodes.map((node) => node.id),
    ...project.walls.map((wall) => wall.id),
    ...command.nodeIds,
    ...command.wallIds,
  ]);
  let generatedNodeCounter = 1;
  let generatedWallCounter = 1;

  const junctions = [];
  for (let index = 0; index < command.points.length; index += 1) {
    const point = planPoint(command.points[index]);
    const existingNode = findNodeAt(project.wallNodes, command.floorId, point);
    const nodeId = existingNode?.id ?? command.nodeIds[index];
    const junction = junctionAt(junctions, point);
    if (junction && junction.nodeId !== nodeId) {
      if (existingNode) junction.nodeId = existingNode.id;
    } else if (!junction) {
      junctions.push({ point, nodeId });
    }
  }

  const insertedBySegment = new Map();
  const splitEventsByWall = new Map();
  const uniqueId = (kind) => {
    let candidate;
    do {
      const counter = kind === "node" ? generatedNodeCounter++ : generatedWallCounter++;
      candidate = `${idPrefix}-${kind}-${counter}`;
    } while (occupiedIds.has(candidate));
    occupiedIds.add(candidate);
    return candidate;
  };
  const nodeForIntersection = (point) => {
    const existingNode = findNodeAt(project.wallNodes, command.floorId, point);
    if (existingNode) return existingNode.id;
    const existingJunction = junctionAt(junctions, point);
    if (existingJunction) return existingJunction.nodeId;
    const nodeId = uniqueId("node");
    junctions.push({ point, nodeId });
    return nodeId;
  };

  for (let segmentIndex = 0; segmentIndex < command.points.length - 1; segmentIndex += 1) {
    const start = planPoint(command.points[segmentIndex]);
    const end = planPoint(command.points[segmentIndex + 1]);
    for (const wall of existingWalls) {
      const wallStart = planPoint(nodeById.get(wall.startNodeId)?.positionMm);
      const wallEnd = planPoint(nodeById.get(wall.endNodeId)?.positionMm);
      const intersection = segmentIntersection(start, end, wallStart, wallEnd);
      if (!intersection.intersects || intersection.overlap) continue;

      const nodeId = nodeForIntersection(intersection.point);
      if (strictlyInterior(intersection.t)) {
        appendUniqueIntersection(insertedBySegment, segmentIndex, {
          fraction: intersection.t,
          point: intersection.point,
          nodeId,
        });
      }
      if (strictlyInterior(intersection.u)) {
        appendUniqueIntersection(splitEventsByWall, wall.id, {
          fraction: intersection.u,
          point: intersection.point,
          nodeId,
        });
      }
    }
  }

  const rebuiltPoints = [];
  const rebuiltNodeIds = [];
  const rebuiltWallIds = [];
  for (let segmentIndex = 0; segmentIndex < command.points.length - 1; segmentIndex += 1) {
    const startPoint = structuredClone(command.points[segmentIndex]);
    const endPoint = structuredClone(command.points[segmentIndex + 1]);
    const startNodeId = nodeForIntersection(planPoint(startPoint));
    const endNodeId = nodeForIntersection(planPoint(endPoint));
    const entries = [
      { fraction: 0, point: startPoint, nodeId: startNodeId },
      ...(insertedBySegment.get(segmentIndex) ?? []).toSorted(compareIntersection),
      { fraction: 1, point: endPoint, nodeId: endNodeId },
    ];
    if (segmentIndex === 0) {
      rebuiltPoints.push(entries[0].point);
      rebuiltNodeIds.push(entries[0].nodeId);
    }
    for (let entryIndex = 1; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex];
      rebuiltPoints.push(entry.fraction === 1
        ? entry.point
        : pointWithUnknownElevation(entry.point));
      rebuiltNodeIds.push(entry.nodeId);
      rebuiltWallIds.push(entryIndex === 1
        ? command.wallIds[segmentIndex]
        : uniqueId("wall"));
    }
  }

  const splits = [];
  for (const wall of existingWalls) {
    const events = (splitEventsByWall.get(wall.id) ?? []).toSorted(compareIntersection);
    let sourceWallId = wall.id;
    for (const event of events) {
      const newWallId = uniqueId("wall");
      splits.push({
        wallId: sourceWallId,
        nodeId: event.nodeId,
        newWallId,
        point: structuredClone(event.point),
      });
      sourceWallId = newWallId;
    }
  }

  result.nodeIds = rebuiltNodeIds;
  result.wallIds = rebuiltWallIds;
  result.points = rebuiltPoints;
  result.splits = splits;
  return result;
}

export function closestScreenCandidate(pointer, candidates, radiusPx) {
  if (!Number.isFinite(pointer?.x) || !Number.isFinite(pointer?.y)) {
    throw new TypeError("Snap pointer screen coordinates must be finite");
  }
  if (!Number.isFinite(radiusPx) || radiusPx < 0) {
    throw new RangeError("Snap radius must be finite and non-negative");
  }
  let closest = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate?.screenX) || !Number.isFinite(candidate?.screenY)) continue;
    const distancePx = Math.hypot(candidate.screenX - pointer.x, candidate.screenY - pointer.y);
    const candidateRadiusPx = candidate.radiusPx ?? radiusPx;
    if (!Number.isFinite(candidateRadiusPx) || candidateRadiusPx < 0) continue;
    if (distancePx <= candidateRadiusPx && distancePx < closestDistance) {
      closest = candidate;
      closestDistance = distancePx;
    }
  }
  return closest;
}

/**
 * A physical wall is rendered at its model thickness. The user may therefore
 * point at a visible wall edge that is farther than the base acquisition radius
 * from its authoritative reference line. Extend the hit radius by the rendered
 * half-stroke while still returning the centreline projection as the snap point.
 */
export function wallInteriorSnapRadiusPx(
  baseRadiusPx,
  strokeWidthViewUnits,
  screenScalePxPerViewUnit,
  options = {},
) {
  for (const [value, label] of [
    [baseRadiusPx, "Base wall snap radius"],
    [strokeWidthViewUnits, "Wall stroke width"],
    [screenScalePxPerViewUnit, "Wall screen scale"],
  ]) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be finite and non-negative`);
  }
  const renderedWidthPx = options.nonScalingStroke
    ? strokeWidthViewUnits
    : strokeWidthViewUnits * screenScalePxPerViewUnit;
  return baseRadiusPx + renderedWidthPx / 2;
}

function appendUniqueIntersection(collection, key, event) {
  const events = collection.get(key) ?? [];
  if (!events.some((candidate) => pointsEqual(candidate.point, event.point))) events.push(event);
  collection.set(key, events);
}

function compareIntersection(left, right) {
  return left.fraction - right.fraction || left.nodeId.localeCompare(right.nodeId);
}

function pointWithUnknownElevation(point) {
  return {
    x: point.x,
    y: point.y,
    z: {
      state: "unknown",
      valueMm: null,
      reason: "wall intersection elevation follows the split host when available",
    },
  };
}

function segmentIntersection(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denominator = cross(r, s);
  const cMinusA = { x: c.x - a.x, y: c.y - a.y };
  if (Math.abs(denominator) <= GEOMETRY_EPSILON_MM) {
    if (Math.abs(cross(cMinusA, r)) > GEOMETRY_EPSILON_MM) {
      return { intersects: false, overlap: false };
    }
    return { intersects: false, overlap: true };
  }
  const t = cross(cMinusA, s) / denominator;
  const u = cross(cMinusA, r) / denominator;
  if (!withinSegment(t) || !withinSegment(u)) return { intersects: false, overlap: false };
  return {
    intersects: true,
    overlap: false,
    t: clampUnit(t),
    u: clampUnit(u),
    point: { x: a.x + t * r.x, y: a.y + t * r.y },
  };
}

function withinSegment(value) {
  return value >= -GEOMETRY_EPSILON_MM && value <= 1 + GEOMETRY_EPSILON_MM;
}

function strictlyInterior(value) {
  return value > GEOMETRY_EPSILON_MM && value < 1 - GEOMETRY_EPSILON_MM;
}

function clampUnit(value) {
  return Math.min(1, Math.max(0, value));
}

function cross(left, right) {
  return left.x * right.y - left.y * right.x;
}

function junctionAt(junctions, point) {
  return junctions.find((candidate) => pointsEqual(candidate.point, point)) ?? null;
}

function findNodeAt(nodes, floorId, point) {
  return nodes.find((node) => node.floorId === floorId && pointsEqual(node.positionMm, point)) ?? null;
}

function pointsEqual(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y) <= GEOMETRY_EPSILON_MM;
}

function planPoint(value) {
  if (!Number.isFinite(value?.x) || !Number.isFinite(value?.y)) {
    throw new TypeError("Wall snap planning requires finite XY points");
  }
  return { x: value.x, y: value.y };
}

function requireWallCollections(project) {
  if (!Array.isArray(project?.walls) || !Array.isArray(project?.wallNodes)) {
    throw new TypeError("Wall snap planning requires walls and wallNodes");
  }
}

function requireChainArrays(command) {
  if (
    !Array.isArray(command?.points) ||
    !Array.isArray(command?.nodeIds) ||
    !Array.isArray(command?.wallIds) ||
    command.points.length < 2 ||
    command.nodeIds.length !== command.points.length ||
    command.wallIds.length !== command.points.length - 1
  ) {
    throw new TypeError("Wall snap planning requires a complete wall-chain command");
  }
}

function requireId(value, label) {
  if (typeof value !== "string" || value.trim().length < 1) {
    throw new TypeError(`${label} is required`);
  }
  return value;
}
