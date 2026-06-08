// ============================================================
// HiPer Studio — PHPP Import API
// POST /api/studio/phpp-import  (multipart/form-data, field: 'file')
//   Parses PHPP 10 Component Update xlsx server-side with Node.js.
//   Column B contains =HYPERLINK("url", "Manufacturer - Model") which
//   browser SheetJS cannot read (no cached value); Node xlsx reads cell.f.
//   Upserts into mvhr_units. Does NOT add units to any user library.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import formidable       from 'formidable';
import { readFileSync } from 'fs';
import { read as xlsxRead, utils as xlsxUtils } from 'xlsx';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

// ── Workbook parsing ─────────────────────────────────────────

const PHI_CERT_RE = /^\d+[a-z]+\d+$/i;

function extractHyperlinkLabel(formula) {
  // =HYPERLINK("url", "Display Name")  →  "Display Name"
  // cell.f has no leading '='
  const m = String(formula || '').match(/"([^"]+)"\s*\)\s*$/);
  return m ? m[1].trim() : '';
}

function parseName(desc) {
  // "Airflow UK - DV110 Adroit"  →  { manufacturer, model }
  // Split on first ' - ' only; drop comma-separated alternates in model
  const idx = desc.indexOf(' - ');
  if (idx > -1) {
    return {
      manufacturer: desc.slice(0, idx).trim()                      || null,
      model:        desc.slice(idx + 3).split(',')[0].trim()        || null,
    };
  }
  return { manufacturer: null, model: desc.trim() || null };
}

function num(ws, r, c) {
  const cell = ws[xlsxUtils.encode_cell({ r, c })];
  if (!cell || cell.v == null || cell.v === '') return null;
  const n = Number(cell.v);
  return isNaN(n) ? null : n;
}

function str(ws, r, c) {
  const cell = ws[xlsxUtils.encode_cell({ r, c })];
  if (!cell || cell.v == null || cell.v === '') return null;
  return String(cell.v).trim() || null;
}

function parseWorkbook(buffer) {
  const wb    = xlsxRead(buffer, { type: 'buffer', cellFormula: true });
  const ws    = wb.Sheets[wb.SheetNames[0]];
  const range = xlsxUtils.decode_range(ws['!ref'] || 'A1');
  const units = [];

  for (let r = range.s.r; r <= range.e.r; r++) {
    // Col A — must be a PHI cert ID
    const cellA = ws[xlsxUtils.encode_cell({ r, c: 0 })];
    if (!cellA || !cellA.v || !PHI_CERT_RE.test(String(cellA.v).trim())) continue;

    const phi_cert_id = String(cellA.v).trim();

    // Col B — HYPERLINK formula; cached value is blank in this file so read cell.f
    const cellB = ws[xlsxUtils.encode_cell({ r, c: 1 })];
    let desc = '';
    if (cellB) {
      desc = cellB.v ? String(cellB.v).trim()
           : cellB.f ? extractHyperlinkLabel(cellB.f)
           : '';
    }
    const { manufacturer, model } = parseName(desc);

    // Core numeric fields (cols 2, 6, 7, 8)
    const hr_eff   = num(ws, r, 2);
    const sfp      = num(ws, r, 6);
    const flow_min = num(ws, r, 7);
    const flow_max = num(ws, r, 8);
    if (hr_eff == null || sfp == null || flow_min == null || flow_max == null) continue;

    // Col 10 — fittings_dp may be the string 'incl.'
    const fitCell    = ws[xlsxUtils.encode_cell({ r, c: 10 })];
    const fittings_dp =
      (fitCell && fitCell.v != null && fitCell.v !== '' && fitCell.v !== 'incl.')
        ? (Number(fitCell.v) || null)
        : null;

    units.push({
      phi_cert_id,
      manufacturer,
      model,
      hr_eff,
      humidity_winter:  num(ws, r, 3),
      hr_eff_cooling:   num(ws, r, 4),
      humidity_summer:  num(ws, r, 5),
      sfp,
      flow_min,
      flow_max,
      ext_pressure:     num(ws, r, 9),
      fittings_dp,
      frost_protection: str(ws, r, 11),
      noise_supply:     num(ws, r, 13),
      noise_extract:    num(ws, r, 14),
      additional_info:  str(ws, r, 15),
    });
  }

  return units;
}

