# Initial development decisions

These decisions define the first bounded programming milestone authorized on 15 October 2026. They are reversible implementation choices, not claims that DEC01–DEC08 are resolved or that a production stack has been selected.

## DEV01 — Framework-neutral domain slice

Use native ECMAScript modules on the existing Node.js runtime for the first renderer-independent domain fixture and `node:test` for its tests. Add no registry dependency, application framework, package manifest, server, browser bundle, database, authentication provider, or deployment configuration yet.

Rationale: the first milestone proves model invariants independently from the later renderer, hosted stack, and service selections. A future TypeScript/application scaffold can wrap or migrate the small pure module after DEC02 and DEC06 evidence without coupling the authoritative model to a UI library.

## DEV02 — Canonical spatial representation

- Store physical lengths in millimetres and angles in radians.
- Use a right-handed building coordinate frame with Z up.
- Store full orientation as normalized quaternions.
- Keep floor, component, and product-local transforms explicit.
- Represent known, assumed, and unknown vertical measurements as different tagged values. Unknown stores `null`, never zero.
- Treat renderer data as a projection; the project document is authoritative.

Schema version `1` established the first spatial fixture. Schema version `2` added image-reference assets and floor placements. Schema version `3` records whether accepted calibration was reference-only or included an explicit floor-wall XY rescale and its scale factor. Schema version `4` adds explicit nullable start/end route-to-port attachments and a nullable semantic role for unattached legacy routes. Schema version `5` adds an explicit `semi-rigid-radial` versus `generic-duct` route classification without adding a size, product, loss or compatibility claim. Schema version `6` adds independent read-only DXF source assets and floor placements. Schema version `7` adds confirmed wall-face rooms with stable identities and explicit use/ventilation metadata. Schema version `8` adds explicitly unknown room-volume evidence and manual typed terminal-to-room associations. Schema version `9` adds parent-scoped nonphysical room dividers and child ventilation zones. Schema version `10` adds the independent preliminary floor-area outline. Schema version `19` adds a nullable page-relative PDF crop rectangle after the intervening workflow, catalogue, route, PDF, airflow and engineering increments. Migration is sequential and validated; schema numbers are not a promise of permanent customer-file compatibility.

## DEV03 — Commands and typed connectivity

Domain commands return a new validated project state rather than mutating the previous state. The first command set adds floors, components, routes, typed connections, and XY component moves. XY moves preserve Z certainty and full orientation.

Connectivity exists only through explicit stable component/port endpoints with matching system and stream types. Spatial overlap, crossing routes, or equal nominal size never creates a connection.

## DEV04 — Synthetic evidence boundary

The fixtures are synthetic and exercise numerical transforms, route lengths and the bounded DXF dialect described in DEV14. They are not evidence that either candidate DWG is valid, that a real customer DXF is supported, or that any catalogue product/connection is compatible. Those gates remain open under DEC01 and DEC03.

## First testable milestone

The milestone passes when native tests prove:

1. floor, component, and port transforms match the published synthetic coordinates;
2. canonical save/reopen preserves stable identities and state;
3. an XY move preserves unknown Z and full orientation;
4. projected and developed lengths remain distinct, with unknown height blocking developed length only; and
5. overlap does not imply connectivity while explicit typed connections do.

## DEV05 — Native SVG evaluation shell

Use browser-native HTML, CSS, JavaScript modules, and SVG for the first local wall-workflow shell. This is a disposable evaluation layer, not the DEC02 production-renderer decision. It imports the authoritative domain and command-history modules; SVG elements are rebuilt projections and never become persistence state.

The local smoke server uses only Node's standard library, binds to `127.0.0.1`, disables caching, and serves only the evaluation shell and domain modules needed for development inspection. It is not a hosted service, production server, authentication boundary, or deployment configuration.

## Wall-workflow milestone

The next bounded milestone adds explicit wall nodes and edges, connected chain creation, node movement, working-draft command history, one-command undo/redo, and a familiar Plan shell with Wall and Select tools. The shell uses a labelled synthetic empty project and 100 mm input snap. That snap is a temporary UI evaluation setting, not approval of DEC02's proposed acquisition thresholds.

The milestone does not yet claim rooms, openings, company-account/cloud persistence, import, multi-floor editing, arbitrary wall joins/detach, calibration, accessibility conformance, or production renderer performance.

## DEV06 — Journaled device-local recovery adapter

Use a replaceable Web Storage adapter for the bounded wall-workflow evaluation only. It stores validated canonical project JSON in current, previous and staging records, verifies the staging record before promotion, and falls back to the previous valid record when the current record is malformed or unsupported. A failed write does not clear or replace the last acknowledged valid record.

The UI may say **Local save pending**, **Saved on this device** or **Local save failed** only from the corresponding adapter result. Its monotonic `localSaveNumber` is a device-local journal counter, not the master's server save version, design snapshot or drawing revision. The adapter has no identity, company membership, permission, entitlement, tenant ownership, remote backup or cloud-sync authority. IndexedDB remains a candidate for a later approved recovery implementation; this dependency-free adapter is deliberately reversible behind the persistence boundary.

Committed wall commands, endpoint moves, undo and redo queue an immediate device-local write. Draft points, selection and drag previews do not persist. Reload or **Reopen saved** restores the last acknowledged project and starts a new in-memory command history; undo history is not claimed durable.

Endpoint acquisition uses the proposed 12 CSS-pixel release value as a labelled evaluation setting, while unsnapped coordinates retain the existing 100 mm shell grid. The domain accepts an existing node identity only at its exact stored position and rejects coincident plan nodes or duplicate topological edges. This does not approve DEC02's physical topology epsilon or broader join/detach behaviour.

A closed wall chain and an adjoining chain are topology fixtures only. Room faces, room identity and net-internal area remain unimplemented because DEC02's centreline/internal-face and fixture conventions are unresolved.

## DEV07 — Portable project and PNG reference evaluation

Use a versioned JSON envelope for the first portable-project proof. It contains canonical serialized project data and embeds the original PNG source bytes as a data URL with filename, byte length, pixel dimensions and SHA-256 checksum. Open validates the envelope, schema, authority-field exclusions, image signature, dimensions, byte length and checksum before it may replace the active project. Cancel or any validation failure leaves the active project unchanged. A successful open starts a new in-memory undo history and says so; portable data cannot restore tenant, role, entitlement, catalogue-verification, review or issue authority.

Place the PNG beneath the authoritative wall model on a locked reference layer. Its scale begins explicitly unknown; the shell uses a labelled display-only preview scale until two distinct source points and a positive distance/unit are applied as one command. Calibration preserves the first selected world anchor. When authored geometry already exists on that floor, Apply requires an explicit scope choice: **Reference only**, or **Reference and this floor's walls** when that option is safe. Cancel changes nothing.

The second choice is one atomic, undoable command. It uniformly scales wall-node XY coordinates on the reference's floor about the first calibration point by `new reference scale / prior displayed reference scale`. Stable identities, topology, connections, Z values and their known/assumed/unknown states, wall thickness and height, other floors, and other independent references do not change. This is a bounded model/reference alignment transform, not a claim that typed physical dimensions should scale. Repeated calibration uses the current accepted reference scale as its prior scale and records the applied factor. Portable and device-local reopen preserve the accepted choice.

Floor-wall rescaling is blocked when the selected floor contains placed components or routes. The current route model has no typed route-endpoint-to-port attachment, and scaling old route coordinates while product-local port offsets remain physical would risk separating a route endpoint from its port. Until that invariant is modelled and tested, the UI explains the block and leaves **Reference only** and **Cancel** available. A crafted command is rejected before the reference or any other geometry changes.

Pan, zoom and fit use one shared camera/view transform for the reference and authoritative model. They do not enter command history or alter physical geometry.

## DEV08 — Explicit T-junction wall splitting

The Wall tool may acquire an existing wall endpoint or a point strictly inside an existing wall. Interior acquisition remains a display-space evaluation threshold of 12 CSS pixels; the committed point is the exact orthogonal projection onto the authoritative wall segment, not a rounded screen coordinate. Merely crossing or overlapping wall graphics never creates a junction.

Committing a chain with an acquired wall interior applies the split and new chain together as one command. The start-side segment keeps the source wall ID, a new stable wall ID represents the end-side segment, and one new stable node is shared by both segments and the new branch. Thickness, height, reference-line convention and physical/virtual classification are retained. A split elevation is interpolated only when both endpoint elevations are known or assumed; otherwise it remains explicitly unknown.

The command rejects endpoints, off-segment points, duplicate/coincident nodes, duplicate edges, repeated splitting of the same source wall in one chain, cross-floor splits, and identifier collisions. Any later validation failure discards the provisional split because commands operate on a cloned project. Undo/redo and serialization restore the whole pre- or post-junction graph without partial state.

Tool ownership remains explicit: Wall clicks create draft geometry and provisional junction intent; Select clicks select and endpoint drags edit committed nodes. Escape or a tool change cancels the draft without splitting anything. Arbitrary crossing resolution, multi-wall intersection nodes, wall detach/trim/extend, openings, and room-face/area derivation remain later bounded work.

## DEV09 — Guarded wall and connected-chain deletion

Keep deletion scopes explicit in both the command model and the Select-tool interface. **Delete wall only** removes exactly the selected wall edge and preserves every connected neighbour and its stable identity. **Delete connected chain** removes the complete graph component reachable through shared wall nodes. Neither command infers a room, closed polygon, collinear run or visual grouping.

The deletion command first resolves its full scope and rejects an unknown wall identity or any explicit surviving field that refers to a wall in that scope. It then removes the wall edges and removes only endpoint nodes that have no incident retained wall. Shared junction nodes therefore survive whenever a neighbouring wall still uses them. The command runs against a cloned project, so dependency rejection and later validation failure cannot partially delete model state. One successful deletion is one undoable command and survives canonical save/reopen with the same retained identities.

Delete and Backspace open a confirmation dialog only when Select owns the interaction and a wall is selected. Text inputs, text areas, selects and editable content retain their normal keyboard behaviour. The dialog distinguishes the selected edge from the whole connected component, and Cancel makes no project command. A separate inspector action exposes the same guarded choice without relying on a keyboard shortcut.

The generic dependency guard is an interim defence for explicit wall-ID fields such as a future hosted opening or boundary reference. A typed hosted-opening model, detach/rehost workflow, node-only deletion, collinear-chain semantics, room-face repair, trim/extend, crossing repair and conflict visualization remain unimplemented and require later bounded decisions and tests.

## DEV10 — Typed route endpoint attachment

A route may bind its start and end independently to explicit `{ componentId, portId }` identities. The route remains one graph edge only when both bindings exist; an SVG crossing, coordinate overlap or equal nominal size never creates connectivity. An attached route requires an explicit semantic role, and every bound port must match the route's floor, air system, stream and role. Port occupancy is shared across route bindings and direct port-to-port connections, so one port cannot silently participate in multiple initial-scope edges.

Route points are floor-local XYZ. When an endpoint is attached, its stored endpoint point is a derived cache of the component-local port position transformed by the component's full quaternion and floor-local component position. The binding is authoritative: route creation, endpoint attachment and component XY movement re-derive the endpoint, while project validation rejects a persisted point that has drifted from its bound port. The endpoint-transform query also exposes the corresponding building-space position, direction and full orientation through the floor and component transforms. Interior route points and the opposite endpoint remain unchanged by a component move.

Endpoint Z carries evidence state. Known and assumed component elevations produce derived known or assumed endpoint elevations with provenance; an unknown component elevation produces an explicitly unknown route endpoint even when the product-local port offset is known. Consequently, projected plan length may remain available while developed length remains unknown.

Schema 4 migrates schema-3 routes as unattached with `role`, `startAttachment` and `endAttachment` set to `null`; it does not infer topology from their old endpoint coordinates. Attached topology is preserved by canonical serialization, the device-local recovery adapter and portable project files. Synthetic component/port fixtures prove transforms and invariants only; they make no catalogue, product-compatibility, pressure-loss or engineering claim.

Floor-reference rescaling remains blocked whenever the selected floor contains components or routes. Endpoint attachment closes the stale-route-on-component-move hazard, but it does not establish the intended meaning of scaling authored component locations, physical product offsets, interior route geometry or typed dimensions together. Reference-only calibration remains available and leaves the network byte-for-byte unchanged.

## DEV11 — Synthetic mechanical drawing interaction

The original interaction slice used only an in-repository synthetic MVHR unit and supply/extract terminals. DEV26 now extends that seam with versioned evidence-aware catalogue records while retaining visibly generic test fixtures. Generic symbols and local port coordinates remain test data, not manufacturer dimensions or claims of physical fit. Port colour is secondary to the stored system, stream, semantic role and interface metadata.

The placement and route workflows use a renderer-independent interaction controller. Placement owns every canvas click while active, including clicks over walls, emits one domain `component.add` intent per click and remains active for repeated placement. Route owns clicks while active, must start at a visible typed port, accepts intermediate floor-plan points, and commits only at a different compatible typed port. Escape and tool changes discard the ghost or incomplete route without a domain command. Select owns component selection and drag; moves and 90-degree floor-Z rotations use domain commands so attached endpoint caches are re-derived rather than patched in SVG state.

Store legacy `ductKind` as `semi-rigid-radial` or `generic-duct`; DEV26 adds generic `epp-rigid-dn125`, `epp-rigid-dn160` and `flexible-round-dn150` classes with explicit nominal interface metadata. These remain routing-policy/display classifications. A nominal size does not state bore, outside diameter, mating profile, bend radius, pressure drop, equivalent length, purchase quantity or approved transition. Route rendering remains a schematic polyline until verified catalogue geometry and engineering methods are separately gated.

Schema 5 migrates schema-4 route attachments, roles and geometry unchanged and adds `generic-duct` only as the conservative legacy classification. Schema-3 and older migrations remain sequential. Device-local and portable reopen continue through the same validated migration boundary.

The browser shell code renders the searchable catalogue palette, placement ghost, selectable/movable/rotatable components, typed ports, route previews and committed route classes. Source-backed but incomplete candidates remain visible as non-placeable evidence gaps. Pointer capture, exact visual layering, labels at every zoom, keyboard focus and rendered accessibility still require proportionate browser review for each UI increment.

## DEV12 — Defensive prototype input and local-serving bounds

Bound a portable package to 32 MiB of UTF-8 text, each embedded PNG to 5 MiB, the project to eight reference assets and total embedded reference bytes to 20 MiB. Validate canonical base64 length/alphabet before decoding, require its decoded-length claim to agree, and retain SHA-256, signature, dimension and IHDR checks. These are reversible prototype safety limits, not customer-plan capacity promises.

A device-local save is acknowledged only after both staging validation and readback validation of the promoted current record. Failure retains the last recoverable previous record where one exists. This remains recovery semantics only, not a server transaction or durable multi-device save.

The dependency-free development server resolves decoded paths only within `app`, `src/domain`, `src/editor`, `src/import`, `src/persistence` and the bounded `src/sheets` renderer, then verifies the real file remains within the selected root. It continues to bind to `127.0.0.1` and is not an authentication or production-serving boundary. See `docs/10-qa-regression-review.md` for the adversarial findings and residual risks.

PNG is the only reference format exposed by the evaluation shell. The five MiB input bound is a reversible prototype limit, not a production decision. A bounded non-UI synthetic DXF foundation is recorded in DEV14; real-file DXF/DWG compatibility, interactive unit/layer review, snapping, replacement revisions, PDF parsing/rendering, page/crop identity, a second calibration check, and room/area derivation remain open. No source is uploaded, no external converter is called, and no dependency is selected by this milestone.

## DEV13 — Deterministic A3 working-draft sheet scene

Use a renderer-independent, captured print scene for the first A3 sheet proof. The model defines exact 420 × 297 mm landscape page bounds, 10 mm printable margins, a clipped drawing viewport and a reserved 95 mm right-side title/legend block. Portrait page bounds are available only as a tested layout primitive; the initial product sheet remains A3 landscape.

The print scene is cloned from the validated committed project when Preview is selected. It includes the selected floor's authoritative walls, committed routes, placed component symbols and visible PNG references with their saved translation, rotation, opacity and calibrated scale. It deliberately excludes selection, handles, grids, snap marks, ghosts, incomplete wall/route drafts and other editor state. The local FNV-1a scene fingerprint detects deterministic equality in tests; it is not a cryptographic artefact hash, immutable design snapshot, server save version or issued revision.

Numeric scale is computed only from canonical model millimetres, the actual printable drawing viewport and a conservative standard denominator that fits the captured bounds. If any visible reference has unknown calibration, the whole preview says **NTS — uncalibrated reference present**; its source footprint is display-only at a deterministic preview ratio and cannot create a numeric scale claim. An empty scene is also NTS. Calibrated references use the actual saved source-to-floor transform.

The preview title block carries project, site, client and drawing identifiers, floor, explicit date, **Preliminary — not for construction**, `DRAFT` revision text, scale, blank Checked by and a legend built only from used symbols. Missing client/site details are shown as Not set rather than invented. Synthetic fixture names and their not-manufacturer-verified status remain visible. XML-invalid text is replaced, markup is escaped, long fields wrap or truncate with an ellipsis, and a legend that cannot fit is rejected rather than silently omitting used symbols.

The SVG is a deterministic preview generated from that captured model, not an issued drawing or construction-ready output. PDF generation, print-driver behaviour, font substitution, physical-printer calibration, browser rendering, accessibility inspection, cryptographic artefact hashing, immutable design snapshots, authorised issue events and revision history remain separately gated. The localhost server allowlist adds only `src/sheets` to serve this module.

