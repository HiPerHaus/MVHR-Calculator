// ============================================================
// HiPer Studio — Projects API
// GET  /api/studio/projects              → list user projects + credit balance
// POST /api/studio/projects              → create new project (costs 10 credits)
//       body: { action: 'create', name, site_address?, storeys? }
//       body: { action: 'copy',   sourceProjectId, name }
// PATCH /api/studio/projects             → rename project
//       body: { projectId, name }
// ============================================================

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  'https://hiper-studio.au');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

async function getUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  return error ? null : user;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  // ── GET: list projects + credit balance ──────────────────────────────────
  if (req.method === 'GET') {
    const [projectsResult, profileResult] = await Promise.all([
      supabase
        .from('projects')
        .select('id, name, site_address, storeys, created_at, updated_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false }),
      supabase
        .from('profiles')
        .select('credit_balance')
        .eq('id', user.id)
        .single(),
    ]);

    if (projectsResult.error) {
      console.error('projects fetch error:', projectsResult.error);
      return res.status(500).json({ error: 'Failed to load projects' });
    }

    return res.status(200).json({
      projects:       projectsResult.data ?? [],
      credit_balance: profileResult.data?.credit_balance ?? 0,
    });
  }

  // ── POST: create or copy ─────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { action } = req.body ?? {};

    // ── CREATE ──
    if (action === 'create') {
      const { name, site_address, storeys } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: 'name required' });

      // Deduct credits atomically
      const { data: newBalance, error: creditErr } = await supabase.rpc('deduct_credits', {
        p_user_id:    user.id,
        p_amount:     10,
        p_operation:  'new_project',
        p_project_id: null,
        p_description: 'Create new project',
      });

      if (creditErr) {
        if (creditErr.message?.includes('insufficient_credits')) {
          const { data: profile } = await supabase
            .from('profiles').select('credit_balance').eq('id', user.id).single();
          return res.status(402).json({
            error:    'insufficient_credits',
            balance:  profile?.credit_balance ?? 0,
            required: 10,
          });
        }
        console.error('deduct_credits error:', creditErr);
        return res.status(500).json({ error: 'Credit deduction failed' });
      }

      const { data: project, error: insertErr } = await supabase
        .from('projects')
        .insert({
          user_id: user.id,
          name:    name.trim(),
          site_address: site_address?.trim() || null,
          storeys: storeys ?? null,
        })
        .select('id, name, site_address, storeys, created_at, updated_at')
        .single();

      if (insertErr) {
        console.error('project insert error:', insertErr);
        return res.status(500).json({ error: 'Failed to create project' });
      }

      return res.status(201).json({ project, new_balance: newBalance });
    }

    // ── COPY ──
    if (action === 'copy') {
      const { sourceProjectId, name } = req.body;
      if (!sourceProjectId) return res.status(400).json({ error: 'sourceProjectId required' });
      if (!name?.trim())    return res.status(400).json({ error: 'name required' });

      // Verify ownership of source project
      const { data: source, error: srcErr } = await supabase
        .from('projects')
        .select('*')
        .eq('id', sourceProjectId)
        .eq('user_id', user.id)
        .single();

      if (srcErr || !source) return res.status(404).json({ error: 'Source project not found' });

      // Deduct credits atomically
      const { data: newBalance, error: creditErr } = await supabase.rpc('deduct_credits', {
        p_user_id:    user.id,
        p_amount:     10,
        p_operation:  'copy_project',
        p_project_id: sourceProjectId,
        p_description: `Copy project: ${source.name}`,
      });

      if (creditErr) {
        if (creditErr.message?.includes('insufficient_credits')) {
          const { data: profile } = await supabase
            .from('profiles').select('credit_balance').eq('id', user.id).single();
          return res.status(402).json({
            error:    'insufficient_credits',
            balance:  profile?.credit_balance ?? 0,
            required: 10,
          });
        }
        console.error('deduct_credits error:', creditErr);
        return res.status(500).json({ error: 'Credit deduction failed' });
      }

      // Duplicate the project row
      const { id: _srcId, created_at: _c, updated_at: _u, ...sourceFields } = source;
      const { data: newProject, error: projErr } = await supabase
        .from('projects')
        .insert({ ...sourceFields, name: name.trim() })
        .select('id, name, site_address, storeys, created_at, updated_at')
        .single();

      if (projErr) {
        console.error('copy project insert error:', projErr);
        return res.status(500).json({ error: 'Failed to copy project' });
      }

      // Copy project_rooms (unconfirmed only — confirmed are user-edited and intentionally excluded)
      const { data: rooms } = await supabase
        .from('project_rooms')
        .select('*')
        .eq('project_id', sourceProjectId);

      if (rooms?.length) {
        const roomCopies = rooms.map(({ id: _id, created_at: _rc, updated_at: _ru, project_id: _pid, ...r }) => ({
          ...r,
          project_id:   newProject.id,
          is_confirmed: false,
        }));
        const { error: roomErr } = await supabase.from('project_rooms').insert(roomCopies);
        if (roomErr) console.warn('room copy error (non-fatal):', roomErr);
      }

      return res.status(201).json({ project: newProject, new_balance: newBalance });
    }

    return res.status(400).json({ error: 'action must be create or copy' });
  }

  // ── PATCH: rename ────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { projectId, name } = req.body ?? {};
    if (!projectId) return res.status(400).json({ error: 'projectId required' });
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });

    const { data: project, error: updateErr } = await supabase
      .from('projects')
      .update({ name: name.trim() })
      .eq('id', projectId)
      .eq('user_id', user.id)
      .select('id, name, site_address, storeys, created_at, updated_at')
      .single();

    if (updateErr) {
      console.error('rename error:', updateErr);
      return res.status(500).json({ error: 'Rename failed' });
    }
    if (!project) return res.status(404).json({ error: 'Project not found' });

    return res.status(200).json({ project });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
