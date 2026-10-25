import test from "node:test";
import assert from "node:assert/strict";
import {
  createAccessAdminStore,
  normalizeSignup,
  requestStudioSignup,
  verifyStudioAccess,
} from "../src/persistence/studio-access.mjs";

test("access verification uses network-verified user state and only active memberships", async () => {
  const approved = clientFixture({
    user: { id: "user-a", email: "a@example.test" },
    memberships: [
      { workspace_id: "workspace-a", role: "member", status: "active", studio_workspaces: { id: "workspace-a", name: "A" } },
      { workspace_id: "workspace-b", role: "admin", status: "suspended", studio_workspaces: { id: "workspace-b", name: "B" } },
    ],
  });
  const access = await verifyStudioAccess(approved);
  assert.equal(access.state, "approved");
  assert.deepEqual(access.memberships.map((item) => item.workspaceId), ["workspace-a"]);
  assert.equal(access.allMemberships[1].status, "suspended");

  const expired = clientFixture({ user: null, userError: { message: "expired" } });
  assert.equal((await verifyStudioAccess(expired)).state, "signed-out");
});

test("pending, rejected and suspended accounts fail closed before workspace access", async () => {
  for (const state of ["pending", "rejected"]) {
    const client = clientFixture({ user: { id: "new-user" }, request: { user_id: "new-user", status: state } });
    const access = await verifyStudioAccess(client);
    assert.equal(access.state, state);
    assert.deepEqual(access.memberships, []);
  }
  const suspended = clientFixture({
    user: { id: "suspended-user" },
    memberships: [{ workspace_id: "workspace-a", role: "member", status: "suspended", studio_workspaces: { id: "workspace-a", name: "A" } }],
    request: { user_id: "suspended-user", status: "approved" },
  });
  assert.equal((await verifyStudioAccess(suspended)).state, "suspended");
});

test("signup is normalized, requires a strong bounded password and cannot assign roles", async () => {
  assert.throws(() => normalizeSignup({ email: "bad", password: "short", fullName: "A", companyName: "B" }), /email/);
  const calls = [];
  const client = { auth: { async signUp(payload) { calls.push(payload); return { data: { user: { id: "pending-user" }, session: null }, error: null }; } } };
  const result = await requestStudioSignup(client, { email: " NEW@Example.test ", password: "correct horse battery", fullName: "  New   User ", companyName: " HiPer Homes " });
  assert.equal(result.needsEmailVerification, true);
  assert.deepEqual(calls[0].options.data, { studio_signup: true, full_name: "New User", company_name: "HiPer Homes" });
  assert.equal("role" in calls[0].options.data, false);
  await requestStudioSignup(client, { email: "human@example.test", password: "correct horse battery", fullName: "Human User", companyName: "HiPer Homes" }, { captchaToken: "captcha-proof" });
  assert.equal(calls[1].options.captchaToken, "captcha-proof");
  assert.equal("captchaToken" in calls[1].options.data, false);
});

test("admin store uses privileged RPCs and blocks owner self-assignment in the client", async () => {
  const rpcCalls = [];
  const client = clientFixture({ user: { id: "admin" }, platformAdmin: true, membershipRole: "owner" });
  client.rpc = async (name, args) => { rpcCalls.push([name, args]); return { data: [{ ok: true }], error: null }; };
  const store = createAccessAdminStore(client);
  assert.deepEqual(await store.capabilities("workspace-a", "admin"), { platformAdmin: true, role: "owner", canManageMembers: true });
  await assert.rejects(store.approve({ userId: "target", workspaceId: "workspace-a", role: "owner" }), /admin or member/);
  await store.approve({ userId: "target", workspaceId: "workspace-a", role: "member" });
  await store.setStatus({ userId: "target", workspaceId: "workspace-a", status: "suspended" });
  assert.deepEqual(rpcCalls.map(([name]) => name), ["studio_admin_approve_access", "studio_admin_set_member_status"]);
});

function clientFixture({ user = null, userError = null, memberships = [], request = null, platformAdmin = false, membershipRole = null } = {}) {
  return {
    auth: { async getUser() { return { data: { user }, error: userError }; } },
    from(table) {
      const state = { filters: [] };
      const query = {
        select() { return query; },
        eq(key, value) { state.filters.push([key, value]); return query; },
        order() { return Promise.resolve({ data: table === "studio_memberships" ? memberships : [], error: null }); },
        maybeSingle() {
          if (table === "studio_access_requests") return Promise.resolve({ data: request, error: null });
          if (table === "studio_platform_admins") return Promise.resolve({ data: platformAdmin ? { user_id: user?.id ?? "admin" } : null, error: null });
          if (table === "studio_memberships") return Promise.resolve({ data: membershipRole ? { role: membershipRole, status: "active" } : null, error: null });
          return Promise.resolve({ data: null, error: null });
        },
      };
      return query;
    },
  };
}
