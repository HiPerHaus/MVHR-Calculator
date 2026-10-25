export function shouldReloadProtectedPage(event) {
  return event?.persisted === true;
}

export function createReturnAccessVerifier(action, {
  minimumIntervalMs = 30_000,
  now = Date.now,
} = {}) {
  if (typeof action !== "function") throw new TypeError("Access verifier action is required");
  let lastStartedAt = now();
  let pending = null;
  return async function verifyOnReturn() {
    const startedAt = now();
    if (pending || startedAt - lastStartedAt < minimumIntervalMs) return false;
    lastStartedAt = startedAt;
    pending = Promise.resolve().then(action);
    try {
      await pending;
      return true;
    } finally {
      pending = null;
    }
  };
}
