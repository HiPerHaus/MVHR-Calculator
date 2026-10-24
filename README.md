# HiPer Studio

Manual MVHR layout workspace for Passive House design development.

## Develop

Run `npm ci`, then `npm run dev`. Open the localhost address shown in the terminal.

## Check and build

Run `npm run check` and `npm run build`. Vercel publishes only `dist/`. PDF reference import uses the pinned PDF.js dependency; private reference manuals and local drawings are not included.

## Project files

Projects opens saved cloud drawings and includes Import for portable backups. Save updates the signed-in workspace; Export backup creates a portable file. Localhost and hosted addresses have separate browser storage; export from localhost and import on the hosted site to transfer a drawing.

This is a design-development workspace. Product drawings and route quantities do not establish commissioning, installation compatibility or engineering approval.

## Previous application

The previous application is preserved on `backup/pre-studio-v2-2026-10-23`, at commit `fc344988420b94faa81214d5199243cb65546b7c`. This update keeps the existing repository history.

## Sign-in and cloud drawings

Use **Sign in** with an existing invited MVHR account. **Save** stores a complete drawing file (including embedded floor-plan references) in a private Supabase Storage bucket in the existing Sydney project. Project names, workspace membership and save versions are stored in Postgres. **Projects** reopens a drawing on another signed-in device. Cloud access is checked by row-level security, not by imported project content or editable user metadata.

Cloud saving is explicit: wait for **Saved to cloud** before closing the tab. Another tab's newer save blocks stale overwrites; use Projects to reopen the latest version or Save As to preserve a separate copy. Export project remains a portable backup. Device-local projects remain separate and are never automatically uploaded. There is no public registration interface.

Workspace memberships are server-managed. The migration bootstraps only existing accounts; an administrator must add membership for any later invited account. Existing accounts without a company receive a private workspace. Cloud files use unique paths; previous uploads remain available for recovery, and no automatic retention/deletion policy is applied in this first rollout.

## Drawing sheets and company branding

The A3 sheet uses a full-height marked-up plan with a right-hand symbol key above the title block. Project → Project details supplies the project name, reference, client and site address; apply changes and save the drawing. These details travel with exported and cloud-saved drawings. Older drawings open with blank details until entered.

Account contains workspace company details, primary contact and a PNG/JPEG logo (up to 2 MB). Workspace owners can save branding; members can view it. Branding is private to the workspace and fills new sheet previews. Refresh the sheet preview after changing details. The sheet remains a preliminary working draft, not an issued construction drawing.

Sheets includes the A3 marked-up drawing followed by an A4 parts list, with A4 continuation pages when needed. Print sheets uses separate A3 landscape and A4 portrait page definitions. The list includes placed equipment, measured duct routes, EPP stock/bend/sleeve allowances and radial accessories. Every CW branch receives one O-ring; unused branches receive one pipe stub and cap. Connected 90 mm TVA/Luna and Aerofresh ducts receive an O-ring per duct. Each unused CW branch allows a 100 mm pipe stub; the additional pipe length is listed separately from drawn duct routes. Unknown Single/Twin quantities remain pending.


## Continue the current drawing

Refresh restores the current drawing, project name, view and camera from an IndexedDB working copy, including committed edits that have not yet been saved to the cloud. Each browser tab keeps its own working drawing; a new tab can continue the latest working drawing for the same account/workspace. Recovery is separate from cloud saving and never advances a cloud save version. A stale cloud binding still uses the normal conflict check. If browser recovery is unavailable, the app reports it and guards leaving with unprotected changes. Incomplete pointer operations and undo history are not restored.

Private working copies restore only after sign-in and workspace membership resolve for the same account. On a first visit without browser recovery, the most recently saved cloud drawing updated by that user is reopened. Auth refresh/focus notifications for the same signed-in account do not replace the active drawing. The Projects box includes Import and a collapsed older-device-drawings section only where existing copies need access; new local-copy save controls are hidden. Existing device saves are preserved.
