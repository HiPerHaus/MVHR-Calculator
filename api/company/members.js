// api/company/members.js
// GET  /api/company/members           → list members of the caller's company
// POST /api/company/members/invite    → invite a user by email (owner/admin only)
// POST /api/company/members/remove    → remove a member (owner/admin only)
// POST /api/company/members/role      → change a member's role (owner only)

import { createClient } from '@supabase/supabase-js';
import { rateLimit, applyRateLimit } from '../../lib/rate-limit.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const inviteLimiter = rateLimit({ windowMs: 3_600_000, max: 20 });

async function getCallerProfile(token) {
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, company_id, company_role')
    .eq('id', user.id)
    .single();
  return profile || null;
}

export default async function handler(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const caller = await getCallerProfile(token);
  if (!caller) return res.status(401).json({ error: 'Invalid token' });
  if (!caller.company_id) return res.status(403).json({ error: 'You are not a member of any company' });

  // ── GET — list members ──────────────────────────────────────
  if (req.method === 'GET') {
    const { data: members, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, company_role, credit_balance, created_at')
      .eq('company_id', caller.company_id)
      .order('created_at');

    if (error) return res.status(500).json({ error: 'Query failed' });
    return res.status(200).json({ members });
  }

  // ── POST — sub-actions ──────────────────────────────────────
  if (req.method === 'POST') {
    const { action } = req.body;

    // ── invite ──────────────────────────────────────────────
    if (action === 'invite') {
      if (!['owner', 'admin'].includes(caller.company_role)) {
        return res.status(403).json({ error: 'Only company owners and admins can invite members' });
      }
      if (!applyRateLimit(req, res, { limiter: inviteLimiter })) return;

      const { email, role = 'member' } = req.body;
      if (!email?.trim()) return res.status(400).json({ error: 'email required' });
      if (!['admin', 'member'].includes(role)) {
        return res.status(400).json({ error: 'role must be "admin" or "member"' });
      }

      // Fetch company name for the invite metadata
      const { data: company } = await supabase
        .from('companies')
        .select('name')
        .eq('id', caller.company_id)
        .single();

      const origin = req.headers.origin || process.env.APP_URL || '';

      const { data, error } = await supabase.auth.admin.inviteUserByEmail(email.trim(), {
        data: {
          company_id:   caller.company_id,
          company_role: role,
          company_name: company?.name || '',
        },
        redirectTo: origin,
      });

      if (error) {
        console.error('company invite error:', error);
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({ invited: data.user?.email });
    }

    // ── remove ───────────────────────────────────────────────
    if (action === 'remove') {
      if (!['owner', 'admin'].includes(caller.company_role)) {
        return res.status(403).json({ error: 'Only company owners and admins can remove members' });
      }

      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: 'userId required' });

      // Fetch the target member
      const { data: target } = await supabase
        .from('profiles')
        .select('company_id, company_role')
        .eq('id', userId)
        .single();

      if (!target || target.company_id !== caller.company_id) {
        return res.status(404).json({ error: 'Member not found in your company' });
      }
      // Admins cannot remove the owner
      if (target.company_role === 'owner') {
        return res.status(403).json({ error: 'Cannot remove the company owner' });
      }
      // Admins cannot remove other admins (owner only)
      if (target.company_role === 'admin' && caller.company_role !== 'owner') {
        return res.status(403).json({ error: 'Only the owner can remove admins' });
      }

      const { error } = await supabase
        .from('profiles')
        .update({ company_id: null, company_role: null })
        .eq('id', userId);

      if (error) return res.status(500).json({ error: 'Failed to remove member' });
      return res.status(200).json({ removed: true });
    }

    // ── role change ──────────────────────────────────────────
    if (action === 'role') {
      if (caller.company_role !== 'owner') {
        return res.status(403).json({ error: 'Only the company owner can change roles' });
      }

      const { userId, role } = req.body;
      if (!userId || !role) return res.status(400).json({ error: 'userId and role required' });
      if (!['owner', 'admin', 'member'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }

      const { data: target } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', userId)
        .single();

      if (!target || target.company_id !== caller.company_id) {
        return res.status(404).json({ error: 'Member not found in your company' });
      }

      const updates = [
        supabase.from('profiles').update({ company_role: role }).eq('id', userId),
      ];

      // Transferring ownership: demote the current owner to admin
      if (role === 'owner') {
        updates.push(
          supabase.from('profiles').update({ company_role: 'admin' }).eq('id', caller.id),
          supabase.from('companies').update({ owner_id: userId }).eq('id', caller.company_id)
        );
      }

      for (const op of updates) {
        const { error } = await op;
        if (error) return res.status(500).json({ error: 'Role update failed' });
      }

      return res.status(200).json({ updated: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).end();
}