## DEV14 — Bounded synthetic ASCII DXF reference foundation

Use a dependency-free, renderer-independent adapter for one exact synthetic fixture dialect: plain 7-bit ASCII DXF `AC1015`. The bounded supported entity subset is `LINE`, 2D `LWPOLYLINE` with preserved bulges, `ARC`, `CIRCLE`, plain unaligned `TEXT`, and basic nested `INSERT` expansion with positive uniform 2D scale. Reference geometry is read-only and independent: accepting it creates only a source asset and a locked floor placement, never walls, rooms, connectivity, quantities or approval state.

Preserve the original source text, filename, UTF-8 byte length, SHA-256, importer identity/version, declared units, declared and encountered layers, located diagnostics, entity/vertex counts, source-coordinate bounds and source/instance provenance. Unitless, missing or unsupported `$INSUNITS` values require an explicit supported user choice. Layer inclusion, source-local origin, floor translation and rotation are explicit acceptance inputs. Unsupported or invalid entities are omitted with diagnostics and require explicit partial-import acceptance; unsupported or ambiguous DXF versions and a missing `ENTITIES` section block acceptance.

Prototype guards are four MiB per source, four DXF assets and 12 MiB total preserved DXF text per project, 250,000 group pairs, 50,000 source entities, 100,000 emitted entities, 200,000 total recursive expansion visits, 250,000 vertices, eight nested block levels, 2,000 diagnostics and absolute source coordinates no greater than `1e12`. The total visit budget counts `INSERT` and empty-block traversal as well as emitted primitives, so acyclic fan-out cannot bypass the output count. Non-finite geometry, paper-space entities, non-planar content, arrays and non-uniform insertion transforms are rejected or diagnosed rather than flattened or guessed. Portable verification checks the source checksum, reparses the preserved source and requires all persisted derived geometry and provenance to match; a deterministic local fingerprint also detects accidental record drift.

Schema 6 migrates schema-5 projects by adding empty CAD-reference collections and does not infer references from existing images or geometry. DEV14 itself is the non-UI parser/persistence foundation; DEV15 adds its bounded shell review flow without widening compatibility. The two recorded DWG candidates were not opened or converted, no real DXF was tested, no external converter or registry dependency was used, and DEC01 remains open. This foundation therefore makes no claim of general DXF, DWG, codepage text, model/paper-space, external-reference, product or customer-file compatibility.

## DEV15 — Atomic synthetic DXF review and locked display

Expose the DEV14 adapter through a modal review flow in the local manual-plan shell. A selected file is inspected before any project command exists. The reviewer must explicitly confirm source units, select at least one layer containing supported geometry and, when content was omitted, accept the diagnosed partial import. Blocking diagnostics cannot be accepted. Cancel, read failure, inspection failure, invalid choices and command failure preserve the existing project. A monotonically increasing in-memory request generation invalidates pending reads and inspections when a newer file is selected or the flow is cancelled, so a stale asynchronous result cannot reopen or replace current review state.

Successful acceptance emits one `reference.addCad` command. The source bounds centre becomes an explicit source-local origin and is placed at the current shared-camera centre with zero rotation. The saved placement is locked and rendered beneath authoritative walls from `transformDxfReferenceGeometry`; save/reopen and portable validation derive the same display geometry from the preserved source. DXF endpoint, vertex, centre and text-insertion snap candidates are read-only queries. A Wall-tool point may use one only after an explicit user click; inspecting or snapping never converts source entities into walls or mutates the CAD source.

The A3 working-draft scene consumes the same validated, layer-filtered, source-to-floor geometry. It records selected layers and units, includes the CAD bounds in scale fitting, labels the underlay as synthetic AC1015 and not walls, and shows an in-drawing warning plus legend entry when unsupported content was accepted as omitted. No browser execution was performed in this milestone, so modal focus, file-picker behaviour, pointer hit testing, visual arc/bulge fidelity, warning placement and rendered accessibility remain review items rather than verified claims.

## DEV16 — Integration hardening and bounded working history

Retain at most 50 prior command snapshots and at most 32 MiB of estimated serialized prior-project data, keeping the newest snapshot even when one state alone exceeds the byte budget so one-step undo remains available. Redo transfers the same bounded snapshots. History records only the command type because redo uses the stored project state; it does not duplicate a full imported PNG or DXF payload from the original command. These are reversible prototype limits, not a production checkpoint or collaboration policy, and history remains device-memory-only and non-durable.

Before DXF parsing, reject any source whose code-unit length already exceeds the byte ceiling, then scan ASCII by index rather than spreading the full string. Cache transformed CAD geometry and snap candidates in the shell by derived asset fingerprint plus placement settings so ordinary pointer movement does not repeatedly clone and validate the complete preserved source. The cache is a disposable renderer optimization; the validated project and source-derived transform remain authoritative.

The hardening evidence is one complete synthetic journey, deterministic seeded edit sequences, faithful migrations from every schema version 1–6, pathological parser limits, bounded history, device recovery, portable round-trip and A3 generation. It does not validate real CAD files, browser rendering, production capacity, hosted persistence or engineering output.

## DEV17 — Exact portable-envelope growth budget

Keep the portable package ceiling at 32 MiB of UTF-8. Use one encoder and one exact budget calculation for command growth, export, import and local-recovery status. The calculation separately reports canonical project JSON bytes, extra bytes introduced when that JSON is escaped as the envelope's `projectJson` string, and the fixed portable metadata/formatting bytes; their sum is the enforced envelope size. The timestamp used for command budgeting has the same fixed ISO length as every valid export timestamp.

Existing raw-source limits remain unchanged: each PNG is at most 5 MiB, all PNG source bytes at most 20 MiB, each DXF source at most 4 MiB, and all DXF source text at most 12 MiB. These are upper bounds, not independently spendable allocations. Base64 amplification, DXF newline/quote escaping, derived geometry, other model data and portable metadata must all fit together inside the exact 32 MiB envelope.

Every successful domain command must either leave the resulting project portable or, for an already oversized legacy project, not increase its exact encoded size. A crossing command is rejected atomically before history or local save changes, with an error saying the project is unchanged and no data was discarded. No asset or geometry is silently removed or compressed.

Valid legacy/local projects that already exceed the envelope remain loadable and saveable in device-local recovery. They are marked **Oversized legacy draft preserved**, portable export remains blocked, and only non-growing or size-reducing commands may proceed. A portable file whose schema migration causes the canonical current form to exceed the selected budget is opened as the same explicit recoverable state and saved locally; migration never drops existing fields to make it fit.

Low-memory boundary tests use a stricter injected ceiling no greater than the production maximum. They prove the last fitting byte, UTF-8 and nested escaping, multiple base64 assets, over-limit atomicity, oversized local recovery and migration growth without allocating a 32 MiB fixture.

## DEV18 — Confirmed wall-face rooms

Add schema version `7` as the first room slice. Eligible boundaries derive only from closed faces in the explicit physical-wall graph. Imported references, virtual walls, visual overlap, display-space gap closure and crossing graphics cannot become room boundaries. Open endpoints, overlaps and crossings without explicit junction topology produce visible diagnostics instead of guessed rooms. Derivation is a read-only query: the user must click an eligible face, confirm it and supply a name before a room is created.

A confirmed room has a stable opaque ID independent of its current polygon; floor ID; user-entered name; explicit use classification; `wall-face` geometry source; ordered, directed wall references; an empty holes collection; `wall-reference-lines` area convention; explicit unknown room height and volume evidence; an empty terminal-association collection; and a user-selected ventilation role. Kitchen, Dining and combined Kitchen / Dining are separate supported use values. The ventilation role is metadata only and does not infer an airflow rate, terminal count, product, compliance result or engineered design.

Area and centroid are derived from current wall-node coordinates and never stored as competing authoritative geometry. Moving a shared wall updates every adjacent room query while preserving room IDs and metadata. Splitting a referenced wall deterministically expands each affected ordered boundary while retaining the original room. Adding a divider, merging faces or otherwise changing a stored boundary away from one eligible face marks reassignment as required; metadata is never silently duplicated or discarded. The Rooms shell lets the user explicitly reassign a room identity to one eligible unassigned face.

`wall-reference-lines` is a reversible first-pilot convention, not an approval of net-internal, gross-internal or regulatory measurement rules. An open-plan Kitchen / Dining can be represented as one room. Arbitrary manual room polygons, voids/holes, hosted openings, known heights/volumes, deterministic airflow methods and room-level compliance checks remain later bounded work. Parent-scoped nonphysical divider zones and manual terminal association are defined separately in DEV22 and DEV23.

## DEV19 — Building-first workspace ownership

Keep one authoritative project and one shared canvas. **Plan** owns reference placement, calibration, physical wall editing, room confirmation, nonphysical Room Dividers, and room/zone metadata on one page. Closing a physical boundary opens contextual room details without changing tasks. **Ventilation** remains separate and owns MVHR component placement, component editing and route authoring. Building geometry remains visible but non-editable in Ventilation, while MVHR components and routes are hidden from Plan so building preparation happens without accidental system edits.

This follows the useful interaction principle in Plandroid's documented Design toolbox—plan-image, drawing and zone tools are grouped around one design canvas—without copying heat-load, catalogue, window or door scope. HiPer Studio retains stronger domain boundaries: Plan and Ventilation expose the same stable walls, rooms, zones, components and routes rather than separate copies.

Ventilation reports whether current confirmed room boundaries exist, but does not hard-block entry or mutate data. This is a reversible initial-shell default that preserves saveable incomplete drafts. It does not claim room completeness, infer terminal assignments or airflows, or validate an engineering design.

## DEV20 — Contextual room details when walls close

After a wall-chain command creates exactly one newly eligible, unassigned physical-wall face, remain on Plan and open the room confirmation form for that face. The wall command remains committed and device-locally saved if the user cancels; no room exists until the user supplies a name and explicitly applies the form.

If one wall command creates multiple new faces, remain on Plan and expose all new eligible faces for explicit selection instead of choosing one or copying metadata. Existing eligible or already assigned faces do not prompt again. This is an interaction shortcut over the same deterministic wall-face query, not automatic room inference from visual overlap, imported references or display-space gap closure.

## DEV21 — Explicit wall snapping and crossing topology

Keep **Snap on** as the reversible Plan default and expose a visible toolbar toggle and `S` shortcut. With Snap on, endpoint acquisition uses a fixed 12 CSS-pixel screen radius. Physical wall-interior acquisition extends 12 CSS pixels beyond the wall's rendered half-thickness, so a click anywhere on the visible wall plus the target tolerance resolves to the authoritative wall centreline. Non-scaling divider strokes receive the same edge-aware treatment. Exact endpoint ownership is preferred and wall projections within 1 mm of an endpoint are reclassified to the existing endpoint identity. A visible target ring confirms endpoint, wall-interior or DXF-reference acquisition. Grid input remains 100 mm after no higher-priority target is acquired.

Before one snapped wall-chain command commits, exact intersections with already committed walls are expanded into explicit shared nodes. Intersected committed walls and the new chain are split as needed inside the same undoable command. Multiple exact crossings are handled deterministically; nearby geometry that does not intersect is never merged. If a split wall belongs to a confirmed room, its ordered boundary expands while the room ID and metadata survive. A new physical partition wall that changes one stored face into multiple physical faces leaves that room marked for explicit reassignment rather than copying its metadata. This is distinct from DEV23's nonphysical Room Divider, which creates child ventilation zones within one retained physical room.

With **Snap off**, pointer clicks use their unsnapped world coordinates: no endpoint, wall, grid or DXF target is acquired, and a crossing remains disconnected topology with the existing visible crossing diagnostic. Coincident node identities and other core project invariants still apply. This control changes only future wall input; it does not repair or reinterpret existing geometry.

## DEV22 — Manual terminal-to-space association

Schema version `8` stores manual associations from one assignable MVHR supply or extract terminal port to one room. Schema version `9` extends the target to a child ventilation zone. The command validates typed port role, stream compatibility and floor identity and moves an endpoint atomically between targets. A partitioned parent room cannot compete with its child zones for the same semantic assignment; terminals target the zones instead. Removing an association is explicit.

This is spatial design metadata only. It does not infer airflow, terminal quantity, duty, pressure loss, compliance, product suitability or commissioning state. Components with several eligible dwelling ports are not treated as single-room terminals.

## DEV23 — Parent-scoped nonphysical Room Dividers and zones

Use `classification: "virtual"`, `boundaryRole: "room-divider"` wall-graph edges as a topology implementation detail for dashed Room Dividers. Every new divider is explicitly scoped to one confirmed parent room, stays inside or on that room boundary, has no wall height or physical quantity meaning, and is excluded from physical-room face derivation. Legacy schema-8 virtual edges migrate as inert `legacy-virtual` boundaries with no guessed parent.

A valid divider arrangement partitions one parent enclosure into two or more non-overlapping child zone faces whose total area equals the parent room area. Zone areas therefore describe a partition and are never added to the enclosure area. A dangling divider, disconnected loop, overlap, or crossing without shared topology produces diagnostics and no eligible zone partition. Zone creation, naming, use and MVHR role remain explicit; faces are not silently promoted.

Splitting a referenced physical boundary or divider expands affected room and zone boundary references while stable identities and metadata survive. Removing a room is blocked while child zones exist. Deleting a divider referenced by a confirmed zone is blocked until the zone is removed or reassigned. The initial scope does not include doors, openings, arbitrary manual polygons, load calculations, airflow calculations or thermal-boundary claims.

## DEV24 — Independent preliminary Building Outline / Floor area

Schema version `10` adds one renderer-independent `floorAreaOutline` per floor for early quoting before rooms exist. It is a manually authored closed simple polygon in canonical floor-local millimetres with stable outline and vertex identities, a user-entered name, `manual-floor-area-outline` geometry source, `preliminary-quoting` purpose, `closed-plan-outline` convention and no holes. Area, perimeter and centroid are derived rather than stored. Degenerate, repeated, self-touching or self-intersecting polygons are rejected atomically, and the bounded first implementation accepts at most 256 vertices.

The Building Outline is independent from physical walls, confirmed rooms, child zones and imported references. Creating or editing it never creates a wall or room, never changes room/zone totals, never supplies an airflow coefficient and never becomes a thermal boundary. The Plan shell exposes `A` authoring, explicit close/confirm/cancel, snapping, selectable vertex editing, naming, removal, undo/redo, device-local recovery and portable persistence. One outline per floor is deliberate for this increment; multiple outlines, holes, exclusions and automatic derivation from walls or imported drawings remain deferred.

The displayed area is a preliminary plan-outline quantity, not certified treated floor area, usable floor area, net internal area or a PHPP result. Without a calibrated PNG or an explicitly reviewed bounded DXF unit choice, the shell states that the value relies on manual project-grid millimetres and is not reference-verified. Floor-reference model rescaling includes the outline's XY vertices alongside wall nodes, while service-geometry blocking remains unchanged.

## DEV25 — Explicit camera-only Pan tool

Expose Select and Pan as persistent primary toolbar actions in both Plan and Ventilation. Pan uses a square `P` glyph as its visual identifier, not a keyboard-shortcut promise, and does not replace the canvas cursor with a hand. Retain a synchronized Pan entry in the View panel; both controls address the same active-tool state. While Pan is active, primary-button dragging changes only the shared SVG camera; it does not select, move, create, persist or add an undo entry for any project object. `Escape` and `V` return to Select. Existing middle-button dragging, temporary Space-dragging, arrow controls, wheel zoom and Fit remain available.

This is a reversible shell interaction default over the renderer-independent camera and does not change the project schema, canonical geometry, saved draft, portable file or drawing revision state.

## DEV26 — Versioned local catalogue foundation and evidence split

Keep the bounded catalogue metadata in `src/editor/component-catalogue.mjs` as version-controlled structured JavaScript records. Each record has a stable catalogue ID, catalogue version, record ID and record-version ID; category/group; optional manufacturer and exact product identifier; evidence status; millimetre dimensions where evidenced; drawing symbol; typed local ports where evidenced or explicitly generic; and separate pricing/performance objects. Commercial prices are not copied into this module: price amount, currency and source revision remain `null` with status `private-source-not-imported`. The supplied commercial workbook and dimensional PDF remain outside the repository and outside the localhost server's allowed roots.

Placing a component copies a `catalogueSnapshot` into the authoritative project with the catalogue/version identifiers, product identity, evidence status, dimensions, symbol and port definitions used at placement time. A later catalogue update therefore cannot silently change an existing design. This is the bounded portable-file version-pinning mechanism; it is not a server catalogue revision, approval event or immutable issued-design snapshot.

The supplied Q350/Q450 page verifies a shared 725 × 570 mm plan body, 745 mm body height, 849.7 mm overall height with top connections, and the distinction between DN160 internal and DN190 external connection dimensions. Four Q350/Q450 product identifiers from the sanitized internal list use this drawing envelope. They remain non-routable because the supplied evidence shows left/right variants but does not safely establish the typed local port-role map. Combined Q350/Q450 with CW320, CW420 and CW520 arrangements on page 2 are reference layouts, not individual ComfoWell product geometry or proof of a particular mounting-set/mating interface.

Aerofresh, ComfoWell, TVA/Luna, semi-rigid, EPP and flexible-duct product identifiers/descriptions are stored as non-placeable candidates until geometry, typed ports and exact compatibility are evidenced. Generic test records supply a routable MVHR unit, separate supply/extract attenuation-distribution fixtures, DN90 supply/extract terminals and DN160 EPP inline fittings. Generic route classes cover DN90 semi-rigid, DN125/DN160 rigid EPP and DN150 flexible duct. Interface family plus nominal size is checked when both endpoints provide it; nominal size remains distinct from bore, outside diameter and mating profile.

