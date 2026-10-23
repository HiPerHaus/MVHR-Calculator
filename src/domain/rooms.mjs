/**
 * Renderer-independent wall-face discovery for the shared building core.
 *
 * Faces are derived only from explicit wall topology. No display-space gap,
 * crossing, imported reference, or visual overlap is repaired or promoted.
 */

const GEOMETRY_EPSILON = 1e-9;
const MIN_FACE_AREA_MM2 = 1;

export const ROOM_USE_TYPES = Object.freeze([
  "unspecified",
  "living",
  "kitchen",
  "dining",
  "kitchen-dining",
  "bedroom",
  "bathroom",
  "ensuite",
  "wc",
  "laundry",
  "hallway",
  "storage",
  "other",
]);

export const ROOM_VENTILATION_ROLES = Object.freeze([
  "unassigned",
  "supply",
  "extract",
  "transfer",
  "none",
]);

export function deriveRoomBoundaries(project, floorId) {
  requireProjectCollections(project);
  requireId(floorId, "Floor ID");
  const nodes = project.wallNodes.filter((node) => node.floorId === floorId);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const physicalWalls = project.walls.filter(
    (wall) => wall.floorId === floorId && wall.classification === "physical",
  );
  return deriveFaces(physicalWalls, nodeById, floorId);
}

export function deriveZoneBoundaries(project, parentRoomId) {
  requireProjectCollections(project);
  const room = project.rooms?.find((candidate) => candidate.id === parentRoomId);
  if (!room) throw new TypeError(`Parent room not found: ${String(parentRoomId)}`);
  const parent = roomPolygonFromBoundary(project, room);
  const boundaryWallIds = new Set(room.boundary.map((entry) => entry.wallId));
  const boundaryWalls = project.walls.filter((wall) => boundaryWallIds.has(wall.id));
  const dividers = project.walls.filter(
    (wall) =>
      wall.floorId === room.floorId &&
      wall.classification === "virtual" &&
      wall.boundaryRole === "room-divider" &&
      wall.parentRoomId === room.id,
  );
  if (dividers.length === 0) return { candidates: [], diagnostics: [] };
  const nodes = project.wallNodes.filter((node) => node.floorId === room.floorId);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const derived = deriveFaces([...boundaryWalls, ...dividers], nodeById, room.floorId);
  const candidates = derived.candidates.filter(
    (candidate) => pointInPolygon(candidate.centroidMm, parent.polygon),
  ).map((candidate) => ({ ...candidate, parentRoomId: room.id }));
  if (candidates.length < 2) return { candidates: [], diagnostics: derived.diagnostics };
  const partitionAreaMm2 = candidates.reduce((sum, candidate) => sum + candidate.areaMm2, 0);
  const toleranceMm2 = Math.max(1, parent.areaMm2 * 1e-9);
  if (Math.abs(partitionAreaMm2 - parent.areaMm2) > toleranceMm2) {
    return {
      candidates: [],
      diagnostics: [...derived.diagnostics, {
        code: "unsupported-zone-partition",
        severity: "error",
        message: "Room dividers do not form one non-overlapping partition of the parent room",
        nodeIds: [],
        wallIds: dividers.map((divider) => divider.id),
        pointMm: null,
      }],
    };
  }
  return { candidates, diagnostics: derived.diagnostics };
}

