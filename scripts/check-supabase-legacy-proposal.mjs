import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runtimeRoot = mkdtempSync(join(tmpdir(), "hiper-studio-legacy-security-"));
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
  const testTarget = join(runtimeRoot, "supabase", "tests", "database");
  mkdirSync(migrationTarget, { recursive: true });
  mkdirSync(testTarget, { recursive: true });
  copyFileSync(
    join(root, "supabase", "tests", "fixtures", "legacy_credit_security_schema.sql"),
    join(migrationTarget, "20261024170000_legacy_credit_security_fixture.sql"),
  );
  copyFileSync(
    join(root, "supabase", "tests", "database", "legacy_shared_schema_exposure_test.sql"),
    join(testTarget, "legacy_shared_schema_exposure_test.sql"),
  );
  copyFileSync(
    join(root, "supabase", "tests", "database", "legacy_shared_schema_hardening_test.sql"),
    join(testTarget, "legacy_shared_schema_hardening_test.sql"),
  );

  run("supabase", ["start", "--workdir", runtimeRoot], { capture: true });
  run("supabase", ["test", "db", join(testTarget, "legacy_shared_schema_exposure_test.sql"), "--workdir", runtimeRoot]);

  copyFileSync(
    join(root, "supabase", "proposals", "legacy_shared_schema_hardening.sql"),
    join(migrationTarget, "20261024180000_legacy_shared_schema_hardening.sql"),
  );
  run("supabase", ["db", "reset", "--local", "--no-seed", "--workdir", runtimeRoot], { capture: true });
  run("supabase", ["test", "db", join(testTarget, "legacy_shared_schema_hardening_test.sql"), "--workdir", runtimeRoot]);
  run("supabase", ["db", "lint", "--local", "--level", "warning", "--workdir", runtimeRoot]);
  process.stdout.write(
    "Verified 14 synthetic exposure assertions and 29 post-hardening assertions in a disposable local database. No hosted RPC was invoked.\n",
  );
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