Apply the owner's installation rules as explicit validation policy: Aerofresh 300 uses nominal EPP 125 mm and permits remote-via-EPP only; Aerofresh 450 uses nominal EPP 160 mm and permits direct/unit-mounted or remote-via-EPP; the current Q350/Q450 scope uses nominal EPP 160 mm. Direct mounting still requires verified compatible CW variant/adapter, support, clearance and port evidence. Two attenuators are recorded as typical information only and are never automatically placed or counted.

The owner approved adding Q600 to the system on 20 October 2026. Catalogue version `2026-10-20.1` therefore adds `ZEN-Q600HRV` and `ZEN-Q600ERV` as non-placeable evidence candidates only. The research workbook verifies four connections with 180 mm inside diameter and 200 mm outside diameter, but the supplied descriptions say TR while the located manufacturer documentation describes ST and states that rotating TR connections are unavailable on Q600. No Q600 body geometry, typed port map, route family, adapter, ComfoWell selection, mounting policy or product compatibility is inferred until that conflict and the physical interfaces are resolved. Existing project snapshots remain pinned to the record and catalogue versions stored when they were placed; the catalogue update does not rewrite them.

## DEV27 — Separate Catalogue browsing and explicit connection demand

The owner approved the compact catalogue UX increment on 20 October 2026. Keep the authoritative component records unchanged and expose them through two bounded surfaces: a separate read-only Catalogue tab for browsing evidence and placeability status, and a compact category-to-product Parts picker beside the Ventilation drawing. Category icons and product thumbnails are code-native presentation only; they are not manufacturer imagery or evidence.

Schema version `11` adds nullable `ductRunCount` user intent to eligible single-port supply/extract terminal components. A value must be an integer from 1 through 12; `null` remains explicitly unknown. Supply and extract demand summaries count outlets and known runs independently, preserve outlets whose count is pending, and never convert a run count into airflow, pressure, route geometry, quantities or product compatibility. The suggested sequence is outlets first, but HRV placement remains available before rooms or outlets exist.

No ComfoWell assembly is recommended from outlet count alone. The UI states `evidence pending` until actual endplate capacity, diameter, adapter and exact unit compatibility evidence is verified. Existing component snapshots are never swapped when the catalogue changes. Run-count commands participate in the existing undo/redo, device-local recovery and portable-project boundaries; they do not create a snapshot, drawing revision, hosted save or engineering approval.

A hosted shared product database, private company pricing store, custom-part administration workflow and Plandroid-style catalogue editor remain proposed later architecture. None is created, connected or claimed here.

## DEV28 — Generic remote attenuation assemblies and grouped equipment intent

Schema version `12` adds `equipmentAssemblies` as explicit renderer-independent project objects. Each assembly owns a stable ID, floor, template, name, MVHR stream, remote-via-rigid-EPP installation mode, ordered member-component IDs, internal connection IDs, evidence state and a local service-zone envelope. Member components remain ordinary authoritative components with canonical XYZ, full quaternion orientation and typed local ports; the assembly references rather than duplicates their geometry. Internal joins are ordinary explicit typed connections, never inferred from visual contact.

Provide separate generic supply and extract remote templates. Each atomically places a synthetic round end plate, synthetic attenuator and synthetic six-port radial plate with two explicit internal connections. Their `generic-cw-module` interface, 320 mm designation, plan symbols and service zone are workflow placeholders only. Assembly-only parts cannot be placed independently through catalogue creation. Nothing in these templates identifies a CW-P, CW-S or CW-M SKU, proves acoustic duty, capacity, support, access clearance, adapter fit or compatibility with Q350/Q450/Q600 or Aerofresh units. Real kits remain gated by DEC03 evidence.

Moving or rotating any selected member acts on the complete assembly about its derived member centroid; attached route endpoints follow the same authoritative port transforms. Explicit equipment elevation applies to every member, and clearing it restores an explicit unknown rather than zero. Direct member-only move, rotation or elevation commands are rejected. The service zone rotates and moves with the group but remains visibly labelled provisional and non-manufacturer-verified. Schema-11 migration adds an empty collection and invents no assembly from existing independent parts.

## DEV29 — Confirmed active-floor ventilation clear

Provide one destructive-looking control in the Ventilation Parts panel, labelled **Clear ventilation on this floor…**. Before committing, name the active floor and report the exact numbers of parts, outlets, equipment assemblies, ducts/routes, direct connections, room/zone associations and explicit outlet-run settings that will be removed. The empty state is disabled and the domain command is also guarded against an empty no-op.

Execute the accepted action as one `ventilation.clearFloor` command. It removes components and equipment assemblies assigned to the active floor, routes assigned to that floor, direct connections whose two component endpoints are on that floor, and terminal associations that reference the removed components. It preserves floors, nodes, walls, rooms, zones, floor-area outlines, imported references, calibration, camera state, catalogue snapshots, all other-floor ventilation objects and every other building object. The command therefore participates in exact single-step undo/redo, device-local recovery and portable-project persistence without changing schema version 12.

A direct connection with exactly one endpoint on the active floor blocks the operation and is reported by stable ID; the command never deletes across a floor boundary. This workflow is a drafting reset only. It creates no hosted save, immutable snapshot, drawing revision, engineering approval or product-compatibility claim.

## DEV30 — Explicit generic HRV routing affordances

Keep the existing generic HRV fixture as the only routable unit baseline: four explicitly role-typed generic DN160 rigid-EPP ports for dwelling supply, dwelling extract, outdoor intake and outdoor exhaust. Show each port's role, nominal size and free/connected state on the plan. When a route family is active, visually distinguish compatible free ports from occupied or incompatible ports and report the actual reason when a click is rejected.

Make the Parts picker state the evidence boundary before placement. The generic unit is identified as the four-port drafting HRV. Q350/Q450 records remain placeable body setouts with **no routable ports** because handed role mapping is unresolved; Q600 and the remaining evidence candidates stay non-placeable. No generic port coordinate, colour or label is promoted as manufacturer geometry.

The supported generic path is DN160 rigid EPP from the generic HRV dwelling-side port to the matching remote supply or extract assembly main, followed by DN90 semi-rigid from an available radial branch to a same-stream outlet. Route role, stream, interface family and nominal size must match. Any transition requires an explicit future adapter object; the application does not infer one, and the workflow proves no acoustic duty, pressure loss, capacity or product compatibility.

## DEV31 — Read-only placed-parts summary and connection checks

Derive a live active-floor audit from the authoritative component, equipment-assembly, route and direct-connection graph without storing a second result in the project. Count every placed component record exactly once. Report equipment assemblies separately as organisational groups whose constituent part records are already included in the component count; a group is never an additional quantity. Group routes by their declared family and report drawing-centreline plan length. Report developed length only when every route elevation is known; otherwise preserve it as unknown.

Use typed graph reachability for actionable drafting checks. A generic HRV dwelling supply/extract port and each assembly main require a route to the matching side; a single dwelling terminal requires a route to the correct generic HRV side and an explicit duct-run count. Detect free route ends and legacy endpoint/interface transitions that require an explicit adapter. Include explicit assembly internal connections in reachability so constituent boundaries do not create false disconnections.

Unused DN90 radial manifold branches are spare capacity, not faults. Show them separately and do not infer that a cap, plug or any particular installation treatment exists. Branded Q350/Q450 body setouts remain visibly non-routable. The Checks task is read-only and can focus a flagged component in Ventilation, but it cannot add, replace, route or price anything automatically. Its output is drafting count and connection topology only: it is not a BOM, procurement list, airflow calculation, pressure-loss calculation, acoustic result, compliance result, product-fit validation or technical approval. This query changes no project schema or persisted drawing state.

## DEV32 — Q350/CW320 evidence gate before real connectivity

Catalogue version `2026-10-20.2` records the newly reviewed Q350/CW320 evidence without promoting it to product compatibility. Q350/Q450 setout snapshots now retain four 160 mm inside / 190 mm outside connections, rotating top-or-side configuration, 280.5 mm front-to-rear row-centre spacing and a 123 mm rear-row offset. Their coordinate origin, individual local coordinates and handed role map remain explicitly unverified, so the records still have no typed routable ports.

Store CW-K320 mounting-set, CW-S320 attenuator, CW-M320 6 × 90 radial-plate and CW-P320 DN160 named setout dimensions as non-placeable catalogue evidence candidates. The mounting-set source supports its relative dimensions and two nominal 160 mm connections; the attenuator uses rectangular ComfoWell module interfaces and needs separate end plates; the radial plate lacks edge-to-first-centre dimensions; and the round plate lacks an exact port centre. Local product-code to manufacturer-article/variant crosswalks and all mating profiles remain unverified.

Keep direct-unit-mounted and remote-via-EPP arrangements as explicit evidence queries rather than placeable templates. The direct source supports only a depicted Q350/450 plus paired-CW320 envelope and relative mounting-set information. The remote sources support selected component dimensions and the owner's nominal EPP 160 policy only. Neither path may create real ports, connections or assembly objects until exact articles/variants, unit port roles and coordinates, interfaces/adapters, supports, seals and service/access clearances are verified. This evidence-only increment changes no project schema, existing component, saved draft or generic test assembly.

## DEV33 — Q350 handed drawing connectivity without installation approval

Catalogue version `2026-10-20.3` adds four explicit Q350 TR drawing profiles: sensible and enthalpy, each with a user-selected supply/extract-left or supply/extract-right arrangement. The official manufacturer dimensional and air-direction drawings establish a 580 mm horizontal centre spacing, 280.5 mm front-to-rear row spacing, 123 mm rear-row offset, DN160 inside / 190 mm outside connection dimensions, and the SUP/ETA/ODA/EHA role at every centre for each handed arrangement. Use the reversible local drawing convention of the 725 × 570 mm plan-body-envelope centre as `(0,0)`, `+x` right and `+y` front. The exact local centres are therefore left rear `(-290,-162)`, left front `(-290,118.5)`, right rear `(290,-162)` and right front `(290,118.5)` millimetres. These are calculations from explicit manufacturer dimensions, not measurements from pixels.

The drawing profiles expose typed ports and may participate in a nominal circular-DN160 drawing route. Preserve the physical port family (`zehnder-q-tr-rotating-round`) separately from the generic rigid-EPP family. A shared `circular-dn160` drawing class allows a route only when its connection interface is explicitly `drawing-only`; its saved interface also records installation compatibility as `unverified`. This is topological drafting evidence, not proof that an EPP duct, sleeve, adapter, seal or other product mates directly to the unit.

Manufacturer articles `471502110` (sensible) and `471502111` (enthalpy) and ComfoWell articles `990323644` (CW-K 320 Q350/450 TR), `990323501` (CW-S 320), `990323613` (CW-M 320 6 × 90) and `990323512` (CW-P 320 DN160) are retained as source-backed manufacturer identities. Their crosswalk to the local `ZEN-*` catalogue codes remains unverified. The official ComfoWell drawing supports the named Q350/450 TR mounting set and its two DN160 centres, but the application still does not create a branded ComfoWell assembly: local crosswalk, authored constituent topology, field configuration, mating detail, supports, seals, access and service clearances remain open. The remote path additionally lacks an exact dimensioned CW-P round-port centre, absolute CW-M branch-centre offsets and an evidenced EPP/adapter chain.

The downloaded official Zehnder BIM toolkit was inspected read-only as a 2023 Revit template. It did not expose a portable Q350/ComfoWell exchange model or readable family metadata with the available local tools, so it supplied no additional geometry or compatibility claim. This increment changes no project schema and does not rewrite previously placed catalogue snapshots.

## DEV34 — Position-derived terminal space and single/twin duct intent

Schema version `13` extends terminal associations with a `spatial` assignment method while preserving existing `manual` associations. When the shell places or moves one eligible MVHR supply/extract terminal, the same atomic command removes its prior association and assigns it only when the terminal origin lies strictly inside one current, compatible confirmed space. A confirmed child ventilation zone takes precedence over its partitioned parent room. A point outside, on a physical-wall or divider boundary, in an ambiguous overlap, in an unconfirmed partition face, or in a space with an incompatible ventilation role remains explicitly **Unassigned**. Moving a terminal and changing its association is therefore one undoable action. The saved association continues to reference the stable room or zone ID; the visible label is derived as `Space name · Supply/Extract`.

Manual room/zone selection remains an explicit override. Spatial association does not infer airflow, duty, terminal quantity, route geometry, pressure loss, compliance or product suitability. It uses the terminal component origin in canonical floor-local millimetres; body/port extents and ceiling-service geometry remain later work.

Replace free numeric entry in the shell with direct **Single duct** and **Twin duct** choices. They persist the existing numeric domain intent as `1` or `2`, so demand and audit calculations remain unchanged. `null` remains unknown and **Clear** restores it. The schema-11 domain continues to accept previously saved values through 12 for backward compatibility; values beyond two are displayed as legacy/custom and are not newly authored by this shell.

## DEV35 — Selectable drawn routes and separate parallel-run intent

Schema version `14` adds nullable `parallelRunCount` to a drawn route. `1` means **Single duct**, `2` means **Twin duct**, and `null` preserves an existing route whose drawn arrangement has not been reviewed. This is distinct from schema-11 `component.ductRunCount`, which records outlet demand on a terminal. Editing one never silently rewrites the other. The route command changes only this drawing-intent field; centreline points, typed start/end attachments, stream, role, family, interface, terminal demand and custom legacy demand counts are preserved through undo/redo, local recovery and portable interchange.

Make saved routes selectable in Ventilation with a 12 CSS-pixel screen-space tolerance on either side of the centreline. The shell uses both a transparent non-scaling SVG hit stroke and a deterministic nearest-centreline fallback measured in client pixels, so the acquisition tolerance remains stable at different camera zooms. Components and ports retain selection priority where they overlap a route. The selected route inspector exposes family, stable ID, service, endpoint identities, centreline geometry and the separate Single/Twin/Not set choice.

The current renderer remains a schematic centreline renderer: fixed display stroke, polyline joins and no fitting bodies. It does not yet draw duct outside diameter to model scale, bend radii, couplers, reducers or two visible parallel bodies. The next bounded rendering increment should derive disposable display geometry from the authoritative centreline and evidenced nominal route size: one scaled-width body for Single and two parallel bodies for Twin, with original HiPer Studio colours and selection treatment. Corners may use a clearly labelled schematic rounded join until an explicit bend/fitting object with verified geometry exists. The renderer must not invent a product fitting, bend radius, separation clearance, pressure loss or installability, and its derived outlines must never replace the centreline or connection graph as project authority.

## DEV36 — Scoped component deletion and editable route centrelines

Component deletion is one explicit `component.delete` command. Before it can execute, the UI presents and the command carries the exact current IDs of the selected component scope, any containing equipment assembly, every route attached to that scope and every direct connection touching it. The domain rejects a stale or incomplete confirmed scope. An independent component deletes alone; selecting one assembly member deletes the complete atomic assembly because member-only removal would leave invalid assembly membership and internal connections. Attached routes and touching direct connections are removed, terminal room/zone associations are cleared, and components at the opposite ends of those routes remain. Floors, walls, wall nodes, rooms, zones, building outlines and reference plans are never included. The complete confirmed action is one undo/redo and local-recovery step.

Newly authored routes carry `parallelRunCount: 1` from the route-commit user intent, so **Single duct** is the drawing default. Existing saved `null`, Twin and terminal legacy/custom counts are not migrated or rewritten. Terminal demand remains separate from the drawn-route arrangement.

Selected-route editing uses three explicit commands: insert one intermediate point on a named segment, move one intermediate point in floor-local XY, or remove one intermediate point. Start and end indices are rejected by the domain, so typed endpoint attachments remain authoritative and cannot be silently detached. Segment `+` controls insert a midpoint; draggable round handles edit intermediate points and commit only on pointer release, producing one undo entry rather than a command per pointer movement. An inserted elevation is deterministically interpolated only when the existing segment elevations are known or assumed; otherwise it remains explicitly unknown. Plan length is derived from the saved centreline after every edit. This is still schematic route geometry and does not infer bends, fittings, developed installation length, clearance, pressure loss or product fit.

## DEV37 — Scaled schematic duct bodies and bounded visual sweeps

Keep the schema-14 route control polyline, endpoint attachments and typed connection graph authoritative. Derive disposable SVG duct bodies from them. When the saved route interface or route family has a known outside diameter, use that width at plan scale. When only nominal DN is known, use the nominal value as a labelled drawing guide and state that it is not an outside installation envelope. A legacy generic route with no known diameter remains centreline-only. **Not set** remains distinct from Single and is displayed as a dashed pending body rather than silently rewritten.

Render route controls as a bounded quadratic visual sweep. At each eligible interior control point, trim at most 25% of each adjacent segment and sample the quadratic sweep eight times. The curve remains within the local entry/control/exit triangle, preventing overshoot; adjacent trims cannot consume a complete segment. Duplicate or exact reversal sequences remain safely unswept and are diagnosed in the inspector rather than choosing an arbitrary loop side. The visual sweep preserves the exact connected start and end positions. Store no curve points in the project. Continue to report saved polyline centreline length as the authoritative drafting metric and show the derived visual-sweep length separately as display-only; neither is a developed cut length.

Single draws one scaled body. Twin draws two offset copies of the visual sweep with a reversible display-only gap of `0.6 × diameter`; this is intentionally legible on screen and is not installation clearance. Each Twin lane tapers back to the single authoritative start and end coordinate so the renderer does not imply two typed equipment ports. No splitter, junction, fitting or compatible twin connection is inferred. Clamp visual offset mitres to twice the lane-centre offset, retain round stroke caps/joins only as raster finishing, and use the sampled sweep itself—not the stroke join—as the visible route shape.