function deriveFaces(wallsInput, nodeById, floorId) {
  const physicalWalls = wallsInput;
  const diagnostics = [];
  const invalidWallIds = crossingWallIds(physicalWalls, nodeById, diagnostics);
  const walls = physicalWalls.filter((wall) => !invalidWallIds.has(wall.id));
  const adjacency = buildAdjacency(walls, nodeById);

  for (const [nodeId, edges] of adjacency) {
    if (edges.length === 1) {
      const node = nodeById.get(nodeId);
      diagnostics.push({
        code: "open-endpoint",
        severity: "warning",
        message: `Open wall endpoint prevents a closed room boundary: ${nodeId}`,
        nodeIds: [nodeId],
        wallIds: [edges[0].wallId],
        pointMm: pointFromNode(node),
      });
    }
  }

  const visited = new Set();
  const candidates = [];
  const maximumSteps = Math.max(1, walls.length * 2 + 1);
  for (const edges of adjacency.values()) {
    for (const first of edges) {
      if (visited.has(directedEdgeKey(first))) continue;
      const path = [];
      const localVisited = new Set();
      let current = first;
      let closed = false;
      for (let step = 0; step < maximumSteps; step += 1) {
        const key = directedEdgeKey(current);
        if (localVisited.has(key)) {
          closed = key === directedEdgeKey(first);
          break;
        }
        localVisited.add(key);
        visited.add(key);
        path.push(current);
        const outgoing = adjacency.get(current.toNodeId) ?? [];
        const reverseIndex = outgoing.findIndex(
          (edge) => edge.wallId === current.wallId && edge.toNodeId === current.fromNodeId,
        );
        if (reverseIndex < 0 || outgoing.length === 0) break;
        current = outgoing[(reverseIndex - 1 + outgoing.length) % outgoing.length];
      }
      if (!closed || path.length < 3) continue;
      const nodeIds = path.map((edge) => edge.fromNodeId);
      if (new Set(nodeIds).size !== nodeIds.length) continue;
      const polygon = nodeIds.map((nodeId) => ({
        nodeId,
        ...pointFromNode(nodeById.get(nodeId)),
      }));
      if (polygonHasSelfIntersection(polygon)) continue;
      const areaMm2 = signedPolygonArea(polygon);
      if (areaMm2 <= MIN_FACE_AREA_MM2) continue;
      const boundary = canonicalizeBoundary(path.map((edge) => ({
        wallId: edge.wallId,
        direction: edge.direction,
      })));
      candidates.push({
        key: roomBoundaryKey(boundary),
        floorId,
        boundary,
        polygon,
        areaMm2,
        centroidMm: polygonCentroid(polygon, areaMm2),
        areaConvention: "wall-reference-lines",
      });
    }
  }

  candidates.sort((left, right) => left.key.localeCompare(right.key));
  diagnostics.sort((left, right) => diagnosticKey(left).localeCompare(diagnosticKey(right)));
  return { candidates, diagnostics };
}

export function newlyEligibleRoomBoundaries(beforeProject, afterProject, floorId) {
  const priorKeys = new Set(
    deriveRoomBoundaries(beforeProject, floorId).candidates.map((candidate) => candidate.key),
  );
  const derivation = deriveRoomBoundaries(afterProject, floorId);
  const assignedKeys = new Set(
    afterProject.rooms
      .filter((room) => room.floorId === floorId)
      .map((room) => inspectRoomBoundary(afterProject, room, derivation))
      .filter((inspection) => inspection.status === "current")
      .map((inspection) => inspection.key),
  );
  return derivation.candidates.filter(
    (candidate) => !priorKeys.has(candidate.key) && !assignedKeys.has(candidate.key),
  );
}

export function roomBoundaryKey(boundary) {
  if (!Array.isArray(boundary) || boundary.length < 3) {
    throw new TypeError("Room boundary requires at least three wall references");
  }
  const wallIds = boundary.map((entry) => {
    requireId(entry?.wallId, "Room boundary wall ID");
    return entry.wallId;
  });
  if (new Set(wallIds).size !== wallIds.length) {
    throw new TypeError("Room boundary cannot repeat a wall");
  }
  return wallIds
    .toSorted()
    .map((wallId) => `${wallId.length}:${wallId}`)
    .join("|");
}

