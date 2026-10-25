import { establishStudioGate, getStudioClient } from "./auth-client.mjs";
import { setBootAccess } from "./auth-context.mjs";
import { shouldReloadProtectedPage } from "./protected-lifecycle.mjs";
import { verifyStudioAccess } from "../src/persistence/studio-access.mjs";

const status = document.querySelector("#app-auth-status");
const shell = document.querySelector(".app-shell");

window.addEventListener("pageshow", (event) => {
  if (shouldReloadProtectedPage(event)) window.location.reload();
});

start();

async function start() {
  try {
    const client = getStudioClient();
    const access = await verifyStudioAccess(client);
    if (access.state !== "approved") return redirectToLogin(access.state);
    const sessionResult = await client.auth.getSession();
    if (sessionResult.error || !sessionResult.data.session) return redirectToLogin("signed-out");
    await establishStudioGate(sessionResult.data.session);
    setBootAccess(access);
    status.hidden = true;
    shell.hidden = false;
    await import("./main.mjs");
  } catch (error) {
    status.classList.add("auth-check-failed");
    status.replaceChildren(
      Object.assign(document.createElement("strong"), { textContent: "Studio access could not be verified" }),
      Object.assign(document.createElement("span"), { textContent: error.message }),
      Object.assign(document.createElement("a"), { textContent: "Return to sign in", href: "/login/?reason=verification-failed" }),
    );
  }
}

function redirectToLogin(reason) {
  const target = new URL("/login/", window.location.origin);
  target.searchParams.set("next", `${window.location.pathname}${window.location.search}`);
  target.searchParams.set("reason", reason);
  window.location.replace(target);
}
