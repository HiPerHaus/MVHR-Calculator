# HiPer Studio — Technical Review & Roadmap
**Reviewer scope:** architecture, Passive House methodology compliance, code defects, production readiness.
**Date:** 11 June 2026. No code was changed; all findings reference current files.

---

## 1. Current state (what exists)

| Layer | Implementation |
|---|---|
| Frontend | 13 static HTML pages, vanilla JS, hand-rolled SVG schematic editor (`studio-duct-design.html`, 2,322 lines). No framework, no build step. |
| Backend | Vercel serverless functions (`api/`), Node 22, ES modules. |
| Data | Supabase (Postgres + Storage + Auth), RLS enabled, service-role key used in all API routes. |
| AI pipeline | PDF upload → mupdf render → Haiku page classification → Sonnet 4.6 room extraction with Opus 4.5 recovery escalation (`api/ai/analyse-plan.js`, 2,408 lines). Well-engineered two-stage design. |
| Billing | Stripe Checkout + webhook with signature verification and DB-side idempotency. Credit costs resolved server-side. |
| Calc engine | Airflow design basis (occupancy/area), room allocation + balancing, MVHR unit scoring, two-phase duct layout generation, BOM. |

The AI pipeline and billing layer are the strongest parts. The calculation engine is structurally sound but deviates from PHI methodology in specific ways, and the duct module stops short of actual engineering analysis.

---

## 2. Findings

### 2.1 Critical — security

| # | Finding | Location |
|---|---|---|
| C1 | **IDOR: `airflow.js` never verifies project ownership.** POST loads `project_rooms` filtered only by `projectId` (line 913–918) using the service-role client (bypasses RLS). Any authenticated user can run a calculation against any project ID and receive that project's full room schedule in the response. | `api/studio/airflow.js` |
| C2 | **IDOR: `rooms.js` GET and POST have no ownership check.** GET returns all rooms for any `projectId`; POST inserts rooms into any project. PATCH/DELETE are guarded by `user_id`, GET/POST are not. | `api/studio/rooms.js:55–95` |
| C3 | **IDOR: `seed-rooms.js` loads any project's `ai_analysis_json`** with no `user_id` guard (line 151–155), leaking another user's AI analysis and allowing room seeding into it. | `api/studio/seed-rooms.js` |
| C4 | **CORS `Access-Control-Allow-Origin: *` set in every studio/AI handler**, overriding the restrictive `https://hiper-studio.au` header in `vercel.json`. Combined with Bearer-token auth this widens token-replay surface. | `cors()` in `airflow.js`, `duct-design.js`, `bom.js`, `rooms.js`, etc. |
| C5 | **PostgREST filter injection:** `node_id` and the admin search `q` are string-interpolated into `.or()` / `.not()` filters (`duct-design.js:736`, `admin/users.js:85–89`). Low exploitability with service role, but unvalidated input reaching a query DSL must be sanitised (UUID-validate `node_id`; escape `q`). | `api/studio/duct-design.js`, `api/admin/users.js` |

`duct-design.js`, `bom.js`, and `upload-pdf.js` do check ownership — the fix pattern already exists in the codebase; C1–C3 are omissions, not a missing concept.

### 2.2 Critical — Passive House methodology

