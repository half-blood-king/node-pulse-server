/**
 * Token bucket per key: `capacity` tokens, refilled continuously at
 * `refillPerSec`. Each request costs one token; empty bucket means 429.
 */
export function createRateLimiter({ capacity = 20, refillPerSec = 5, now = () => Date.now() } = {}) {
  const buckets = new Map();

  function take(key) {
    const t = now();
    let b = buckets.get(key);
    if (!b) {
      b = { tokens: capacity, updated: t };
      buckets.set(key, b);
    }
    b.tokens = Math.min(capacity, b.tokens + ((t - b.updated) / 1000) * refillPerSec);
    b.updated = t;

    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { ok: true, remaining: Math.floor(b.tokens), retryAfter: 0 };
    }
    return { ok: false, remaining: 0, retryAfter: Math.ceil((1 - b.tokens) / refillPerSec) };
  }

  // Forget idle clients so the map can't grow forever.
  function sweep() {
    const cutoff = now() - (capacity / refillPerSec) * 1000 * 2;
    for (const [k, b] of buckets) if (b.updated < cutoff) buckets.delete(k);
  }

  return { take, sweep, size: () => buckets.size, capacity };
}
