// Cloud storage writes a complete drawing per save, including plan images.
export const AUTOSAVE_IDLE_MS = 3000;
export const AUTOSAVE_INTERVAL_MS = 30000;

export function createCloudAutosave({
  read, save, now = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout,
  idleMs = AUTOSAVE_IDLE_MS, intervalMs = AUTOSAVE_INTERVAL_MS,
}) {
  let timer = null;
  let lastWriteAt = -Infinity;
  let previousKey = null;

  function cancel() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function schedule() {
    cancel();
    const key = read();
    if (key === null) return;
    const delay = Math.max(idleMs, lastWriteAt + intervalMs - now());
    timer = setTimer(() => {
      timer = null;
      if (read() === key) save();
    }, delay);
  }

  return {
    schedule,
    cancel,
    didStartSave(key) {
      cancel();
      // Explicit Save can always run, but counts towards the next automatic
      // write for that drawing. A switch need not wait for the last drawing.
      previousKey = key;
      lastWriteAt = now();
    },
    resetIfChanged(key) {
      if (key === previousKey) return;
      cancel();
      previousKey = key;
      lastWriteAt = -Infinity;
    },
  };
}