export function inspectRoomBoundary(project, room, derivation = null) {
  requireProjectCollections(project);
  requireId(room?.id, "Room ID");
  requireId(room?.floorId, "Room floor ID");
  let geometry;
  try {
    geometry = roomPolygonFromBoundary(project, room);
  } catch (error) {
    return {
      status: "invalid",
      reason: error.message,
      key: safeBoundaryKey(room.boundary),
      polygon: [],
      areaMm2: null,
      centroidMm: null,
    };
  }
  const resolved = derivation ?? deriveRoomBoundaries(project, room.floorId);
  const key = roomBoundaryKey(room.boundary);
  const candidate = resolved.candidates.find((item) => item.key === key);
  if (!candidate) {
    return {
      status: "reassignment-required",
      reason: "The stored boundary is closed but is no longer one eligible wall face",
      key,
      ...geometry,
    };
  }
  return {
    status: "current",
    reason: null,
    key,
    polygon: candidate.polygon,
    areaMm2: candidate.areaMm2,
    centroidMm: candidate.centroidMm,
  };
}

export function inspectZoneBoundary(project, zone, derivation = null) {
  requireProjectCollections(project);
  requireId(zone?.id, "Zone ID");
  requireId(zone?.parentRoomId, "Zone parent room ID");
  let geometry;
  try {
    geometry = roomPolygonFromBoundary(project, zone);
  } catch (error) {
    return {
      status: "invalid",
      reason: error.message,
      key: safeBoundaryKey(zone.boundary),
      polygon: [],
      areaMm2: null,
      centroidMm: null,
    };
  }
  const resolved = derivation ?? deriveZoneBoundaries(project, zone.parentRoomId);
  const key = roomBoundaryKey(zone.boundary);
  const candidate = resolved.candidates.find((item) => item.key === key);
  if (!candidate) {
    return {
      status: "reassignment-required",
      reason: "The stored zone is no longer one eligible partition face",
      key,
      ...geometry,
    };
  }
  return {
    status: "current",
    reason: null,
    key,
    polygon: candidate.polygon,
    areaMm2: candidate.areaMm2,
    centroidMm: candidate.centroidMm,
  };
}

export function roomPolygonFromBoundary(project, room) {
  if (!Array.isArray(room?.boundary) || room.boundary.length < 3) {
    throw new TypeError("Room boundary requires at least three wall references");
  }
  const wallById = new Map(project.walls.map((wall) => [wall.id, wall]));
  const nodeById = new Map(project.wallNodes.map((node) => [node.id, node]));
  const oriented = room.boundary.map((entry) => {
    const wall = wallById.get(entry.wallId);
    if (!wall) throw new TypeError(`Room boundary wall not found: ${entry.wallId}`);
    if (wall.floorId !== room.floorId) {
      throw new TypeError(`Room boundary wall belongs to another floor: ${entry.wallId}`);
    }
    if (entry.direction !== "forward" && entry.direction !== "reverse") {
      throw new TypeError("Room boundary direction must be forward or reverse");
    }
    return entry.direction === "forward"
      ? { wallId: wall.id, fromNodeId: wall.startNodeId, toNodeId: wall.endNodeId }
      : { wallId: wall.id, fromNodeId: wall.endNodeId, toNodeId: wall.startNodeId };
  });
  for (let index = 0; index < oriented.length; index += 1) {
    const current = oriented[index];
    const next = oriented[(index + 1) % oriented.length];
    if (current.toNodeId !== next.fromNodeId) {
      throw new TypeError(`Room boundary is not continuous between ${current.wallId} and ${next.wallId}`);
    }
  }
  const polygon = oriented.map((edge) => {
    const node = nodeById.get(edge.fromNodeId);
    if (!node) throw new TypeError(`Room boundary node not found: ${edge.fromNodeId}`);
    return { nodeId: node.id, ...pointFromNode(node) };
  });
  if (new Set(polygon.map((point) => point.nodeId)).size !== polygon.length) {
    throw new TypeError("Room boundary cannot revisit a wall node");
  }
  if (polygonHasSelfIntersection(polygon)) {
    throw new TypeError("Room boundary self-intersects");
  }
  const signedAreaMm2 = signedPolygonArea(polygon);
  if (Math.abs(signedAreaMm2) <= MIN_FACE_AREA_MM2) {
    throw new RangeError("Room boundary area is zero");
  }
  const normalizedPolygon = signedAreaMm2 > 0 ? polygon : polygon.toReversed();
  const areaMm2 = Math.abs(signedAreaMm2);
  return {
    polygon: normalizedPolygon,
    areaMm2,
    centroidMm: polygonCentroid(normalizedPolygon, areaMm2),
  };
}

