const MIN_VIEW_WIDTH = 120;
const MAX_VIEW_WIDTH = 12000;

export function createCamera(value = { x: 0, y: 0, width: 1200, height: 800 }) {
  return normalizeCamera(value);
}

export function zoomCameraAt(camera, anchor, factor) {
  const current = normalizeCamera(camera);
  if (!Number.isFinite(anchor?.x) || !Number.isFinite(anchor?.y)) {
    throw new TypeError("Zoom anchor must be finite");
  }
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new RangeError("Zoom factor must be positive");
  }
  const requestedWidth = current.width * factor;
  const width = Math.min(MAX_VIEW_WIDTH, Math.max(MIN_VIEW_WIDTH, requestedWidth));
  const appliedFactor = width / current.width;
  return {
    x: anchor.x - (anchor.x - current.x) * appliedFactor,
    y: anchor.y - (anchor.y - current.y) * appliedFactor,
    width,
    height: current.height * appliedFactor,
  };
}

export function panCamera(camera, delta) {
  const current = normalizeCamera(camera);
  if (!Number.isFinite(delta?.x) || !Number.isFinite(delta?.y)) {
    throw new TypeError("Pan delta must be finite");
  }
  return { ...current, x: current.x + delta.x, y: current.y + delta.y };
}

export function fitCameraToBounds(bounds, aspectRatio = 1.5, padding = 40) {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    throw new RangeError("Camera aspect ratio must be positive");
  }
  if (!Number.isFinite(padding) || padding < 0) {
    throw new RangeError("Camera padding must be non-negative");
  }
  if (!bounds) return createCamera();
  for (const key of ["minX", "minY", "maxX", "maxY"]) {
    if (!Number.isFinite(bounds[key])) throw new TypeError("Fit bounds must be finite");
  }
  if (bounds.maxX < bounds.minX || bounds.maxY < bounds.minY) {
    throw new RangeError("Fit bounds are inverted");
  }
  let width = Math.max(MIN_VIEW_WIDTH, bounds.maxX - bounds.minX + padding * 2);
  let height = Math.max(MIN_VIEW_WIDTH / aspectRatio, bounds.maxY - bounds.minY + padding * 2);
  if (width / height > aspectRatio) height = width / aspectRatio;
  else width = height * aspectRatio;
  width = Math.min(MAX_VIEW_WIDTH, width);
  height = width / aspectRatio;
  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreY = (bounds.minY + bounds.maxY) / 2;
  return { x: centreX - width / 2, y: centreY - height / 2, width, height };
}

export function clientPointToCamera(camera, clientPoint, rect) {
  const current = normalizeCamera(camera);
  if (!Number.isFinite(rect?.x) || !Number.isFinite(rect?.y) || !Number.isFinite(rect?.width) || !Number.isFinite(rect?.height) || rect.width <= 0 || rect.height <= 0) {
    throw new TypeError("Canvas rectangle must be finite and positive");
  }
  return {
    x: current.x + ((clientPoint.x - rect.x) / rect.width) * current.width,
    y: current.y + ((clientPoint.y - rect.y) / rect.height) * current.height,
  };
}

function normalizeCamera(camera) {
  for (const key of ["x", "y", "width", "height"]) {
    if (!Number.isFinite(camera?.[key])) throw new TypeError(`Camera ${key} must be finite`);
  }
  if (camera.width <= 0 || camera.height <= 0) {
    throw new RangeError("Camera dimensions must be positive");
  }
  return { x: camera.x, y: camera.y, width: camera.width, height: camera.height };
}
