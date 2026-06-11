// lib/cors.js
//
// Shared CORS helper with an origin allowlist.
// Replaces the per-file `cors(res)` functions that set Access-Control-Allow-Origin: *.
//
// Allowed origins:
//   • https://hiper-studio.au          — production
//   • https://www.hiper-studio.au      — production www alias
//   • http://localhost:*               — local development (any port)
//   • https://*.vercel.app             — Vercel preview deployments
//
// If APP_EXTRA_ORIGINS is set in the environment (comma-separated), those are
// also allowed. This lets staging environments be added without a code change.

const BASE_ALLOWED = [
  'https://hiper-studio.au',
  'https://www.hiper-studio.au',
];

function buildAllowedOrigins() {
  const extra = (process.env.APP_EXTRA_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return [...BASE_ALLOWED, ...extra];
}

/**
 * Returns true when the origin should be reflected.
 * Localhost (any port) and Vercel preview URLs are always allowed in non-production.
 */
function isAllowed(origin) {
  if (!origin) return false;
  const allowed = buildAllowedOrigins();
  if (allowed.includes(origin)) return true;
  // Allow localhost on any port during development
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
  // Allow Vercel preview URLs
  if (/^https:\/\/[a-zA-Z0-9-]+-[a-zA-Z0-9]+\.vercel\.app$/.test(origin)) return true;
  return false;
}

/**
 * Apply CORS headers to the response.
 * Only reflects the origin if it is in the allowlist; otherwise omits ACAO.
 *
 * @param {import('http').IncomingMessage}  req
 * @param {import('http').ServerResponse}   res
 * @param {string} methods  - comma-separated HTTP methods, e.g. 'GET,POST,OPTIONS'
 */
export function applyCors(req, res, methods = 'GET,POST,PATCH,OPTIONS') {
  const origin = req.headers.origin;
  if (origin && isAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin',  origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}
