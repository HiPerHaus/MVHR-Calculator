// ============================================================
// HiPer Studio — F1: Digital Building Model read API
// GET /api/studio/building-model?projectId=...
//   → current (is_current) model + levels/rooms/zones/walls/openings + recent events
//   → { model: null } when no model exists yet (e.g. before F2 derivation runs)
//
// GET /api/studio/building-model?projectId=...&history=1
//   → { history: [{ id, version, status, source_type, created_at, ... }] }
//
// Read-only in F1. Additive: does not touch project_rooms or building_volume_*.
// Ownership enforced via requireProjectOwner (service-role client bypasses RLS).
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { applyCors }          from '../../lib/cors.js';
import { requireProjectOwner } from '../../lib/requireProjectOwner.js';
import { isUuid }              from '../../lib/validateUuid.js';
import { deriveAndPersistProject } from '../../lib/persistBuildingModel.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function modelResponse(row) {
  if (!row) return null;
  return {
    id:                     row.id,
    projectId:              row.project_id,
    version:                row.version,
    isCurrent:              row.is_current,
    status:                 row.status,
    sourceType:             row.source_type,
    schemaVersion:          row.schema_version,
    derivedFrom:            row.derived_from ?? {},
    conditionedFloorAreaM2: Number(row.conditioned_floor_area_m2 ?? 0),
    buildingVolumeM3:       Number(row.building_volume_m3 ?? 0),
    airtightnessLayer:      row.airtightness_layer ?? null,
    storeyCount:            row.storey_count ?? null,
    aiConfidence:           row.ai_confidence == null ? null : Number(row.ai_confidence),
    assumptions:            row.assumptions ?? [],
    warnings:               row.warnings ?? [],
    approvedAt:             row.approved_at ?? null,
    approvedBy:             row.approved_by ?? null,
    createdAt:              row.created_at,
    updatedAt:              row.updated_at,
  };
}

export default async function handler(req, res) {
  applyCors(req, res, 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Missing Supabase environment variables' });
  }

  const projectId = req.method === 'POST' ? req.body?.projectId : req.query.projectId;
  const history   = req.query.history;
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  if (!isUuid(projectId)) return res.status(400).json({ error: 'Invalid projectId: must be a UUID' });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { errorResponse } = await requireProjectOwner(req, res, supabase, projectId);
  if (errorResponse) return;

  // ── POST: derive/refresh the DBM from existing project data (F2) ──────────
  if (req.method === 'POST') {
    const action = req.body?.action ?? 'derive';
    if (action !== 'derive') return res.status(400).json({ error: `Unknown action: ${action}` });

    const result = await deriveAndPersistProject(supabase, projectId);
    if (!result.ok) return res.status(500).json({ error: result.error });
    return res.status(201).json(result);
  }

  // ── History list ─────────────────────────────────────────
  if (history) {
    const { data, error } = await supabase
      .from('building_models')
      .select('id, version, is_current, status, source_type, schema_version, conditioned_floor_area_m2, building_volume_m3, created_at, updated_at')
      .eq('project_id', projectId)
      .order('version', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ history: data ?? [] });
  }

  // ── Current model ─────────────────────────────────────────
  const { data: model, error: modelErr } = await supabase
    .from('building_models')
    .select('*')
    .eq('project_id', projectId)
    .eq('is_current', true)
    .maybeSingle();

  if (modelErr) return res.status(500).json({ error: modelErr.message });
  if (!model)   return res.status(200).json({ model: null });

  // ── Children (parallel) ───────────────────────────────────
  const [levels, rooms, zones, walls, openings, events] = await Promise.all([
    supabase.from('building_model_levels').select('*').eq('model_id', model.id).order('level_index', { ascending: true }),
    supabase.from('building_model_rooms').select('*').eq('model_id', model.id).order('sort_order', { ascending: true }),
    supabase.from('building_model_zones').select('*').eq('model_id', model.id).order('created_at', { ascending: true }),
    supabase.from('building_model_walls').select('*').eq('model_id', model.id),
    supabase.from('building_model_openings').select('*').eq('model_id', model.id),
    supabase.from('building_model_events').select('id, event_type, payload, created_at').eq('model_id', model.id).order('created_at', { ascending: false }).limit(50),
  ]);

  const firstErr = [levels, rooms, zones, walls, openings, events].find(r => r.error);
  if (firstErr) return res.status(500).json({ error: firstErr.error.message });

  return res.status(200).json({
    model:    modelResponse(model),
    levels:   levels.data ?? [],
    rooms:    rooms.data ?? [],
    zones:    zones.data ?? [],
    walls:    walls.data ?? [],
    openings: openings.data ?? [],
    events:   events.data ?? [],
  });
}
