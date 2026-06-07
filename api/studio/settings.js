// ============================================================
// HiPer Studio — User Settings API
//
// GET  /api/studio/settings
//   Returns user settings merged with defaults.
//   { settings, isDefault }
//
// POST /api/studio/settings
//   Upserts one or more setting fields.
//   Body: { preferred_unit_load_percent?, default_design_method?, room_airflow_defaults? }
//   Returns { ok, settings }
// ============================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

// ── Default values ────────────────────────────────────────────
export const DEFAULT_ROOM_RATES = {
  bedroom_single_m3h:       20,
  bedroom_double_m3h:       30,
  bedroom_extra_person_m3h: 10,
  living_m3h:               40,
  second_living_m3h:        25,
  dining_m3h:               20,
  kitchen_extract_m3h:      40,
  bathroom_extract_m3h:     40,
  ensuite_extract_m3h:      30,
  laundry_extract_m3h:      40,
  wc_extract_m3h:           20,
};

export const DEFAULT_SETTINGS = {
  preferred_unit_load_percent: 60,
  default_design_method:       'passive_house',
  room_airflow_defaults:       DEFAULT_ROOM_RATES,
};

// Merge a DB row (partial) with defaults — always returns a complete settings object.
function mergeWithDefaults(row) {
  return {
    preferred_unit_load_percent: row?.preferred_unit_load_percent ?? DEFAULT_SETTINGS.preferred_unit_load_percent,
    default_design_method:       row?.default_design_method       ?? DEFAULT_SETTINGS.default_design_method,
    room_airflow_defaults: {
      ...DEFAULT_ROOM_RATES,
      ...(row?.room_airflow_defaults ?? {}),
    },
  };
}

// ── Handler ───────────────────────────────────────────────────
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Missing Supabase environment variables' });
  }

  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired token' });

  // ── GET ────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { data: row, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({
      settings:  mergeWithDefaults(row),
      isDefault: !row,
    });
  }

  // ── POST ───────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body    = req.body ?? {};
    const updates = { user_id: user.id };

    if (body.preferred_unit_load_percent != null) {
      const pct = Number(body.preferred_unit_load_percent);
      if (isNaN(pct) || pct < 45 || pct > 75) {
        return res.status(400).json({ error: 'preferred_unit_load_percent must be 45–75' });
      }
      updates.preferred_unit_load_percent = pct;
    }

    if (body.default_design_method != null) {
      if (!['passive_house', 'as1668'].includes(body.default_design_method)) {
        return res.status(400).json({ error: 'default_design_method must be passive_house or as1668' });
      }
      updates.default_design_method = body.default_design_method;
    }

    if (body.room_airflow_defaults != null) {
      const incoming = body.room_airflow_defaults;
      const validated = {};
      for (const [key, val] of Object.entries(incoming)) {
        const n = Number(val);
        if (isNaN(n) || n < 0 || n > 100) {
          return res.status(400).json({ error: `${key}: value must be 0–100 m³/h` });
        }
        validated[key] = n;
      }
      updates.room_airflow_defaults = { ...DEFAULT_ROOM_RATES, ...validated };
    }

    if (Object.keys(updates).length <= 1) {
      // Only user_id — nothing to update
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data: row, error: upsertErr } = await supabase
      .from('user_settings')
      .upsert(updates, { onConflict: 'user_id' })
      .select()
      .single();

    if (upsertErr) return res.status(500).json({ error: upsertErr.message });

    return res.status(200).json({ ok: true, settings: mergeWithDefaults(row) });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