// ── Handler ──────────────────────────────────────────────────

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SUPABASE_KEY)
    return res.status(500).json({ error: 'Missing Supabase environment variables' });

  // Auth
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired token' });

  // Parse multipart upload
  const form = formidable({ maxFileSize: 20 * 1024 * 1024 });
  let uploadedFile;
  try {
    const [, files] = await form.parse(req);
    uploadedFile = files.file?.[0];
  } catch (e) {
    return res.status(400).json({ error: `File upload error: ${e.message}` });
  }
  if (!uploadedFile) return res.status(400).json({ error: 'No file uploaded (field name must be "file")' });

  // Parse workbook
  let units;
  try {
    const buffer = readFileSync(uploadedFile.filepath);
    units = parseWorkbook(buffer);
  } catch (e) {
    return res.status(400).json({ error: `Workbook parse error: ${e.message}` });
  }
  if (!units.length) return res.status(400).json({ error: 'No valid units found in file' });

  // Log first 5 to confirm name extraction
  console.log(`[phpp-import] parsed ${units.length} units. First 5:`);
  units.slice(0, 5).forEach(u =>
    console.log(`  ${u.phi_cert_id} | ${u.manufacturer ?? '—'} | ${u.model ?? '—'}`)
  );

  // Clean up broken "null"-string custom units from previous bad imports
  const { data: brokenUnits } = await supabase
    .from('mvhr_units').select('id').eq('user_id', user.id)
    .or('manufacturer.eq.null,model.eq.null');
  if (brokenUnits?.length) {
    await supabase.from('mvhr_units').delete().in('id', brokenUnits.map(u => u.id));
  }

  // Load all units visible to this user for match lookup
  const { data: existingUnits } = await supabase
    .from('mvhr_units')
    .select('id, manufacturer, model, user_id, phi_cert_id')
    .or(`user_id.is.null,user_id.eq.${user.id}`);

  // Build lookup maps — custom (user-owned) units take priority over standard
  const byCertId = new Map();
  const byName   = new Map();
  for (const u of (existingUnits ?? [])) {
    if (u.phi_cert_id) {
      const key = u.phi_cert_id.trim().toLowerCase();
      const cur = byCertId.get(key);
      if (!cur || u.user_id !== null) byCertId.set(key, { id: u.id });
    }
    if (u.manufacturer && u.model) {
      const key = `${u.manufacturer.trim().toLowerCase()}::${u.model.trim().toLowerCase()}`;
      const cur = byName.get(key);
      if (!cur || u.user_id !== null) byName.set(key, { id: u.id });
    }
  }

  const UPDATABLE = [
    'hr_eff', 'sfp', 'flow_min', 'flow_max', 'phi_cert_id',
    'humidity_winter', 'humidity_summer', 'hr_eff_cooling',
    'ext_pressure', 'fittings_dp', 'frost_protection',
    'noise_supply', 'noise_extract', 'additional_info',
  ];

  let inserted = 0, updated = 0, skipped = 0;

  for (const u of units) {
    // Match: cert ID first, then manufacturer+model
    let existing = null;
    if (u.phi_cert_id) existing = byCertId.get(u.phi_cert_id.toLowerCase()) ?? null;
    if (!existing && u.manufacturer && u.model) {
      existing = byName.get(`${u.manufacturer.toLowerCase()}::${u.model.toLowerCase()}`) ?? null;
    }

    if (existing) {
      // Update — only write non-null fields
      const payload = {};
      for (const f of UPDATABLE) { if (u[f] != null) payload[f] = u[f]; }
      if (u.manufacturer) payload.manufacturer = u.manufacturer;
      if (u.model)        payload.model        = u.model;

      const { error } = await supabase.from('mvhr_units').update(payload).eq('id', existing.id);
      if (error) { skipped++; console.warn('[phpp-import] update error:', error.message); }
      else updated++;
    } else {
      // Insert as a new user-owned unit
      const row = {
        ...u,
        user_id:      user.id,
        manufacturer: u.manufacturer ?? 'PHI Database',
        model:        u.model        ?? u.phi_cert_id ?? 'Unknown',
      };
      const { error } = await supabase.from('mvhr_units').insert(row);
      if (error) { skipped++; console.warn('[phpp-import] insert error:', error.message); }
      else inserted++;
    }
    // Do NOT add to user_unit_library — user controls their own library
  }

  return res.status(200).json({ ok: true, rowsProcessed: units.length, inserted, updated, skipped });
}
