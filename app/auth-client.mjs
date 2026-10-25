import { createClient } from "./vendor/supabase.mjs";
import { cloudConfig } from "./cloud-config.mjs";
import { createAuthStorage } from "../src/persistence/auth-storage.mjs";

let client;

export function getStudioClient() {
  return client ??= createClient(cloudConfig.url, cloudConfig.publishableKey, {
    auth: {
      storage: createAuthStorage(window.indexedDB),
      storageKey: "hiper-studio-auth-v1",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

export async function establishStudioGate(session, { fetchImpl = fetch } = {}) {
  const accessToken = session?.access_token;
  if (!accessToken) throw new Error("A verified sign-in session is required");
  const response = await fetchImpl("/api/auth-gate", {
    method: "POST",
    credentials: "same-origin",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(accessMessage(result.reason));
  }
  return response.json();
}

export async function clearStudioGate({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl("/api/auth-gate", {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error("Studio could not close the protected browser session. Try signing out again.");
  return true;
}

export function accessMessage(state) {
  if (state === "pending") return "Your email is verified and your Studio access request is waiting for administrator approval.";
  if (state === "rejected") return "This access request was not approved. Contact your Studio administrator if this is unexpected.";
  if (state === "suspended") return "Studio access for this account is suspended. Contact your Studio administrator.";
  if (state === "not-requested") return "This account does not have a Studio access request or approved workspace.";
  if (state === "access-not-approved") return "This account has not yet been approved for a Studio workspace.";
  if (state === "identity-unavailable" || state === "membership-unavailable") return "Studio could not verify access. Try again when the connection is available.";
  return "Sign in with an approved Studio account.";
}
