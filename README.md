# Pulse

A **zero-dependency** Node.js server that streams its own vital signs (CPU per core, event loop delay, memory, request rate) to a live dashboard over Server-Sent Events. Its main purpose is to show *why* CPU work belongs in `worker_threads`.

![stack](https://img.shields.io/badge/Node.js-22%2B-339933) ![deps](https://img.shields.io/badge/dependencies-0-34d399) ![tests](https://img.shields.io/badge/tests-node%3Atest-38bdf8)

## The experiment

Press **Block the event loop**: four prime-counting jobs run on the main thread. Event loop delay jumps to seconds, the dashboard freezes, and every other request waits.

Press **Run on worker pool**: the same work is spread across a `worker_threads` pool. Loop delay stays flat, the work finishes about 4× faster in wall time, and the CPU-per-core bars light up in parallel.

## What it shows

| Concept | Where |
| --- | --- |
| **`node:http` with a hand-rolled router and middleware chain** (params, 404 vs 405, HEAD→GET) | `src/router.js` |
| **Server-Sent Events hub** with named events, ids, `retry`, heartbeat and cleanup on disconnect | `src/sse.js` |
| **Event loop health** via `perf_hooks.monitorEventLoopDelay` and `eventLoopUtilization` | `src/metrics.js` |
| **Per-core CPU %** from `os.cpus()` time deltas | `src/metrics.js` |
| **`worker_threads` pool** with FIFO queue, idle tracking and crash respawn | `src/workers/pool.js` |
| **Streaming with backpressure**: a 2M-row CSV generated lazily by an async generator, piped through gzip with `stream/promises.pipeline` at constant memory | `src/app.js` (`/api/report.csv`) |
| **Token-bucket rate limiter** with `Retry-After` and `X-RateLimit-*` headers | `src/rate-limit.js` |
| **Static files** with weak ETags, `304 Not Modified` and path-traversal protection | `src/app.js` |
| **Prometheus `/metrics` endpoint** in the text exposition format, ready to scrape | `src/prometheus.js` |
| **Graceful shutdown** on SIGINT/SIGTERM: closes SSE streams, terminates workers, drains the server | `src/server.js` |
| **Tests with the built-in runner** (`node:test`), including a real server on an ephemeral port | `test/` |

## Run it

```bash
npm start
```

Then open http://localhost:3000. There is nothing to install.

```bash
npm test
```

## API

| Method | Path | |
| --- | --- | --- |
| GET | `/events` | SSE stream: `info`, `history`, `metrics` (1/s), `job` |
| POST | `/api/work?mode=worker\|block&jobs=4&limit=2000000` | Run CPU work and return timings |
| GET | `/api/report.csv?rows=250000` | Streamed (and gzipped) CSV |
| GET | `/metrics` | Prometheus text format (CPU per core, loop delay, memory, pool, clients) |
| GET | `/health` | Liveness and pool stats |
