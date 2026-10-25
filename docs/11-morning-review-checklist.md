# Morning review checklist

Review the remaining highest-risk browser-only behaviour first. A bounded localhost pass completed the wall, synthetic mechanical, camera and A3-preview checks described below; file-picker, download, print and browser-permission paths were deliberately not invoked.

## Browser evidence completed

- An isolated `127.0.0.1:4174` storage origin protected the existing device draft on `127.0.0.1:4173`.
- Wall chain creation, an adjoining T-junction, movement of a shared node with three incident walls, cancellation, undo and redo were visibly verified.
- Three synthetic components were placed; the MVHR placeholder rotated exactly 90 degrees; compatible supply and extract routes committed; an occupied attachment failed atomically; and an incomplete route cancelled without residue.
- Zoom, pan and Fit changed the SVG camera from `0 0 1200 800` through zoom/pan states to a fitted view while the object counts remained four walls, three components and two routes.
- The A3 preview visibly rendered a numeric `1:20` scale, clipping, title block, used-symbol legend, Preliminary/DRAFT/not-for-construction wording and no editor overlay elements. Browser warning/error logs were empty.
- The original device draft was rechecked unchanged: seven walls, no mechanical objects or DXF underlays, and the same locked uncalibrated synthetic PNG.

## Risk-first browser checks

1. Rapidly choose two DXF files, then cancel while the older read or inspection is pending. Confirm only the newest valid selection can open review, cancellation cannot reopen it, and a rejected replacement closes any older dialog content.
2. Exercise oversized, wrong-extension, malformed and read-failing DXF selections. Confirm the current project and accepted reference remain unchanged and the dialog/status never offers stale acceptance.
3. In Wall mode, finish display-space priority checks involving a DXF reference snap. Endpoint, wall-interior and grid wall authoring, T-junction splitting, shared-node movement and cancellation have been visually exercised; DXF-backed priority still requires the file-picker path.
4. Save and reopen device-local and portable projects. Confirm CAD layers, origin, units, rotation, opacity, shared-camera placement and Fit framing remain visually identical.
5. Inspect dense line, arc, bulge, circle and text fixtures across zoom levels. Check clipping and readable warning/legend placement in the A3 preview, especially for accepted omissions.
6. Verify modal focus order, Escape/cancel, scrolling, keyboard-only operation, status announcements and assistive-technology names.
7. Finish pointer-loss and CAD-underlay overlap checks. Ordinary component hit order, selection, 90-degree rotation, compatible routing, occupied-port rejection and route cancellation have been visually exercised.

## Automated evidence already available

- `node scripts/check.mjs` deterministically checks every `.mjs` file, runs 112 tests and runs `git diff --check`.
- One complete synthetic journey covers new project, calibrated PNG, reviewed DXF, adjoining walls/T-junction editing, component placement/rotation, compatible supply/extract routes, cancellation, undo/redo, device recovery, portable reopen and A3 generation.
- A deterministic seeded sequence validates 240 mixed editing operations after every step.
- Faithfully shaped fixtures migrate every schema version 1–6 without inventing authority.
- DXF tests cover source bytes, group pairs, source/emitted entities, total recursive visits, vertices, diagnostics, units, layers, transforms, immutable snap queries, provenance, tampering and portable reinspection.
- History tests prove entry retention and undo/redo after trimming; imported command payloads are not duplicated in history metadata.
- A3 tests compare the validated transformed geometry, bounds and layers and require visible omission warnings.
- Portable-budget tests prove the exact last fitting byte, UTF-8/escaping charges, base64 amplification across several assets, atomic over-limit rejection, oversized local recovery and migration growth using small injected ceilings.

## Implementation confirmations

- Accepted CAD creates one locked source asset/placement and no walls, rooms, routes, connections, quantities or workflow authority.
- Source units, included layers and diagnosed omissions require explicit review choices.
- Plan and A3 projections share the saved layer-filtered source-to-floor transform.
- New DXF selection closes any older review dialog before extension, size, read or inspection failures are reported.
- Working history is bounded to 50 prior snapshots and 32 MiB of estimated prior-project data, retaining at least one-step undo.
- The complete portable envelope is bounded to 32 MiB. Asset source, model data, derived geometry, JSON escaping and metadata share that one exact budget; successful commands cannot make an exportable project unexportable.
- Oversized legacy drafts are preserved locally, labelled export-blocked and prevented from growing. No data is silently removed.
- The bounded scope and evidence limits are summarized in `docs/12-scope-implementation-matrix.md`.

## Exact next steps and blockers

1. Start with `docs/13-morning-handover.md`, then run `node scripts/check.mjs` and compare `git status --short` with its inventory.
2. Resume only the remaining localhost visual checks when ready: DXF/PNG file-picker review, reference calibration/reopen, CAD-layer appearance, modal/accessibility behaviour and physical print evidence. Do not trigger downloads while checking the shell.
3. The bounded local PDF page-reference gate is now implemented with pinned PDF.js and synthetic evidence. Supplied local CAD/PDF files may still be inspected read-only and hashed, but this does not establish general real-file compatibility. Do not install a converter, send a file externally or extend the broader production CAD/PDF paths without their named gate.
4. The current sandbox can read `/Users/AdelaideGeo/Documents/HiPer Studio V2/.git/index` but cannot write `/Users/AdelaideGeo/Documents/HiPer Studio V2/.git`; Git staging requires `.git/index.lock`. After review, use a separately authorized local Git write to stage the exact reviewed files and commit. Do not copy, swap or reinitialize the repository.

## Genuine approval gates

- Git filesystem escalation for staging or commit.
- Installing a new parser, converter or other dependency.
- Sending any supplied drawing to an external converter, upload or network service.
- Extending the bounded PDF page-reference path into general real-file compatibility or implementing production CAD/PDF adapter paths.
- Creating persistent credentials or configuring deployment, authentication, billing, hosted storage, tenant/company services or external integrations.
- PDF generation/issue workflow, immutable snapshots and production print/export claims beyond the current deterministic SVG preview.

## Missing evidence, not approval blockers

- DXF/PNG file-picker behaviour, reference calibration/reopen, CAD-layer appearance, modal/accessibility behaviour and physical print appearance.
- Read-only inspection, hashing and metadata inventory of supplied local CAD/PDF files.
- A representative residence, signed expected outcomes, an authorised DXF fixture and DEC01 compatibility evidence.
- DEC02 renderer/gesture/performance evidence and DEC03 verified catalogue/product evidence.

## Unfinished product scope

- Hosted openings, wall-derived rooms, numeric/mixed-property editing and full topology repair.
- Verified catalogue assemblies, physical-width routing, fittings, quantities, estimates and quote revision.
- Module envelopes/invalidation, server conflict handling, deliberate snapshots and issued revisions.
- Multi-floor/risers, engineering engines, commissioning and optional later modules.
