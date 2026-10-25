# Customer-access rollout runbook

**Status:** proposed and locally verified; no production action is authorised by this document.

## Fixed targets

- Supabase project: `MVHR calculator`, project ref `qlmnykpwvkckxcycqhpp`, Sydney region.
- Vercel project: `mvhr-calculator`, project ID `prj_iWpNvlxM5nMz4ayWDn0bhQW2RA1A`.
- Canonical production origin: `https://www.hiper-studio.au`.
- Vercel all-deployments SSO remains enabled throughout migration, deployment and real-provider verification.
- The selected initial platform-administrator email has one verified, unbanned Auth identity and an existing owner membership. Resolve and reverify its UUID at action time; never encode email-based promotion in application or database logic.

## Proven database baseline

Production currently has two Auth users, two Studio workspaces, two memberships, one Studio project and five objects in the private `studio-drawings` bucket. Project, previous-project and company-logo paths have no detected workspace mismatch, and no orphaned membership was found.

The first two local migration files are byte-identical to production history and use its exact versions:

- `20261023123857_studio_cloud_workspace.sql` — SHA-256 `883fd0ec71728c2dae0723ecf7a28c51c4bd8e7a50148f225d8bdf1b450d3f04`.
- `20261024015157_studio_company_profiles.sql` — SHA-256 `84779e66e7f9fca99266f139825e575715e30b30b7aa51ca309248e79ee228f7`.

Do not repair production migration history and do not run a blind `supabase db push`. Apply only the reviewed new customer-access migration after a dry comparison shows those two baseline versions aligned.

## Shared-schema blocker outside Studio

**Resolved 25 October 2026:** the separately approved `legacy_shared_schema_hardening` migration removed browser access to the six reviewed credit/balance signatures and `admin_members`, retained the reviewed RLS helpers, signup trigger and portal exchange, and fixed their search paths. The post-change grants, trigger, policy dependencies and security advisors were checked without invoking a hosted mutation RPC. This prerequisite no longer blocks the customer-access rollout; the remaining Auth, customer migration, administrator assignment, application deployment and gate-removal actions stay separately gated.

The following findings describe the pre-hardening state retained for audit history:

- `public.admin_members` is selectable by every authenticated user and bypasses underlying RLS as a definer view. It returns all profile emails, names, company names, credit balances, plan/admin state and aggregate project/transaction counts.
- `add_credits`, both `deduct_credits` overloads and `add_credits_to_company` are security-definer functions executable by `anon` and `authenticated`; they accept arbitrary target IDs and amounts without binding the caller to `auth.uid()`.
- `gift_credits` trusts a caller-supplied administrator ID rather than the authenticated identity.
- `get_credit_balance` accepts an arbitrary user ID and can reveal balance/company information.
- `is_admin`, `my_company_id` and `my_company_role` are read-only and bind lookup to `auth.uid()`, but still have unnecessary public execution and mutable search paths.
- `handle_new_user` is the existing Auth trigger that creates a legacy profile for every signup. Direct RPC execution of a trigger function is not useful, but its grant should be tightened and its coexistence with Studio access requests reviewed.
- `portal_consume_magic_token` appears to be an intentionally anonymous, single-use portal-token exchange with a fixed search path. It needs portal-owner review rather than a blanket revoke.

The Studio code does not call these views or RPCs. That does not remove the risk: the Supabase API and publishable key are public, and Vercel protection does not protect direct Supabase endpoints.

The exact signatures, grants, database dependencies, non-production reproduction and non-deployable remediation proposal are recorded in `docs/15-legacy-shared-schema-security-review.md`.

## Proposed Auth settings

The public settings endpoint already confirms email/password signup enabled, email confirmation required, anonymous Auth sign-in disabled and automatic email confirmation disabled. Keep those values.

Set or verify at the action window:

