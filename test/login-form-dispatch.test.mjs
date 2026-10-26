import assert from "node:assert/strict";
import test from "node:test";

import { bindFormSubmit, createPasswordUpdateAction, createSignInAction } from "../login/form-handlers.mjs";
import { createPasswordRecoveryGuard } from "../src/persistence/studio-access.mjs";

test("normal sign-in form dispatch reaches password authentication without requiring recovery", async () => {
  const calls = [];
  const action = createSignInAction({
    client: { auth: { async signInWithPassword(credentials) {
      calls.push(["sign-in", credentials]);
      return { data: { session: { access_token: "synthetic-session" } }, error: null };
    } } },
    captcha: { enabled: false },
    runCaptcha: async (_captcha, actionName, callback) => {
      calls.push(["captcha", actionName]);
      return callback(null);
    },
    addCaptchaToken: (credentials) => credentials,
    continueApprovedSession: async (session) => calls.push(["continue", session]),
  });

  const { event, error } = await dispatchForm(action, { email: "  owner@example.test  ", password: "not-a-real-password" });
  assert.equal(event.defaultPrevented, true);
  assert.equal(error, null);
  assert.deepEqual(calls, [
    ["captcha", "sign-in"],
    ["sign-in", { email: "owner@example.test", password: "not-a-real-password" }],
    ["continue", { access_token: "synthetic-session" }],
  ]);
});

test("password-update form dispatch rejects a missing or invalid recovery event before mutation", async () => {
  const recovery = createPasswordRecoveryGuard();
  let updateCalls = 0;
  const action = createPasswordUpdateAction({
    client: { auth: {
      async updateUser() { updateCalls++; return { error: null }; },
      async signOut() { throw new Error("signOut must not run"); },
    } },
    recovery,
    clearStudioGate: async () => { throw new Error("gate clearing must not run"); },
    complete: () => { throw new Error("completion must not run"); },
  });

  const { event, error } = await dispatchForm(action, { password: "a-valid-length-password", confirmation: "a-valid-length-password" });
  assert.equal(event.defaultPrevented, true);
  assert.match(error.message, /valid password-recovery link/);
  assert.equal(updateCalls, 0);
});

test("password-update form dispatch accepts a verified recovery event and completes locally", async () => {
  const recovery = createPasswordRecoveryGuard();
  recovery.markVerified();
  const calls = [];
  const action = createPasswordUpdateAction({
    client: { auth: {
      async updateUser(attributes) { calls.push(["update", attributes]); return { error: null }; },
      async signOut(options) { calls.push(["sign-out", options]); },
    } },
    recovery,
    clearStudioGate: async () => calls.push(["clear-gate"]),
    complete: () => calls.push(["complete"]),
  });

  const { event, error } = await dispatchForm(action, { password: "a-valid-length-password", confirmation: "a-valid-length-password" });
  assert.equal(event.defaultPrevented, true);
  assert.equal(error, null);
  assert.deepEqual(calls, [
    ["update", { password: "a-valid-length-password" }],
    ["clear-gate"],
    ["sign-out", { scope: "local" }],
    ["complete"],
  ]);
});

function dispatchForm(action, values) {
  const form = new EventTarget();
  let finish;
  const completed = new Promise((resolve) => { finish = resolve; });
  bindFormSubmit(form, async (submittedForm, submittedAction) => {
    assert.equal(submittedForm, form);
    try {
      await submittedAction(values);
      finish(null);
    } catch (error) {
      finish(error);
    }
  }, action);
  const event = new Event("submit", { cancelable: true });
  form.dispatchEvent(event);
  return completed.then((error) => ({ event, error }));
}
