# Domain-model requirements

## Model vocabulary

The domain is organised around physical identity, explicit relationships, versioned evidence, and independent state axes. The following is a prose contract, not a database schema or implementation.

## Project, company, saves, snapshots, and issues

A project belongs to exactly one company in the hosted system. It has a stable identity, display name/reference, optional client/site information, workflow scope, commercial stage, active working draft, enabled modules, and explicit design bases. Company and project ownership cannot be imported as authority from a portable file. A module may be available to the company, enabled for the project, incomplete/current/stale/blocked, and unreviewed/approved as independent states.

The server save version is a concurrency token and acknowledgement sequence; it is not a drawing revision. The editable working draft is distinct from an immutable design snapshot. An issued drawing revision is created only by an explicit issue action and identifies its snapshot, artifact hashes, issue purpose, issuer, date, and relevant pinned versions. Autosave and ordinary Save do not create an issue. Every issued drawing, quote, reviewed calculation, or commissioning reference identifies the exact snapshot and relevant pinned versions. Edits continue in a working draft and mark dependent results stale without altering historical evidence.

Commercial stage, customer payment, company software entitlement, calculation currency, review state, issue purpose, and commissioning state are separate records. **Design engaged** records commercial engagement for detailed work. **Commissioning** records measured installation evidence; it is never a synonym for commercial engagement. No transition in one axis silently changes another.

## Spatial hierarchy

The building uses a right-handed coordinate frame with Z up and canonical millimetres. The project declares a datum. Each floor has a stable ID, name, order, elevation or explicit unknown elevation, default heights where known, and a local-to-building transform. Tab order has no geometric meaning.

Placed physical entities use floor-local XYZ and full orientation. Product instances additionally transform product-local geometry and ports into floor and building frames. A two-dimensional edit changes only its intended coordinates and preserves hidden Z, pitch, and roll.

Every elevation records a datum and certainty state: known, assumed, or unknown, with provenance when consequential. Unknown does not migrate to zero. Drafts with unknown heights remain valid drafts but cannot claim verified developed lengths or 3D clashes that depend on those heights.

## Reference assets

A PDF/image reference records immutable source identity/checksum, page or image dimensions, crop/mask, translation, rotation, positive uniform scale, opacity, visibility, lock state, and calibration evidence. Replacing a source creates a new reference revision.

A CAD reference additionally records source format/version, parser/version, source units, reversible source-to-building transform, local-origin offset where needed, included layers, entity handles, block/instance provenance, model/paper-space identity, diagnostics, omissions, and approximations. Supported source geometry supplies snap targets and trace coordinates only. It is never automatically a wall, room, connection, quantity, or verified engineering input.

## Walls, openings, and rooms

Walls are primary physical boundaries. A wall network contains stable topological nodes and connected edges with floor, endpoints, thickness, reference line, base elevation, height, and physical/virtual classification. A shared wall is one physical assembly, not overlapping duplicates. T-junctions split topology deliberately. Join, Detach, Move segment, and Move connected run are distinct user commands.

Doors and windows are hosted intervals on an oriented wall with stable host reference, offset/anchor rule, width, height, vertical position, orientation, and type data. Moving a host carries its openings. Shortening, splitting, rehosting, or deleting a host must surface conflicts and preserve undoable dependent state.

Rooms initially derive from eligible closed wall faces. A room has its own stable identity independent from the current polygon, plus name/use, floor, geometry-source type, boundary references, holes, area convention, room height/volume evidence, ventilation role, terminal associations, and optional thermal/service-zone relationships. Normal boundary edits preserve room identity. Splits and merges require explicit reassignment of names, demands, terminals, and other metadata; nothing is silently duplicated or discarded.

The first pilot exposes wall-derived rooms. Manual boundaries, voids, and virtual partitions are later features but have defined model roles. Each room has exactly one authoritative geometry source. Rooms, thermal zones, and service zones remain separate concepts.

## Shared core and optional modules

The shared core owns the authoritative spatial hierarchy and revisioned building objects. Optional modules reference stable core IDs and add only module-specific inputs, methods, results, issues, review records, and report definitions. They cannot copy a room polygon into a separately editable module record or require a user to redraw the same building.

Each module instance identifies module type/version, project, enabled state, input-set version, selected method/profile version, result records, dependency hashes, completeness, calculation currency, review state, and scoped outputs. Dependencies can target shared geometry or other published module results. When a dependency changes, affected working results become stale in a traceable way. Unaffected modules and immutable historical issues remain unchanged.

### Building volume

A building-volume definition records the measurement convention and the exact included/excluded boundary basis. It references floors, rooms, walls, openings, ceiling/roof surfaces, voids, shafts, and other boundary entities where supported. It distinguishes whole-building, storey, zone, and room volumes and prevents the same space from being counted twice.

Every contributing height/elevation has known, assumed, or unknown state and provenance. Sloped ceilings, roof volumes, split levels, double-height spaces, partial-height partitions, shafts, atria, and other complex geometry state whether they are supported, approximated with an explicit basis, excluded, or blocking. A partial or unknown volume is not reported as zero or as a complete solid.

### Rangehood makeup air

Rangehood makeup air is its own typed air system. It may reference shared rooms, exterior openings, penetrations, and equipment locations, but owns its system role, source/discharge/transfer paths, components, controls/interlocks, operating modes, flow values, pressure assumptions, evidence, results, and issues. Its ports and connections use the same stable typed-connection principles as other networks while retaining distinct system semantics.

