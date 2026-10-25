# Architecture decisions

This document records durable constraints separately from choices that still require a prototype or owner decision. “Accepted” means part of the approved planning baseline. “Proposed” means the master recommends it but an accountable decision is still required. “Gated” means it belongs to a later phase and must not be advertised as initial capability.

## Accepted foundations

### A01 — Renderer-independent authoritative model

The project document and domain rules are authoritative. Canvas/SVG scene nodes, UI component state, screenshots, imported PDF pixels, and DXF render objects are projections or references only. They must not become the persistence format or calculation engine.

This allows the same physical model to serve the 2D editor, deterministic exports, future 3D views, calculations, and migrations.

### A02 — Canonical physical coordinates

Store geometry in millimetres, angles in radians, and a right-handed building coordinate frame with Z up. Store floor-local and product-local transforms explicitly. Preserve full component orientation rather than yaw alone; a normalized quaternion is the proposed canonical orientation representation.

Keep source pixels, PDF points, screen pixels, paper millimetres, world millimetres, and calculation units distinct. Convert to canonical SI units such as metres, cubic metres per second, pascals, and watts only at calculation boundaries. Display formatting and rounding never change stored precision.

### A03 — Explicit unknowns and provenance

An absent measurement or engineering input remains Unknown/null with datum, certainty, provenance, and assumption state where relevant. Unknown is different from zero and Not applicable. A display-only assumed height cannot overwrite physical data or unlock a verified claim.

Consequential inputs retain source, revision/page where applicable, actor/time, assumption reason, and review state. Overrides preserve the derived or original value rather than erasing it.

### A04 — Stable identity and typed relationships

Projects, floors, walls, openings, rooms, catalogue versions, placed instances, ports, routes, fittings, calculations, revisions, sheets, and commercial records use stable opaque IDs. Connections reference typed port IDs and system/stream roles. Adjacent drawings, crossing routes, equal nominal diameters, or reordered arrays never create or change connectivity.

### A05 — Immutable snapshots, deliberate issues, and deterministic engines

The project workflow keeps four identities separate: the server save version used for concurrency control, the editable working draft, an immutable design snapshot of model and inputs, and a deliberate issued-drawing revision that refers to a snapshot plus artifact hashes and issuer evidence. Autosave or an ordinary Save never creates Rev A or any other issue.

Issued quotes, drawings, reviewed calculations, and release evidence refer to an immutable design snapshot and pinned method/catalogue/template versions. New edits continue in the working draft and mark only dependent current results stale. An issue may later be superseded or withdrawn by a new history event; its original files, metadata, and snapshot remain immutable.

A future engine consumes a canonical snapshot and pinned inputs, performs no hidden network lookup, does not fetch “latest” data, does not read live prices, does not mutate the design, and does not call an LLM. It returns values, units, provenance, residuals, warnings/blockers, and affected object IDs.

### A06 — Honest persistence and online-first operation

Local recovery, company-account persistence, exports, snapshots, and issued artifacts have distinct acknowledgements. The UI may say only what the relevant storage layer has confirmed. Server saves use an expected save version; stale tabs must not silently overwrite newer designs. Incomplete semantic drafts remain saveable, while schema or security-integrity failures may block persistence.

The planned hosted product is online-first. Local recovery protects recent work but is not a promise of full offline editing, synchronization, or conflict-free merging.

### A07 — Company isolation as a system boundary

When the hosted product is built, every private project, revision, customer/site record, price list, company catalogue item, asset, calculation, export, cache, and worker result belongs to one company. Membership, roles, cost visibility, billing entitlements, and technical-review authority are separate controls.

This foundation records the requirement only. It does not select or configure an identity, database, storage, email, billing, or hosting provider.

## Proposed implementation shape

### A08 — Modular monolith first

Begin with one deployable application and explicit modules for identity/tenancy, billing/entitlement, project workflow, shared building geometry, catalogue, service networks, engineering, quantities/quotes, exports, and persistence. Keep domain boundaries enforceable without introducing distributed-service complexity before the workflow is proven.

The shared geometry/domain core owns floors, walls, openings, rooms, references, transforms, stable identities, and revision dependencies. Optional per-project modules consume those authoritative records by reference and may add module-owned data; they do not fork geometry or duplicate room records.

Every optional module defines versioned input contracts, method/profile versions, deterministic result records, completeness and review state, declared dependencies, and scoped report/export content. Cross-module invalidation follows those dependencies: a shared edit marks only affected working results stale, while immutable snapshots and issued records retain their original evidence.

