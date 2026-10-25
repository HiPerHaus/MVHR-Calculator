import test from "node:test";
import assert from "node:assert/strict";

import {
  createStudioCaptcha,
  runWithStudioCaptcha,
  withCaptchaToken,
} from "../src/persistence/studio-captcha.mjs";

test("disabled CAPTCHA is inert and does not alter authentication payloads", async () => {
  const captcha = createStudioCaptcha();
  const payload = { email: "person@example.test", password: "not-a-real-password" };
  const result = await runWithStudioCaptcha(captcha, "sign-in", async (token) => {
    assert.equal(token, undefined);
    return withCaptchaToken(payload, token);
  });
  assert.equal(captcha.enabled, false);
  assert.strictEqual(result, payload);
  assert.equal("options" in result, false);
});

test("enabled injected provider requires a token, passes it only as auth security metadata and resets", async () => {
  const actions = [];
  const captcha = createStudioCaptcha({
    enabled: true,
    provider: "turnstile",
    async acquireToken(action) { actions.push(["acquire", action]); return "  verified-token  "; },
    async reset(action) { actions.push(["reset", action]); },
  });
  const payload = await runWithStudioCaptcha(captcha, "signup", async (token) => withCaptchaToken({
    email: "person@example.test",
    options: { data: { studio_signup: true } },
  }, token));
  assert.equal(payload.options.captchaToken, "verified-token");
  assert.deepEqual(payload.options.data, { studio_signup: true });
  assert.deepEqual(actions, [["acquire", "signup"], ["reset", "signup"]]);
});

test("enabled CAPTCHA fails closed for missing tokens and resets after request errors", async () => {
  const missing = createStudioCaptcha({
    enabled: true,
    provider: "hcaptcha",
    async acquireToken() { return ""; },
  });
  await assert.rejects(runWithStudioCaptcha(missing, "recovery", async () => "unreachable"), /Complete the CAPTCHA/);

  let reset = false;
  const failing = createStudioCaptcha({
    enabled: true,
    provider: "hcaptcha",
    async acquireToken() { return "verified"; },
    async reset() { reset = true; },
  });
  await assert.rejects(runWithStudioCaptcha(failing, "sign-in", async () => { throw new Error("request failed"); }), /request failed/);
  assert.equal(reset, true);

  const brokenReset = createStudioCaptcha({
    enabled: true,
    provider: "turnstile",
    async acquireToken() { return "verified"; },
    async reset() { throw new Error("widget cleanup failed"); },
  });
  assert.equal(await runWithStudioCaptcha(brokenReset, "signup", async () => "auth completed"), "auth completed");
  assert.throws(() => createStudioCaptcha({ enabled: true, provider: "other", acquireToken() {} }), /turnstile or hcaptcha/);
});
