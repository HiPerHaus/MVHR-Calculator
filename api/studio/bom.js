// ============================================================
// HiPer Studio — BOM API  (Stage 7)
// GET  /api/studio/bom?projectId=xxx  → compute + return full BOM
// PATCH /api/studio/bom?projectId=xxx → save notes to design_json
// ============================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

// ── EPP duct sizing ──────────────────────────────────────────
// Based on MVHR unit's max airflow:
//   ≤ 250 m³/h  → 125 mm EPP
//   ≤ 450 m³/h  → 160 mm EPP
//   > 450 m³/h  → 160 mm EPP runs + 200 mm EPP wall sleeve
function eppSpec(flowMax) {
  if (!flowMax || flowMax <= 250) return { diameter_mm: 125, wallSleeve: false };
  if (flowMax <= 450)             return { diameter_mm: 160, wallSleeve: false };
  return                                 { diameter_mm: 160, wallSleeve: true  };
}

function round2(n) { return Math.round(n * 100) / 100; }
function ceilHalf(n) { return Math.ceil(n * 2) / 2; }   // round up to nearest 0.5 m

// ── BOM computation ──────────────────────────────────────────
function computeBom({ design, nodes, runs, unit }) {
  // — Terminals & manifolds —
  const count = (type) => nodes.filter(n => n.node_type === type).length;
  const supplyTerminals   = count('supply_terminal');
  const extractTerminals  = count('extract_terminal');
  const supplyManifolds   = count('supply_manifold');
  const extractManifolds  = count('extract_manifold');
  const intakeGrilles     = count('external_intake');
  const exhaustGrilles    = count('external_exhaust');

  // — Duct lengths —
  const runLength = (type) => runs
    .filter(r => r.run_type === type)
    .reduce((s, r) => s + (Number(r.length_m) || 0), 0);

  const supplyLength  = runLength('supply');
  const extractLength = runLength('extract');
  const intakeLength  = runLength('intake');
  const exhaustLength = runLength('exhaust');

  const semiRigidMeasured   = round2(supplyLength + extractLength);
  const semiRigidBends      = round2(semiRigidMeasured * 0.20);
  const semiRigidTotal      = ceilHalf(semiRigidMeasured + semiRigidBends);

  const eppIntake  = round2(intakeLength);
  const eppExhaust = round2(exhaustLength);
  const eppTotal   = ceilHalf(eppIntake + eppExhaust);

  const { diameter_mm: eppDiameter, wallSleeve } = eppSpec(unit?.flow_max);

  // Wall sleeve: 1 m per external grille point when unit requires >160 mm connection
  const wallSleeveQty = wallSleeve ? (intakeGrilles + exhaustGrilles) : 0;

  return {
    unit: unit ? {
      manufacturer: unit.manufacturer,
      model:        unit.model,
      phi_cert_id:  unit.phi_cert_id,
      hr_eff:       unit.hr_eff,
      sfp:          unit.sfp,
      flow_min:     unit.flow_min,
      flow_max:     unit.flow_max,
      humidity_winter: unit.humidity_winter,
    } : null,

    counts: {
      supplyTerminals,
      extractTerminals,
      supplyManifolds,
      extractManifolds,
      intakeGrilles,
      exhaustGrilles,
    },

    ductwork: {
      semiRigid: {
        diameter_mm:       90,
        measured_m:        semiRigidMeasured,
        bendsAllowance_m:  semiRigidBends,
        total_m:           semiRigidTotal,
      },
      epp: {
        diameter_mm: eppDiameter,
        intake_m:    eppIntake,
        exhaust_m:   eppExhaust,
        total_m:     eppTotal,
      },
      wallSleeve: {
        required:    wallSleeve,
        diameter_mm: 200,
        qty_m:       wallSleeveQty,  // 1 m each
      },
    },

    notes: design?.design_json?.bom_notes ?? '',
  };
}

// ── Handler ──────────────────────────────────────────────────
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!SUPABASE_URL || !SUPABASE_KEY)
    return res.status(500).json({ error: 'Missing Supabase env vars' });

  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired token' });

  const projectId = req.query.projectId;
  if (!projectId) return res.status(400).json({ error: 'projectId required' });

  // Verify project ownership
  const { data: project } = await supabase
    .from('projects')
    .select('id, name, address, created_at')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!project) return res.status(404).json({ error: 'Project not found' });

  // ── GET ───────────────────────────────────────────────────
  if (req.method === 'GET') {
    // Load latest duct design
    const { data: design } = await supabase
      .from('duct_designs')
      .select('id, design_json, selected_unit_id, airflow_design_id')
      .eq('project_id', projectId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Load nodes and runs if design exists
    let nodes = [], runs = [];
    if (design) {
      const [nodesRes, runsRes] = await Promise.all([
        supabase.from('duct_nodes').select('*').eq('duct_design_id', design.id),
        supabase.from('duct_runs').select('*').eq('duct_design_id', design.id),
      ]);
      nodes = nodesRes.data ?? [];
      runs  = runsRes.data  ?? [];
    }

    // Load selected unit — prefer airflow_designs.selected_unit_id (uuid FK)
    let unit = null;
    const { data: airflowDesign } = await supabase
      .from('airflow_designs')
      .select('selected_unit_id')
      .eq('project_id', projectId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const unitId = airflowDesign?.selected_unit_id;
    if (unitId) {
      const { data: u } = await supabase
        .from('mvhr_units')
        .select('id, manufacturer, model, phi_cert_id, hr_eff, sfp, flow_min, flow_max, humidity_winter, ext_pressure')
        .eq('id', unitId)
        .maybeSingle();
      unit = u;
    }

    const bom = computeBom({ design, nodes, runs, unit });

    return res.status(200).json({ project, bom, hasDesign: !!design });
  }

  // ── PATCH — save notes ────────────────────────────────────
  if (req.method === 'PATCH') {
    const { notes } = req.body ?? {};

    const { data: design } = await supabase
      .from('duct_designs')
      .select('id, design_json')
      .eq('project_id', projectId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!design) return res.status(404).json({ error: 'No duct design found' });

    const updatedJson = { ...(design.design_json ?? {}), bom_notes: notes ?? '' };
    const { error } = await supabase
      .from('duct_designs')
      .update({ design_json: updatedJson })
      .eq('id', design.id);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
