// ============================================================
// HiPer Studio Stage 5 — Duct Layout Engine
//
// Two-phase layout generation:
//
//   Phase 1 — terminals_only
//     Supply + extract terminal nodes only.
//     Generated automatically on page load — no MVHR required.
//     The floor plan shows room terminals so the designer can
//     review placements before committing to an MVHR location.
//
//   Phase 2 — routes_generated
//     Full layout: MVHR assembly, distribution nodes (ComfoWell
//     or manifold depending on manufacturer), intake/exhaust
//     connections, and all duct runs.
//     Requires the MVHR unit to be placed on the plan first.
//     The MVHR location is the single source of truth for routing.
//
// Manufacturer profiles
//   Zehnder Q350/Q450 — ComfoWell 320 attached directly to MVHR.
//     node_types: comfowell_supply, comfowell_extract.
//     Always co-located with MVHR (max 500 mm separation).
//   Default — separate supply/extract distribution box/manifold.
//     node_types: supply_manifold, extract_manifold.
//
// GET  /api/studio/duct-design?projectId=...
//   Returns existing design. If none exists, auto-generates Phase 1.
//
// POST /api/studio/duct-design
//   action='regenerate'      — clear routes/assembly, regenerate from
//                               current MVHR position (preserves terminals
//                               and MVHR node). Standard regeneration path.
//   action='generate_routes' — alias for 'regenerate'.
//   action='full_regenerate' — delete everything, rebuild Phase 1 from
//                               airflow data (use when rooms change).
//   action='add_node'        — insert a single node into existing design.
//   action='add_run'         — insert a run between two existing nodes.
//   action='delete_node'     — remove a node and its connected runs.
//
// PATCH /api/studio/duct-design
//   Persist node positions, run properties, design metadata.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { applyCors }           from '../../lib/cors.js';
import { validateUuids, isUuid } from '../../lib/validateUuid.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CANVAS_W = 1200;

// ── Plant room detection ──────────────────────────────────────
function isPlantRoom(name) {
  return /plant|services|laundry|garage|store|mech|mvhr|utility|plant\s*room/i.test(name ?? '');
}

// ── Terminal count per room ───────────────────────────────────
// Determines how many terminals a room requires based on its airflow.
// Rule: one 90mm terminal handles up to 40 m³/h.
//   ≤40 m³/h  → 1 terminal
//   >40–80    → 2 terminals
//   >80–120   → 3 terminals
//   >120      → ceil(airflow / 40) terminals
function terminalCount(airflow_m3h) {
  if (!airflow_m3h || airflow_m3h <= 0) return 1;
  return Math.max(1, Math.ceil(airflow_m3h / 40));
}

// ── Trunk diameter sizing ─────────────────────────────────────
// Standard MVHR duct sizing by velocity (target ~2–3 m/s).
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
  return Array.from({ length: numFloors }, (_, i) => ({
    floor_index: i,
    label:       LABELS[i] ?? `Floor ${i}`,
    y_start:     Y_START + i * BAND_H,
    y_end:       Y_START + (i + 1) * BAND_H,
    color:       COLORS[i] ?? '#f0f4f8',
  }));
}

// ── Floor index helper ────────────────────────────────────────
function parseFloorIndex(floor) {
  if (!floor) return 0;
  const s = String(floor).toLowerCase();
  if (s.includes('ground') || s.includes('lower') || s === '0') return 0;
  if (s.includes('first')  || s === '1') return 1;
  if (s.includes('second') || s === '2') return 2;
  if (s.includes('third')  || s === '3') return 3;
  const n = parseInt(s, 10);
  return isNaN(n) ? 0 : n;
}