| Setting | Proposed value | Status or decision |
| --- | --- | --- |
| Site URL | `https://www.hiper-studio.au` | Dashboard currently has the apex `https://hiper-studio.au`; change to the canonical `www` origin during the reviewed action window. |
| Additional redirect URL | `https://www.hiper-studio.au/login/?recovery=1` | Missing. Add this exact URL: Supabase `*` does not cross the second `/` in `/login/`, so the existing `https://www.hiper-studio.au/*` pattern does not cover this callback. Retain existing entries until all legitimate flows are verified. |
| Minimum password length | 12 | Must match the 12–72 character client contract. |
| Required character classes | No change until explicitly chosen | A stronger provider rule needs matching UI validation and copy. |
| Leaked-password protection | Enabled | Dashboard confirms disabled. This is a separate plan-dependent Auth setting; do not claim it is active. |
| Email confirmation | Required | Already verified enabled. |
| Anonymous users | Disabled | Already verified disabled. |
| OTP expiry | 3600 seconds or less | Verify; Supabase recommends one hour or less. |
| Custom SMTP | Keep current configuration | Dashboard confirms enabled Resend SMTP, sender `hello@hiper-studio.au`, display name `HiPer Studio`, port 465 and a stored masked password. Configuration does not prove live delivery; verify later with an approved synthetic address while SSO remains enabled. |
| Email rate limit | Start at the custom-SMTP default unless expected launch volume exceeds it | Owner must state expected signup/recovery volume. |
| CAPTCHA | Keep disabled until provider setup is tested | Dashboard confirms disabled. The local client now has a disabled-by-default injectable Turnstile/hCaptcha boundary for sign-in, signup and recovery. Choose one provider, add its public widget/site key and test token delivery before enabling the Supabase secret. No key or provider script is currently stored. |

## Controlled rollout

1. Keep Vercel SSO enabled. Confirm the current production deployment remains the rollback target.
2. In Supabase Database Backups, record the timestamp and status of the latest usable backup. Database backup entitlement is not evidence that a current snapshot succeeded.
3. Record a manifest for the five current Studio Storage objects and establish a file-byte recovery method; database backups contain Storage metadata, not object bytes.
4. Compare local and hosted migration history. Stop if the two baseline versions or hashes differ.
5. Apply only `20261024143000_studio_customer_access.sql`. Do not include seeds and do not alter unrelated schemas.
6. Immediately verify table/column/function existence, existing membership `active` backfill, row counts, path constraints, RLS policies, function grants and security advisors.
7. Resolve the selected verified administrator identity again, then insert that UUID into `studio_platform_admins` as a separate reviewed operation. Email text never grants the role.
8. Apply only the reviewed Auth settings above. Record old and new values for rollback. Do not enable CAPTCHA until client support exists.
9. Deploy the tested application while SSO remains enabled. Verify middleware redirects, the public login shell, session gate and no-store headers on the exact production deployment.
10. Use controlled synthetic accounts on the hosted provider to test pending, verified, approved, suspended, recovery, expiry, logout/back navigation, last-manager protection and cross-workspace project/Storage denial. Do not use customer accounts or drawings.
11. Re-run database security and performance advisors and inspect Auth, API and Storage logs for the test window.
12. Only after the shared-schema blocker is remediated and CAPTCHA/email delivery decisions are complete may the owner separately approve removing Vercel SSO.

## Guarded rollback

The checked-in rollback is `supabase/rollbacks/20261024143000_studio_customer_access.rollback.sql`. It is locally proven against the exact forward migration. It restores the previous policies and membership schema while preserving existing Studio workspaces, memberships, projects, company details and path constraints.

Use it only during the initial gated window. It deliberately aborts when there is a suspended membership, a workspace `admin` role or any access request. Those states contain post-cutover intent and require a data-preserving incident decision instead of automatic rollback. Keep Vercel SSO enabled, roll the application back to the recorded production deployment, and separately restore Auth settings from the action log. A database restore is the fallback if forward changes cannot be safely reversed; Storage object bytes require their separate recovery process.

## Local evidence

`npm run check:supabase-local` uses an unlinked disposable stack and verifies production migration versions/hashes, the forward migration, 47 pgTAP authorization assertions, schema lint, database advisors, real Storage API isolation/suspension and 25 assertions executing the actual rollback file. `npm run check:supabase-legacy-proposal` separately runs 14 synthetic exposure assertions, 29 post-hardening assertions and schema lint without invoking a hosted RPC. On the same final tree, `npm run check` passes 400 tests across 162 checked modules and `npm run build` succeeds. These local results do not replace the real-provider rollout checks above.
