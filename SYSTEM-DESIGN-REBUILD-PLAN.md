# System Design Page — Rebuild Plan

**Target file:** `studio-duct-design.html` (currently 2,574 lines)
**Goal:** Convert the page from a drawing tool into a guided engineering workflow:
`Airflow Design → Place MVHR → Generate Terminals → Generate Routes → Review Pressure/Noise → Export/BOM`
**Decided this pass:** detailed plan only (no code changes yet); calc + compliance panels to be wired to `packages/engine` (real numbers, not placeholders).

---

## 1. Current state — what already exists vs. what's missing

Three things are already in place and should be **kept, not rebuilt**:

- **Gating primitives.** `btnGenerate` is disabled until MVHR is placed (`updateWorkflowState`, line ~1483); `statusMvhr` / `statusLayout` pills exist; Schematic and Schedule tabs are disabled until MVHR is placed and the layout isn't stale (lines 1494–1495). The `_mvhrNeedsPlacement`, `_layoutGenerated`, `_layoutStale` flags already drive this.
- **A working two-phase generator.** `regenerateLayout()` calls the API `regenerate` action, which places terminals + manifolds and generates routes server-side, stamping `velocity_m_s`, `flow_m3h`, `pressure_drop_pa`, and `metadata.run_category` onto each `duct_run`.
- **A real, tested engine.** `packages/engine` exposes pure functions for every calc the spec's panels need (see §4). The migrations `20260611_duct_velocity.sql` / `_duct_pressure.sql` already added the columns the engine stamps into.

Three structural problems to fix:

1. **The page is organised as three tabs (Plan / Schematic / Schedule), not as the 5-part guided flow.** The workflow status is a thin two-pill strip, not the full design-status header the spec calls for.
2. **The engine math is duplicated inline.** `calcSystemPressureSummary` (line 2417) and the inline acoustic block (line 2449) and `PH_VELOCITY_LIMITS` (line ~2395) are hand-copies of `pressure.js` / `acoustic.js` / `duct.js`. This is the exact drift risk the roadmap warns about (two parallel implementations). The rebuild should delete these and import the real engine.
3. **Gating is partial.** It gates *generate* on MVHR placement, but there is no explicit "Generate Terminals → then Generate Routes" separation, and the design-status header doesn't surface airflow-complete, pressure-pass, or noise-pass states.

---

## 2. Stack decision

**Recommendation: rebuild in place in the existing vanilla HTML/JS style, and wire the real engine via native ES modules. Do _not_ start the React + Konva migration in this pass.**

Rationale:

- The roadmap's React + Konva recommendation (Phase 3) is about the *canvas editor* — snapping, orthogonal polyline routing, undo/redo. None of that is what this rebuild needs. The spec asks for a guided workflow shell, a calculation panel, and compliance checks — all of which are DOM/state work the current vanilla page already does competently.
- Introducing React + a build step here would diverge this one page from the other 12 studio pages and triple the effort for no user-visible gain on the workflow itself. Keep React+Konva queued for when the editor's geometry model is rebuilt.
- The one real architectural fix — killing the inline engine copies — is achievable in vanilla by serving `packages/engine` as static ES modules and importing them with `<script type="module">`. No bundler required (see §4.1).

If you'd rather force the React migration now, that becomes a separate, larger plan; flag it and I'll write that instead.

---

## 3. Target page structure & the gating state machine

The page becomes five stacked sections inside `#mainContent`, in spec order. The existing Plan/Schematic/Schedule tabs survive **inside section 3** (the workspace) — they're view modes of the canvas, not top-level navigation.

```
┌─ 1. DESIGN STATUS HEADER ───────────────────────────────┐
│  Airflow ✓  · Unit ✓ · MVHR placed ◔ · Layout ◌ ·       │
│  Pressure ◌ · Noise ◌      [stepper, read-only mirror]   │
├─ 2. DESIGN INPUTS (collapsible, read-mostly) ───────────┤
│  Project summary · totals · normal/low/boost rates ·     │
│  selected unit · duct system type selector               │
├─ 3. INTERACTIVE LAYOUT WORKSPACE ───────────────────────┤
│  [Plan | Schematic | Schedule] tabs (existing canvas)    │
│  Guided action bar: Place MVHR → Gen Terminals →         │
│  Gen Routes (each enabled only when prior step done)     │
├─ 4. CALCULATION PANEL (engine-wired) ───────────────────┤
│  Room-by-room airflow · duct lengths · count/room ·      │
│  pressure loss · velocity warnings · balance             │
├─ 5. COMPLIANCE CHECKS (engine-wired) ───────────────────┤
│  ≤100 Pa system · bedroom/living noise · wet-room noise ·│
│  intake/exhaust separation · service access · commissioning│
└─────────────────────────────────────────────────────────┘
```

### Gating state machine

Replace the implicit flag-juggling with one explicit `_designState` derived on every change. Each state unlocks exactly one next action; downstream sections render as "pending" until reached.

