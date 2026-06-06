// ============================================================
// HiPer Studio Stage 2 — Seed project_rooms from AI analysis
// POST /api/studio/seed-rooms
// Body: { projectId }
//
// Reads projects.ai_analysis_json for the given project,
// deletes existing unconfirmed rows, inserts fresh rows.
// Confirmed rows (is_confirmed=true) are preserved.
// ============================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

// Map ventilationClassification → classification column
function classificationFromRoom(r) {
  const vc = r.ventilationClassification ?? r.classification;
  if (['supply','extract','transfer','ignore'].includes(vc)) return vc;
  // Fallback: infer from the category key the room appeared under in ai_analysis_json
  return 'supply';
}

// Convert a single AI room object → project_rooms row
function aiRoomToRow({ room, floor, projectId, userId, sortOrder }) {
  return {
    project_id:       projectId,
    user_id:          userId,
    name:             (room.name ?? 'Unnamed Room').trim(),
    floor:            floor ?? null,
    room_type:        room.spaceType ?? 'other',
    area:             typeof room.area === 'number' ? room.area : null,
    classification:   classificationFromRoom(room),
    bed_spaces:       typeof room.bedSpaces === 'number' ? room.bedSpaces : 0,
    optional_supply:  room.optionalSupply  === true,
    optional_extract: room.optionalExtract === true,
    confidence:       typeof room.confidence === 'number' ? room.confidence : null,
    source:           'ai_extraction',
    sort_order:       sortOrder,
    is_confirmed:     false,
  };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Auth ──────────────────────────────────────────────────
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired token' });

  // ── Validate input ────────────────────────────────────────
  const { projectId } = req.body || {};
  if (!projectId) return res.status(400).json({ error: 'projectId required' });

  // ── Load project ──────────────────────────────────────────
  const { data: project, error: projErr } = await supabase
    .from('projects')
    .select('id, ai_analysis_json')
    .eq('id', projectId)
    .single();

  if (projErr || !project) return res.status(404).json({ error: 'Project not found' });

  const analysis = project.ai_analysis_json;
  if (!analysis) return res.status(422).json({ error: 'No AI analysis found for this project. Run analysis first.' });

  // ── Build rows from analysis ──────────────────────────────
  // ai_analysis_json shape:
  //   { rooms: { supply:[], extract:[], transfer:[], ignore:[] }, _pageResults: [{floorName, data}] }
  // _pageResults gives us per-floor data; fall back to flat rooms if absent.

  const rows = [];
  let sortOrder = 0;

  if (analysis._pageResults?.length) {
    // Multi-floor: emit rooms per floor in floor order
    for (const page of analysis._pageResults) {
      const floor   = page.floorName ?? null;
      const pageRooms = page.data?.rooms ?? {};
      for (const cat of ['supply','extract','transfer','ignore']) {
        for (const room of (pageRooms[cat] ?? [])) {
          rows.push(aiRoomToRow({ room, floor, projectId, userId: user.id, sortOrder: sortOrder++ }));
        }
      }
    }
  } else {
    // Single-floor or legacy flat shape
    const flatRooms = analysis.rooms ?? {};
    for (const cat of ['supply','extract','transfer','ignore']) {
      for (const room of (flatRooms[cat] ?? [])) {
        rows.push(aiRoomToRow({ room, floor: null, projectId, userId: user.id, sortOrder: sortOrder++ }));
      }
    }
  }

  if (rows.length === 0) return res.status(422).json({ error: 'AI analysis contains no rooms to import.' });

  // ── Delete existing unconfirmed rows ──────────────────────
  const { error: delErr } = await supabase
    .from('project_rooms')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id',    user.id)
    .eq('is_confirmed', false);

  if (delErr) return res.status(500).json({ error: `Failed to clear old rooms: ${delErr.message}` });

  // ── Insert new rows ───────────────────────────────────────
  const { data: inserted, error: insErr } = await supabase
    .from('project_rooms')
    .insert(rows)
    .select();

  if (insErr) return res.status(500).json({ error: `Failed to insert rooms: ${insErr.message}` });

  return res.status(200).json({
    ok:          true,
    roomCount:   inserted.length,
    rooms:       inserted,
  });
}
