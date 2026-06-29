// ============================================================
// HiPer Studio — Digital Building Model API (F1 read, F2 derive, F3A lifecycle)
// GET   /api/studio/building-model?projectId=...
//   → current (is_current) model + levels/rooms/zones/walls/openings + events
//   → { model: null } when no model exists yet
// GET   /api/studio/building-model?projectId=...&history=1  → version history
// POST  /api/studio/building-model   body { projectId, action:'derive' }
//   → derive/refresh a new draft model from project_rooms + approved building volume
// PATCH /api/studio/building-model   body { projectId, action:'review'|'approve'|'supersede', modelId? }
//   → advance the model status; sets approved_by/at or superseded_by/at + audit event
//
// Additive: never touches project_rooms or building_volume_*.
// Ownership enforced via requireProjectOwner (service-role client bypasses RLS).
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { applyCors }          from '../../lib/cors.js';
import { requireProjectOwner } from '../../lib/requireProjectOwner.js';
import { isUuid }              from '../../lib/validateUuid.js';
import { deriveAndPersistProject } from '../../lib/persistBuildingModel.js';
import { nextStatus }         from '../../lib/buildingModelStatus.js';
import { resolveMvhrRooms, mvhrRequireApproved } from '../../lib/mvhrRoomsSource.js';

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
    supersededAt:           row.superseded_at ?? null,
    supersededBy:           row.superseded_by ?? null,
    createdAt:              row.created_at,
    updatedAt:              row.updated_at,
  };
}

export default async function handler(req, res) {
  applyCors(req, res, 'GET,POST,PATCH,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST', 'PATCH'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Missing Supabase environment variables' });
  }

  const projectId = (req.method === 'GET') ? req.query.projectId : req.body?.projectId;
  const history   = req.query.history;
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  if (!isUuid(projectId)) return res.status(400).json({ error: 'Invalid projectId: must be a UUID' });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { user, errorResponse } = await requireProjectOwner(req, res, supabase, projectId);
  if (errorResponse) return;

  // ── POST: derive/refresh the DBM from existing project data (F2) ──────────
  if (req.method === 'POST') {
    const action = req.body?.action ?? 'derive';
    if (action !== 'derive') return res.status(400).json({ error: `Unknown action: ${action}` });

    const result = await deriveAndPersistProject(supabase, projectId);
    if (!result.ok) return res.status(500).json({ error: result.error });
    return res.status(201).json(result);
  }

  // ── PATCH: status lifecycle action (F3A) ──────────────────────────────────
  //   body: { projectId, action: 'review'|'approve'|'supersede', modelId? }
  //   Operates on the current (is_current) model unless modelId is given.
  if (req.method === 'PATCH') {
    const action = req.body?.action;
    const bodyModelId = req.body?.modelId;
    if (bodyModelId && !isUuid(bodyModelId)) {
      return res.status(400).json({ error: 'Invalid modelId: must be a UUID' });
    }

    // Resolve the target model (the working/current one by default).
    let target;
    {
      let q = supabase.from('building_models').select('*').eq('project_id', projectId);
      q = bodyModelId ? q.eq('id', bodyModelId) : q.eq('is_current', true);
      const { data, error } = await q.maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      if (!data) return res.status(404).json({ error: 'No building model to update. Generate one first.' });
      target = data;
    }

    const t = nextStatus(action, target.status);
    if (!t.ok) return res.status(409).json({ error: t.error });

    const now = new Date().toISOString();
    const patch = { status: t.status };
    if (t.status === 'approved') { patch.approved_by = user.id; patch.approved_at = now; }
    if (t.status === 'superseded') { patch.superseded_at = now; if (target.is_current) patch.is_current = false; }

    const { data: updated, error: upErr } = await supabase
      .from('building_models')
      .update(patch)
      .eq('id', target.id)
      .select('*')
      .single();
    if (upErr) return res.status(500).json({ error: upErr.message });

    // On approval, retire any OTHER still-approved models for this project so
    // "latest approved" is unambiguous (this newly approved one supersedes them).
    if (t.status === 'approved') {
      await supabase
        .from('building_models')
        .update({ status: 'superseded', superseded_at: now, superseded_by: target.id })
        .eq('project_id', projectId)
        .eq('status', 'approved')
        .neq('id', target.id);
    }

    // Audit event.
    await supabase.from('building_model_events').insert({
      model_id:   target.id,
      user_id:    user.id,
      event_type: t.status === 'approved' ? 'approved' : (t.status === 'superseded' ? 'superseded' : 'edited'),
      payload:    { action, from: target.status, to: t.status },
    });

    return res.status(200).json({ ok: true, model: modelResponse(updated) });
  }

  // ── "What MVHR will use right now" (read-only; mirrors the engine) ─────────
  //   GET ?projectId=...&mvhrSource=1
  //   Resolves rooms exactly as airflow.js does, without running the engine.
  if (req.query.mvhrSource) {
    const r = await resolveMvhrRooms(supabase, projectId, user.id);
    if (r.error) return res.status(500).json({ error: r.error });

    const usingApproved = r.source === 'dbm' && r.modelStatus === 'approved';
    const sourceLabel =
      r.source === 'dbm'
        ? (r.modelStatus === 'approved' ? 'Approved Building Model' : 'Draft Building Model')
        : 'Project Rooms fallback';

    let warning = null;
    if (!usingApproved) {
      warning = r.source === 'dbm'
        ? `MVHR is using a ${String(r.modelStatus ?? 'draft').replace('_', ' ')} Building Model, not an approved one.`
        : (r.rooms.length
            ? 'MVHR is using the confirmed Project Rooms schedule — no approved Building Model is being consumed.'
            : 'No rooms available: confirm a room schedule or generate and approve a Building Model.');
    }

    return res.status(200).json({
      mvhrSource: {
        source:          r.source,            // 'dbm' | 'project_rooms'
        sourceLabel,
        gatingMode:      r.gatingMode,        // 'approved_only' | 'current_working'
        requireApproved: mvhrRequireApproved(),
        usingApproved,
        roomCount:       r.rooms.length,
        modelId:         r.modelId,
        modelStatus:     r.modelStatus,
        modelVersion:    r.modelVersion ?? null,
        updatedAt:       r.modelUpdatedAt ?? null,
        approvedAt:      r.modelApprovedAt ?? null,
        warning,
      },
    });
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
