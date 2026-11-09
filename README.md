# HiPer Studio

Manual MVHR layout workspace for Passive House design development.

## Develop

Run `npm ci`, then `npm run dev`. Open the localhost address shown in the terminal.

## Check and build

Run `npm run check` and `npm run build`. With Docker Desktop running, `npm run check:supabase-local` creates an unlinked disposable Supabase stack, verifies the production migration timestamps and hashes, applies the proposed migrations over a test-only legacy-schema fixture, runs database and Storage API authorization checks, proves the guarded rollback, then destroys the stack. Vercel publishes only `dist/`. PDF reference import uses the pinned PDF.js dependency; private reference manuals and local drawings are not included.

`npm run check:supabase-legacy-proposal` separately reproduces the legacy shared-schema exposure with synthetic records, applies the non-deployable hardening proposal in a disposable stack and verifies the retained RLS-helper, Auth-trigger and portal-token behaviour. It never invokes a hosted credit RPC.

## Project files

Projects opens saved cloud drawings and includes Import for portable backups. Save updates the signed-in workspace; Export backup creates a portable file. Localhost and hosted addresses have separate browser storage; export from localhost and import on the hosted site to transfer a drawing.

This is a design-development workspace. Product drawings and route quantities do not establish commissioning, installation compatibility or engineering approval.

## Previous application

The previous application is preserved on `backup/pre-studio-v2-2026-10-23`, at commit `fc344988420b94faa81214d5199243cb65546b7c`. This update keeps the existing repository history.

## Sign-in and cloud drawings

This checkout contains the locally tested customer-access candidate. Anonymous requests to the editor HTML are redirected by a Vercel request gate, and the editor is imported only after Supabase has network-verified the session and returned an active workspace membership. A short-lived HTTP-only gate cookie protects editor entry; Postgres and Storage RLS remain authoritative for every private drawing and company record.

Customers can request an account with email, password, name and company. New accounts remain pending after email verification until a platform administrator assigns an active workspace and a bounded `member` or `admin` role. Account metadata cannot assign a role or workspace. Company owners/admins can suspend or reactivate roles beneath their own role; suspension is recoverable and removes all project/company/storage access. Password recovery uses the existing Supabase flow. Existing workspace members migrate as active and are not converted to pending.

Cloud saving is explicit: wait for **Saved to cloud** before closing the tab. Another tab's newer save blocks stale overwrites; use Projects to reopen the latest version or Save As to preserve a separate copy. Export project remains a portable backup. Device-local projects remain separate and are never automatically uploaded. The public signup interface creates a pending access request only and never opens a workspace without verified-email approval.

Workspace memberships remain server-managed. Self-service signup creates only a pending request; approval and suspension use security-definer RPCs that validate platform or workspace administration on the server. Cloud files use unique paths; previous uploads remain available for recovery, and no automatic retention/deletion policy is applied in this first rollout.

Production rollout is deliberately pending. The proposed migration, verified-email setting, recovery redirect allowlist, first platform-administrator assignment, Vercel request gate and deployment must be reviewed and applied together. Until that exact rollout is approved and verified, the existing Vercel all-deployments SSO protection stays enabled and unchanged.

The proposed production sequence, exact Auth settings, rollback boundary and unresolved shared-schema security findings are recorded in `docs/14-customer-access-rollout-runbook.md`. The runbook is planning evidence only and authorizes no live change.

## Drawing sheets and company branding

The A3 sheet uses a marked-up plan above a dedicated dimension-detail band, with a right-hand symbol key above the title block. TVA and AeroFresh terminal housing sections appear on each plan. Exact matching Q/CW320 and AeroFresh/CW520 assemblies receive their supplied envelope references; unmatched assemblies and unreadable wiring sources remain explicitly pending. The plan scale is recalculated to fit the available space. Project → Project details supplies the project name, reference, client and site address; apply changes and save the drawing. These details travel with exported and cloud-saved drawings. Older drawings open with blank details until entered.

