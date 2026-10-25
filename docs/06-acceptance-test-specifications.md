# Acceptance-test specifications

These are proposed acceptance specifications, not test results. Implementation must inspect persisted model state as well as pixels. Unless later agreed otherwise, deterministic geometry comparison uses 0.01 mm and area comparison uses 0.001 m²; these are software tolerances, not survey accuracy.

The Master Specification acceptance catalogue is authoritative: UI01–UI14, G01–G15, N01–N15, S01–S15, F01–F12, X01–X08, and M01–M08. The scenarios below expand that catalogue in prose; they do not renumber or replace it. Phase-gate evidence must identify the applicable master IDs and distinguish a proposed threshold from a passed result.

## Phase 0 and model-foundation proof

### Spatial round trip

Create a renderer-free fixture containing known and unknown Z values, a floor transform, component yaw/pitch/roll, product-local ports, and a route with a rise. Serialize, reopen, migrate, and portable-export/import it. IDs, units, datums, certainty states, orientation, and relationships remain exact within tolerance. A 2D XY move does not reset Z, pitch, or roll. Null elevation remains null.

For a numerical transform fixture, use a floor translation of (10000, 20000, 3000) mm with +90° yaw; component position (1000, 2000, 300) mm with +90° yaw; and a local port at (100, 0, 50) mm pointing (1, 0, 0). The building port is (7900, 21000, 3350) mm and direction (-1, 0, 0). Inverse transforms recover local values. Add a separate pitch/roll case.

### Physical-length separation

A 3000 mm horizontal segment followed by a 2000 mm rise has 3000 mm projected length and 5000 mm developed line length before fitting treatment. A direct diagonal between the endpoints is approximately 3605.551275 mm. Removing required Z preserves the plan projection, makes developed length incomplete, and blocks a verified 3D claim without blocking draft save.

### Automatic DN90 containment

Place a typed supply CW bank and two supply outlets inside a calibrated concave outline. Preview proposes separate compatible free branch ports, displays the smoothed 90 mm body entirely inside the polygon, changes no model state, and reports any impossible outlet separately. Apply adds ordinary Single routes in one undo entry; Undo restores the exact previous project and repeated preview does not duplicate occupied routes. Existing manual routes remain byte-for-byte unchanged. Repeat for Extract, exhausted capacity, an endpoint within 45 mm of the boundary, missing scale, missing outline, an HRV without DN90 ports, and a shape where a centreline could fit but its 45 mm radius could not. No case creates a shortcut outside or a pressure/airflow claim.

### Height-aware 3D coordination drawing

Set floor-local unit/CW, outlet and duct-routing elevations as explicit assumptions. Save/reopen retains their values and state. The 3D scene uses the source-backed component envelope when known, derives vertical transitions between endpoint and routing elevations, and leaves the authoritative 2D route points unchanged. Undo restores every prior unknown. Repeat with Known values, an unknown component elevation, unknown product height, a rotated component and a route whose endpoint port has a nonzero local Z. Unknowns remain diagnostics; no value becomes zero. Deterministic SVG output includes its datum and schematic/no-BIM/no-clash boundary.

### Catalogue geometry authority

Round-trip one fitting with known physical radius and ports and one provisional item with unknown height. Provenance and dimensions survive. A schematic display envelope cannot fill the unknown physical height, change quantities, or grant verified clash/compatibility status.

### Phase 1 module envelope

Create a project with the initial MVHR module enabled and a later module represented only by its versioned envelope. Save/reopen preserves the module identity, enabled state, input/method/result placeholders, declared shared-core dependencies, completeness, currency, and review axes. No later engine runs and no duplicate floor, wall, opening, or room geometry is created.

## Import acceptance

### PDF/image calibration

Calibrate a 1000-pixel reference span to 10 m. An independent 500-pixel span measures 5 m. Empty, nonfinite, zero, negative, coincident-point, and unsupported-unit input cannot apply. Recalibrating the reference after a 3000 mm authored wall exists leaves that wall at 3000 mm unless the user invokes and accepts a separate model/reference transform.