| # | Finding | Detail |
|---|---|---|
| P1 | **Extract air demand is excluded from the continuous design flow.** The file header (`airflow.js:6`) states `designFlow = max(occupancy, area, wetRoom)` but the code computes `max(occupancy, area)` only (lines 565–569), demoting wet-room extract to a "boost check". PHI sizing (per DIN 1946-6-aligned method) takes the maximum of supply demand, **extract demand at nominal rates**, and the air-change minimum. A bathroom-heavy house will be undersized. The comment/code contradiction also signals an undocumented methodology change. |
| P2 | **The 0.30 ACH minimum check is wrong/absent.** Comment at `airflow.js:44` claims 1 m³/h·m² ≈ 0.30 ACH at 2.4 m ceilings; it is actually ≈ 0.42 ACH (0.30 ACH ≈ 0.72 m³/h·m²). There is no volume-based ACH check at all (no ceiling heights in the data model). PHI's average ≥ 0.30 ACH criterion cannot currently be verified or reported. |
| P3 | **Treated floor area comes from AI visual estimation only.** The extraction prompt says "Estimate area (m²) if visible" — no scale calibration, no dimension-string parsing, no vector/DXF measurement. This AI-guessed area can become the *governing* design flow (designDriver = 'area'). Not auditable and not defensible for PHI certification. TFA must come from measured geometry or PHPP import, with the AI estimate clearly flagged as provisional. |
| P4 | **No pressure-drop, velocity, SFP, or acoustic calculation exists anywhere.** Duct "sizing" is a flow-band lookup (`calcTrunkDiameter`). `pressure_drop_pa` is a column the *client* may PATCH in — the server never computes it. SFP ≤ 0.45 Wh/m³, velocity limits, and attenuation checks from the product spec are entirely unimplemented. |
| P5 | **The duct lookup table itself exceeds PH velocity targets.** At band tops: 250 m³/h in DN160 = 3.45 m/s; 400 m³/h in DN180 = 4.37 m/s; >450 in DN200 ≈ 4 m/s — against the stated 2–3 m/s target and PH acoustic practice (≤3 m/s mains, ≤2 m/s near terminals). |
| P6 | **PH compliance is scored, not enforced.** Unit matching gives bonuses for PHI cert / high HR eff / low SFP but will happily recommend a non-certified, 65 %-efficient unit if it scores well on load. There is no hard gate or compliance flag (HR ≥ 75 %, SFP ≤ 0.45 Wh/m³) and no warning in output when the selected unit fails PH criteria. Boost capability is a +200 score bonus, not a requirement. |
| P7 | **BOM run lengths are fictional.** `calcRunLength` (frontend) = straight-line schematic pixel distance × `scale_m/1200`, with `scale_m` defaulting to 12 (i.e. the whole canvas spans 12 m). Schematic nodes are auto-placed in columns (x=700/950), so distances bear no relation to the building. BOM duct quantities derived from this are not quotable. |
| P8 | **BOM omits Zehnder assemblies and key components.** `computeBom` counts only `supply_manifold`/`extract_manifold`; `comfowell_supply`/`comfowell_extract` nodes are never counted, so a Zehnder design produces a BOM with no distribution components. Also missing: attenuators, filters, condensate drain, controller, plenums/valves as discrete line items. |

### 2.3 High — correctness & robustness

1. **Non-transactional recalculation** (`airflow.js:945–1040`): delete old design → insert new design → insert rooms as separate calls. A failure mid-sequence leaves the project with no airflow design and detached duct designs. Move to a single Postgres RPC (transaction).
2. **`duct_designs.airflow_design_id` has no `ON DELETE` behaviour** (migration `20260608_duct_design.sql:10`); the code manually nulls it — works, but only because of the manual step that the transaction issue above can skip.
3. **Rate limiting is per-instance in-memory** (acknowledged in `lib/rate-limit.js`) and absent entirely on `airflow`, `duct-design`, `rooms`, `bom`. Anthropic-spending endpoints are limited per warm instance only. Move to Upstash/Redis as the file itself suggests.
4. **`applyRateLimit` footgun:** if a caller omits `limiter`, a fresh limiter is constructed per request (no-op limiting). Current callers pass one; the API invites misuse.
5. **Duplicate JSON key** in the final-totals log (`airflow.js:638–643`): two `event` keys — the first is silently dropped.
6. **`isPlantRoom` matches "laundry", "store", "garage"** (`duct-design.js:59`) — a laundry will be auto-nominated as the plant room hint.
7. **`add_run` doesn't validate** that `from_node_id`/`to_node_id` belong to the design; orphan/cross-design edges possible.
8. **PATCH node/run updates loop one query per row** — a 60-node drag-save issues 60 sequential round-trips; use upsert batching.
9. **`checkout.js` uses `req.headers.origin` unvalidated** for Stripe success/cancel URLs — allowlist it.
10. **`auto-analyse` falls back to a host-header check when `INTERNAL_API_SECRET` is unset** — fail closed instead.
11. **Zero automated tests** (`npm test` is the placeholder error). For a tool whose output is an engineering compliance claim, the balancing, sizing, and unit-selection logic must have a regression suite with known-answer fixtures.
12. **Monoliths:** `index.html` (5,921 lines), `MVHR-Sizing-Calculator.html` (5,837), `analyse-plan.js` (2,408). No shared modules between the legacy calculator and the studio engine — two parallel implementations of sizing logic already exist (drift risk).

