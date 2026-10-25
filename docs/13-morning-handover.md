# Morning handover — reviewed overnight baseline

## 20 October PDF crop increment

- The PDF workflow is now page selection → optional nondestructive crop → two-point calibration → serviced perimeter → MVHR markup. Plan exposes clear Crop/Adjust/Reset/Cancel controls; notes and title blocks outside the rectangle are hidden without replacing or stretching the page.
- Schema 19 persists a bounded page-relative source-pixel crop through named save/reopen, canonical/portable project data and A3 working-draft output. Existing schema-18 projects migrate with no crop and retain full-page behaviour. Recropping does not change calibration, reference placement, walls, outlines, rooms, equipment or routes. Internal masking remains deferred.
- `node scripts/check.mjs` passes 258 tests across 81 verified modules. A fresh-profile browser pass on `127.0.0.1:4173` verified zoom-aware selection, invalid-crop rejection, safe cancellation, crop before calibration, adjustment after perimeter/equipment markup, undo/redo, reset/undo, save/reopen and A3 clip output with no application exception. The user's saved drawing was not opened or changed.
- The existing localhost-only preview on `http://127.0.0.1:4173/app/` responds with HTTP 200 and serves the updated files.

## 20 October primary-source pressure-evidence close-out

- Current ComfoTube Flow 90 evidence now identifies article `990328101` for the 50 m roll, 90/77 mm outside/inside diameters, and 45 m³/h at 2.7 m/s as the recommended normal-ventilation maximum. The local SKU crosswalk is still unverified and the candidate is not placeable.
- The ComfoTube Flow pressure graph has no tabulated values. The ComfoWell 320 pressure graph also has no tabulated values and is labelled for CW-S 320 with a DN150 end plate rather than the named DN160/6 × 90 chain. Neither is used for calculation.
- Q350 page-8 airflow/pressure pairs are retained only as sound-test conditions, not as a fan curve. No real pressure or network calculation capability changed.
- Remaining exact evidence gaps are a tabular current Flow 90 pressure dataset, a matching ComfoWell chain dataset, an article-specific Q350 fan curve with stated conditions, and an approved interpolation/review method. Independent QA remains available without those inputs.
- `node scripts/check.mjs` passes 256 tests across 81 verified modules.

## 20 October manufacturer-duty/costing/installer foundations — current status

- Current domain schema is version 18. A floor may store a selected placed MVHR unit and externally derived Normal external-static duty in Pa with basis, source and filter condition. This is a design input, not a network-pressure result.
- Q350 screening uses the official 350 m³/h at 200 Pa and 40 m³/h at 10 Pa statements only for sensible article 471502110. Page 7 explicitly names that article; the reviewed pages do not explicitly bind the minimum statement to enthalpy article 471502111, so that interpretation is blocked. Above-350 m³/h input blocks against the published maximum; every other pair requires a checked fan curve and bounded interpolation. Exact alignment remains review-required and is not whole-network suitability.
- Network pressure stays blank because exact route-product curves, elevations, fittings and placed terminal/attenuator losses are incomplete. Generic dimensions and visual sweeps are never converted into resistance.
- Costing readiness retains model quantities but has no prices or total. The installer foundation retains airflow/material/evidence sections and starts predicted, measured and commissioning fields blank; it is not an issued installer document.
- The current complete suite passes 256 tests across 81 verified modules. Fresh-profile QA passed against the restored `127.0.0.1:4173` preview for the integrated PDF → calibration → perimeter → no-room markup → named save/reopen → rooms/manual airflow → Checks → A3 working-draft flow, plus separate airflow and engineering regressions. No application exception occurred and the user's browser storage was not accessed.
- Next evidence gates are checked manufacturer curves/loss data for exact selected products, an approved calculation method and technical-review scope, authorized regional prices/cost permissions, and snapshot/issue policy.

## 20 October room airflow/balance — current status

