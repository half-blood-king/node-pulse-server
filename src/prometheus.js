/**
 * Renders a metrics sample in the Prometheus text exposition format (v0.0.4),
 * so the server can be scraped by Prometheus or read with plain curl.
 */
export function toPrometheus(point, info) {
  const lines = [];
  const metric = (name, type, help, samples) => {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [labels, value] of samples) lines.push(`${name}${formatLabels(labels)} ${value}`);
  };

  metric('pulse_info', 'gauge', 'Static information about this process.', [
    [{ node: info.node, platform: info.platform, cores: String(info.cores) }, 1],
  ]);
  metric('pulse_uptime_seconds', 'gauge', 'Process uptime.', [[{}, point.uptime]]);
  metric(
    'pulse_cpu_usage_percent',
    'gauge',
    'CPU usage per core over the last sample interval.',
    point.cpu.cores.map((v, i) => [{ core: String(i) }, v]),
  );
  metric('pulse_event_loop_delay_ms', 'gauge', 'Event loop delay over the last sample interval.', [
    [{ quantile: '0.5' }, point.loop.p50],
    [{ quantile: '0.99' }, point.loop.p99],
    [{ quantile: '1' }, point.loop.max],
  ]);
  metric('pulse_event_loop_utilization_percent', 'gauge', 'Share of time the event loop was busy.', [
    [{}, point.loop.utilization],
  ]);
  metric('pulse_memory_bytes', 'gauge', 'Process memory by kind.', [
    [{ kind: 'rss' }, point.memory.rss],
    [{ kind: 'heap_used' }, point.memory.heapUsed],
    [{ kind: 'heap_total' }, point.memory.heapTotal],
  ]);
  metric('pulse_requests_per_second', 'gauge', 'Request rate over the last sample interval.', [[{}, point.rps]]);
  metric('pulse_worker_pool', 'gauge', 'Worker pool state.', [
    [{ state: 'size' }, point.pool.size],
    [{ state: 'busy' }, point.pool.busy],
    [{ state: 'queued' }, point.pool.queued],
  ]);
  metric('pulse_sse_clients', 'gauge', 'Connected dashboard streams.', [[{}, point.clients]]);

  return `${lines.join('\n')}\n`;
}

function formatLabels(labels) {
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  const escape = (v) => v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
  return `{${entries.map(([k, v]) => `${k}="${escape(v)}"`).join(',')}}`;
}
