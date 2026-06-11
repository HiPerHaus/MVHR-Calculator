// ============================================================
// HiPer Studio Stage 2 — Seed project_rooms from AI analysis
// POST /api/studio/seed-rooms
// Body: { projectId }
//
// Source priority:
//   1. projects.ai_analysis_json  — merged multi-floor JSON (preferred)
//   2. plan_analysis_log rows     — fallback when ai_analysis_json is absent:
//        all successful rows for project_id, one per floor_index (most recent),
//        ordered by floor_index asc.
//
// Shape handling (flexible):
//   _pageResults[].data.rooms   — multi-floor from admin test / auto-analyse merge
//   rooms                       — single-floor or flat merged
//   parsed_rooms.rooms          — plan_analysis_log shape
//
// Deletes unconfirmed rows for the project, then inserts fresh rows.
// Confirmed rows (is_confirmed=true) are always preserved.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { applyCors }           from '../../lib/cors.js';
import { requireProjectOwner }  from '../../lib/requireProjectOwner.js';
import { isUuid }               from '../../lib/validateUuid.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ── Room-content floor deduplication (for plan_analysis_log fallback path) ──
// If two analysed floors share >70% of room names (after normalisation) they are
// almost certainly the same physical floor on different drawing sheets.  Keep the
// one with more rooms; discard the other.
const FLOOR_OVERLAP_THRESHOLD = 0.70;

