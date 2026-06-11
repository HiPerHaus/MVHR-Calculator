// lib/validateUuid.js
//
// UUID v4 validation helpers.
// Used to reject malformed or injected IDs before they reach Supabase filters.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns true if the value is a valid UUID string.
 * @param {unknown} v
 * @returns {boolean}
 */
export function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

/**
 * Validates one or more named UUID parameters.
 * Returns { valid: true } when all pass, or { valid: false, error: string } naming the first failure.
 *
 * @param {Record<string, unknown>} params  - e.g. { projectId, nodeId }
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateUuids(params) {
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && !isUuid(value)) {
      return { valid: false, error: `Invalid ${name}: must be a UUID` };
    }
  }
  return { valid: true };
}