Use the established HiPer Studio service palette: blue supply, terracotta extract, green outdoor intake and plum outdoor exhaust. A white underlay distinguishes crossings; crossing remains visual overlap and never creates connectivity. Selection and the non-scaling hit target follow the derived sweep, while add-point controls and draggable handles remain tied to the authoritative control polyline. These rules make no manufacturer bend-radius, fitting, pressure-loss, clearance, support, acoustic, compliance or approval claim and do not change sheet/PDF output in this bounded phase.

## DEV38 — Evidence-aware placed-parts and measured-duct schedule

Derive the active-floor schedule read-only from the validated project. Count every placed component record once and group only identical saved catalogue/record-version identities; an equipment assembly remains an organisational group and never adds another quantity. Classify each line as **verified catalogue**, **source-backed provisional** or **unmatched provisional**. The first class is reserved for an explicit verified regional catalogue-match status; neither a familiar name, matching nominal size nor a current catalogue lookup promotes a saved component into it. Existing generic fixtures and branded drawing profiles therefore remain provisional.

Catalogue `2026-10-20.4` records official manufacturer article evidence for `990323644` CW-K 320 Q350/450 TR, `990323501` CW-S 320, `990323613` CW-M 320 6 × 90/P and `990323512` CW-P 320 DN160. The official source identifies the mounting-set purpose, attenuator module, six-ComfoTube-90 mounting plate and DN160 round-duct end plate respectively. The Australian `ZEN-*` crosswalk, regional availability, selected field configuration, EPP mating/adaptor chain and installation compatibility remain unverified. Generic remote-assembly constituents may show these as reference candidates only; they are not silently replaced, counted or made orderable.

Measure each route from its saved authoritative control-polyline centreline. Single multiplies that centreline by one and Twin by two. An unset route arrangement contributes its centreline to an explicit pending subtotal and contributes no invented multiplied quantity. Developed quantity is complete only when elevation and run multiplier are both known; otherwise retain a known subtotal and an incomplete state. Visual sweeps, display-only Twin spacing, bends, fittings, couplers, waste and installation allowances never alter schedule length or create inferred parts. The schedule is a drawing quantity report, not a price, order, fabrication or engineering BOM.

## DEV39 — A3 schedule sheet and browser print boundary

Template `hiper-a3-manual-plan-v2` captures one validated committed-project clone, the DEV38 schedule and disposable smooth route geometry into a deterministic A3 landscape SVG. Reserve the lower-left schedule band for component and duct lines, leaving the established right-side title/legend block. Components carry deterministic `P` references and routes carry `D` references that link the plan to the schedule. The sheet uses the service palette and prints Single as one smooth body and Twin as two smooth bodies converging to the one authoritative endpoint; it does not store or promote render geometry.

The schedule band shows at most fourteen lines and replaces any overflow with an explicit count and direction to the complete in-app schedule; it never silently implies that omitted display rows are absent from the model. Numeric fit still derives from canonical millimetres and is forced to NTS when an uncalibrated reference is visible. Browser print uses an A3-landscape zero-margin stylesheet and the SVG's physical millimetre dimensions. The drawing tells the user to print at 100% and verify physical scale because printer drivers and browser fit settings remain outside application control. This is still a working draft, never an issued revision or production PDF pipeline.

## DEV40 — Shared Q350 technical plan appearance

Render the four explicit Q350 sensible/enthalpy left/right drawing-profile records through one presentation-only plan-graphic descriptor. Identification uses each component's stable saved catalogue record ID, so previously saved `box` snapshots receive the improved appearance without rewriting their snapshot, catalogue version or project schema. The descriptor reads the 725 × 570 mm envelope and each port's local position and interface dimensions from the saved component. It does not own or replace geometry.

The code-native vector convention is a strict plan view: square rear corners, rounded front casing corners, a neutral top/access-panel treatment, four dark rotating-collar outlines, service-tinted bores, SUP/ETA/ODA/EHA codes, Q350 and LH/RH identification, a front-direction cue and a restrained manufacturer-red orientation badge. The official Zehnder dimensional/air-direction pages establish the body, DN160/190 collars, port centres and handing. The official product image informs only the recognisable casing, panel and colour treatment; perspective is not copied into the plan symbol.

The editor and A3 sheet derive their graphics from the same descriptor. Rotation applies to the entire symbol, while interactive selection and the existing coloured port targets continue to use the component and port identities already in the model. Attached route endpoints still derive from `floorPortTransform`; visual collar overlap never creates a connection. The symbol makes no service-clearance, side-connector configuration, adapter, seal, support, pressure-loss, product-fit or installation-compatibility claim.

## DEV41 — One-shot MVHR-unit placement

After one `mvhr-unit` or `mvhr-unit-drawing-profile` component commits successfully, return the shell to Select and leave that exact new stable component ID selected. This makes immediate move, rotate, inspect or delete actions unambiguous and prevents the next ordinary canvas click from placing an accidental duplicate unit.

Apply the transition only after the authoritative `component.add` command succeeds. A rejected command restores the prior placement state, and an incomplete/cancelled operation creates no component. Terminal, fitting, duct-accessory and other component categories retain repeat placement. This interaction policy changes no project schema, component snapshot, command-history entry, port coordinate, route attachment, device-local recovery or portable-project content.

## DEV42 — Acquirable remote EPP drawing endpoints

Keep route compatibility and occupancy decisions in the existing typed controller and domain validation. Acquire a route endpoint by the nearest authoritative component-port centre within a minimum fixed 12 CSS-pixel radius, independently of camera zoom. Convert model/view coordinates through the SVG's centred `preserveAspectRatio` mapping, including any horizontal or vertical letterbox offset; scaling X and Y independently by the canvas rectangle is incorrect. The nearest stable component/port identity is resolved before compatibility validation, so visually compressed neighbouring ports do not bypass stream, role, interface or occupied-port checks.

Where a saved port interface carries an evidenced outside diameter, expand acquisition to the full displayed outside radius when that radius exceeds 12 CSS pixels. Q350 therefore accepts a click anywhere inside its saved 190 mm outside collar, not only near the smaller centre marker. For `circular-dn160` drawing-class ports, render a presentation-only target that uses the same minimum/evidenced-radius rule. The target changes no model coordinate, interface, connection, route geometry or persistence field and does not turn nominal DN into an outside-diameter claim where no outside diameter is saved.

Label the generic remote assembly's one free rigid-EPP end-plate connection as `Supply EPP DN160` or `Extract EPP DN160`. The adjacent rectangular module ports remain visibly occupied by the assembly's explicit internal connections and cannot accept an EPP route. Correct-service Q350 drawing-profile to generic remote-end routes remain permitted in either authoring direction across the explicit drawing-only class. Wrong stream/role, occupied port, nominal-size and unsupported-interface rejections are unchanged.

Pinned generic remote assemblies saved before the drawing-class field was introduced may expose only their physical `rigid-epp` family and nominal 160 mm size. For this narrow compatibility case, an explicitly selected route whose own interface is `drawing-only` may bridge two endpoint-interface families only when that route interface independently matches both endpoints. This keeps Q350 `circular-dn160` to legacy `rigid-epp` DN160 drawings reopenable without weakening physical/direct compatibility: compatibility-free legacy routes, wrong sizes, unsupported families, wrong services and occupied ports still reject. The saved route retains its explicit drawing-only interface rather than rewriting either pinned component snapshot.

This is a drawing-acquisition correction, not product evidence. The route continues to save `connectionScope: drawing-only` and `installationCompatibilityStatus: unverified`; no direct mating, adaptor, sleeve, seal, support, clearance, pressure-loss or installation compatibility is inferred. The screen-space picker is also used when the pointer lands on a component graphic or blank canvas inside the visible collar, preventing an intended second endpoint from being silently stored as another free route point. A successful hit commits the saved endpoint to the authoritative rotated port centre rather than the clicked rim location.

## DEV43 — Scale-true generic CW-inspired assembly graphics

Use the official Zehnder ComfoWell 320 technical specification only for the verified component envelopes and modular form language. CW-S 320 has a 500 × 320 mm plan body and 230 mm height; its separately stated 350 mm dimension includes mounting projections and is not drawn as casing. CW-P 320 has a 336 × 230 mm face, 51 mm projection and one nominal DN160 connection. CW-M 320 6 × 90/P has a 336 × 230 mm face, 41 mm projection and a source-backed 2 × 3 branch pattern at 102.5 mm pitch. The CW-P exact round-port centre, CW-M absolute edge-to-first-centre offsets, installation orientation, connector outside dimensions, adaptor/mating chain, supports, seals and clearances remain unresolved.

Catalogue `2026-10-20.5` therefore source-sizes newly placed **generic** remote assembly envelopes to 51 + 500 + 41 = 592 mm along the modular axis and 336 mm maximum plate width. Internal module endpoints remain coincident after placement and rotation. The six radial logical centres and the generic DN160 endpoint remain synthetic routing anchors; they are not promoted to manufacturer geometry. Nominal DN160 is not rendered as a known outside diameter, and connector protrusions are excluded from the verified body envelope.

Render the three parts with one native-vector descriptor shared by the editor, placement ghost and A3 sheet: separate folded/clamping rails, an attenuator access panel, a symbolic round-main collar, six schematic radial sockets, service colour and flow direction. Every placed symbol says **Generic CW-style** and **Provisional**. Official CW-K/S/M/P evidence candidates remain non-placeable and retain their separate manufacturer identities; the generic assembly is not renamed or counted as a verified ComfoWell product.

Previously saved v1 generic assemblies retain their pinned 240 / 720 / 240 mm envelopes, positions and port coordinates. They receive the recognisable vector appearance but remain labelled as a preserved legacy generic envelope. Do not silently resize or move an existing design. A user may explicitly replace an old fixture later after reviewing the changed footprint. This presentation/catalogue update changes no project schema, route attachment, Single/Twin intent, physical-fit claim or live device draft.

## DEV44 — Staged local quote-to-design workflow

Schema 15 adds one explicit design-workflow state, editable quote inputs and immutable local conversion snapshots. The stages are **Quick quote**, **Preliminary layout**, **Converted project** and **Detailed design**. Migration assigns room/zone-bearing schema-14 projects to Detailed design, ventilation-bearing projects without rooms to Preliminary layout, and otherwise to Quick quote. It never invents a quote, price, snapshot, room, flow or equipment quantity.

Quick quote uses the existing upload, two-point calibration and canonical-mm floor-area outline tools across floors. The explicit sequence is upload floor plan, set scale from a known dimension, close the external serviced-area perimeter, then mark up MVHR equipment and routes without rooms. Garage, alfresco and other out-of-scope items remain explicit text exclusions. Floor area is geometric evidence in m²; DEV44 defines no price-per-m², allowance or percentage-markup formula. Legacy saved commercial fields remain readable for non-destructive compatibility but are not exposed or required by this workflow.

Preliminary layout keeps the same stable component, equipment-assembly and route records and permits them without rooms. Conversion creates at most one snapshot, freezes the area basis and preliminary object/run counts, and points the project workflow at that snapshot. Repeating conversion is idempotent. Later scope notes, rooms, assignments or system changes cannot rewrite the snapshot. Detailed review compares current outlet, route, component, assembly and known-run counts with the baseline; it never moves, replaces or adds equipment automatically.

After rooms or child zones are confirmed, one explicit undoable command may assign each currently unassigned eligible terminal to exactly one compatible containing space. Boundary, outside, ambiguous or incompatible terminals remain unassigned. No airflow or manufacturer capacity rule is inferred; those remain unresolved under DEC03/DEC04. The Project workspace is a local authoring aid only and creates no account, entitlement, payment, issue revision, external message or hosted service.

## DEV45 — Named browser-local project library

Keep the journaled working draft as reversible crash recovery, but do not present its automatic writes as an explicit named-project save. Add a separate browser-local library whose entries use the validated project's stable opaque ID as their storage identity and a user-editable name as presentation metadata only. Duplicate names are allowed. Rename preserves the ID; Save As validates an exact project clone under a new cryptographically random ID; New starts from the clean initial floor fixture. No delete action is introduced in this increment.

The library index and every named project checkpoint use staged/current/previous journal records. A write is acknowledged only after the staged value and promoted current value re-parse successfully. A failed explicit Save leaves the UI dirty and retains the last discoverable named checkpoint. On first use, a valid legacy single draft is copied into the named library as **Recovered project** without removing or rewriting its original recovery journal.

New, saved-project Open, Save As, startup reopen and portable-project Open all land on the Project workspace. Switching away from dirty committed work or an incomplete interaction requires an explicit Save, Discard or Cancel choice; Cancel leaves the current project, tab and in-progress state intact. All project-library language says this browser/device only and makes no cloud, account, multi-device or full-offline promise. Portable export/open remains the explicit backup and transfer boundary.

## DEV46 — Bounded local PDF page-reference import

Use Mozilla PDF.js `6.4.299` as the one approved local rendering dependency for PDF floor-plan references. Its worker, character maps, standard fonts and WASM resources are served only from the localhost allowlist under `node_modules/pdfjs-dist`; no PDF, font, annotation or other content is uploaded or fetched from an external converter. XFA, evaluated PDF JavaScript and system-font substitution are disabled for this path.

Schema version `16` adds original `pdfReferenceAssets` and optional page provenance on existing rendered image assets. One import transaction retains the immutable original PDF bytes, filename, SHA-256, page count and importer version; records the selected page number/label, PDF-point dimensions, intrinsic rotation and renderer version; embeds the selected page as a bounded PNG; and places that PNG as an independent locked, uncalibrated floor reference. The renderer output is a disposable projection beneath the authoritative model. Selecting a page never creates walls, rooms, perimeter, quantities or MVHR objects. Adding the same source again creates an independent reference; replacement is not inferred.

The reversible initial limits are 12 MiB per PDF, four PDF sources and 20 MiB total source bytes per project, 100 pages per PDF, 4,096 pixels on either rendered axis, 12 million rendered pixels and 5 MiB for the resulting PNG. The initial desired render scale is two pixels per PDF point and is reduced proportionally when necessary to respect those limits. Authored PDF page rotation is honoured by PDF.js. Page-relative crop is added separately by DEV51; manual page rotation, arbitrary masking, multi-page placement in one transaction and a second calibration check remain separate increments.

Password-protected, malformed, empty and over-limit PDFs fail before project mutation with explicit errors. Page changes only replace the pending preview. **Cancel** destroys the pending PDF document and changes no project data. **Place selected page** is one atomic domain command. Two-point calibration then operates on the rendered page exactly as it does on a PNG, keeping reference-only scale separate from any explicit eligible floor-geometry rescale.

Named local save/reopen stores both source and render provenance. Portable export/open re-hashes the original PDF and rendered PNG, reparses the PDF locally with the pinned adapter, and compares page count, selected page dimensions and rotation before accepting the package. A PDF-bearing portable package cannot be exported or opened through a caller that omits the PDF verifier. This is local working-draft recovery and interchange, not general PDF compatibility, a production issue-PDF pipeline, cloud storage or approval evidence.

## DEV47 — Joint-level catalogue provenance and accessory evidence

Catalogue `2026-10-20.6` pins manufacturer article candidate, local-code crosswalk state and handing into new placed-component snapshots where those facts exist. Version-3 generic remote end-plate, attenuator and radial-plate records remain synthetic fixtures, but now pin two distinct provenance statements: the HiPer synthetic-fixture source owns the logical ports and topology, while the official ComfoWell 320 technical source owns only the recorded component envelopes used for drawing scale. Existing v1/v2 saved members, geometry and ports are never rewritten.

Derive one read-only connection/accessory evidence record for every saved route and direct connection on the active floor. Each record carries endpoint identities, typed interfaces, pinned catalogue record/version, source identifiers, known drawing dimensions and connection-setout facts. Classify the persisted joint as incomplete topology, explicit transition required, drawing topology only, synthetic fixture only or installation evidence incomplete. Matching nominal size or the shared Q350/EPP drawing class may support drawing topology; neither establishes a physical joint.

For every unresolved joint, report the evidence still required to make an installation decision: exact mating profiles; confirmation of whether an adapter or sleeve is required and its identity if so; seal/retention method; support method; access/service clearance; selected connector field configuration where applicable; and local-code/manufacturer-article crosswalk where applicable. Synthetic assembly joints additionally require exact product selection, internal-joint compatibility and acoustic-duty selection. The result always contains an empty inferred-accessory list and a null inferred quantity until those gates close. An interface mismatch requires an explicit modelled transition but does not select an adapter.

Expose these records in the existing read-only Checks workspace alongside, not inside, the authoritative topology audit. The query changes no project schema, component, route, endpoint or connection and remains deterministic through canonical save/reopen. It is not an installation approval, material schedule, price, procurement list, pressure result, acoustic result or manufacturer compatibility claim, and it does not close DEC03.

## DEV48 — Explicit room airflow targets and arithmetic balance

Schema version `17` adds separate **required** and **assigned** Normal-mode airflow targets to every room and child ventilation zone. Each target is either explicitly unresolved or stores the user's positive input value, its input unit (`L/s` or `m³/h`), canonical litres per second, a bounded basis and a bounded source. Canonical litres per second must reproduce the saved input conversion exactly enough for validation; a forged or stale derived value is rejected. Known targets are valid only for spaces explicitly classified as supply or extract. Migration adds unresolved targets without changing geometry, stable identities, terminal associations, workflow state, quote snapshots, reference assets or PDF provenance.

