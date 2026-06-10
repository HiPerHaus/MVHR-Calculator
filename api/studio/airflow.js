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

// Detect WC / toilet / powder room (any room a person uses for toilet purposes).
// Checked BEFORE isEnsuite so "powder room" and "toilet" get WC rate, not bathroom rate.
const isWC      = n => /\bwc\b|water\s*closet|\btoilet\b|\bpowder\b/i.test(n ?? '');
const isEnsuite = n => /ensuite|en-suite|en\s+suite/i.test(n ?? '');

// Per-m² airflow rates per design method (m³/h per m² of treated floor area).
// Passive House design guide: 1 m³/h per m² (equivalent to ~0.30 ACH at 2.4m ceiling).
// AS1668 / NCC: 1.5 m³/h per m² (higher ventilation requirement).
const AREA_RATE = { passive_house: 1.0, as1668: 1.5 };

// ── Default room airflow rates (m³/h) ─────────────────────────
// These are NORMAL / CONTINUOUS design rates (not peak/boost).
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
  pantry_extract_m3h:       20,
  bathroom_extract_m3h:     30,  // Normal continuous rate (boost = 40)
  ensuite_extract_m3h:      30,
  laundry_extract_m3h:      25,  // Normal continuous rate (boost = 40)
  wc_extract_m3h:           20,
};

// Minimum extract airflow per room type (m³/h) — never reduce below these during balancing.
// Based on PHI Good Practice Guide minimum ventilation requirements.
const EXTRACT_MINIMUMS = {
  kitchen:  30,
  pantry:   15,
  laundry:  15,
  bathroom: 20,
  ensuite:  20,
  wc:       10,
};