Import page 2 of a three-page PDF, crop it to the floor-plan region, calibrate it, add walls and MVHR markup, then adjust the crop. Page identity, checksum, original bytes, source transform, calibration evidence and every authored object remain unchanged. Save/reopen and portable backup retain the crop. Reset restores the full page, Undo restores the crop, and the A3 scene clips without stretching the original page image. Empty and out-of-page crops cannot apply; Cancel changes nothing.

In Phase 1, the accepted PDF/image underlay and bounded DXF reference both survive save/reopen with source identity, visibility, lock/snap state, and transform. Neither creates authoritative walls, rooms, quantities, or service connections.

### DXF units, origin, and privacy

Import authorised millimetre and inch fixtures containing equivalent 10 m reference geometry. Both measure 10 m within tolerance after explicit unit confirmation. Unspecified or conflicting units require a user choice; the importer never guesses.

With a 1,000,000,000 mm source offset, local-origin conversion preserves a 1 mm feature within tolerance and reverses correctly. Save/reopen retains source checksum, original/source coordinates, local origin, and transform.

The importer does not upload files to an external conversion service without approval, execute embedded content, or fetch external references. Cancellation leaves the project unchanged. Malformed or oversized input fails safely.

### DXF blocks, curves, layers, and omissions

Use nested blocks with nonzero base points, rotations, supported scales, and independently calculated transformed endpoints. Supported LWPOLYLINE bulges, arcs, and circles preserve curve geometry and snap points. Source handles, layers, and instance paths survive as provenance.

The user can select layers before acceptance. Reference geometry provides snap/trace targets but creates no rooms, connectivity, or BOM rows. Missing external references, unsupported entities, cycles, transforms, or proxy/custom objects produce counted and located diagnostics. A partial import remains visibly partial and is never described as complete.

Replacing/moving/recalibrating the accepted reference does not move manually traced Studio objects.

## Core editor acceptance

### Tool ownership and focus

Start a wall chain, click inside a room, then click a neighbouring room edge. The wall tool adds intended/snapped points; the room is not selected and the chain remains active.

Single-click an eligible catalogue item and then click inside a room. A correctly sized ghost follows the pointer and exactly one instance is created at its world position. Containment is evaluated after placement.

Arm placement, Space-pan, release, and place. Arm a second item and Escape. The first remains; the second leaves no instance, connection, quantity, or undo entry.

Type shortcut letters, spaces, Delete, and browser-standard shortcuts in text/property controls. Text input retains ownership and no geometry/tool action occurs.

### Numeric entry, chains, and undo

In a field labelled metres, separate entries `4`, `4 m`, `4000 mm`, and `400 cm` all create 4000 mm. Empty, unsupported, and nonfinite values leave the prior model untouched and provide a specific explanation.

Draw A(0,0), B(6000,0), C(6000,4000), then Enter. Exactly two edges and three logical nodes exist, with no zero-length edge, as one committed transaction. Undo of provisional points acts on the draft before committed history; Escape removes the unfinished draft without debris.

Cancel or lose capture during a connected move. Exact pre-gesture coordinates, joins, opening hosts, and port attachments return. Pointer movement during the preview does not create multiple undo entries.

### Wall topology and room identity

Draw a 6000 × 4000 mm internal rectangle on a blank plan. It produces four joined physical walls and one eligible 24.000 m² room without calibration or AI.

Create adjacent 4 × 4 m rooms sharing one wall. There is one physical wall. Moving it 500 mm updates both room areas and connected endpoints without duplicates.

Name a derived room, edit its boundary, save, and reopen. ID/name remain while area updates. Split/merge invokes reassignment and does not lose or duplicate labels, demands, terminals, or commissioning associations.

Test a bow-tie, duplicate edge, zero-area face, and 5 mm gap. The issue list identifies the actual geometry; no false closed room appears. The invalid/incomplete draft remains saveable where schema integrity is intact.

### Hosted openings and selection

