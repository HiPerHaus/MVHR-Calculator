// Keep zoom input inside the drawing, not a global page-zoom prohibition.
export function drawingWheelZoomFactor(event) {
  if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return 1;
  // Ctrl-wheel is how Chromium/Firefox report trackpad pinch. Honour magnitude
  // rather than turning every tiny pinch update into a full mouse-wheel step.
  if (event.ctrlKey || event.metaKey) {
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 800 : 1);
    return Math.exp(Math.max(-0.5, Math.min(0.5, pixels * 0.01)));
  }
  return event.deltaY > 0 ? 1.15 : 1 / 1.15;
}

export function bindDrawingZoomInput(canvas, { enabled, zoom, fit, touchPinching = () => false }) {
  let gestureScale = null;
  const handlers = {
    wheel(event) {
      if (!enabled()) return;
      event.preventDefault();
      if (gestureScale !== null || touchPinching()) return;
      const factor = drawingWheelZoomFactor(event);
      if (factor !== 1) zoom(factor, point(event));
    },
    gesturestart(event) {
      if (!enabled()) return;
      event.preventDefault();
      gestureScale = validScale(event.scale) ? event.scale : 1;
    },
    gesturechange(event) {
      if (!enabled() || gestureScale === null) return;
      event.preventDefault();
      if (!validScale(event.scale)) return;
      const factor = gestureScale / event.scale;
      gestureScale = event.scale;
      // Touch pointer pinches already have their own midpoint/pan controller.
      if (!touchPinching()) zoom(factor, point(event));
    },
    gestureend(event) {
      if (gestureScale !== null && enabled()) event.preventDefault();
      gestureScale = null;
    },
    keydown(event) {
      if (!enabled() || event.target !== canvas || event.altKey || event.isComposing) return;
      const key = event.key;
      if (!['+', '=', '-', '0'].includes(key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (key === '0') fit();
      else zoom(key === '-' ? 1.25 : 0.8, null);
    },
    blur() { gestureScale = null; },
  };
  for (const [type, handler] of Object.entries(handlers)) canvas.addEventListener(type, handler, { passive: false });
  return () => { for (const [type, handler] of Object.entries(handlers)) canvas.removeEventListener(type, handler); };
}
function validScale(value) { return Number.isFinite(value) && value > 0; }
function point(event) {
  return Number.isFinite(event.clientX) && Number.isFinite(event.clientY) ? { x: event.clientX, y: event.clientY } : null;
}