MVHR and makeup-air systems do not merge merely because routes cross, serve the same room, or have equal nominal dimensions. Future interaction checks explicitly evaluate simultaneous operating modes, other exhausts, envelope/transfer assumptions, pressure limits, thermal consequences, and any combustion-safety constraints within reviewed method scope. Missing evidence produces an unknown or blocked interaction result, not assumed compatibility.

## Catalogue definitions and placed products

A versioned catalogue product owns manufacturer, family, exact SKU, market, generation, physical geometry, insertion origin, variants/handing, ports, allowed configurations, performance evidence, clearances, imagery/data rights, and verification state. Verified, provisional, superseded, and unavailable are distinct states. Missing dimensions or losses remain unknown.

A placed instance owns its stable project identity, pinned catalogue version, floor, XYZ position, full orientation, valid selected configuration, system/room association, and presentation. Placed instances cannot be arbitrarily stretched into different products. Catalogue upgrades are explicit comparisons and never rewire existing projects through array-order changes.

Assemblies may present as one grouped object while retaining explicit child products, plates, adapters, supports, caps, and a parent/child quantity policy. Direct and remote equipment/distribution arrangements use the same entity types. A direct connection adds no invented duct length; a remote arrangement contains real connecting geometry and fittings.

## Ports and connections

Each port has a stable definition identity; product-local XYZ; outward direction; shape; nominal, hydraulic, and physical dimensions; mating family/generation/profile; socket/spigot details; insertion depth; semantic air role; allowed direction; occupancy; internal-passage reference; and approved adapters where known.

Port instances expose derived world transforms and current occupancy. A connection is an explicit typed relationship. Validation considers stream, interface geometry, actual mating profile, generation, direction, and occupancy. Matching nominal diameter is insufficient. Unknown compatibility remains visible and cannot become checked merely because symbols touch.

The ventilation network is a port-based multigraph so parallel runs remain separate. MVHR internal supply and extract passages never become one path through the heat exchanger. Use the semantic roles Outdoor intake, Dwelling supply, Dwelling extract, and Outdoor exhaust. Colour is secondary to the stored role.

## Routes, fittings, and elevations

A route has stable identity, source/destination port IDs where resolved, system/stream, pinned duct product/variant, and ordered XYZ geometry. Geometry can contain horizontal, vertical, sloped, and arc segments with elevation datum/certainty, tangent/radius/plane/sweep data as required. Crossings or bridge symbols are presentation and do not create graph edges, fittings, or length.

Keep projected plan length, developed physical length, vertical extent, equivalent loss length, installation allowance, cut/stock length, purchased quantity, and quantity overrides separate. A known plan with unknown height can support a qualified plan quantity but not a verified developed length. Field-bent semi-rigid sweeps, purchased elbows, EPP insertion/coupling treatment, and flexible-duct installation assumptions have distinct quantity and loss rules.

Initial radial policy prohibits side branches on ordinary semi-rigid runs. EPP main connections and future general branched EPP networks are different supported scopes. Mixed networks require explicit transition products.

## Ventilation and optional thermal data

Required, assigned, predicted, and measured airflow are different values with different provenance. Required flow comes from a selected basis; assigned flow is a designer target; predicted flow comes from a supported calculation; measured flow is commissioning evidence. Normal, boost, and other modes remain distinct.

A checked pressure path needs supported topology, actual geometry, bore, flows, fitting/terminal/attenuator data, fan curves, operating conditions, and consistent pressure boundaries. Missing data makes the affected result incomplete; it does not become zero.

Thermal information is isolated in an optional module. Weather, indoor conditions, fabric, glazing, shading, gains, airtightness, infiltration, ventilation recovery, and equipment performance appear only when the selected method requires them. Peak load, annual energy, sensible, latent, room peak, coincident system peak, and noncoincident sum are distinct result types.

## Quantities, quotes, sheets, and results

Every take-off row traces to source objects, pinned product version, measured quantity/unit, allowance rule, purchase rounding, completeness, and any override reason. Model-derived and manually added items remain distinguishable. Assembly policies prevent double counting.

A draft estimate may recalculate against the working draft. Issuing a quote freezes a commercial snapshot of quantities, prices, currency/tax basis, exclusions, assumptions, and commercial text. Supplier costs and margins are permission-shaped server data in the future hosted product; hiding a client column is not authorization.

A calculation run stores the immutable input hash, module, scenario, method/profile/version, pinned datasets, options, creator/time, completeness, results, units, residuals, warnings, and blockers. A review references the exact run, design snapshot, and scope and records reviewer permission, decision, time, and comments.

A sheet/export definition stores template/version, page/orientation, selected floors, viewport, fixed-scale or fit policy, layer preset, title data, issue metadata, legend choice, approved assets, notes, and revision history. Preview and output derive from one immutable print scene tied to a design snapshot. Initial drawing issues use purpose **Preliminary** or **Issued for review**, both marked **not for construction**. Technical approval is a separate record. Superseding or withdrawing an issue appends history and does not rewrite the original artifact.

## Persistence and portability invariants

Schema validation applies at import, persistence, and API boundaries. Migrations are sequential and preserve original files. Unsupported future versions open read-only or fail clearly. Portable imports cannot grant tenant ownership, roles, entitlements, catalogue verification, reviewer identity, approval, or current calculation authority.

The hosted workflow is online-first. A local recovery record may preserve recent working-draft state and its last acknowledged server save version, but it is not an authoritative issue, a complete offline project, or evidence of server persistence.

Undo operates on user-intent commands and restores identities, hosts, relationships, and dependent state. Pan, zoom, selection, and other navigation do not dirty the domain model. Uncommitted placement ghosts or route waypoints are not physical components and never enter quantities.
