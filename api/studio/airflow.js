// ============================================================
// HiPer Studio Stage 3 — Airflow Design Engine
//
// GET  /api/studio/airflow?projectId=...
//   → returns the most recent saved airflow_design (+ rooms) for the project,
//     or { design: null } if none exists yet.
//
// POST /api/studio/airflow
//   Body: { projectId, designMethod }
//   → calculates a fresh airflow design from confirmed project_rooms,
//     persists it, and returns the full result + top-8 MVHR unit matches.
//
// PATCH /api/studio/airflow
//   Body: { designId, designMethod }
//   → re-runs calculation with a new method, replaces the saved design.
// ============================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

// ── Airflow calculation rules ──────────────────────────────────

/**
 * Calculate supply l/s for a bedroom based on occupancy.
 * Formula: 15 + (max(occupants,1) - 1) × 10
 */
function bedroomSupply(bedSpaces) {
  const n = Math.max(bedSpaces || 1, 1);
  return 15 + (n - 1) * 10;
}

/**
 * Calculate supply l/s for a living room.
 * Passive House: 30 l/s default (0.35 ACH equivalent, clamped 20–40).
 * AS1668: same default for now (area-based would require floor area).
 */
function livingSupply(room, _method) {
  // If area is known, approximate ACH: Q = (area × 2.7 × 0.35) / 3.6
  if (room.area && room.area > 0) {
    const ach = (room.area * 2.7 * 0.35) / 3.6;
    return Math.min(40, Math.max(20, Math.round(ach)));
  }
  return 30; // default
}

/**
 * Calculate airflow for a single room.
 * Returns { supply_lps, extract_lps, airflow_driver, notes }
 */
function calcRoom(room, method) {
  const type = room.room_type;
  const cls  = room.classification;

  // Rooms explicitly ignored
  if (cls === 'ignore') {
    return { supply_lps: 0, extract_lps: 0, airflow_driver: 'ignored', notes: null };
  }

  // Transfer rooms — no supply or extract
  if (cls === 'transfer') {
    return { supply_lps: 0, extract_lps: 0, airflow_driver: 'transfer', notes: null };
  }

  switch (type) {
    case 'bedroom': {
      const s = bedroomSupply(room.bed_spaces);
      return { supply_lps: s, extract_lps: 0, airflow_driver: `occupancy:${room.bed_spaces || 1}`, notes: null };
    }

    case 'living': {
      const s = livingSupply(room, method);
      const driver = room.area ? `ach_0.35_area${room.area}m2` : 'default_30';
      return { supply_lps: s, extract_lps: 0, airflow_driver: driver, notes: null };
    }

    case 'dining': {
      return { supply_lps: 15, extract_lps: 0, airflow_driver: 'fixed_15', notes: null };
    }

    case 'kitchen':
    case 'kitchenette': {
      return { supply_lps: 0, extract_lps: 30, airflow_driver: 'fixed_30', notes: 'No rangehood airflow included' };
    }

    case 'wet_area': {
      // Differentiate ensuite vs bathroom by name heuristic
      const name = (room.name || '').toLowerCase();
      const isEnsuite = /ensuite|en-suite|en suite/.test(name);
      const rate = isEnsuite ? 20 : 20;
      const driver = isEnsuite ? 'ensuite_20' : 'bathroom_20';
      return { supply_lps: 0, extract_lps: rate, airflow_driver: driver, notes: null };
    }

    case 'laundry': {
      return { supply_lps: 0, extract_lps: 15, airflow_driver: 'fixed_15', notes: null };
    }

    case 'circulation': {
      // Hallways — transfer only, no supply/extract
      return { supply_lps: 0, extract_lps: 0, airflow_driver: 'transfer', notes: null };
    }

    case 'robe': {
      // WIR / robes — transfer only
      return { supply_lps: 0, extract_lps: 0, airflow_driver: 'transfer', notes: null };
    }

    case 'office': {
      // Treat office like living (supply, 0.35 ACH or default 20 l/s)
      const s = room.area ? Math.min(30, Math.max(15, Math.round((room.area * 2.7 * 0.35) / 3.6))) : 20;
      return { supply_lps: s, extract_lps: 0, airflow_driver: 'office_supply', notes: null };
    }

    case 'gym': {
      return { supply_lps: 20, extract_lps: 0, airflow_driver: 'fixed_20', notes: null };
    }

    case 'service': {
      // Service / plant rooms — extract 10 l/s
      return { supply_lps: 0, extract_lps: 10, airflow_driver: 'fixed_10', notes: null };
    }

    default: {
      // 'other' — use classification field to decide
      if (cls === 'supply')  return { supply_lps: 15, extract_lps: 0,  airflow_driver: 'fallback_supply_15', notes: null };
      if (cls === 'extract') return { supply_lps: 0,  extract_lps: 10, airflow_driver: 'fallback_extract_10', notes: null };
      return { supply_lps: 0, extract_lps: 0, airflow_driver: 'unclassified', notes: null };
    }
  }
}