- Current domain schema is version 17. Rooms and child zones carry distinct required and assigned Normal airflow targets; known targets retain their entered L/s or m³/h value, canonical L/s, basis and source. Schema-16 files migrate with unresolved targets and retain all earlier plan, quote, project-library and PDF provenance.
- Terminal assignment displays the containing room/zone label automatically. Movement or reassignment changes coverage, not the saved target. The room editor's required-to-assigned helper is a user-applied form action; Cancel changes nothing.
- Checks reports per-space evidence, supply/extract subtotals and supply-minus-extract arithmetic, plus missing targets and unmatched terminals. It does not infer a regulatory rate, multi-terminal split, balance tolerance, compliance conclusion, pressure result or equipment change.
- Terminal demand and route arrangement are selected as Single duct or Twin duct; ordinary authoring has no free run-number entry, while legacy/custom saved counts remain readable.
- `node scripts/check.mjs` passes 247 tests across 75 modules. Isolated browser QA passed on `127.0.0.1:4195` with no application exception; the temporary server was stopped and the normal 4173 draft was not opened or changed.
- The next separately gated engineering increment is manufacturer-backed capacity and pressure sizing. It must not reuse these arithmetic totals as proof of product suitability.

## 20 October connection/accessory evidence — current status

- Catalogue `2026-10-20.6` and v3 generic remote constituent snapshots pin provenance more precisely: synthetic fixture evidence owns logical ports/topology; the official ComfoWell 320 source owns only the recorded drawing envelopes. New Q350 snapshots also pin article candidate, local crosswalk status and handing. Existing saved geometry and EPP endpoints are unchanged.
- Checks now inspects every saved route and direct joint and displays pinned source IDs, known dimensions, typed service/interface evidence and the remaining installation decisions. Drawing-only, synthetic, incomplete and explicit-transition states remain distinct.
- Missing adapter/sleeve decision, mating profile, seal, support, access, connector configuration, local product crosswalk, exact synthetic-assembly product selection and acoustic duty are visible. The derived result contains no accessory item, quantity or price.
- Focused catalogue, assembly, schedule, Q350 EPP and evidence tests pass; the complete check passes 242 tests across 72 modules. An isolated `127.0.0.1:4194` browser pass showed one drawing-only Q350 route and two synthetic assembly joints with no runtime exception; the live 4173 draft was not opened or changed.
- DEC03 remains open. The next separately tested increment is room airflow and supply/extract balance using an explicitly approved method and inputs; no regulatory rate or default value may be invented.

## 20 October staged quote-to-design workflow — current status

- Schema 15 and the enabled **Project** workspace provide Quick quote, Preliminary layout, Converted project and Detailed design stages. A serviced-area outline and reviewed exclusions are required for conversion; rooms and airflow are not required for a preliminary quote/layout.
- The Project workspace links directly to Upload floor plan, Set scale, Draw external perimeter and Mark up MVHR system. It exposes no price-per-m², allowance or percentage-markup form. One explicit conversion freezes the area basis and preliminary layout counts; later edits cannot rewrite that baseline.
- Detailed design can explicitly link existing unassigned outlets to exactly one compatible containing room/zone and shows count differences from the preliminary baseline. Airflow/manufacturer rules remain unresolved.
- Isolated headless Chrome QA on `127.0.0.1:4193` verified the four direct actions, no pricing controls, an 8.75 m² manual serviced outline, room-free preliminary markup, converted layout baseline and device-local reopen. Set scale remained disabled until upload as intended. Browser upload/calibration was not exercised; automated two-point calibration coverage remains green. The `4173` saved draft was not opened or changed.

## 20 October Q350 handed drawing profiles — current status

- Official Q350 TR dimensional and air-direction pages now support four exact plan centres and both handed role maps for drawing topology. Catalogue `2026-10-20.3` adds explicit sensible/enthalpy supply-and-extract-left/right placeable profiles; the older unhanded setouts remain unchanged and non-routable.
- Nominal DN160 routes from these profiles are saved as `drawing-only` with installation compatibility `unverified`. The local `ZEN-Q350HRV/ERV` to manufacturer article 471502110/111 crosswalk is not claimed, and no adapter, seal, support, access or service-clearance approval is inferred.
- Official ComfoWell documentation confirms articles 990323644/501/613/512 and the CW-K 320 designation for Q350/450 TR. A real branded direct or remote assembly is still blocked by the local-code crosswalk, authored constituent topology, exact remote plate centres, mating chain, field configuration and clearance evidence.
- The official 139 MiB BIM download proved to be one Revit template; no portable Q350/CW320 family or exchange geometry could be extracted with the available read-only tools. It supplied no additional geometry claim.
- `node scripts/check.mjs` passes 172 tests across 50 modules. Isolated browser verification on `127.0.0.1:4192` showed all four handed profiles and the drawing-only warning with no browser warnings/errors and no saved-project mutation. The normal localhost-only shell is running on `127.0.0.1:4173`.

