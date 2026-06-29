// ============================================================
// HiPer Studio — BOM API  (Stage 7)
// GET  /api/studio/bom?projectId=xxx  → compute + return full BOM
// PATCH /api/studio/bom?projectId=xxx → save notes to design_json
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { applyCors } from '../../lib/cors.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ── EPP external duct diameter (fallback only) ───────────────
// Used only when no intake/exhaust runs exist yet.
// Actual diameter is read from duct_runs.diameter_mm when available.
function eppSpecFallback(flowMax) {
  if (!flowMax || flowMax <= 250) return 125;
  if (flowMax <= 450)             return 160;
  return 200;
}

function round2(n) { return Math.round(n * 100) / 100; }
function ceilHalf(n) { return Math.ceil(n * 2) / 2; }   // round up to nearest 0.5 m

// ── BOM computation ──────────────────────────────────────────
function computeBom({ design, nodes, runs, unit }) {
  // — Terminals & distribution nodes —
  const count = (type) => nodes.filter(n => n.node_type === type).length;
  const supplyTerminals  = count('supply_terminal');
  const extractTerminals = count('extract_terminal');
  const supplyManifolds  = count('supply_manifold');
  const extractManifolds = count('extract_manifold');
  // Zehnder ComfoWell 320 distribution modules
  const comfowellSupply  = count('comfowell_supply');
  const comfowellExtract = count('comfowell_extract');
  const intakeGrilles    = count('external_intake');
  const exhaustGrilles   = count('external_exhaust');

  // — Internal duct: group supply + extract runs by duct_type ─
  const internalRuns = runs.filter(r => r.run_type === 'supply' || r.run_type === 'extract');
  const groupMap = {};
  for (const r of internalRuns) {
    const key = r.duct_type ?? 'semi_rigid_90';
    groupMap[key] = (groupMap[key] ?? 0) + (Number(r.length_m) || 0);
  }
  // Ensure at least one group so the ductwork section always renders
  if (Object.keys(groupMap).length === 0) groupMap['semi_rigid_90'] = 0;

  // Sort: semi-rigid first, then EPP by diameter
  const DUCT_ORDER = ['semi_rigid_90', 'epp_160', 'epp_180', 'epp_200', 'epp_250', 'epp_315'];
  const internal = Object.entries(groupMap)
    .sort(([a], [b]) => {
      const ai = DUCT_ORDER.indexOf(a);
      const bi = DUCT_ORDER.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    })
    .map(([ductType, measured]) => {
      const m = round2(measured);
      const b = round2(m * 0.20);
      const t = ceilHalf(m + b);
      return { ductType, measured_m: m, bendsAllowance_m: b, total_m: t };
    });

  // — External duct (intake + exhaust) ─────────────────────────
  const intakeRuns  = runs.filter(r => r.run_type === 'intake');
  const exhaustRuns = runs.filter(r => r.run_type === 'exhaust');

  const intakeLength  = round2(intakeRuns .reduce((s, r) => s + (Number(r.length_m) || 0), 0));
  const exhaustLength = round2(exhaustRuns.reduce((s, r) => s + (Number(r.length_m) || 0), 0));

  // Prefer actual run diameter; fall back to flow-based estimate
  const eppDiameter = intakeRuns[0]?.diameter_mm
    ?? exhaustRuns[0]?.diameter_mm
    ?? eppSpecFallback(unit?.flow_max);

  // Wall sleeve only needed for diameters > 160 mm
  const wallSleeve    = eppDiameter > 160;
  const eppTotal      = ceilHalf(intakeLength + exhaustLength);
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
      comfowellSupply,
      comfowellExtract,
      intakeGrilles,
      exhaustGrilles,
    },

    ductwork: {
      // Array of { ductType, measured_m, bendsAllowance_m, total_m }
      // One entry per duct product type found in the design.
      internal,
      epp: {
        diameter_mm: eppDiameter,
        intake_m:    intakeLength,
        exhaust_m:   exhaustLength,
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
  applyCors(req, res, 'GET,PATCH,OPTIONS');
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
