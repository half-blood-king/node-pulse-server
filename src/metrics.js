import os from 'node:os';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

/**
 * Samples process and host vitals. CPU usage is computed from the delta of
 * os.cpus() times between samples; event loop delay comes from a libuv
 * histogram that is reset every sample so each point covers one interval.
 */
export function createMetrics() {
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();

  let prevCpus = os.cpus();
  let prevElu = performance.eventLoopUtilization();
  let requests = 0;
  let lastSample = performance.now();

  return {
    countRequest() {
      requests++;
    },

    sample(extra = {}) {
      const cpus = os.cpus();
      const cores = cpus.map((cpu, i) => {
        const prev = prevCpus[i]?.times ?? cpu.times;
        const idle = cpu.times.idle - prev.idle;
        const total = Object.values(cpu.times).reduce((a, b) => a + b, 0) - Object.values(prev).reduce((a, b) => a + b, 0);
        return total > 0 ? Math.round((1 - idle / total) * 100) : 0;
      });
      prevCpus = cpus;

      const elu = performance.eventLoopUtilization(prevElu);
      prevElu = performance.eventLoopUtilization();

      const now = performance.now();
      const seconds = (now - lastSample) / 1000;
      lastSample = now;
      const rps = requests / seconds;
      requests = 0;

      const mem = process.memoryUsage();
      const ms = (ns) => Math.round((ns / 1e6) * 10) / 10;
      const point = {
        t: Date.now(),
        cpu: { cores, avg: Math.round(cores.reduce((a, b) => a + b, 0) / cores.length) },
        loop: {
          p50: ms(loop.percentile(50)),
          p99: ms(loop.percentile(99)),
          max: ms(loop.max),
          utilization: Math.round(elu.utilization * 1000) / 10,
        },
        memory: {
          rss: mem.rss,
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
          systemFree: os.freemem(),
          systemTotal: os.totalmem(),
        },
        rps: Math.round(rps * 10) / 10,
        uptime: Math.round(process.uptime()),
        ...extra,
      };
      loop.reset();
      return point;
    },

    static() {
      return {
        hostname: os.hostname(),
        platform: `${os.type()} ${os.release()}`,
        cpuModel: os.cpus()[0]?.model.trim() ?? 'unknown',
        cores: os.cpus().length,
        node: process.version,
        pid: process.pid,
      };
    },

    stop() {
      loop.disable();
    },
  };
}