## 20 October Q350/CW320 evidence gate — current status

This earlier gate snapshot is retained for history and is superseded by the handed drawing-profile update above where the new official evidence closes coordinates and roles for drawing use only.

- The approved workbook and Q350/Q450 setout close additional dimensional facts but do not close the first real connectable system. Q350 now retains four 160 mm inside / 190 mm outside connections plus 280.5 mm row-centre spacing and a 123 mm rear-row offset in catalogue snapshots, while exact local coordinates, coordinate origin and handed air-stream roles remain explicit blockers.
- CW-K320, CW-S320, CW-M320 6 × 90 and CW-P320 DN160 are richer non-placeable evidence candidates. Direct and remote Q350 arrangement queries enumerate missing article/variant crosswalks, port coordinates, mating/adapters, supports, seals and service clearances instead of inventing a kit.
- Schema remains 12 and existing saved projects are not rewritten. `node scripts/check.mjs` passes 170 tests across 50 modules; isolated browser verification on `127.0.0.1:4191` passed with no warning/error logs. The normal 4173 server is running and the saved seven-wall, one-room, locked-PNG draft remained unchanged with zero parts/routes. The next evidence step is a manufacturer drawing/data sheet that establishes the selected regional Q350 article and handed port-role coordinates, plus exact CW320 constituent articles and their mating interfaces for one chosen direct or remote path.

## 20 October live checks increment — current status

- **Checks** is now enabled as a read-only active-floor workspace. It separates actual placed part records from equipment groups, groups routes by declared family with drawing plan length, preserves unknown developed length, and never labels the output as a BOM or engineering result.
- Typed graph diagnostics account for explicit assembly internals, flag missing mains, disconnected outlets, incomplete paths to the correct generic HRV side, unset outlet run counts, free route ends and legacy interface transitions. Unused DN90 manifold branches are shown as spare capacity rather than faults, with no inferred cap treatment.
- Flagged components have **Show on plan** focus. No automatic item, route, price, airflow or approval is created.
- Schema remains version 12. `node scripts/check.mjs` passes 167 tests across 48 modules. Isolated browser verification on `127.0.0.1:4190` passed without warning/error logs. The normal `127.0.0.1:4173` server is running and its saved seven-wall, one-room, locked-PNG draft was loaded read-only with zero parts/routes.

## 20 October generic HRV routing repair — current status

- Root cause: the generic fixture already contained four typed DN160 ports, but they appeared as unlabelled colour dots, while Q350/Q450 body setouts remained placeable despite deliberately having no routable ports. Wrong route-family and occupied-port feedback did not explain availability clearly.
- The generic unit now labels Supply, Extract, Intake and Exhaust with DN160, reports free/connected state and highlights ports compatible with the selected route. The Parts picker explicitly labels Q350/Q450 as setout-only with no routable ports; no branded port geometry was invented.
- The generic tested sequence is DN160 rigid EPP from HRV to separate matching supply/extract remote mains, then DN90 semi-rigid from radial branches to outlets. Wrong roles, occupied ports and declared interface/size mismatches are rejected; adapters are never inferred.
- Schema remains version 12. `node scripts/check.mjs` passes 162 tests across 46 modules, and isolated `127.0.0.1:4189` browser verification passed with no warning/error logs. The normal 4173 server was restarted without clearing or replacing the saved draft.

## 20 October active-floor ventilation clear — current status

- Ventilation now offers a guarded **Clear ventilation on this floor…** action with exact affected counts. It removes only the active floor's ventilation model and dependent terminal associations while preserving walls, rooms, zones, building outline, reference/calibration, camera state and all other floors.
- The clear is one command, so one undo restores the exact prior state and redo reapplies it. Empty floors are disabled/no-op guarded; direct cross-floor connections block instead of being partly deleted.
- Schema remains version 12. `node scripts/check.mjs` passes 160 tests across 45 modules with zero failures, including active-floor preservation, exact undo/redo, portable round-trip and cross-floor blocking. An isolated `127.0.0.1:4187` browser pass verified empty/enabled control states, exact confirmation text and cancellation with no warnings/errors; the normal 4173 draft remained intact and returned HTTP 200.

## 20 October equipment-assembly follow-up — current status

