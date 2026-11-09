# Local drag and duct-route review — 9 November 2026

Status: local review branch `local/drag-route-review-20261109`, based on `f956cf0`. Nothing pushed or deployed. Existing saved drawings and cloud settings were not changed.

## Changes

- Drag previews are coalesced to one animation frame. Only moved equipment and affected ducts, cables, handles and unit elbows are redrawn. Full coordination/inspector work occurs at commit or cancellation.
- Final pointer coordinates are sampled at release; one completed gesture is one undoable edit. Queued drawing work is cancelled by full renders.
- One duct crossing or overlapping itself produces a review warning and a dashed drawing cue. Unconfirmed height remains unconfirmed.
- Selected routes receive an outline. Alt-click cycles overlapping ducts, including twin lanes at close zoom. Overlap never creates a connection.
- Manual EPP previews and affected drag previews use the same endpoint/lead/elbow normalization as the final domain command.

## Verification

- `npm run check`: 540 tests passed, 214 module syntax checks, whitespace check passed.
- `npm run build`: passed; generated `dist/` locally only.
- Browser fixture: real application handlers and DOM in Chrome, isolated synthetic project and mocked cloud/auth modules. Passed burst drag, retained unrelated DOM, one-command commit, undo/redo, Escape before queued frame, pointercancel, release at a newer coordinate before the frame, moved-unit connected EPP equality, overlap selection, self-cross warning, and manual EPP hover/commit equality including its top-elbow symbol. No captured browser runtime errors.
- Pure tests additionally cover both EPP drawing directions, rotated units, near-unit clicks, invalid/occupied port hover, no mutation, common/unknown self-crossing heights, smooth curve false positives, tight returning legs, twin overlap picking and scheduler cancellation/restart.

## Performance comparison

Same Chrome/browser viewport and synthetic fixture for the untouched release and candidate: 43 ducts (40 four-point radial routes, one EPP route, one overlapping route, one self-crossing route), two components. Five warm-up iterations and 30 measured updates of one radial point.

| Synchronous drawing work | Release f956cf0 | Local candidate |
| --- | ---: | ---: |
| Median | 53.8 ms | 0.5 ms |
| 95th percentile | 66.2 ms | 0.8 ms |
| Maximum | 73.6 ms | 2.8 ms |

These are drawing-function timings, not end-to-end frame-rate or user-drawing measurements. They exclude browser frame scheduling, paint, final command validation and cloud storage. Full checks still run on release; a particularly large drawing can still pause there. Synthetic results do not validate manufacturer fit, installed clearance or real imported drawings.

## Reproduce

Run `node scripts/drag-preview-review-server.mjs 4297`, then open `http://127.0.0.1:4297/after/app/`. Use **Run interaction checks** and **Benchmark 40 ducts**. The untouched source benchmark is at `/before/app/`. The harness uses only synthetic data on a separate loopback origin and is excluded from `dist/`.

## Separate automatic-routing limitation

The preview parity work here covers manual route drawing and affected drag geometry. Automatic EPP planning and automatic re-routing are unchanged. Their current planner checks candidate controls with a generic swept curve before the domain applies HRV leads/compaction and fixed-radius rigid elbows. Correcting that safely requires validating the exact normalized final body against the outline/exclusions, including permitted exterior terminal legs. A render-only change must not imply those final containment checks have been performed. This remains a separate product-review priority.
