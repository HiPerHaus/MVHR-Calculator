// lib/buildingModelStatus.js
//
// F3A — pure status lifecycle for the Digital Building Model.
// No I/O: maps a requested action + current status → the next status, or an error.
//
// Lifecycle:
//   draft ──review──▶ needs_review ──approve──▶ approved ──supersede──▶ superseded
//     └────────────────approve───────────────────▶ approved
//   (a draft or needs_review can also be discarded via supersede)
//
// MVHR consumption (when gated) reads the latest `approved` model; editing
// plans/rooms/volume produces a new `draft`, so MVHR never changes silently —
// it requires an explicit approve.

export const STATUSES = ['draft', 'needs_review', 'approved', 'superseded'];
export const ACTIONS  = ['review', 'approve', 'supersede'];

/**
 * @param {'review'|'approve'|'supersede'} action
 * @param {'draft'|'needs_review'|'approved'|'superseded'} current
 * @returns {{ ok: true, status: string } | { ok: false, error: string }}
 */
export function nextStatus(action, current) {
  if (!ACTIONS.includes(action)) {
    return { ok: false, error: `Unknown action: ${action}` };
  }
  if (!STATUSES.includes(current)) {
    return { ok: false, error: `Unknown current status: ${current}` };
  }
  if (current === 'superseded') {
    return { ok: false, error: 'Model is superseded; generate/refresh a new model to continue.' };
  }

  switch (action) {
    case 'review':
      // draft or needs_review → needs_review (idempotent re-review allowed)
      if (current === 'approved') return { ok: false, error: 'Cannot send an approved model to review; unlock it first.' };
      return { ok: true, status: 'needs_review' };

    case 'approve':
      if (current === 'approved') return { ok: false, error: 'Model is already approved.' };
      return { ok: true, status: 'approved' };

    case 'supersede':
      // approved → superseded (unlock); draft/needs_review → superseded (discard)
      return { ok: true, status: 'superseded' };

    default:
      return { ok: false, error: `Unhandled action: ${action}` };
  }
}
