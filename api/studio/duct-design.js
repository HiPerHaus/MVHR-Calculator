// ============================================================
// HiPer Studio Stage 6 — Duct Design API
//
// GET  /api/studio/duct-design?projectId=...
//   Returns existing duct design (or generates one if none exists).
//   Response: { design, nodes, runs, generated? }
//
// POST /api/studio/duct-design
//   Body: { projectId, action?, manifoldMode? }
//   action === 'regenerate': delete and regenerate layout
//   Otherwise: return existing or generate if none.
//   Response: { design, nodes, runs, generated? }
//
// PATCH /api/studio/duct-design
//   Body: { projectId, nodes?, runs?, status?, designJson? }
//   Persist node positions, run properties, and design metadata.
//   Response: { ok: true, design }
// ============================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CANVAS_W = 1200;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

// ── Plant room detection ──────────────────────────────────────
function isPlantRoom(name) {
  return /plant|services|laundry|garage|store|mech|mvhr|utility|plant\s*room/i.test(name ?? '');
}

// ── Trunk diameter sizing ─────────────────────────────────────
// Standard MVHR duct sizing by velocity (target ~2-3 m/s)
// Q = v × A  →  A = Q / v  →  d = sqrt(4A/π)
// At 2.5 m/s target velocity:
function calcTrunkDiameter(totalFlowM3h) {
  if (totalFlowM3h <= 0)   return 90;
  if (totalFlowM3h <= 100) return 100;
  if (totalFlowM3h <= 160) return 125;
  if (totalFlowM3h <= 250) return 160;
  if (totalFlowM3h <= 400) return 180;
  return 200;
}

// ── Floor bands ───────────────────────────────────────────────
function buildFloorBands(numFloors) {
  const BAND_H  = 280;
  const Y_START = 100;
  const COLORS  = ['#f0fdf4', '#eff6ff', '#faf5ff', '#fff7ed'];
  const LABELS  = ['Ground Floor', 'First Floor', 'Second Floor', 'Third Floor'];
  const bands = [];
  for (let i = 0; i < numFloors; i++) {
    bands.push({
      floor_index: i,
      label:       LABELS[i] ?? `Floor ${i}`,
      y_start:     Y_START + i * BAND_H,
      y_end:       Y_START + (i + 1) * BAND_H,
      color:       COLORS[i] ?? '#f0f4f8',
    });
  }
  return bands;
}