The active ventilation space is a confirmed room without child zones, or each child zone when the room has been partitioned. Parent and child areas/airflows are never double counted. Terminal placement and movement continue to associate a compatible single-room terminal with the one unambiguous containing active space by stable identity; the room or zone name is displayed from that association and is not separately re-entered on the terminal. Manual association remains an explicit override. Moving or reassigning a terminal changes coverage only and never moves or rewrites a room target.

Checks totals known required and assigned values separately for supply and extract and reports assigned supply minus assigned extract. If either side is absent or an assigned target is unresolved, the result is **incomplete** and only the known subtotals are shown. When all supply/extract assigned targets are known, the result remains a numeric difference with no tolerance applied. It also reports assigned targets without terminals, terminals without assigned targets and unassigned terminals. Several terminals in one space do not receive an inferred split.

Where Required is known and Assigned is unresolved, the room editor may copy Required into the Assigned form as an explicit suggestion. The project remains unchanged until the user presses Apply; the saved Assigned target records the adoption basis and source. This increment defines no regulatory rate, room-use lookup, terminal allocation, tolerance, compliance verdict, manufacturer capacity selection, pressure result, automatic equipment change or recommendation. Room-free preliminary markup remains valid.

## DEV49 — Manufacturer-duty evidence, unpriced costing and installer-document foundations

Schema version `18` adds a versioned engineering-input envelope with at most one Normal-mode duty per floor. A duty may select one placed MVHR unit by stable component ID and stores external static pressure either as unresolved or as a non-negative Pa value with the explicit `external-static` convention, basis, source and filter condition. Deleting the selected unit clears only that reference and preserves the pressure input/provenance. Migration from schema 17 adds an empty envelope and changes no geometry, airflow, catalogue snapshot, workflow, quote baseline, project-library identity or reference/PDF provenance.

Catalogue performance evidence `zehnder-comfoair-q350-tr-sensible-performance.v2` records two official Q350 statements: 350 m³/h at 200 Pa external pressure and 40 m³/h at 10 Pa external pressure. Page 2 states the maximum in the general Q350 description; page 7 places both statements in the tender specification that explicitly names sensible article 471502110. The reviewed pages identify enthalpy article 471502111 separately but do not explicitly bind the 40 m³/h at 10 Pa statement to it, so endpoint screening is restricted to article 471502110. Treat the statements as exact source-alignment evidence only. A screening input above the 350 m³/h published maximum is blocked. Any other airflow/pressure pair requires a checked fan curve and bounded interpolation method; the statements do not define a rectangular envelope or authorize extrapolation. An exact alignment remains review-required and does not prove measured performance, terminal allocation, installation fit or whole-network suitability.

Do not calculate network pressure from drawing geometry. Current generic DN90/DN125/DN150/DN160 route families have no pinned exact-product loss curves, elevations can be unknown, fittings are not modelled, and placed terminals and generic attenuation assemblies have no selected loss data. Visual sweeps and nominal diameters are presentation/topology facts only. The entered external-static duty remains an external design input, never a result attributed to the drawn network. Calculated network pressure therefore remains `null` with structured blockers.

Derive a product-costing readiness view from exact placed-component counts and saved route quantities, but keep every price, currency, tax, subtotal and total `null` until an authorized, versioned price record and permission boundary exist. Generic/reference-only product matches and unpinned route products block priced status. Never use zero for an unknown price or silently add fittings, waste, pack rounding, labour, electrical work or commissioning.

Derive a deterministic installer-document data foundation from the same working project: room airflow schedule, materials/route schedule, unit-duty/pressure evidence, connection/accessory evidence and one commissioning row per associated terminal. Predicted and measured values start blank and are not copied from targets. With no immutable design snapshot or issued revision, the result remains **working draft incomplete** and cannot be called an issued installer document, construction instruction, technical approval or commissioning record.

## DEV50 — Primary-source pressure-evidence investigation

Record current manufacturer evidence without enabling a calculation that the sources do not support. Official Zehnder ComfoTube Flow technical specification `Z-DE-V0825-CSY-TES-TS010-ComfoTube`, revision `V0825`, identifies the 50 m Flow 90 roll as article `990328101`, with 90 mm outside diameter, 77 mm inside diameter and a manufacturer-marked recommended normal-ventilation maximum of 45 m³/h at 2.7 m/s. Page 3 presents tube pressure loss in Pa/10 m and fitting loss in Pa as graphs only. It provides no tabulated ordinates or interpolation method. The current local `ZEN-CT90-50M` crosswalk remains unverified, so the candidate stays non-placeable and contributes no pressure value.

Official ComfoWell 320 document `CDE-FLYERTS222`, revision `V1116`, states a 240 m³/h family maximum at normal ventilation on page 2. Its page-12 pressure graph is labelled for CW-S 320 with a CW-P DN150 end plate and shows one and two ComfoWell 320 units in series, but supplies no tabulated ordinates. That graph does not match the current named CW-P 320 DN160 plus CW-M 320 6 × 90/P evidence chain and does not define branch split, orientation or interpolation. It is therefore retained as graph metadata only and cannot supply an attenuator/manifold loss.

The Q350 technical specification page 8 contains ten exact airflow/external-pressure pairs used as **sound measurement conditions**. Retain those pairs with their acoustic purpose, but do not reinterpret them as a fan-performance curve or interpolate between them. The page-2/page-7 sensible article statements remain the only active source-alignment screen. No product pressure solver, duct loss, whole-network result, compatibility conclusion or technical approval is added by this investigation.

## DEV51 — Nondestructive PDF floor-plan crop

Schema version `19` adds a nullable `cropSourceRectPx` to each placed image reference. The crop is an axis-aligned rectangle in the selected rendered PDF page's source-pixel coordinate system. It must have positive width and height and remain within the rendered page. Schema-18 projects migrate with `null`, preserving their full-page display exactly. Cropping is limited to PDF-page references in this increment; arbitrary PNG crop and hide-area masks are not implied.

The Plan workflow exposes **Crop PDF floor plan**, **Adjust PDF crop**, **Reset PDF crop**, and **Cancel crop**. Crop editing temporarily reveals the full selected page, maps pointer input through the actual SVG screen transform so zoom and letterboxing are respected, previews the rectangle, and requires a separate Apply action. Empty or out-of-page rectangles cannot apply. Cancel and lost pointer capture leave the project unchanged. Apply and Reset are ordinary undoable domain commands.

Cropping is visibility metadata only. It clips the full rendered image without resampling, stretching or replacing it. Original PDF bytes, checksum, page provenance, render asset, placement transform and calibration remain unchanged. Existing walls, floor outlines, rooms, zones, components and routes are never translated or scaled when cropping or recropping. Fit may frame the visible crop, but that camera change is not project state. Named local save/reopen, portable backup and the A3 working-draft scene retain the crop; A3 bounds and clipping use the same source rectangle while the embedded image keeps its original dimensions. Notes inside the chosen floor-plan rectangle remain visible; arbitrary internal masking is explicitly deferred.

## DEV52 — Current UK distribution-box evidence boundary

Catalogue `2026-10-21.1` adds renderer-independent design-evidence profiles for current UK ComfoWell 320 and ComfoWell 420 revision `2026 V1`. These are separate market/generation records and do not replace, crosswalk or resize the existing Australian/local-code candidates, the generic version-3 assembly, or any saved legacy component snapshot. No project schema changes. The CW420 revision is taken from the page-8 footer `Comfowell420_Technical_Specification_2026_V1` in the downloaded official PDF.

Each profile retains the manufacturer H/W/D envelope for the attenuator, manifold, 90 mm mounting plate and DN160 end plate. The 320 profile records a 6-socket 2 × 3 RapidLock plate; the 420 profile records an 8-socket 2 × 4 RapidLock plate. The source explicitly distinguishes clamping-strip module joints from RapidLock semi-rigid branch sockets. A centred DN160 end-plate connection can be represented at the plate centre, but its installed direction and exact regional duct/adapter mating profile remain unresolved.

Manufacturer component envelopes are not treated as installed plan footprints and are not summed. Complete plan orientation, top/side arrangement, brackets, joint allowances, connector protrusions, service clearance and individual RapidLock socket centres are not fully dimensioned in the reviewed sources. The new catalogue records therefore have no symbols or routable ports and cannot be placed. A read-only inspection returns the intended connection sequence and exact blockers. No airflow, capacity, pressure, loss, compatibility or selection solver is enabled.


## DEV53 — MVHR placement choices outside the tool catalogue

The owner requested a quieter catalogue with horizontal and vertical MVHR tools and a model/arrangement dialog after dropping on the plan. Unit variants now live in that dialog; full source records remain in the separate Catalogue workspace. Demand, floor actions, routing guidance and product evidence are collapsed disclosures. Cancel/Escape commits nothing; Apply creates one undoable unit with the existing pinned catalogue snapshot. Shift/Ctrl on the drop retains repeat placement and remembers choices for the session.

Vertical placement offers existing handed Q350 sensible/enthalpy drawing profiles and the generic fixture. Horizontal placement offers only the explicitly generic planning fixture; the mounting selection is design intent, not a rotation or verified manufacturer mounting envelope. CW-on-unit and remote-attenuator selections persist as `mvhrDesignIntent` on the unit. They do not generate accessories, joints or clearance, and the dialog labels these limitations. No unsupported product compatibility or completed assembly is implied. Detailed installed assembly geometry and reconfiguration of connected units remain future work.

## DEV54 — Aerofresh wall/bulkhead magnetic-cover terminal symbols

Owner reference on 23 October 2026 defines a rectangular grille with three outward arrows in blue for supply and inward arrows in red for extract. Add these as two independently placeable Aerofresh drawing records alongside the existing terminal tools. Live placement, selection, rotation, ghost previews and A3 sheets use one shared vector construction. Existing placed snapshots remain unchanged.

The read-only Rev 6A Price List identity cells A163/C163 and A164/C164 identify housings AER-GR-RECT-BX90R and AER-GR-R-BX90E. A165/C165 and A166/C166 identify magnetic covers AER-GR-RECT-W (cool white) and AER-GR-RECT-S (silver). No private prices are copied. Housing and cover are unselected options, not an inferred kit SKU. The schematic 300 × 260 display extent is not a physical envelope. Body dimensions, port centres, exact interfaces, capacities and losses are unknown; the new symbols have no routable ports or inferred room airflow. Manufacturer geometry and connection evidence are needed to promote these to engineering terminal profiles. Catalogue version 2026-10-23.1.

## DEV55 — Luna grille drawing convention

The owner supplied Luna symbols on 23 October: a heavy circle with five radial arrows, blue and outward for supply, red and inward for extract. Promote the existing Luna supply/extract identifiers to placeable schematic drawing records. Catalogue thumbnails, pointer previews, live drawings and A3 output share the same paths, including a heavier circle and fine arrows. Existing generic terminal records and saved snapshots remain unchanged. Product codes ZEN-GR-LUNA and ZEN-GR-LUNA-EV retain their existing identity sources. Physical diameter, housing geometry, connector centres and interfaces remain unknown; no routable ports, airflow, losses or performance are inferred from the screenshot. Catalogue 2026-10-23.2.

## DEV56 — Mirrored mounted-CW symbols with existing outdoor snap targets

Owner screenshots and follow-up authorize schematic mounted-CW symbols for the handed Q350 drawing profiles. CW320/420/520 render 6/8/10 branch circles per stream. The overlay follows the dwelling side of the selected handed unit; the other side retains the existing intake/exhaust port appearance. The authoritative Q350 ports, stable IDs, coordinates, roles and interfaces are unchanged. Existing outdoor route picking, snapping and rotation therefore use the same domain targets. CW circles are visual conventions only, never invented branch ports, physical mating geometry, procurement quantities or performance evidence. The popup exposes CW size for this arrangement. Saved unit-mounted intentions without a size display CW320 as a reversible renderer default. Generic/horizontal profiles do not offer this Q350-specific overlay.

### DEV56 correction — Horizontal mounted CW modules

Owner correction and supplied Q350/450-with-CW320/420/520 drawing on 23 October establish horizontal schematic branch arrangements. Each stream is drawn as a horizontal module with two rows: CW320 has three columns, CW420 four and CW520 five. Left/right mirrors the whole module. This corrects the initial upright two-column rendering. The reference elevations and isometric view are not promoted to installed plan dimensions. Existing unit outdoor-port geometry, snap identities, interfaces and routes are unchanged.

### DEV56 dimension correction — Constant 90 mm branches and mounted envelopes

The owner explicitly requires true nominal 90 mm branch circles for every CW size. Remove fit-to-panel shrinking: every branch circle has radius 45 mm. The supplied Q350/450-with-CW drawing lists overall widths 791/824/924 mm for CW320/420/520, depth 566 mm and height 1414 mm. The CW520 drawing separately shows a 250 mm below-unit drain allowance; this is not added to plan depth or unit body height. Renderer and A3 bounds retain the asymmetric assembly envelope about the unchanged unit origin, mirrored by handing.

The mounted display uses the explicitly requested 566 mm depth. The older pinned unit-only catalogue body retains its 570 mm depth; these are distinct source dimensions and no saved snapshot or outdoor-port coordinate is rewritten. Nominal circles and overall envelopes are dimensioned; exact installed module offsets, branch centres, regional interface compatibility and clearance remain unverified. The 336/436/536 mm module widths, 230 mm display depth and 102.5 mm schematic branch pitch remain drawing setout only, not approved installation coordinates. CW branches remain visual; outdoor snap points are unchanged.

## DEV57 — Connection labels outside collars

Q350 connection codes sit outside the collar diameter on the corresponding side, with a short leader and white text halo. Live labels retain a readable screen size as zoom changes; connection geometry and hit targets are unchanged. The unit caption sits below the rotated assembly bounds at a fixed screen gap and remains upright. Mounted CW symbols omit the redundant interior Q350/handing text that was covered by the module; the exterior caption retains model, CW size and handing. A3 uses the same outside-collar layout. This does not implement collision avoidance between separate nearby components or routes.

## DEV58 — Aerofresh 450 with CW520

Owner supplies the Aerofresh 450/600-with-CW520 reference, overall 870 × 650 × 1400 mm with a separately shown 150 mm drain allowance below. This increment covers Aerofresh 450 HRV/ERV only. Owner explicitly confirms the same handed role convention as the Zehnder unit. The new drawing profiles therefore have drawing-only nominal DN160 snap targets using that role convention; exact port centres and body dimensions remain schematic. No Q350 physical dimensions, fan data, pressure data or performance are reused. A 650 mm casing display width is a drafting allowance inside the supplied mounted envelope, not a measured body width.

The mounted option exposes CW520 only because other Aerofresh-mounted envelopes have not been supplied. Branch circles retain radius 45 mm. CW branch positions remain visual and non-routable. Left/right mirrors the mounted arrangement and preserves role labels. Aerofresh 300 direct mounting is explicitly rejected by the placement factory and the existing mounting policy; its remote-only catalogue candidates are unchanged pending geometry. Both Aerofresh recovery types retain local price-list identifier provenance and no private prices.

### DEV58 extension — Aerofresh 450 with CW625

Owner supplies a separate 970 × 640 × 1400 mm Aerofresh 450/600-with-CW625 drawing, with 150 mm below-unit drain allowance. Do not reuse the CW520 650 mm depth. Add CW625 to the Aerofresh 450 HRV/ERV mounted selector only. Rev 6A Price List A132/C132 identifies ZEN-MPCWM625-12X90 as CW-M 625 12 × 90; A135/C135 identifies HRV-MSCW-AER450-625 as a CW625 mounting set for Aerofresh 450/600. No prices are imported. Twelve 90 mm branch circles per stream are drawn in two rows of six. Exact module width is unknown; its renderer panel uses a clearly schematic margin around the branch layout rather than promoting the family number to a physical width. The overall envelope is dimensioned; branch centres and physical unit mating remain pending. Aerofresh 600 is a source reference only, not a newly supported model.

### DEV58 extension — AF450 with CW320 and CW420

The owner requests AF450 with CW320/420/520 and confirms CW connection layouts are common across unit brands. Enable all three in AF450 HRV/ERV and both orientations; retain CW625. Branch counts are 6/8/10 per stream and every circle retains 90 mm diameter. All existing AF450 outdoor drawing ports are unchanged.

No supplied AF450 CW320/420 overall dimensions exist. Their physical measured envelopes and heights remain null. For drawing only, hold the existing schematic unit and outdoor side fixed and replace the CW520 panel with the smaller common CW panel. The resulting bounds (670/770 by 650 mm) are explicitly provisional renderer allowances, not sourced installed dimensions; the popup and external caption mark them provisional. No Zehnder overall envelope is applied to AF450 and no product-fit approval is implied. Source provenance names the owner-confirmed shared family, not a nonexistent AF450 dimensional drawing.

## DEV59 — Aerofresh manual sizing audit

Reviewed local INST-AER-300_V1.pdf (February 2026), pages 4, 5 and 45; INST_AER-450-600_V1-1.pdf pages 4, 5 and 43; and Aerofresh HRV Range Brochure 2025_1.pdf page 14. AF300 body is 660 × 443 × 760 mm, with 63 mm spigot protrusion and nominal 125 mm connections. AF450 body is 728 × 608 × 881 mm, with 50 mm spigot protrusion and native 200 mm spigots in the 2025 brochure. The installation manual labels AF450 horizontal centres 393 mm; the brochure labels 394 mm. Preserve this 1 mm disagreement explicitly. The manual's 448 mm/421 mm vertical dimensions locate port centres, not body depth.

