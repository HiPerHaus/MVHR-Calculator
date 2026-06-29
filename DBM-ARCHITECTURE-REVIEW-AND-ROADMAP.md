# HiPer Studio — Digital Building Model: Architecture Review & Roadmap

**Scope:** repository inspection only. No code changed. All findings reference current files (June 2026).
**Brief:** re-architect from a collection of calculators into a Building Performance Engineering Platform where Projects own a shared **Digital Building Model (DBM)** and engineering modules consume it.

---

## 1. What already exists (source of truth)

The platform is further along this path than the brief assumes. The biggest assumption to correct: **Projects are already the primary object, and the MVHR Designer is already a project-workspace flow.** The work is mostly *unifying geometry* and *generalising the dashboard*, not building project infrastructure from scratch.

### Stack
| Layer | Implementation |
|---|---|
| Frontend | ~16 static HTML pages, vanilla JS, no framework/build step. Routed by `vercel.json` rewrites. |
| Backend | Vercel serverless functions (`api/`), Node 22, ES modules, Supabase **service-role** client. |
| Auth | Supabase Auth; Bearer token → `supabase.auth.getUser(token)` in every handler. |
| Data | Supabase Postgres + Storage + Auth, RLS enabled. APIs bypass RLS via service role and check ownership in code (`lib/requireProjectOwner.js`). |
| Engine | `packages/engine` — pure, tested (vitest) ESM, served at `/engine/*` for in-browser import. Single source of truth for calculations. |
| Billing | Stripe Checkout + webhook (signature-verified, idempotent), credit ledger. |

### Projects are already the building owner
`public.projects` already carries what the brief asks the DBM "Project" node to hold:
`user_id, name, client_name, site_address, suburb, address_state, postcode, building_type, storey_count, notes, climate_zone, state_json, plan_state_json, ai_analysis_json, thumbnail_url, schedule_confirmed_at`.

Existing project-scoped child tables:
- `project_images` (one render per floor), `pdf_uploads` / `pdf_pages` (PDF pipeline, per-page geometry flags: `has_dimensions`, `has_scale`, `has_room_labels`, `floor_level`, …)
- `project_rooms` (editable room schedule: `room_type`, `area`, `ceiling_height_m`, generated `volume_m3`, `room_bbox`, `classification`, `confidence`, `source`, `is_confirmed`)
- `airflow_designs` / `airflow_rooms`, `duct_designs` / `duct_nodes` / `duct_runs`
- `building_volume_calculations` / `building_volume_zones` / `building_volume_calculation_events` (**versioned**, status `draft→needs_review→approved→superseded`, audit events, original-vs-edited JSON)
- `plan_analysis_log` (immutable AI audit trail)

### The MVHR workspace already exists
`vercel.json` already routes a full project workspace: `/mvhr-designer/projects/:id/{details,upload,rooms,airflow,unit-selection,duct-design,bom}`, backed by `studio-project.html`, `studio-upload.html`, `studio-rooms.html`, etc. This *is* the "Project Workspace" the brief describes — it just lives under the MVHR module rather than at the platform level.

### AI pipeline
PDF → mupdf render → Haiku page classification → Sonnet 4.6 room extraction → Opus recovery (`api/ai/analyse-plan.js`). A **second, separate** AI path exists for airtight volume (`api/ai/building-volume.js`). Both are mature; both produce their own structures.

---

## 2. The core problem the DBM must solve

There is **no single canonical geometry.** Two modules independently model the same building:

- **MVHR** reads `project_rooms` (rooms, areas, ceiling heights, room volumes).
- **Building Volume** reads `building_volume_zones` (airtight zones, areas, heights, included/excluded).

These are populated by **two different AI pipelines** from the same plans, stored in two schemas, edited and approved independently, and never reconciled. A room's floor area can disagree between the two. This is precisely the "no module should independently recreate building geometry" anti-pattern. Everything else in the brief (Range Hood, heating/cooling loads, condensation, PHPP, 3D export) would add *more* independent geometry consumers on top of this fork.

**So the DBM is not a greenfield build — it is the unification of `project_rooms` + `building_volume_zones` (+ the raw AI JSON) into one versioned, approvable, audited model that both existing modules become consumers of.** The `building_volume_calculations` table already demonstrates the exact pattern to generalise: versioning, status lifecycle, source type (`ai_image|manual|imported|pdf`), evidence, confidence, warnings, `original_ai_json` vs `current_json`, and an events audit log.

