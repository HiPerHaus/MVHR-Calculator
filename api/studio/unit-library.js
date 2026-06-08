// ============================================================
// HiPer Studio — Unit Library API
// GET    /api/studio/unit-library              → list user's library (with full unit data)
// POST   /api/studio/unit-library              → action dispatch: add | remove | import
//   body { action: 'add',    unitId }          → add unit to library
//   body { action: 'remove', unitId }          → remove unit from library
//   body { action: 'import', units: [...] }    → import custom units + add to library
//                                                 each unit: { manufacturer, model, hr_eff,
//                                                   sfp, flow_min, flow_max, phi_cert_id?,
//                                                   humidity_winter?, ext_pressure?, noise_supply?,
//                                                   noise_extract?, frost_protection?, additional_info? }
// GET    /api/studio/unit-library?all=1        → list ALL standard units with library membership flag
// ============================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

const UNIT_SELECT = 'id, manufacturer, model, hr_eff, sfp, flow_min, flow_max, phi_cert_id, humidity_winter, humidity_summer, hr_eff_cooling, ext_pressure, fittings_dp, frost_protection, noise_extract, noise_supply, additional_info, user_id';

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
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired token' });

  // ── GET ───────────────────────────────────────────────────
  if (req.method === 'GET') {
    const showAll = req.query.all === '1';

    if (showAll) {
      // Return all standard units + user's custom units, flagged with library membership
      const [unitsRes, libRes] = await Promise.all([
        supabase
          .from('mvhr_units')
          .select(UNIT_SELECT)
          .or(`user_id.is.null,user_id.eq.${user.id}`)
          .order('manufacturer', { ascending: true })
          .order('model',        { ascending: true }),
        supabase
          .from('user_unit_library')
          .select('unit_id')
          .eq('user_id', user.id),
      ]);

      if (unitsRes.error) return res.status(500).json({ error: unitsRes.error.message });

      const librarySet = new Set((libRes.data ?? []).map(r => r.unit_id));

      const units = (unitsRes.data ?? []).map(u => ({
        ...u,
        in_library: librarySet.has(u.id),
        is_custom:  u.user_id !== null,
      }));

      return res.status(200).json({ units, libraryCount: librarySet.size });
    }

    // Default: return only user's library units
    const { data: libRows, error: libErr } = await supabase
      .from('user_unit_library')
      .select(`unit_id, mvhr_units:unit_id (${UNIT_SELECT})`)
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });

    if (libErr) return res.status(500).json({ error: libErr.message });

    const units = (libRows ?? []).map(row => ({
      ...row.mvhr_units,
      in_library: true,
      is_custom:  row.mvhr_units?.user_id !== null,
    }));

    return res.status(200).json({ units, libraryCount: units.length });
  }

  // ── POST ──────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body || {};
    const { action } = body;

    // ── add ──────────────────────────────────────────────────
    if (action === 'add') {
      const { unitId } = body;
      if (!unitId) return res.status(400).json({ error: 'unitId required' });

      // Verify unit exists and is accessible to this user
      const { data: unit, error: uErr } = await supabase
        .from('mvhr_units')
        .select('id, user_id')
        .eq('id', unitId)
        .maybeSingle();

      if (uErr || !unit) return res.status(404).json({ error: 'Unit not found' });
      if (unit.user_id && unit.user_id !== user.id)
        return res.status(403).json({ error: 'Cannot add another user\'s custom unit' });

      const { error: insErr } = await supabase
        .from('user_unit_library')
        .upsert({ user_id: user.id, unit_id: unitId }, { onConflict: 'user_id,unit_id' });

      if (insErr) return res.status(500).json({ error: insErr.message });
      return res.status(200).json({ ok: true });
    }

    // ── remove ───────────────────────────────────────────────
    if (action === 'remove') {
      const { unitId } = body;
      if (!unitId) return res.status(400).json({ error: 'unitId required' });

      const { error: delErr } = await supabase
        .from('user_unit_library')
        .delete()
        .eq('user_id', user.id)
        .eq('unit_id', unitId);

      if (delErr) return res.status(500).json({ error: delErr.message });
      return res.status(200).json({ ok: true });
    }

    // ── import (custom units from PHPP data) ─────────────────
    if (action === 'import') {
      const { units } = body;
      if (!Array.isArray(units) || units.length === 0)
        return res.status(400).json({ error: 'units array required' });

      const REQUIRED = ['manufacturer', 'model', 'hr_eff', 'sfp', 'flow_min', 'flow_max'];
      const imported = [];
      const errors   = [];

      for (const [i, u] of units.entries()) {
        const missing = REQUIRED.filter(k => u[k] == null);
        if (missing.length > 0) {
          errors.push(`Row ${i + 1}: missing ${missing.join(', ')}`);
          continue;
        }

        const row = {
          user_id:        user.id,
          manufacturer:   String(u.manufacturer).trim(),
          model:          String(u.model).trim(),
          hr_eff:         Number(u.hr_eff),
          sfp:            Number(u.sfp),
          flow_min:       Number(u.flow_min),
          flow_max:       Number(u.flow_max),
          phi_cert_id:    u.phi_cert_id    ? String(u.phi_cert_id).trim()    : null,
          humidity_winter: u.humidity_winter != null ? Number(u.humidity_winter) : null,
          humidity_summer: u.humidity_summer != null ? Number(u.humidity_summer) : null,
          hr_eff_cooling:  u.hr_eff_cooling  != null ? Number(u.hr_eff_cooling)  : null,
          ext_pressure:    u.ext_pressure    != null ? Number(u.ext_pressure)    : null,
          fittings_dp:     u.fittings_dp     != null ? Number(u.fittings_dp)     : null,
          frost_protection: u.frost_protection ? String(u.frost_protection).trim() : null,
          noise_extract:   u.noise_extract   != null ? Number(u.noise_extract)   : null,
          noise_supply:    u.noise_supply    != null ? Number(u.noise_supply)    : null,
          additional_info: u.additional_info ? String(u.additional_info).trim()  : null,
        };

        // Insert custom unit
        const { data: inserted, error: insErr } = await supabase
          .from('mvhr_units')
          .insert(row)
          .select('id')
          .single();

        if (insErr) {
          errors.push(`Row ${i + 1} (${u.manufacturer} ${u.model}): ${insErr.message}`);
          continue;
        }

        // Add to library
        await supabase
          .from('user_unit_library')
          .upsert({ user_id: user.id, unit_id: inserted.id }, { onConflict: 'user_id,unit_id' });

        imported.push(inserted.id);
      }

      return res.status(200).json({
        ok:            true,
        importedCount: imported.length,
        errorCount:    errors.length,
        errors:        errors.length ? errors : undefined,
      });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
