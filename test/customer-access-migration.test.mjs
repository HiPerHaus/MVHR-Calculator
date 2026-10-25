import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../supabase/migrations/20261024143000_studio_customer_access.sql", import.meta.url);
const workspaceMigrationUrl = new URL("../supabase/migrations/20261023123857_studio_cloud_workspace.sql", import.meta.url);
const companyMigrationUrl = new URL("../supabase/migrations/20261024015157_studio_company_profiles.sql", import.meta.url);
const rollbackUrl = new URL("../supabase/rollbacks/20261024143000_studio_customer_access.rollback.sql", import.meta.url);

test("customer access migration defaults signup to pending and never accepts a client role", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /status text not null default 'pending'/);
  assert.match(sql, /new\.email_confirmed_at/);
  assert.match(sql, /studio_signup/);
  assert.doesNotMatch(sql, /raw_user_meta_data->>'role'/);
  assert.doesNotMatch(sql, /grant\s+(insert|update)[^;]*studio_memberships/i);
  assert.doesNotMatch(sql, /grant\s+(insert|update)[^;]*studio_access_requests/i);
});

test("approval and suspension are privileged, role-bounded and preserve records", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /studio_admin_approve_access/);
  assert.match(sql, /p_role not in \('admin','member'\)/);
  assert.match(sql, /email_verified_at is not null/);
  assert.match(sql, /studio_admin_set_member_status/);
  assert.match(sql, /Administrators cannot change their own status/);
  assert.match(sql, /target_role='member'/);
  assert.doesNotMatch(sql, /delete from public\.studio_memberships/i);
  assert.doesNotMatch(sql, /delete from auth\.users/i);
});

test("every private data policy requires an active workspace membership", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const policy of [
    "studio_workspace_member",
    "studio_projects_read",
    "studio_projects_insert",
    "studio_projects_update",
    "studio_company_profile_read",
    "studio_company_profile_insert",
    "studio_company_profile_update",
    "studio_files_read",
    "studio_files_insert",
    "studio_files_remove",
  ]) {
    const start = sql.indexOf(`create policy ${policy}`);
    assert.notEqual(start, -1, `${policy} should exist`);
    const next = sql.indexOf("create policy", start + 14);
    const body = sql.slice(start, next < 0 ? sql.length : next);
    assert.match(body, /m\.status='active'/, `${policy} must require active membership`);
  }
});

test("project and company asset paths cannot cross workspace boundaries", async () => {
  const [workspace, company, access] = await Promise.all([
    readFile(workspaceMigrationUrl, "utf8"),
    readFile(companyMigrationUrl, "utf8"),
    readFile(migrationUrl, "utf8"),
  ]);
  assert.match(workspace, /constraint studio_path_workspace check \(split_part\(object_path,'\/',1\)=workspace_id::text\)/);
  assert.match(workspace, /constraint studio_previous_path_workspace check \(previous_object_path is null or split_part\(previous_object_path,'\/',1\)=workspace_id::text\)/);
  assert.match(company, /logo_path text check\(logo_path is null or split_part\(logo_path,'\/',1\)=workspace_id::text\)/);
  assert.doesNotMatch(access, /studio_projects_object_workspace_check|studio_company_logo_workspace_check/);
  assert.match(access, /deployed Studio baseline already has validated workspace-path checks/);
  assert.ok((access.match(/split_part\(object_path,'\/',1\)=workspace_id::text/g) ?? []).length >= 2);
});

test("guarded rollback restores legacy access without discarding post-cutover intent", async () => {
  const sql = await readFile(rollbackUrl, "utf8");
  assert.match(sql, /status <> 'active'/);
  assert.match(sql, /role = 'admin'/);
  assert.match(sql, /exists\(select 1 from public\.studio_access_requests\)/);
  assert.match(sql, /drop column status/);
  assert.match(sql, /check\(role in \('owner','member'\)\)/);
  assert.doesNotMatch(sql, /delete from public\.studio_projects|delete from public\.studio_company_profiles/i);
});