// Boost / peak extract rates (m³/h) — PHI Good Practice Guide peak demand.
// Used only for the boost capacity check; NOT used to drive continuous design airflow.
const BOOST_EXTRACT_RATES = {
  kitchen:  60,
  bathroom: 40,
  ensuite:  40,
  laundry:  40,
  wc:       20,
  pantry:   20,
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

// Combined Butler's Pantry / Laundry — detected by room_type OR name pattern.
// Airflow: continuous = laundry rate (25 m³/h), boost = laundry rate (40 m³/h).
// Must be checked before the individual pantry and laundry rules.
const PANTRY_LAUNDRY_RT = 'Pantry/Laundry';
const PANTRY_LAUNDRY_RE = /\b(b['']?pty|butler['']?s?\s+pantry|pantry)\s*[/&]\s*(ldy|laundry)\b|\b(ldy|laundry)\s*[/&]\s*(b['']?pty|butler['']?s?\s+pantry|pantry)\b/i;
function isPantryLaundry(room, n) {
  return room.room_type === PANTRY_LAUNDRY_RT || PANTRY_LAUNDRY_RE.test(n);
}

// ── Extract rate lookup ───────────────────────────────────────
// Design extract rates (m³/h). Accepts user-customised rates object.
function extractRate(room, rates = DEFAULT_ROOM_RATES) {
  const t = room.room_type;
  const n = room.name ?? '';
  // Combined pantry/laundry uses laundry rate (higher of the two continuous rates)
  if (isPantryLaundry(room, n)) return rates.laundry_extract_m3h;
  // Pantry first — checked before kitchen so a room named "Pantry" gets pantry rate
  if (/pantry/i.test(n)) return rates.pantry_extract_m3h ?? 20;
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

// ── Extract room classification helpers ───────────────────────
// All extract rooms can be reduced during balancing, but never below their EXTRACT_MINIMUMS.
// Priority: WC/Powder(1) → Bathroom+Ensuite(2, same tier) → Laundry(3) → Pantry(4) → Kitchen(5).
// Rooms sharing the same priority tier are reduced PROPORTIONALLY, not sequentially,
// so bath and ensuite shrink together rather than one being exhausted first.
function extractReducePriority(room, n) {
  const t = room.room_type;
  if (t === 'wet_area') {
    if (isWC(n)) return 1;  // WC / powder / toilet — reduce first
    return 2;                // Bathroom AND ensuite share tier 2 → proportional reduction
  }
  if (isPantryLaundry(room, n)) return 3; // same priority as laundry
  if (t === 'laundry') return 3;
  if (/pantry/i.test(n)) return 4;
  if (t === 'kitchen' || t === 'kitchenette') return 5; // last resort — never to zero
  return 0;
}

// Minimum extract airflow for a room (m³/h) — enforced during balancing.
function extractMin(room, n) {
  const t = room.room_type;
  if (isPantryLaundry(room, n)) return EXTRACT_MINIMUMS.laundry;
  if (/pantry/i.test(n)) return EXTRACT_MINIMUMS.pantry;
  if (t === 'kitchen' || t === 'kitchenette') return EXTRACT_MINIMUMS.kitchen;
  if (t === 'laundry') return EXTRACT_MINIMUMS.laundry;
  if (t === 'wet_area') {
    if (isWC(n))      return EXTRACT_MINIMUMS.wc;
    if (isEnsuite(n)) return EXTRACT_MINIMUMS.ensuite;
    return EXTRACT_MINIMUMS.bathroom;
  }
  return 0;
}

// Boost extract rate for a room (m³/h) — PHI peak demand, used for boost capacity check only.
function boostExtractRate(room, n) {
  const t = room.room_type;
  if (isPantryLaundry(room, n)) return BOOST_EXTRACT_RATES.laundry; // 40 m³/h
  if (/pantry/i.test(n)) return BOOST_EXTRACT_RATES.pantry;
  if (t === 'kitchen' || t === 'kitchenette') return BOOST_EXTRACT_RATES.kitchen;
  if (t === 'laundry')  return BOOST_EXTRACT_RATES.laundry;
  if (t === 'wet_area') {
    if (isWC(n))      return BOOST_EXTRACT_RATES.wc;
    if (isEnsuite(n)) return BOOST_EXTRACT_RATES.ensuite;
    return BOOST_EXTRACT_RATES.bathroom;
  }
  return 0;
}

// ── Supply room classification helpers ────────────────────────
// Adjustable supply rooms absorb remaining design-flow capacity after fixed rooms.
// Priority: Living(1) > Family(2) > Dining(3) > Rumpus(4) > Retreat(5) > Other living(6)
function supplyAdjPriority(srcRoom) {
  const t = srcRoom.room_type;
  const n = srcRoom.name ?? '';
  if (t === 'living') {
    if (/family/i.test(n))  return 2;
    if (/dining/i.test(n))  return 3;
    if (/rumpus/i.test(n))  return 4;
    if (/retreat/i.test(n)) return 5;
    if (/media|games|lounge|second|2nd/i.test(n)) return 6;
    return 1; // main living — highest priority
  }
  if (t === 'dining') return 3;
  return 0; // fixed supply (bedroom, office, gym, etc.)
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
 * Boost airflow = sum of ALL extract rooms at PEAK / BOOST rates (PHI Good Practice Guide).
 * Used as a separate "Boost Capacity Check" value — NOT used to drive continuous design airflow.
 */
function calcBoostFlow(rooms) {
  let total = 0;
  for (const r of rooms) {
    if (r.classification === 'ignore') continue;
    const n = r.name ?? '';
    total += boostExtractRate(r, n);
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
      const bRate = boostExtractRate(room, n);
      let driver = `${t}`;
      if (t === 'wet_area') {
        driver = isWC(n) ? `wc_${rates.wc_extract_m3h}` : isEnsuite(n) ? `ensuite_${rates.ensuite_extract_m3h}` : `bathroom_${rates.bathroom_extract_m3h}`;
      }
      return mkRoom(room, 0, eRate, driver, null, bRate);
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

function mkRoom(room, supplyM3h, extractM3h, driver, notes = null, boostExtractM3h = 0) {
  return {
    project_room_id:   room.id,
    room_name:         room.name,
    room_type:         room.room_type,
    floor:             room.floor ?? null,
    sort_order:        room.sort_order ?? 0,
    supply_m3h:        supplyM3h,
    extract_m3h:       extractM3h,
    boost_extract_m3h: boostExtractM3h,
    supply_lps:        toLps(supplyM3h),
    extract_lps:       toLps(extractM3h),
    airflow_driver:    driver,
    notes,
  };
}

// ── Balance logic ─────────────────────────────────────────────
//
// SUPPLY: Fixed rooms (bedrooms, offices, gym) remain unchanged.
//   Adjustable: living, family, dining, rumpus, retreat.
//   These absorb remaining capacity. Priority: Living(1) > Family(2) > Dining(3) > …
//
// EXTRACT: ALL extract rooms can be reduced, but never below EXTRACT_MINIMUMS.
//   Priority: WC/Powder(1) → Bathroom(2) → Ensuite(3) → Laundry(4) → Pantry(5) → Kitchen(6).
//   If extract cannot be fully reduced to design flow (minimums prevent it),
//   supply is increased to match the remaining extract — preferred over over-reducing.
//
// Balance status is relative to designFlowM3h.
//
function balanceDesign(roomResults, rooms, designFlowM3h) {
  const sumKey = (key) => r1(roomResults.reduce((s, r) => s + (r[key] || 0), 0));

  console.log(JSON.stringify({
    event: 'airflow:balance-start',
    designFlowM3h,
    baseSupplyM3h:  sumKey('supply_m3h'),
    baseExtractM3h: sumKey('extract_m3h'),
  }));

  // ─── STEP 1: SUPPLY BALANCING ─────────────────────────────
  // Adjust supply rooms so total supply ≈ designFlowM3h.
  let totalSupplyAdj = 0;
  let supplyDiff = r1(designFlowM3h - sumKey('supply_m3h')); // positive = need more supply

  if (Math.abs(supplyDiff) > 0.5) {
    const adjSupply = roomResults
      .map((r, i) => ({ r, i, priority: supplyAdjPriority(rooms[i]) }))
      .filter(x => x.priority > 0 && (supplyDiff > 0 || x.r.supply_m3h > 0))
      .sort((a, b) => a.priority - b.priority);

    for (const { r, i } of adjSupply) {
      if (Math.abs(supplyDiff) < 0.5) break;
      const srcRoom = rooms[i];
      const t = srcRoom.room_type;

      if (supplyDiff > 0) {
        const maxRate = t === 'living' ? 80 : 50;
        const canAdd  = maxRate - r.supply_m3h;
        if (canAdd < 0.5) continue;
        const add = r1(Math.min(supplyDiff, canAdd));
        roomResults[i] = {
          ...r, supply_m3h: r1(r.supply_m3h + add), supply_lps: toLps(r1(r.supply_m3h + add)),
          notes: (r.notes ? r.notes + '; ' : '') + `Balancing adjustment: +${add} m³/h`,
          airflow_driver: r.airflow_driver === 'unclassified' ? 'supply_balance' : r.airflow_driver,
        };
        supplyDiff     = r1(supplyDiff - add);
        totalSupplyAdj = r1(totalSupplyAdj + add);
      } else {
        const canRemove = r.supply_m3h;
        if (canRemove < 0.5) continue;
        const remove = r1(Math.min(-supplyDiff, canRemove));
        roomResults[i] = {
          ...r, supply_m3h: r1(r.supply_m3h - remove), supply_lps: toLps(r1(r.supply_m3h - remove)),
          notes: (r.notes ? r.notes + '; ' : '') + `Balancing adjustment: -${remove} m³/h`,
        };
        supplyDiff     = r1(supplyDiff + remove);
        totalSupplyAdj = r1(totalSupplyAdj - remove);
      }
    }
  }

  // ─── STEP 2: EXTRACT BALANCING ────────────────────────────
  // Reduce extract rooms tier by tier (WC→Kitchen), respecting EXTRACT_MINIMUMS.
  // Within each priority tier, reduction is spread PROPORTIONALLY across all rooms
  // in that tier so no single room is disproportionately penalised.
  let extractExcess = r1(sumKey('extract_m3h') - designFlowM3h);

  if (extractExcess > 0.5) {
    // Build candidate list with priority + minimum headroom
    const adjExtract = roomResults
      .map((r, i) => {
        const n   = rooms[i].name ?? '';
        const p   = extractReducePriority(rooms[i], n);
        const min = extractMin(rooms[i], n);
        return { r, i, priority: p, min };
      })
      .filter(x => x.priority > 0 && x.r.extract_m3h > x.min);

    // Group by priority tier and process tier by tier (lowest priority number first)
    const tiers = [...new Set(adjExtract.map(x => x.priority))].sort((a, b) => a - b);

    for (const tier of tiers) {
      if (extractExcess < 0.5) break;
      const group = adjExtract.filter(x => x.priority === tier);

      // Total headroom available in this tier
      const tierHeadroom = r1(group.reduce((s, x) => s + r1(roomResults[x.i].extract_m3h - x.min), 0));
      if (tierHeadroom < 0.5) continue;

      // Take the minimum of what we need and what this tier can give
      const removeFromTier = r1(Math.min(extractExcess, tierHeadroom));

      // Distribute proportionally — each room's share = its headroom / tier headroom
      for (const { i, min } of group) {
        const currentExtract = roomResults[i].extract_m3h;
        const headroom       = r1(currentExtract - min);
        if (headroom < 0.5) continue;
        const share = r1(removeFromTier * (headroom / tierHeadroom));
        if (share < 0.5) continue;
        const newExtract = r1(currentExtract - share);
        roomResults[i] = {
          ...roomResults[i],
          extract_m3h: newExtract,
          extract_lps: toLps(newExtract),
          notes: (roomResults[i].notes ? roomResults[i].notes + '; ' : '') + `Balancing adjustment: -${share} m³/h`,
        };
      }
      extractExcess = r1(extractExcess - removeFromTier);
    }

    // ─── STEP 3: SUPPLY TOP-UP ────────────────────────────────
    // If extract minimums prevent full reduction, increase supply to match remaining extract
    // rather than forcing extract below its minimum.
    if (extractExcess > 0.5) {
      const adjSupplyTopUp = roomResults
        .map((r, i) => ({ r, i, priority: supplyAdjPriority(rooms[i]) }))
        .filter(x => x.priority > 0)
        .sort((a, b) => a.priority - b.priority);

      for (const { r, i } of adjSupplyTopUp) {
        if (extractExcess < 0.5) break;
        const srcRoom = rooms[i];
        const maxRate = srcRoom.room_type === 'living' ? 80 : 50;
        const canAdd  = maxRate - r.supply_m3h;
        if (canAdd < 0.5) continue;
        const add = r1(Math.min(extractExcess, canAdd));
        roomResults[i] = {
          ...r, supply_m3h: r1(r.supply_m3h + add), supply_lps: toLps(r1(r.supply_m3h + add)),
          notes: (r.notes ? r.notes + '; ' : '') + `Balancing adjustment: +${add} m³/h (supply top-up)`,
          airflow_driver: r.airflow_driver === 'unclassified' ? 'supply_balance' : r.airflow_driver,
        };
        extractExcess  = r1(extractExcess - add);
        totalSupplyAdj = r1(totalSupplyAdj + add);
      }
    }
  }

  // ─── FINAL STATUS ─────────────────────────────────────────
  const finalSupply      = sumKey('supply_m3h');
  const finalExtract     = sumKey('extract_m3h');
  const supplyDeviation  = Math.abs(finalSupply  - designFlowM3h);
  const extractDeviation = Math.abs(finalExtract - designFlowM3h);
  const maxDeviation     = Math.max(supplyDeviation, extractDeviation);
  const ratio            = designFlowM3h > 0 ? maxDeviation / designFlowM3h : 0;

  console.log(JSON.stringify({
    event: 'airflow:balance-result',
    designFlowM3h,
    finalSupplyM3h:  finalSupply,
    finalExtractM3h: finalExtract,
    supplyDevM3h:    r1(supplyDeviation),
    extractDevM3h:   r1(extractDeviation),
    maxDeviationPct: r1(ratio * 100),
  }));

  const balanceStatus = ratio <= 0.05
    ? 'balanced'
    : ratio <= 0.10
      ? 'minor_adjustment'
      : 'manual_review';

  return { roomResults, adjustmentM3h: totalSupplyAdj, balanceStatus };
}

// ── Main calculation ──────────────────────────────────────────
function calculateAirflow(rooms, method, userRates = DEFAULT_ROOM_RATES) {
  const rates = { ...DEFAULT_ROOM_RATES, ...userRates };

  // 1. Whole-house design basis
  const { occupancyCount, occupancyFlowM3h } = calcOccupancyFlow(rooms);
  const { treatedAreaM2, areaFlowM3h, hasAreaData, areaWithCount, areaExpectedCount } = calcAreaFlow(rooms, method);

  // Boost airflow = sum of all extract rooms at PEAK/BOOST rates (NOT continuous design basis)
  const boostFlowM3h = calcBoostFlow(rooms);

  // Continuous Design Airflow = MAX(occupancy, area) only.
  // Wet-room extract is NOT used to size the continuous design airflow — it is a boost check.
  const candidateFlows = [occupancyFlowM3h];
  if (hasAreaData) candidateFlows.push(areaFlowM3h);
  const designFlowM3h = r0(Math.max(...candidateFlows));
  const designDriver  = (hasAreaData && areaFlowM3h >= occupancyFlowM3h) ? 'area' : 'occupancy';

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

  // 3. Balance both sides to design airflow target
  const { roomResults: balanced, adjustmentM3h, balanceStatus } = balanceDesign(roomResults, rooms, designFlowM3h);

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
    boostFlowM3h,          // peak extract demand (boost mode)
    wetRoomFlowM3h: boostFlowM3h, // alias for DB compat
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
async function matchMvhrUnits(supabase, designM3h, preferredLoadPct = 60, userId = null, boostM3h = 0) {
  const preferredCapacityM3h = designM3h / (preferredLoadPct / 100);
  // Unit must handle at least the continuous design flow.
  // Boost flow is a separate capacity check surfaced in scoring/display.
  const minimumCapacity = designM3h;

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
    .gte('flow_max', minimumCapacity)
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

    const phiScore   = phiCertified ? 500 : 0;
    const effScore   = (u.hr_eff || 0) * 10;
    const sfpScore   = -(u.sfp || 1.0) * 50; // lower SFP is better
    // Bonus if unit can also handle boost airflow (handles wet-room peak demand)
    const boostCapable  = boostM3h > 0 && u.flow_max >= boostM3h;
    const boostScore    = boostCapable ? 200 : 0;

    const score = loadScore + phiScore + effScore + sfpScore + boostScore;

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
      boost_capable:             boostCapable,
      boost_required_m3h:        boostM3h || null,
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
    const units = await matchMvhrUnits(supabase, design.design_airflow_m3h, getPreferredLoadPct, user.id, design.wet_room_flow_m3h ?? 0);
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

    // ── Delete previous designs ────────────────────────────────
    // Step 1: find existing design ids
    const { data: existingDesigns } = await supabase
      .from('airflow_designs')
      .select('id')
      .eq('project_id', projectId)
      .eq('user_id', user.id);

    // Step 2: explicitly delete/null all child references first
    // Do not rely on FK cascade behaviour here.
    if (existingDesigns?.length) {
      const existingIds = existingDesigns.map(d => d.id);

      const { error: delRoomsErr } = await supabase
        .from('airflow_rooms')
        .delete()
        .in('airflow_design_id', existingIds);
      if (delRoomsErr) return res.status(500).json({ error: `Failed to clear old airflow rooms: ${delRoomsErr.message}` });

      const { error: nullDuctErr } = await supabase
        .from('duct_designs')
        .update({ airflow_design_id: null })
        .in('airflow_design_id', existingIds);
      if (nullDuctErr) return res.status(500).json({ error: `Failed to detach duct designs: ${nullDuctErr.message}` });
    }

    // Step 3: delete old designs after child rows have been cleared
    const { error: delErr } = await supabase
      .from('airflow_designs')
      .delete()
      .eq('project_id', projectId)
      .eq('user_id', user.id);
    if (delErr) return res.status(500).json({ error: `Failed to clear previous design: ${delErr.message}` });

    // ── Insert new design ──────────────────────────────────────
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
    if (!design?.id) return res.status(500).json({ error: 'Failed to create airflow design: no design.id returned' });

    const { data: designCheck, error: designCheckErr } = await supabase
      .from('airflow_designs')
      .select('id')
      .eq('id', design.id)
      .maybeSingle();

    if (designCheckErr || !designCheck) {
      return res.status(500).json({
        error: `Airflow design insert did not persist before room insert. designId=${design.id}`
      });
    }

    // Insert room rows
    const roomRows = calc.roomResults.map(r => ({
      airflow_design_id: design.id,
      project_room_id:   r.project_room_id,
      room_name:         r.room_name,
      room_type:         r.room_type,
      floor:             r.floor,
      supply_lps:        r.supply_lps,
      extract_lps:       r.extract_lps,
      boost_extract_m3h: r.boost_extract_m3h ?? 0,  // 0 for ignored/transfer rooms
      airflow_driver:    r.airflow_driver,
      notes:             r.notes ?? null,
      sort_order:        r.sort_order,
    }));

    const { data: savedRooms, error: roomInsErr } = await supabase
      .from('airflow_rooms')
      .insert(roomRows)
      .select();

    if (roomInsErr) return res.status(500).json({ error: `Failed to insert airflow rooms for design ${design.id}: ${roomInsErr.message}` });

    const units = await matchMvhrUnits(supabase, calc.designFlowM3h, preferredLoadPct, user.id, calc.boostFlowM3h);

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
