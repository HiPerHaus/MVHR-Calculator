// ============================================================
// HiPer Studio Stage 3 — Airflow Design Engine
//
// Design methodology:
//   Whole-house sizing first:
//     designFlow = max(occupancyFlow, areaFlow, wetRoomFlow)
//   Then room allocations provide the distribution detail.
//
// GET  /api/studio/airflow?projectId=...
//   Returns saved design + rooms + MVHR matches (no recalculation).
//
// POST /api/studio/airflow
//   Body: { projectId, designMethod }
//   Calculates, persists, returns result.
//
// PATCH /api/studio/airflow
//   Body: { projectId, designMethod }
//   Alias for POST (re-calculate with new method).
// ============================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

// ── Helpers ───────────────────────────────────────────────────
const r1  = v  => Math.round(v  * 10) / 10;
const r0  = v  => Math.round(v);
const toLps = m3h => r1(m3h / 3.6);
const toM3h = lps => r1(lps * 3.6);

const isWC      = n => /\bwc\b|water\s*closet|toilet(?!\s*room)|powder\s*room/i.test(n ?? '');
const isEnsuite = n => /ensuite|en-suite|en\s+suite/i.test(n ?? '');

// Per-m² airflow rates per design method (m³/h per m² of treated floor area).
// Passive House design guide: 1 m³/h per m² (equivalent to ~0.30 ACH at 2.4m ceiling).
// AS1668 / NCC: 1.5 m³/h per m² (higher ventilation requirement).
const AREA_RATE = { passive_house: 1.0, as1668: 1.5 };

