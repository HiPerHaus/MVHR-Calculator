// lib/mvhrRoomsSource.js
//
// F3 step 4 — resolve the room set MVHR's airflow engine consumes.
//
// DBM-first with a safe fallback:
//   1. If the project has a current Digital Building Model with confirmed rooms,
//      map those building_model_rooms → the engine's expected room shape.
//   2. Otherwise fall back to confirmed project_rooms (legacy behaviour).
//
// project_rooms is never deleted or modified. The mapping preserves MVHR parity:
//   • only rooms confirmed in project_rooms (source_json.mvhr.is_confirmed) are used,
//   • the engine room `id` is set to source_room_id so airflow_rooms.project_room_id
//     (FK → project_rooms.id) stays valid and traceable,
//   • numerics are coerced to Number (the engine does `area > 0` and `area += …`,
//     which would misbehave on stringified numerics).
//
// Gating (F3A): set DBM_MVHR_REQUIRE_APPROVED=true to make MVHR consume ONLY the
// latest `approved` model (editing rooms/volume creates a new draft that does not
// affect MVHR until explicitly approved). Default (false) lets MVHR read the
// current working model while the DBM is still being proven. Either way, if no
// usable model is found, MVHR falls back to confirmed project_rooms.

const REQUIRE_APPROVED =
  String(process.env.DBM_MVHR_REQUIRE_APPROVED ?? '').trim().toLowerCase() === 'true';

/** True when MVHR is gated to consume only approved DBM models. */
export function mvhrRequireApproved() { return REQUIRE_APPROVED; }

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Map a building_model_rooms row → the shape calculateAirflow expects
 * (the project_rooms shape the engine reads: area, room_type, classification,
 * name, bed_spaces, ceiling_height_m, floor).
 */
export function dbmRoomToEngineRoom(r) {
  const mvhr = (r.source_json && r.source_json.mvhr) || {};
  return {
    // → airflow_rooms.project_room_id (FK to project_rooms.id); null is allowed.
    id:               r.source_room_id ?? null,
    name:             r.name,
    room_type:        r.room_type,
    classification:   r.classification,
    area:             toNum(r.area_m2),
    ceiling_height_m: toNum(r.ceiling_height_m),
    bed_spaces:       Number.isFinite(Number(r.bed_spaces)) ? Number(r.bed_spaces) : 0,
    floor:            mvhr.floor ?? null,
    sort_order:       Number.isFinite(Number(r.sort_order)) ? Number(r.sort_order) : 0,
    // Pass-through MVHR flags (not read by the engine, kept for downstream parity).
    optional_supply:  mvhr.optional_supply === true,
    optional_extract: mvhr.optional_extract === true,
    requires_manual_review: mvhr.requires_manual_review === true,
    is_confirmed:     true,
    _dbm_room_id:     r.id, // provenance only
  };
}

/**
 * Resolve MVHR rooms for a project. Caller must have verified ownership.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase service-role client
 * @param {string} projectId
 * @param {string} userId
 * @returns {Promise<{ rooms: object[], source: 'dbm'|'project_rooms', modelId: string|null, modelStatus: string|null, modelUpdatedAt: string|null, error?: string }>}
 */
export async function resolveMvhrRooms(supabase, projectId, userId) {
  const gatingMode = REQUIRE_APPROVED ? 'approved_only' : 'current_working';

  // 1. Select the governing Digital Building Model.
  //    approved_only  → latest model with status='approved' (regardless of is_current)
  //    current_working→ the current (is_current) model, whatever its status
  let modelQuery = supabase
    .from('building_models')
    .select('id, status, version, updated_at, approved_at')
    .eq('project_id', projectId)
    .eq('user_id', userId);
  modelQuery = REQUIRE_APPROVED
    ? modelQuery.eq('status', 'approved').order('version', { ascending: false }).limit(1)
    : modelQuery.eq('is_current', true);
  const { data: model, error: modelErr } = await modelQuery.maybeSingle();

  if (!modelErr && model) {
    const { data: dbmRooms, error: roomsErr } = await supabase
      .from('building_model_rooms')
      .select('id, name, room_type, classification, area_m2, ceiling_height_m, bed_spaces, sort_order, source_room_id, source_json')
      .eq('model_id', model.id)
      .order('sort_order', { ascending: true });

    if (!roomsErr && dbmRooms?.length) {
      // Preserve MVHR parity: only rooms that were confirmed in project_rooms.
      const confirmed = dbmRooms.filter(r => (r.source_json?.mvhr?.is_confirmed) === true);
      const mapped = confirmed.map(dbmRoomToEngineRoom);
      if (mapped.length) {
        return {
          rooms: mapped,
          source: 'dbm',
          gatingMode,
          modelId: model.id,
          modelStatus: model.status ?? null,
          modelVersion: model.version ?? null,
          modelUpdatedAt: model.updated_at ?? null,
          modelApprovedAt: model.approved_at ?? null,
        };
      }
    }
    // model present but no usable rooms → fall through to project_rooms.
  }

  // 2. Fallback: confirmed project_rooms (legacy path).
  const { data: rooms, error } = await supabase
    .from('project_rooms')
    .select('*')
    .eq('project_id', projectId)
    .eq('is_confirmed', true)
    .order('sort_order', { ascending: true });

  if (error) return { rooms: [], source: 'project_rooms', gatingMode, modelId: null, modelStatus: null, modelVersion: null, modelUpdatedAt: null, modelApprovedAt: null, error: error.message };

  return {
    rooms: rooms ?? [],
    source: 'project_rooms',
    gatingMode,
    // When gated to approved and only a draft exists, `model` is null here
    // (we queried for approved). Surface it as a fallback with no model context.
    modelId: model?.id ?? null,
    modelStatus: model?.status ?? null,
    modelVersion: model?.version ?? null,
    modelUpdatedAt: model?.updated_at ?? null,
    modelApprovedAt: model?.approved_at ?? null,
  };
}
