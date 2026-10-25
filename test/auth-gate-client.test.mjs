import test from "node:test";
import assert from "node:assert/strict";
import { clearStudioGate, establishStudioGate } from "../app/auth-client.mjs";

test("browser gate sync sends the verified token only in an authorization header", async () => {
  const calls = [];
  const result = await establishStudioGate({ access_token: "verified-access-token" }, {
    fetchImpl: async (url, options) => { calls.push([url, options]); return Response.json({ authenticated: true }); },
  });
  assert.equal(result.authenticated, true);
  assert.equal(calls[0][0], "/api/auth-gate");
  assert.equal(calls[0][1].headers.Authorization, "Bearer verified-access-token");
  assert.doesNotMatch(calls[0][1].body, /verified-access-token/);
});

test("logout refuses to claim completion when the HTTP-only gate was not cleared", async () => {
  await assert.rejects(
    clearStudioGate({ fetchImpl: async () => new Response("", { status: 503 }) }),
    /could not close/,
  );
  assert.equal(await clearStudioGate({ fetchImpl: async () => new Response("", { status: 200 }) }), true);
});
