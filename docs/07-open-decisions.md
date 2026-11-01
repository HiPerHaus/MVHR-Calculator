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

## Engineering validation and product evidence — 1 November 2026

The local engineering branch now has a deterministic design-flow network calculation, but production use remains gated. Before any issued engineering output, choose and review the authoritative airflow design rules and mode profiles for the intended jurisdiction; validate the Darcy/roughness treatment for each supported duct family; digitise or import manufacturer pressure data for the exact DN90, EPP, manifold, valve, grille, attenuator and filter articles; and verify article-specific unit fan curves and filter conditions. The generic test curves and losses are algorithm fixtures only and must never populate the product catalogue.

The first engine evaluates pressure at explicit design allocations. It can also show one separately evidenced, bounded intersection between a unit fan curve and a supplied whole-system pressure curve; it does not derive that system curve from a nonlinear network solution. It does not yet predict achieved terminal airflow, optimise balancing valve settings, calculate acoustics, or replace commissioning. Decide whether those capabilities are required before detailed-design release and identify the accountable engineering reviewer and acceptance tolerances.

The current engine still deliberately blocks rectangular laminar flow, transitional friction, general loop-network solution and unequal flow sharing that lacks two explicit verified branch curves. Those require explicit reviewed methods rather than hidden defaults. Multiple units are assessed only when each terminal and outdoor boundary resolves uniquely to one unit. Older placed multi-port catalogue snapshots without explicit engineering passages also remain unassessed until their topology is reviewed or the component is deliberately replaced; visual/role similarity cannot infer an internal passage.

The reviewed Australian Q350/Q450/Q600 tables currently available are operating observations, not verified max-speed fan curves with an approved interpolation domain. The ComfoTube document identifies a legacy article as 74 mm internal / 90 mm outside diameter but has conflicting title/version cues; Flow 90 is a different article. The available CW420 graph is configuration-specific, and the Luna evidence is adjustment/filter-specific. None of these observations automatically populate engineering inputs. Exact product, article, configuration, filter state, internal geometry, roughness and pressure evidence remain required.
