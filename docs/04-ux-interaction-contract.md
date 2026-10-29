# UX interaction contract

The companion UX Blueprint is accepted design direction subordinate to the Master Specification. Its static wireframes, exact panel sizes, and other untested visual details remain proposals until validated with the reference workflow and accessibility checks.

## Project navigation

The planned entry point is a Projects home with explicit create/open status. Within the current design shell, the primary design progression is **Plan → Place → Route → Check → Export**. Project, 3D, Catalogue, and Account remain utilities around that progression. These UI stages are presentation/navigation state only: they never change the commercial/design lifecycle, project data, dirty state, or undo history. Project-level sections include **Overview, Estimate, Files, Issued drawings, Activity**. These routes expose the same authoritative project rather than separate copies.

The Check stage groups existing audit evidence into Errors, Warnings, and Not calculated. Empty or unsupported topology is never presented as a pass. Show on plan accepts typed component, route, room, and zone targets, temporarily reveals a hidden ventilation target without changing saved view preferences, and offers a direct return to Check.

The current-floor Normal airflow table shows Room/zone, Service, Required target, Assigned design target, Difference, Associated terminals, and Review. Required and assigned values retain their input unit, canonical L/s, basis, and source. Unknown values read **Not set**. Multiple terminals do not divide or multiply a room target; allocation remains unresolved until an explicit later method is approved. The table is not delivered, predicted, balanced, or commissioned airflow.

## Workspace layout

HiPer Studio uses a familiar, restrained CAD workspace:

- A top drafting toolbar keeps Select, Wall, Opening, Measure, Move, Rotate, and Undo reachable.
- The left side holds the catalogue and layers.
- The centre is the primary drafting canvas.
- The right side is a contextual inspector for the selection or active tool defaults.
- The bottom strip shows live dimensions, snap/orthogonal state, numeric entry, and gesture prompts.
- Floor controls are separate from visibility layers.

Heating/Cooling and other optional modules appear only when enabled. The interface keeps company/project identity, floor, working-draft status, selected snapshot or issue where relevant, concept/detailed scope, calculation currency, review state, and truthful save acknowledgement visible.

## Module visibility and shared-model editing

Optional modules appear only when both available to the company and enabled for the project, but the UI must explain these as separate conditions. A disabled module, unavailable entitlement, incomplete input set, stale result, blocked run, and unapproved result use different states and messages.

Modules reuse the same floor, wall, opening, room, and spatial selections. Selecting or editing a shared room from a module navigates to the authoritative object; it does not reveal a duplicated module-owned polygon. Shared edits list affected module results before commit where practical and mark only declared dependents stale afterward.

Future building-volume views show their convention, included/excluded boundaries, certainty, and coverage. Missing heights or unsupported complex geometry are located and described. Future rangehood makeup-air tools have their own typed system/controls context alongside MVHR and expose cross-system interaction issues without implying the systems are compatible or balanced.

## Tool ownership and event precedence

Canvas input follows this observable priority:

1. Focused text or dialog control.
2. Active modal or captured gesture.
3. Armed creation or placement tool.
4. Active edit handle.
5. Selection hit testing.
6. Empty-canvas action.

This rule prevents a wall click inside a room from selecting the room and prevents a component placement click from being stolen by containment geometry. A single catalogue click arms placement and shows a realistically sized cursor-following ghost. Drag-and-drop may be additional, never the only placement route.

The editor represents Idle selection, Tool armed, Drawing preview, Numeric editing, Transform preview, Point editing, and Modal transaction explicitly. Cursor, toolbar, inspector, and bottom prompt agree on the current state.

Pointer-down captures one operation, movement previews it, and pointer-up commits one command. Escape or lost pointer capture restores the pre-gesture model when the operation has not committed. Switching floor/tool or opening a modal cancels an incomplete preview with visible feedback.

## Navigation, focus, and keyboard behaviour

Wheel zoom keeps the world point beneath the pointer fixed. Middle-drag or Space-drag pans and then returns to the prior tool without placing anything. The proposed Mac trackpad contract uses two-finger pan and a pinch centred on the gesture; browser/page zoom must not accidentally replace canvas zoom while the canvas owns the gesture. Keyboard shortcuts act only when the canvas owns focus. Typing shortcut letters, spaces, Delete, or Backspace in a property or note field edits that field rather than activating tools or deleting geometry.

