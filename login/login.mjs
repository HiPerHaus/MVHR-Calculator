import { accessMessage, clearStudioGate, establishStudioGate, getStudioClient } from "../app/auth-client.mjs";
import { createPasswordRecoveryGuard, requestStudioSignup, verifyStudioAccess } from "../src/persistence/studio-access.mjs";
import { createStudioCaptcha, runWithStudioCaptcha, withCaptchaToken } from "../src/persistence/studio-captcha.mjs";

const client = getStudioClient();
const captcha = createStudioCaptcha(window.__HIPER_STUDIO_CAPTCHA__);
const panels = [...document.querySelectorAll("[id$='-panel']")];
const status = document.querySelector("#login-status");
const nextPath = safeNext(new URLSearchParams(location.search).get("next"));
const recovery = createPasswordRecoveryGuard();
const newPasswordButton = document.querySelector("#new-password-form [type='submit']");
newPasswordButton.disabled = true;

document.querySelector("#show-signup").addEventListener("click", () => show("signup-panel"));
document.querySelector("#show-recovery").addEventListener("click", () => show("recovery-panel"));
for (const button of document.querySelectorAll(".back-signin")) button.addEventListener("click", () => show("signin-panel"));

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await submit(event.currentTarget, async (values) => {
    recovery.requireVerified();
    await runWithStudioCaptcha(captcha, "sign-in", async (captchaToken) => {
      const credentials = withCaptchaToken({ email: values.email.trim(), password: values.password }, captchaToken);
      const result = await client.auth.signInWithPassword(credentials);
      if (result.error) throw result.error;
      await continueApprovedSession(result.data.session);
    });
  });
});

document.querySelector("#signup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await submit(event.currentTarget, async (values) => {
    await runWithStudioCaptcha(captcha, "signup", async (captchaToken) => {
      const result = await requestStudioSignup(client, values, { captchaToken });
      setStatus(result.needsEmailVerification
        ? "Check your email to verify the address. After verification, an administrator must approve your Studio access."
        : "Your verified access request is pending administrator approval.", "success");
      event.currentTarget.reset();
    });
  });
});

document.querySelector("#recovery-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await submit(event.currentTarget, async (values) => {
    const redirectTo = new URL("/login/?recovery=1", location.origin).href;
    await runWithStudioCaptcha(captcha, "recovery", async (captchaToken) => {
      const options = withCaptchaToken({ redirectTo }, captchaToken);
      const result = await client.auth.resetPasswordForEmail(values.email.trim(), options);
      if (result.error) throw result.error;
      setStatus("If an account exists for that address, Supabase will send a recovery link.", "success");
      event.currentTarget.reset();
    });
  });
});

document.querySelector("#new-password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await submit(event.currentTarget, async (values) => {
    if (values.password !== values.confirmation) throw new Error("The password confirmation does not match");
    if (values.password.length < 12 || values.password.length > 72) throw new Error("Use a password between 12 and 72 characters");
    const result = await client.auth.updateUser({ password: values.password });
    if (result.error) throw result.error;
    await clearStudioGate();
    await client.auth.signOut({ scope: "local" });
    location.replace("/login/?reset=complete");
  });
});

client.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") {
    recovery.markVerified();
    newPasswordButton.disabled = false;
    show("new-password-panel");
    setStatus("Recovery link verified. Choose a new password.", "success");
  }
});

start();

async function start() {
  const parameters = new URLSearchParams(location.search);
  if (parameters.get("reset") === "complete") setStatus("Password updated. Sign in with the new password.", "success");
  if (parameters.get("recovery") === "1" || location.hash.includes("type=recovery")) {
    show("new-password-panel");
    newPasswordButton.disabled = true;
    setStatus("Verifying the password-recovery link…", "success");
    return;
  }
  try {
    const access = await verifyStudioAccess(client);
    if (access.state === "approved") {
      const session = await client.auth.getSession();
      if (session.data.session) await continueApprovedSession(session.data.session);
    } else if (access.state !== "signed-out") {
      setStatus(accessMessage(access.state), access.state === "pending" ? "success" : "error");
    }
  } catch (error) {
    setStatus(error.message);
  }
}

async function continueApprovedSession(session) {
  const access = await verifyStudioAccess(client);
  if (access.state !== "approved") {
    setStatus(accessMessage(access.state), access.state === "pending" ? "success" : "error");
    return;
  }
  await establishStudioGate(session);
  location.replace(nextPath);
}

async function submit(form, action) {
  const button = form.querySelector("[type='submit']");
  button.disabled = true;
  setStatus("Working…");
  try {
    await action(Object.fromEntries(new FormData(form)));
  } catch (error) {
    setStatus(error.message || "The request could not be completed");
  } finally {
    button.disabled = form.id === "new-password-form" ? !recovery.isVerified() : false;
  }
}

function show(id) {
  for (const panel of panels) panel.hidden = panel.id !== id;
  setStatus("");
  document.querySelector(`#${id} input`)?.focus();
}

function setStatus(message, kind = "error") {
  status.textContent = message;
  status.dataset.kind = kind;
}

function safeNext(value) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/app/";
  try {
    const parsed = new URL(value, location.origin);
    return parsed.origin === location.origin && (parsed.pathname === "/app" || parsed.pathname.startsWith("/app/"))
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : "/app/";
  } catch {
    return "/app/";
  }
}