Place a 900 mm door at a 1000 mm offset on a 4000 mm wall. Move the wall, change swing, undo/redo, and reopen. Host ID, interval, dimensions, and orientation remain correct. Oversized or overlapping openings do not masquerade as valid.

Delete a host and dependent opening, then Undo. Both IDs and properties return. Sampling copies permitted type properties only, creating new identity/position/host for the new opening.

At multiple zooms, snapping to the same endpoint stores identical world coordinates. A typed 3750 mm value visibly overrides a nearby 4000 mm grid target. Grid visibility and grid snapping remain independent. Overlap cycling, Shift-toggle, lock/exclusion, and proposed directional marquee semantics behave consistently. The proposed starting points are an 8 px acquisition radius and 12 px release hysteresis; they remain proposals until DEC02 testing confirms or replaces them.

## Catalogue, routing, and network acceptance

### Physical placement and true-width routing

Place a verified fixture unit and begin a route at two zoom levels. Product envelopes and duct OD match the catalogue in world units from the first preview frame. Save/reopen and A3 output agree with the committed scene.

Route from a port through draft waypoints. Backspace removes the last uncommitted point; Escape removes the entire unfinished route without a graph edge or quantity. Invalid corners remain actionable issues rather than visually plausible but false geometry.

### Typed compatibility and separate air paths

Attempt connections with wrong size, connector generation, stream, mating profile, or occupied port. No silent attachment or substitution occurs. A known adapter may resolve a declared case; unknown compatibility remains provisional.

Graph traversal never crosses from extract to supply through an MVHR heat exchanger. Two crossing routes remain disconnected, and bridge decoration changes no graph, fitting, or length.

Connect two manifold ports to two supported TVA ports. Both radial runs retain independent identities, selection, occupancy, and quantities. Changing one resistance cannot leave an unjustified equal-flow assumption in later engineering.

### Assemblies, versions, and quantities

Compare direct and remote arrangements. Verified direct attachment adds no fictitious duct length. A provisional Aerofresh/ComfoWell interface does not gain a checked badge. A remote connection contains actual EPP geometry and fittings. Parent/child assembly items are not double counted.

Reorder a product's displayed ports and publish a later catalogue version. Existing attachments and issued records remain pinned. A deliberate upgrade previews geometric/performance differences and invalidates only dependent current results.

A 26 m physical route with 10% purchase allowance yields 28.6 m required stock and may round to one 50 m roll. Hydraulic/physical length remains 26 m unless actual installed geometry changes.

### Installation context and ancillary completeness

For each Phase 1 route, record whether it is inside or outside the thermal envelope and any required insulation, vapour-control, airtight, structural, fire, or acoustic penetration treatment. These fields exist independently of a future thermal module. Missing applicable context remains unknown or an issue; it is not silently accepted.

The preliminary estimate and issue checklist account for outdoor terminals/cowls, supply and extract valves, condensate drainage, airtight penetrations, and filters as verified items, explicit allowances, or explicit exclusions. Absence is visible and traceable rather than disappearing from the design.

## Persistence and security acceptance

Save and reopen a fixture containing walls, hosts, rooms, references, ports, routes, unknowns, and assumptions. IDs, units, relationships, and known dimensions remain stable; metre values cannot be interpreted as millimetres.

Inject local quota/storage denial, network loss, and server failure. No false Saved state appears. With local storage retained, the last acknowledged snapshot can recover and identifies its project/time. A forced close before acknowledgement is not reported as saved.

Open two editors at server save version N. Save N+1 in one and then attempt to save stale N from the other. The stale save cannot overwrite the newer design; recovery/compare choices are offered. A delayed earlier acknowledgement cannot mark later unsaved work as saved.

Save an incomplete working draft several times. No design snapshot, drawing revision, or issued artifact is created. Then explicitly capture snapshot S1 and issue Rev A as Preliminary. Later edits change the working draft without changing S1 or Rev A. Issuing from a later snapshot creates a new deliberate issue; superseding or withdrawing Rev A appends history and preserves its bytes and metadata.

