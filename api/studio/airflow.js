// ============================================================
// HiPer Studio Stage 3 — Airflow Design Engine
//
// Design methodology (PHI-compliant, Phase 1):
//   designFlow = max(occupancyFlow, extractDemandNominal, areaFlow, achMinimumFlow)
//
// GET  /api/studio/airflow?projectId=...
//   Returns saved design + rooms + MVHR matches (no recalculation).
//
// POST /api/studio/airflow
//   Body: { projectId, designMethod }
//   Calculates, persists, returns result.
//
// PATCH /api/studio/airflow
//   Body: { projectId, designMethod }        → alias for POST (re-calculate)
//   Body: { projectId, selectedUnitId, ... } → unit selection only
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { applyCors }           from '../../lib/cors.js';
import { requireProjectOwner }  from '../../lib/requireProjectOwner.js';
import { isUuid }               from '../../lib/validateUuid.js';

// Engine package — pure functions, no I/O
import { calculateAirflow, scoreMvhrUnits, ENGINE_VERSION, DEFAULT_ROOM_RATES } from '../../packages/engine/index.js';
import { PHI_MIN_HR_EFF, PHI_MAX_SFP } from '../../packages/engine/constants.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ── Helpers ───────────────────────────────────────────────────
const r1    = v => Math.round(v * 10) / 10;
const toLps = m3h => r1(m3h / 3.6);
const toM3h = lps => r1(lps * 3.6);

// ── MVHR unit matching (DB fetch → engine scoring) ────────────
async function matchMvhrUnits(supabase, designM3h, preferredLoadPct = 60, userId = null, boostM3h = 0) {
  // If user has a library, fetch their preferred unit IDs first
  let libraryUnitIds = null;
  if (userId) {
    const { data: libRows } = await supabase
      .from('user_unit_library')
      .select('unit_id')
      .eq('user_id', userId);
    if (libRows?.length) {
      libraryUnitIds = libRows.map(r => r.unit_id);
    }
  }

  // Build query — units must handle at least the continuous design flow
  let query = supabase
    .from('mvhr_units')
    .select('id, manufacturer, model, hr_eff, sfp, flow_min, flow_max, frost_protection, phi_cert_id, user_id')
    .gte('flow_max', designM3h)
    .order('hr_eff', { ascending: false });

  if (libraryUnitIds) {
    query = query.in('id', libraryUnitIds);
  } else {
    query = query.is('user_id', null); // standard catalogue only
  }

  const { data: units, error } = await query;
  if (error || !units?.length) return [];

  // Pure scoring from the engine package (P1.4: includes ph_compliant + compliance_flags)
  const scored = scoreMvhrUnits(units, designM3h, preferredLoadPct, boostM3h);

  // Library = show all (user curated); catalogue = top 8
  return libraryUnitIds ? scored : scored.slice(0, 8);
}