// ── Unit assembly profile ─────────────────────────────────────
//
// Returns the distribution assembly configuration for a given MVHR unit.
// This determines:
//   - What node types are created for supply/extract distribution
//   - Whether the assembly is attached directly to the MVHR or remote
//   - Schematic offset from the MVHR node centre
//
// Adding a new manufacturer: extend the if/else chain with the relevant
// manufacturer or model string patterns.
//
function getUnitAssemblyProfile(manufacturer, model) {
  const mfr = (manufacturer ?? '').toLowerCase();
  const mdl = (model ?? '').toLowerCase();

  if (
    mfr.includes('zehnder') ||
    mdl.includes('comfoair') ||
    mdl.includes('q350') ||
    mdl.includes('q450') ||
    mdl.includes('comfod')
  ) {
    // Zehnder ComfoWell 320: mounted directly to the MVHR unit.
    // Acts as distribution module, attenuator, and transition assembly.
    return {
      assemblyType:    'comfowell',
      supplyNodeType:  'comfowell_supply',
      extractNodeType: 'comfowell_extract',
      supplyLabel:     'ComfoWell 320 (Supply)',
      extractLabel:    'ComfoWell 320 (Extract)',
      attachedToMvhr:  true,
      // Schematic offsets from MVHR (x, y) in canvas pixels.
      // Supply and extract ComfoWells sit to the right of the MVHR,
      // slightly above and below centre line.
      supplyOffsetX:   90, supplyOffsetY:   -40,
      extractOffsetX:  90, extractOffsetY:   40,
    };
  }

  // Default: separate supply and extract distribution boxes / manifolds.
  // Positioned further from MVHR than the ComfoWell assembly.
  return {
    assemblyType:    'manifold',
    supplyNodeType:  'supply_manifold',
    extractNodeType: 'extract_manifold',
    supplyLabel:     'Supply Manifold',
    extractLabel:    'Extract Manifold',
    attachedToMvhr:  false,
    supplyOffsetX:   170, supplyOffsetY:  -120,
    extractOffsetX:  170, extractOffsetY:  120,
  };
}

// ── Load airflow data ─────────────────────────────────────────
// Shared helper used by both generation phases.
// Returns rooms, supply/extract room lists, and the current airflow design.
async function loadAirflowData(supabase, projectId) {
  const { data: allRooms } = await supabase
    .from('project_rooms')
    .select('id, name, room_type, floor, classification, is_confirmed, sort_order')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true });

  const rooms = (allRooms ?? []).filter(r => r.is_confirmed);
  const sourceRooms = rooms.length > 0 ? rooms : (allRooms ?? []);

  const { data: airflowDesign } = await supabase
    .from('airflow_designs')
    .select('id, selected_unit_id, design_airflow_m3h')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let airflowRooms = [];
  if (airflowDesign?.id) {
    const { data: ar } = await supabase
      .from('airflow_rooms')
      .select('project_room_id, room_name, room_type, floor, supply_lps, extract_lps')
      .eq('airflow_design_id', airflowDesign.id);
    airflowRooms = ar ?? [];
  }

  const toLps2m3h = lps => Math.round((lps ?? 0) * 3.6 * 10) / 10;
  const supplyRooms  = [];
  const extractRooms = [];

  if (airflowRooms.length > 0) {
    for (const ar of airflowRooms) {
      const supplyM3h  = toLps2m3h(ar.supply_lps);
      const extractM3h = toLps2m3h(ar.extract_lps);
      const matched    = sourceRooms.find(r => r.id === ar.project_room_id);
      const floorIdx   = parseFloorIndex(ar.floor ?? matched?.floor);
      const name       = ar.room_name ?? matched?.name ?? 'Room';
      if (supplyM3h  > 0) supplyRooms.push({ project_room_id: ar.project_room_id, room_name: name, airflow_m3h: supplyM3h,  floor_index: floorIdx });
      if (extractM3h > 0) extractRooms.push({ project_room_id: ar.project_room_id, room_name: name, airflow_m3h: extractM3h, floor_index: floorIdx });
    }
  } else {
    // No airflow data yet — classify from project_rooms
    for (const r of sourceRooms) {
      const fi = parseFloorIndex(r.floor);
      if (r.classification === 'supply' || ['bedroom','living','dining','office','gym'].includes(r.room_type))
        supplyRooms.push({ project_room_id: r.id, room_name: r.name, airflow_m3h: 0, floor_index: fi });
      else if (r.classification === 'extract' || ['wet_area','laundry','kitchen','kitchenette'].includes(r.room_type))
        extractRooms.push({ project_room_id: r.id, room_name: r.name, airflow_m3h: 0, floor_index: fi });
    }
  }

  supplyRooms.sort( (a, b) => a.floor_index - b.floor_index);
  extractRooms.sort((a, b) => a.floor_index - b.floor_index);

  const plantRoom       = sourceRooms.find(r => isPlantRoom(r.name));
  const allFloorIndices = [...new Set([...supplyRooms.map(r => r.floor_index), ...extractRooms.map(r => r.floor_index)])].sort((a, b) => a - b);
  const numFloors       = Math.max(allFloorIndices.length, 1);

  return { sourceRooms, supplyRooms, extractRooms, airflowDesign, plantRoom, allFloorIndices, numFloors };
}