Service diagrams show 150 mm above and minimum 150 mm below both units; rear-to-service-boundary dimensions are 900 mm for AF300 and 1100 mm for AF450. These include body depth and must not be represented as additional front clearance. Both manuals say upright mounting and that the unit must not support other equipment; owner-approved CW mounting remains a separate bracket/support evidence question.

AF450 catalogue drawing version v2 corrects the body display to 728 × 608 mm with source provenance; saved v1 snapshots remain unchanged. Unit and mounted assembly dimensions remain separate. Exact role-to-centre remapping and changing the 160 mm owner routing convention to 200 mm native ports are withheld pending explicit owner answers. No reducer is inferred. AF300 measurements are captured as evidence; no new speculative port origin or unit placement is added.


### DEV60 — AF450 manufacturer handing and owner-confirmed EPP fit (23 October 2026)

Owner selected manufacturer Left/Right definitions and confirmed that unit spigots suit 160 mm EPP. New AF450 v3 profiles use manual page 4 roles and page 43 dimensioned centres, with the CW assembly on the dwelling side. Use DN160 EPP route interfaces; do not infer reducers from the brochure's 200 mm designation. Retain that brochure value as source evidence. Existing saved snapshots retain their previous roles, ports and CW side. The manual 393 mm versus brochure 394 mm pitch discrepancy remains recorded. Tests cover both orientations, branch diameter, EPP size and legacy drawing convention.


### DEV61 — Consistent AF450 connection collar display (23 October 2026)

Owner identified that AF450 outdoor connection circles lacked the Q-series collar appearance. Use the same 190 mm outer display ring around DN160 Aerofresh targets in plan, preview and sheets, including existing saved symbols. This is a display convention only: physical outside diameter stays unknown, port centres, roles, IDs and interfaces stay unchanged. Connection label offsets include the display ring.


### DEV62 — Terminal palette by shape and zone service selection (23 October 2026)

Owner selected separate Round and Rectangular terminal tools, replacing six terminal cards. After dropping, choose Supply/Extract for Luna or Aerofresh magnetic-cover symbols respectively. A unique containing current room/child zone with an explicit supply/extract role preselects the service, with manual override. Partitioned rooms never supply a fallback through missing child zones. No role is inferred from room names, no airflow is allocated, and no physical duct interfaces are invented for these symbolic records. Shift/Ctrl repeats the last configuration while respecting each destination's confirmed role. Existing records and placed symbols remain intact.


### DEV63 — Automatic EPP material allowances (23 October 2026)

Owner confirms lengths include a socket and requests one additional sleeve per elbow. DN125/DN160 catalogue straight candidates are 1 m. Derive read-only per-route stock lengths (ceil of centreline / 1 m, then run multiplier), 90°, 45° and other direction changes from saved control points, included sockets and one additional sleeve per bend. Ignore collinear and zero-length legs. Use full XYZ only when elevations resolve; otherwise explicitly label plan-only allowance. Preserve unset run counts. Show allowances separately from placed components in Checks and sheets; never create inferred model fittings, prices or pressure losses. No elbow take-out, insertion length, waste, offcut sharing or terminal orientation bends are assumed. 45°/other fitting selection remains unresolved.


### DEV64 — Rigid EPP drawing and half-elbow stock (23 October 2026)

Owner requests straight EPP runs and drawn 90°/45° fittings, and confirms a 45° bend is a 90° elbow cut in half. EPP intermediate route points snap to 45° increments; exact attached port positions stay unchanged. Render local circular 90° and 45° elbows with joint marks between straight legs instead of broad quadratic sweeps. Radius equals display diameter as a schematic convention, not manufacturer installation geometry; short or unsupported corners remain angular and marked for review. Reuse shared geometry in plan, preview and sheets. Pool 45° halves across routes of the same diameter, rounding to whole 90° stock elbows and reporting spare halves. Keep full 90° bends and 45° bends separately, and retain one extra sleeve per installed bend.


### DEV65 — Plain-ended EPP elbow reference (23 October 2026)

Owner supplied https://solutionair-online.co.nz/wp-content/uploads/2026/04/Datasheet-Utek-EPP-160-Bend.pdf as a similar elbow, explicitly without its fixed sleeve. Visually reviewed page 1 (reference article 400480494): curved 90° body with midpoint division and an enlarged fixed sleeve on one end. Use the curved plain-ended form and dashed midpoint cut guide for two 45° halves in plan and sheets. Do not draw a fixed sleeve or add one to quantities. Retain the separate one-extra-sleeve-per-installed-bend rule. Datasheet dimensions and pressure/material properties describe the reference product only and are not transferred to the owner's EPP fitting. Installed bend radius and socket insertion remain unverified.


### DEV66 — EPP angle constraints through attachments and whole-run deletion (23 October 2026)

Owner requires all EPP plan legs to be horizontal, vertical or 45°, including the final connection. Preserve exact port centres; align a nearby existing corner (within 100 mm) where possible, otherwise add an axial/45° dogleg. Apply to new routes, endpoint synchronization and route point edits, without migrating untouched saved routes. Added corners retain unknown elevations, or use an explicit interpolated assumption when both adjacent elevations resolve. Route deletion removes only the selected complete route, releasing its endpoint occupancy, via inspector button or Delete/Backspace; point removal remains an explicit separate button. History restores the whole route and bindings.


### DEV67 — Inline EPP port approaches and exterior terminations (23 October 2026)

Owner requires inline snapping at unit/distribution port directions and single/combined exterior grilles. Align EPP start/end legs to the component-rotated port direction, adding schematic approach legs where required while preserving the exact attachment. Only horizontal/vertical/45° plan directions are accepted; out-of-plane port directions have no inferred plan heading. Start draft follows the port axis. Add an External grille tool with single intake, single exhaust and combined (two isolated labelled streams), DN125/DN160 generic symbols; no wall attachment or penetration clearance is inferred. Price guide rows 84–87 identify Zehnder combined external Left/Right DN125/DN160 candidates, but physical port mapping/dimensions are not known, so the new generic symbols are not matched to those SKUs. Product selection remains open.


### DEV68 — Separate outdoor grille spacing and supplied product evidence (23 October 2026)

Owner supplied TS093 single and TS096 combined grille PDFs and requires 1500 mm between individual intake/exhaust grilles. Add live placement advice and persistent Checks diagnostics, using owner-confirmed centre-to-centre spacing in plan. Same-service pairs and internal ports of combined products are excluded. Physical generic face dimensions remain unverified; the centre-to-centre check uses placement centres independently of symbol size. New single placements use source-backed Zehnder DN125 (267×248×73 mm overall, article 990430250) or DN160 (280×281×73 mm, article 990430584); these dimensions do not verify EPP mating. Existing snapshots remain unchanged. Combined identities and Left/Right evidence are recorded but physical footprint promotion is held at the TS096 H/W conflict in the open-decisions register. No wall attachment, vertical separation or overall installation approval is inferred.


### DEV69 — Internal and External terminal menu rows (23 October 2026)

Owner specifies Terminals > Internal: Round / Rectangle; External: Individual / Combined. Keep each pair in its own labelled row in the existing two-column palette. Individual opens intake/exhaust service selection, Combined preselects the two-port combination; both retain duct-size selection. Existing placement, zone service selection and the 1500 mm centre-to-centre separate-grille rule remain active.


### DEV70 — DN90 outlet snap entries (23 October 2026)

Owner requires Luna connections at the outside of the drawn circle and Aerofresh connections at either side or the back centre. Add one logical DN90 semi-rigid terminal port with alternative drawing entries: eight Luna rim positions, or Aerofresh left/right/back. Entry selection and route creation are one atomic command; the selected position/direction becomes authoritative and all alternatives share the same occupancy. These are owner-approved schematic connection positions, not measured housing geometry. Existing portless placed symbols gain the same entries via an undoable terminal.enableDrawingConnections command on entering Ventilation; original catalogue snapshots remain pinned. New definitions use drawing.v2. Save, move, rotate and room assignment use the one logical terminal port.


### DEV71 — Continuous Luna rim attachment (23 October 2026)

Owner requires snapping anywhere on the Luna circle to avoid routes crossing the outlet. Replace discrete visible rim markers with a continuous rim target. On completion, choose the rim point facing the last committed approach point; on route start, use the clicked angle. Validate the selected local coordinate lies on the drawn outer circle and save it atomically with the route. All angles retain one logical port and shared occupancy. Existing fixed-entry metadata remains readable.


### DEV72 — External grille appearance and placed Left/Right swapping (23 October 2026)

Owner requests recognisable external grille symbols and post-placement Left/Right swapping. Shared vector graphics now show a louvred individual housing and combined weather hood with distinct round exhaust outlet, intake louvres and ODA/EHA labels, in plan/preview/sheets. Appearance follows supplied Zehnder references while existing generic combined dimensions remain schematic. Combined grille inspector selects outdoor intake Left/Right; mirror connection layout while retaining stream roles/port IDs, synchronize attached routes atomically, and support Undo. Individual grilles retain ordinary rotation; they do not have two handed streams.


### DEV73 — Combined grille bird's-eye plan symbol (23 October 2026)

Owner corrected the combined grille to a bird's-eye drawing. Replace its front elevation/louvres with a top-down hood footprint, facade mounting plate and two horizontal duct necks at the existing authoritative snap positions. ODA/EHA arrows identify separate air paths; Left/Right swapping and attached route IDs remain unchanged. Shared plan/preview/sheet renderer uses the same symbol. Generic combined overall dimensions remain schematic pending the recorded source H/W conflict.


### DEV74 — Owner's combined grille outline (23 October 2026)

Owner supplied a plan sketch with a narrow shared body, two short rear duct collars and one projecting exhaust hood. Match that outline in the shared plan/preview/sheet graphic. The hood follows the exhaust port when Left/Right is swapped; authoritative port positions remain unchanged. Reduce visible combined-grille snap markers so they do not obscure the short collars; keep the existing screen-space acquisition area. Dimensions remain the existing schematic layout allowance.


### DEV75 — Q350 with CW625 (23 October 2026)

Owner requests Q-series CW625 using uploaded attenuator files. Reviewed Zehnder ComfoWell625 specifications (2021-02-18), pages5 and7: Q350/450TR assembled envelope1029×566×1414mm; mounting plate641×230mm, twelve DN90 branches per stream in two rows of six at102.5mm pitch. Enable CW625 for existing Q350 HRV/ERV profiles in either orientation, retain authoritative unit ports, and use641mm plate width for AF450 CW625 too (owner confirms common CW family). Exact plate placement relative to unit remains schematic; branch circles remain visual only. Q450 and Q600 remain outside the existing placeable model list; this change does not invent their port profiles. No pressure-loss or compatibility approval is inferred.


### DEV76 — Standalone CW configurations and component context menu (23 October 2026)

Owner requests standalone CW320/420/520/625 in both horizontal and vertical installation orientations, editable after placement, with right-click rotation/flip/configuration actions. Add source-sized drawing assemblies comprising attenuator, DN160 round end plate and 6/8/10/12 × DN90 branch plate (CW320 also DN125). Preserve separate UK RapidLock320/520 and2021 specification420/625 provenance; do not infer cross-generation interchangeability. Casing widths420/625 differ from plate widths436/641. Branch-centre edge offsets and assembled seating remain provisional; no pressure-loss or acoustic selection is inferred. Horizontal row ports share plan positions but retain distinct Z offsets and identities; screen picking selects a free coincident row. Vertical main connection is below the branch plate and marked dashed. Installed elevation remains unknown. Right-click offers Rotate90°, relevant handed flip or end-for-end rotation, and CW/MVHR configuration. A single undoable replacement preserves component ID, position/orientation and surviving endpoint IDs, synchronizes attached routes, and rejects removal or service/size changes of occupied ports. Existing placed snapshots remain unchanged until explicitly edited.

Standalone Distribution palette exposes only Horizontal CW and Vertical CW; older generic fixtures/assemblies remain in saved models and the catalogue library. Configuration is chosen at placement, reducing duplicate Supply/Extract tiles.


### DEV77 — HRV EPP connection-to-ceiling allowance (23 October 2026)

Owner requests 1m EPP, one elbow and four sleeves per EPP-connected HRV port pending future plan heights. Interpret the ceiling turn as one90° elbow, counted once per unique attached unit port, for supply/extract/intake/exhaust on HRV or ERV units. Apply on either route endpoint, using the connected DN125/DN160 diameter; do not multiply physical-port allowance by route run count. Disconnected ports, CW boxes, terminals and non-EPP routes receive none. Keep it separate from route-centreline quantities and geometry, with one included stock-length socket and exactly four extra sleeves (no fifth sleeve for the allowance elbow). Include the extra elbow in diameter-grouped stock totals. Checks and sheet schedules expose the allowance explicitly. Heights remain unknown; future height design must replace/reconcile this provisional allowance rather than silently treating1m as a measured rise. Existing route bend sleeves remain additional to this port allowance.


### DEV78 — Standalone CW220 (23 October 2026)

Owner supplied Zehnder-ComfoWell-220-specifications-2021.02.18.pdf. Reviewed pages2–5: attenuator990323500 has500×220×230mm casing; branch plate990323521 has four DN90 connections in2×2 at102.5mm pitch,236×230mm plate and41mm projection; central DN125 end plate990323510 has51mm projection. Add horizontal/vertical Supply/Extract standalone drawings and post-placement editing through the existing CW selector. Restrict CW220 main connection to DN125; do not infer DN160 or Q-series/Aerofresh direct mounting. Absolute branch edge offsets and assembled seating remain provisional under the existing standalone drawing policy. Preserve all previously placed profiles and attached-port edit guards.


### DEV79 — Visible HRV ceiling elbow on EPP routes (23 October 2026)

Owner requests the top elbow when EPP connects to an HRV. Draw a shared plan/sheet symbol for each existing DEV77 unit-port allowance, aligned with the first route leg away from either attached endpoint. The circle/neck and90° rise label represent the vertical-to-horizontal turn in top view. The display offset/radius are schematic; do not insert a false planar corner, change saved route points, assume ceiling elevation, or count another elbow/sleeve. Symbols disappear when their EPP connection is removed and follow route/unit moves and rotations.


### DEV80 — Centre the ceiling elbow on the HRV spigot (23 October 2026)

Owner screenshot identified the DEV79 elbow displayed beside the unit. Remove its along-route offset: centre the vertical rise symbol directly on the attached unit port in plan and sheets, with its horizontal outlet following the route direction. Radius remains schematic and installation heights unknown. Route geometry, endpoint identities and existing allowance quantities remain unchanged.


### DEV81 — CA200 manual drawing profile (23 October 2026)

Owner adds CA200 manual/brochure and explicitly chooses manual dimensions after the source conflict is raised. Add manufacturer Left/Right profiles in both horizontal ceiling and vertical wall mounting:535×315×1108mm body,1200mm overall,330mm port-column spacing from manual PDF page22; handed roles from page25. Dwelling supply/extract are on the top end, intake/exhaust on the bottom end. Use DN125 drawing interfaces from the stepped125.5/149.5/159.5mm spigots; do not infer mating fit or a regional SKU/article. Centred transverse setout is a drawing interpretation, not an exact installation claim. Vertical port pairs retain shared XY and distinct relative Z (±600mm); routing asks Top/Bottom service when starting at coincident ports, and automatically matches the active stream at the other end. Installed component height remains unknown. CA200 attenuators are remote; direct CW mounting remains unavailable without a supported assembly drawing. Preserve right-click rotation/handed flip, editable configuration, route identities, ceiling allowances and shared plan/sheet graphics. The manual also calls for a straight silencer of at least1m directly on each supply/return connection (PDF page25); this is a review requirement, not automatically fulfilled by one CW500-length module or generated as a product quantity.


### DEV82 — Compact EPP terminal alignment (23 October 2026)

Owner screenshot shows an unnecessary loop at a combined external grille when the final route click is close to the port but off its approach axis. Before adding a fixed inline stub, discard only incompatible terminal click points within1.5stub lengths; retain exact port attachments, axial/45° routing and known height transitions. Add an explicit undoable Realign connections action for existing EPP runs: compact nearby endpoint waypoints within2stub lengths and rebuild the two approaches. Preserve the rest of the route, component/port identities and floor heights. This is local connection geometry, not obstacle avoidance or automatic relocation of a grille through a wall. No saved run is silently rewritten on load.


### DEV83 — Routable DN90 targets on HRV-mounted CW plates (23 October 2026)

Owner reports DN90 does not snap to CW ports. Mounted CW circles previously had no typed connection targets. Extract their plate/branch drawing setout into a renderer-independent module shared by plan/sheet circles and domain ports. Add one stable DN90 semi-rigid Supply/Extract port per circle for Q350/AF450 CW320/420/520/625 in both handings. Keep all four unit main ports and pinned catalogue snapshots unchanged; conceal unoccupied internal main EPP targets underneath the mounted plates from picking. Existing mounted symbols gain targets through one undoable command on entering Ventilation. Circle size is a90mm drawing guide; outside/mating diameter, absolute installation setout and elevation remain unverified. Reconfiguration retains matching branch IDs and updates attached endpoints; downsizing or removing mounted CW is blocked if it would remove a connected branch. Standalone CW ports and their coincident horizontal-row selection remain intact.


### DEV84 — DN160 combined grille pitch matches Q350 (23 October 2026)