- Current domain schema is version 12. It adds explicit equipment assemblies while preserving schema-11 terminal run counts and all earlier data through sequential migration.
- Ventilation Distribution offers generic remote supply and extract attenuation sets. Each places three assembly-only synthetic parts with two explicit typed internal connections, grouped move/rotation/elevation and a visible provisional service zone. These are workflow fixtures, not real CW kits or compatibility claims.
- `node --test` passes 158 tests with zero failures; syntax checks and `git diff --check` pass.
- An isolated pass on `127.0.0.1:4186` verified placement, group inspection, a 2,400 mm shared elevation, group rotation and device-local reload with no browser warnings/errors. The user's normal 4173 origin was not opened or modified.
- The smallest evidence-dependent next step is to close DEC03 for one real unit-to-remote-attenuator path: exact unit port role/handing, adapter/end-plate interface, selected attenuator and radial plate, support and service-clearance requirements, port capacity and usable manufacturer geometry. Until then, real CW/Q600 kits remain non-placeable.

## 20 October catalogue follow-up — current status

- Current domain schema is version 11. It preserves the schema-10 Building Outline and adds only nullable explicit duct-run intent for eligible supply/extract terminals; schemas 1–11 migrate sequentially without inventing counts.
- The application has a separate read-only Catalogue tab and a compact six-category Parts picker beside the Ventilation drawing. Q600 HRV/ERV records remain non-placeable evidence candidates because the TR/ST variant and physical compatibility are unresolved.
- Explicit per-outlet run counts drive independent supply/extract demand summaries. They do not infer airflow, route geometry, quantities, CW compatibility or a heat-load dependency. CW suggestions remain evidence pending.
- An isolated pass on `127.0.0.1:4185` verified Catalogue browsing, Q600 visibility, Parts categories, HRV availability with no rooms, two supply runs, one extract run, undo/redo, task switching and device-local reload with no browser warnings/errors. The existing 4173 draft was not opened or changed.
- `node scripts/check.mjs` passes 154 tests across 42 `.mjs` modules and `git diff --check`.
- The sections below are retained as historical handover evidence for earlier schema versions and counts.

## 19 October follow-up — supersedes feature/status counts below

- Current domain schema is version 10 with sequential schemas 1–10 migration, confirmed physical rooms, parent-scoped dashed nonphysical Room Dividers, child ventilation zones, manual typed terminal-to-room/zone association and one independent preliminary floor-area outline per floor.
- Plan reference, calibration, wall, divider and room/zone tools now share one canvas. Closing one boundary opens contextual room details without navigating to a separate Rooms task. Ventilation remains separate over locked building geometry.
- `node scripts/check.mjs` currently passes 145 tests across 40 `.mjs` modules plus `git diff --check`.
- The earlier localhost evidence below remains historical evidence for the prior schema-7 shell. A fresh isolated pass on `127.0.0.1:4175` verified the schema-9 unified Plan flow: room confirmation, a dashed parent-scoped divider, named Kitchen and Dining zones, locked Ventilation context and compatible manual terminal-to-zone assignment. Browser warning/error logs were empty, and the existing `127.0.0.1:4173` draft was not opened or changed.
- Isolated schema-10 passes on `127.0.0.1:4179` and `127.0.0.1:4180` verified an independent preliminary outline with create/edit/undo/redo/local reopen and one-per-floor guard, plus edge-aware mid-wall and exact-endpoint Room Divider snapping that produced two equal zone faces and retained the current parent-room boundary. Browser warning/error logs were empty; the user's 4173 draft was not opened or changed.
- Doors, windows, floor-area holes/exclusions/multiple outlines, certified TFA, heat/load calculations, arbitrary manual room polygons, airflow calculations, verified products, deployment and hosted services remain outside this increment.

## Frozen status

- Designated repository: `/Users/AdelaideGeo/Documents/HiPer Studio V2`
- Branch: `feature/spatial-domain-foundation`
- Verification command: `node scripts/check.mjs`
- Result: 120 tests passed, zero failed; 35 `.mjs` syntax checks and `git diff --check` passed. Bounded localhost browser passes verified wall, room, synthetic mechanical, camera and A3-preview behaviour without console warnings or errors.
- Working tree: tested but uncommitted. Git metadata is readable, but this sandbox cannot create `.git/index.lock`; no Git write or backup-copy workaround was attempted.
- Browser inspection used an isolated synthetic draft on `127.0.0.1:4174`. Downloads, file pickers, print dialogs, browser permissions, local CAD/PDF opening, converters, installs, external services and deployments were not run.

## Verified localhost visual evidence

