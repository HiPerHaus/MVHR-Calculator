/** Keeps one pending transition; invalid saves and cancellation retain the draft. */
export function createEngineeringEditGuard({ isDirty, save, discard, ask }) {
  let pending = null;
  return {
    request(action) {
      if (pending) return false;
      if (!isDirty()) { action(); return true; }
      pending = action;
      ask();
      return false;
    },
    resolve(choice) {
      if (!pending) return false;
      if (choice === "cancel") { pending = null; return false; }
      if (choice === "save" && !save()) return false;
      if (choice === "discard") discard();
      else if (choice !== "save") return false;
      const action = pending;
      pending = null;
      action();
      return true;
    },
  };
}
