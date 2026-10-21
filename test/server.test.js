import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.js';

describe('HTTP server', () => {
  let app;
  let base;

  before(async () => {
    app = createApp({ sampleMs: 100, poolSize: 2, log: false });
    await new Promise((r) => app.server.listen(0, r));
    base = `http://127.0.0.1:${app.server.address().port}`;
  });

  after(() => app.close());

  it('reports health', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.pool.size, 2);
  });

  it('serves the dashboard with an ETag and honours If-None-Match', async () => {
    const res = await fetch(base);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const etag = res.headers.get('etag');
    const again = await fetch(base, { headers: { 'If-None-Match': etag } });
    assert.equal(again.status, 304);
  });

  it('blocks path traversal', async () => {
    const res = await fetch(`${base}/..%2Fpackage.json`);
    assert.equal(res.status, 403);
  });

  it('runs CPU work on the worker pool', async () => {
    const res = await fetch(`${base}/api/work?mode=worker&jobs=3&limit=20000`, { method: 'POST' });
    const body = await res.json();
    assert.equal(body.mode, 'worker');
    assert.equal(body.primes, 2262);
    assert.ok(body.threads.every((id) => id > 0), 'ran off the main thread');
  });

  it('streams a CSV report with the requested row count', async () => {
    const res = await fetch(`${base}/api/report.csv?rows=5000`);
    assert.equal(res.headers.get('content-encoding'), 'gzip');
    const text = await res.text(); // fetch decompresses transparently
    const lines = text.trim().split('\n');
    assert.equal(lines[0], 'id,timestamp,sensor,temperature_c,humidity_pct');
    assert.equal(lines.length, 5001);
  });

  it('pushes metrics over Server-Sent Events', async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/events`, { signal: ctrl.signal });
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (!buf.includes('event: metrics')) buf += decoder.decode((await reader.read()).value);
    ctrl.abort();
    assert.match(buf, /event: info/);
    const data = JSON.parse(buf.split('event: metrics\ndata: ')[1].split('\n')[0]);
    assert.ok(Array.isArray(data.cpu.cores));
    assert.equal(typeof data.loop.p99, 'number');
  });

  it('exposes Prometheus metrics', async () => {
    // The sampler runs every 100 ms in tests; wait until at least one sample exists.
    let res;
    for (let i = 0; i < 20; i++) {
      res = await fetch(`${base}/metrics`);
      if (res.status === 200) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/plain; version=0\.0\.4/);
    const text = await res.text();
    assert.match(text, /^# TYPE pulse_cpu_usage_percent gauge$/m);
    assert.match(text, /^pulse_cpu_usage_percent\{core="0"\} \d+$/m);
    assert.match(text, /^pulse_event_loop_delay_ms\{quantile="0\.99"\} [\d.]+$/m);
    assert.match(text, /^pulse_worker_pool\{state="size"\} 2$/m);
    // Every non-comment line must be `name{labels} value`.
    for (const line of text.trim().split('\n').filter((l) => !l.startsWith('#'))) {
      assert.match(line, /^[a-z_]+(\{[^}]*\})? -?[\d.]+$/, line);
    }
  });

  it('rate limits bursts on /api', async () => {
    const codes = await Promise.all(
      Array.from({ length: 45 }, () => fetch(`${base}/api/report.csv?rows=1`).then(async (r) => (await r.text(), r.status))),
    );
    assert.ok(codes.includes(429));
  });
});
