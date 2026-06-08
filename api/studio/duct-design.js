// ============================================================
// HiPer Studio Stage 6 — Duct Design API
//
// GET  /api/studio/duct-design?projectId=...
//   Returns existing duct design (or generates one if none exists).
//   Response: { design, nodes, runs, generated? }
//
// POST /api/studio/duct-design
//   Body: { projectId, action? }
//   action === 'regenerate': delete and regenerate layout
//   Otherwise: return existing or generate if none.
//   Response: { design, nodes, runs, generated? }
//
// PATCH /api/studio/duct-design
//   Body: { projectId, nodes?, runs?, status? }
//   Persist node positions and run properties.
//   Response: { ok: true, design }
// ============================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CANVAS_W = 1200;
const CANVAS_H = 800;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

// ── Plant room detection ──────────────────────────────────────
function isPlantRoom(name) {
  return /plant|services|laundry|garage|store|mech|mvhr|utility|plant\s*room/i.test(name ?? '');
}

// ── generateLayout ────────────────────────────────────────────
// Creates the initial schematic layout from project rooms and airflow data.
// Returns { design, nodes, runs } (all records freshly inserted).
async function generateLayout(supabase, projectId, userId) {
  // 1. Load project_rooms
  const { data: allRooms } = await supabase
    .from('project_rooms')
    .select('id, name, room_type, floor, classification, is_confirmed, sort_order')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true });

  const rooms = (allRooms ?? []).filter(r => r.is_confirmed);
  const sourceRooms = rooms.length > 0 ? rooms : (allRooms ?? []);

  // 2. Load latest airflow_design for this project
  const { data: airflowDesign } = await supabase
    .from('airflow_designs')
    .select('id, selected_unit_id, design_airflow_m3h')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // 3. Load airflow_rooms if design exists
  let airflowRooms = [];
  if (airflowDesign?.id) {
    const { data: ar } = await supabase
      .from('airflow_rooms')
      .select('project_room_id, room_name, room_type, floor, supply_lps, extract_lps')
      .eq('airflow_design_id', airflowDesign.id);
    airflowRooms = ar ?? [];
  }

  // 4. Build supply/extract room lists from airflow data
  // Convert lps to m3h for storage
  const toLps2m3h = lps => Math.round((lps ?? 0) * 3.6 * 10) / 10;

  let supplyRooms = [];
  let extractRooms = [];

  if (airflowRooms.length > 0) {
    for (const ar of airflowRooms) {
      const supplyM3h  = toLps2m3h(ar.supply_lps);
      const extractM3h = toLps2m3h(ar.extract_lps);
      // Find matching project_room for the id
      const matchedRoom = sourceRooms.find(r => r.id === ar.project_room_id);
      const floorIdx = parseFloorIndex(ar.floor ?? matchedRoom?.floor);
      if (supplyM3h > 0) {
        supplyRooms.push({
          project_room_id: ar.project_room_id,
          room_name:       ar.room_name ?? matchedRoom?.name ?? 'Room',
          airflow_m3h:     supplyM3h,
          floor_index:     floorIdx,
        });
      }
      if (extractM3h > 0) {
        extractRooms.push({
          project_room_id: ar.project_room_id,
          room_name:       ar.room_name ?? matchedRoom?.name ?? 'Room',
          airflow_m3h:     extractM3h,
          floor_index:     floorIdx,
        });
      }
    }
  } else {
    // No airflow data yet — use room classification from project_rooms
    for (const r of sourceRooms) {
      const floorIdx = parseFloorIndex(r.floor);
      if (r.classification === 'supply' || ['bedroom','living','dining','office','gym'].includes(r.room_type)) {
        supplyRooms.push({ project_room_id: r.id, room_name: r.name, airflow_m3h: 0, floor_index: floorIdx });
      } else if (r.classification === 'extract' || ['wet_area','laundry','kitchen','kitchenette'].includes(r.room_type)) {
        extractRooms.push({ project_room_id: r.id, room_name: r.name, airflow_m3h: 0, floor_index: floorIdx });
      }
    }
  }

  // Detect plant room
  const plantRoom = sourceRooms.find(r => isPlantRoom(r.name));

  // 5. Calculate node positions
  // ─────────────────────────────────────────────────────────────
  // Fixed schematic positions (logical canvas 1200×800)
  const MVHR_X         = 200;  const MVHR_Y         = 400;
  const SUPPLY_MAN_X   = 370;  const SUPPLY_MAN_Y   = 280;
  const EXTRACT_MAN_X  = 370;  const EXTRACT_MAN_Y  = 520;
  const INTAKE_X       = 50;   const INTAKE_Y       = 280;
  const EXHAUST_X      = 50;   const EXHAUST_Y      = 520;

  // Supply terminals: upper half, right side
  const SUPPLY_START_X = 650;
  const SUPPLY_ZONE_TOP    = 60;
  const SUPPLY_ZONE_BOTTOM = CANVAS_H / 2 - 20;
  const supplyCount = supplyRooms.length || 1;
  const supplySpacing = (SUPPLY_ZONE_BOTTOM - SUPPLY_ZONE_TOP) / (supplyCount + 1);

  // Extract terminals: lower half, right side
  const EXTRACT_START_X = 650;
  const EXTRACT_ZONE_TOP    = CANVAS_H / 2 + 20;
  const EXTRACT_ZONE_BOTTOM = CANVAS_H - 60;
  const extractCount = extractRooms.length || 1;
  const extractSpacing = (EXTRACT_ZONE_BOTTOM - EXTRACT_ZONE_TOP) / (extractCount + 1);

  // 6. Create duct_design row
  const { data: design, error: designErr } = await supabase
    .from('duct_designs')
    .insert({
      project_id:        projectId,
      airflow_design_id: airflowDesign?.id ?? null,
      selected_unit_id:  airflowDesign?.selected_unit_id ?? null,
      status:            'draft',
      design_json: {
        canvas_w:         CANVAS_W,
        canvas_h:         CANVAS_H,
        plant_room_id:    plantRoom?.id ?? null,
        plant_room_name:  plantRoom?.name ?? null,
        design_airflow_m3h: airflowDesign?.design_airflow_m3h ?? null,
        generated_at:     new Date().toISOString(),
      },
    })
    .select()
    .single();

  if (designErr) throw new Error(`Failed to create duct_design: ${designErr.message}`);

  const did = design.id;

  // 7. Insert nodes
  const nodeInserts = [];

  // Fixed nodes
  nodeInserts.push({ duct_design_id: did, node_type: 'external_intake',    room_name: 'Intake',          x: INTAKE_X,       y: INTAKE_Y,       airflow_m3h: null, duct_diameter_mm: 200 });
  nodeInserts.push({ duct_design_id: did, node_type: 'external_exhaust',   room_name: 'Exhaust',         x: EXHAUST_X,      y: EXHAUST_Y,      airflow_m3h: null, duct_diameter_mm: 200 });
  nodeInserts.push({ duct_design_id: did, node_type: 'mvhr_unit',          room_name: 'MVHR Unit',       x: MVHR_X,         y: MVHR_Y,         airflow_m3h: airflowDesign?.design_airflow_m3h ?? null, duct_diameter_mm: null });
  nodeInserts.push({ duct_design_id: did, node_type: 'supply_manifold',    room_name: 'Supply Manifold', x: SUPPLY_MAN_X,   y: SUPPLY_MAN_Y,   airflow_m3h: null, duct_diameter_mm: 160 });
  nodeInserts.push({ duct_design_id: did, node_type: 'extract_manifold',   room_name: 'Extract Manifold',x: EXTRACT_MAN_X,  y: EXTRACT_MAN_Y,  airflow_m3h: null, duct_diameter_mm: 160 });

  // Supply terminal nodes
  for (let i = 0; i < supplyRooms.length; i++) {
    const sr = supplyRooms[i];
    const ty = SUPPLY_ZONE_TOP + supplySpacing * (i + 1);
    nodeInserts.push({
      duct_design_id:  did,
      node_type:       'supply_terminal',
      project_room_id: sr.project_room_id,
      room_name:       sr.room_name,
      floor_index:     sr.floor_index,
      x:               SUPPLY_START_X,
      y:               ty,
      airflow_m3h:     sr.airflow_m3h,
      duct_diameter_mm: 90,
    });
  }

  // Extract terminal nodes
  for (let i = 0; i < extractRooms.length; i++) {
    const er = extractRooms[i];
    const ty = EXTRACT_ZONE_TOP + extractSpacing * (i + 1);
    nodeInserts.push({
      duct_design_id:  did,
      node_type:       'extract_terminal',
      project_room_id: er.project_room_id,
      room_name:       er.room_name,
      floor_index:     er.floor_index,
      x:               EXTRACT_START_X,
      y:               ty,
      airflow_m3h:     er.airflow_m3h,
      duct_diameter_mm: 90,
    });
  }

  const { data: nodes, error: nodeErr } = await supabase
    .from('duct_nodes')
    .insert(nodeInserts)
    .select();

  if (nodeErr) throw new Error(`Failed to insert duct_nodes: ${nodeErr.message}`);

  // 8. Build a lookup map: node_type → node (for fixed nodes)
  const nodeByType = {};
  for (const n of nodes) {
    if (['external_intake','external_exhaust','mvhr_unit','supply_manifold','extract_manifold'].includes(n.node_type)) {
      nodeByType[n.node_type] = n;
    }
  }
  const supplyTerminals  = nodes.filter(n => n.node_type === 'supply_terminal');
  const extractTerminals = nodes.filter(n => n.node_type === 'extract_terminal');

  // 9. Insert runs
  const runInserts = [];

  // intake → mvhr
  runInserts.push({
    duct_design_id: did,
    from_node_id:   nodeByType['external_intake'].id,
    to_node_id:     nodeByType['mvhr_unit'].id,
    run_type:       'intake',
    duct_type:      'epp_160',
    diameter_mm:    200,
  });

  // mvhr → exhaust
  runInserts.push({
    duct_design_id: did,
    from_node_id:   nodeByType['mvhr_unit'].id,
    to_node_id:     nodeByType['external_exhaust'].id,
    run_type:       'exhaust',
    duct_type:      'epp_160',
    diameter_mm:    200,
  });

  // mvhr → supply_manifold
  runInserts.push({
    duct_design_id: did,
    from_node_id:   nodeByType['mvhr_unit'].id,
    to_node_id:     nodeByType['supply_manifold'].id,
    run_type:       'supply',
    duct_type:      'epp_160',
    diameter_mm:    160,
  });

  // extract_manifold → mvhr
  runInserts.push({
    duct_design_id: did,
    from_node_id:   nodeByType['extract_manifold'].id,
    to_node_id:     nodeByType['mvhr_unit'].id,
    run_type:       'extract',
    duct_type:      'epp_160',
    diameter_mm:    160,
  });

  // supply_manifold → each supply_terminal
  for (const st of supplyTerminals) {
    runInserts.push({
      duct_design_id: did,
      from_node_id:   nodeByType['supply_manifold'].id,
      to_node_id:     st.id,
      run_type:       'supply',
      duct_type:      'semi_rigid_90',
      diameter_mm:    90,
    });
  }

  // each extract_terminal → extract_manifold
  for (const et of extractTerminals) {
    runInserts.push({
      duct_design_id: did,
      from_node_id:   et.id,
      to_node_id:     nodeByType['extract_manifold'].id,
      run_type:       'extract',
      duct_type:      'semi_rigid_90',
      diameter_mm:    90,
    });
  }

  const { data: runs, error: runErr } = await supabase
    .from('duct_runs')
    .insert(runInserts)
    .select();

  if (runErr) throw new Error(`Failed to insert duct_runs: ${runErr.message}`);

  return { design, nodes, runs };
}

