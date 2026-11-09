// Coalesce pointer bursts without deferring or duplicating the final command.
export function createFramePreviewScheduler(draw, {request = callback => requestAnimationFrame(callback), cancel = id => cancelAnimationFrame(id)} = {}) {
  let frame = null;
  return {
    schedule() {
      if (frame !== null) return;
      frame = request(() => { frame = null; draw(); });
    },
    cancel() { if (frame !== null) cancel(frame); frame = null; },
  };
}
