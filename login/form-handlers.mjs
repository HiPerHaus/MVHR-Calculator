import { runWithStudioCaptcha, withCaptchaToken } from "../src/persistence/studio-captcha.mjs";

export function bindFormSubmit(form, submit, action) {
  if (!form?.addEventListener) throw new TypeError("A form event target is required");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submit(event.currentTarget, action);
  });
}

export function createSignInAction({
  client,
  captcha,
  continueApprovedSession,
  runCaptcha = runWithStudioCaptcha,
  addCaptchaToken = withCaptchaToken,
}) {
  return async (values) => {
    await runCaptcha(captcha, "sign-in", async (captchaToken) => {
      const credentials = addCaptchaToken({ email: values.email.trim(), password: values.password }, captchaToken);
      const result = await client.auth.signInWithPassword(credentials);
      if (result.error) throw result.error;
      await continueApprovedSession(result.data.session);
    });
  };
}

export function createPasswordUpdateAction({ client, recovery, clearStudioGate, complete }) {
  return async (values) => {
    recovery.requireVerified();
    if (values.password !== values.confirmation) throw new Error("The password confirmation does not match");
    if (values.password.length < 12 || values.password.length > 72) throw new Error("Use a password between 12 and 72 characters");
    const result = await client.auth.updateUser({ password: values.password });
    if (result.error) throw result.error;
    await clearStudioGate();
    await client.auth.signOut({ scope: "local" });
    complete();
  };
}
