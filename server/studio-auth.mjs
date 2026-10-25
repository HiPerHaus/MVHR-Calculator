import { cloudConfig } from "../app/cloud-config.mjs";

export const STUDIO_GATE_COOKIE = "__Host-hiper-studio-gate";
export const STUDIO_LOCAL_GATE_COOKIE = "hiper-studio-gate";
const MAX_GATE_SECONDS = 10 * 60;

export async function authenticateStudioAccessToken(
  accessToken,
  { fetchImpl = fetch, config = cloudConfig } = {},
) {
  if (typeof accessToken !== "string" || accessToken.length < 20) {
    return { ok: false, status: 401, reason: "missing-session" };
  }
  const headers = {
    apikey: config.publishableKey,
    authorization: `Bearer ${accessToken}`,
    accept: "application/json",
  };
  try {
    const userResponse = await fetchImpl(`${config.url}/auth/v1/user`, { headers });
    if (!userResponse.ok) return { ok: false, status: 401, reason: "invalid-session" };
    const user = await userResponse.json();
    if (!user?.id) return { ok: false, status: 401, reason: "invalid-session" };
    const query = new URLSearchParams({
      select: "workspace_id,role,status",
      user_id: `eq.${user.id}`,
      status: "eq.active",
      limit: "1",
    });
    const membershipResponse = await fetchImpl(
      `${config.url}/rest/v1/studio_memberships?${query}`,
      { headers },
    );
    if (!membershipResponse.ok) return { ok: false, status: 503, reason: "membership-unavailable" };
    const memberships = await membershipResponse.json();
    if (!Array.isArray(memberships) || memberships.length === 0) {
      return { ok: false, status: 403, reason: "access-not-approved" };
    }
    return { ok: true, user, membership: memberships[0] };
  } catch {
    return { ok: false, status: 503, reason: "identity-unavailable" };
  }
}

export function accessTokenFromRequest(request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7).trim();
  const cookies = parseCookies(request.headers.get("cookie") ?? "");
  return cookies.get(STUDIO_GATE_COOKIE) ?? cookies.get(STUDIO_LOCAL_GATE_COOKIE) ?? "";
}

export async function authorizeStudioRequest(request, options) {
  return authenticateStudioAccessToken(accessTokenFromRequest(request), options);
}

export function createGateCookie(request, accessToken) {
  const secure = new URL(request.url).protocol === "https:";
  const name = secure ? STUDIO_GATE_COOKIE : STUDIO_LOCAL_GATE_COOKIE;
  const maxAge = Math.min(MAX_GATE_SECONDS, tokenSecondsRemaining(accessToken));
  return `${name}=${accessToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function expiredGateCookies() {
  return [
    `${STUDIO_GATE_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure`,
    `${STUDIO_LOCAL_GATE_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
  ];
}

export function isSameOriginMutation(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function loginRedirect(request, reason = "signin-required") {
  const source = new URL(request.url);
  const target = new URL("/login/", source);
  target.searchParams.set("next", safeNextPath(`${source.pathname}${source.search}`));
  target.searchParams.set("reason", reason);
  return target;
}

export function safeNextPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/app/";
  try {
    const parsed = new URL(value, "https://studio.invalid");
    if (parsed.origin !== "https://studio.invalid" || (parsed.pathname !== "/app" && !parsed.pathname.startsWith("/app/"))) return "/app/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/app/";
  }
}

function parseCookies(value) {
  const result = new Map();
  for (const part of value.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const content = part.slice(separator + 1).trim();
    if (name && !result.has(name)) result.set(name, content);
  }
  return result;
}

function tokenSecondsRemaining(token) {
  try {
    const encoded = token.split(".")[1];
    if (!encoded) return MAX_GATE_SECONDS;
    const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const payload = JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
    const remaining = Math.floor(Number(payload.exp) - Date.now() / 1000);
    return Number.isFinite(remaining) ? Math.max(1, remaining) : MAX_GATE_SECONDS;
  } catch {
    return MAX_GATE_SECONDS;
  }
}