Account contains workspace company details, primary contact and a PNG/JPEG logo (up to 2 MB). Workspace owners can save branding; members can view it. Branding is private to the workspace and fills new sheet previews. Refresh the sheet preview after changing details. The sheet remains a preliminary working draft, not an issued construction drawing.

Sheets includes the A3 marked-up drawing followed by an A4 parts list, with A4 continuation pages when needed. Print sheets uses separate A3 landscape and A4 portrait page definitions. The list includes placed equipment, measured duct routes, EPP stock/bend/sleeve allowances and radial accessories. Every CW branch receives one O-ring; unused branches receive one pipe stub and cap. Connected 90 mm TVA/Luna and Aerofresh ducts receive an O-ring per duct. Each unused CW branch allows a 100 mm pipe stub, included in the project-wide 90 mm duct total before rounding up to 50 m coils. Unknown Single/Twin quantities remain pending.


## Continue the current drawing

Refresh restores the current drawing, project name, view and camera from an IndexedDB working copy, including committed edits that have not yet been saved to the cloud. Each browser tab keeps its own working drawing; a new tab can continue the latest working drawing for the same account/workspace. Recovery is separate from cloud saving and never advances a cloud save version. A stale cloud binding still uses the normal conflict check. If browser recovery is unavailable, the app reports it and guards leaving with unprotected changes. Incomplete pointer operations and undo history are not restored.

Private working copies restore only after sign-in and workspace membership resolve for the same account. On a first visit without browser recovery, the most recently saved cloud drawing updated by that user is reopened. Auth refresh/focus notifications for the same signed-in account do not replace the active drawing. The Projects box includes Import and a collapsed older-device-drawings section only where existing copies need access; new local-copy save controls are hidden. Existing device saves are preserved.


Standard project allowances include HRV-DRAIN per HRV, PLU-SURGE per eligible HRV (excluded from Q450/Q600), and ZEN-CCPRO plus ZEN-OPTBOX per Q-series unit only. Unit-mounted CW modules and branch plates are listed separately; known CW320 Q-series mounting sets are included. Unknown product codes remain explicitly unselected. ZEN-C90-CSET is three per job. Extract filters use one per extract point and round to ten-filter bags; ZEN-OR90 rounds required O-rings to ten-ring packs. These job totals appear once, on the first floor containing ventilation. DN90 supply/extract route lengths and 100 mm unused-CW stubs combine into one total, followed by ZEN-CT90-50M coil quantity rounded upward. Pending Single/Twin choices stay pending. No prices or private estimate files are published.

## Spreadsheet parts handoff

Export → **Export parts CSV** downloads an Excel-compatible UTF-8 table for the active design option across all floors. Project packs and allowances appear once, with explicit quantity bases, working revision and floor labels. Measured duct/cable lengths, assembly references, cut pieces already included in stock and unresolved items are labelled separately to avoid double counting. Pending quantities are not zero, and no prices are added. Select each design option separately to export independent alternatives. This preliminary handoff does not establish product compatibility or authorize an order.

## Drawing workspace

Plan, Draw, Check and Export share the same project. Draw combines equipment placement and routing. Centralised tools include HRVs, ComfoWell, terminals, manual ducts and a collapsible Auto route panel. Decentralised tools include wall units and controllers; select a placed unit to set pairing and controller cables. Combined exposes both toolsets, including manual ducts, Auto route, wall units and controller guidance. Mixed projects default to Combined unless a tool tab was already saved. Search stays within the active tool tab, or searches both systems in Combined. Switching tabs changes tools only: both systems stay visible on the same plan and remain included in checks, parts lists and exports, including mixed designs. Project type remains an explicit choice in Project details.

The active tool tab is restored with the browser working copy. Older Place and Route views reopen in Draw without changing the saved model. Floor actions are explicitly labelled as applying to both systems.