Owner requests the same connection distance as Q350 outlets. Set generic DN160 combined grille intake/exhaust drawing pitch to280.5mm centre-to-centre (previously240mm), centred at±140.25mm. Keep DN125 unchanged. New records use version2; existing placed DN160 generic combined grilles receive an undoable spacing update when entering Ventilation, preserving centre, orientation, handing, port IDs and pinned snapshots. Attached duct endpoints follow. This is an owner-prescribed drawing connection setout; unresolved physical combined-grille casing dimensions remain generic.


### DEV85 — Paired combined-grille alignment snap (23 October 2026)

Owner requests DN160 combined grille alignment with HRV ports on placement and movement. Add a12CSS-pixel magnetic translation snap only when both corresponding intake/exhaust paths align within tolerance, on the same floor, with the grille rear facing the unit. Show separate air-path guide lines and an alignment label. Preserve distance from the unit along the run direction; do not snap a grille onto equipment or infer wall penetration. Placement may select the matching quarter-turn orientation and Left/Right grille handing; moving an existing grille preserves its rotation and handing. Connected grilles prefer the HRV already attached through their routes. Incompatible rotations or pitch do not partially snap one port. Ordinary placement/move commands retain Undo and attached endpoints follow. No duct or connection is created by an alignment guide.


### DEV86 — HRV ceiling elbows follow the drawn EPP direction

HRV connections already carry a rise and ceiling-elbow allowance. The plan outlet of that elbow now follows the first drawn horizontal, vertical or 45° segment, including back across the unit. The schematic unit-port side direction no longer forces an outward plan stub, for drawing previews or committed routes in either drawing direction. External grilles and standalone CW connections retain their inline approach constraints. Port identities, positions, unknown elevations and the existing allowance quantities are unchanged. Existing routes can be adjusted with the route tools; opening a project does not rewrite their geometry.


### DEV87 — Lossless device storage compression

Browser localStorage quota can reject saves of projects containing plan images because the journal retains multiple copies. The browser adapter now uses a versioned lossless LZW encoding when smaller than the original text. Existing HiPer Studio keys are compacted individually on startup after an exact round-trip check, using atomic replacement; no project or previous checkpoint is removed. Plain records still load. Portable exports retain their existing format. This increases effective capacity but cannot promise unlimited storage; failed writes retain the previous saved checkpoint and users can export their open drawing. Older app versions cannot read compressed records.


### DEV88 — EPP drawn above equipment

Ceiling-level EPP route graphics now render above placed component bodies in the ventilation workspace and printed sheets. Route edit handles and HRV ceiling-elbow symbols remain above the runs. This is a drawing layer convention; actual heights remain unset and no route quantities or connections change.


### DEV89 — DN90 radial ducts drawn above equipment

DN90 semi-rigid radial routes share the above-equipment drawing layer with EPP in the ventilation workspace and printed sheets. This keeps runs crossing an HRV visible without changing connections, quantities or unknown elevations.


### DEV90 — Duct tools in Parts

Duct is now a Parts category alongside Units, Terminals, Distribution and Fittings. It contains the existing DN90 radial, EPP DN125/DN160 and flexible DN150 drawing tools plus routing guidance. Search includes duct tools; other categories no longer show the permanent duct list. Routing behavior is unchanged.


### DEV91 — Bottom drawing toolbar

Pan, zoom, Fit, directional view controls and Snap are grouped along the bottom of the drawing in both Plan and Ventilation. Duplicate sidebar Pan and View controls are removed. Snap can now be toggled from Ventilation as well as Plan; typed connection validation remains authoritative.


### DEV92 — Owner-authorized replacement of hosted calculator

On 23 October 2026 the owner explicitly authorized replacing the unused legacy MVHR-Calculator application with this HiPer Studio workspace. The new app was published to HiPerHaus/MVHR-Calculator main as commit f946738; the old commit fc344988420b94faa81214d5199243cb65546b7c remains on backup/pre-studio-v2-2026-10-23. Vercel project mvhr-calculator (prj_iWpNvlxM5nMz4ayWDn0bhQW2RA1A) serves www.hiper-studio.au. Only app/source/build/test files were published; private reference documents and local saved drawings were excluded. The release was prepared in /tmp/hiper-studio-release-20261023 to preserve the independent local development history. Further releases must reconcile the current remote head rather than force-push the unrelated local Git history. Browser-local saves remain separate between localhost and the hosted origin; portable export/import transfers drawings. No backend data, credentials, billing or deployment-protection settings were modified.


### DEV93 — Invited sign-in and private cloud drawings

The owner authorized sign-in and selected existing invited accounts only on 23 October 2026. Reuse the existing MVHR calculator Supabase project in Sydney (qlmnykpwvkckxcycqhpp); no new paid service, billing or company entitlement was provisioned. New studio_workspaces, studio_memberships and studio_projects tables plus the private studio-drawings bucket isolate this feature from legacy data. Memberships are server-managed and were bootstrapped once from existing accounts; later accounts require an explicit membership grant. Account-without-company uses a private workspace. No registration UI or client membership-writing permission exists. Authorization never trusts imported company fields, editable user metadata or the legacy profile company/admin flags after bootstrap.

Explicit Save to cloud uploads the complete validated drawing, including embedded references, as an immutable JSON object and then conditionally commits its metadata against the last acknowledged save_version. Failed uploads preserve the prior record, stale versions cannot overwrite and uncertain acknowledgements retain the uploaded object for recovery. Earlier objects are retained; automatic retention/cleanup is not introduced. The bucket limit is 48 MiB. Cloud-loaded documents stay in memory rather than being written into the shared device journal. Device-local projects are separate and are never silently uploaded. Save As and guarded transitions await cloud acknowledgement. Session persistence uses IndexedDB with an in-memory fallback, independent of drawing localStorage quota. Sign-out is local-device only; a cloud drawing with unsaved changes must be saved before explicit sign-out closes it.

New RLS policies were verified using rollback-only synthetic records under both existing account claims, including cross-workspace denial and membership-write denial. Anonymous REST access is denied. Tests cover file round trips, failed uploads, ambiguous acknowledgements and stale tabs. Existing legacy Supabase advisories (including the admin_members view, older privileged functions and password-protection setting) were detected separately; this feature neither depends on those authorization rules nor changes them. Review the existing backend separately: https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view and https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable .

The sign-in/cloud-save release was published to MVHR-Calculator main as f06c0d0 and Vercel production dpl_CRQWYxQiiDcU94BwLJp7KLWrQuTW. All 327 tests passed; the live sign-in form and error feedback were checked. Positive authentication/save using the owner’s credentials remains an owner check; no password was requested or used by the agent.


### DEV94 — Simplified Project home

Project home now prioritizes the current drawing, Continue drawing, Edit floor plan, Save, Cloud projects and New project. A compact four-step setup card remains visible. Device copies, scope and area summaries, and design-stage reviews are collapsed disclosures. Rename and Save As sit under Project options. Workflow controls, validation and saved project data remain unchanged. Storage guidance follows the signed-in workspace rather than implying all projects are local.


### DEV95 — Project identity, company branding and plan sheet

The owner requested a full-height marked-up drawing with a right-hand key above the title block, project identity from Project and company branding from Account. Schema 20 stores name, client, site address and project reference; older drawings migrate to blank identity without guessing. Project changes are commands and travel with portable/cloud drawings. The A3 main sheet omits the parts table while preserving schedule calculations and an explicit includeSchedule option. The key uses placed symbols; certification badges and installation details were not invented. Sheet status remains preliminary, not for construction.

Account stores company address, email, phone, website, primary contact and PNG/JPEG logo privately per Studio workspace. A new membership role permits only workspace owners to edit the company profile; members read it. Ownership is seeded from existing company ownership or private workspace identity, never imported drawing metadata. Profile version checks reject stale-tab overwrites. Logo blobs use unique private studio-drawings paths. Rollback-only checks confirmed cross-workspace read denial, owner writes/version increments and member-write denial. No new Studio security advisories were reported; inherited legacy advisories remain tracked under DEV93.

All 331 tests passed with 119 modules checked. Browser checks confirmed Project details flow into the sheet, Account fields are gated by sign-in, and a synthetic plan displays the right-hand key/title layout. Positive owner-account branding entry remains a user check; no password was requested.


### DEV96 — Sheet underlay and building-area correction

A reported missing PDF underlay exposed a sheet renderer defect: data URLs passed through the 500-character text-label sanitizer, truncating plan images and company logos. Embedded raster image attributes now retain the full validated PNG/JPEG base64 payload. The sheet also includes saved building-area outlines in drawing bounds, the symbol key and the print scene beneath ventilation markup. No PDF re-import or project data migration is required. Regression coverage uses a real synthetic PNG over the text limit, checks complete plan and logo payloads, and confirms building-area-only framing. All 332 tests passed; a browser-rendered synthetic sheet confirmed the plan and boundary are visible.


### DEV97 — CW body acquisition for DN90

The owner requested snapping a radial duct to a CW box rather than aiming at individual branch circles. DN90 routing now acquires mounted CW plates or standalone CW bodies and chooses the nearest available branch toward the existing route approach (pointer position for a new route). Active route service/system/role remains authoritative; a new route uses the hovered mounted plate service. Rotated horizontal and vertical standalone boxes are supported. Occupied route and internal-connection ports are excluded; a full compatible bank does not fall back to a different service or HRV main port. The chosen endpoint remains a stable typed port and normal controller validation applies. EPP picking is unchanged. All 334 tests passed and a browser body click started a DN90 draft at a real CW branch.


### DEV98 — A4 parts-list pages and radial accessories

The owner requested page 2 as an A4 parts list. Sheets now shows an A3 plan followed by A4 portrait schedule pages, automatically continuing without dropping item rows. Print sheets uses named A3 landscape and A4 portrait page definitions. The parts list includes equipment, plan route lengths, EPP stock/90-degree elbow stock/sleeve allowances including the existing HRV connection allowances, and 90 mm accessories.

One O-ring is counted for every physical CW branch, used or unused, across mounted and standalone CW layouts. Each unused saved CW branch receives one short pipe stub and one end cap. Connected TVA/Luna or Aerofresh 90 mm ducts add one O-ring per known Single/Twin duct count; unknown counts stay pending. CW occupancy follows stable saved branch endpoints and internal connections; quantities do not invent additional geometry. Stub length is unconfirmed, so stubs are listed in pieces without adding an assumed duct length. The owner has been asked to confirm a standard stub length.

All 337 tests passed (122 modules), including connected/unconnected CW counts, terminal O-rings, route deletion, standalone orientations and A4 overflow continuation. Browser preview verified the second page and six-port unused CW quantities. No account permissions, cloud schema or saved project data was changed.


### DEV99 — Confirmed 100 mm unused-CW-port stubs

The owner confirmed 100 mm per unused CW branch on 24 October 2026. Radial accessory calculations now default to 100 mm, and A4 parts pages list both stub pieces and the additional DN90 pipe length separately from drawn routes. For example, eleven unused branches add eleven stubs and 1.10 m of pipe. O-ring and cap counting remains unchanged.


### DEV100 — Continue current project and unify Projects / Import

The owner requested retaining the open drawing after refresh/tab changes, removing the visible local-copy workflow and replacing duplicate Projects/Cloud projects controls with one Projects box containing saved cloud drawings and Import. The header now offers Projects, Save (sign-in gated), Save As for cloud copies, and Export backup. Previous device drawings remain preserved behind a collapsed migration disclosure inside Projects; no existing saves are deleted or automatically uploaded. Imports clear the prior cloud binding before a future explicit Save.

A separate IndexedDB working-session store retains the current serialized project, dirty state, project name, cloud binding/version, task and camera. Tab-specific snapshots prevent ordinary separate tabs from replacing each other; a new tab can continue the latest snapshot within its own account/workspace. Writes are serialized and acknowledged only on transaction completion. Refresh waits for resolved auth/membership before private recovery; account/workspace keys and cloud project bindings are validated. Active edits block late startup replacement, focus SIGNED_IN notifications for the same ready account do not reset the workspace, and account changes close private drawings. If no working snapshot exists, the latest cloud drawing updated by that user is reopened. No browser recovery advances the cloud version; normal server compare-and-swap protection remains authoritative.

Automatic working recovery no longer writes full projects to the small localStorage journal. Recovery failures are explicit; leaving during a pending recovery/cloud save or with unrecovered edits is guarded. Committed model edits are recovered, not in-progress pointer drafts or undo history. Save remains explicit cloud persistence. All 341 tests passed (124 modules); tests cover refresh data, tab separation/new-tab continuation, account binding denial, camera/task and preserved cloud save version. Browser tests restored an unsaved project name and CW component in Ventilation after reload, then restored Sheets after reload, and verified Projects / Import. Read-only database verification confirmed an existing saved project has resume-owner metadata. No Supabase schema, credentials, membership or billing changes were made.


### DEV101 — Standard project accessories and procurement pack / coil rounding

The owner supplied a component estimate and requested standard HRV/job items. HRV-DRAIN is one per HRV. PLU-SURGE is one per eligible HRV; the owner explicitly confirmed excluding Q450/Q600. Q-series units add ZEN-CCPRO and ZEN-OPTBOX; Aerofresh and CA200 do not receive those Q-series controls. Unit-mounted CW assemblies list two attenuator modules and two branch plates per unit; known local CW320/CW520 codes are used, otherwise product-code selection stays explicit. The reviewed Q-series CW320 mounting-set allowance is one per unit. Existing standalone assembly counts remain independent.

ZEN-C90-CSET is three per job. Extract points each require one AER-GR-FILT-DN125 filter, supplied in bags of ten rounded upward. ZEN-OR90 uses ten-ring packs rounded upward from all CW branch rings plus known connected terminal ducts. Job-wide packs/allowances are emitted once on the first floor with ventilation, preventing per-floor rounding duplication. The owner requested only one project-wide DN90 duct total, then 50 m coils rounded upward; the total combines supply/extract saved plan lengths times Single/Twin plus the confirmed 100 mm unused-CW stubs. Stub pieces/caps remain listed, but stub length is not duplicated as a second duct total. Unknown multiplicities remain pending.

All 345 tests passed (126 modules), including Q-series/Aerofresh selection, Q450/Q600 surge exclusion, multi-floor job allowances, filter thresholds, coil thresholds, Twin totals, CW breakdown and 23 rings becoming three packs. Browser review confirmed the complete A4 layout, including filter/pack/coils and CW/HRV item rows. Only sanitized product rules and synthetic fixtures are published; private source documents and pricing remain outside the repository.


## DEV102 — Separate equipment and terminal parts; retain combined grille handing (24 October 2026)

The A4 parts list now separates MVHR units, CW/other equipment and terminals. Combined external grille quantities group by saved Left/Right configuration and explicitly include that handing in the description. Flip changes the schedule; plan rotation preserves product handing. No manufacturer SKU is inferred from the generic drawing. Verification: all 346 tests and build passed; tests cover independent handed quantities, flip, rotation and project round trip; A4 preview inspected.


## DEV103 — Combined EPP project totals (24 October 2026)

Owner requested EPP totals like DN90. A4 parts list now aggregates EPP across streams and floors, separated by diameter, displayed once with project job totals. Total centreline allowance includes connected HRV port allowances; 1 m stock is rounded upward after aggregation. Elbow stock pools pairs of 45-degree halves across the project; sleeves sum bend and HRV allowances. Pending run counts remain explicit; other unselected bends remain flagged. Existing per-route detail remains available in model schedules. Verification: 348 tests and build passed, including cross-floor/Twin totals, exact rounding, pending counts, HRV allowances and elbow sharing; A4 visual proof inspected.


## DEV104 — Separate part number and name columns (24 October 2026)

Owner requested dedicated Part number and Name columns in the A4 parts list. Known local product codes or manufacturer articles now appear separately from names for placed components, CW breakdowns, HRV and job accessories, and 90 mm coils. Unknown codes display a dash; no SKU is inferred. Reference, quantity and unit columns remain. Names and part numbers wrap independently with row heights and pagination recalculated. Verification: 349 checks passed, targeted pagination/column checks repeated after spacing adjustment, build passed and A4 screenshot inspected.


## DEV105 — Quote Rev 5E product codes and terminal breakdowns (24 October 2026)

Owner supplied MVHR 2026 Quote Template - Rev 5E.xlsx and approved cool-white Aerofresh magnetic covers (AER-GR-RECT-W). Read-only extraction of Price List columns A and C supplies a sanitized code/name/row reference; no workbook, prices, customer data or quote calculations enter the repository. Combined grille order codes now follow saved DN125/DN160 and Left/Right configuration, updating after flips and reloads without changing geometry or product-match status. Single grille codes, EPP stock and sleeves, CW220/320/520/625 constituents and applicable mounting sets use exact source codes. CW420 and unsupported plate/mount variants stay unselected. Standalone CW assemblies break into one module, branch plate and end plate. Aerofresh terminal components include the chosen cool-white cover plus housing selected by saved back/side entry; Luna TVA single/twin housing follows the saved run choice, leaving unset choices explicit. End caps use ZEN-ECAP90 in ten-packs rounded once across the project, retaining the required cap count. Known commercial identifiers do not establish physical compatibility. Verification: 355 checks, targeted tests after the final unknown-mount label, 128 modules, build and A4 visual proof passed. Tests cover handing/rotation/reload, unknown variants, terminal housing/cover counts, exact CW625 spelling, EPP codes and cross-floor cap packs.


## DEV106 — Unlisted parts at the end under Local supply (24 October 2026)

