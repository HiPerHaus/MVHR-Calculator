import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runtimeRoot = mkdtempSync(join(tmpdir(), "hiper-studio-supabase-"));
const dockerConfig = join(runtimeRoot, "docker-config");
const runtimeEnv = { ...process.env, DOCKER_CONFIG: dockerConfig };
let initialized = false;

try {
  mkdirSync(dockerConfig, { recursive: true });
  writeFileSync(join(dockerConfig, "config.json"), '{"auths":{}}\n');
  run("docker", ["info", "--format", "{{.ServerVersion}}"], { capture: true });
  run("supabase", ["init", "--workdir", runtimeRoot, "--yes"], { capture: true });
  initialized = true;

  const migrationTarget = join(runtimeRoot, "supabase", "migrations");
  const rollbackTarget = join(runtimeRoot, "supabase", "rollbacks");
  const databaseTestTarget = join(runtimeRoot, "supabase", "tests", "database");
  mkdirSync(migrationTarget, { recursive: true });
  mkdirSync(rollbackTarget, { recursive: true });
  mkdirSync(databaseTestTarget, { recursive: true });
  copyFileSync(
    join(root, "supabase", "tests", "fixtures", "legacy_schema.sql"),
    join(migrationTarget, "20261023120000_test_legacy_dependencies.sql"),
  );
  const migrationFiles = readdirSync(join(root, "supabase", "migrations")).filter((name) => name.endsWith(".sql")).sort();
  verifyProductionMigrationHistory(migrationFiles);
  for (const filename of migrationFiles) {
    copyFileSync(join(root, "supabase", "migrations", filename), join(migrationTarget, filename));
  }
  copyFileSync(
    join(root, "supabase", "rollbacks", "20261024143000_studio_customer_access.rollback.sql"),
    join(rollbackTarget, "20261024143000_studio_customer_access.rollback.sql"),
  );
  copyFileSync(
    join(root, "supabase", "tests", "database", "studio_customer_access_test.sql"),
    join(databaseTestTarget, "studio_customer_access_test.sql"),
  );
  const rollbackTestSource = readFileSync(
    join(root, "supabase", "tests", "database", "studio_customer_access_rollback_test.sql"),
    "utf8",
  );
  const rollbackSql = readFileSync(
    join(root, "supabase", "rollbacks", "20261024143000_studio_customer_access.rollback.sql"),
    "utf8",
  );
  assert.equal((rollbackTestSource.match(/-- __CUSTOMER_ACCESS_ROLLBACK__/g) ?? []).length, 1, "rollback test must include one rollback marker");
  writeFileSync(
    join(databaseTestTarget, "studio_customer_access_rollback_test.sql"),
    rollbackTestSource.replace("-- __CUSTOMER_ACCESS_ROLLBACK__", () => rollbackSql),
  );

  run("supabase", ["start", "--workdir", runtimeRoot], { capture: true });
  run("supabase", ["test", "db", join(databaseTestTarget, "studio_customer_access_test.sql"), "--workdir", runtimeRoot]);
  run("supabase", ["db", "lint", "--local", "--level", "warning", "--workdir", runtimeRoot]);
  run("supabase", ["db", "advisors", "--local", "--workdir", runtimeRoot]);
  await verifyStorageApi(runtimeRoot);
  run("supabase", ["db", "reset", "--local", "--no-seed", "--workdir", runtimeRoot], { capture: true });
  run("supabase", ["test", "db", join(databaseTestTarget, "studio_customer_access_rollback_test.sql"), "--workdir", runtimeRoot]);
  process.stdout.write("Verified production-aligned migration history, disposable forward migration, 47 authorization assertions, Storage API isolation, and 25 rollback assertions.\n");
} finally {
  if (initialized) {
    try {
      run("supabase", ["stop", "--no-backup", "--workdir", runtimeRoot], { capture: true });
    } catch (error) {
      process.stderr.write(`Disposable Supabase cleanup warning: ${error.message}\n`);
    }
  }
  rmSync(runtimeRoot, { recursive: true, force: true });
}

function verifyProductionMigrationHistory(filenames) {
  const expected = new Map([
    ["20261023123857_studio_cloud_workspace.sql", "883fd0ec71728c2dae0723ecf7a28c51c4bd8e7a50148f225d8bdf1b450d3f04"],
    ["20261024015157_studio_company_profiles.sql", "84779e66e7f9fca99266f139825e575715e30b30b7aa51ca309248e79ee228f7"],
  ]);
  for (const [filename, expectedHash] of expected) {
    assert.ok(filenames.includes(filename), `${filename} must match the production migration timestamp`);
    const actualHash = createHash("sha256").update(readFileSync(join(root, "supabase", "migrations", filename))).digest("hex");
    assert.equal(actualHash, expectedHash, `${filename} must remain byte-identical to the deployed migration`);
  }
}

