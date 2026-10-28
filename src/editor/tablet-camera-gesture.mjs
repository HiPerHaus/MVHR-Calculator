export function beginPinchCameraGesture(camera, points, rect) {
  requireCamera(camera);
  const normalizedRect = requireRect(rect);
  const pair = requirePointPair(points);
  const midpoint = midpointOf(pair);
  const distance = distanceOf(pair);
  if (distance < 1) throw new TypeError("Pinch points must be separated");
  return {
    camera: { ...camera },
    rect: normalizedRect,
    midpoint,
    distance,
    anchor: {
      x: camera.x + ((midpoint.x - normalizedRect.left) / normalizedRect.width) * camera.width,
      y: camera.y + ((midpoint.y - normalizedRect.top) / normalizedRect.height) * camera.height,
    },
  };
}

export function updatePinchCameraGesture(gesture, points) {
  if (!gesture || typeof gesture !== "object") throw new TypeError("Pinch gesture is required");
  requireCamera(gesture.camera);
  const rect = requireRect(gesture.rect);
  const pair = requirePointPair(points);
  const midpoint = midpointOf(pair);
  const distance = Math.max(1, distanceOf(pair));
  const scale = gesture.distance / distance;
  const width = gesture.camera.width * scale;
  const height = gesture.camera.height * scale;
  return {
    x: gesture.anchor.x - ((midpoint.x - rect.left) / rect.width) * width,
    y: gesture.anchor.y - ((midpoint.y - rect.top) / rect.height) * height,
    width,
    height,
  };
}

function requireCamera(camera) {
  if (![camera?.x, camera?.y, camera?.width, camera?.height].every(Number.isFinite)) {
    throw new TypeError("Finite camera geometry is required");
  }
  if (camera.width <= 0 || camera.height <= 0) throw new TypeError("Camera dimensions must be positive");
}

function requireRect(rect) {
  if (![rect?.left, rect?.top, rect?.width, rect?.height].every(Number.isFinite)) {
    throw new TypeError("Finite viewport geometry is required");
  }
  if (rect.width <= 0 || rect.height <= 0) throw new TypeError("Viewport dimensions must be positive");
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function requirePointPair(points) {
  if (!Array.isArray(points) || points.length !== 2) throw new TypeError("Exactly two touch points are required");
  return points.map((point) => {
    if (![point?.x, point?.y].every(Number.isFinite)) throw new TypeError("Finite touch points are required");
    return { x: point.x, y: point.y };
  });
}

function midpointOf([first, second]) {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function distanceOf([first, second]) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}
