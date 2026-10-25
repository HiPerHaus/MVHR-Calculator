# Legacy shared-schema security review

**Status:** read-only hosted inspection plus disposable local reproduction. The SQL in `supabase/proposals/legacy_shared_schema_hardening.sql` is deliberately not a migration and authorizes no production change.

## Verified hosted surface

The hosted project is `MVHR calculator` (`qlmnykpwvkckxcycqhpp`). All functions below are owned by `postgres`, use `SECURITY DEFINER`, and are exposed through the same Supabase Data API used by Studio.

| Exact signature | Return | Current execution grants | Internal authorization finding |
| --- | --- | --- | --- |
| `public.add_credits(uuid,integer,text,text)` | `integer` | `PUBLIC`, `anon`, `authenticated`, `service_role` | No caller check; trusts target user, signed amount and payment ID. |
| `public.add_credits_to_company(uuid,uuid,integer,text,text)` | `integer` | `PUBLIC`, `anon`, `authenticated`, `service_role` | No caller check; trusts company, purchaser, signed amount and payment ID. |
| `public.deduct_credits(uuid,integer,text,uuid)` | `integer` | `PUBLIC`, `anon`, `authenticated`, `service_role` | No caller or positive-amount check; trusts target user. |
| `public.deduct_credits(uuid,integer,text,uuid,text)` | `integer` | `PUBLIC`, `anon`, `authenticated`, `service_role` | No caller or positive-amount check; can target a user's company pool. |
| `public.gift_credits(uuid,uuid,integer,text)` | `integer` | `PUBLIC`, `anon`, `authenticated`, `service_role` | Checks the supplied administrator ID, not `auth.uid()`; a known admin ID can be claimed by another caller. |
| `public.get_credit_balance(uuid)` | `jsonb` | `PUBLIC`, `anon`, `authenticated`, `service_role` | No caller check; accepts any target user and can return company identity and balance. |
| `public.is_admin()` | `boolean` | `PUBLIC`, `anon`, `authenticated`, `service_role` | Correctly binds the lookup to `auth.uid()`, but has an unfixed search path. |
| `public.my_company_id()` | `uuid` | `PUBLIC`, `anon`, `authenticated`, `service_role` | Correctly binds the lookup to `auth.uid()`, but has an unfixed search path. |
| `public.my_company_role()` | `text` | `PUBLIC`, `anon`, `authenticated`, `service_role` | Correctly binds the lookup to `auth.uid()`, but has an unfixed search path. |
| `public.handle_new_user()` | `trigger` | `PUBLIC`, `anon`, `authenticated`, `service_role` | Active `auth.users` trigger; direct invocation is not a useful data-changing RPC because PostgreSQL rejects direct calls to trigger functions. |
| `public.portal_consume_magic_token(text)` | table of portal user/session token | `anon`, `authenticated`, `service_role` (not `PUBLIC`) | Possession-token authorization; row lock, expiry and single-use checks are present. Anonymous execution appears intentional. |

`public.admin_members` is owned by `postgres`, has no `security_invoker` option, and grants `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` and `TRIGGER` to both `authenticated` and `service_role`. It reads `profiles`, `projects` and `credit_transactions`. Its useful exposure is `SELECT`: owner execution bypasses the RLS policies on those base tables and returns account, company, credit, plan/admin and aggregate-count fields for every profile. The additional view grants are unnecessary even where PostgreSQL cannot make the view writable.

## Dependencies and observed use