// ── Phase 1: Generate terminal nodes only ────────────────────
//
// Creates the duct_design record and places supply + extract terminal
// nodes in schematic position. No MVHR, no distribution assembly,
// no intake/exhaust, no runs.
//
// Called automatically on first page load. Allows the user to
// review terminal positions before placing the MVHR unit.
//
async function generateTerminalsOnly(supabase, projectId, userId) {
  const { supplyRooms, extractRooms, airflowDesign, plantRoom, numFloors } = await loadAirflowData(supabase, projectId);
  const CANVAS_H  = Math.max(800, numFloors * 280 + 100);
  const floorBands = buildFloorBands(numFloors);

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
        manifold_mode:      'single',
        scale_m:            12,
        floorBands,
        phase:              'terminals_only',
      },
    })
    .select()
    .single();

  if (designErr) throw new Error(`Failed to create duct_design: ${designErr.message}`);

  const did          = design.id;
  const nodeInserts  = [];

  // Supply terminals: N terminals per room based on airflow (1 terminal per 40 m³/h).
  // Multiple terminals for the same room are placed adjacently in the schematic.
  for (let fi = 0; fi < numFloors; fi++) {
    const band  = floorBands[fi];
    const rooms = supplyRooms.filter(r => r.floor_index === fi);
    // Total terminal slots on this floor determines schematic spacing
    const totalSlots = rooms.reduce((sum, r) => sum + terminalCount(r.airflow_m3h), 0);
    const spacing    = totalSlots > 0 ? (band.y_end - band.y_start) / (totalSlots + 1) : 0;
    let slotIdx = 0;
    for (const sr of rooms) {
      const N             = terminalCount(sr.airflow_m3h);
      const flowPerTerm   = N > 1 ? Math.round(sr.airflow_m3h / N * 10) / 10 : sr.airflow_m3h;
      for (let t = 0; t < N; t++) {
        nodeInserts.push({
          duct_design_id:   did,
          node_type:        'supply_terminal',
          project_room_id:  sr.project_room_id,
          room_name:        sr.room_name,
          floor_index:      fi,
          x:                700,
          y:                Math.round(band.y_start + spacing * (slotIdx + 1)),
          airflow_m3h:      flowPerTerm,
          duct_diameter_mm: 90,
          metadata: N > 1 ? { terminal_index: t, terminal_count: N, room_total_m3h: sr.airflow_m3h } : null,
        });
        slotIdx++;
      }
    }
  }

  // Extract terminals: N terminals per room based on airflow.
  for (let fi = 0; fi < numFloors; fi++) {
    const band  = floorBands[fi];
    const rooms = extractRooms.filter(r => r.floor_index === fi);
    const totalSlots = rooms.reduce((sum, r) => sum + terminalCount(r.airflow_m3h), 0);
    const spacing    = totalSlots > 0 ? (band.y_end - band.y_start) / (totalSlots + 1) : 0;
    let slotIdx = 0;
    for (const er of rooms) {
      const N           = terminalCount(er.airflow_m3h);
      const flowPerTerm = N > 1 ? Math.round(er.airflow_m3h / N * 10) / 10 : er.airflow_m3h;
      for (let t = 0; t < N; t++) {
        nodeInserts.push({
          duct_design_id:   did,
          node_type:        'extract_terminal',
          project_room_id:  er.project_room_id,
          room_name:        er.room_name,
          floor_index:      fi,
          x:                950,
          y:                Math.round(band.y_start + spacing * (slotIdx + 1)),
          airflow_m3h:      flowPerTerm,
          duct_diameter_mm: 90,
          metadata: N > 1 ? { terminal_index: t, terminal_count: N, room_total_m3h: er.airflow_m3h } : null,
        });
        slotIdx++;
      }
    }
  }

  const { data: nodes, error: nodeErr } = await supabase.from('duct_nodes').insert(nodeInserts).select();
  if (nodeErr) throw new Error(`Failed to insert terminal nodes: ${nodeErr.message}`);

  return { design, nodes: nodes ?? [], runs: [] };
}