Module availability through subscription/entitlement is independent from whether a project enables the module. Enablement is independent from whether inputs are complete, results are current, or a qualified reviewer has approved them.

This is an internal modular application architecture. Do not create a public or third-party plugin runtime, marketplace, arbitrary extension API, or untrusted in-process execution surface in the early product.

React/TypeScript, managed authentication, relational storage, and private object storage are candidates from the master, not decisions made by this planning repository.

### A09 — One production editor renderer

Compare SVG and Konva against the same representative wall/port/route fixture. Consider PixiJS only if measured performance requires it, and assess third-party whiteboard/editor SDKs through bounded licensing and integration work. Select one production editor rather than maintaining parallel editors.

The benchmark must measure input ownership, world-space precision, large-plan interaction, deterministic export needs, accessibility, and target hardware—not just frame rate on a demo.

### A10 — One active editor initially

Begin with a single-editor expectation plus local recovery and server conflict protection. Live simultaneous collaboration and model merging are later features.

### A11 — Authentication and subscription readiness

Plan for company-isolated accounts, email/password sign-in, verification/recovery, membership roles, future MFA assurance, and plan entitlements. Authentication is required before private project/catalogue/file access. Company context is not permission; every protected request rechecks identity, membership, role, and entitlement.

Providers, session pattern, regional data flow, MFA policy, subscription lifecycle, seat policy, grace periods, recovery windows, and retention are open decisions. No actual authentication or billing is configured in this foundation.

### A12 — Future shared-model engineering modules

Building volume derives from the shared physical model under an explicit versioned measurement convention. Inputs and results identify boundary surfaces, inclusions/exclusions, height/elevation certainty, void/shaft treatment, complex/sloped geometry coverage, and completeness. No module may synthesize missing heights or silently simplify unsupported geometry into an approved result.

Rangehood makeup air is a separate typed air network and control domain beside MVHR, not an extra untyped MVHR route. It owns system purpose, terminals/openings, ducts or passive paths, fans/dampers, operating modes, control/interlock logic, target/measured/predicted flows where supported, and evidence. Future interaction checks can consume both systems plus shared building/envelope data, but they must report assumptions and unsupported combinations rather than infer compatibility.

## Import architecture

Reference import is a bounded parser/adapter boundary. An accepted reference stores the original asset identity/checksum, parser/version, source units and coordinates, reversible source-to-building transform, layer selections, entity provenance, diagnostics, and declared approximations.

PDF/image calibration uses two source points and a positive explicit unit/distance. DXF import honours the declared entity subset and its coordinate rules. Parsers are bounded for file size, entity count, nesting, block expansion, and execution time; they do not execute embedded code or fetch external references.

Reference entities remain outside room topology, service connectivity, and quantity calculations. Later semantic conversion, if commissioned, must preview proposed Studio objects and pass the same commands and validators as manual authoring.

## Export architecture

Exports derive from an immutable design snapshot and a versioned sheet template. Preview and final output share one print scene. Model geometry remains in model space; annotation sizes and sheet layout use paper-space rules. An application screenshot is not an acceptable primary drawing export.

The initial issue purposes are **Preliminary** and **Issued for review**. Both carry **not for construction** status. Technical approval is recorded separately from issue purpose, and a later technical-design issue remains disabled until DEC05 is decided. The architecture must not infer construction authority from a revision label, a checked field, payment, or commissioning evidence.

CAD export is separate from CAD reference import. Every later export adapter requires a declared format/version, units/origin policy, geometry coverage, identifier policy, omission reporting, licensing review, and round-trip verification in an independent target application.

## Gated later decisions

- Production 3D renderer and camera/hidden-line rules.
- Static isometric sheet scope and interactive 3D PDF feasibility.
- Exact DWG/IFC import or export support.
- General flexible/branched/mixed-network calculation coverage.
- Building-volume calculation/reports beyond the shared spatial foundation.
- Rangehood makeup-air design and its interaction checks with MVHR, other exhausts, envelope/pressure, combustion, and thermal modules.
- Airflow rule profiles, pressure engine, acoustic method, and commissioning tolerances.
- Heating/cooling methods, weather data, licensing, and validation cases.
- AI assistance of any kind.
- Live collaboration.

None of these gates weakens the accepted requirement to preserve 3D-ready data, extensible typed networks, and deterministic engine boundaries now.