function normaliseName(name) {
  return (name ?? '')
    .toLowerCase()
    .replace(/\bbedroom\b/g, 'bed')
    .replace(/\broom\b/g, '')
    .replace(/\bfloor\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function roomNamesFromObj(roomsObj) {
  return ['supply','extract','transfer','ignore']
    .flatMap(cat => (roomsObj[cat] ?? []).map(r => normaliseName(r.name)))
    .filter(Boolean);
}

function deduplicateLogFloors(floors) {
  // floors: [{ floorIndex, roomsObj }]
  if (floors.length <= 1) return floors;
  const discarded = new Set();
  for (let i = 0; i < floors.length; i++) {
    if (discarded.has(i)) continue;
    for (let j = i + 1; j < floors.length; j++) {
      if (discarded.has(j)) continue;
      const namesI = roomNamesFromObj(floors[i].roomsObj);
      const namesJ = roomNamesFromObj(floors[j].roomsObj);
      if (!namesI.length || !namesJ.length) continue;
      const setI = new Set(namesI), setJ = new Set(namesJ);
      let matches = 0;
      for (const n of setI) { if (setJ.has(n)) matches++; }
      const overlap = matches / Math.min(setI.size, setJ.size);
      if (overlap >= FLOOR_OVERLAP_THRESHOLD) {
        // Discard the floor with fewer rooms
        const discardIdx = namesJ.length <= namesI.length ? j : i;
        console.log(JSON.stringify({
          event:        'seed-rooms:duplicate-floor-discarded',
          keepFloor:    floors[discardIdx === j ? i : j].floorIndex,
          discardFloor: floors[discardIdx].floorIndex,
          overlap:      Math.round(overlap * 100),
        }));
        discarded.add(discardIdx);
        if (discardIdx === i) break;
      }
    }
  }
  return floors.filter((_, idx) => !discarded.has(idx));
}

// Map ventilationClassification (or classification) → classification column value.
// Also accepts category-key inference if the room doesn't carry the field.
function classificationFromRoom(r, categoryKey) {
  const vc = r.ventilationClassification ?? r.classification;
  if (['supply','extract','transfer','ignore'].includes(vc)) return vc;
  if (['supply','extract','transfer','ignore'].includes(categoryKey)) return categoryKey;
  return 'supply';
}

// Convert a single AI room object → project_rooms row
function aiRoomToRow({ room, floor, categoryKey, projectId, userId, sortOrder }) {
  return {
    project_id:             projectId,
    user_id:                userId,
    name:                   (room.name ?? 'Unnamed Room').trim(),
    floor:                  floor ?? null,
    room_type:              room.spaceType ?? 'other',
    area:                   typeof room.area === 'number' ? room.area : null,
    classification:         classificationFromRoom(room, categoryKey),
    bed_spaces:             typeof room.bedSpaces === 'number' ? room.bedSpaces : 0,
    optional_supply:        room.optionalSupply  === true,
    optional_extract:       room.optionalExtract === true,
    confidence:             typeof room.confidence === 'number' ? room.confidence : null,
    requires_manual_review: room.requiresManualReview === true,
    source:                 'ai_extraction',
    sort_order:             sortOrder,
    is_confirmed:           false,
  };
}

// Emit rows from a rooms object { supply:[], extract:[], transfer:[], ignore:[] }
// Returns the number of rows appended.
function emitRoomsFromObject({ roomsObj, floor, projectId, userId, rows, startOrder }) {
  let sortOrder = startOrder;
  for (const cat of ['supply','extract','transfer','ignore']) {
    for (const room of (roomsObj[cat] ?? [])) {
      rows.push(aiRoomToRow({ room, floor, categoryKey: cat, projectId, userId, sortOrder: sortOrder++ }));
    }
  }
  return sortOrder;
}

export default async function handler(req, res) {
  applyCors(req, res, 'POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Missing Supabase environment variables' });
  }

  // ── Validate input ─────────────────────────────────────────
  const { projectId } = req.body || {};
  if (!projectId) return res.status(400).json({ error: 'projectId required' });
  if (!isUuid(projectId)) return res.status(400).json({ error: 'Invalid projectId: must be a UUID' });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // ── Auth + ownership ──────────────────────────────────────
  const { user, project: ownedProject, errorResponse } = await requireProjectOwner(req, res, supabase, projectId);
  if (errorResponse) return;

  // ── Load project (need ai_analysis_json) ──────────────────
  const { data: project, error: projErr } = await supabase
    .from('projects')
    .select('id, ai_analysis_json')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .single();

  if (projErr || !project) return res.status(404).json({ error: 'Project not found' });

  // ── Resolve analysis source ────────────────────────────────
  // Primary: projects.ai_analysis_json (merged, includes _pageResults for multi-floor)
  // Fallback: all successful plan_analysis_log rows for this project
  let analysis = project.ai_analysis_json;
  let source    = 'ai_analysis_json';

  if (!analysis || (!analysis.rooms && !analysis._pageResults)) {
    // Fall back to plan_analysis_log — read all successful rows ordered by floor_index
    const { data: logs, error: logsErr } = await supabase
      .from('plan_analysis_log')
      .select('parsed_rooms, floor_index, created_at')
      .eq('project_id', projectId)
      .eq('analysis_status', 'success')
      .order('floor_index', { ascending: true })
      .order('created_at',   { ascending: false });

    if (logsErr) {
      return res.status(500).json({ error: `Failed to read analysis log: ${logsErr.message}` });
    }

    if (!logs?.length) {
      return res.status(422).json({
        error: 'No AI analysis found for this project. Run analysis first, and make sure to include the Project ID in the analysis request.',
      });
    }

    // Deduplicate step 1: keep the most-recent row per floor_index
    const floorMap = new Map();
    for (const log of logs) {
      const key = log.floor_index ?? 0;
      if (!floorMap.has(key)) floorMap.set(key, log); // first = most recent (desc sort)
    }

    let sortedFloors = [...floorMap.values()].sort((a, b) => (a.floor_index ?? 0) - (b.floor_index ?? 0));

    // Deduplicate step 2: room-content similarity — discard floors that are the same
    // physical floor shown on different drawing sheets (e.g. Dimensioned Plan).
    if (sortedFloors.length > 1) {
      const floorsWithRooms = sortedFloors.map(log => ({
        floorIndex: log.floor_index ?? 0,
        log,
        roomsObj: (() => {
          const r = log.parsed_rooms?.rooms ?? log.parsed_rooms ?? {};
          return { supply: r.supply ?? [], extract: r.extract ?? [], transfer: r.transfer ?? [], ignore: r.ignore ?? [] };
        })(),
      }));
      const deduped = deduplicateLogFloors(floorsWithRooms);
      sortedFloors = deduped.map(f => f.log);
      console.log(JSON.stringify({
        event:          'seed-rooms:plan-log-dedup',
        before:         floorsWithRooms.length,
        after:          deduped.length,
        discardedCount: floorsWithRooms.length - deduped.length,
      }));
    }

    // Build a synthetic analysis object with _pageResults for consistent downstream handling
    analysis = {
      _pageResults: sortedFloors.map((log, idx) => ({
        // Derive canonical name from sorted floor_index, not AI-detected floorName
        floorName: log.floor_index === 0 ? 'Ground Floor' :
                   log.floor_index === 1 ? 'First Floor'  :
                   log.floor_index === 2 ? 'Second Floor' :
                   `Floor ${(log.floor_index ?? idx) + 1}`,
        data:      log.parsed_rooms ?? {},
      })),
      rooms: (() => {
        // Also build a flat merged rooms for the single-floor path
        const merged = { supply: [], extract: [], transfer: [], ignore: [] };
        for (const log of sortedFloors) {
          const r = log.parsed_rooms?.rooms ?? log.parsed_rooms ?? {};
          for (const cat of ['supply','extract','transfer','ignore']) {
            merged[cat].push(...(r[cat] ?? []));
          }
        }
        return merged;
      })(),
    };
    source = 'plan_analysis_log';
  }

  // ── Build rows from analysis ───────────────────────────────
  // Shape 1: _pageResults → iterate per floor (multi-floor preferred)
  // Shape 2: flat rooms   → single-floor or legacy merged

  const rows = [];
  let sortOrder = 0;

  if (analysis._pageResults?.length) {
    // Multi-floor: iterate floors in order, derive canonical floor name from array index.
    // Do NOT trust page.floorName — the AI may return incorrect names (e.g. "First Floor"
    // for the ground floor page). The array is ordered by floor_index so idx 0 = ground.
    const CANONICAL_FLOOR = (i) =>
      i === 0 ? 'Ground Floor' :
      i === 1 ? 'First Floor'  :
      i === 2 ? 'Second Floor' :
      `Floor ${i + 1}`;

    for (const [pageIdx, page] of analysis._pageResults.entries()) {
      const floor    = CANONICAL_FLOOR(pageIdx);
      const roomsObj = page.data?.rooms ?? {};
      sortOrder = emitRoomsFromObject({ roomsObj, floor, projectId, userId: user.id, rows, startOrder: sortOrder });
    }
  } else if (analysis.rooms) {
    // Flat single-floor
    sortOrder = emitRoomsFromObject({
      roomsObj: analysis.rooms,
      floor: analysis.floorName ?? null,
      projectId,
      userId: user.id,
      rows,
      startOrder: sortOrder,
    });
  }

  if (rows.length === 0) {
    return res.status(422).json({ error: 'AI analysis contains no rooms to import.' });
  }

  // ── Delete existing unconfirmed rows ───────────────────────
  const { error: delErr } = await supabase
    .from('project_rooms')
    .delete()
    .eq('project_id',   projectId)
    .eq('user_id',      user.id)
    .eq('is_confirmed', false);

  if (delErr) return res.status(500).json({ error: `Failed to clear old rooms: ${delErr.message}` });

  // ── Insert new rows ────────────────────────────────────────
  const { data: inserted, error: insErr } = await supabase
    .from('project_rooms')
    .insert(rows)
    .select();

  if (insErr) return res.status(500).json({ error: `Failed to insert rooms: ${insErr.message}` });

  return res.status(200).json({
    ok:        true,
    source,
    roomCount: inserted.length,
    rooms:     inserted,
  });
}
