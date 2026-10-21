import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';
import { createMetrics } from './metrics.js';
import { createRateLimiter } from './rate-limit.js';
import { Router, sendJson } from './router.js';
import { createSseHub } from './sse.js';
import { createPool } from './workers/pool.js';
import { countPrimes } from './workers/primes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(here, '../public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export function createApp({ sampleMs = 1000, poolSize = Math.max(2, Math.min(4, os.cpus().length - 1)), log = true } = {}) {
  const metrics = createMetrics();
  const hub = createSseHub();
  const pool = createPool(new URL('./workers/prime-worker.js', import.meta.url), poolSize);
  const limiter = createRateLimiter({ capacity: 30, refillPerSec: 10 });
  const history = [];

  const sampler = setInterval(() => {
    const point = metrics.sample({ pool: pool.stats(), clients: hub.size });
    history.push(point);
    if (history.length > 90) history.shift();
    hub.broadcast('metrics', point);
    limiter.sweep();
  }, sampleMs);

  const router = new Router();

  // Middleware: request counting and access log
  router.use(({ req, res, url }) => {
    metrics.countRequest();
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      if (!log || url.pathname === '/events') return;
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      console.log(`${req.method} ${url.pathname} ${res.statusCode} ${ms.toFixed(1)}ms`);
    });
  });

  // Middleware: token-bucket rate limit on the API
  router.use(({ req, res, url }) => {
    if (!url.pathname.startsWith('/api/')) return;
    const r = limiter.take(req.socket.remoteAddress ?? 'unknown');
    res.setHeader('X-RateLimit-Limit', limiter.capacity);
    res.setHeader('X-RateLimit-Remaining', r.remaining);
    if (!r.ok) {
      sendJson(res, 429, { error: 'Too many requests' }, { 'Retry-After': r.retryAfter });
      return false;
    }
  });

  router.get('/health', ({ res }) =>
    sendJson(res, 200, { status: 'ok', uptime: process.uptime(), clients: hub.size, pool: pool.stats() }),
  );

  router.get('/events', ({ req, res }) => {
    hub.connect(req, res, [
      ['info', metrics.static()],
      ['history', history],
    ]);
  });

  /**
   * POST /api/work?mode=worker|block&jobs=4&limit=2000000
   * Same CPU work either on the worker pool or right on the event loop.
   */
  router.post('/api/work', async ({ res, query }) => {
    const mode = query.get('mode') === 'block' ? 'block' : 'worker';
    const jobs = clamp(Number(query.get('jobs') ?? 4), 1, 8);
    const limit = clamp(Number(query.get('limit') ?? 2_000_000), 1000, 6_000_000);
    const start = performance.now();
    let results;

    if (mode === 'worker') {
      results = await Promise.all(Array.from({ length: jobs }, () => pool.run({ limit })));
    } else {
      results = Array.from({ length: jobs }, () => {
        const t = performance.now();
        return { result: countPrimes(limit), ms: Math.round(performance.now() - t), threadId: 0 };
      });
    }

    const summary = {
      mode,
      jobs,
      limit,
      primes: results[0].result,
      wallMs: Math.round(performance.now() - start),
      cpuMs: results.reduce((a, r) => a + r.ms, 0),
      threads: [...new Set(results.map((r) => r.threadId))],
      at: Date.now(),
    };
    hub.broadcast('job', summary);
    sendJson(res, 200, summary);
  });

  /**
   * GET /api/report.csv?rows=200000
   * Rows are generated lazily and piped with backpressure, gzipped when the client allows it.
   * Memory stays flat no matter how many rows you ask for.
   */
  router.get('/api/report.csv', async ({ req, res, query }) => {
    const rows = clamp(Number(query.get('rows') ?? 100_000), 1, 2_000_000);
    const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="sensor-report-${rows}.csv"`,
      ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
    });
    const source = Readable.from(csvRows(rows));
    try {
      await (gzip ? pipeline(source, createGzip(), res) : pipeline(source, res));
    } catch {
      // Client aborted the download; pipeline already destroyed the streams.
    }
  });

  router.get('/', (ctx) => serveStatic(ctx, 'index.html'));
  router.get('/:file', (ctx) => serveStatic(ctx, ctx.params.file));

  const server = createServer((req, res) => {
    router.handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
      else res.end();
    });
  });

  async function close() {
    clearInterval(sampler);
    hub.close();
    metrics.stop();
    await pool.close();
    await new Promise((resolve) => server.close(resolve));
  }

  return { server, close };
}

async function* csvRows(n) {
  const sensors = ['north', 'south', 'east', 'west', 'roof'];
  const start = Date.now() - n * 1000;
  yield 'id,timestamp,sensor,temperature_c,humidity_pct\n';
  let chunk = '';
  for (let i = 1; i <= n; i++) {
    const temp = (18 + 6 * Math.sin(i / 600) + Math.random() * 1.5).toFixed(2);
    const hum = (45 + 15 * Math.cos(i / 900) + Math.random() * 3).toFixed(1);
    chunk += `${i},${new Date(start + i * 1000).toISOString()},${sensors[i % 5]},${temp},${hum}\n`;
    if (i % 2000 === 0) {
      yield chunk;
      chunk = '';
    }
  }
  if (chunk) yield chunk;
}

async function serveStatic({ req, res }, file) {
  const full = path.resolve(PUBLIC, file);
  if (!full.startsWith(PUBLIC + path.sep)) return sendJson(res, 403, { error: 'Forbidden' });
  let info;
  try {
    info = await stat(full);
    if (!info.isFile()) throw new Error('not a file');
  } catch {
    return sendJson(res, 404, { error: 'Not found' });
  }
  const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    return res.end();
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(full)] ?? 'application/octet-stream',
    'Content-Length': info.size,
    ETag: etag,
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  await pipeline(createReadStream(full), res);
}

function clamp(n, min, max) {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : min;
}