Enter accepts a valid numeric field or deliberately completes a valid chain. Escape backs out one level at a time: cancel preview, leave mode, then clear selection. Undo removes the latest draft waypoint before touching earlier committed work. Every shortcut has a discoverable control or menu equivalent.

## Numeric entry and snapping

Every numeric field declares its unit. A field labelled metres interprets `4` as 4 m; `4 m`, `4000 mm`, and `400 cm` are equivalent. Units are never inferred from magnitude. Unsupported or nonfinite input explains the problem and leaves the last valid model unchanged.

Grid display, grid snapping, geometric snapping, angle constraints, and port compatibility are independent controls. The proposed acquisition priority is an explicit numeric constraint, then endpoint or compatible port, intersection, midpoint/projection, and grid. Show the acquired target and permit candidate cycling where objects overlap. Acquisition uses a tested screen-space radius with hysteresis but persists exact world coordinates. A typed value wins over a nearby grid target.

## Walls, rooms, openings, and selection

Straight connected wall chains and rectangles are first-class. Enter finishes a chain without adding a zero-length edge. Rectangle entry declares width, depth, anchor, and internal-face or centreline basis. Shared endpoints and T-junctions create explicit topology.

Closed eligible wall faces are offered for room creation; the user confirms and names the room. Ordinary wall edits keep room identity. Split/merge operations pause for metadata reassignment when necessary. The issue list locates gaps, duplicate edges, invalid openings, or overlaps and gives measured evidence and repair previews. A visually small gap is never silently closed merely to produce a plausible room.

In Select mode, click chooses the topmost eligible unlocked object, Shift-click toggles, and an overlap chooser handles coincident candidates. Proposed marquee behaviour is left-to-right enclosure and right-to-left crossing. Screen-space hit targets make thin geometry usable without changing physical width. Body drag translates; vertex/handle drag edits topology. Persistent joins require an explicit Detach command to break.

The inspector identifies whether it is editing one instance, a compatible multi-selection, active tool defaults, or a catalogue definition. Multi-select shows Mixed values and changes only compatible fields. Apply is one reversible transaction; Cancel restores the prior state. Instance editing never silently changes the catalogue.

## Import and reference interaction

Project creation offers Start blank and Import plan. PDF import provides page selection and a nondestructive rectangular crop before or after calibration; authored page rotation is retained. Crop/Adjust temporarily shows the full page, Reset restores it, and Cancel changes nothing. Cropping only clips the reference and never stretches it, changes scale or moves authored objects. Image import validates actual format and size. Both support a two-point calibration transaction with a positive explicit distance/unit, preview, Apply/Cancel, and optional independent check. “Not calibrated” remains visible until accepted.

DXF import previews declared source units, model-space geometry, available layers, unsupported content, local-origin handling, and transform choices. Unspecified or conflicting units require explicit confirmation. The user chooses included layers and can inspect counted/location-aware diagnostics before acceptance. Cancel leaves the prior project unchanged. An accepted import is one undoable operation and survives save/reopen with checksum and transform.

Reference layers expose visibility, lock, and snap state independently. Tracing creates new Studio objects with their own IDs. Replacing or moving the reference does not move those objects unless the user invokes a separate model/reference transform and approves its preview.

## Catalogue placement and manual routing

A catalogue choice shows verified/provisional status, exact variant, physical envelope, and relevant ports. The placement ghost is the correct world size from its first frame. Invalid placement keeps the ghost and explains the reason.

Manual routing begins at a source port with an allowed product/size. The preview immediately shows true outside width, centreline, candidate target compatibility, and current length basis. Clicks add waypoints; clicking a compatible destination completes the route. Backspace removes the latest draft waypoint. Escape leaves no component, dangling graph edge, quantity, or geometry undo entry.

Committed route, reopened route, and output must agree. Impossible corners or bend radii remain issues rather than being cosmetically rounded into validity. Selection reveals route identity, product family/variant, nominal size, physical OD, hydraulic ID, developed/projected length status, named endpoints, stream, and validation state.

