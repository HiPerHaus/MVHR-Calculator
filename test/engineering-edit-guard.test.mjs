import assert from "node:assert/strict";
import test from "node:test";
import { createEngineeringEditGuard } from "../src/editor/engineering-edit-guard.mjs";

function setup({ dirty = true, valid = true } = {}) {
  const state = { dirty, valid, prompts: 0, saves: 0, discards: 0, actions: [] };
  const guard = createEngineeringEditGuard({
    isDirty: () => state.dirty,
    save: () => { state.saves++; if (!state.valid) return false; state.dirty = false; return true; },
    discard: () => { state.discards++; state.dirty = false; },
    ask: () => state.prompts++,
  });
  return { state, guard, action: name => () => state.actions.push(name) };
}

test("clean navigation proceeds without prompting", () => {
  const { state, guard, action } = setup({ dirty: false });
  assert.equal(guard.request(action("boost")), true);
  assert.deepEqual(state.actions, ["boost"]);
  assert.equal(state.prompts, 0);
});
test("cancel/Escape retains fields and mode and cancels pending navigation", () => {
  const { state, guard, action } = setup();
  guard.request(action("boost"));
  assert.equal(guard.resolve("cancel"), false);
  assert.equal(state.dirty, true);
  assert.deepEqual(state.actions, []);
  guard.request(action("low"));
  guard.resolve("discard");
  assert.deepEqual(state.actions, ["low"]);
});
test("Save and continue commits valid fields before one pending export", () => {
  const { state, guard } = setup();
  guard.request(() => { assert.equal(state.dirty, false); state.actions.push("export"); });
  assert.equal(guard.resolve("save"), true);
  assert.equal(state.saves, 1);
  assert.deepEqual(state.actions, ["export"]);
  assert.equal(guard.resolve("save"), false);
});
test("invalid input blocks export and preserves pending action and edits", () => {
  const { state, guard, action } = setup({ valid: false });
  guard.request(action("export"));
  assert.equal(guard.resolve("save"), false);
  assert.equal(state.dirty, true);
  assert.deepEqual(state.actions, []);
  state.valid = true;
  assert.equal(guard.resolve("save"), true);
  assert.deepEqual(state.actions, ["export"]);
});
test("repeated clicks cannot overwrite or duplicate the pending transition", () => {
  const { state, guard, action } = setup();
  guard.request(action("boost"));
  guard.request(action("export"));
  assert.equal(state.prompts, 1);
  guard.resolve("discard");
  assert.equal(state.discards, 1);
  assert.deepEqual(state.actions, ["boost"]);
});
test("unknown dialog choice does not discard edits or navigate", () => {
  const { state, guard, action } = setup();
  guard.request(action("leave"));
  assert.equal(guard.resolve("unexpected"), false);
  assert.equal(state.dirty, true);
  assert.deepEqual(state.actions, []);
});
