/**
 * lib/rate-limit.js
 * Simple in-process sliding-window rate limiter for Vercel serverless functions.
 *
 * ⚠️  IMPORTANT: Each Vercel function instance has its own in-memory state.
 * Under high traffic, multiple instances run in parallel and each maintains
 * separate counters. For production-grade rate limiting across all instances,
 * replace the in-memory store with Upstash Redis (https://upstash.com) using
 * the @upstash/ratelimit package. The interface below is designed to be a
 * drop-in replacement when you make that upgrade.
 *
 * Usage:
 *   import { rateLimit } from '../../lib/rate-limit.js';
 *
 *   const limiter = rateLimit({ windowMs: 60_000, max: 10 });
 *
 *   export default async function handler(req, res) {
 *     const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || 'unknown';
 *     const { allowed, remaining, resetAt } = limiter.check(ip);
 *     if (!allowed) {
 *       res.setHeader('Retry-After', Math.ceil((resetAt - Date.now()) / 1000));
 *       return res.status(429).json({ error: 'Too many requests. Please wait before retrying.' });
 *     }
 *     // ... handler logic
 *   }
 */

/**
 * @param {{ windowMs: number, max: number }} options
 * windowMs — sliding window duration in milliseconds
 * max       — maximum requests allowed per key within the window
 */
export function rateLimit({ windowMs = 60_000, max = 20 } = {}) {
  // Map<key, number[]> — timestamps of recent requests
  const store = new Map();

  // Purge stale entries every 5 minutes to prevent unbounded memory growth
  const purgeInterval = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, timestamps] of store.entries()) {
      const fresh = timestamps.filter(t => t > cutoff);
      if (fresh.length === 0) store.delete(key);
      else store.set(key, fresh);
    }
  }, 300_000);

  // Allow GC when the module is hot-reloaded in dev
  if (purgeInterval.unref) purgeInterval.unref();

  return {
    /**
     * @param {string} key — typically the client IP address
     * @returns {{ allowed: boolean, remaining: number, resetAt: number }}
     */
    check(key) {
      const now = Date.now();
      const cutoff = now - windowMs;
      const timestamps = (store.get(key) || []).filter(t => t > cutoff);

      if (timestamps.length >= max) {
        return {
          allowed:   false,
          remaining: 0,
          resetAt:   timestamps[0] + windowMs, // oldest entry expires first
        };
      }

      timestamps.push(now);
      store.set(key, timestamps);

      return {
        allowed:   true,
        remaining: max - timestamps.length,
        resetAt:   now + windowMs,
      };
    },
  };
}

/**
 * Convenience wrapper — applies rate limiting and sends a 429 response if exceeded.
 * Returns true if the request was allowed, false if rejected (response already sent).
 *
 * @param {object} req
 * @param {object} res
 * @param {{ windowMs?: number, max?: number, limiter?: object }} opts
 */
export function applyRateLimit(req, res, { windowMs = 60_000, max = 20, limiter } = {}) {
  const rl = limiter || rateLimit({ windowMs, max });
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim()
           || req.socket?.remoteAddress
           || 'unknown';

  const { allowed, remaining, resetAt } = rl.check(ip);

  res.setHeader('X-RateLimit-Limit',     max);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset',     Math.ceil(resetAt / 1000));

  if (!allowed) {
    const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
    res.setHeader('Retry-After', retryAfter);
    res.status(429).json({ error: 'Too many requests. Please wait before retrying.' });
    return false;
  }

  return true;
}