// ── WC detection ──────────────────────────────────────────────
// project_rooms doesn't have a 'wc' type; WCs are typically wet_area or 'other'.
// Detect by name.
function adjustForWC(room, result) {
  const name = (room.name || '').toLowerCase();
  const isWC = /\bwc\b|water\s*closet|toilet(?!\s*room)|powder\s*room/.test(name);
  if (isWC && result.extract_lps > 0) {
    return { ...result, extract_lps: 10, airflow_driver: 'wc_10' };
  }
  return result;
}

// ── Balance logic ─────────────────────────────────────────────
/**
 * Balance supply vs extract.
 * If |supply - extract| / max(supply,extract) > 0.10:
 *   Adjust living rooms first, then dining, then largest bedroom.
 * Returns { roomResults (mutated), adjustment, balanceStatus }
 */
function balanceDesign(roomResults, rooms) {
  let totalSupply  = roomResults.reduce((s, r) => s + r.supply_lps,  0);
  let totalExtract = roomResults.reduce((s, r) => s + r.extract_lps, 0);

  const imbalance = totalSupply - totalExtract;
  const maxFlow   = Math.max(totalSupply, totalExtract);
  const ratio     = maxFlow > 0 ? Math.abs(imbalance) / maxFlow : 0;

  if (ratio <= 0.05) {
    return { roomResults, adjustment: 0, balanceStatus: 'balanced', adjustedRoomIdx: null };
  }

  // Need to adjust supply (if supply < extract) or reduce supply (if supply > extract)
  const needed = totalExtract - totalSupply; // positive = need more supply

  // Priority: living → dining → largest bedroom
  const priority = ['living', 'dining', 'bedroom'];
  let remaining = needed;
  let totalAdjustment = 0;
  const adjustedRoomIndices = [];

  for (const targetType of priority) {
    if (Math.abs(remaining) < 1) break;

    // Find all rooms of this type that have supply (can be adjusted)
    const candidates = roomResults
      .map((r, i) => ({ r, i, room: rooms[i] }))
      .filter(({ r, room }) =>
        room.room_type === targetType &&
        room.classification === 'supply' &&
        r.supply_lps > 0
      )
      .sort((a, b) => b.r.supply_lps - a.r.supply_lps); // largest first

    for (const { r, i } of candidates) {
      if (Math.abs(remaining) < 1) break;

      const canAdd = remaining; // add full deficit to first eligible room
      const newSupply = Math.max(10, r.supply_lps + canAdd);
      const applied   = newSupply - r.supply_lps;

      roomResults[i] = {
        ...r,
        supply_lps: Math.round(newSupply * 10) / 10,
        notes: `Balance adjustment: ${applied >= 0 ? '+' : ''}${Math.round(applied * 10) / 10} l/s`,
      };

      remaining        -= applied;
      totalAdjustment  += applied;
      adjustedRoomIndices.push(i);
      break; // adjust one room at a time per type
    }
  }

  totalSupply  = roomResults.reduce((s, r) => s + r.supply_lps,  0);
  totalExtract = roomResults.reduce((s, r) => s + r.extract_lps, 0);
  const finalRatio = Math.max(totalSupply, totalExtract) > 0
    ? Math.abs(totalSupply - totalExtract) / Math.max(totalSupply, totalExtract)
    : 0;

  const balanceStatus = finalRatio <= 0.05
    ? 'balanced'
    : finalRatio <= 0.10
      ? 'minor_adjustment'
      : 'major_imbalance';

  return {
    roomResults,
    adjustment: Math.round(totalAdjustment * 10) / 10,
    balanceStatus,
    adjustedRoomIndices,
  };
}

// ── Main calculation ──────────────────────────────────────────
function calculateAirflow(rooms, method) {
  // Calculate raw airflow per room
  let roomResults = rooms.map(room => {
    let result = calcRoom(room, method);
    result = adjustForWC(room, result);
    return {
      project_room_id: room.id,
      room_name:       room.name,
      room_type:       room.room_type,
      floor:           room.floor,
      sort_order:      room.sort_order,
      ...result,
    };
  });

  // Balance supply vs extract
  const { roomResults: balanced, adjustment, balanceStatus } = balanceDesign(roomResults, rooms);

  const totalSupply  = Math.round(balanced.reduce((s, r) => s + r.supply_lps,  0) * 10) / 10;
  const totalExtract = Math.round(balanced.reduce((s, r) => s + r.extract_lps, 0) * 10) / 10;
  const designLps    = Math.round(Math.max(totalSupply, totalExtract) * 10) / 10;
  const designM3h    = Math.round(designLps * 3.6 * 10) / 10;

  return {
    roomResults: balanced,
    totalSupply,
    totalExtract,
    balanceAdjustment: adjustment,
    balanceStatus,
    designAirflowLps: designLps,
    designAirflowM3h: designM3h,
  };
}