- The isolated draft produced four walls including a T-junction; a moved shared node retained three incident walls; wall cancellation and undo/redo preserved the committed count.
- The seven-wall device draft exposed two eligible wall faces. The Rooms task confirmed a Kitchen / Dining room with an explicit Extract role, stable identity and live 11.9 m² wall-reference-line area; browser warning/error logs remained empty.
- Three synthetic components placed successfully. The MVHR placeholder rotated 90 degrees; compatible supply/extract routes committed; an occupied attachment was rejected atomically; and an incomplete route cancelled without residue.
- Zoom, pan and Fit changed only the SVG camera while object counts stayed stable.
- The A3 preview rendered as a clipped `420 mm × 297 mm` SVG at `1:20`, with Preliminary/DRAFT/not-for-construction wording, a used-symbol legend and zero editor overlay elements.
- Browser warning/error logs were empty. Returning to `127.0.0.1:4173` confirmed the existing device draft remained unchanged at seven walls with its locked uncalibrated synthetic PNG.

## Implemented baseline

- Renderer-independent schema 7 with canonical millimetres/radians, XYZ, floor transforms, full quaternions, explicit unknowns, stable IDs, typed ports/connections, confirmed wall-face rooms and faithful schemas 1–7 migration.
- Manual wall chains, shared topology, atomic T-junctions, node edits, guarded deletion and bounded undo/redo.
- Visibly synthetic component placement/rotation and separate compatible supply/extract route authoring with cancellation and authoritative attached endpoints.
- Locked PNG placement and explicit two-point calibration; bounded synthetic ASCII AC1015 DXF review with units, layers, diagnostics, transforms, read-only snaps and no automatic wall creation.
- Journaled device-local recovery, exact 32 MiB portable-envelope growth protection, recoverable oversized legacy state and authority-free portable round-trip.
- Deterministic A3 landscape working-draft SVG scene with scale/NTS logic, title/legend, clipping and visible unsupported-content warnings.

## Ordered manual acceptance checks

1. Rapidly select two synthetic DXFs and cancel during the older read. Confirm stale work cannot reopen review and invalid replacement closes old dialog content without changing the project.
2. Place a synthetic DXF, confirm units/layers/omissions explicitly, then test Wall snap priority among CAD reference points, wall endpoints/interiors and grid. Hover alone must create nothing.
3. Draw an adjoining wall chain with a T-junction, move the shared node, cancel a draft, and exercise undo/redo. Stable shared identities and all incident edges must remain coherent.
4. Place and rotate the synthetic MVHR/supply/extract components; route compatible supply and extract paths; reject an incompatible/occupied port and cancel an incomplete route without residue.
5. Place a PNG, perform two-point calibration, choose reference-only scope, save/reopen locally and confirm the locked reference/model transform is retained.
6. Reopen the device-local draft and inspect status truthfulness. Confirm incomplete drafts are not persisted and no save action claims company/cloud, snapshot, revision or issue authority.
7. Open the A3 preview and verify scale versus NTS, clipping, title/legend, Preliminary/DRAFT/not-for-construction wording, CAD omission warning and absence of editor overlays. Avoid download/export while the prompt loop remains unresolved.

## Prioritised next-build backlog from the master

1. **Evidence/decision closure:** inspect and hash supplied local CAD/PDF files read-only; select the representative residence and authorised DXF fixture with signed expected outcomes; complete DEC01 evidence. No converter or external transfer is needed for the read-only inventory.
2. **Geometry/interaction evidence:** complete DEC02 browser gesture, accessibility, renderer and target-size/performance evidence against the same fixture; resolve datum, wall reference line, area and snap conventions.
3. **Verified catalogue basis:** complete DEC03 for the initial regional MVHR unit, supply/extract attenuation path, TVA, 90 mm radial duct and limited EPP family, including dimensions, ports, compatibility and rights.
4. **Shared building core:** extend the implemented wall-derived room slice with hosted openings, manual/virtual boundaries, heights/volumes and terminal association before quantities or engineering depend on them.
5. **Manual CAD depth:** add numeric entry, joins/detach, selection/mixed-property editing and conflict-safe topology repair while retaining command atomicity and exact persistence.
6. **Physical MVHR slice:** replace synthetic products only after DEC03 evidence; add true-width routes, required fittings, assemblies, installation context and transparent quantities/estimate without inventing engineering results.
7. **Module and workflow boundaries:** add the internal module envelope/dependency invalidation, then working-draft/server-conflict, deliberate snapshot and Preliminary/Issued-for-review boundaries under DEC05/DEC06 gates.
8. **Separately gated adapters:** the bounded local PDF page-reference path is implemented under DEV46; broader real-file PDF claims and authorised CAD fixture paths still require their named gates and must preserve source identity, diagnostics and local-only privacy.