// ── Floor index helper ────────────────────────────────────────
function parseFloorIndex(floor) {
  if (!floor) return 0;
  const s = String(floor).toLowerCase();
  if (s.includes('ground') || s.includes('lower') || s === '0') return 0;
  if (s.includes('first')  || s === '1') return 1;
  if (s.includes('second') || s === '2') return 2;
  if (s.includes('third')  || s === '3') return 3;
  // Try numeric
  const n = parseInt(s, 10);
  return isNaN(n) ? 0 : n;
}

// ── Load existing design ──────────────────────────────────────
async function loadDesign(supabase, projectId) {
  const { data: design, error: dErr } = await supabase
    .from('duct_designs')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (dErr) throw new Error(dErr.message);
  if (!design) return null;

  const [{ data: nodes }, { data: runs }] = await Promise.all([
    supabase.from('duct_nodes').select('*').eq('duct_design_id', design.id).order('created_at', { ascending: true }),
    supabase.from('duct_runs').select('*').eq('duct_design_id', design.id).order('created_at', { ascending: true }),
  ]);

  return { design, nodes: nodes ?? [], runs: runs ?? [] };
}

// ── Delete existing design ────────────────────────────────────
async function deleteDesign(supabase, projectId) {
  // Cascade deletes handle nodes + runs via FK
  await supabase.from('duct_designs').delete().eq('project_id', projectId);
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

  // ── GET ───────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });

    // Verify ownership
    const { data: proj } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!proj) return res.status(403).json({ error: 'Project not found or access denied' });

    try {
      const existing = await loadDesign(supabase, projectId);
      if (existing) {
        return res.status(200).json(existing);
      }
      // Generate fresh
      const generated = await generateLayout(supabase, projectId, user.id);
      return res.status(200).json({ ...generated, generated: true });
    } catch (err) {
      console.error('duct-design GET error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST ──────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body ?? {};
    const { projectId, action } = body;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });

    // Verify ownership
    const { data: proj } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!proj) return res.status(403).json({ error: 'Project not found or access denied' });

    try {
      if (action === 'regenerate') {
        await deleteDesign(supabase, projectId);
        const generated = await generateLayout(supabase, projectId, user.id);
        return res.status(200).json({ ...generated, generated: true });
      }

      const existing = await loadDesign(supabase, projectId);
      if (existing) {
        return res.status(200).json(existing);
      }
      const generated = await generateLayout(supabase, projectId, user.id);
      return res.status(200).json({ ...generated, generated: true });
    } catch (err) {
      console.error('duct-design POST error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PATCH ─────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const body = req.body ?? {};
    const { projectId, nodes, runs, status } = body;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });

    // Verify ownership
    const { data: proj } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!proj) return res.status(403).json({ error: 'Project not found or access denied' });

    // Load existing design
    const { data: design, error: dErr } = await supabase
      .from('duct_designs')
      .select('id')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dErr) return res.status(500).json({ error: dErr.message });
    if (!design) return res.status(404).json({ error: 'No duct design found for this project' });

    const errors = [];

    // Update node positions
    if (Array.isArray(nodes) && nodes.length > 0) {
      for (const n of nodes) {
        if (!n.id) continue;
        const update = {};
        if (n.x !== undefined) update.x = n.x;
        if (n.y !== undefined) update.y = n.y;
        if (n.room_name !== undefined) update.room_name = n.room_name;
        if (n.airflow_m3h !== undefined) update.airflow_m3h = n.airflow_m3h;
        if (n.metadata !== undefined) update.metadata = n.metadata;
        if (Object.keys(update).length === 0) continue;
        const { error } = await supabase
          .from('duct_nodes')
          .update(update)
          .eq('id', n.id)
          .eq('duct_design_id', design.id);
        if (error) errors.push(`node ${n.id}: ${error.message}`);
      }
    }

    // Update run properties
    if (Array.isArray(runs) && runs.length > 0) {
      for (const r of runs) {
        if (!r.id) continue;
        const update = {};
        if (r.duct_type    !== undefined) update.duct_type    = r.duct_type;
        if (r.diameter_mm  !== undefined) update.diameter_mm  = r.diameter_mm;
        if (r.length_m     !== undefined) update.length_m     = r.length_m;
        if (r.route_points !== undefined) update.route_points = r.route_points;
        if (r.metadata     !== undefined) update.metadata     = r.metadata;
        if (Object.keys(update).length === 0) continue;
        const { error } = await supabase
          .from('duct_runs')
          .update(update)
          .eq('id', r.id)
          .eq('duct_design_id', design.id);
        if (error) errors.push(`run ${r.id}: ${error.message}`);
      }
    }

    // Update design status
    if (status) {
      await supabase
        .from('duct_designs')
        .update({ status })
        .eq('id', design.id);
    }

    // Reload design
    const { data: updatedDesign } = await supabase
      .from('duct_designs')
      .select('*')
      .eq('id', design.id)
      .single();

    if (errors.length > 0) {
      return res.status(207).json({ ok: true, design: updatedDesign, errors });
    }
    return res.status(200).json({ ok: true, design: updatedDesign });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
