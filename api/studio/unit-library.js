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
        is_custom:  u.user_id !== null && !u.phi_cert_id,
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

      // Clean up any broken custom units this user has where names are the literal
      // string "null" (caused by String(null) bug in a previous version of this API)
      const { data: brokenUnits } = await supabase
        .from('mvhr_units')
        .select('id')
        .eq('user_id', user.id)
        .or('manufacturer.eq.null,model.eq.null');
      if (brokenUnits?.length) {
        await supabase.from('mvhr_units').delete().in('id', brokenUnits.map(u => u.id));
      }

      // Fetch ALL units visible to this user (standard + their custom) for upsert matching
      const { data: existingUnits } = await supabase
        .from('mvhr_units')
        .select('id, manufacturer, model, user_id, phi_cert_id')
        .or(`user_id.is.null,user_id.eq.${user.id}`);

      // Build two lookup maps: by phi_cert_id and by manufacturer::model
      // Custom (user-owned) units take priority over standard units on same key
      const byCertId = new Map();
      const byName   = new Map();
      for (const u of (existingUnits ?? [])) {
        if (u.phi_cert_id) {
          const existing = byCertId.get(u.phi_cert_id.trim().toLowerCase());
          if (!existing || u.user_id !== null) {
            byCertId.set(u.phi_cert_id.trim().toLowerCase(), { id: u.id, isCustom: u.user_id !== null });
          }
        }
        if (u.manufacturer && u.model) {
          const key = `${String(u.manufacturer).trim().toLowerCase()}::${String(u.model).trim().toLowerCase()}`;
          const existing = byName.get(key);
          if (!existing || u.user_id !== null) {
            byName.set(key, { id: u.id, isCustom: u.user_id !== null });
          }
        }
      }

      // Require core numeric fields; manufacturer/model are optional for PHPP-format imports
      // (PHPP rows are identified by phi_cert_id instead)
      const REQUIRED_NUMERIC = ['hr_eff', 'sfp', 'flow_min', 'flow_max'];
      let updatedCount = 0;
      let insertedCount = 0;
      const errors   = [];

      for (const [i, u] of units.entries()) {
        // Must have either (manufacturer + model) or phi_cert_id
        if (!u.phi_cert_id && (!u.manufacturer || !u.model)) {
          errors.push(`Row ${i + 1}: needs either phi_cert_id or both manufacturer and model`);
          continue;
        }
        const missing = REQUIRED_NUMERIC.filter(k => u[k] == null || isNaN(Number(u[k])));
        if (missing.length > 0) {
          errors.push(`Row ${i + 1}: missing or invalid ${missing.join(', ')}`);
          continue;
        }

        const row = {
          user_id:          user.id,
          // Guard against String(null) = "null" — keep null as proper null
          manufacturer:     u.manufacturer != null ? String(u.manufacturer).trim() || null : null,
          model:            u.model        != null ? String(u.model).trim()        || null : null,
          hr_eff:           Number(u.hr_eff),
          sfp:              Number(u.sfp),
          flow_min:         Number(u.flow_min),
          flow_max:         Number(u.flow_max),
          phi_cert_id:      u.phi_cert_id      ? String(u.phi_cert_id).trim()       : null,
          humidity_winter:  u.humidity_winter  != null ? Number(u.humidity_winter)  : null,
          humidity_summer:  u.humidity_summer  != null ? Number(u.humidity_summer)  : null,
          hr_eff_cooling:   u.hr_eff_cooling   != null ? Number(u.hr_eff_cooling)   : null,
          ext_pressure:     u.ext_pressure     != null ? Number(u.ext_pressure)     : null,
          fittings_dp:      u.fittings_dp      != null ? Number(u.fittings_dp)      : null,
          frost_protection: u.frost_protection ? String(u.frost_protection).trim()  : null,
          noise_extract:    u.noise_extract    != null ? Number(u.noise_extract)    : null,
          noise_supply:     u.noise_supply     != null ? Number(u.noise_supply)     : null,
          additional_info:  u.additional_info  ? String(u.additional_info).trim()   : null,
        };

        // Match: cert ID first, then manufacturer+model name
        let existing = null;
        if (row.phi_cert_id) {
          existing = byCertId.get(row.phi_cert_id.trim().toLowerCase()) ?? null;
        }
        if (!existing && row.manufacturer && row.model) {
          const nameKey = `${row.manufacturer.trim().toLowerCase()}::${row.model.trim().toLowerCase()}`;
          existing = byName.get(nameKey) ?? null;
        }

        let unitId;
        const label = row.phi_cert_id || `${row.manufacturer} ${row.model}`;

        if (existing) {
          // Update — only write fields that are non-null in the import
          // Never change user_id (ownership) or manufacturer/model when import has none
          const updatePayload = {};
          const UPDATABLE = ['hr_eff', 'sfp', 'flow_min', 'flow_max', 'phi_cert_id',
            'humidity_winter', 'humidity_summer', 'hr_eff_cooling', 'ext_pressure',
            'fittings_dp', 'frost_protection', 'noise_supply', 'noise_extract', 'additional_info'];
          for (const field of UPDATABLE) {
            if (row[field] != null) updatePayload[field] = row[field];
          }
          // Only overwrite name fields if the import has a real non-null value
          if (row.manufacturer && row.manufacturer !== 'null') updatePayload.manufacturer = row.manufacturer;
          if (row.model        && row.model        !== 'null') updatePayload.model        = row.model;

          const { error: updErr } = await supabase
            .from('mvhr_units')
            .update(updatePayload)
            .eq('id', existing.id);

          if (updErr) {
            errors.push(`Row ${i + 1} (${label}): ${updErr.message}`);
            continue;
          }
          updatedCount += 1;
          // Do NOT auto-add to library on update — user controls their own library
        } else {
          // No match — insert as a new custom unit
          // For PHPP rows with no name, use cert ID as the model identifier
          const insertRow = {
            ...row,
            user_id:      user.id,
            manufacturer: (row.manufacturer && row.manufacturer !== 'null') ? row.manufacturer : 'PHI Database',
            model:        (row.model        && row.model        !== 'null') ? row.model        : (row.phi_cert_id || `Unit ${i + 1}`),
          };

          const { data: insertedUnit, error: insErr } = await supabase
            .from('mvhr_units')
            .insert(insertRow)
            .select('id')
            .single();

          if (insErr) {
            errors.push(`Row ${i + 1} (${label}): ${insErr.message}`);
            continue;
          }
          unitId = insertedUnit.id;
          // Do NOT auto-add to library — user controls their own library
          insertedCount += 1;
        }
      }

      return res.status(200).json({
        ok:            true,
        importedCount: updatedCount + insertedCount,
        updatedCount:  updatedCount,
        insertedCount: insertedCount,
        errorCount:    errors.length,
        errors:        errors.length ? errors : undefined,
      });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
