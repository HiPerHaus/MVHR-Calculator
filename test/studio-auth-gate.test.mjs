import test from "node:test";
import assert from "node:assert/strict";
import {
  STUDIO_GATE_COOKIE,
  STUDIO_LOCAL_GATE_COOKIE,
  accessTokenFromRequest,
  authenticateStudioAccessToken,
  createGateCookie,
  expiredGateCookies,
  isSameOriginMutation,
  loginRedirect,
  safeNextPath,
} from "../server/studio-auth.mjs";

const config = { url: "https://identity.example.test", publishableKey: "public-test-key" };
const token = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 900 })).toString("base64url")}.signature`;

test("gate validates the user with Auth and active membership with RLS credentials", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push([url, options]);
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: "user-a", email: "a@example.test" });
    return Response.json([{ workspace_id: "workspace-a", role: "member", status: "active" }]);
  };
  const result = await authenticateStudioAccessToken(token, { fetchImpl, config });
  assert.equal(result.ok, true);
  assert.equal(result.membership.workspace_id, "workspace-a");
  assert.match(calls[1][0], /status=eq.active/);
  assert.equal(calls[0][1].headers.authorization, `Bearer ${token}`);
  assert.equal(calls[0][1].headers.apikey, config.publishableKey);
});

test("missing, expired and unapproved sessions fail closed", async () => {
  assert.deepEqual(await authenticateStudioAccessToken("", { config }), { ok: false, status: 401, reason: "missing-session" });
  const expired = await authenticateStudioAccessToken(token, { config, fetchImpl: async () => new Response("", { status: 401 }) });
  assert.equal(expired.reason, "invalid-session");
  let count = 0;
  const unapproved = await authenticateStudioAccessToken(token, {
    config,
    fetchImpl: async () => ++count === 1 ? Response.json({ id: "user-a" }) : Response.json([]),
  });
  assert.deepEqual(unapproved, { ok: false, status: 403, reason: "access-not-approved" });
});

test("gate cookies are HTTP-only, short-lived and use host scope on HTTPS", () => {
  const secure = createGateCookie(new Request("https://studio.example.test/api/auth-gate"), token);
  assert.match(secure, new RegExp(`^${STUDIO_GATE_COOKIE}=`));
  assert.match(secure, /HttpOnly/); assert.match(secure, /SameSite=Strict/); assert.match(secure, /Secure/);
  assert.match(secure, /Max-Age=600/);
  const local = createGateCookie(new Request("http://127.0.0.1:4173/api/auth-gate"), token);
  assert.match(local, new RegExp(`^${STUDIO_LOCAL_GATE_COOKIE}=`));
  assert.doesNotMatch(local, /; Secure/);
  assert.equal(expiredGateCookies().length, 2);
  assert.equal(accessTokenFromRequest(new Request("https://studio.test", { headers: { cookie: `${STUDIO_GATE_COOKIE}=${token}` } })), token);
});

test("mutation origin and post-login redirects reject cross-site and open redirects", () => {
  assert.equal(isSameOriginMutation(new Request("https://studio.test/api/auth-gate", { headers: { origin: "https://studio.test" } })), true);
  assert.equal(isSameOriginMutation(new Request("https://studio.test/api/auth-gate", { headers: { origin: "https://evil.test" } })), false);
  assert.equal(safeNextPath("https://evil.test/app/"), "/app/");
  assert.equal(safeNextPath("//evil.test/app/"), "/app/");
  assert.equal(safeNextPath("/account"), "/app/");
  assert.equal(safeNextPath("/application"), "/app/");
  assert.equal(safeNextPath("/app/?floor=ground"), "/app/?floor=ground");
  const redirect = loginRedirect(new Request("https://studio.test/app/?floor=ground"), "invalid-session");
  assert.equal(redirect.origin, "https://studio.test");
  assert.equal(redirect.searchParams.get("next"), "/app/?floor=ground");
});