function crossingWallIds(walls, nodeById, diagnostics) {
  const invalid = new Set();
  for (let leftIndex = 0; leftIndex < walls.length; leftIndex += 1) {
    const left = walls[leftIndex];
    const leftStart = pointFromNode(nodeById.get(left.startNodeId));
    const leftEnd = pointFromNode(nodeById.get(left.endNodeId));
    for (let rightIndex = leftIndex + 1; rightIndex < walls.length; rightIndex += 1) {
      const right = walls[rightIndex];
      const sharesEndpoint =
        left.startNodeId === right.startNodeId || left.startNodeId === right.endNodeId ||
        left.endNodeId === right.startNodeId || left.endNodeId === right.endNodeId;
      const rightStart = pointFromNode(nodeById.get(right.startNodeId));
      const rightEnd = pointFromNode(nodeById.get(right.endNodeId));
      const intersection = segmentIntersection(leftStart, leftEnd, rightStart, rightEnd);
      if (!intersection.intersects) continue;
      if (sharesEndpoint && !intersection.overlap) continue;
      invalid.add(left.id);
      invalid.add(right.id);
      diagnostics.push({
        code: intersection.overlap ? "overlapping-walls" : "crossing-without-junction",
        severity: "error",
        message: intersection.overlap
          ? `Walls overlap without shared topology: ${left.id} and ${right.id}`
          : `Walls cross without an explicit junction: ${left.id} and ${right.id}`,
        nodeIds: [],
        wallIds: [left.id, right.id],
        pointMm: intersection.pointMm,
      });
    }
  }
  return invalid;
}

function buildAdjacency(walls, nodeById) {
  const adjacency = new Map();
  for (const wall of walls) {
    const start = pointFromNode(nodeById.get(wall.startNodeId));
    const end = pointFromNode(nodeById.get(wall.endNodeId));
    appendEdge(adjacency, {
      wallId: wall.id,
      fromNodeId: wall.startNodeId,
      toNodeId: wall.endNodeId,
      direction: "forward",
      angle: Math.atan2(end.y - start.y, end.x - start.x),
    });
    appendEdge(adjacency, {
      wallId: wall.id,
      fromNodeId: wall.endNodeId,
      toNodeId: wall.startNodeId,
      direction: "reverse",
      angle: Math.atan2(start.y - end.y, start.x - end.x),
    });
  }
  for (const edges of adjacency.values()) {
    edges.sort((left, right) => left.angle - right.angle || left.wallId.localeCompare(right.wallId));
  }
  return adjacency;
}

function appendEdge(adjacency, edge) {
  const edges = adjacency.get(edge.fromNodeId) ?? [];
  edges.push(edge);
  adjacency.set(edge.fromNodeId, edges);
}

function canonicalizeBoundary(boundary) {
  let bestIndex = 0;
  for (let index = 1; index < boundary.length; index += 1) {
    if (boundaryEntryKey(boundary[index]) < boundaryEntryKey(boundary[bestIndex])) bestIndex = index;
  }
  return [...boundary.slice(bestIndex), ...boundary.slice(0, bestIndex)];
}

function signedPolygonArea(polygon) {
  let twiceArea = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return twiceArea / 2;
}

function polygonCentroid(polygon, positiveAreaMm2) {
  let weightedX = 0;
  let weightedY = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const cross = current.x * next.y - next.x * current.y;
    weightedX += (current.x + next.x) * cross;
    weightedY += (current.y + next.y) * cross;
  }
  const denominator = 6 * positiveAreaMm2;
  return { x: weightedX / denominator, y: weightedY / denominator };
}

