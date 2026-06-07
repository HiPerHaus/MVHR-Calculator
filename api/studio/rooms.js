// ============================================================
// HiPer Studio Stage 2 — Room Schedule CRUD
// GET    /api/studio/rooms?projectId=...        → list all rooms
// POST   /api/studio/rooms                      → create a room
// PATCH  /api/studio/rooms?id=...               → update a room
// DELETE /api/studio/rooms?id=...               → delete a room
// ============================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Allowed fields for insert / update (prevents over-posting)
const WRITABLE_FIELDS = [
  'name', 'floor', 'room_type', 'area', 'classification',
  'bed_spaces', 'optional_supply', 'optional_extract',
  'confidence', 'requires_manual_review', 'source', 'sort_order', 'is_confirmed',
];

const VALID_ROOM_TYPES       = ['bedroom','living','dining','kitchen','kitchenette','wet_area','laundry','office','gym','robe','circulation','service','other'];
const VALID_CLASSIFICATIONS  = ['supply','extract','transfer','ignore'];

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Missing Supabase environment variables' });
  }

  // ── Auth ──────────────────────────────────────────────────
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Verify the token and get user
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired token' });

  // ── GET — list rooms for a project ───────────────────────
  if (req.method === 'GET') {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });

    const { data, error } = await supabase
      .from('project_rooms')
      .select('*')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true })
      .order('created_at',  { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ rooms: data });
  }

  // ── POST — create a room ──────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body || {};
    const { projectId } = body;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });

    // Validate
    if (body.room_type && !VALID_ROOM_TYPES.includes(body.room_type))
      return res.status(400).json({ error: `Invalid room_type: ${body.room_type}` });
    if (body.classification && !VALID_CLASSIFICATIONS.includes(body.classification))
      return res.status(400).json({ error: `Invalid classification: ${body.classification}` });
    if (!body.name?.trim())
      return res.status(400).json({ error: 'name required' });

    const fields = pick(body, WRITABLE_FIELDS);
    fields.name = fields.name?.trim();

    const { data, error } = await supabase
      .from('project_rooms')
      .insert({ ...fields, project_id: projectId, user_id: user.id })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ room: data });
  }

  // ── PATCH — update a room ─────────────────────────────────
  if (req.method === 'PATCH') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });

    const body = req.body || {};

    // Validate
    if (body.room_type && !VALID_ROOM_TYPES.includes(body.room_type))
      return res.status(400).json({ error: `Invalid room_type: ${body.room_type}` });
    if (body.classification && !VALID_CLASSIFICATIONS.includes(body.classification))
      return res.status(400).json({ error: `Invalid classification: ${body.classification}` });
    if ('name' in body && !body.name?.trim())
      return res.status(400).json({ error: 'name cannot be empty' });

    const fields = pick(body, WRITABLE_FIELDS);
    if (fields.name) fields.name = fields.name.trim();
    if (Object.keys(fields).length === 0)
      return res.status(400).json({ error: 'No updatable fields provided' });

    const { data, error } = await supabase
      .from('project_rooms')
      .update(fields)
      .eq('id', id)
      .eq('user_id', user.id)   // RLS + explicit guard
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!data)  return res.status(404).json({ error: 'Room not found or access denied' });
    return res.status(200).json({ room: data });
  }

  // ── DELETE — delete a room ────────────────────────────────
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });

    const { error } = await supabase
      .from('project_rooms')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
