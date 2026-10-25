# Open decisions

## Customer-access production rollout — 24 October 2026

The owner directly requested customer signup and user management after the earlier invitation-only login baseline. The local candidate therefore supports self-service access requests, but registration never grants Studio access: verified email plus explicit administrator approval and workspace assignment are required.

Production remains gated on one coordinated, reversible change window:

1. identify the exact existing Supabase project and take its normal recoverable database backup; preflight existing project/logo object paths against their workspace IDs and confirm every workspace has an intended active owner/administrator;
2. review and apply only `20261024143000_studio_customer_access.sql`; the earlier local migration filenames now use the exact production history timestamps and byte-identical SQL, and the customer migration relies on the existing validated project, previous-project and company-logo path constraints instead of adding duplicates;
3. confirm email verification is mandatory, anonymous sign-in is disabled, the provider password minimum matches Studio's 12-character rule, and the exact production `/login/` signup/recovery redirects are allowlisted; separately choose production signup rate-limit/CAPTCHA controls;
4. resolve the verified Auth user UUID for `hello@hiperhaus.com.au`, then designate that UUID in `studio_platform_admins` and identify the exact workspace UUID used for initial approvals; the email choice alone never grants access and is not a client-side authorization rule;
5. deploy the login, auth-gate and routing-middleware code while retaining Vercel all-deployments SSO;
6. prove approved, pending, suspended, expired, password-recovery, logout/back-navigation, last-manager and cross-company project/storage denial against synthetic accounts on the real provider; run the database security/performance advisors; and
7. only then decide whether to remove Vercel SSO from the customer-facing production alias.

The proposed migration now executes successfully in a disposable local Supabase/Postgres 17 stack after a test-only fixture supplies the legacy `profiles` and `companies` tables that predate the Studio migrations. Forty-seven pgTAP assertions, real local Storage API checks, schema lint and database advisors pass. The exercise found and corrected a null-role authorization bypass in two security-definer administration functions. This is strong local evidence, not proof of the existing hosted schema, provider email flow or Vercel runtime. Production review must still preflight the actual legacy tables/data and execute the real-provider scenarios above before the Vercel gate changes.

The exact rollout and guarded rollback are recorded in `docs/14-customer-access-rollout-runbook.md`. Read-only production triage found legacy shared-schema exposure that is not part of the Studio migration but is reachable through the same public Supabase API: `admin_members` exposes cross-user account and credit fields to any authenticated user, and several credit-changing security-definer functions are executable by anonymous callers without binding the target IDs or claimed administrator to `auth.uid()`. The Studio customer UI must not be made public, and Vercel SSO must not be removed, until those shared-backend findings have a separately authorised owner and remediation. No unrelated legacy object is changed by this work.

No migration, auth-provider setting, user, password, invitation, role, production access policy or Vercel protection has been changed by the local implementation.