function polygonHasSelfIntersection(polygon) {
  for (let left = 0; left < polygon.length; left += 1) {
    const leftNext = (left + 1) % polygon.length;
    for (let right = left + 1; right < polygon.length; right += 1) {
      const rightNext = (right + 1) % polygon.length;
      if (left === right || leftNext === right || rightNext === left) continue;
      const intersection = segmentIntersection(
        polygon[left], polygon[leftNext], polygon[right], polygon[rightNext],
      );
      if (intersection.intersects) return true;
    }
  }
  return false;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const left = polygon[current];
    const right = polygon[previous];
    const crosses = (left.y > point.y) !== (right.y > point.y) &&
      point.x < ((right.x - left.x) * (point.y - left.y)) / (right.y - left.y) + left.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function segmentIntersection(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denominator = cross(r, s);
  const cMinusA = { x: c.x - a.x, y: c.y - a.y };
  if (Math.abs(denominator) <= GEOMETRY_EPSILON) {
    if (Math.abs(cross(cMinusA, r)) > GEOMETRY_EPSILON) {
      return { intersects: false, overlap: false, pointMm: null };
    }
    const axis = Math.abs(r.x) >= Math.abs(r.y) ? "x" : "y";
    const denominatorOnAxis = r[axis];
    if (Math.abs(denominatorOnAxis) <= GEOMETRY_EPSILON) {
      return { intersects: false, overlap: false, pointMm: null };
    }
    const first = (c[axis] - a[axis]) / denominatorOnAxis;
    const second = (d[axis] - a[axis]) / denominatorOnAxis;
    const overlapStart = Math.max(0, Math.min(first, second));
    const overlapEnd = Math.min(1, Math.max(first, second));
    if (overlapEnd - overlapStart <= GEOMETRY_EPSILON) {
      return { intersects: false, overlap: false, pointMm: null };
    }
    return {
      intersects: true,
      overlap: true,
      pointMm: { x: a.x + r.x * overlapStart, y: a.y + r.y * overlapStart },
    };
  }
  const t = cross(cMinusA, s) / denominator;
  const u = cross(cMinusA, r) / denominator;
  if (
    t < -GEOMETRY_EPSILON || t > 1 + GEOMETRY_EPSILON ||
    u < -GEOMETRY_EPSILON || u > 1 + GEOMETRY_EPSILON
  ) {
    return { intersects: false, overlap: false, pointMm: null };
  }
  return {
    intersects: true,
    overlap: false,
    pointMm: { x: a.x + t * r.x, y: a.y + t * r.y },
  };
}

function cross(left, right) {
  return left.x * right.y - left.y * right.x;
}

function pointFromNode(node) {
  if (!node?.positionMm || !Number.isFinite(node.positionMm.x) || !Number.isFinite(node.positionMm.y)) {
    throw new TypeError("Room topology requires finite wall-node XY coordinates");
  }
  return { x: node.positionMm.x, y: node.positionMm.y };
}

function directedEdgeKey(edge) {
  return `${edge.wallId}:${edge.direction}`;
}

function boundaryEntryKey(entry) {
  return `${entry.wallId}:${entry.direction}`;
}

function diagnosticKey(diagnostic) {
  return `${diagnostic.code}:${diagnostic.wallIds.join(",")}:${diagnostic.nodeIds.join(",")}`;
}

function safeBoundaryKey(boundary) {
  try {
    return roomBoundaryKey(boundary);
  } catch {
    return null;
  }
}

function requireProjectCollections(project) {
  if (!project || !Array.isArray(project.wallNodes) || !Array.isArray(project.walls)) {
    throw new TypeError("Room derivation requires wallNodes and walls arrays");
  }
}

function requireId(value, label) {
  if (typeof value !== "string" || value.trim().length < 3) {
    throw new TypeError(`${label} must be a non-empty opaque string`);
  }
}