// ── Default room airflow rates (m³/h) ─────────────────────────
// These match the defaults in api/studio/settings.js.
// The POST handler loads user overrides and merges over these.
const DEFAULT_ROOM_RATES = {
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

// Ignored room types and classifications for area calculation
const AREA_EXCLUDE_CLS   = new Set(['ignore']);
const AREA_EXCLUDE_TYPES = new Set(['service']); // garage, balcony captured by cls=ignore

// Room types that are expected to carry valid area data.
// If fewer than AREA_COMPLETENESS_THRESHOLD of these rooms have area > 0,
// the area-based calculation is suppressed (treat as no data).
const AREA_EXPECTED_TYPES = new Set([
  'bedroom', 'living', 'dining', 'kitchen', 'kitchenette',
  'wet_area', 'laundry', 'office', 'gym',
]);
const AREA_COMPLETENESS_THRESHOLD = 0.80; // 80%

// ── Extract rate lookup ───────────────────────────────────────
// Design extract rates (m³/h). Accepts user-customised rates object.
function extractRate(room, rates = DEFAULT_ROOM_RATES) {
  const t = room.room_type;
  const n = room.name ?? '';
  if (t === 'kitchen' || t === 'kitchenette') return rates.kitchen_extract_m3h;
  if (t === 'laundry')  return rates.laundry_extract_m3h;
  if (t === 'wet_area') {
    if (isWC(n))      return rates.wc_extract_m3h;
    if (isEnsuite(n)) return rates.ensuite_extract_m3h;
    return rates.bathroom_extract_m3h; // standard bathroom
  }
  if (t === 'service') return 15;
  return 0;
}

// ── Supply rate lookup ────────────────────────────────────────
// Design supply rates (m³/h) per room type. Accepts user-customised rates object.
function supplyRate(room, rates = DEFAULT_ROOM_RATES) {
  const t = room.room_type;
  const cls = room.classification;
  const n = room.name ?? '';

  if (cls === 'ignore' || cls === 'transfer') return 0;
  if (t === 'circulation' || t === 'robe')    return 0;

  switch (t) {
    case 'bedroom': {
      const beds = Math.max(room.bed_spaces || 1, 1);
      if (beds === 1) return rates.bedroom_single_m3h;
      // Double + extra person per additional space beyond double
      return rates.bedroom_double_m3h + (beds - 2) * rates.bedroom_extra_person_m3h;
    }
    case 'living': {
      // Retreat / rumpus / media / family = secondary living
      // Main living = primary rate (balancer can adjust ±10 m³/h)
      const nm = (room.name ?? '').toLowerCase();
      if (/retreat|rumpus|media|games|family|lounge 2|living 2/i.test(nm)) return rates.second_living_m3h;
      return rates.living_m3h;
    }
    case 'dining':   return rates.dining_m3h;
    case 'office':   return 20;
    case 'gym':      return 30;
    default:
      // Other room_types: if classified supply, give 15 m³/h minimum
      if (cls === 'supply') return 15;
      return 0;
  }
}

// ── Whole-house design basis ──────────────────────────────────

/**
 * Occupancy-based flow: totalBedSpaces × 30 m³/h
 */
function calcOccupancyFlow(rooms) {
  let count = 0;
  for (const r of rooms) {
    if (r.room_type === 'bedroom' && r.classification !== 'ignore') {
      count += Math.max(r.bed_spaces || 1, 1);
    }
  }
  return { occupancyCount: count, occupancyFlowM3h: r0(count * 30) };
}

/**
 * Area-based flow: treatedArea × rate (m³/h per m²)
 * Returns { treatedAreaM2, areaFlowM3h, hasAreaData, areaWithCount, areaExpectedCount }
 *
 * hasAreaData = false when:
 *   - No rooms have area > 0, OR
 *   - Fewer than AREA_COMPLETENESS_THRESHOLD (80%) of habitable rooms have area > 0.
 *     In this case the partial area total would be misleading, so the calculation is suppressed.
 */
function calcAreaFlow(rooms, method) {
  const rate = AREA_RATE[method] ?? 1.0; // m³/h per m²

  // Rooms expected to carry area data (habitable, not ignored/service)
  const habitableRooms = rooms.filter(r =>
    !AREA_EXCLUDE_CLS.has(r.classification) &&
    !AREA_EXCLUDE_TYPES.has(r.room_type) &&
    AREA_EXPECTED_TYPES.has(r.room_type)
  );
  const withArea    = habitableRooms.filter(r => r.area > 0);
  const missingArea = habitableRooms.filter(r => !(r.area > 0));
  const completeness = habitableRooms.length > 0
    ? withArea.length / habitableRooms.length
    : 0;

  // Diagnostic logs
  console.log(JSON.stringify({
    event:              'room-area-completeness',
    habitableRoomCount: habitableRooms.length,
    withAreaCount:      withArea.length,
    missingAreaCount:   missingArea.length,
    completenessPct:    r1(completeness * 100),
    thresholdPct:       AREA_COMPLETENESS_THRESHOLD * 100,
    adequate:           completeness >= AREA_COMPLETENESS_THRESHOLD,
  }));
  if (missingArea.length > 0) {
    console.log(JSON.stringify({
      event: 'missing-area-room-list',
      count: missingArea.length,
      rooms: missingArea.map(r => ({ name: r.name, type: r.room_type })),
    }));
  }

  // Suppress area calculation if completeness below threshold
  if (completeness < AREA_COMPLETENESS_THRESHOLD) {
    return {
      treatedAreaM2: 0, areaFlowM3h: 0, hasAreaData: false,
      areaWithCount: withArea.length, areaExpectedCount: habitableRooms.length,
    };
  }

  // Sum area across all non-excluded rooms with valid area
  let area = 0;
  for (const r of rooms) {
    if (AREA_EXCLUDE_CLS.has(r.classification)) continue;
    if (AREA_EXCLUDE_TYPES.has(r.room_type))    continue;
    if (!(r.area > 0))                           continue;
    area += r.area;
  }

  const flow = r0(area * rate);
  return {
    treatedAreaM2: r1(area), areaFlowM3h: flow, hasAreaData: true,
    areaWithCount: withArea.length, areaExpectedCount: habitableRooms.length,
  };
}

/**
 * Wet-room extract requirement: sum of all extract rates.
 */
function calcWetRoomFlow(rooms) {
  let total = 0;
  for (const r of rooms) {
    if (r.classification === 'ignore') continue;
    total += extractRate(r);
  }
  return r0(total);
}

// ── Room allocation ───────────────────────────────────────────
/**
 * Assign supply and extract m³/h to every confirmed room.
 * Returns array of room result objects.
 */
function allocateRooms(rooms, rates = DEFAULT_ROOM_RATES) {
  return rooms.map(room => {
    const cls = room.classification;
    const t   = room.room_type;
    const n   = room.name ?? '';

    // Ignored / transfer
    if (cls === 'ignore') {
      return mkRoom(room, 0, 0, 'ignored');
    }
    if (cls === 'transfer' || t === 'circulation' || t === 'robe') {
      return mkRoom(room, 0, 0, 'transfer');
    }

    // Extract rooms
    const eRate = extractRate(room, rates);
    if (eRate > 0) {
      let driver = `${t}`;
      if (t === 'wet_area') {
        driver = isWC(n) ? `wc_${rates.wc_extract_m3h}` : isEnsuite(n) ? `ensuite_${rates.ensuite_extract_m3h}` : `bathroom_${rates.bathroom_extract_m3h}`;
      }
      return mkRoom(room, 0, eRate, driver);
    }

    // Supply rooms
    const sRate = supplyRate(room, rates);
    if (sRate > 0) {
      const driver = t === 'bedroom'
        ? `bedroom_${Math.max(room.bed_spaces || 1, 1)}bed`
        : `${t}_fixed`;
      return mkRoom(room, sRate, 0, driver);
    }

    return mkRoom(room, 0, 0, 'unclassified');
  });
}

function mkRoom(room, supplyM3h, extractM3h, driver, notes = null) {
  return {
    project_room_id: room.id,
    room_name:       room.name,
    room_type:       room.room_type,
    floor:           room.floor ?? null,
    sort_order:      room.sort_order ?? 0,
    supply_m3h:      supplyM3h,
    extract_m3h:     extractM3h,
    supply_lps:      toLps(supplyM3h),
    extract_lps:     toLps(extractM3h),
    airflow_driver:  driver,
    notes,
  };
}

// ── Balance logic ─────────────────────────────────────────────
//
// Only living and dining supply may be adjusted.
//   living:  base 40, min 30, max 50
//   dining:  base 20, min 15, max 25
// Bedrooms and wet rooms are NEVER modified.
// If balance cannot be achieved → major_imbalance.
//
const BALANCE_RULES = [
  { type: 'living', min: 30, max: 50 },
  { type: 'dining', min: 15, max: 25 },
];

function balanceDesign(roomResults, rooms) {
  const sumKey = key => r1(roomResults.reduce((s, r) => s + (r[key] || 0), 0));

  let totalSupply  = sumKey('supply_m3h');
  let totalExtract = sumKey('extract_m3h');
  const maxFlow    = Math.max(totalSupply, totalExtract);
  const initRatio  = maxFlow > 0 ? Math.abs(totalSupply - totalExtract) / maxFlow : 0;

  console.log(JSON.stringify({
    event: 'airflow:base-supply-total',  baseSupplyM3h: totalSupply,
    event2: 'airflow:base-extract-total', baseExtractM3h: totalExtract,
    initDiffM3h: r1(totalSupply - totalExtract), initRatio: r1(initRatio * 100),
  }));

  if (initRatio <= 0.05) {
    return { roomResults, adjustmentM3h: 0, balanceStatus: 'balanced' };
  }

  let needed = r1(totalExtract - totalSupply); // positive = need more supply
  let totalApplied = 0;

  for (const rule of BALANCE_RULES) {
    if (Math.abs(needed) < 1) break;

    // Only adjust rooms that already carry supply (supply_m3h > 0).
    // Ignored / transfer living rooms correctly have supply = 0 and must NOT
    // be pulled up to the rule minimum during balancing.
    const candidates = roomResults
      .map((r, i) => ({ r, i, srcRoom: rooms[i] }))
      .filter(({ r, srcRoom }) => srcRoom.room_type === rule.type && r.supply_m3h > 0);

    for (const { r, i } of candidates) {
      if (Math.abs(needed) < 1) break;

      const current = r.supply_m3h;
      const capped  = needed > 0
        ? Math.min(rule.max, current + needed)
        : Math.max(rule.min, current + needed);
      const applied = r1(capped - current);
      if (Math.abs(applied) < 0.5) continue;

      roomResults[i] = {
        ...r,
        supply_m3h:  r1(current + applied),
        supply_lps:  toLps(r1(current + applied)),
        notes: (r.notes ? r.notes + '; ' : '') +
               `Balance adj: ${applied >= 0 ? '+' : ''}${applied} m³/h`,
      };
      needed       = r1(needed - applied);
      totalApplied = r1(totalApplied + applied);
    }
  }

  // Final ratio
  totalSupply  = sumKey('supply_m3h');
  totalExtract = sumKey('extract_m3h');
  const finalMax   = Math.max(totalSupply, totalExtract);
  const finalRatio = finalMax > 0 ? Math.abs(totalSupply - totalExtract) / finalMax : 0;

  console.log(JSON.stringify({
    event: 'airflow:balance-adjustment',
    adjustmentM3h: totalApplied, neededRemainingM3h: r1(needed),
    finalSupplyM3h: totalSupply, finalExtractM3h: totalExtract,
    finalDiffM3h: r1(totalSupply - totalExtract), finalRatio: r1(finalRatio * 100),
  }));

  const balanceStatus = finalRatio <= 0.05
    ? 'balanced'
    : finalRatio <= 0.10
      ? 'minor_adjustment'
      : 'major_imbalance';

  return { roomResults, adjustmentM3h: totalApplied, balanceStatus };
}

// ── Main calculation ──────────────────────────────────────────
function calculateAirflow(rooms, method, userRates = DEFAULT_ROOM_RATES) {
  const rates = { ...DEFAULT_ROOM_RATES, ...userRates };
  // 1. Whole-house design basis
  const { occupancyCount, occupancyFlowM3h } = calcOccupancyFlow(rooms);
  const { treatedAreaM2, areaFlowM3h, hasAreaData, areaWithCount, areaExpectedCount } = calcAreaFlow(rooms, method);
  const wetRoomFlowM3h = calcWetRoomFlow(rooms);

  // Design airflow = max of the three methods
  const designFlowM3h = r0(Math.max(occupancyFlowM3h, areaFlowM3h, wetRoomFlowM3h));
  const designDriver  = designFlowM3h === occupancyFlowM3h ? 'occupancy'
    : designFlowM3h === areaFlowM3h    ? 'area'
    : 'wet_room';

  // Diagnostic: floor distribution
  const floorGroups = {};
  for (const r of rooms) {
    const fl = r.floor || 'Unknown';
    if (!floorGroups[fl]) floorGroups[fl] = { supply: 0, extract: 0, transfer: 0, ignore: 0 };
    floorGroups[fl][r.classification] = (floorGroups[fl][r.classification] ?? 0) + 1;
  }
  console.log(JSON.stringify({
    event:  'airflow:floor-distribution',
    floors: Object.entries(floorGroups).map(([name, counts]) => ({ name, ...counts })),
  }));

  // Diagnostic: area basis — per-room area values fed to calcAreaFlow
  console.log(JSON.stringify({
    event:        'airflow:area-basis',
    method,
    rateM3hPerM2: AREA_RATE[method] ?? 1.0,
    treatedAreaM2,
    areaFlowM3h,
    hasAreaData,
    areaWithCount,
    areaExpectedCount,
    rooms: rooms.filter(r =>
      !AREA_EXCLUDE_CLS.has(r.classification) &&
      !AREA_EXCLUDE_TYPES.has(r.room_type)
    ).map(r => ({ name: r.room_name ?? r.name, type: r.room_type, area: r.area ?? 0 })),
  }));

  // Diagnostic: area source — where the area data came from per room
  console.log(JSON.stringify({
    event: 'airflow:area-source',
    rooms: rooms.map(r => ({
      name:       r.room_name ?? r.name,
      floor:      r.floor,
      type:       r.room_type,
      cls:        r.classification,
      area:       r.area ?? 0,
      hasArea:    (r.area ?? 0) > 0,
      excluded:   AREA_EXCLUDE_CLS.has(r.classification) || AREA_EXCLUDE_TYPES.has(r.room_type),
    })),
  }));

  // 2. Room allocations (fixed rates, independent of design airflow)
  let roomResults = allocateRooms(rooms, rates);

  // Log raw allocation before balancing
  console.log(JSON.stringify({
    event: 'airflow:raw-rooms',
    roomCount: roomResults.length,
    rooms: roomResults.map(r => ({
      name:       r.room_name,
      floor:      r.floor,
      type:       r.room_type,
      driver:     r.airflow_driver,
      supplyM3h:  r.supply_m3h,
      extractM3h: r.extract_m3h,
    })),
  }));

  // 3. Balance supply vs extract
  const { roomResults: balanced, adjustmentM3h, balanceStatus } = balanceDesign(roomResults, rooms);

  // 4. Final totals — sum directly from room values (no lps round-trip)
  const totalSupplyM3h  = r1(balanced.reduce((s, r) => s + r.supply_m3h,  0));
  const totalExtractM3h = r1(balanced.reduce((s, r) => s + r.extract_m3h, 0));

  console.log(JSON.stringify({
    event: 'airflow:final-supply-total',  finalSupplyM3h:  totalSupplyM3h,
    event2: 'airflow:final-extract-total', finalExtractM3h: totalExtractM3h,
    diffM3h: r1(totalSupplyM3h - totalExtractM3h),
    balanceStatus, adjustmentM3h,
  }));

  return {
    // Design basis
    occupancyCount,
    occupancyFlowM3h,
    treatedAreaM2,
    areaFlowM3h,
    wetRoomFlowM3h,
    hasAreaData,
    areaWithCount,
    areaExpectedCount,
    designFlowM3h,
    designFlowLps:    toLps(designFlowM3h),
    designDriver,

    // Room totals
    totalSupplyM3h,
    totalExtractM3h,
    totalSupplyLps:   toLps(totalSupplyM3h),
    totalExtractLps:  toLps(totalExtractM3h),

    // Balancing
    adjustmentM3h,
    balanceStatus,

    roomResults: balanced,
  };
}

// ── MVHR unit matching ────────────────────────────────────────
//
// Preferred unit capacity = designFlow / (preferredLoadPct / 100).
// e.g. design = 180 m³/h, preferred load = 60% → preferred capacity = 300 m³/h.
//
// Scoring:
//   - Best when actual operating % is within ±10% of preferred load.
//   - Marginal if more than ±20% away.
//   - Penalise if actual op% > 85% (undersized) or < 35% (grossly oversized).
//   - PHI certification bonus.
//   - High HR efficiency bonus, low SFP bonus.
//
async function matchMvhrUnits(supabase, designM3h, preferredLoadPct = 60, userId = null) {
  const preferredCapacityM3h = designM3h / (preferredLoadPct / 100);

  // If user has a library, fetch their preferred unit IDs first
  let libraryUnitIds = null;
  if (userId) {
    const { data: libRows } = await supabase
      .from('user_unit_library')
      .select('unit_id')
      .eq('user_id', userId);
    if (libRows?.length) {
      libraryUnitIds = libRows.map(r => r.unit_id);
    }
  }

  // Build query — filter to library units when available
  let query = supabase
    .from('mvhr_units')
    .select('id, manufacturer, model, hr_eff, sfp, flow_min, flow_max, frost_protection, phi_cert_id, user_id')
    .gte('flow_max', designM3h)
    .order('hr_eff', { ascending: false });

  if (libraryUnitIds) {
    query = query.in('id', libraryUnitIds);
  } else {
    // Standard units only (no user_id) when no library
    query = query.is('user_id', null);
  }

  const { data: units, error } = await query;

  if (error || !units?.length) return [];

  const scored = units.map(u => {
    const phiCertified     = !!u.phi_cert_id;
    // Actual operating percentage at design airflow
    const actualOpPct      = Math.round((designM3h / u.flow_max) * 100);
    const deltaFromPref    = Math.abs(actualOpPct - preferredLoadPct);

    // Load score: best within ±10%, degrading beyond ±20%, penalise extremes
    let loadScore;
    if (actualOpPct > 85)       loadScore = -500;   // too hard — risk of noise/wear
    else if (actualOpPct < 35)  loadScore = -300;   // way oversized
    else if (deltaFromPref <= 10) loadScore = 1000; // sweet spot
    else if (deltaFromPref <= 20) loadScore = 500;  // marginal
    else                         loadScore = 100;   // outside preference

    const phiScore  = phiCertified ? 500 : 0;
    const effScore  = (u.hr_eff || 0) * 10;
    const sfpScore  = -(u.sfp || 1.0) * 50; // lower SFP is better

    const score = loadScore + phiScore + effScore + sfpScore;

    // Load rating for display
    const loadRating = actualOpPct > 85  ? 'too_high'
      : actualOpPct < 35                 ? 'too_low'
      : deltaFromPref <= 10              ? 'ideal'
      : deltaFromPref <= 20              ? 'marginal'
      :                                    'outside_preference';

    return {
      ...u,
      phiCertified,
      is_custom:                 u.user_id !== null,
      actual_operating_pct:      actualOpPct,
      preferred_load_pct:        preferredLoadPct,
      preferred_capacity_m3h:    Math.round(preferredCapacityM3h),
      load_rating:               loadRating,
      score,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  // When showing library units show all of them (user curated); otherwise top 8
  return libraryUnitIds ? scored : scored.slice(0, 8);
}

// ── Enrich helpers ────────────────────────────────────────────
function enrichDesign(dbRow, calc) {
  // Prefer calc values (exact, no lps round-trip) over DB lps → m³/h conversion.
  // On GET path calc is null, so fall back to lps conversion.
  const totalSupplyM3h  = calc?.totalSupplyM3h  ?? toM3h(dbRow.total_supply_lps);
  const totalExtractM3h = calc?.totalExtractM3h ?? toM3h(dbRow.total_extract_lps);
  const adjM3h          = calc?.adjustmentM3h   ?? toM3h(dbRow.balance_adjustment_lps ?? 0);
  return {
    ...dbRow,
    total_supply_m3h:       totalSupplyM3h,
    total_extract_m3h:      totalExtractM3h,
    balance_adjustment_m3h: adjM3h,
    // design basis (stored directly or passed from calc)
    occupancy_flow_m3h:  dbRow.occupancy_flow_m3h  ?? calc?.occupancyFlowM3h,
    area_flow_m3h:       dbRow.area_flow_m3h        ?? calc?.areaFlowM3h,
    wet_room_flow_m3h:   dbRow.wet_room_flow_m3h    ?? calc?.wetRoomFlowM3h,
    occupancy_count:     dbRow.occupancy_count      ?? calc?.occupancyCount,
    treated_area_m2:     dbRow.treated_area_m2      ?? calc?.treatedAreaM2,
    area_data_available:  dbRow.area_data_available  ?? calc?.hasAreaData ?? false,
    area_with_count:      calc?.areaWithCount      ?? null,
    area_expected_count:  calc?.areaExpectedCount  ?? null,
    design_driver:        calc?.designDriver ?? null,
  };
}

function enrichRooms(rows) {
  return rows.map(r => ({
    ...r,
    supply_m3h:  toM3h(r.supply_lps),
    extract_m3h: toM3h(r.extract_lps),
  }));
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

  // ── GET — load saved design ──────────────────────────────────
  if (req.method === 'GET') {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'projectId required' });

    const { data: design, error: dErr } = await supabase
      .from('airflow_designs')
      .select('*')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dErr) return res.status(500).json({ error: dErr.message });
    if (!design) return res.status(200).json({ design: null, rooms: [], units: [] });

    const { data: rooms, error: rErr } = await supabase
      .from('airflow_rooms')
      .select('*')
      .eq('airflow_design_id', design.id)
      .order('sort_order', { ascending: true });

    if (rErr) return res.status(500).json({ error: rErr.message });

    // Load preferred load for unit scoring on GET path too
    let getPreferredLoadPct = 60;
    {
      const { data: settings } = await supabase
        .from('user_settings')
        .select('preferred_unit_load_percent')
        .eq('user_id', user.id)
        .maybeSingle();
      if (settings?.preferred_unit_load_percent) getPreferredLoadPct = settings.preferred_unit_load_percent;
    }
    const units = await matchMvhrUnits(supabase, design.design_airflow_m3h, getPreferredLoadPct, user.id);
    return res.status(200).json({
      design: {
        ...enrichDesign(design, null),
        preferred_load_pct:     getPreferredLoadPct,
        preferred_capacity_m3h: Math.round(design.design_airflow_m3h / (getPreferredLoadPct / 100)),
        selected_unit_id:       design.selected_unit_id ?? null,
      },
      rooms:  enrichRooms(rooms ?? []),
      units,
    });
  }

  // ── POST / PATCH — calculate + persist ───────────────────────
  if (req.method === 'POST' || req.method === 'PATCH') {
    const body         = req.body ?? {};
    const projectId    = body.projectId;
    const designMethod = body.designMethod ?? 'passive_house';

    if (!projectId) return res.status(400).json({ error: 'projectId required' });

    // ── Shortcut: unit selection only (no recalculation) ─────────
    if ('selectedUnitId' in body) {
      const unitId = body.selectedUnitId ?? null;

      // Find existing design
      const { data: existing } = await supabase
        .from('airflow_designs')
        .select('id, design_airflow_m3h')
        .eq('project_id', projectId)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!existing) return res.status(404).json({ error: 'No airflow design found — calculate airflow first' });

      const { data: updated, error: updErr } = await supabase
        .from('airflow_designs')
        .update({ selected_unit_id: unitId })
        .eq('id', existing.id)
        .eq('user_id', user.id)
        .select()
        .single();

      if (updErr) return res.status(500).json({ error: updErr.message });

      return res.status(200).json({
        ok:     true,
        design: { ...enrichDesign(updated, null), selected_unit_id: unitId },
      });
    }

    if (!['passive_house','as1668'].includes(designMethod)) {
      return res.status(400).json({ error: 'designMethod must be passive_house or as1668' });
    }

    // Load confirmed rooms
    const { data: rooms, error: roomsErr } = await supabase
      .from('project_rooms')
      .select('*')
      .eq('project_id', projectId)
      .eq('is_confirmed', true)
      .order('sort_order', { ascending: true });

    if (roomsErr) return res.status(500).json({ error: roomsErr.message });
    if (!rooms?.length) {
      return res.status(422).json({
        error: 'No confirmed rooms found. Confirm the room schedule in Stage 2 first.',
      });
    }

    // Load user settings for room rates + preferred unit load
    let userRates       = DEFAULT_ROOM_RATES;
    let preferredLoadPct = 60;
    {
      const { data: settings } = await supabase
        .from('user_settings')
        .select('room_airflow_defaults, preferred_unit_load_percent')
        .eq('user_id', user.id)
        .maybeSingle();
      if (settings) {
        if (settings.room_airflow_defaults) userRates = { ...DEFAULT_ROOM_RATES, ...settings.room_airflow_defaults };
        if (settings.preferred_unit_load_percent) preferredLoadPct = settings.preferred_unit_load_percent;
      }
    }

    // Calculate
    const calc = calculateAirflow(rooms, designMethod, userRates);

    // Delete previous designs for this project
    await supabase
      .from('airflow_designs')
      .delete()
      .eq('project_id', projectId)
      .eq('user_id', user.id);

    // Insert new design
    const { data: design, error: insErr } = await supabase
      .from('airflow_designs')
      .insert({
        project_id:             projectId,
        user_id:                user.id,
        design_method:          designMethod,
        // Whole-house design basis
        occupancy_count:        calc.occupancyCount,
        treated_area_m2:        calc.treatedAreaM2 || null,
        occupancy_flow_m3h:     calc.occupancyFlowM3h,
        area_flow_m3h:          calc.hasAreaData ? calc.areaFlowM3h : null,
        wet_room_flow_m3h:      calc.wetRoomFlowM3h,
        area_data_available:    calc.hasAreaData,
        // Design airflow (the headline number)
        design_airflow_m3h:     calc.designFlowM3h,
        design_airflow_lps:     calc.designFlowLps,
        // Room totals (after balancing)
        total_supply_lps:       calc.totalSupplyLps,
        total_extract_lps:      calc.totalExtractLps,
        balance_adjustment_lps: toLps(calc.adjustmentM3h),
        balance_status:         calc.balanceStatus,
      })
      .select()
      .single();

    if (insErr) return res.status(500).json({ error: insErr.message });

    // Insert room rows
    const roomRows = calc.roomResults.map(r => ({
      airflow_design_id: design.id,
      project_room_id:   r.project_room_id,
      room_name:         r.room_name,
      room_type:         r.room_type,
      floor:             r.floor,
      supply_lps:        r.supply_lps,
      extract_lps:       r.extract_lps,
      airflow_driver:    r.airflow_driver,
      notes:             r.notes ?? null,
      sort_order:        r.sort_order,
    }));

    const { data: savedRooms, error: roomInsErr } = await supabase
      .from('airflow_rooms')
      .insert(roomRows)
      .select();

    if (roomInsErr) return res.status(500).json({ error: roomInsErr.message });

    const units = await matchMvhrUnits(supabase, calc.designFlowM3h, preferredLoadPct, user.id);

    return res.status(200).json({
      ok:     true,
      design: {
        ...enrichDesign(design, calc),
        preferred_load_pct:       preferredLoadPct,
        preferred_capacity_m3h:   Math.round(calc.designFlowM3h / (preferredLoadPct / 100)),
        selected_unit_id:         design.selected_unit_id ?? null,
      },
      rooms:  enrichRooms(savedRooms ?? []),
      units,
      // Diagnostic: area warning flag
      areaWarning: !calc.hasAreaData,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