- `is_admin()` is referenced by 22 hosted RLS policies.
- `my_company_id()` is referenced by four hosted RLS policies.
- `my_company_role()` is referenced by one hosted RLS policy.
- `handle_new_user()` is the enabled `on_auth_user_created` trigger on `auth.users`.
- `admin_members` depends on `profiles`, `projects` and `credit_transactions`.
- No current HiPer Studio source file calls any reviewed legacy view or RPC. Studio signup does, however, activate the existing `handle_new_user` trigger indirectly when Auth inserts a user.
- No other database routine or view was found to call the credit RPCs. The hosted migration ledger contains policies using the three RLS helpers, but does not contain the original credit/view definitions, so their originating application migration is not recoverable from that ledger.
- A read-only search of the last 24 hours of hosted unified log messages found no event text naming the reviewed view/RPCs. That is not proof of non-use: API logs may not retain or expose every object name, and another legacy client may call them outside that window.

## Evidence boundary

The hosted grants, definitions and dependency graph prove that the RPCs/view are reachable to the stated roles. No mutating hosted RPC was invoked, no hosted customer row was selected through `admin_members`, and this review found no evidence that anyone exploited the exposure.

The disposable local test fixture reproduces the hosted authorization logic with synthetic identities. Before hardening it proves that an anonymous role can change another synthetic user's credits, spoof a supplied administrator ID, turn a negative deduction into an increase, and read an arbitrary balance; an ordinary authenticated role can read all synthetic `admin_members` rows. These are local demonstrations of what the definitions permit, not production incident evidence.

## Minimal proposed remediation

The proposal is intentionally compatibility-first:

1. Revoke `PUBLIC`, `anon` and `authenticated` execution from the six credit mutation/read signatures; retain `service_role` execution only. Existing payment/design/admin operations must move behind server code that validates the authenticated actor, provider event and positive amount before using the service role.
2. Revoke every browser grant on `admin_members`, retain `service_role SELECT`, and enable `security_invoker`. A replacement server-admin endpoint must verify platform administration before returning a bounded field set.
3. Retain authenticated/service-role execution for the three caller-bound RLS helpers, revoke `PUBLIC`/`anon`, and fix their search paths. This preserves all 27 policy dependencies.
4. Revoke direct client execution of `handle_new_user` while retaining the enabled Auth trigger; fix its search path.
5. Retain explicit `anon`, `authenticated` and `service_role` execution for the single-use portal token exchange, remove only any broad `PUBLIC` grant, and fix its search path. The portal remains a separately reviewed possession-token surface.

The proposal does not alter function bodies, ledger data, RLS policies, portal token semantics or default privileges. That keeps the first change small, but the credit bodies still accept signed amounts and arbitrary IDs when called by privileged server code; follow-up body validation is required when each server caller is identified.

## Action-time approval bundle

Before applying anything, identify the owner of every legacy web/server client and confirm whether it directly calls the six credit signatures or selects `admin_members`. The approval must name project `qlmnykpwvkckxcycqhpp` and authorize these exact changes:

- browser execution removed from the six credit/read signatures listed above; `service_role` retained;
- all browser privileges removed from `public.admin_members`; `service_role SELECT` retained and the view changed to `security_invoker`;
- `PUBLIC`/anonymous execution removed from the three RLS helpers while authenticated/service-role execution remains;
- direct client execution removed from `handle_new_user` while `on_auth_user_created` remains enabled;
- token exchange remains explicitly executable by `anon`, `authenticated` and `service_role`.

Expected compatibility risk: any legacy browser that directly purchases, spends, gifts or displays credits through these RPCs will fail until its server replacement is deployed; any browser admin screen selecting `admin_members` will fail. RLS-backed ordinary data access, signup profile creation and portal token login should remain functional. Keep Vercel SSO enabled, record a current database backup, deploy server replacements first, apply the reviewed grant change in one maintenance window, run controlled synthetic hosted checks, re-run advisors, and roll back grants immediately if an identified legacy client was missed. No approval to perform those actions exists yet.

## Local verification

Run `npm run check:supabase-legacy-proposal` with Docker Desktop available. It creates an unlinked disposable Supabase/Postgres stack, runs 14 pre-hardening exposure assertions, resets with the proposal applied, runs 29 post-hardening assertions and schema lint, then removes the stack. It does not connect to or invoke the hosted Data API.