async function verifyStorageApi(workdir) {
  const raw = run("supabase", ["status", "--output", "env", "--workdir", workdir], { capture: true });
  const config = Object.fromEntries(raw.trim().split("\n").filter(Boolean).map((line) => {
    const at = line.indexOf("=");
    return [line.slice(0, at), line.slice(at + 1).replace(/^"|"$/g, "")];
  }));
  const url = config.API_URL;
  const publicKey = config.ANON_KEY || config.PUBLISHABLE_KEY;
  const secretKey = config.SERVICE_ROLE_KEY || config.SECRET_KEY;
  assert.match(url, /^http:\/\/(127\.0\.0\.1|localhost):/, "authorization test target must be loopback only");
  assert.ok(publicKey && secretKey, "local public and secret keys are required");

  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin = createClient(url, secretKey, options);
  const memberA = createClient(url, publicKey, options);
  const memberB = createClient(url, publicKey, options);
  const suffix = randomUUID();
  const password = `Local-only-${suffix}!`;
  const signupA = await memberA.auth.signUp({
    email: `storage-a-${suffix}@example.test`,
    password,
    options: { data: { studio_signup: true, full_name: "Storage A", company_name: "Fixture A" } },
  });
  const signupB = await memberB.auth.signUp({
    email: `storage-b-${suffix}@example.test`,
    password,
    options: { data: { studio_signup: true, full_name: "Storage B", company_name: "Fixture B" } },
  });
  assert.ifError(signupA.error);
  assert.ifError(signupB.error);
  assert.ok(signupA.data.session && signupB.data.session, "local signups must return isolated sessions");

  const userA = signupA.data.user.id;
  const userB = signupB.data.user.id;
  const workspaceA = randomUUID();
  const workspaceB = randomUUID();
  assert.ifError((await admin.from("studio_workspaces").insert([
    { id: workspaceA, name: "Storage fixture A" },
    { id: workspaceB, name: "Storage fixture B" },
  ])).error);
  assert.ifError((await admin.from("studio_memberships").insert([
    { workspace_id: workspaceA, user_id: userA, role: "owner", status: "active" },
    { workspace_id: workspaceB, user_id: userB, role: "owner", status: "active" },
  ])).error);

  const ownPathA = `${workspaceA}/${userA}/a.json`;
  const ownPathB = `${workspaceB}/${userB}/b.json`;
  assert.ifError((await memberA.storage.from("studio-drawings").upload(ownPathA, jsonBytes("a"), { contentType: "application/json" })).error);
  assert.ifError((await memberB.storage.from("studio-drawings").upload(ownPathB, jsonBytes("b"), { contentType: "application/json" })).error);
  assert.ifError((await memberA.storage.from("studio-drawings").download(ownPathA)).error);
  assert.ok((await memberA.storage.from("studio-drawings").download(ownPathB)).error, "cross-workspace download must be rejected");
  assert.ok((await memberA.storage.from("studio-drawings").upload(`${workspaceB}/${userA}/cross.json`, jsonBytes("cross"), { contentType: "application/json" })).error, "cross-workspace upload must be rejected");
  assert.ok((await memberA.storage.from("studio-drawings").upload(`${workspaceA}/${userB}/cross.json`, jsonBytes("cross"), { contentType: "application/json" })).error, "another user path must be rejected");

  const publicUrl = memberA.storage.from("studio-drawings").getPublicUrl(ownPathA).data.publicUrl;
  assert.equal((await fetch(publicUrl)).ok, false, "private object must not be available through a public URL");
  assert.ifError((await memberA.storage.from("studio-drawings").remove([ownPathB])).error);
  const listB = await admin.storage.from("studio-drawings").list(`${workspaceB}/${userB}`);
  assert.ifError(listB.error);
  assert.equal(listB.data.some((entry) => entry.name === "b.json"), true, "cross-workspace remove must affect no object");
  assert.ifError((await memberA.storage.from("studio-drawings").remove([ownPathA])).error);
  const listA = await admin.storage.from("studio-drawings").list(`${workspaceA}/${userA}`);
  assert.ifError(listA.error);
  assert.equal(listA.data.some((entry) => entry.name === "a.json"), false, "own-path remove must delete the object");

  assert.ifError((await memberA.storage.from("studio-drawings").upload(ownPathA, jsonBytes("again"), { contentType: "application/json" })).error);
  assert.ifError((await admin.from("studio_memberships").update({ status: "suspended" }).eq("workspace_id", workspaceA).eq("user_id", userA)).error);
  assert.ok((await memberA.storage.from("studio-drawings").download(ownPathA)).error, "suspension must block an already-issued token");
  assert.ok((await memberA.storage.from("studio-drawings").upload(`${workspaceA}/${userA}/after-suspend.json`, jsonBytes("blocked"), { contentType: "application/json" })).error, "suspension must block writes from an already-issued token");
}

function jsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify({ value }));
}

function run(command, arguments_, { capture = false } = {}) {
  try {
    return execFileSync(command, arguments_, {
      cwd: root,
      env: runtimeEnv,
      encoding: "utf8",
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    }) || "";
  } catch (error) {
    const output = [error.stdout, error.stderr].filter(Boolean).join("\n");
    throw new Error(`${basename(command)} failed${output ? `:\n${sanitize(output)}` : ""}`, { cause: error });
  }
}

function sanitize(value) {
  return String(value)
    .replace(/sb_(?:publishable|secret)_[A-Za-z0-9_-]+/g, "<redacted-local-key>")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "<redacted-local-jwt>");
}
