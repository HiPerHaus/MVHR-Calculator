# Repository instructions

## Current boundary: bounded initial development

The planning baseline and six approved read-only source references were synchronized before programming. Jono explicitly authorized the initial programming stage on 15 October 2026. The current bounded scope is the renderer-independent spatial/domain model, user-intent commands, synthetic fixtures, automated tests, the manual CAD shell, a reversible device-local recovery adapter, portable project files, and locked PNG reference placement with explicit two-point calibration. PDF and CAD reference adapters remain separately gated later paths.

Use reversible technical defaults and record them in `docs/08-development-decisions.md`. A localhost-only, dependency-free development server may be launched solely to inspect the approved manual CAD shell and must not be described as a hosted or production service. Do not provision authentication, connect billing, create persistent credentials, upload CAD to an external converter, deploy, or initialize external services. Do not claim a synthetic fixture validates a real DWG/DXF file or product compatibility.

## Project separation

Treat this folder as the standalone internal project workspace for **HiPer Studio**. “V2” is only the folder/project label and is not the client-facing product name. Do not rename the folder. Do not copy, move, delete, reformat, or otherwise modify the existing Studio prototype, its repository, its branches, or its saved projects. Existing prototype behaviour is an audit candidate only; reuse requires a documented review and later authorization.

## Source hierarchy

1. Direct user instructions.
2. HiPer Studio Master Specification Version 1.2.
3. Owner-approved decisions that explicitly amend a named master requirement.
4. HiPer Studio UX Blueprint 1.0 for the accepted interface direction, within the master's scope.
5. HiPer Studio Pre Programming Guide 1.0 for preparation and future handover sequencing.
6. The consolidated documents in `docs/`.

When two sources appear to conflict, do not silently choose. Record the issue in `docs/07-open-decisions.md` and seek an explicit decision. Preserve the master file's distinction between agreed requirements, proposed defaults, candidates, and later-gated capabilities.

The documentation foundation has been reconciled to the verified Version 1.2 master and both companion guides. The UX and handover companions cannot silently change product or engineering scope. A proposed control size, dependency, provider, tolerance, SKU, method, or ticket remains proposed until the accountable decision/gate is satisfied.

## Non-negotiable product principles

- Manual, wall-first design works without AI.
- The model is authoritative; no renderer scene, screenshot, or imported drawing becomes the project model.
- Store physical geometry in canonical millimetres. Convert explicitly to SI quantities at calculation boundaries.
- Use stable opaque identities and typed connections. Visual overlap never implies a connection.
- Unknown values remain unknown. Never turn a missing height, pressure loss, scale, or engineering input into zero.
- Preserve XYZ, floor transforms, full equipment orientation, port coordinates, and route rises/drops from the start.
- Imported references remain independent from manually authored design objects unless a user explicitly applies a reviewed transform.
- Unsupported CAD content is diagnosed. Never guess scale, silently flatten unsupported geometry, omit content invisibly, or upload a drawing to an external converter without approval.
- Concept, detailed design, commercial/payment state, SaaS entitlement, technical review, and commissioning remain distinct.
- Commercial **Design engaged** is not commissioning. Commissioning means measured installation performance only.
- Server save version, working draft, immutable design snapshot, and issued drawing revision are separate identities. Autosave never creates a drawing revision.
- Initial issue purposes are **Preliminary** and **Issued for review**, both not for construction. Approval never changes issue purpose automatically; no “Issued for construction” promise exists in this baseline.
- Optional modules share the authoritative building geometry/domain core. They reference stable floors, walls, openings, rooms, and spatial identities rather than copying or redrawing them.
- Each module owns versioned inputs, methods, results, review state, and scoped reports. Cross-module dependency invalidation is explicit and limited to affected results.
- Module availability through subscription/entitlement, per-project enablement, calculation currency, and technical approval are separate states.
- Building volume states its measurement convention, included/excluded boundaries, and completeness. Missing heights and unsupported complex geometry remain explicit.
- Future rangehood makeup air is a separate typed air system and control design alongside MVHR. Interaction checks are explicit; compatibility or balance is never assumed.
- Incomplete drafts are saveable. Checked or released outputs require the relevant validated inputs and human review.
- Future calculation engines are deterministic, versioned, independently tested, and do not call an LLM.
- Do not create an early third-party plugin platform. Initial modularity is an internal application/domain boundary only.
- Initial service is online-first. Local recovery is not a promise of full offline authentication, assets, authorisation, calculation, or export.

## Documentation maintenance

Keep each requirement in its natural home and link to it rather than cloning substantial sections into multiple files. The scope document states what is included; architecture states system boundaries; the domain document states data invariants; the UX contract states observable interaction; acceptance specifications state proof; the roadmap states sequencing; and the decisions register holds unresolved choices.

Use plain, testable language. Label proposals and assumptions. Do not describe an unbuilt capability as implemented, supported, verified, certified, or approved.

Do not place secrets, customer data, private drawings, proprietary source files, access tokens, or credentials in this repository.
