// lib/persistBuildingModel.js
//
// F2 — persist a derived DBM plan (from deriveBuildingModel) via a Supabase
// service-role client. Additive: supersedes any prior current model for the
// project (sets is_current=false, status='superseded'), then inserts the new
// current model + children + a 'derived' audit event.
//
// NOTE: not wrapped in a DB transaction (Supabase JS has no multi-statement
// transaction). Steps are ordered so the worst-case failure leaves a model row
// with fewer children, which a re-derive overwrites. A later milestone can move
// this into a Postgres RPC for atomicity (tracked as a known risk).

import { deriveBuildingModel } from './deriveBuildingModel.js';

/**
 * Load existing project data, derive a DBM, and persist it. Read-only against
 * project_rooms / building_volume_*; additive against building_model_*.
 * Caller must have already verified project ownership.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase service-role client
 * @param {string} projectId
 * @returns {Promise<{ ok:boolean, modelId?:string, version?:number, summary?:object, error?:string }>}
 */
export async function deriveAndPersistProject(supabase, projectId) {
  // Project (need user_id + storey_count for the model root)
  const { data: project, error: pErr } = await supabase
    .from('projects')
    .select('id, user_id, storey_count')
    .eq('id', projectId)
    .maybeSingle();
  if (pErr)     return { ok: false, error: `project load failed: ${pErr.message}` };
  if (!project) return { ok: false, error: 'project not found' };

  // Rooms
  const { data: rooms, error: rErr } = await supabase
    .from('project_rooms')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true });
  if (rErr) return { ok: false, error: `rooms load failed: ${rErr.message}` };

  // Latest APPROVED building volume calculation (+ its zones)
  const { data: bvCalc, error: bvErr } = await supabase
    .from('building_volume_calculations')
    .select('*')
    .eq('project_id', projectId)
    .eq('status', 'approved')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (bvErr) return { ok: false, error: `building volume load failed: ${bvErr.message}` };

  let zones = [];
  if (bvCalc) {
    const { data: zRows, error: zErr } = await supabase
      .from('building_volume_zones')
      .select('*')
      .eq('calculation_id', bvCalc.id);
    if (zErr) return { ok: false, error: `zones load failed: ${zErr.message}` };
    zones = zRows ?? [];
  }

  const plan = deriveBuildingModel({ project, rooms: rooms ?? [], buildingVolume: bvCalc ?? null, zones });
  const result = await persistDerivedModel(supabase, plan);
  return { ...result, summary: plan.summary };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase  service-role client
 * @param {{model:object,levels:object[],rooms:object[],zones:object[],event:object}} plan
 * @returns {Promise<{ ok: boolean, modelId?: string, version?: number, error?: string }>}
 */
export async function persistDerivedModel(supabase, plan) {
  const { model, levels, rooms, zones, event } = plan;
  const projectId = model.project_id;

  // 1. Determine next version from existing history.
  const { data: existing, error: exErr } = await supabase
    .from('building_models')
    .select('id, version, is_current')
    .eq('project_id', projectId)
    .order('version', { ascending: false });
  if (exErr) return { ok: false, error: `version lookup failed: ${exErr.message}` };

  const nextVersion = (existing?.[0]?.version ?? 0) + 1;

  // 2. Supersede the current model (satisfies the one-current-per-project index).
  if (existing?.some(m => m.is_current)) {
    const { error: supErr } = await supabase
      .from('building_models')
      .update({ is_current: false, status: 'superseded' })
      .eq('project_id', projectId)
      .eq('is_current', true);
    if (supErr) return { ok: false, error: `supersede failed: ${supErr.message}` };
  }

  // 3. Insert the new current model root.
  const { data: rootRow, error: rootErr } = await supabase
    .from('building_models')
    .insert({ ...model, version: nextVersion, is_current: true })
    .select('id, version')
    .single();
  if (rootErr) return { ok: false, error: `model insert failed: ${rootErr.message}` };

  const modelId = rootRow.id;

  // 4. Insert children (attach model_id).
  const attach = (arr) => arr.map(r => ({ ...r, model_id: modelId }));

  if (levels.length) {
    const { error } = await supabase.from('building_model_levels').insert(attach(levels));
    if (error) return { ok: false, error: `levels insert failed: ${error.message}`, modelId };
  }
  if (rooms.length) {
    const { error } = await supabase.from('building_model_rooms').insert(attach(rooms));
    if (error) return { ok: false, error: `rooms insert failed: ${error.message}`, modelId };
  }
  if (zones.length) {
    const { error } = await supabase.from('building_model_zones').insert(attach(zones));
    if (error) return { ok: false, error: `zones insert failed: ${error.message}`, modelId };
  }

  // 5. Audit event.
  const { error: evErr } = await supabase
    .from('building_model_events')
    .insert({ ...event, model_id: modelId, user_id: model.user_id ?? null });
  if (evErr) return { ok: false, error: `event insert failed: ${evErr.message}`, modelId };

  return { ok: true, modelId, version: rootRow.version };
}