// ── Phase 2: Generate routes ──────────────────────────────────
//
// Requires an existing duct_design with a placed mvhr_unit node.
// Adds the intake/exhaust nodes, distribution assembly (ComfoWell or
// manifold), and all duct runs connecting MVHR → assembly → terminals.
//
// The MVHR node's schematic (x, y) is used as the origin for all
// assembly and intake/exhaust positioning.
//
async function generateRoutes(supabase, projectId, userId, manifoldMode = 'single') {
  // 1. Load existing design (must already have terminals + mvhr_unit)
  const existing = await loadDesign(supabase, projectId);
  if (!existing) throw new Error('No duct design found. Reload the page and try again.');
  const { design, nodes: existingNodes } = existing;
  const did = design.id;

  // 2. Require placed MVHR node
  const mvhrNode = existingNodes.find(n => n.node_type === 'mvhr_unit');
  if (!mvhrNode) {
    throw new Error('MVHR unit has not been placed. Place the MVHR unit on the floor plan first.');
  }

  // 3. Clear previous routes and assembly (keep terminals + MVHR)
  await clearRoutesAndAssembly(supabase, did);

  // 4. Load airflow data and geometry
  const { supplyRooms, extractRooms, numFloors } = await loadAirflowData(supabase, projectId);
  const CANVAS_H   = design.design_json?.canvas_h ?? Math.max(800, numFloors * 280 + 100);
  const floorBands = design.design_json?.floorBands ?? buildFloorBands(numFloors);

  // 5. MVHR schematic position
  // Use stored schematic coords; fall back to sensible default if unset.
  const MVHR_X = mvhrNode.x ?? 200;
  const MVHR_Y = mvhrNode.y ?? Math.round(CANVAS_H / 2);

  // 6. Resolve unit assembly profile from selected unit's manufacturer
  let profile = getUnitAssemblyProfile(null, null);
  const selectedUnitId = design.selected_unit_id ?? design.design_json?.selected_unit_id ?? null;
  if (selectedUnitId) {
    const { data: unit } = await supabase
      .from('mvhr_units')
      .select('manufacturer, model')
      .eq('id', selectedUnitId)
      .maybeSingle();
    if (unit) profile = getUnitAssemblyProfile(unit.manufacturer, unit.model);
  }

  // 7. Trunk diameters
  const totalSupplyFlow  = supplyRooms.reduce((s, r)  => s + (r.airflow_m3h || 0), 0);
  const totalExtractFlow = extractRooms.reduce((s, r) => s + (r.airflow_m3h || 0), 0);
  const trunkSupplyDiam  = calcTrunkDiameter(totalSupplyFlow);
  const trunkExtractDiam = calcTrunkDiameter(totalExtractFlow);

  // 8. Build new assembly + intake/exhaust nodes
  const nodeInserts = [];

  // Intake and exhaust: positioned to the left of MVHR in schematic.
  const INTAKE_X  = Math.max(30, MVHR_X - 150);
  const EXHAUST_X = INTAKE_X;
  nodeInserts.push({ duct_design_id: did, node_type: 'external_intake',  room_name: 'Intake',  x: INTAKE_X,  y: MVHR_Y - 60, airflow_m3h: null, duct_diameter_mm: 200 });
  nodeInserts.push({ duct_design_id: did, node_type: 'external_exhaust', room_name: 'Exhaust', x: EXHAUST_X, y: MVHR_Y + 60, airflow_m3h: null, duct_diameter_mm: 200 });

  // Distribution assembly nodes (ComfoWell or manifold)
  if (manifoldMode === 'per_floor') {
    // Per-floor mode: one supply + one extract assembly node per floor band.
    for (const band of floorBands) {
      const fi     = band.floor_index;
      const midY   = Math.round((band.y_start + band.y_end) / 2);
      const asmX   = MVHR_X + profile.supplyOffsetX;
      nodeInserts.push({
        duct_design_id:   did, node_type: profile.supplyNodeType,
        room_name: `${profile.supplyLabel} F${fi}`, floor_index: fi,
        x: asmX, y: midY - 40, airflow_m3h: null, duct_diameter_mm: trunkSupplyDiam,
      });
      nodeInserts.push({
        duct_design_id:   did, node_type: profile.extractNodeType,
        room_name: `${profile.extractLabel} F${fi}`, floor_index: fi,
        x: asmX, y: midY + 40, airflow_m3h: null, duct_diameter_mm: trunkExtractDiam,
      });
    }
  } else {
    // Single assembly: one supply + one extract node.
    nodeInserts.push({
      duct_design_id:   did, node_type: profile.supplyNodeType,
      room_name: profile.supplyLabel,
      x: MVHR_X + profile.supplyOffsetX,  y: MVHR_Y + profile.supplyOffsetY,
      airflow_m3h: null, duct_diameter_mm: trunkSupplyDiam,
    });
    nodeInserts.push({
      duct_design_id:   did, node_type: profile.extractNodeType,
      room_name: profile.extractLabel,
      x: MVHR_X + profile.extractOffsetX, y: MVHR_Y + profile.extractOffsetY,
      airflow_m3h: null, duct_diameter_mm: trunkExtractDiam,
    });
  }

  // Insert new assembly nodes
  const { data: assemblyNodes, error: asmErr } = await supabase.from('duct_nodes').insert(nodeInserts).select();
  if (asmErr) throw new Error(`Failed to insert assembly nodes: ${asmErr.message}`);

  // Load terminal nodes (preserved by clearRoutesAndAssembly)
  const { data: allExistingNodes } = await supabase.from('duct_nodes').select('*').eq('duct_design_id', did);
  const supplyTerminals  = (allExistingNodes ?? []).filter(n => n.node_type === 'supply_terminal');
  const extractTerminals = (allExistingNodes ?? []).filter(n => n.node_type === 'extract_terminal');

  const intakeNode  = assemblyNodes.find(n => n.node_type === 'external_intake');
  const exhaustNode = assemblyNodes.find(n => n.node_type === 'external_exhaust');

  // 9. Build duct runs
  const runInserts = [];

  // intake → MVHR → exhaust
  if (intakeNode)  runInserts.push({ duct_design_id: did, from_node_id: intakeNode.id,  to_node_id: mvhrNode.id,  run_type: 'intake',  duct_type: 'epp_200', diameter_mm: 200 });
  if (exhaustNode) runInserts.push({ duct_design_id: did, from_node_id: mvhrNode.id,    to_node_id: exhaustNode.id, run_type: 'exhaust', duct_type: 'epp_200', diameter_mm: 200 });

  if (manifoldMode === 'per_floor') {
    const supplyAsms  = assemblyNodes.filter(n => n.node_type === profile.supplyNodeType);
    const extractAsms = assemblyNodes.filter(n => n.node_type === profile.extractNodeType);

    for (const sn of supplyAsms) {
      const fi   = sn.floor_index ?? 0;
      const flow = supplyRooms.filter(r => r.floor_index === fi).reduce((s, r) => s + (r.airflow_m3h || 0), 0);
      const diam = calcTrunkDiameter(flow) || trunkSupplyDiam;
      // MVHR (or ComfoWell if attached) → supply assembly
      runInserts.push({ duct_design_id: did, from_node_id: mvhrNode.id, to_node_id: sn.id, run_type: 'supply', duct_type: diam >= 160 ? 'epp_160' : 'semi_rigid_90', diameter_mm: diam });
      // Supply assembly → terminals on this floor
      for (const st of supplyTerminals.filter(t => (t.floor_index ?? 0) === fi))
        runInserts.push({ duct_design_id: did, from_node_id: sn.id, to_node_id: st.id, run_type: 'supply', duct_type: 'semi_rigid_90', diameter_mm: 90 });
    }

    for (const en of extractAsms) {
      const fi   = en.floor_index ?? 0;
      const flow = extractRooms.filter(r => r.floor_index === fi).reduce((s, r) => s + (r.airflow_m3h || 0), 0);
      const diam = calcTrunkDiameter(flow) || trunkExtractDiam;
      // Extract assembly → MVHR
      runInserts.push({ duct_design_id: did, from_node_id: en.id, to_node_id: mvhrNode.id, run_type: 'extract', duct_type: diam >= 160 ? 'epp_160' : 'semi_rigid_90', diameter_mm: diam });
      // Terminals → extract assembly
      for (const et of extractTerminals.filter(t => (t.floor_index ?? 0) === fi))
        runInserts.push({ duct_design_id: did, from_node_id: et.id, to_node_id: en.id, run_type: 'extract', duct_type: 'semi_rigid_90', diameter_mm: 90 });
    }
  } else {
    const supplyAsm  = assemblyNodes.find(n => n.node_type === profile.supplyNodeType);
    const extractAsm = assemblyNodes.find(n => n.node_type === profile.extractNodeType);

    if (supplyAsm) {
      runInserts.push({ duct_design_id: did, from_node_id: mvhrNode.id, to_node_id: supplyAsm.id, run_type: 'supply', duct_type: trunkSupplyDiam >= 160 ? 'epp_160' : 'semi_rigid_90', diameter_mm: trunkSupplyDiam });
      for (const st of supplyTerminals)
        runInserts.push({ duct_design_id: did, from_node_id: supplyAsm.id, to_node_id: st.id, run_type: 'supply', duct_type: 'semi_rigid_90', diameter_mm: 90 });
    }

    if (extractAsm) {
      runInserts.push({ duct_design_id: did, from_node_id: extractAsm.id, to_node_id: mvhrNode.id, run_type: 'extract', duct_type: trunkExtractDiam >= 160 ? 'epp_160' : 'semi_rigid_90', diameter_mm: trunkExtractDiam });
      for (const et of extractTerminals)
        runInserts.push({ duct_design_id: did, from_node_id: et.id, to_node_id: extractAsm.id, run_type: 'extract', duct_type: 'semi_rigid_90', diameter_mm: 90 });
    }
  }

  const { data: runs, error: runErr } = await supabase.from('duct_runs').insert(runInserts).select();
  if (runErr) throw new Error(`Failed to insert duct_runs: ${runErr.message}`);

  // 10. Update design phase and manifold mode
  const updatedJson = {
    ...(design.design_json ?? {}),
    phase:         'routes_generated',
    manifold_mode: manifoldMode,
    assembly_type: profile.assemblyType,
    generated_at:  new Date().toISOString(),
  };
  await supabase.from('duct_designs').update({ design_json: updatedJson }).eq('id', did);

  return await loadDesign(supabase, projectId);
}

