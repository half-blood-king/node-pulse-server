import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRateLimiter } from '../src/rate-limit.js';
import { Router } from '../src/router.js';
import { countPrimes } from '../src/workers/primes.js';
import { createPool } from '../src/workers/pool.js';

describe('Router', () => {
  const router = new Router().get('/jobs/:id', () => 'job').post('/jobs', () => 'create');

  it('extracts params', () => {
    const m = router.match('GET', '/jobs/42');
    assert.equal(m.handler(), 'job');
    assert.deepEqual(m.params, { id: '42' });
  });

  it('distinguishes 404 from 405', () => {
    assert.equal(router.match('GET', '/nope').status, 404);
    assert.equal(router.match('DELETE', '/jobs').status, 405);
  });

  it('lets HEAD fall through to GET', () => {
    assert.ok(router.match('HEAD', '/jobs/1').handler);
  });
});

describe('Token bucket', () => {
  it('allows a burst up to capacity, then refills over time', () => {
    let t = 0;
    const limiter = createRateLimiter({ capacity: 3, refillPerSec: 1, now: () => t });
    assert.equal(limiter.take('a').ok, true);
    assert.equal(limiter.take('a').ok, true);
    assert.equal(limiter.take('a').ok, true);
    const denied = limiter.take('a');
    assert.equal(denied.ok, false);
    assert.equal(denied.retryAfter, 1);

    t += 1000;
    assert.equal(limiter.take('a').ok, true);
    assert.equal(limiter.take('b').ok, true, 'keys are independent');
  });

  it('sweeps idle buckets', () => {
    let t = 0;
    const limiter = createRateLimiter({ capacity: 2, refillPerSec: 1, now: () => t });
    limiter.take('x');
    t += 60_000;
    limiter.sweep();
    assert.equal(limiter.size(), 0);
  });
});

describe('Worker pool', () => {
  it('runs more tasks than workers and matches the main-thread result', async () => {
    const pool = createPool(new URL('../src/workers/prime-worker.js', import.meta.url), 2);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => pool.run({ limit: 10_000 })));
    await pool.close();
    for (const r of results) assert.equal(r.result, countPrimes(10_000));
    assert.equal(countPrimes(10_000), 1229);
  });
});
