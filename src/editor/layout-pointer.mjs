/** Resolve placement and dragging in floor millimetres, preserving the grab offset. */
export function layoutPointerPosition(pointer, { snapEnabled, gridMm = 100, drag } = {}) {
  const point = drag ? {
    x: drag.start.x + pointer.x - drag.pointerStart.x,
    y: drag.start.y + pointer.y - drag.pointerStart.y,
  } : { x: pointer.x, y: pointer.y };
  if (!snapEnabled) return point;
  return {
    x: Math.round(point.x / gridMm) * gridMm,
    y: Math.round(point.y / gridMm) * gridMm,
  };
}