### 2.4 Notes (acceptable / good)

Stripe webhook verifies signatures, cross-checks credits against the DB, and is idempotent via `stripe_payment_id`. Credits deduct only on successful analysis. `rooms.js` whitelists writable fields. RLS policies exist on all new tables (though every API route bypasses them with the service role — RLS is currently a safety net for direct client access only). The two-stage Sonnet→Opus extraction with server-side derivation of classification fields ("AI never sets compliance fields") is exactly the right pattern for auditability.

---

## 3. Architecture assessment vs. the product spec

| Spec module | Status | Gap |
|---|---|---|
| AI plan reading | ~70 % | PDF raster path solid. No DXF ingestion, no scale calibration, no geometric area measurement (P3). Room validation flags exist (`requiresManualReview`) but PHI rule-based validation (min ACH per room, occupancy cross-check) is not a distinct, reportable layer. |
| Sizing engine | ~50 % | Airflow basis + balancing implemented; extract-demand sizing (P1), ACH check (P2), pressure drop/SFP/acoustics (P4–P5), and PH compliance gating (P6) missing. |
| Drag-and-drop drawing tool | ~40 % | Hand-rolled SVG editor works for schematic + plan-overlay node placement. No real geometry (routes are logical edges, not polylines), no snapping/orthogonal routing, no live recalculation (nothing to recalculate yet), no component palette beyond add-node. |
| Exports | ~15 % | CSV + `window.print()`. No DXF, no drawing-sheet PDF, no PH design report. |

**Frontend recommendation.** The vanilla-SVG approach has hit its ceiling (2,300 lines of imperative DOM code for one page). For the editable schematic with snapping, polyline routing, live recalculation and DXF/PDF output, move the duct-design page to **React + Konva.js** (canvas performance for plan-image + many nodes; mature drag/snap patterns; `react-konva` keeps state declarative) with **Zustand** for the design-graph store. Keep the rest of the studio pages as-is short-term — migrate page-by-page; don't big-bang.

**Backend recommendation.** Keep Vercel serverless + Supabase — it fits the workload (bursty, I/O-bound, AI-orchestration). The sizing engine should become a **pure, versioned TypeScript package** (`packages/engine`) consumed by both API routes and (for live recalculation) the browser — same code, same numbers, unit-testable, and the engine version stamps every saved design for auditability. Pressure-drop math (Colebrook/Atkinson friction + fitting zeta factors) is microseconds of compute; no separate compute service needed.

**Data model recommendation.** Current `duct_nodes`/`duct_runs` is the right graph spine. Add: `duct_runs.geometry` (polyline, plan-space), `duct_runs.fittings` (jsonb: bends/junction zeta list), `project_rooms.ceiling_height_m` and `volume_m3` (for ACH), `airflow_designs.engine_version`, and a `design_reports` table storing the frozen compliance snapshot (inputs + outputs + engine version) at report issue time.

---

## 4. Roadmap

### Phase 0 — Security & integrity hardening (1–2 weeks) *do before any marketing push*
1. Add project-ownership guards to `airflow.js`, `rooms.js` (GET/POST), `seed-rooms.js` (copy the pattern from `duct-design.js`). Add a shared `requireProjectOwner(supabase, projectId, userId)` helper so this can never be omitted again.
2. Remove `Access-Control-Allow-Origin: *` from all handlers; rely on `vercel.json` or a shared origin-allowlist helper.
3. UUID-validate `node_id` and all interpolated filter inputs; escape admin search `q`.
4. Wrap airflow recalculation (delete + insert design + insert rooms) in a single Postgres function (transaction).
5. Move rate limiting to Upstash Redis; apply to all mutating + AI endpoints. Fail closed when `INTERNAL_API_SECRET` is missing.
6. Allowlist `origin` in `checkout.js`.

