// @ts-check
// ============================================================
// HiPer Engine — Supply/extract balancing
//
// SUPPLY: Fixed rooms (bedrooms, priority-0 types) remain unchanged.
//   Adjustable rooms absorb capacity proportionally using priority × headroom
//   weighting. Up to 5 redistribution passes handle rooms that hit their max.
//   If room limits prevent reaching design flow, status = 'additional_supply_required'.
//
// EXTRACT: All extract rooms can be reduced, but never below EXTRACT_MINIMUMS.
//   Priority tiers (lowest first): WC(1) → Bath+Ensuite(2, proportional) →
//   Laundry(3) → Pantry(4) → Kitchen(5).
//
// If extract cannot be fully reduced to design flow (minimums prevent it),
// supply is increased to match the remaining extract rather than violating minimums.
// ============================================================

import { r1, toLps } from './helpers.js';
import { extractReducePriority, extractMin } from './extract.js';
import { supplyBalanceProfile } from './supply.js';

/** @param {string|null} existing  @param {string} note  @returns {string} */
function appendNote(existing, note) {
  return existing ? `${existing}; ${note}` : note;
}

/**
 * Recommended terminal count for a supply room based on final airflow rate.
 * @param {number} supplyM3h
 * @returns {number|null}
 */
function recommendedTerminalCount(supplyM3h) {
  if (supplyM3h <= 0) return null;
  if (supplyM3h > 70) return 3;
  if (supplyM3h > 40) return 2;
  return 1;
}

/**
 * Distribute `amount` of additional supply proportionally across adjustable rooms
 * using priority × headroom weighting, with up to `maxIter` redistribution passes
 * to re-allocate shares from rooms that hit their per-room maximum.
 * Mutates roomResults in-place. Returns the amount actually distributed.
 *
 * @param {object[]} roomResults
 * @param {object[]} rooms
 * @param {number}   amount
 * @param {number}   [maxIter=5]
 * @returns {number}
 */
function proportionalAddSupply(roomResults, rooms, amount, maxIter = 5) {
  let remaining = amount;

  for (let iter = 0; iter < maxIter && remaining > 0.5; iter++) {
    // Recompute eligible rooms each iteration — previously-capped rooms drop out.
    const eligible = rooms
      .map((room, i) => {
        const profile  = supplyBalanceProfile(room);
        const headroom = r1(profile.max - roomResults[i].supply_m3h);
        return { i, profile, headroom };
      })
      .filter(x => x.profile.priority > 0 && x.headroom > 0.1);

    if (eligible.length === 0) break;

    const totalWeight = eligible.reduce((s, x) => s + x.profile.priority * x.headroom, 0);
    if (totalWeight < 0.01) break;

    let distributed = 0;

    for (const { i, profile, headroom } of eligible) {
      const weight     = profile.priority * headroom;
      const idealShare = r1(remaining * weight / totalWeight);
      const actualAdd  = r1(Math.min(idealShare, headroom));
      if (actualAdd < 0.1) continue;

      const prev      = roomResults[i];
      const newSupply = r1(prev.supply_m3h + actualAdd);
      roomResults[i] = {
        ...prev,
        supply_m3h:     newSupply,
        supply_lps:     toLps(newSupply),
        notes:          appendNote(prev.notes, `Balancing adjustment: +${actualAdd} m³/h`),
        airflow_driver: prev.airflow_driver === 'unclassified' ? 'supply_balance' : prev.airflow_driver,
      };
      distributed = r1(distributed + actualAdd);
    }

    remaining = r1(Math.max(0, remaining - distributed));
    if (distributed < 0.1) break; // no progress — all rooms at their maximum
  }

  return r1(amount - remaining);
}

/**
 * Remove `amount` of supply from adjustable rooms, lowest-priority first.
 * Mutates roomResults in-place. Returns the amount actually removed.
 *
 * @param {object[]} roomResults
 * @param {object[]} rooms
 * @param {number}   amount
 * @returns {number}
 */
function greedyReduceSupply(roomResults, rooms, amount) {
  let remaining = amount;

  const candidates = rooms
    .map((room, i) => ({ i, profile: supplyBalanceProfile(room) }))
    .filter(x => x.profile.priority > 0 && roomResults[x.i].supply_m3h > 0)
    .sort((a, b) => a.profile.priority - b.profile.priority); // lowest priority reduced first

  for (const { i } of candidates) {
    if (remaining < 0.5) break;
    const prev      = roomResults[i];
    const canRemove = prev.supply_m3h;
    if (canRemove < 0.5) continue;
    const remove    = r1(Math.min(remaining, canRemove));
    const newSupply = r1(prev.supply_m3h - remove);
    roomResults[i] = {
      ...prev,
      supply_m3h: newSupply,
      supply_lps: toLps(newSupply),
      notes:      appendNote(prev.notes, `Balancing adjustment: -${remove} m³/h`),
    };
    remaining = r1(remaining - remove);
  }

  return r1(amount - remaining);
}

/**
 * Balance supply and extract sides to the whole-house design flow target.
 *
 * @param {object[]} roomResults  — from allocateRooms()
 * @param {object[]} rooms        — original room rows (same order as roomResults)
 * @param {number}   designFlowM3h
 * @returns {{
 *   roomResults:                            object[],
 *   adjustmentM3h:                          number,
 *   balanceStatus:                          'balanced'|'minor_adjustment'|'additional_supply_required'|'manual_review',
 *   supplyDeficitM3h:                       number,
 *   recommendedRoomsForAdditionalTerminals: string[],
 * }}
 */
