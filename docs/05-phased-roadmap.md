# Phased roadmap

This roadmap sequences evidence and user value. It does not authorize implementation or select a technology stack. The current repository milestone is **Documentation foundation complete**.

## Foundation milestone — documentation only

Deliver this repository boundary, consolidated scope, architecture decisions, domain and UX contracts, phased gates, acceptance specifications, and open-decision register. Maintain a standalone local Git history and keep the existing Studio prototype untouched.

Exit condition: the repository contains planning Markdown, Git metadata, and the six approved read-only source copies listed in `reference-documents/README.md`; Master Specification Version 1.2 is identified as source of truth; unresolved choices are visible; no programming has begun.

## Phase 0 — preserve, decide, and prove foundations

Before product implementation, record the exact existing prototype branch/commit and saved-project formats without modifying them. Decide whether any behaviour, fixture, or module should be reused only after a structured audit. Phase 0 resolves or records sufficient evidence for DEC01–DEC03: CAD/fixture basis, geometry/interaction foundation, and catalogue evidence.

Select one small representative residence and an authorised architectural DXF fixture. Define the exact supported DXF subset and import limits. Select the initial catalogue variants and verify their geometry, ports, compatibility, evidence, and imagery/data rights. Agree the building datum, area convention, dimension and route-allowance conventions, supported desktop browsers/hardware, and target project size.

Define the internal module contract around the shared building core: authoritative geometry ownership, versioned module inputs/methods/results, dependency invalidation, report scoping, and the separate states for entitlement, enablement, currency, and approval. This is a documentation/design contract only; do not create an early third-party plugin platform.

Run bounded technical spikes only after development authorization: compare renderer candidates against the same wall/port/route fixture; prove renderer-free XYZ/orientation serialization and transforms; prove the chosen DXF parser against the authorised fixture; and define tenant/security test architecture before customer data is introduced.

Gate: the fixture and expected outcomes are signed off; unknown/provisional catalogue fields are explicit; source assets are authorised; 3D-ready transform snapshots round-trip; DXF units, transforms, supported curves/blocks, diagnostics, and save/reopen are proven; prototype/migration inputs remain preserved. Candidate binary DWG files alone do not satisfy this gate and are not validated DXF fixtures.

## Phase 1 — internal single-floor slice

Build one complete internal single-floor journey: project entry; blank, PDF/image-underlay, or bounded DXF reference start; wall and opening creation; wall-derived rooms; selected MVHR unit; separate supply/extract attenuation paths; TVA terminals; radial routing; limited verified EPP connections; truthful working-draft persistence; traceable preliminary estimate; and A3 preliminary issue.

Functional DXF reference import is part of this slice. It must provide unit confirmation, layer selection, supported entity/block transforms, snap/trace, diagnostics, and save/reopen. An interface stub, screenshot, or unverified conversion is not sufficient.

The model must already preserve stable IDs, XYZ, floor transforms, full equipment orientation, local port coordinates, known/unknown elevations, and route rises/drops even though the editor is still 2D. It must also contain the internal module envelope and dependency hooks required by the shared-core contract, without implementing later calculation modules.

Gate: wall clicks inside rooms and catalogue placement obey tool ownership; save/reopen retains identities and relationships; a second-tab conflict is safe; local recovery is truthful; saving the working draft is visibly different from capturing a snapshot or issuing a drawing; the estimate works without thermal, pressure solving, or AI; and the underlay/DXF, A3, spatial, compatibility, ancillary-completeness, gesture, and module-envelope acceptance fixtures pass.

This is an internal proof, not a complete paid product.

## Phase 2 — usable manual pilot

Complete and harden the single-floor wall-first workflow: numeric editing, joins/detach, room reassignment, hosted-opening conflicts, selection and mixed-property editing, port-compatible manual routing, required fittings, real-width product rendering, transparent quantities, estimates/quote revisions, deliberate snapshots and issue-register workflows, accessibility, support diagnostics, and resilient import/export. Resolve DEC05 issue/engagement policy and DEC07 accessibility/offline expectations before claiming the corresponding pilot outcomes.

Resolve the selected EPP family and real mounting/adaptor/support evidence. Expand DXF entity/version coverage only through tested fixtures. Keep the declared catalogue and network topology narrow and honest.

Gate: Jono or a representative designer completes the reference fixture without developer data repair; unsupported and incomplete cases remain saveable and visible; relevant Phase 2 acceptance specifications pass; recovery and company isolation are supportable for a limited private pilot.

## Phase 3 — broader modelling and detailed MVHR

Independent tracks may add multiple floors and risers; voids, virtual boundaries, and later manual-boundary rooms; broader flex/EPP/branched topology backed by verified fittings; reviewed airflow rule profiles; pressure budgeting and unit duties; technical review; schedules; and commissioning based on measured installation evidence.

Gate: the original concept project advances without redraw or lost IDs; independently checked deterministic methods pass their reference cases; unsupported topology, missing data, or nonconvergence blocks only the affected claim; detailed MVHR can complete while thermal remains Not requested.

## Commercial readiness gate

External paid onboarding additionally requires a reviewed identity/session design, company/role isolation, cost-data permissions, subscription and seat lifecycle, entitlement reconciliation, agreed MFA policy, audit logging, backup of both records and file bytes, restore drills, privacy/retention/deletion policies, support ownership, and incident procedures.

Payment failure must never delete designs. Customer payment, SaaS billing, and technical approval remain independent.

Commercial readiness is a cross-cutting gate, not evidence that every later engineering feature exists.

## Later independent extensions

- Optional heating analysis, then separately validated cooling/AC methods.
- Building-volume results using explicit measurement conventions, boundary coverage, and unknown/complex-geometry handling.
- Rangehood makeup-air design as a separate typed air/control system, followed by reviewed interaction checks with MVHR and other dependent domains.
- Static 3D/isometric views and ordinary PDF sheets derived from the shared model.
- Independently verified CAD export adapters for selected recipient formats/applications.
- Optional interactive 3D PDF after format, reader, licensing, and security review.
- Broader product catalogue and network families.
- External-method adapters with licensed data and explicit mappings.
- Carefully reviewed AI proposals, only after the manual workflow and validation boundaries are stable.
- Live collaboration and advanced geometry only after their full persistence, conflict, editing, and export contracts are proven.

Each extension has its own scope, acceptance evidence, release flag, and rollback/migration plan. No later extension may rewrite the authoritative model or weaken unknown-value, provenance, tenant, or revision invariants.