// ── Enrich helpers ────────────────────────────────────────────
function enrichDesign(dbRow, calc) {
  const totalSupplyM3h  = calc?.totalSupplyM3h  ?? toM3h(dbRow.total_supply_lps);
  const totalExtractM3h = calc?.totalExtractM3h ?? toM3h(dbRow.total_extract_lps);
  const adjM3h          = calc?.adjustmentM3h   ?? toM3h(dbRow.balance_adjustment_lps ?? 0);

  // Effective boost/fan-speed settings (DB row → fresh calc → defaults)
  const effectiveBoostMethod = dbRow.boost_method               ?? calc?.boostMethod  ?? 'percentage';
  const effectiveBoostPct    = dbRow.boost_airflow_offset_pct   ?? calc?.boostOffsetPct ?? 30;
  const effectiveLowPct      = dbRow.low_airflow_offset_pct     ?? calc?.lowOffsetPct   ?? -30;
  const designM3h            = dbRow.design_airflow_m3h         ?? 0;

  // Boost airflow:
  //   1. Fresh engine calc (POST/PATCH) — always correct.
  //   2. Saved row where boost_method IS set (post-Task #35 designs) — stored value is valid.
  //   3. Stale row where boost_method IS NULL (pre-Task #35) — recompute from design + defaults;
  //      dbRow.boost_flow_m3h holds the old room-based value and MUST NOT be used here.
  let boostM3h;
  if (calc?.boostFlowM3h != null) {
    boostM3h = calc.boostFlowM3h;
  } else if (dbRow.boost_method != null && dbRow.boost_flow_m3h != null) {
    boostM3h = dbRow.boost_flow_m3h;
  } else {
    // Stale design — recompute
    boostM3h = effectiveBoostMethod === 'percentage'
      ? Math.round(designM3h * (1 + effectiveBoostPct / 100))
      : (dbRow.room_boost_demand_m3h ?? dbRow.wet_room_flow_m3h ?? 0);
  }

  // Low airflow: stored value if present; otherwise recompute from design + effective offset.
  const lowM3h = dbRow.low_flow_m3h ?? calc?.lowFlowM3h
    ?? (designM3h > 0 ? Math.round(designM3h * (1 + effectiveLowPct / 100)) : null);

  // Boost warning: stored value if present; recompute from resolved values when stale.
  const roomBoostDemandM3h = dbRow.room_boost_demand_m3h ?? calc?.roomBoostDemandM3h ?? null;
  const boostWarning = dbRow.boost_warning ?? calc?.boostWarning
    ?? (roomBoostDemandM3h != null ? roomBoostDemandM3h > boostM3h : false);

  return {
    ...dbRow,
    total_supply_m3h:           totalSupplyM3h,
    total_extract_m3h:          totalExtractM3h,
    balance_adjustment_m3h:     adjM3h,
    // Design basis
    occupancy_flow_m3h:         dbRow.occupancy_flow_m3h         ?? calc?.occupancyFlowM3h,
    extract_demand_m3h:         dbRow.extract_demand_m3h         ?? calc?.extractDemandM3h,
    area_flow_m3h:              dbRow.area_flow_m3h               ?? calc?.areaFlowM3h,
    boost_flow_m3h:             boostM3h,
    wet_room_flow_m3h:          boostM3h, // backward compat alias
    room_boost_demand_m3h:      roomBoostDemandM3h,
    low_flow_m3h:               lowM3h,
    boost_method:               effectiveBoostMethod,
    boost_airflow_offset_pct:   effectiveBoostPct,
    low_airflow_offset_pct:     effectiveLowPct,
    boost_warning:              boostWarning,
    occupancy_count:            dbRow.occupancy_count             ?? calc?.occupancyCount,
    treated_area_m2:            dbRow.treated_area_m2             ?? calc?.treatedAreaM2,
    area_data_available:        dbRow.area_data_available          ?? calc?.hasAreaData ?? false,
    area_with_count:            calc?.areaWithCount                ?? null,
    area_expected_count:        calc?.areaExpectedCount            ?? null,
    design_driver:              dbRow.design_driver                ?? calc?.designDriver ?? null,
    // ACH compliance
    total_volume_m3:            dbRow.total_volume_m3              ?? calc?.totalVolumeM3 ?? null,
    ach_at_design:              dbRow.ach_at_design                ?? calc?.achAtDesign ?? null,
    ach_passes:                 dbRow.ach_passes                   ?? calc?.achPasses ?? null,
    ach_minimum:                0.30,
    // Engine version
    engine_version:             dbRow.engine_version               ?? calc?.engineVersion ?? ENGINE_VERSION,
  };
}

function enrichRooms(rows) {
  return rows.map(r => ({
    ...r,
    supply_m3h:  toM3h(r.supply_lps),
    extract_m3h: toM3h(r.extract_lps),
  }));
}