### Phase 1 — Engine correctness & PH compliance core (3–5 weeks)
1. Extract sizing logic into `packages/engine` (TypeScript, pure functions, no Supabase imports). Port `calculateAirflow`, balancing, unit matching. Stamp `engine_version`.
2. Fix design-flow basis: `designFlow = max(occupancyFlow, extractDemandNominal, areaFlow)` per PHI; keep boost as a separate check. Reconcile header comments with code.
3. Add room volumes (ceiling height field, default 2.4 m, user-editable) and implement the **0.30 ACH average minimum check** as a reported compliance line; fix the rate/ACH comment.
4. Enforce PH gates in unit selection: hard-flag units with HR < 75 % or SFP > 0.45 Wh/m³ (selectable only with explicit user override + recorded justification). Make boost capability a requirement, not a bonus.
5. Known-answer test suite: 6–10 reference dwellings (PHPP-verified) asserting design flow, per-room allocation, balance status, and unit shortlist. CI on every push.

### Phase 2 — Duct engineering analysis (4–6 weeks)
1. Pressure-drop engine: friction (duct type roughness, semi-rigid vs EPP vs spiral), fitting losses (zeta library per bend/tee/plenum), index-run identification, external static at design + boost.
2. SFP verification: fan power from the selected unit's PHI-measured curve (or `ext_pressure`/airflow interpolation) vs the computed external static → report Wh/m³ against 0.45 limit.
3. Velocity checks per segment with PH limits (mains ≤ 3 m/s, branches ≤ 2.5, terminal runs ≤ 2) — replace/validate `calcTrunkDiameter` bands accordingly (current bands breach 3 m/s).
4. Acoustic check: terminal-velocity-based dBA estimate + attenuator insertion rules; attenuators become BOM items.
5. Real lengths: route polylines drawn on the calibrated plan (user sets scale from a known dimension once per sheet); BOM lengths from geometry + fitting counts, not schematic pixels. Fix ComfoWell omission in `computeBom`.

### Phase 3 — Canvas editor v2 (5–8 weeks, overlaps Phase 2)
1. Rebuild duct-design page on React + Konva: component palette (unit, valves, runs, bends, attenuators), snap-to-grid/orthogonal routing, multi-select, undo/redo.
2. Live recalculation: engine package runs in-browser on every graph edit; velocity/pressure badges per segment; compliance panel updates in real time.
3. Plan calibration UX (two-click scale set), multi-floor riser handling.

### Phase 4 — Exports & certification-grade reporting (3–4 weeks)
1. PH design report (PDF, server-rendered): design basis, per-room schedule, balance result, ACH check, unit datasheet + PHI cert, pressure-drop/SFP calc, BOM — frozen snapshot in `design_reports` with engine version.
2. DXF export of the duct layout (e.g. via an ezdxf microservice or a JS DXF writer) layered per floor.
3. Drawing-sheet PDF (title block, scale, legend) replacing `window.print()`.

### Phase 5 — Plan-reading depth (ongoing)
1. DXF/vector ingestion path: measured room polygons → true areas (kills P3 for vector drawings).
2. For raster: dimension-string OCR + scale-bar detection to calibrate AI area estimates; confidence-tier the TFA (measured > calibrated > estimated) and surface it in the design basis.
3. PHPP import of TFA/room schedule as the authoritative override.

### Continuous
- Decommission the legacy `MVHR-Sizing-Calculator.html` once the studio engine reaches parity (two parallel sizing implementations is a standing audit risk).
- Break up `analyse-plan.js` and the large HTML monoliths as pages are migrated.

---

## 5. Top risks if unaddressed

1. **C1–C3 (IDOR)** — cross-tenant data exposure in a commercial product; trivially exploitable with any valid login.
2. **P1 + P3** — the headline number (design airflow) can be both methodologically wrong and derived from unverifiable AI-estimated areas: certification challenge risk and professional-liability exposure.
3. **P4/P7** — shipping "duct design" and BOM outputs that contain no engineering analysis and fictional lengths invites real-world commissioning failures attributed to the tool.
4. **No tests** — every engine change is currently unverifiable; the Phase 1 fixture suite is the highest-leverage quality investment available.