---

## 3. Reuse / Refactor / Unchanged

### Reuse as-is
- `projects` table as the DBM root (already has client/address/storeys/climate).
- Helpers: `requireProjectOwner`, `cors`/`applyCors`, `validateUuid`, `rate-limit`.
- AI pipelines (`analyse-plan.js`, `ai/building-volume.js`) — **extend** to emit the DBM, don't replace.
- `packages/engine` and the `/engine/*` browser-import mechanism — modules already share it.
- Storage buckets + PDF pipeline (`pdf_uploads`/`pdf_pages`), `project_images`.
- The **versioning + status + audit-events pattern** from `building_volume_calculations` — this is the template for the DBM tables.
- Existing studio workspace pages and their routing.

### Refactor
- **Dashboard** (`dashboard.html`): flat tool grid → two sections (Projects | Engineering Modules). Launching a module requires selecting/creating a project first.
- **Geometry unification:** introduce canonical `building_model` tables; make `project_rooms` and `building_volume_zones` *projections/consumers* of it (or migrate them onto it) so MVHR and Building Volume read one source.
- **Building Volume page:** fold `building-volume.html` into the project workspace shell (it's currently a standalone tool with its own project linkage).
- **Uploads:** generalise from "one image per floor" (`project_images` unique on `project_id, floor_index`) to **multiple files per project, many types** (DWG/DXF/PDF/PNG/JPG), with CAD shown as the recommended format.
- **Two AI paths → one DBM target:** keep CAD and PDF *ingestion* pipelines separate (brief requires this), but make both emit the identical DBM structure so downstream modules never know the source.

### Leave unchanged (now)
- Auth, Stripe/billing/credits ledger, admin APIs.
- Serverless + Supabase stack (right fit; no migration).
- `packages/engine` internals and test suite.
- The two-stage AI extraction design (server derives compliance fields; AI never sets them).

### Pre-existing debt to respect (from prior review, not this brief)
The June 11 technical review flagged IDOR gaps (`airflow.js`, `rooms.js`, `seed-rooms.js` missing ownership checks) and `CORS *` overrides. The DBM work touches these same handlers — fold the `requireProjectOwner` fix in as we refactor them rather than leaving them.

---

## 4. Canonical Digital Building Model — shape

One versioned model per project (mirroring `building_volume_calculations`'s lifecycle), with child geometry:

```
building_model            (1 current per project; version, status draft→needs_review→approved→superseded,
                           source_type cad|pdf|manual|imported, engine/schema version, confidence,
                           warnings[], original_ai_json, current_json, approved_at/by)
 ├─ bm_levels             (storey / floor level, elevation, name)
 ├─ bm_rooms              (name, room_type, level, polygon[], area_m2, ceiling_height_m, volume_m3,
                           classification, included_in_envelope, exclusion_reason, confidence, evidence, source)
 ├─ bm_walls              (polyline, kind external|internal, level)  [CAD-first; optional for PDF]
 ├─ bm_openings           (window|door, host wall, dims)            [CAD-first; optional for PDF]
 ├─ bm_zones              (envelope/excluded groupings: garage, alfresco, roof void, plant, wet…)
 └─ bm_edits / bm_events  (manual override log + audit trail; never mutate imported geometry)
```

Derived/consumer views:
- MVHR reads `bm_rooms` (replacing/feeding `project_rooms`).
- Building Volume reads `bm_zones` + `bm_rooms.included_in_envelope` (replacing/feeding `building_volume_zones`).
- Range Hood reads kitchen room + building volume + airtightness — all from the DBM.

**Invariant:** original imported geometry is immutable; edits are layered (`bm_edits`) and versioned; nothing overwrites the source. PDF and CAD imports both produce this identical structure. Polygons/walls are populated by CAD; PDF imports may leave wall/opening geometry sparse but must still yield rooms, areas, volumes, zones.

---

## 5. Roadmap

Each milestone leaves the app working and is independently shippable. Order favours unifying what exists before adding the new module, so the new module is the first thing *born* on the DBM.

**F0 — Foundations & guards (small).** Add `requireProjectOwner` to `airflow.js`/`rooms.js`/`seed-rooms.js`; remove `CORS *` overrides; UUID-validate interpolated filters. Clears the debt on the exact files later milestones edit. *Verify:* cross-tenant access test per endpoint.

**F1 — DBM schema + read API (no behaviour change).** Create `building_model` + child tables (generalising the `building_volume_calculations` pattern). Add `GET /api/studio/building-model?projectId=`. Nothing consumes it yet. *Verify:* migration is idempotent; RLS + ownership tests.

**F2 — Backfill/derive DBM from existing data.** One-time + on-write derivation that builds a DBM from current `project_rooms` and the latest approved `building_volume_calculations`. DBM becomes readable for every existing project. *Verify:* derived areas/volumes reconcile to source within tolerance; reconciliation report for mismatches.

**F3 — PDF pipeline emits the DBM.** Extend `analyse-plan.js` + `ai/building-volume.js` to write the unified DBM as their target (keep their current outputs during transition). One approval step produces one approved model. *Verify:* a sample plan yields identical room areas/volumes via DBM vs the old path.

**F4 — MVHR consumes the DBM.** Repoint `studio-rooms`/`airflow` to read `bm_rooms`; `project_rooms` becomes a view/projection of the DBM (or a thin editable layer over it). MVHR numbers unchanged. *Verify:* engine regression suite + before/after airflow on reference projects match.

**F5 — Building Volume consumes the DBM; move into workspace.** Building Volume reads `bm_zones`/`bm_rooms`; fold `building-volume.html` into the project workspace shell. Retire the parallel `building_volume_zones` write path (read-compat retained). *Verify:* approved volumes match pre-migration values.

**F6 — Dashboard & workspace refactor.** Dashboard → **Projects** (New/Open/Recent) + **Engineering Modules** (Mechanical Ventilation, Building Volume, Range Hood). Module launch requires a project. Generalise the project workspace to platform level: Project Info · Uploaded Files · Digital Building Model · Modules · Reports · History. *Verify:* click-through of new→upload→approve→module flow; module-without-project is blocked.

**F7 — Multi-file, multi-type uploads.** Generalise `project_images`/uploads to many files per project across DWG/DXF/PDF/PNG/JPG, CAD shown as recommended. Files stored, listed, never overwritten. *Verify:* upload set persists; original-file integrity preserved.

**F8 — DBM review & approval UI.** A dedicated DBM view: rooms/zones/areas/volumes with evidence, confidence, warnings, manual-edit layer, approve/needs-review, version history. "Approve once, reuse everywhere." *Verify:* edits versioned, approval gates module consumption, audit trail complete.

**F9 — CAD ingestion (DWG/DXF).** New ingestion path: parse DXF (e.g. server-side `ezdxf`/DXF parser microservice), read layers/lines/text/dimensions/scale; identify room boundaries and walls; AI only where interpretation is needed; no rasterisation unless necessary. Emits the **same** DBM as PDF. DWG via DXF conversion. *Verify:* a known DXF yields measured room polygons + areas matching the drawing; PDF and CAD of the same plan converge.

**F10 — Range Hood Makeup Air (first DBM-native module) + platform proof.** Build Range Hood entirely on the DBM (kitchen room, building volume, airtightness) — no new geometry. This is the proof that MVHR + Building Volume + a new tool all share one model. *Verify:* Range Hood reads only the DBM; adding it required no project-architecture change.

**Beyond F10 (architecture must already support, no redesign):** heating/cooling loads, condensation risk, Passive House analysis, blower-door reports, ventilation compliance, energy/acoustic/IAQ modelling — all DBM consumers. **3D/export readiness:** keep `bm_rooms.polygon` + `bm_levels` + `ceiling_height_m` sufficient to extrude a simplified engineering solid → later OBJ/DAE/glTF/IFC export (engineering model, not architectural BIM).

---

## 6. Decisions needed before code

1. **`project_rooms` / `building_volume_zones` migration style** — make them DB **views** over the DBM (cleanest, single source) vs. keep them as thin editable tables that sync from the DBM (less risky for existing write paths). Recommend: views/projections, but stage it (F4/F5) behind the derivation layer.
2. **CAD parsing host** — DXF parsing wants a Python lib (`ezdxf`); add a small serverless/microservice, or a JS DXF parser in-process? Recommend a separate `api/cad/*` function (Python) to keep geometry accuracy.
3. **Scope of this first pass** — ship F0–F2 (guards + DBM schema + backfill, fully non-breaking) as the first PR, or take it through F4 (MVHR live on the DBM)?
4. **DWG** — handle via DWG→DXF conversion only (no native DWG reader) initially? Recommend yes.

Once you confirm 1–4 I'll implement incrementally, one milestone per step, keeping the app green between each.