// ── MVHR unit matching ────────────────────────────────────────
async function matchMvhrUnits(supabase, designM3h) {
  // Fetch all units that can handle the design airflow
  const { data: units, error } = await supabase
    .from('mvhr_units')
    .select('id, manufacturer, model, hr_eff, sfp, flow_min, flow_max, frost_protection, phi_cert_id')
    .gte('flow_max', designM3h)         // must handle the design flow
    .order('hr_eff', { ascending: false });

  if (error || !units?.length) return [];

  // Score and sort
  const scored = units.map(u => {
    const headroom     = u.flow_max - designM3h;
    const suitability  = Math.round(Math.min(100, (designM3h / u.flow_max) * 100));
    const phiCertified = !!u.phi_cert_id;

    // Score: PHI first (+ 1000), then hr_eff, then low SFP
    const score = (phiCertified ? 1000 : 0) + (u.hr_eff || 0) * 10 - (u.sfp || 99) * 5;

    return { ...u, headroom, suitability, phiCertified, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 8);
}

// ── Handler ───────────────────────────────────────────────────
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Missing Supabase environment variables' });
  }

  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired token' });

  // ── GET — load saved design ──────────────────────────────────
  if (req.method === 'GET') {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });

    const { data: design, error: dErr } = await supabase
      .from('airflow_designs')
      .select('*')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dErr) return res.status(500).json({ error: dErr.message });
    if (!design) return res.status(200).json({ design: null, rooms: [] });

    const { data: rooms, error: rErr } = await supabase
      .from('airflow_rooms')
      .select('*')
      .eq('airflow_design_id', design.id)
      .order('sort_order', { ascending: true });

    if (rErr) return res.status(500).json({ error: rErr.message });

    const units = await matchMvhrUnits(supabase, design.design_airflow_m3h);
    return res.status(200).json({ design, rooms: rooms ?? [], units });
  }

  // ── POST / PATCH — calculate + persist ───────────────────────
  if (req.method === 'POST' || req.method === 'PATCH') {
    const body         = req.body ?? {};
    const projectId    = body.projectId;
    const designMethod = body.designMethod ?? 'passive_house';
    const deleteOld    = body.deleteOld !== false; // default true

    if (!projectId) return res.status(400).json({ error: 'projectId required' });
    if (!['passive_house','as1668'].includes(designMethod)) {
      return res.status(400).json({ error: 'designMethod must be passive_house or as1668' });
    }

    // Load confirmed rooms
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

    // Calculate
    const calc = calculateAirflow(rooms, designMethod);

    // Delete previous unconfirmed designs for this project (keep history clean)
    if (deleteOld) {
      await supabase
        .from('airflow_designs')
        .delete()
        .eq('project_id', projectId)
        .eq('user_id', user.id);
    }

    // Insert new design
    const { data: design, error: insErr } = await supabase
      .from('airflow_designs')
      .insert({
        project_id:             projectId,
        user_id:                user.id,
        design_method:          designMethod,
        total_supply_lps:       calc.totalSupply,
        total_extract_lps:      calc.totalExtract,
        balance_adjustment_lps: calc.balanceAdjustment,
        balance_status:         calc.balanceStatus,
        design_airflow_lps:     calc.designAirflowLps,
        design_airflow_m3h:     calc.designAirflowM3h,
      })
      .select()
      .single();

    if (insErr) return res.status(500).json({ error: insErr.message });

    // Insert airflow_rooms rows
    const roomRows = calc.roomResults.map(r => ({
      airflow_design_id: design.id,
      project_room_id:   r.project_room_id,
      room_name:         r.room_name,
      room_type:         r.room_type,
      floor:             r.floor ?? null,
      supply_lps:        r.supply_lps,
      extract_lps:       r.extract_lps,
      airflow_driver:    r.airflow_driver,
      notes:             r.notes ?? null,
      sort_order:        r.sort_order,
    }));

    const { data: savedRooms, error: roomInsErr } = await supabase
      .from('airflow_rooms')
      .insert(roomRows)
      .select();

    if (roomInsErr) return res.status(500).json({ error: roomInsErr.message });

    const units = await matchMvhrUnits(supabase, design.design_airflow_m3h);

    return res.status(200).json({
      ok:     true,
      design,
      rooms:  savedRooms,
      units,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
