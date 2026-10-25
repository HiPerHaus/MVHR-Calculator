import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createReturnAccessVerifier, shouldReloadProtectedPage } from "../app/protected-lifecycle.mjs";
import { createPasswordRecoveryGuard } from "../src/persistence/studio-access.mjs";

test("password changes require a verified recovery event, not only a recovery query string", () => {
  const guard = createPasswordRecoveryGuard();
  assert.equal(guard.isVerified(), false);
  assert.throws(() => guard.requireVerified(), /valid password-recovery link/);
  guard.markVerified();
  assert.equal(guard.isVerified(), true);
  assert.doesNotThrow(() => guard.requireVerified());
});

test("protected pages reload out of browser back-forward cache and reverify after returning", async () => {
  assert.equal(shouldReloadProtectedPage({ persisted: true }), true);
  assert.equal(shouldReloadProtectedPage({ persisted: false }), false);
  let clock = 1_000;
  let calls = 0;
  const verify = createReturnAccessVerifier(async () => { calls++; }, { now: () => clock, minimumIntervalMs: 30_000 });
  assert.equal(await verify(), false);
  clock += 30_001;
  assert.equal(await verify(), true);
  assert.equal(calls, 1);
});

test("proposed access migration keeps storage private and prevents last-manager suspension", async () => {
  const [base, access] = await Promise.all([
    readFile(new URL("../supabase/migrations/20261023123857_studio_cloud_workspace.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20261024143000_studio_customer_access.sql", import.meta.url), "utf8"),
  ]);
  assert.match(base, /values\('studio-drawings','studio-drawings',false,/);
  assert.match(access, /A workspace must retain at least one active owner or administrator/);
  assert.match(access, /where m\.workspace_id=p_workspace_id for update/);
  assert.match(base, /constraint studio_path_workspace/);
  assert.doesNotMatch(access, /studio_projects_object_workspace_check|studio_company_logo_workspace_check/);
  assert.match(access, /split_part\(object_path,'\/',1\)=workspace_id::text/);
  assert.doesNotMatch(access, /raw_user_meta_data->>'role'/);
  assert.match(access, /revoke all on function public\.studio_admin_approve_access\(uuid,uuid,text\) from public,anon/);
});

test("browser persistence never uses a privileged key or a public signed drawing URL", async () => {
  const files = await Promise.all([
    readFile(new URL("../app/cloud-config.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/persistence/cloud-project-store.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/persistence/company-profile.mjs", import.meta.url), "utf8"),
  ]);
  const source = files.join("\n");
  assert.doesNotMatch(source, /service[_-]?role/i);
  assert.doesNotMatch(source, /createSignedUrl|createSignedUrls|getPublicUrl/);
});

test("Vercel production configuration invokes the access proxy for every editor HTML route", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.equal(config.proxy.entrypoint, "proxy.js");
  assert.deepEqual(config.proxy.matcher, ["/app", "/app/", "/app/index.html"]);
  const proxy = await readFile(new URL("../proxy.js", import.meta.url), "utf8");
  assert.match(proxy, /authorizeStudioRequest\(request\)/);
  assert.match(proxy, /Location: loginRedirect/);
  assert.match(proxy, /"Cache-Control": "private, no-store"/);
});
