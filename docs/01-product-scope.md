# Product scope

## Purpose

HiPer Studio is a residential design workspace that joins building-plan drafting, concept estimating, and detailed MVHR design in one persistent project. Its first success criterion is not breadth; it is a dependable manual journey in which a designer can prepare or trace a plan, form rooms from walls, place realistic equipment, route ducts, estimate quantities, save and reopen the work, and issue a clear preliminary A3 drawing.

The first editor is two-dimensional. The underlying physical model is three-dimensional from the beginning so later static isometric drawings, 3D views, and proven CAD export adapters can derive from the same saved geometry rather than from a competing model.

## One project through two working stages

Concept and quotation work may use explicitly preliminary products, approximate routes, assumptions, and incomplete engineering inputs. It must remain honest about what is measured, estimated, provisional, or unknown. Missing thermal construction, weather, fan curves, or commissioning data must not prevent ordinary drawing or a transparent concept estimate.

After the authorised commercial action records **Design engaged**, detailed MVHR work enriches the same project, rooms, components, ports, and routes. It adds confirmed products, flow targets, physical lengths and fittings, supported pressure work, evidence, and review. It does not require a redraw or a second project. Site commissioning is later measured installation evidence and is not the name for commercial engagement.

Heating and cooling analysis is optional in either stage. When it is not requested, it is absent rather than a zero result. Enabling it later may reuse shared building geometry but must introduce only the inputs required by the chosen reviewed method.

## Shared building model and optional modules

Floors, walls, openings, rooms, reference assets, spatial transforms, and stable identities belong to one shared geometry/domain core. Optional modules reference that core. They do not maintain private copies of room geometry, require a redraw, or create competing room records.

MVHR is the initial active module. Each project can enable only the optional modules it needs. Every module owns versioned inputs, method/profile versions, deterministic results, completeness, review state, and module-scoped reports. A dependency graph identifies which shared changes make which module results stale. For example, changing a room boundary can invalidate building-volume and affected ventilation work while leaving an unrelated issued commercial record immutable. Cyclic analysis dependencies are rejected unless an explicitly validated coupled method owns the cycle.

Building volume is a future shared-model capability. Every volume result must name its measurement convention and included/excluded boundaries, such as internal finished surfaces, floor/ceiling or roof treatment, voids, shafts, and multi-height spaces. Missing storey/ceiling heights, sloped or complex geometry, and unsupported boundaries remain explicit and may make the result partial or blocked; they never become zero or a fabricated solid.

Rangehood makeup air is a future optional module alongside MVHR. It is represented as a separate typed air system and control design with its own air path, components, flow/control states, evidence, calculations, issues, and reports. It may reference shared rooms/openings and interact with MVHR, envelope leakage, other exhausts, pressure limits, combustion safety, or thermal work through explicit checks. Coexistence does not imply compatibility, balance, or approval.

Module availability in a subscription, project enablement, result currency/completeness, and technical approval are separate states. The initial modular architecture is internal to the application; an open third-party plugin platform is not an early product goal.

## Initial functional scope

The first internal slice must be able to demonstrate the following connected journey:

1. Sign in to a company-isolated workspace once authentication is actually implemented.
2. Create a project and either start blank or add a PDF, image, or supported DXF reference.
3. Confirm reference units or calibrate a PDF/image without guessing scale.
4. Draw connected straight walls and hosted doors/windows, then derive and name rooms from closed wall topology.
5. Place a small set of verified MVHR catalogue items with realistic dimensions and ports.
6. Represent separate dwelling-supply and dwelling-extract attenuation/distribution paths.
7. Route semi-rigid radial duct manually and represent selected EPP plant connections required by the fixture.
8. Preserve elevations, component orientation, port transforms, and route rises/drops, including explicit unknown states.
9. Save and reopen an incomplete or complete working draft without changing identities or inventing missing data; preserve truthful local/server acknowledgement and stale-write conflict handling.
10. Freeze a design snapshot and produce traceable quantities, a preliminary estimate, and an A3 landscape Preliminary issue with a reserved right-side title/legend block.

The initial catalogue slice is deliberately narrow. It should include selected realistic MVHR units, one supply and one extract attenuator/distribution assembly, 90 mm semi-rigid radial duct, selected EPP plant connections, TVA terminal housings, and required verified fittings/adapters. Flexible duct and general branched or mixed networks are modelled as future-compatible concepts but are not promised as fully supported early engineering topologies.

