const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const STUDIO_MEMBER_ROLES = Object.freeze(["owner", "admin", "member"]);
export const STUDIO_MEMBER_STATUSES = Object.freeze(["active", "suspended"]);

export function createPasswordRecoveryGuard() {
  let verified = false;
  return Object.freeze({
    markVerified() { verified = true; },
    isVerified() { return verified; },
    requireVerified() {
      if (!verified) throw new Error("Open a valid password-recovery link before choosing a new password");
    },
  });
}

export async function verifyStudioAccess(client) {
  const userResult = await client.auth.getUser();
  if (userResult.error || !userResult.data?.user) {
    return { state: "signed-out", user: null, memberships: [], request: null };
  }
  const user = userResult.data.user;
  const membershipResult = await client
    .from("studio_memberships")
    .select("workspace_id,role,status,studio_workspaces(id,name)")
    .eq("user_id", user.id)
    .order("workspace_id");
  if (membershipResult.error) throw new Error(membershipResult.error.message ?? "Access check failed");
  const memberships = (membershipResult.data ?? []).map(normalizeMembership);
  const activeMemberships = memberships.filter((membership) => membership.status === "active");
  if (activeMemberships.length) {
    return { state: "approved", user, memberships: activeMemberships, allMemberships: memberships, request: null };
  }
  const requestResult = await client
    .from("studio_access_requests")
    .select("user_id,email,full_name,company_name,status,email_verified_at,requested_at,reviewed_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (requestResult.error) throw new Error(requestResult.error.message ?? "Access request check failed");
  const request = requestResult.data ?? null;
  if (memberships.some((membership) => membership.status === "suspended") || request?.status === "suspended") {
    return { state: "suspended", user, memberships: [], allMemberships: memberships, request };
  }
  return { state: request?.status ?? "not-requested", user, memberships: [], allMemberships: memberships, request };
}

export async function requestStudioSignup(client, values, { captchaToken } = {}) {
  const input = normalizeSignup(values);
  const result = await client.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        studio_signup: true,
        full_name: input.fullName,
        company_name: input.companyName,
      },
      ...(captchaToken ? { captchaToken } : {}),
    },
  });
  if (result.error) throw new Error(result.error.message ?? "Access request could not be submitted");
  return {
    email: input.email,
    needsEmailVerification: !result.data?.session,
    userId: result.data?.user?.id ?? null,
    state: "pending",
  };
}

export function createAccessAdminStore(client) {
  return {
    async capabilities(workspaceId, userId) {
      const [platform, membership] = await Promise.all([
        client.from("studio_platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
        client.from("studio_memberships").select("role,status").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle(),
      ]);
      if (platform.error) throw new Error(platform.error.message ?? "Administrator access check failed");
      if (membership.error) throw new Error(membership.error.message ?? "Workspace role check failed");
      const role = membership.data?.status === "active" ? membership.data.role : null;
      return {
        platformAdmin: Boolean(platform.data),
        role,
        canManageMembers: role === "owner" || role === "admin",
      };
    },
    async pending() {
      return checked(await client.rpc("studio_admin_pending_access"));
    },
    async members(workspaceId) {
      return checked(await client.rpc("studio_admin_workspace_members", { p_workspace_id: workspaceId }));
    },
    async approve({ userId, workspaceId, role = "member" }) {
      if (!STUDIO_MEMBER_ROLES.includes(role) || role === "owner") throw new TypeError("Approval role must be admin or member");
      return checked(await client.rpc("studio_admin_approve_access", {
        p_user_id: userId,
        p_workspace_id: workspaceId,
        p_role: role,
      }));
    },
    async setStatus({ userId, workspaceId, status }) {
      if (!STUDIO_MEMBER_STATUSES.includes(status)) throw new TypeError("Membership status is invalid");
      return checked(await client.rpc("studio_admin_set_member_status", {
        p_user_id: userId,
        p_workspace_id: workspaceId,
        p_status: status,
      }));
    },
  };
}

export function normalizeSignup(values) {
  const email = String(values?.email ?? "").trim().toLowerCase();
  const password = String(values?.password ?? "");
  const fullName = cleanText(values?.fullName, 160, "Name");
  const companyName = cleanText(values?.companyName, 160, "Company name");
  if (!EMAIL_PATTERN.test(email) || email.length > 254) throw new TypeError("Enter a valid email address");
  if (password.length < 12 || password.length > 72) throw new TypeError("Use a password between 12 and 72 characters");
  return { email, password, fullName, companyName };
}

function normalizeMembership(row) {
  const workspace = Array.isArray(row.studio_workspaces) ? row.studio_workspaces[0] : row.studio_workspaces;
  return {
    workspaceId: row.workspace_id,
    role: row.role,
    status: row.status,
    workspace: workspace ? { id: workspace.id, name: workspace.name } : null,
  };
}

function cleanText(value, maximum, label) {
  const cleaned = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!cleaned || cleaned.length > maximum) throw new TypeError(`${label} must contain 1–${maximum} characters`);
  return cleaned;
}

function checked(result) {
  if (result.error) throw new Error(result.error.message ?? "Administrator request failed");
  return result.data;
}