// ── generateLayout ────────────────────────────────────────────
// Creates the initial schematic layout from project rooms and airflow data.
// Returns { design, nodes, runs } (all records freshly inserted).
async function generateLayout(supabase, projectId, userId, manifoldMode = 'single') {
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

  // Sort by floor index
  supplyRooms.sort((a, b) => a.floor_index - b.floor_index);
  extractRooms.sort((a, b) => a.floor_index - b.floor_index);

  // Detect plant room
  const plantRoom = sourceRooms.find(r => isPlantRoom(r.name));

  // 5. Calculate number of floors and canvas height
  const allFloorIndices = [...new Set([
    ...supplyRooms.map(r => r.floor_index),
    ...extractRooms.map(r => r.floor_index),
  ])].sort((a, b) => a - b);
  const numFloors = Math.max(allFloorIndices.length, 1);
  const CANVAS_H  = Math.max(800, numFloors * 280 + 100);

  // 6. Build floor bands
  const floorBands = buildFloorBands(numFloors);

  // 7. Calculate total airflows for trunk sizing
  const totalSupplyFlow  = supplyRooms.reduce((s, r) => s + (r.airflow_m3h || 0), 0);
  const totalExtractFlow = extractRooms.reduce((s, r) => s + (r.airflow_m3h || 0), 0);
  const trunkSupplyDiam  = calcTrunkDiameter(totalSupplyFlow);
  const trunkExtractDiam = calcTrunkDiameter(totalExtractFlow);

  // 8. Fixed node positions
  const MVHR_X = 200;
  const MVHR_Y = Math.round(CANVAS_H / 2);
  const INTAKE_X  = 50; const INTAKE_Y  = Math.round(CANVAS_H * 0.35);
  const EXHAUST_X = 50; const EXHAUST_Y = Math.round(CANVAS_H * 0.65);

  // 9. Create duct_design row
  const { data: design, error: designErr } = await supabase
    .from('duct_designs')
    .insert({
      project_id:        projectId,
      airflow_design_id: airflowDesign?.id ?? null,
      selected_unit_id:  airflowDesign?.selected_unit_id ?? null,
      status:            'draft',
      design_json: {
        canvas_w:           CANVAS_W,
        canvas_h:           CANVAS_H,
        plant_room_id:      plantRoom?.id ?? null,
        plant_room_name:    plantRoom?.name ?? null,
        design_airflow_m3h: airflowDesign?.design_airflow_m3h ?? null,
        generated_at:       new Date().toISOString(),
        manifold_mode:      manifoldMode,
        scale_m:            12,
        floorBands:         floorBands,
      },
    })
    .select()
    .single();

  if (designErr) throw new Error(`Failed to create duct_design: ${designErr.message}`);

  const did = design.id;

  // 10. Insert nodes
  const nodeInserts = [];

  // Fixed nodes (intake, exhaust, MVHR)
  nodeInserts.push({ duct_design_id: did, node_type: 'external_intake',    room_name: 'Intake',          x: INTAKE_X,  y: INTAKE_Y,  airflow_m3h: null, duct_diameter_mm: 200 });
  nodeInserts.push({ duct_design_id: did, node_type: 'external_exhaust',   room_name: 'Exhaust',         x: EXHAUST_X, y: EXHAUST_Y, airflow_m3h: null, duct_diameter_mm: 200 });
  nodeInserts.push({ duct_design_id: did, node_type: 'mvhr_unit',          room_name: 'MVHR Unit',       x: MVHR_X,    y: MVHR_Y,    airflow_m3h: airflowDesign?.design_airflow_m3h ?? null, duct_diameter_mm: null });

  if (manifoldMode === 'per_floor') {
    // Per-floor manifolds: one supply + one extract manifold per floor
    const floorGroups = {};
    for (const fi of allFloorIndices) {
      floorGroups[fi] = {
        supply:  supplyRooms.filter(r => r.floor_index === fi),
        extract: extractRooms.filter(r => r.floor_index === fi),
      };
    }

    // Manifold positions: at the start of each floor band
    for (const band of floorBands) {
      const fi = band.floor_index;
      const bandMidY = Math.round((band.y_start + band.y_end) / 2);
      const SUPPLY_MAN_X  = 370; const SUPPLY_MAN_Y  = bandMidY - 40;
      const EXTRACT_MAN_X = 370; const EXTRACT_MAN_Y = bandMidY + 40;

      nodeInserts.push({
        duct_design_id:  did,
        node_type:       'supply_manifold',
        room_name:       `Supply Manifold F${fi}`,
        floor_index:     fi,
        x:               SUPPLY_MAN_X,
        y:               SUPPLY_MAN_Y,
        airflow_m3h:     null,
        duct_diameter_mm: trunkSupplyDiam,
      });
      nodeInserts.push({
        duct_design_id:  did,
        node_type:       'extract_manifold',
        room_name:       `Extract Manifold F${fi}`,
        floor_index:     fi,
        x:               EXTRACT_MAN_X,
        y:               EXTRACT_MAN_Y,
        airflow_m3h:     null,
        duct_diameter_mm: trunkExtractDiam,
      });

      // Supply terminals for this floor
      const sRooms = floorGroups[fi]?.supply ?? [];
      const eRooms = floorGroups[fi]?.extract ?? [];
      const BAND_H_USED = band.y_end - band.y_start;
      const sSpacing = sRooms.length > 0 ? BAND_H_USED / (sRooms.length + 1) : 0;
      const eSpacing = eRooms.length > 0 ? BAND_H_USED / (eRooms.length + 1) : 0;

      for (let i = 0; i < sRooms.length; i++) {
        const sr = sRooms[i];
        nodeInserts.push({
          duct_design_id:  did,
          node_type:       'supply_terminal',
          project_room_id: sr.project_room_id,
          room_name:       sr.room_name,
          floor_index:     fi,
          x:               700,
          y:               Math.round(band.y_start + sSpacing * (i + 1)),
          airflow_m3h:     sr.airflow_m3h,
          duct_diameter_mm: 90,
        });
      }

      for (let i = 0; i < eRooms.length; i++) {
        const er = eRooms[i];
        nodeInserts.push({
          duct_design_id:  did,
          node_type:       'extract_terminal',
          project_room_id: er.project_room_id,
          room_name:       er.room_name,
          floor_index:     fi,
          x:               950,
          y:               Math.round(band.y_start + eSpacing * (i + 1)),
          airflow_m3h:     er.airflow_m3h,
          duct_diameter_mm: 90,
        });
      }
    }
  } else {
    // Single manifold mode
    const SUPPLY_MAN_X  = 370; const SUPPLY_MAN_Y  = Math.round(CANVAS_H * 0.35);
    const EXTRACT_MAN_X = 370; const EXTRACT_MAN_Y = Math.round(CANVAS_H * 0.65);

    nodeInserts.push({ duct_design_id: did, node_type: 'supply_manifold',    room_name: 'Supply Manifold',  x: SUPPLY_MAN_X,  y: SUPPLY_MAN_Y,  airflow_m3h: null, duct_diameter_mm: trunkSupplyDiam });
    nodeInserts.push({ duct_design_id: did, node_type: 'extract_manifold',   room_name: 'Extract Manifold', x: EXTRACT_MAN_X, y: EXTRACT_MAN_Y, airflow_m3h: null, duct_diameter_mm: trunkExtractDiam });

    // Place supply terminals: grouped by floor, left column
    for (let fi = 0; fi < numFloors; fi++) {
      const band = floorBands[fi];
      const floorsSupply = supplyRooms.filter(r => r.floor_index === fi);
      if (floorsSupply.length === 0) continue;
      const bandH   = band.y_end - band.y_start;
      const spacing = bandH / (floorsSupply.length + 1);
      for (let i = 0; i < floorsSupply.length; i++) {
        const sr = floorsSupply[i];
        nodeInserts.push({
          duct_design_id:  did,
          node_type:       'supply_terminal',
          project_room_id: sr.project_room_id,
          room_name:       sr.room_name,
          floor_index:     fi,
          x:               700,
          y:               Math.round(band.y_start + spacing * (i + 1)),
          airflow_m3h:     sr.airflow_m3h,
          duct_diameter_mm: 90,
        });
      }
    }

    // Place extract terminals: grouped by floor, right column
    for (let fi = 0; fi < numFloors; fi++) {
      const band = floorBands[fi];
      const floorsExtract = extractRooms.filter(r => r.floor_index === fi);
      if (floorsExtract.length === 0) continue;
      const bandH   = band.y_end - band.y_start;
      const spacing = bandH / (floorsExtract.length + 1);
      for (let i = 0; i < floorsExtract.length; i++) {
        const er = floorsExtract[i];
        nodeInserts.push({
          duct_design_id:  did,
          node_type:       'extract_terminal',
          project_room_id: er.project_room_id,
          room_name:       er.room_name,
          floor_index:     fi,
          x:               950,
          y:               Math.round(band.y_start + spacing * (i + 1)),
          airflow_m3h:     er.airflow_m3h,
          duct_diameter_mm: 90,
        });
      }
    }
  }

  const { data: nodes, error: nodeErr } = await supabase
    .from('duct_nodes')
    .insert(nodeInserts)
    .select();

  if (nodeErr) throw new Error(`Failed to insert duct_nodes: ${nodeErr.message}`);

  // 11. Build node type lookup maps
  const nodeByType = {};
  for (const n of nodes) {
    if (['external_intake','external_exhaust','mvhr_unit'].includes(n.node_type)) {
      nodeByType[n.node_type] = n;
    }
  }
  const supplyTerminals  = nodes.filter(n => n.node_type === 'supply_terminal');
  const extractTerminals = nodes.filter(n => n.node_type === 'extract_terminal');

  // 12. Insert runs
  const runInserts = [];

  // intake → mvhr
  runInserts.push({
    duct_design_id: did,
    from_node_id:   nodeByType['external_intake'].id,
    to_node_id:     nodeByType['mvhr_unit'].id,
    run_type:       'intake',
    duct_type:      'epp_200',
    diameter_mm:    200,
  });

  // mvhr → exhaust
  runInserts.push({
    duct_design_id: did,
    from_node_id:   nodeByType['mvhr_unit'].id,
    to_node_id:     nodeByType['external_exhaust'].id,
    run_type:       'exhaust',
    duct_type:      'epp_200',
    diameter_mm:    200,
  });

  if (manifoldMode === 'per_floor') {
    // Per-floor mode: MVHR → each floor's supply manifold, each floor's extract manifold → MVHR
    const supplyManifolds  = nodes.filter(n => n.node_type === 'supply_manifold');
    const extractManifolds = nodes.filter(n => n.node_type === 'extract_manifold');

    for (const sm of supplyManifolds) {
      const fi = sm.floor_index ?? 0;
      const floorSupplyFlow = supplyRooms.filter(r => r.floor_index === fi).reduce((s, r) => s + (r.airflow_m3h || 0), 0);
      const diam = calcTrunkDiameter(floorSupplyFlow) || trunkSupplyDiam;
      runInserts.push({
        duct_design_id: did,
        from_node_id:   nodeByType['mvhr_unit'].id,
        to_node_id:     sm.id,
        run_type:       'supply',
        duct_type:      diam >= 160 ? 'epp_160' : 'semi_rigid_90',
        diameter_mm:    diam,
      });
    }

    for (const em of extractManifolds) {
      const fi = em.floor_index ?? 0;
      const floorExtractFlow = extractRooms.filter(r => r.floor_index === fi).reduce((s, r) => s + (r.airflow_m3h || 0), 0);
      const diam = calcTrunkDiameter(floorExtractFlow) || trunkExtractDiam;
      runInserts.push({
        duct_design_id: did,
        from_node_id:   em.id,
        to_node_id:     nodeByType['mvhr_unit'].id,
        run_type:       'extract',
        duct_type:      diam >= 160 ? 'epp_160' : 'semi_rigid_90',
        diameter_mm:    diam,
      });
    }

    // Manifold → terminals for each floor
    for (const sm of supplyManifolds) {
      const fi = sm.floor_index ?? 0;
      const floorTerminals = supplyTerminals.filter(t => t.floor_index === fi);
      for (const st of floorTerminals) {
        runInserts.push({
          duct_design_id: did,
          from_node_id:   sm.id,
          to_node_id:     st.id,
          run_type:       'supply',
          duct_type:      'semi_rigid_90',
          diameter_mm:    90,
        });
      }
    }

    for (const em of extractManifolds) {
      const fi = em.floor_index ?? 0;
      const floorTerminals = extractTerminals.filter(t => t.floor_index === fi);
      for (const et of floorTerminals) {
        runInserts.push({
          duct_design_id: did,
          from_node_id:   et.id,
          to_node_id:     em.id,
          run_type:       'extract',
          duct_type:      'semi_rigid_90',
          diameter_mm:    90,
        });
      }
    }
  } else {
    // Single manifold mode
    const supplyManifold  = nodes.find(n => n.node_type === 'supply_manifold');
    const extractManifold = nodes.find(n => n.node_type === 'extract_manifold');

    if (supplyManifold) {
      runInserts.push({
        duct_design_id: did,
        from_node_id:   nodeByType['mvhr_unit'].id,
        to_node_id:     supplyManifold.id,
        run_type:       'supply',
        duct_type:      trunkSupplyDiam >= 160 ? 'epp_160' : 'semi_rigid_90',
        diameter_mm:    trunkSupplyDiam,
      });
    }

    if (extractManifold) {
      runInserts.push({
        duct_design_id: did,
        from_node_id:   extractManifold.id,
        to_node_id:     nodeByType['mvhr_unit'].id,
        run_type:       'extract',
        duct_type:      trunkExtractDiam >= 160 ? 'epp_160' : 'semi_rigid_90',
        diameter_mm:    trunkExtractDiam,
      });
    }

    // supply_manifold → each supply_terminal
    if (supplyManifold) {
      for (const st of supplyTerminals) {
        runInserts.push({
          duct_design_id: did,
          from_node_id:   supplyManifold.id,
          to_node_id:     st.id,
          run_type:       'supply',
          duct_type:      'semi_rigid_90',
          diameter_mm:    90,
        });
      }
    }

    // each extract_terminal → extract_manifold
    if (extractManifold) {
      for (const et of extractTerminals) {
        runInserts.push({
          duct_design_id: did,
          from_node_id:   et.id,
          to_node_id:     extractManifold.id,
          run_type:       'extract',
          duct_type:      'semi_rigid_90',
          diameter_mm:    90,
        });
      }
    }
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

// ── Load plan pages (floor plan images) ──────────────────────
const FLOOR_NAMES = ['Ground Floor', 'First Floor', 'Second Floor', 'Third Floor'];

async function loadPlanPages(supabase, projectId) {
  // Get all pdf_upload ids for this project
  const { data: uploads } = await supabase
    .from('pdf_uploads')
    .select('id')
    .eq('project_id', projectId);

  if (!uploads?.length) return [];

  const uploadIds = uploads.map(u => u.id);

  // Query primary floor plan pages
  const { data: pages } = await supabase
    .from('pdf_pages')
    .select('id, page_number, page_type, image_path, hires_image_path, hires_width_px, floor_name, floor_level, sheet_title')
    .in('pdf_upload_id', uploadIds)
    .in('page_type', ['floor_plan_primary', 'floor_plan'])
    .order('page_number', { ascending: true });

  if (!pages?.length) return [];

  // Build public URLs from storage paths
  const BUCKET = 'plan-uploads';
  const storageBase = `${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}`;

  return pages.map((p, i) => {
    const rawPath  = p.hires_image_path || p.image_path || '';
    const imageUrl = rawPath ? `${storageBase}/${rawPath}` : null;
    return {
      floor_index: i,
      floor_name:  FLOOR_NAMES[i] ?? `Floor ${i}`,
      page_id:     p.id,
      page_number: p.page_number,
      image_url:   imageUrl,
      width_px:    p.hires_width_px ?? null,
      height_px:   null,    // hires_height_px not stored separately; derive from image if needed
    };
  });
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
      const [designData, planPages] = await Promise.all([
        loadDesign(supabase, projectId),
        loadPlanPages(supabase, projectId),
      ]);
      if (designData) {
        return res.status(200).json({ ...designData, planPages });
      }
      // Generate fresh
      const generated = await generateLayout(supabase, projectId, user.id);
      return res.status(200).json({ ...generated, planPages, generated: true });
    } catch (err) {
      console.error('duct-design GET error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST ──────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body ?? {};
    const { projectId, action } = body;
    const manifoldMode = body.manifoldMode ?? 'single';
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
        const generated = await generateLayout(supabase, projectId, user.id, manifoldMode);
        return res.status(200).json({ ...generated, generated: true });
      }

      const existing = await loadDesign(supabase, projectId);
      if (existing) {
        return res.status(200).json(existing);
      }
      const generated = await generateLayout(supabase, projectId, user.id, manifoldMode);
      return res.status(200).json({ ...generated, generated: true });
    } catch (err) {
      console.error('duct-design POST error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PATCH ─────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const body = req.body ?? {};
    const { projectId, nodes, runs, status, designJson } = body;
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

    // Build design updates
    const designUpdates = {};
    if (status) designUpdates.status = status;
    if (designJson) designUpdates.design_json = designJson;

    if (Object.keys(designUpdates).length > 0) {
      const { error: duErr } = await supabase
        .from('duct_designs')
        .update(designUpdates)
        .eq('id', design.id);
      if (duErr) errors.push(`design update: ${duErr.message}`);
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