Owner requested parts absent from the price guide be listed at the end as Local supply. The A4 parts list now moves purchasable rows without a Rev 5E code match to a final Local supply section, preserving references, descriptions, known part numbers, quantities and units without duplication. Empty original sections are removed. Totals, constituent assembly references, cut pieces already included in listed duct stock, and pending choices among listed products remain in context because these are not additional unlisted purchases. CW420 modules, plates and mounting sets demonstrate the new section. No model or cloud schema changes. Verification: 356 tests, 128 modules, build and A4 screenshot passed, including final ordering, exact quantities, retained totals and selection prompts, immutable schedule and pagination.


## DEV107 — Previewed automatic DN90 routing inside the scaled outline (24 October 2026)

The owner authorized automatic DN90 routes after HRV/CW and outlets are placed. A renderer-independent inspector now proposes only connections between unoccupied, typed `semi-rigid-pe` DN90 ports with matching MVHR system, supply/extract stream and role. A single-port DN90 component is an outlet; multi-port components supply capacity. Bare HRVs do not gain invented DN90 ports. Existing routes and direct connections reserve their endpoints and are never replaced.

The route centreline and its smoothed 90 mm drawing body must remain within the one confirmed floor-area polygon. Direct visibility is tried first; a bounded grid search handles concave outlines. No valid path produces an explicit unresolved outlet, not a shortcut outside. A calibrated image or explicit-unit CAD reference is required. Floor-area holes remain unsupported by the current schema and therefore block rather than being ignored. Preview is disposable; Apply creates ordinary editable Single routes in one atomic command, so one Undo removes only that batch. This is geometric drafting, not airflow, pressure-loss, support, clash or installation proof.


## DEV108 — First persisted height-aware 3D coordination drawing (24 October 2026)

The owner authorized a practical first 3D output for HRV, CW, outlets and ductwork. The first output is a deterministic isometric SVG derived from the same persisted components and routes; it is not a second scene model. Floor-local Z=0 is the input datum and the floor transform reports its building Z when known. One undoable floor action sets unit/CW elevation, outlet elevation and duct routing elevation as either explicit assumptions or confirmed measurements. Existing individual component elevation editing remains available.

Routes retain their authoritative 2D control points and store a separate optional routing-elevation measurement. The 3D projection derives vertical transitions at its saved endpoints without inserting coincident 2D edit handles or changing the plan route. Unknown component or route heights remain located diagnostics and are not rendered at zero. Known manufacturer height/envelope data is used where available; a component with an unknown physical height is an open scaled footprint, not an invented solid. SVG export repeats the schematic/no-BIM/no-clash/no-engineering boundary. Advanced camera, hidden-line, multi-floor risers, fabrication solids, interactive 3D PDF and CAD/BIM exchange remain under DEC08.


## DEV107 — End caps supplied with DN90 pipe, excluded from orders (24 October 2026)

Owner confirmed end caps arrive in the ends of the 90 mm pipe and ZEN end caps are not purchased separately. Remove ZEN-ECAP90 from derived project job/order lines and remove the unused pack calculation. Retain physical unused-CW-port cap counts, O-ring counts and 100 mm stub allowances as design information. The A4 footer notes that unused CW branches use the caps supplied with the 90 mm pipe. Source quote identifiers remain intact as source data. Verification: 356 tests, 128 modules, build and A4 screenshot passed; regression verifies no separate cap order on either floor while physical cap and stub counts remain.


## DEV109 — Height-aware solid 3D coordination milestone (24 October 2026)

The first 3D output remains a deterministic view of the authoritative saved design, not a second model or a BIM/clash result. Floor-wide equipment, outlet and route heights remain reversible convenience defaults. Every visible standalone component and terminal now has its own explicit known/assumed/unknown base elevation. Grouped equipment retains atomic plan movement and rotation while an assembly-scoped command can set one physical member's elevation; the complete assembly may still receive one shared default. Every route retains one separately persisted routing elevation and derives visible endpoint rises/drops without changing its 2D centreline.

The SVG coordination view uses saved catalogue envelopes and typed port positions. Source-backed or explicitly provisional envelopes render as labelled solid boxes; missing physical geometry remains a labelled wireframe and never becomes an invented solid. Ducts render as round-looking highlighted bodies with smooth projected sweeps and explicit vertical transitions. Twin routes are visually separated while retaining one authoritative saved centreline and are not a clearance or clash claim. Orbit, tilt, pan, zoom and Fit affect presentation only; exported SVG uses the chosen view.

Native Revit files are not parsed or treated as connector evidence. The future manufacturer-asset boundary requires IFC 4 geometry with declared units plus companion CSV/JSON connector identity, XYZ, direction, system and diameter metadata and product/revision identity. Vent-Axia candidate casings are not bound to AeroFresh records yet. AeroFresh 450 remains nominal DN160 from the Australian catalogue and recent installation evidence; UK DN200 geometry must not overwrite it without an explicit Australian variant or adapter setout. Raw BIM files remain outside Git and browser-served assets.

Verification: build passed; 369 automated tests across 136 modules passed; the isolated browser fixture verified per-item height editing, reload persistence, two visible Twin runs, typed ports, smooth sweeps and orbit/tilt/zoom/pan with no runtime or console errors. The existing cloud-era lifecycle script still contains a superseded assertion that local Save reaches a saved state while signed out; it was not changed under this milestone.


## DEV110 — Visible automatic routing and explicit EPP endpoint selection (24 October 2026)

Automatic routing is a primary, always-visible Ventilation action with separate DN90 and EPP choices. Demand, clearing and floor guidance remain in the existing collapsible section. At narrower editor widths the two actions stack rather than becoming hidden or clipped.

EPP automatic routing is deliberately one user-selected connection at a time. The designer chooses both free endpoints; the system never guesses between plausible HRV, attenuator, distribution or outdoor chains. Eligible ports must share the MVHR system, service role, nominal DN125 or DN160 size and a compatible physical family or an explicitly drawing-only connection class. Existing direct connections and routes reserve their ports. Outdoor intake and exhaust require one matching, explicitly placed external terminal; an arbitrary free route across the building outline is not proposed.

The proposal is disposable until Apply. Internal centreline and swept duct width must remain inside the confirmed scaled building outline. An exterior terminal proposal checks the full interior body and permits only its final termination leg to cross the outline. Unsupported holes/exclusions, missing scale, incompatible or occupied ports and paths that cannot contain the complete width remain explicit unresolved states. Applied routes use the normal saved route model, unknown height remains unknown, and one Undo removes only that route. The result is geometric drafting only and does not establish airflow, pressure loss, obstacle clearance, fittings or manufacturer compatibility.

Verification: build and 373 automated tests across 139 modules passed. New synthetic tests cover DN125 exterior termination, DN160 HRV-to-remote distribution routing, explicit endpoint choice, incompatible and occupied ports, full-width failure, atomic undo, equipment movement/rotation and save/reopen. An isolated browser pass verified both routing actions are visible as two columns at desktop width and one column at compact width, both dialogs open, and EPP cancellation leaves the project unchanged with no runtime or console errors.


## DEV111 — Marked routing exclusions, parallel spacing and coordination warnings (24 October 2026)

Routing exclusions are authoritative user-marked rectangular coordination inputs on one floor, not geometry inferred from the plan reference. Each record has a stable identity, name, beam/void/other classification and either an all-height prohibition or an optional solid vertical range. Missing obstacle or route height stays unknown and produces a review warning; it never establishes a clear over/under crossing. Add, edit, remove, undo, named save, portable backup, A3 output and the schematic 3D view all use the same persisted record. Schema 21 migration adds empty collections only, so earlier projects reopen unchanged.

DN90 and DN125/DN160 EPP automatic routing now checks the complete modelled route width against the confirmed building boundary, every marked exclusion, existing modelled duct envelopes and an optional floor-level clear gap between independent runs. The clear gap defaults to unresolved; routing still prevents modelled envelope overlap but labels the limitation. Intended attachment convergence is exempt only at a shared modelled equipment endpoint. A blocked route remains unresolved with an explicit boundary/exclusion/clearance reason. Existing manual routes are inspected and warned about but never displaced.

Coordination diagnostics distinguish known vertically separated crossings from known collisions and unknown-height reviews. All-height exclusions always block. Nominal DN is labelled as an unverified external envelope unless a catalogue family supplies a known outside diameter. The checks remain drafting coordination only: unmarked structure, insulation, supports, fabrication tolerances and guaranteed installation clearance are outside this milestone. Building-outline holes remain explicitly unsupported and block auto routing rather than being ignored.

Verification: build passed; 376 automated tests across 143 modules passed. Synthetic tests cover undoable exclusion/spacing records, save/reopen, DN90 and DN160 detours, blocked corridors, height-separated/unknown/colliding crossings and exclusion output in 3D. An isolated browser pass created a named solid-range beam, applied 75 mm spacing, edited/cancelled it, removed it and restored it with Undo; the existing responsive DN90/EPP action flow also passed with no runtime or console errors.


## DEV112 — Exact-article German Q350/Q450 IFC4 geometry boundary (24 October 2026)

The owner supplied the German MEPcontent Q350/Q450 sensible and enthalpy IFC4 variants for both manufacturer Left and Right arrangements. A deterministic local importer accepts only the eight reviewed source hashes, declared IFC4 CoordinationView 2.0 and millimetre units, the expected German article, seven distribution ports and the reviewed tessellated-solid structure. It emits compact renderer assets while the original IFC/DWG/RFA downloads remain outside distributable source control. Each saved component stores only an exact asset reference and provenance; geometry is never selected by a similar family name.

German articles 471502009/010 (Q350) and 471502011/012 (Q450) are separate placeable catalogue identities. They do not replace export articles 471502110/111, local product codes or Australian products, and they carry no copied performance or CW compatibility. The Q350 IFC connector centres agree with the existing 725 × 570 mm dimensioned setout after an explicit coordinate registration. The Q450 source contains conflicting connector properties: `Diameter 1` is 180 mm and the reviewed solid envelope is 200 mm, while copied text fields still say 160/190. The exact Q450 BIM record therefore retains DN180/200 with a review warning and does not auto-connect to DN160. No adapter is invented.

The 3D SVG renderer projects the reviewed tessellated solids from the authoritative saved component transform and base elevation. Movement, plan rotation and height alter presentation without modifying the asset, 2D port topology or route geometry. Unsupported/export/local variants keep their existing source-backed or schematic envelope fallback. The result is manufacturer coordination geometry, not a full BIM exchange, clash certificate, fabrication model or proof of installation fit. Direct CW mating for these German identities remains blocked until an exact assembly setout is reviewed.


## DEV113 — Sign-in-first customer access and recoverable user administration (24 October 2026)

Supabase Auth remains the identity provider. The static editor is not the authorization boundary: Vercel Routing Middleware verifies a short-lived HTTP-only access-token cookie against Supabase Auth and an active workspace membership before serving the editor HTML. The browser independently calls `getUser()` for network verification before importing the editor, and all project, company and storage access remains constrained by Postgres/Storage RLS. Stored browser session data alone never establishes authority.

The public surface is limited to sign-in, password recovery and access request. A new signup records name/company metadata only; an `auth.users` trigger creates a pending request and copies email-verification state. User metadata cannot select a role, company or approval. Only a platform administrator may approve a verified request into a workspace as `member` or `admin`; `owner` is never a self-service or approval choice. Workspace owner/admin management is downward-only, cannot alter its own status, and uses recoverable `active`/`suspended` membership state rather than deletion. Security-definer RPCs repeat every role check on the server.

CAPTCHA remains disabled in production until a provider and credentials are separately approved. The login client has a dependency-free injected adapter boundary for Cloudflare Turnstile or hCaptcha. Disabled mode is inert. Enabled mode fails closed without a token, passes the token only through Supabase Auth's `captchaToken` option for sign-in, signup and recovery, and resets the provider after each request. No provider script, site key, secret or production Auth setting is included in the repository.

Existing memberships receive `active` by default. Every project, company and drawing-object policy now requires an active membership. Suspended membership remains self-visible only so the login screen can explain the state; it grants no workspace record or file access. The HTTP gate is defence in depth around editor entry, while RLS remains the private-data boundary.

The new production migration and provider configuration are proposed only. No public registration, provider setting, platform administrator, customer email, password reset, production policy, Vercel protection, deployment or external account was changed during implementation. Vercel all-deployments SSO remains the outer live gate until a separate coordinated rollout and real-provider verification.


## DEV114 — Adversarial customer-access hardening (24 October 2026)

A separate security pass found and corrected four local candidate weaknesses. Password changes now require Supabase's actual `PASSWORD_RECOVERY` event; a query string alone cannot authorize the reset form. A protected editor restored from browser back-forward cache reloads through the server gate, while focus/visibility return and account-change events reverify the user and active membership and renew the short-lived gate. Unauthenticated middleware redirects and gate responses are explicitly private/no-store.

The proposed migration now binds every project object path and company-logo path to its row's workspace ID as both policy checks and `NOT VALID` database constraints, preserving a preflight path for legacy rows. Suspending an owner/admin locks the workspace membership rows transactionally and refuses to remove the last active workspace manager. User-controlled signup metadata remains limited to pending contact information and never selects approval, role or workspace. The Storage bucket remains private; application code creates no signed/public drawing URLs and exposes no privileged Supabase key.

Official Vercel configuration evidence confirms the declared `proxy.entrypoint` and `proxy.matcher` mechanism invokes Routing Middleware for the three editor HTML routes; the localhost server exercises the same authorization logic. A Vercel production build/deployment and real-provider policy test remain unexecuted. Supabase CLI is installed, but no isolated local Docker/Postgres service is running, so migration execution, RLS/RPC behavior, database advisors and real recovery-email behavior remain explicit production-gate items rather than mock-verified claims.


## DEV115 — Disposable database authorization proof (24 October 2026)

The proposed Studio migrations are now exercised in a short-lived local Supabase/Postgres 17 stack. A test-only legacy-schema fixture supplies only the `companies` and `profiles` dependencies that exist before the Studio migrations; it is never a production migration. The repeatable runner uses a fresh unlinked project, synthetic `example.test` identities and an empty temporary Docker credential configuration, refuses a non-loopback API target, suppresses local keys, and destroys the stack after checking.

The first real RPC test found that a missing or suspended caller membership produced SQL `NULL` for `caller_role`. Two security-definer functions used boolean expressions where that `NULL` skipped the intended rejection. Both functions now coalesce a missing role to an empty value before authorization, so non-members and suspended managers fail closed before data listing or status mutation.

Forty-seven rollback-only pgTAP assertions now cover metadata non-escalation, verified approval, active and suspended memberships, project/workspace isolation, storage-table insert/read policy, company ownership, downward role management, last-manager protection, anonymous function grants, private bucket state and database path constraints. A separate real local Storage API journey covers upload, download, private public-URL denial, cross-workspace and wrong-user denial, scoped deletion, and immediate denial for an already-issued token after suspension. Schema lint and database security/performance advisors report no issues. Production migration, provider email behavior, real identities, Vercel execution and live access remain separately gated.


## DEV116 — Production-aligned migration history and guarded rollback (24 October 2026)

The two previously deployed Studio migration files now use the exact versions recorded by the hosted project: `20261023123857` and `20261024015157`. Their SHA-256 hashes are locked in the disposable runner and match the corresponding single SQL statements in production migration history byte for byte. This prevents a future CLI comparison from treating the same schema as two unapplied migrations. The new customer-access migration remains a separate later version and must be applied alone through a reviewed change operation; a blind production `db push` is not the rollout method.

The hosted schema already has validated workspace checks on project paths, previous project paths and company-logo paths. The customer-access migration therefore no longer creates redundant `NOT VALID` constraints. Existing constraints remain authoritative and the forward authorization tests continue to reject mismatched paths.

A separate rollback SQL file restores the exact pre-customer-access policies, owner/member role constraint and membership shape while preserving existing workspaces, projects, company details and the pre-existing validated path checks. It fails closed if any membership is suspended, any workspace administrator exists or any access request exists; those states require a data-preserving incident plan rather than silent reactivation, demotion or deletion. Twenty-five database assertions execute the actual rollback file after a clean forward migration and prove schema removal, policy restoration, data preservation, roles and path checks. The rollback is suitable only for the gated initial change window before real customer requests are accepted.

Read-only production triage is recorded in `docs/14-customer-access-rollout-runbook.md`. Shared legacy credit/view findings are not dependencies of Studio authorization, but they are reachable through the same public Supabase endpoint and therefore block public customer exposure. They remain unchanged pending separate ownership and authorisation.


## DEV117 — Non-deployable legacy shared-schema hardening proposal (24 October 2026)

The legacy credit and admin-view exposure is handled as a separate compatibility change, not silently included in the Studio customer-access migration. The proposed SQL lives under `supabase/proposals/`, outside the migration chain. It removes browser execution from credit-changing and cross-account balance functions, makes the legacy admin view service-only with invoker security, and fixes search paths. Existing caller-bound RLS helpers retain authenticated execution, the Auth profile trigger retains trigger execution, and the possession-token portal exchange retains its explicit anonymous role.

This is the smallest reversible boundary because the current Studio source does not call the legacy credit RPCs or view, while 27 hosted RLS policies depend on the three caller-bound helpers and Studio signup indirectly uses the existing Auth trigger. Unknown external legacy clients remain a compatibility blocker. The proposal therefore requires exact object-by-object approval and server replacement confirmation before it can become a migration.

A disposable local Supabase/Postgres fixture reproduces the hosted grant and function logic using synthetic identities only. Fourteen assertions demonstrate the exposed effects locally; after applying the proposal, 29 assertions verify grants, invoker view security, fixed search paths, retained policy helpers, retained trigger behavior, retained server access and the single-use anonymous portal flow. Schema lint reports no errors. No hosted mutating RPC or customer row was used, and no production change, push or deployment was made.