Automatic DN90 routing is a separate preview/apply action after compatible CW/distribution ports and outlets exist. Preview shows the complete 90 mm body, candidate endpoints and unresolved outlets without changing the project. Apply creates ordinary editable Single routes as one undoable batch and does not remove or reroute manual work. Missing scale, outline, compatible capacity, or a fully contained path gives a specific prerequisite or unresolved reason. A path that would leave the building outline is never offered. The action is labelled as geometric drafting only.

## Progressive engineering properties

Property groups use consistent headings: Identity, Geometry, Connections, Design inputs, Performance, Quantities, and Evidence. Common edits stay in the side inspector; uncommon detailed fields use a focused dialog. Calculated values are read-only and link back to inputs. An override is a separate value with reason and actor.

Missing information blocks only the dependent claim. Unknown ceiling height blocks reliable volume, not naming or routing. Unknown fan performance blocks checked duty, not a visibly provisional concept selection. Optional thermal fields remain absent until the module/method is enabled.

Reports and checks are scoped. A module report identifies the design snapshot, module input/method/result versions, coverage, assumptions, and review state. A combined report may assemble multiple module sections but must not make one module's approval appear to approve another.

The first 3D workspace uses floor-local Z=0 and shows the floor transform datum when known. Unit/CW elevation, outlet elevation and duct routing elevation are explicit editable inputs with Known or Assumed state. Unknown heights remain listed and absent from the view rather than being placed at zero. The derived route includes vertical transitions at saved endpoints while retaining the same editable 2D plan route. SVG export repeats the schematic coordination boundary and must not resemble a BIM/clash/fabrication approval.

## Save, snapshots, issues, and recovery feedback

The interface distinguishes Local recovery pending, Recovered on this device, Saving to company account, Saved to company account, and Save failed. It never infers success from a timer or pending request. Explicit Save flushes pending working-draft work and reports actual outcome.

Incomplete drafts with issues are saveable. A stale second tab receives a conflict and options to reload, compare, or preserve a recovery copy. The UI never presents a server save version as a drawing revision. Creating a design snapshot is deliberate and produces an immutable, labelled view. Issued drawings are read-only and visibly linked to their snapshot and artifact metadata. Autosave or Save never creates Rev A.

The product is online-first. Local recovery is described as recovery of recent work, not full offline support or confirmation that the company account received it.

## Sheets and issue behaviour

The initial sheet is A3 landscape with a reserved right-side title block. It includes project/site, authorised client information, drawing title, floor, drawing number, revision, deliberate issue date, drawn by, checked by, status, scale policy, revision history where used, and a legend built from used/configured symbols.

Fixed-scale output warns about clipping instead of silently shrinking. Fit mode reports its actual scale or is explicitly non-scaled. A 10,000 mm model length measures 100 mm at 1:100 and 200 mm at 1:50. Plan products and ducts remain physical model-space widths; text and annotations follow paper-space rules.

The issue flow previews an immutable snapshot, validates required title data, records a deliberate issue purpose, generates the artifact, and adds an issue-register event. Initial purposes are **Preliminary** and **Issued for review**; both say **not for construction**. Technical approval is displayed separately and never inferred from issue purpose, customer payment, or a populated revision field. A later technical-design issue remains unavailable until DEC05 is approved.

The Checked by field remains blank without recorded review. Toolbars, handles, snap marks, current selection, transient warnings, stale customer details, and unverified certification marks never appear in the export. Supersede and withdraw create new history events; they do not alter or delete the original issued file.

## Accessibility and view states

The accepted direction requires keyboard-reachable controls, visible focus, text alternatives for non-text status, colour-independent meaning, usable hit targets, and discoverable equivalents for shortcuts and gestures. Exact contrast, zoom, target-size, screen-reader, and supported-browser criteria remain proposed until DEC07 is approved and tested. The UX must define empty, loading, saving, saved, failed, conflict, read-only snapshot, read-only issue, unavailable module, disabled module, incomplete, stale, blocked, and approved states rather than relying on generic spinners or colour alone.