## Reference imports

PDF and image imports are reversible underlays with source identity, checksum, page/image dimensions, crop, rotation, translation, opacity, and calibration. The imported asset is evidence beneath the authored model; it does not become walls, rooms, or quantities.

DXF is an initial functional reference-import requirement, not merely an adapter interface. The supported subset must be declared from authorised fixtures. The candidate set includes LINE, LWPOLYLINE with validated bulge arcs, ARC, CIRCLE, and common two-dimensional block INSERTs, plus readable text where proven. The workflow must preview units, layers, unsupported content, coordinate origin, and transform choices before acceptance. The designer chooses layers and confirms units when metadata is missing or conflicting.

Supported block base points, nested instance transforms, rotation, scale, object/world coordinate rules, curves, large coordinates, and source handles must be handled correctly within the declared subset. Unsupported entities, external references, proxy objects, non-planar content, malformed transforms, or missing definitions receive counted and located diagnostics. Partial import is allowed only with an explicit warning. No external conversion upload occurs without approval.

Replacing, moving, or recalibrating a reference must not silently move manually traced walls, components, or routes. A model/reference transform is a separate previewed and reversible command.

DWG and IFC are conditional later adapters. They are not initial support promises. Production CAD export, a 3D viewer, static isometric PDF sheets, and interactive 3D PDF are later and independently gated capabilities.

## Workspace and outputs

The workspace follows a familiar CAD arrangement: drafting tools at the top; catalogue and layers at the left; a large central canvas; contextual properties at the right; and dimensions, snaps, constraints, and gesture prompts at the bottom. Project, Plan, Rooms, Ventilation, Checks, and Sheets remain stable navigation concepts. Optional Heating/Cooling appears only when enabled.

The initial primary output is an A3 landscape sheet, 420 × 297 mm, with the right side reserved for title information, revision, issue status, notes, and a legend of actually used symbols. The initial deliberate issue purposes are **Preliminary — not for construction** and **Issued for review — not for construction**. A frozen design snapshot and template version drive deterministic preview and export. Checked-by fields remain blank until a real review is recorded. Technical approval does not automatically change the issue purpose, and **Issued for construction** is not available in this baseline.

Autosave updates the editable working draft and its hidden server save version. It does not create Rev A. A design snapshot freezes model and relevant inputs for runs, reviews, quotes, and exports. An issued drawing revision is a separate deliberate record linking its drawing number/revision, purpose/date, snapshot, artefact hashes, and authorised issuer. Past snapshots and issued artefacts remain immutable; supersession or withdrawal is a new history event.

## State boundaries

The system must never collapse these independent concerns into one status:

- Commercial project stage and customer payment.
- Company subscription and feature entitlement.
- Per-project module enablement.
- Design-module calculation currency.
- Human technical review against an exact snapshot/result set/scope.
- Issued drawing purpose and revision.
- On-site commissioning measurements and their review.

Payment does not confer technical approval. Subscription does not mean a project module is enabled. Design engagement is not technical review or commissioning. A current calculation is not necessarily reviewed. Review approval does not itself issue a drawing. Commissioning measurements do not overwrite design targets.

## Initial exclusions

The initial product excludes AI plan reading, AI tracing, AI drawing, inferred properties, automated routing, autonomous layout, automatic engineering approval, full BIM authoring, fabrication claims, dynamic thermal simulation, an unvalidated pressure solver, advanced freeform geometry, production 3D views, production CAD export, live multi-user editing, implementation of rangehood makeup-air/building-volume engines, and an early third-party plugin platform.

Unavailable features should be hidden or clearly labelled as later work, not presented as inactive promises.

## Evidence and claims

Manufacturer records in the master are seed evidence, not a completed production catalogue. Market, generation, SKU, geometry, port positions, connector compatibility, performance curves, service clearances, packaging, imagery rights, and installation assumptions require verification for the selected release fixture.

The tool may help produce engineering work, but it must not imply statutory certification, manufacturer compatibility, acoustic performance, fabrication readiness, or method approval that has not been established. Provisional data remains visibly provisional. Missing losses or dimensions remain unknown.