Forge a portable file to claim another company, reviewer approval, entitlement, verified catalogue data, or current calculation hashes. None gains authority. Imported claims remain provenance until a supported rerun or authenticated review.

When hosted capabilities exist, Company A cannot read, count, mutate, export, queue, or download Company B's resources by substituting IDs. Switching companies cancels/scopes late reads and saves. Cost/margin data is absent—not merely hidden—from unauthorised API responses, caches, recovery, portable exports, logs, previews, and PDFs.

## A3 and issue acceptance

The exported page is exactly 420 × 297 mm landscape with the reserved right sidebar. At 1:100, a 10 m line measures 100 mm; at 1:50 it measures 200 mm. Fixed-scale overflow warns instead of silently shrinking. Fit output reports the actual scale or explicit non-scaled status.

At high zoom, designed geometry and text remain vector/selectable where specified. No toolbar, handle, current selection, snap marker, obsolete client detail, old product inset, or unverified badge appears. The title block includes revision, deliberate issue date, status, and a used-symbol legend. A Preliminary or Issued for review output is marked **not for construction**. Checked by remains blank without a separate recorded review.

Two exports from the same immutable design snapshot and template produce the same design content despite working-draft edits, screen zoom, hidden labels, or catalogue filters. Output metadata records snapshot, issue revision where applicable, template/preset/generator, and checksum.

## Workflow-boundary acceptance

Create a concept quote with no thermal module and no pressure result, then record Design engaged and advance that same project to detailed MVHR. Stable object IDs and history remain. Recording customer payment, Design engaged, or SaaS payment changes neither calculation currency nor technical approval. Commissioning remains unavailable until measured installation evidence exists.

Remove an essential fitting curve, bore, or elevation. The affected engineering result becomes incomplete/blocked; preliminary drawing and transparent quote remain usable. A warning acknowledgement cannot turn missing evidence into a complete result.

Required, assigned, predicted, and measured airflows remain separate across editing, reports, and commissioning. Blank commissioning measurements stay blank.

## Future module-contract acceptance

### Shared geometry without duplication

Enable two optional modules on one project and have both reference the same stable room and floor IDs. Edit a shared wall once. Both modules observe the revised authoritative geometry; no duplicated room polygon or second room identity appears. Only results declaring that geometry dependency become stale, and immutable issued records remain reproducible against their original snapshot.

### State-axis separation

Exercise company entitlement, project enablement, input completeness, result currency, and technical review independently. Granting subscription availability does not enable a module in an existing project. Enabling it does not create a result. A current result is not approved. Revoking future use does not rewrite historical issued records or delete shared building data.

### Versioned inputs, methods, and scoped reports

Run a module with input set N and method/profile M, then change a dependency and run again. The old result remains pinned and reproducible; the new result records new versions/hashes. A module report states its design snapshot, method, inputs, coverage, assumptions, completeness, and review scope. Combining report sections does not transfer approval between modules.

### Building volume

Calculate a simple known rectangular volume under a named measurement convention, then test a missing height, sloped ceiling, void/shaft, split level, and double-height space. Each case identifies included/excluded boundaries and coverage. Unknown or unsupported geometry produces a partial/blocked result rather than zero, silent extrusion, or double counting.

### Rangehood makeup air

Model a future makeup-air system and an MVHR system in the same building using distinct typed systems and port/route identities. Shared room references do not merge networks. Simultaneous-operation and cross-module checks identify their exact input/method scope, assumptions, and missing evidence. Equal nominal sizes, route crossings, or shared rooms never imply compatibility or balance.

## Later deterministic numerical fixtures

When engineering phases begin, preserve the master specification's synthetic reference cases for unit conversion, areas, conduction, interzone conservation, airtightness, balanced/unequal heat recovery, latent separation, pressure loss, branches, coincident peaks, and quantity basis. These fixtures are test-only values, not design defaults, product curves, or regulatory rates. Methods also require independent validation, residual checks, declared tolerances, and applicable-source review.