export function balanceDesign(roomResults, rooms, designFlowM3h) {
  // Work on shallow copies — callers must not see mutation.
  roomResults = roomResults.map(r => ({ ...r }));

  const sumKey = (key) => r1(roomResults.reduce((s, r) => s + (r[key] || 0), 0));

  let totalSupplyAdj = 0;

  // ─── STEP 1: SUPPLY BALANCING ─────────────────────────────
  const supplyDiff = r1(designFlowM3h - sumKey('supply_m3h'));

  if (Math.abs(supplyDiff) > 0.5) {
    if (supplyDiff > 0) {
      const added = proportionalAddSupply(roomResults, rooms, supplyDiff);
      totalSupplyAdj = r1(totalSupplyAdj + added);
    } else {
      const removed = greedyReduceSupply(roomResults, rooms, -supplyDiff);
      totalSupplyAdj = r1(totalSupplyAdj - removed);
    }
  }

  // ─── STEP 2: EXTRACT BALANCING ────────────────────────────
  let extractExcess = r1(sumKey('extract_m3h') - designFlowM3h);

  if (extractExcess > 0.5) {
    const adjExtract = roomResults
      .map((r, i) => {
        const n   = rooms[i].name ?? '';
        const p   = extractReducePriority(rooms[i], n);
        const min = extractMin(rooms[i], n);
        return { r, i, priority: p, min };
      })
      .filter(x => x.priority > 0 && x.r.extract_m3h > x.min);

    const tiers = [...new Set(adjExtract.map(x => x.priority))].sort((a, b) => a - b);

    for (const tier of tiers) {
      if (extractExcess < 0.5) break;
      const group        = adjExtract.filter(x => x.priority === tier);
      const tierHeadroom = r1(group.reduce((s, x) => s + r1(roomResults[x.i].extract_m3h - x.min), 0));
      if (tierHeadroom < 0.5) continue;

      const removeFromTier = r1(Math.min(extractExcess, tierHeadroom));

      for (const { i, min } of group) {
        const currentExtract = roomResults[i].extract_m3h;
        const headroom       = r1(currentExtract - min);
        if (headroom < 0.5) continue;
        const share      = r1(removeFromTier * (headroom / tierHeadroom));
        if (share < 0.5) continue;
        const newExtract = r1(currentExtract - share);
        roomResults[i] = {
          ...roomResults[i],
          extract_m3h: newExtract,
          extract_lps: toLps(newExtract),
          notes:       appendNote(roomResults[i].notes, `Balancing adjustment: -${share} m³/h`),
        };
      }
      extractExcess = r1(extractExcess - removeFromTier);
    }

    // ─── STEP 3: SUPPLY TOP-UP ────────────────────────────────
    // Extract minimums prevented full reduction — raise supply to compensate.
    if (extractExcess > 0.5) {
      const added = proportionalAddSupply(roomResults, rooms, extractExcess);
      totalSupplyAdj = r1(totalSupplyAdj + added);
    }
  }

  // ─── STEP 4: Stamp recommended_terminal_count ─────────────
  roomResults = roomResults.map(r => ({
    ...r,
    recommended_terminal_count: recommendedTerminalCount(r.supply_m3h),
  }));

  // ─── FINAL STATUS ─────────────────────────────────────────
  const finalSupply      = sumKey('supply_m3h');
  const finalExtract     = sumKey('extract_m3h');
  const supplyDeviation  = Math.abs(finalSupply  - designFlowM3h);
  const extractDeviation = Math.abs(finalExtract - designFlowM3h);
  const maxDeviation     = Math.max(supplyDeviation, extractDeviation);
  const ratio            = designFlowM3h > 0 ? maxDeviation / designFlowM3h : 0;

  // Supply deficit: how much more supply is needed that room limits prevented.
  const supplyDeficitM3h = r1(Math.max(0, designFlowM3h - finalSupply));

  // Rooms at their per-room maximum that could absorb more with additional terminals.
  const recommendedRoomsForAdditionalTerminals = supplyDeficitM3h > 0.5
    ? rooms
        .map((room, i) => {
          const profile = supplyBalanceProfile(room);
          return { name: room.name, profile, supply: roomResults[i].supply_m3h };
        })
        .filter(x => x.profile.priority > 0 && x.supply >= x.profile.max - 0.5)
        .sort((a, b) => b.profile.priority - a.profile.priority)
        .slice(0, 3)
        .map(x => x.name)
    : [];

  let balanceStatus;
  if (supplyDeficitM3h > 0.5) {
    balanceStatus = /** @type {'additional_supply_required'} */ ('additional_supply_required');
  } else if (ratio <= 0.05) {
    balanceStatus = /** @type {'balanced'} */ ('balanced');
  } else if (ratio <= 0.10) {
    balanceStatus = /** @type {'minor_adjustment'} */ ('minor_adjustment');
  } else {
    balanceStatus = /** @type {'manual_review'} */ ('manual_review');
  }

  return {
    roomResults,
    adjustmentM3h:   totalSupplyAdj,
    balanceStatus,
    supplyDeficitM3h,
    recommendedRoomsForAdditionalTerminals,
  };
}
