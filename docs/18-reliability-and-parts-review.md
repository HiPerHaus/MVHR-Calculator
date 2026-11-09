# Reliability and parts handoff review — 9 November 2026

The original speed/drag work was preserved in checkpoint `4e9e1ff`. This follow-on is developed in a separate worktree on `local/studio-reliability-20261109`; no cloud drawings, access settings, product evidence or original dirty checkout files are edited by these changes.

## Implemented

- Automatic EPP checks the exact final domain-normalized fixed-radius drawing body, including exterior terminal legs, exclusions, known outside diameters and Twin lanes. Its overlay uses that body. Re-routing preserves existing typed connections, arrangement and vertical evidence, reserves final geometry for later selected routes and remains one undo action. Stale previews are rechecked on Apply and changed geometry requires another review.
- Automatic Q350 drawing-only endpoint selection matches existing manual/domain connection rules. This is drawing support only, not proof of physical fit.
- Check summary, detailed pressure panel, engineering JSON/CSV and installer-data foundation use the selected mode's saved deterministic network evaluation. External duty screening and Normal-only room requirements are separately labelled. Decentralised-only floors do not show a missing central network calculation.
- Unapplied engineering edits survive incidental rendering and receive Save/Discard/Cancel safeguards for mode changes, navigation, project/option changes, undo/redo and exports. Invalid saves preserve values and block continuation. Leaving the browser warns about unapplied engineering inputs.
- Export adds an Excel-compatible CSV parts list for the active option across all floors. Supplier quantities reuse the A4 schedule derivation; measured lengths, assembly references, pending quantities and unresolved items are explicitly separate from purchase stock. No prices are added.
- The top 3D navigation button is temporarily hidden for customer testing. The underlying workspace, height controls, renderer and SVG export remain intact. Existing 3D recovery sessions reopen in ventilation without changing saved drawing data.
- Workspace cleanup is bounded: remove inactive layer toggles, correct the PDF-import note, keep Check's detailed engineering inputs under an explicit disclosure and put its selected mode/scope beside the summary. Broader tool-panel rearrangement remains outside this increment.

## Verification

The final integrated candidate passed `npm run check`: 567 tests, 224 module syntax checks and whitespace. `npm run build` passed. Synthetic test evidence does not certify real building geometry, manufacturer fitting setout, full 3D clearance, commissioning or installation compliance.

Focused EPP regressions cover rigid elbows missed by the previous generic curve, changed HRV leads, both exterior endpoint directions, exterior exclusions/ducts, concave exits and tangencies, unrelated boundary clearance, known diameters, candidate/existing Twin lanes, Q350 forward/reverse and rotated direct/building-aligned preview-to-commit equality, and re-routing parity. Independent review additionally checked known/unknown elevations, original object preservation and topology/interface provenance through re-routing.

Browser fixtures run only on a loopback origin with synthetic projects and mocked cloud/auth modules:

- `node scripts/drag-preview-review-server.mjs 4299 engineering`, then `/after/app/`: existing drag checks and Check input interaction checks.
- `node scripts/drag-preview-review-server.mjs 4300 epp`, then `/after/app/`: automatic EPP exact overlay, Cancel/Escape, Apply, single-step undo/redo, reroute and stale-preview checks.

These harness scripts are excluded from the production build. CSV handler tests exercise real generated Blob bytes, repeated downloads, filename/scope changes, failed generation and URL cleanup; browser smoke additionally exercises export and panel close/reopen.

Real Chrome synthetic UI checks passed for both Check inputs and EPP routing, with no captured browser runtime errors. EPP coverage includes final overlay/command equality, Escape, one-action undo/redo, repeat Apply after dismissal, Building-aligned replacements, changed-endpoint re-review and newly added exclusion blocking stale Apply. Check coverage includes incidental rerender retention, mode Save/Cancel/Escape, invalid saves, export content, navigation, Show on plan, replace confirmation and browser-leave warning.

The final browser pass also verified that the top 3D control is hidden, has no layout box and is absent from accessible navigation, while the underlying workspace, view host and export control still exist. The same final source passed EPP and Check interaction harnesses again, with no captured runtime or browser-console errors. Native Excel opening was not exercised; CSV encoding, escaping and bytes are tested.