| State | Entry guard (true ⇒ in this state) | Unlocks | Header pill |
|---|---|---|---|
| `NEEDS_AIRFLOW` | no completed airflow design for project | — (link back to Airflow stage) | Airflow ❌ |
| `NEEDS_UNIT` | airflow ok, no selected unit | — (link to Unit Selection) | Unit ❌ |
| `NEEDS_MVHR` | airflow + unit ok, `_mvhrNeedsPlacement` | **Place MVHR** (click on plan) | MVHR ⏳ |
| `NEEDS_TERMINALS` | MVHR placed, no terminal nodes | **Generate Terminals** | Terminals ⏳ |
| `NEEDS_ROUTES` | terminals placed, `design_json.phase !== 'routes_generated'` | **Generate Routes** | Routes ⏳ |
| `NEEDS_REVIEW` | routes generated, checks not yet all green | calc + compliance panels live | Review ⏳ |
| `READY` | routes generated **and** pressure ≤ target **and** no exceed-level velocity/noise flags | **Continue → BOM** | All ✓ |
| `STALE` | any input changed after generation (`_layoutStale`) | **Regenerate** (warn) | Stale ⚠ |

`updateWorkflowState()` is refactored to compute `_designState` from these guards and drive: the header pills, which action button is the single "primary" CTA, and the enabled/disabled state of sections 3–5. This is the **key fix** the spec asks for: nothing downstream auto-runs until its guard passes.

> **Design decision needed:** currently `regenerate` does terminals **and** routes in one server call. The spec wants them as two visible steps. Two options — (a) split the API into `generate_terminals` + `generate_routes` actions (cleaner UX, ~1 new API branch; `generate_routes` already exists as an action name), or (b) keep one server call but present it as a two-step animated progression client-side. **Recommend (a)** — it matches the mental model and the `generate_routes` action is already stubbed.

---

## 4. Engine wiring (replaces the inline copies)

### 4.1 How the browser imports the engine without a bundler

`packages/engine` is already pure ESM with relative imports between modules. Expose it as a static route and import natively:

1. Add a Vercel static route (or symlink/copy at build) so `/engine/*` serves `packages/engine/*`. In `vercel.json` add a rewrite: `"/engine/(.*)" → "/packages/engine/$1"` (confirm Vercel serves the dir; if not, copy `packages/engine` → `public/engine` in a prebuild step in `package.json`).
2. In the page: `<script type="module">import { calcSystemPressure, systemPressureStatus, calcVelocityMs, velocityStatus, selectDiameterMm, terminalDbaEstimate, acousticStatus, isBedroom, balanceDesign, ENGINE_VERSION, PHI_MIN_ACH } from '/engine/index.js';</script>`
3. **Delete** `calcSystemPressureSummary`, the inline acoustic block, and the local `PH_VELOCITY_LIMITS`. Point `velocityBadgeHtml`, `acousticBadgeHtml`, `renderPressureSummary`, `renderAcousticFlags` at the imported functions.
4. Stamp `ENGINE_VERSION` into the design when displaying results so the page and server agree on which engine produced the numbers (auditability — matches the roadmap's engine-version stamping).

Fallback if static ESM serving is awkward on Vercel: a 3-line `esbuild packages/engine/index.js --bundle --format=esm --outfile=public/engine.bundle.js` prebuild step. Either way, **one source of truth.**

### 4.2 Which engine function feeds which panel

| Panel line | Engine function(s) | Input it needs |
|---|---|---|
| Velocity per run + warning | `calcVelocityMs(flow, diam)`, `velocityStatus(v, category)` | run `flow_m3h`, `diameter_mm`, `metadata.run_category` |
| Pressure loss per run | already stamped `pressure_drop_pa`; recompute live via `calcSystemPressure(runs)` | `_runs` array (shape matches the JSDoc in `pressure.js`) |
| System pressure total + status | `calcSystemPressure(runs).totalSystemPa`, `systemPressureStatus(total, unit.ext_pressure)` | `_runs`, selected `_unit.ext_pressure` |
| Terminal noise per room | `terminalDbaEstimate(v, ductType)`, `acousticStatus(dba, roomName)`, `isBedroom()` | terminal-run velocity, room name |
| Balance check | `balanceDesign(roomResults, rooms, designFlow)` | airflow room results (from airflow design) |
| Suggested diameter | `selectDiameterMm(flow, category)` | run flow |
| ACH compliance line | `PHI_MIN_ACH`, `calcAchAtDesign`/`calcAchFloor` | room volumes (needs ceiling height — see §6 gap) |

The run object shape `calcSystemPressure` expects (`flow_m3h`, `velocity_m_s`, `diameter_mm`, `length_m`, `duct_type`, `run_type`, `metadata.run_category`) **already matches** what the API stamps and what `_runs` holds client-side, so wiring is mostly deletion + re-pointing, not reshaping.

---

## 5. Section-by-section build spec

**Section 1 — Design status header.** Replace the two-pill `#workflowStatus` strip with a 6-item status row (Airflow, Unit, MVHR, Layout, Pressure, Noise), each a pill bound to `_designState` + the live check results. Keep the existing `#stageNav` (the 8-stage top breadcrumb) as is — this header is the *intra-page* status, the stage nav is *inter-page*.

**Section 2 — Design inputs.** New collapsible block. Reads from the loaded airflow design + project: project summary (name, type), total supply/extract (m³/h), normal/low/boost rates (boost settings already exist per `20260612_boost_fan_speed_settings.sql`), selected unit (name + ext_pressure + HR eff + SFP, with PH gate flags from `units.js`). Add the **duct system type selector** (radial semi-rigid / rigid / mixed) — this is a new field; persist on `duct_designs.design_json.duct_system_type` and feed it into `diameterToDuctType` / roughness selection so pressure math reflects the chosen system.

**Section 3 — Interactive layout workspace.** Keep the existing plan canvas, MVHR click-to-place (`placeMvhrFromOverlay`), node rendering, and the Plan/Schematic/Schedule tabs. Add a **guided action bar** above the canvas showing the three sequential buttons (Place MVHR / Generate Terminals / Generate Routes) with only the current step's button primary-styled and enabled, per the state machine. The "MVHR first" rule is already enforced — this just makes it visible and adds the terminals/routes split.

**Section 4 — Calculation panel.** New panel (can reuse the Schedule tab's data). Room-by-room: supply/extract m³/h, terminal count per room (`airflow_rooms.terminal_count` exists per `20260612` migration), summed duct length per room, worst velocity + badge, per-room pressure contribution. Plus system totals: external/supply-index/extract-index/total Pa from `calcSystemPressure`, and the balance result from `balanceDesign`. All recomputed live on any node/run edit (the engine is microseconds).

**Section 5 — Compliance checks.** A checklist, each row green/amber/red with the governing number:
- System pressure ≤ target (100 Pa default, or `unit.ext_pressure` if lower) — `systemPressureStatus`.
- Bedroom/living noise — `acousticStatus` on bedroom/living terminals (≤30 dBA bedroom threshold).
- Wet-room noise — `acousticStatus` general threshold.
- Intake/exhaust separation — geometric check on `external_intake` vs `external_exhaust` node distance on the plan (needs the plan scale, which the page already tracks via `_scaleM`). New check, ~15 lines.
- Service access — confirmation/flag around the MVHR node (manual tick + clearance note stored in `design_json`).
- Commissioning readiness — derived: all above green + unit selected + boost settings present ⇒ ready; links to the Commissioning stage.

`READY` state (and the enabled "Continue → BOM" button) requires all hard checks green.

---

## 6. Data model & API touchpoints

Mostly already present. Gaps to close as part of this work:

- **`duct_designs.design_json.duct_system_type`** — new field for the §2 selector. No migration needed (jsonb).
- **Split generate actions** — add a `generate_terminals` branch to `api/studio/duct-design.js` (or reuse `regenerate` for terminals and `generate_routes` for routes). The `generate_routes` action name already exists at line 767.
- **Ceiling height for the ACH line** — `calcAchAtDesign` needs room volume. The roadmap (data-model rec) calls for `project_rooms.ceiling_height_m` + `volume_m3`. If those aren't yet populated, the ACH compliance line shows "needs ceiling heights" rather than a wrong number. **Decision: include the ACH line as informational-only this pass, or defer it until heights are captured?**
- **Engine-version stamp** — write `ENGINE_VERSION` into `design_json` on generate (server already imports the engine; just include it in the saved JSON).

Security note (out of scope for the page but adjacent): the roadmap's C1–C5 IDOR findings touch `airflow.js`/`rooms.js`, not `duct-design.js` (which already checks ownership). No new exposure from this rebuild.

---

## 7. Build sequence (when you approve execution)

1. **Engine import plumbing** — static route/bundle + `<script type=module>` import; delete the three inline copies; verify badges/summary still render identical numbers. *Verify:* spot-check 2–3 runs' velocity/pressure against the old inline output (should match to rounding).
2. **State machine refactor** — introduce `_designState`, rewrite `updateWorkflowState()`. *Verify:* walk a project through each state; assert correct CTA enabled at each step.
3. **Section 1 header** — 6-pill status bound to state + checks.
4. **Section 2 inputs** + duct-system-type selector (+ persist).
5. **Split generate actions** (API + client action bar).
6. **Section 4 calc panel** — live engine recompute on edit.
7. **Section 5 compliance** — checks incl. new intake/exhaust separation + service access.
8. **READY gating** on Continue→BOM.
9. **Regression pass** — run `packages/engine` tests (`npm test`/vitest is configured) to confirm no engine change; manual click-through of the full flow; confirm `STALE` triggers on an input edit after generation.

Each step is independently shippable; the page stays working between steps.

---

## 8. Decisions needed before I build

1. **Split generate into two API actions** (recommended) vs. one call presented as two steps?
2. **ACH compliance line** — show as informational now, or defer until `ceiling_height_m`/`volume_m3` are captured?
3. **Engine serving** — Vercel static rewrite of `packages/engine`, or an `esbuild` prebuild bundle? (I'll pick the one that works against your actual Vercel config when building.)
4. Confirm **vanilla in-place** (this plan) vs. forcing the React+Konva migration now.

Once you've answered these, I'll execute §7 step by step.
