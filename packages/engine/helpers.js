// @ts-check
// ============================================================
// HiPer Engine — Pure helpers
// Rounding, unit conversion, and room-name pattern matchers.
// ============================================================

/** Round to nearest integer. */
export const r0 = (v) => Math.round(v);
/** Round to 1 decimal place. */
export const r1 = (v) => Math.round(v * 10) / 10;
/** Round to 2 decimal places. */
export const r2 = (v) => Math.round(v * 100) / 100;
/** m³/h → l/s (rounded to 1 dp). */
export const toLps = (m3h) => r1(m3h / 3.6);
/** l/s → m³/h (rounded to 1 dp). */
export const toM3h = (lps) => r1(lps * 3.6);

// ── Room-name pattern matchers ────────────────────────────────

/**
 * Returns true if the room name indicates a WC / toilet / powder room.
 * Checked BEFORE isEnsuite so "powder room" and "toilet" get WC rate, not bathroom rate.
 * @param {string | null | undefined} name
 */
export const isWC = (name) =>
  /\bwc\b|water\s*closet|\btoilet\b|\bpowder\b/i.test(name ?? '');

/**
 * Returns true if the room name indicates an en-suite bathroom.
 * @param {string | null | undefined} name
 */
export const isEnsuite = (name) =>
  /ensuite|en-suite|en\s+suite/i.test(name ?? '');

/**
 * Combined Butler's Pantry / Laundry room.
 * Identified by room_type OR a name pattern matching "Pantry/Laundry" combinations.
 * @param {{ room_type?: string }} room
 * @param {string} name
 */
export const isPantryLaundry = (room, name) => {
  if (room.room_type === 'Pantry/Laundry') return true;
  return /\b(b['']?pty|butler['']?s?\s+pantry|pantry)\s*[/&]\s*(ldy|laundry)\b|\b(ldy|laundry)\s*[/&]\s*(b['']?pty|butler['']?s?\s+pantry|pantry)\b/i
    .test(name);
};