// ── Clear routes and assembly nodes ──────────────────────────
// Removes all duct_runs and all nodes except:
//   supply_terminal, extract_terminal, mvhr_unit.
// Used before regenerating routes so terminal placements and
// the MVHR location are preserved.
async function clearRoutesAndAssembly(supabase, designId) {
  await supabase.from('duct_runs').delete().eq('duct_design_id', designId);
  await supabase.from('duct_nodes')
    .delete()
    .eq('duct_design_id', designId)
    .not('node_type', 'in', '(supply_terminal,extract_terminal,mvhr_unit)');
}

// ── Load plan pages ───────────────────────────────────────────
const FLOOR_NAMES = ['Ground Floor', 'First Floor', 'Second Floor', 'Third Floor'];
const BUCKET      = 'plan-uploads';

function storagePath(rawPath) {
  if (!rawPath) return null;
  return rawPath.startsWith(`${BUCKET}/`) ? rawPath.slice(BUCKET.length + 1) : rawPath;
}

async function makeSignedUrl(supabase, rawPath) {
  const path = storagePath(rawPath);
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) {
    console.log(JSON.stringify({ event: 'system-layout:signed-url-error', path, error: error.message }));
    return null;
  }
  return data.signedUrl;
}

async function loadPlanPages(supabase, projectId) {
  const { data: uploads } = await supabase.from('pdf_uploads').select('id').eq('project_id', projectId);
  if (!uploads?.length) return [];

  const uploadIds = uploads.map(u => u.id);
  const { data: pages } = await supabase
    .from('pdf_pages')
    .select('id, page_number, page_type, image_path, hires_image_path, hires_width_px, hires_height_px, render_width_px, render_height_px, floor_name, floor_level, sheet_title')
    .in('pdf_upload_id', uploadIds)
    .in('page_type', ['floor_plan_primary', 'floor_plan', 'floor_plan_detail'])
    .order('page_type', { ascending: true })
    .order('page_number', { ascending: true });

  if (!pages?.length) return [];

  const primary  = pages.filter(p => p.page_type === 'floor_plan_primary');
  const pageList = primary.length > 0 ? primary : pages;

  return Promise.all(pageList.map(async (p, i) => {
    const rawPath  = p.hires_image_path || p.image_path || null;
    const image_url = rawPath ? await makeSignedUrl(supabase, rawPath) : null;
    const width_px  = p.hires_width_px  ?? p.render_width_px  ?? null;
    const height_px = p.hires_height_px ?? p.render_height_px ?? null;
    return {
      floor_index: i,
      floor_name:  p.floor_name ?? FLOOR_NAMES[i] ?? `Floor ${i}`,
      page_id:     p.id,
      page_number: p.page_number,
      page_type:   p.page_type,
      image_url,
      image_path:  rawPath,
      width_px,
      height_px,
    };
  }));
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

// ── Delete design (full reset) ────────────────────────────────
async function deleteDesign(supabase, projectId) {
  await supabase.from('duct_designs').delete().eq('project_id', projectId);
}

// ── Handler ───────────────────────────────────────────────────
export default async function handler(req, res) {
  applyCors(req, res, 'GET,POST,PATCH,OPTIONS');
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
    if (!isUuid(projectId)) return res.status(400).json({ error: 'Invalid projectId: must be a UUID' });

    const { data: proj } = await supabase.from('projects').select('id').eq('id', projectId).eq('user_id', user.id).maybeSingle();
    if (!proj) return res.status(403).json({ error: 'Project not found or access denied' });

    try {
      const [designData, planPages] = await Promise.all([
        loadDesign(supabase, projectId),
        loadPlanPages(supabase, projectId),
      ]);
      if (designData) {
        return res.status(200).json({ ...designData, planPages });
      }
      // No design: generate Phase 1 (terminals only — no MVHR required)
      const generated = await generateTerminalsOnly(supabase, projectId, user.id);
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
    if (!isUuid(projectId)) return res.status(400).json({ error: 'Invalid projectId: must be a UUID' });

    const { data: proj } = await supabase.from('projects').select('id').eq('id', projectId).eq('user_id', user.id).maybeSingle();
    if (!proj) return res.status(403).json({ error: 'Project not found or access denied' });

    async function getDesignId() {
      const { data: d } = await supabase.from('duct_designs').select('id').eq('project_id', projectId).order('created_at', { ascending: false }).limit(1).maybeSingle();
      return d?.id ?? null;
    }

    try {
      // ── regenerate / generate_routes ────────────────────────────
      // Standard regeneration path. Preserves terminal positions and
      // MVHR placement. Clears and rebuilds routes + assembly only.
      if (action === 'regenerate' || action === 'generate_routes') {
        const generated = await generateRoutes(supabase, projectId, user.id, manifoldMode);
        return res.status(200).json({ ...generated, generated: true });
      }

      // ── full_regenerate ──────────────────────────────────────────
      // Nuclear reset: deletes entire design and rebuilds Phase 1.
      // Use only when the room schedule has changed significantly.
      if (action === 'full_regenerate') {
        await deleteDesign(supabase, projectId);
        const generated = await generateTerminalsOnly(supabase, projectId, user.id);
        const planPages = await loadPlanPages(supabase, projectId);
        return res.status(200).json({ ...generated, planPages, generated: true });
      }

      // ── add_node ────────────────────────────────────────────────
      if (action === 'add_node') {
        const designId = await getDesignId();
        if (!designId) return res.status(404).json({ error: 'No duct design found. Generate a layout first.' });

        const { node_type, floor_index = 0, room_name = '', airflow_m3h = 0, x_pct = 50, y_pct = 50 } = body;
        if (!node_type) return res.status(400).json({ error: 'node_type required' });

        const BAND_H = 280, Y_START = 100;
        const schX = 600;
        const schY = Y_START + floor_index * BAND_H + BAND_H / 2;

        const { data: node, error } = await supabase
          .from('duct_nodes')
          .insert({
            duct_design_id: designId,
            node_type,
            floor_index,
            room_name,
            airflow_m3h,
            x: schX,
            y: schY,
            metadata: { plan: { floor_index, x_pct, y_pct } },
          })
          .select()
          .single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ node });
      }

      // ── add_run ─────────────────────────────────────────────────
      if (action === 'add_run') {
        const designId = await getDesignId();
        if (!designId) return res.status(404).json({ error: 'No duct design found.' });

        const { from_node_id, to_node_id, run_type = 'supply' } = body;
        if (!from_node_id || !to_node_id) return res.status(400).json({ error: 'from_node_id and to_node_id required' });

        // Validate UUIDs before touching DB
        const uuidCheck = validateUuids({ from_node_id, to_node_id });
        if (!uuidCheck.valid) return res.status(400).json({ error: uuidCheck.error });

        // Ownership: both nodes must belong to this design
        const { data: nodeCheck } = await supabase
          .from('duct_nodes')
          .select('id')
          .eq('duct_design_id', designId)
          .in('id', [from_node_id, to_node_id]);
        if (!nodeCheck || nodeCheck.length !== 2)
          return res.status(403).json({ error: 'One or both nodes do not belong to this design' });

        const DIAM_MAP = { supply: 90, extract: 90, intake: 160, exhaust: 160 };
        const { data: run, error } = await supabase
          .from('duct_runs')
          .insert({ duct_design_id: designId, from_node_id, to_node_id, run_type, diameter_mm: DIAM_MAP[run_type] ?? 90, duct_type: run_type === 'supply' || run_type === 'extract' ? 'semi_rigid_90' : 'epp_160' })
          .select()
          .single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ run });
      }

      // ── delete_node ─────────────────────────────────────────────
      if (action === 'delete_node') {
        const designId = await getDesignId();
        if (!designId) return res.status(404).json({ error: 'No duct design found.' });

        const { node_id } = body;
        if (!node_id) return res.status(400).json({ error: 'node_id required' });
        if (!isUuid(node_id)) return res.status(400).json({ error: 'Invalid node_id: must be a UUID' });

        // Use parameterised filters instead of .or() string interpolation
        await supabase.from('duct_runs').delete().eq('duct_design_id', designId).eq('from_node_id', node_id);
        await supabase.from('duct_runs').delete().eq('duct_design_id', designId).eq('to_node_id',   node_id);
        const { error } = await supabase.from('duct_nodes').delete().eq('id', node_id).eq('duct_design_id', designId);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
      }

      // Default: return existing or generate terminals-only
      const existing = await loadDesign(supabase, projectId);
      if (existing) return res.status(200).json(existing);
      const generated = await generateTerminalsOnly(supabase, projectId, user.id);
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
    if (!isUuid(projectId)) return res.status(400).json({ error: 'Invalid projectId: must be a UUID' });

    const { data: proj } = await supabase.from('projects').select('id').eq('id', projectId).eq('user_id', user.id).maybeSingle();
    if (!proj) return res.status(403).json({ error: 'Project not found or access denied' });

    const { data: design, error: dErr } = await supabase.from('duct_designs').select('id, design_json').eq('project_id', projectId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (dErr) return res.status(500).json({ error: dErr.message });
    if (!design) return res.status(404).json({ error: 'No duct design found for this project' });

    const errors = [];

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
        const { error } = await supabase.from('duct_nodes').update(update).eq('id', n.id).eq('duct_design_id', design.id);
        if (error) errors.push(`node ${n.id}: ${error.message}`);
      }
    }

    if (Array.isArray(runs) && runs.length > 0) {
      for (const r of runs) {
        if (!r.id) continue;
        const update = {};
        if (r.run_type     !== undefined) update.run_type     = r.run_type;
        if (r.duct_type    !== undefined) update.duct_type    = r.duct_type;
        if (r.diameter_mm  !== undefined) update.diameter_mm  = r.diameter_mm;
        if (r.length_m     !== undefined) update.length_m     = r.length_m;
        if (r.pressure_drop_pa !== undefined) update.pressure_drop_pa = r.pressure_drop_pa;
        if (r.notes        !== undefined) update.notes        = r.notes;
        if (Object.keys(update).length === 0) continue;
        const { error } = await supabase.from('duct_runs').update(update).eq('id', r.id).eq('duct_design_id', design.id);
        if (error) errors.push(`run ${r.id}: ${error.message}`);
      }
    }

    if (status) {
      const { error } = await supabase.from('duct_designs').update({ status }).eq('id', design.id);
      if (error) errors.push(`status: ${error.message}`);
    }

    if (designJson) {
      const merged = { ...(design.design_json ?? {}), ...designJson };
      const { error } = await supabase.from('duct_designs').update({ design_json: merged }).eq('id', design.id);
      if (error) errors.push(`designJson: ${error.message}`);
    }

    if (errors.length > 0) return res.status(207).json({ ok: false, errors });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