// ── Handler ───────────────────────────────────────────────────
export default async function handler(req, res) {
  applyCors(req, res, 'GET,POST,PATCH,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Missing Supabase environment variables' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // ── GET — load saved design ───────────────────────────────────
  if (req.method === 'GET') {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });
    if (!isUuid(projectId)) return res.status(400).json({ error: 'Invalid projectId: must be a UUID' });

    const { user, errorResponse } = await requireProjectOwner(req, res, supabase, projectId);
    if (errorResponse) return;

    const { data: design, error: dErr } = await supabase
      .from('airflow_designs')
      .select('*')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dErr) return res.status(500).json({ error: dErr.message });
    if (!design) return res.status(200).json({ design: null, rooms: [], units: [] });

    const { data: rooms, error: rErr } = await supabase
      .from('airflow_rooms')
      .select('*')
      .eq('airflow_design_id', design.id)
      .order('sort_order', { ascending: true });

    if (rErr) return res.status(500).json({ error: rErr.message });

    let getPreferredLoadPct = 60;
    {
      const { data: settings } = await supabase
        .from('user_settings')
        .select('preferred_unit_load_percent')
        .eq('user_id', user.id)
        .maybeSingle();
      if (settings?.preferred_unit_load_percent) getPreferredLoadPct = settings.preferred_unit_load_percent;
    }

    const enriched = enrichDesign(design, null);
    const boostForUnits = enriched.boost_flow_m3h ?? 0;

    const units = await matchMvhrUnits(supabase, design.design_airflow_m3h, getPreferredLoadPct, user.id, boostForUnits);
    return res.status(200).json({
      design: {
        ...enriched,
        preferred_load_pct:     getPreferredLoadPct,
        preferred_capacity_m3h: Math.round(design.design_airflow_m3h / (getPreferredLoadPct / 100)),
        selected_unit_id:       design.selected_unit_id ?? null,
      },
      rooms: enrichRooms(rooms ?? []),
      units,
    });
  }

  // ── POST / PATCH — calculate or select unit ───────────────────
  if (req.method === 'POST' || req.method === 'PATCH') {
    const body         = req.body ?? {};
    const projectId    = body.projectId;
    const designMethod = body.designMethod ?? 'passive_house';

    if (!projectId) return res.status(400).json({ error: 'projectId required' });
    if (!isUuid(projectId)) return res.status(400).json({ error: 'Invalid projectId: must be a UUID' });

    const { user, errorResponse } = await requireProjectOwner(req, res, supabase, projectId);
    if (errorResponse) return;

    // ── Shortcut: unit selection only (no recalculation) ─────────
    if ('selectedUnitId' in body) {
      const unitId                = body.selectedUnitId ?? null;
      const complianceOverride    = body.complianceOverride === true;
      const complianceJustification = (body.complianceJustification ?? '').trim();

      // Find existing design
      const { data: existing } = await supabase
        .from('airflow_designs')
        .select('id, design_airflow_m3h')
        .eq('project_id', projectId)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!existing) return res.status(404).json({ error: 'No airflow design found — calculate airflow first' });

      // ── P1.4: PHI compliance gate ─────────────────────────────
      // Verify unit exists and check PH compliance before persisting selection.
      if (unitId) {
        if (!isUuid(unitId)) return res.status(400).json({ error: 'Invalid selectedUnitId: must be a UUID' });

        const { data: unit } = await supabase
          .from('mvhr_units')
          .select('id, hr_eff, sfp')
          .eq('id', unitId)
          .maybeSingle();

        if (!unit) return res.status(404).json({ error: 'Selected MVHR unit not found' });

        const hrCompliant  = (unit.hr_eff  ?? 0) >= PHI_MIN_HR_EFF;
        const sfpCompliant = (unit.sfp     ?? 999) <= PHI_MAX_SFP;
        const phCompliant  = hrCompliant && sfpCompliant;

        if (!phCompliant) {
          if (!complianceOverride) {
            return res.status(422).json({
              error: `Selected unit does not meet PHI compliance criteria `
                   + `(HR ≥ ${Math.round(PHI_MIN_HR_EFF * 100)}%, SFP ≤ ${PHI_MAX_SFP} Wh/m³). `
                   + `Re-submit with complianceOverride: true and a complianceJustification string to proceed.`,
              ph_compliant:  false,
              hr_compliant:  hrCompliant,
              sfp_compliant: sfpCompliant,
            });
          }
          if (!complianceJustification) {
            return res.status(422).json({
              error: 'complianceJustification is required when selecting a non-PHI-compliant unit.',
            });
          }
        }
      }

      const updateFields = {
        selected_unit_id:           unitId,
        ph_override_justification:  (unitId && complianceJustification) ? complianceJustification : null,
      };

      const { data: updated, error: updErr } = await supabase
        .from('airflow_designs')
        .update(updateFields)
        .eq('id', existing.id)
        .eq('user_id', user.id)
        .select()
        .single();

      if (updErr) return res.status(500).json({ error: updErr.message });

      return res.status(200).json({
        ok:     true,
        design: { ...enrichDesign(updated, null), selected_unit_id: unitId },
      });
    }

    // ── Recalculate ───────────────────────────────────────────────
    if (!['passive_house','as1668'].includes(designMethod)) {
      return res.status(400).json({ error: 'designMethod must be passive_house or as1668' });
    }

    // Load confirmed rooms (includes ceiling_height_m from Phase 1 migration)
    const { data: rooms, error: roomsErr } = await supabase
      .from('project_rooms')
      .select('*')
      .eq('project_id', projectId)
      .eq('is_confirmed', true)
      .order('sort_order', { ascending: true });

    if (roomsErr) return res.status(500).json({ error: roomsErr.message });
    if (!rooms?.length) {
      return res.status(422).json({
        error: 'No confirmed rooms found. Confirm the room schedule in Stage 2 first.',
      });
    }

    // Load user settings for room rates + preferred unit load + boost/fan-speed defaults
    let userRates        = {};
    let preferredLoadPct = 60;
    let boostSettings    = {};
    {
      const { data: settings } = await supabase
        .from('user_settings')
        .select('room_airflow_defaults, preferred_unit_load_percent, boost_method, boost_airflow_offset_pct, low_airflow_offset_pct')
        .eq('user_id', user.id)
        .maybeSingle();
      if (settings) {
        if (settings.room_airflow_defaults)       userRates        = settings.room_airflow_defaults;
        if (settings.preferred_unit_load_percent) preferredLoadPct = settings.preferred_unit_load_percent;
        if (settings.boost_method           != null) boostSettings.boost_method            = settings.boost_method;
        if (settings.boost_airflow_offset_pct != null) boostSettings.boost_airflow_offset_pct = settings.boost_airflow_offset_pct;
        if (settings.low_airflow_offset_pct != null) boostSettings.low_airflow_offset_pct  = settings.low_airflow_offset_pct;
      }
    }

    // Load project-level boost overrides (these take precedence over user_settings defaults)
    {
      const { data: project } = await supabase
        .from('projects')
        .select('boost_method, boost_airflow_offset_pct, low_airflow_offset_pct')
        .eq('id', projectId)
        .maybeSingle();
      if (project) {
        if (project.boost_method            != null) boostSettings.boost_method            = project.boost_method;
        if (project.boost_airflow_offset_pct != null) boostSettings.boost_airflow_offset_pct = project.boost_airflow_offset_pct;
        if (project.low_airflow_offset_pct   != null) boostSettings.low_airflow_offset_pct   = project.low_airflow_offset_pct;
      }
    }

    // ── Run the engine (imported from packages/engine) ────────────
    const calc = calculateAirflow(rooms, designMethod, userRates, boostSettings);

    console.log(JSON.stringify({
      event:            'airflow:engine-result',
      engineVersion:    calc.engineVersion,
      designFlowM3h:    calc.designFlowM3h,
      designDriver:     calc.designDriver,
      occupancyFlowM3h: calc.occupancyFlowM3h,
      extractDemandM3h: calc.extractDemandM3h,
      areaFlowM3h:      calc.hasAreaData ? calc.areaFlowM3h : null,
      achMinM3h:        calc.hasVolumeData ? Math.ceil(0.30 * calc.totalVolumeM3) : null,
      totalVolumeM3:    calc.totalVolumeM3,
      achAtDesign:      calc.achAtDesign,
      achPasses:        calc.achPasses,
      balanceStatus:    calc.balanceStatus,
    }));

    // ── Delete previous designs ────────────────────────────────
    const { data: existingDesigns } = await supabase
      .from('airflow_designs')
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', user.id);

    if (existingDesigns?.length) {
      const existingIds = existingDesigns.map(d => d.id);

      const { error: delRoomsErr } = await supabase
        .from('airflow_rooms')
        .delete()
        .in('airflow_design_id', existingIds);
      if (delRoomsErr) return res.status(500).json({ error: `Failed to clear old airflow rooms: ${delRoomsErr.message}` });

      const { error: nullDuctErr } = await supabase
        .from('duct_designs')
        .update({ airflow_design_id: null })
        .in('airflow_design_id', existingIds);
      if (nullDuctErr) return res.status(500).json({ error: `Failed to detach duct designs: ${nullDuctErr.message}` });
    }

    const { error: delErr } = await supabase
      .from('airflow_designs')
      .delete()
      .eq('project_id', projectId)
      .eq('user_id', user.id);
    if (delErr) return res.status(500).json({ error: `Failed to clear previous design: ${delErr.message}` });

    // ── Insert new design ──────────────────────────────────────
    const { data: design, error: insErr } = await supabase
      .from('airflow_designs')
      .insert({
        project_id:             projectId,
        user_id:                user.id,
        design_method:          designMethod,
        engine_version:         calc.engineVersion,
        // Design basis (P1.1 / P1.2)
        occupancy_count:        calc.occupancyCount,
        treated_area_m2:        calc.treatedAreaM2 || null,
        occupancy_flow_m3h:     calc.occupancyFlowM3h,
        extract_demand_m3h:     calc.extractDemandM3h,    // P1.2: extract-demand candidate
        area_flow_m3h:          calc.hasAreaData ? calc.areaFlowM3h : null,
        boost_flow_m3h:           calc.boostFlowM3h,         // configured boost target
        wet_room_flow_m3h:        calc.boostFlowM3h,         // backward-compat alias
        room_boost_demand_m3h:    calc.roomBoostDemandM3h,   // room-based validation value
        low_flow_m3h:             calc.lowFlowM3h,
        boost_method:             calc.boostMethod,
        boost_airflow_offset_pct: calc.boostOffsetPct,
        low_airflow_offset_pct:   calc.lowOffsetPct,
        boost_warning:            calc.boostWarning,
        area_data_available:    calc.hasAreaData,
        // Design airflow
        design_driver:          calc.designDriver,
        design_airflow_m3h:     calc.designFlowM3h,
        design_airflow_lps:     calc.designFlowLps,// ACH compliance (P1.3)
        treated_volume_m3: calc.hasVolumeData ? calc.totalVolumeM3 : null,
        ach_at_design:          calc.achAtDesign,
        ach_passes:             calc.achPasses,
        // Room totals (after balancing)
        total_supply_lps:       calc.totalSupplyLps,
        total_extract_lps:      calc.totalExtractLps,
        balance_adjustment_lps: toLps(calc.adjustmentM3h),
        balance_status:         calc.balanceStatus,
      })
      .select()
      .single();

    if (insErr) return res.status(500).json({ error: insErr.message });
    if (!design?.id) return res.status(500).json({ error: 'Failed to create airflow design: no design.id returned' });

    // Verify persistence before inserting child rows
    const { data: designCheck, error: designCheckErr } = await supabase
      .from('airflow_designs')
      .select('id')
      .eq('id', design.id)
      .maybeSingle();

    if (designCheckErr || !designCheck) {
      return res.status(500).json({
        error: `Airflow design insert did not persist before room insert. designId=${design.id}`,
      });
    }

    const roomRows = calc.roomResults.map(r => ({
      airflow_design_id: design.id,
      project_room_id:   r.project_room_id,
      room_name:         r.room_name,
      room_type:         r.room_type,
      floor:             r.floor,
      supply_lps:        r.supply_lps,
      extract_lps:       r.extract_lps,
      boost_extract_m3h:           r.boost_extract_m3h ?? 0,
      recommended_terminal_count:  r.recommended_terminal_count ?? null,
      airflow_driver:              r.airflow_driver,
      notes:                       r.notes ?? null,
      sort_order:                  r.sort_order,
    }));

    const { data: savedRooms, error: roomInsErr } = await supabase
      .from('airflow_rooms')
      .insert(roomRows)
      .select();

    if (roomInsErr) return res.status(500).json({ error: `Failed to insert airflow rooms for design ${design.id}: ${roomInsErr.message}` });

    const units = await matchMvhrUnits(supabase, calc.designFlowM3h, preferredLoadPct, user.id, calc.boostFlowM3h);

    return res.status(200).json({
      ok:   true,
      design: {
        ...enrichDesign(design, calc),
        preferred_load_pct:       preferredLoadPct,
        preferred_capacity_m3h:   Math.round(calc.designFlowM3h / (preferredLoadPct / 100)),
        selected_unit_id:         design.selected_unit_id ?? null,
      },
      rooms:       enrichRooms(savedRooms ?? []),
      units,
      areaWarning:  !calc.hasAreaData,
      achWarning:   calc.achPasses === false,
      boostWarning: calc.boostWarning,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