## Blocker classification

Genuine approval gates are Git filesystem escalation, any dependency beyond the approved pinned PDF.js renderer, converters, external file transfer, broader production CAD/PDF adapters, persistent credentials/services, deployment/authentication/billing, and production PDF/issue workflows. Missing real-customer-file evidence and read-only inspection of supplied local CAD/PDF files are not approval blockers. Openings, manual/virtual room partitions, catalogue evidence, quantities, hosted persistence and later engineering are unfinished scope rather than hidden defects in this baseline.

## Precise morning restart

1. `cd "/Users/AdelaideGeo/Documents/HiPer Studio V2"`
2. `node scripts/check.mjs`
3. `git status --short` and compare it with the inventory below.
4. Read `docs/10-qa-regression-review.md`, `docs/11-morning-review-checklist.md` and this handover.
5. Resume the localhost shell only when ready to perform the seven checks: `node scripts/dev-server.mjs`, then open `http://127.0.0.1:4173/app/`. If the prompt loop returns, stop rather than granting or retrying downloads.
6. Supplied local CAD/PDF files may then be inspected read-only and hashed. Do not install/launch a converter or send a file externally.
7. After review, request the specific Git filesystem authorization needed to stage these exact files; do not copy, swap or reinitialize the repository.

## Working-tree inventory

Modified tracked files (14):

- `AGENTS.md`
- `README.md`
- `app/index.html`
- `app/main.mjs`
- `app/style.css`
- `docs/08-development-decisions.md`
- `scripts/dev-server.mjs`
- `src/domain/history.mjs`
- `src/domain/spatial.mjs`
- `src/persistence/local-project-store.mjs`
- `test/fixtures/spatial-round-trip.json`
- `test/persistence.test.mjs`
- `test/spatial-negative.test.mjs`
- `test/walls.test.mjs`

Untracked project files (32, including this handover):

- `docs/09-development-progress.md`
- `docs/10-qa-regression-review.md`
- `docs/11-morning-review-checklist.md`
- `docs/12-scope-implementation-matrix.md`
- `docs/13-morning-handover.md`
- `scripts/check.mjs`
- `src/dev/static-path.mjs`
- `src/editor/camera.mjs`
- `src/editor/dxf-import-controller.mjs`
- `src/editor/mechanical-controller.mjs`
- `src/editor/synthetic-catalogue.mjs`
- `src/import/dxf-reference.mjs`
- `src/persistence/portable-envelope.mjs`
- `src/persistence/portable-project.mjs`
- `src/sheets/a3-sheet.mjs`
- `test/camera.test.mjs`
- `test/deterministic-operations.test.mjs`
- `test/dev-server-security.test.mjs`
- `test/dxf-import-controller.test.mjs`
- `test/dxf-reference.test.mjs`
- `test/fixtures/dxf/supported-ac1015.dxf`
- `test/fixtures/dxf/unknown-units-ac1015.dxf`
- `test/fixtures/dxf/unsupported-content-ac1015.dxf`
- `test/fixtures/generate-synthetic-reference.mjs`
- `test/history-bounds.test.mjs`
- `test/integration-journey.test.mjs`
- `test/mechanical-controller.test.mjs`
- `test/migration-all.test.mjs`
- `test/portable-budget.test.mjs`
- `test/portable-reference.test.mjs`
- `test/routes.test.mjs`
- `test/sheet.test.mjs`

Baseline content checksum (SHA-256 over sorted `sha256  path` records for the 45 implementation/planning files above, excluding this self-referential handover): `eea1f419e0d5230aab9b5abace611f7a366fe3966c44a9fd7d70b7dd3055da02`.

## Repository separation

All writes in this work were confined to the designated V2 repository and its task-local writable shadow. The existing Studio prototype and production repositories were inspected only through read-only Git status at consolidation. They are not clean—`HiPer Studio` currently reports `?? tmp/`, and the HiPer OS/website repositories report unrelated changes—but none was written by this task and no status entry is attributed to this baseline. No package manifest, environment file, deployment configuration, credential or hosted-service configuration was added to V2.
