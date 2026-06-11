// lib/requireProjectOwner.js
//
// Shared authentication + project ownership guard.
//
// Usage:
//   import { requireProjectOwner } from '../../lib/requireProjectOwner.js';
//
//   const { user, project, errorResponse } = await requireProjectOwner(req, res, supabase, projectId);
//   if (errorResponse) return; // response already sent
//
// Checks (in order):
//   1. Authorization header present and token valid.
//   2. projects row exists for projectId.
//   3. projects.user_id === user.id.
//
// On failure the helper writes the appropriate HTTP response and sets
// errorResponse = true so the caller can return immediately.

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} projectId
 * @returns {{ user: object|null, project: object|null, errorResponse: boolean }}
 */
export async function requireProjectOwner(req, res, supabase, projectId) {
  // 1. Auth
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return { user: null, project: null, errorResponse: true };
  }

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return { user: null, project: null, errorResponse: true };
  }

  // 2 & 3. Project existence + ownership
  const { data: project } = await supabase
    .from('projects')
    .select('id, user_id')
    .eq('id', projectId)
    .maybeSingle();

  if (!project || project.user_id !== user.id) {
    res.status(403).json({ error: 'Project not found or access denied' });
    return { user, project: null, errorResponse: true };
  }

  return { user, project, errorResponse: false };
}
