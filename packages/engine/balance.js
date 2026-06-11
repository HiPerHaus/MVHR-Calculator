// @ts-check
// ============================================================
// HiPer Engine — Supply/extract balancing
//
// SUPPLY: Fixed rooms (bedrooms, offices, gym) remain unchanged.
//   Adjustable rooms (living, family, dining, rumpus, retreat) absorb
//   remaining capacity, highest-priority first.
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
import { supplyAdjPriority } from './supply.js';

/**
 * Balance supply and extract sides to the whole-house design flow target.
 *
 * @param {object[]} roomResults  — from allocateRooms()
 * @param {object[]} rooms        — original room rows (same order as roomResults)
 * @param {number}   designFlowM3h
 * @returns {{ roomResults: object[], adjustmentM3h: number, balanceStatus: string }}
 */
export function balanceDesign(roomResults, rooms, designFlowM3h) {
  const sumKey = (key) => r1(roomResults.reduce((s, r) => s + (r[key] || 0), 0));

  // ─── STEP 1: SUPPLY BALANCING ─────────────────────────────
  let totalSupplyAdj = 0;
  let supplyDiff     = r1(designFlowM3h - sumKey('supply_m3h'));

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
          ...r,
          supply_m3h:  r1(r.supply_m3h + add),
          supply_lps:  toLps(r1(r.supply_m3h + add)),
          notes:       appendNote(r.notes, `Balancing adjustment: +${add} m³/h`),
          airflow_driver: r.airflow_driver === 'unclassified' ? 'supply_balance' : r.airflow_driver,
        };
        supplyDiff     = r1(supplyDiff - add);
        totalSupplyAdj = r1(totalSupplyAdj + add);
      } else {
        const canRemove = r.supply_m3h;
        if (canRemove < 0.5) continue;
        const remove = r1(Math.min(-supplyDiff, canRemove));
        roomResults[i] = {
          ...r,
          supply_m3h: r1(r.supply_m3h - remove),
          supply_lps: toLps(r1(r.supply_m3h - remove)),
          notes:      appendNote(r.notes, `Balancing adjustment: -${remove} m³/h`),
        };
        supplyDiff     = r1(supplyDiff + remove);
        totalSupplyAdj = r1(totalSupplyAdj - remove);
      }
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
      const group = adjExtract.filter(x => x.priority === tier);
      const tierHeadroom = r1(group.reduce((s, x) => s + r1(roomResults[x.i].extract_m3h - x.min), 0));
      if (tierHeadroom < 0.5) continue;

      const removeFromTier = r1(Math.min(extractExcess, tierHeadroom));

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
          notes:       appendNote(roomResults[i].notes, `Balancing adjustment: -${share} m³/h`),
        };
      }
      extractExcess = r1(extractExcess - removeFromTier);
    }

    // ─── STEP 3: SUPPLY TOP-UP ────────────────────────────────
    if (extractExcess > 0.5) {
      const adjSupplyTopUp = roomResults
        .map((r, i) => ({ r, i, priority: supplyAdjPriority(rooms[i]) }))
        .filter(x => x.priority > 0)
        .sort((a, b) => a.priority - b.priority);

      for (const { r, i } of adjSupplyTopUp) {
        if (extractExcess < 0.5) break;
        const maxRate = rooms[i].room_type === 'living' ? 80 : 50;
        const canAdd  = maxRate - r.supply_m3h;
        if (canAdd < 0.5) continue;
        const add = r1(Math.min(extractExcess, canAdd));
        roomResults[i] = {
          ...r,
          supply_m3h: r1(r.supply_m3h + add),
          supply_lps: toLps(r1(r.supply_m3h + add)),
          notes:      appendNote(r.notes, `Balancing adjustment: +${add} m³/h (supply top-up)`),
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

  const balanceStatus = ratio <= 0.05
    ? 'balanced'
    : ratio <= 0.10
      ? 'minor_adjustment'
      : 'manual_review';

  return { roomResults, adjustmentM3h: totalSupplyAdj, balanceStatus };
}

/** @param {string|null} existing  @param {string} note  @returns {string} */
function appendNote(existing, note) {
  return existing ? `${existing}; ${note}` : note;
}
