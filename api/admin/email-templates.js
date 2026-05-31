// api/admin/email-templates.js
// GET    /api/admin/email-templates          → list all templates
// POST   /api/admin/email-templates          → upsert { slug, label, subject, body_html }
// DELETE /api/admin/email-templates?id=...   → delete by id

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function requireAdmin(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await supabase
    .from('profiles').select('is_admin').eq('id', user.id).single();
  return profile?.is_admin ? user : null;
}

export default async function handler(req, res) {
  const admin = await requireAdmin(req);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });

  // ── GET — list all templates ──
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('email_templates')
      .select('*')
      .order('label');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ templates: data });
  }

  // ── POST — create or update ──
  if (req.method === 'POST') {
    const { id, slug, label, subject, body_html } = req.body;
    if (!slug?.trim() || !label?.trim()) {
      return res.status(400).json({ error: 'slug and label are required' });
    }
    const payload = {
      slug: slug.trim(),
      label: label.trim(),
      subject: subject ?? '',
      body_html: body_html ?? '',
      updated_by: admin.id,
    };
    let result;
    if (id) {
      result = await supabase
        .from('email_templates')
        .update(payload)
        .eq('id', id)
        .select()
        .single();
    } else {
      result = await supabase
        .from('email_templates')
        .insert(payload)
        .select()
        .single();
    }
    if (result.error) return res.status(500).json({ error: result.error.message });
    return res.status(200).json({ template: result.data });
  }

  // ── DELETE ──
  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { error } = await supabase.from('email_templates').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ deleted: true });
  }

  return res.status(405).end();
}
