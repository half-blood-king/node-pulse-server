const $ = (id) => document.getElementById(id);
const points = [];
const MAX_POINTS = 90;

const fmtBytes = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(0)} MB`);

/** Minimal HiDPI line chart: series of { values, color, fill? } with a shared y-scale. */
function lineChart(canvas, series, { unit = '', minMax = 1, floor = 0 } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const all = series.flatMap((s) => s.values);
  const max = Math.max(minMax, ...all) * 1.15;
  const padR = 52;
  const x = (i) => (i / (MAX_POINTS - 1)) * (width - padR);
  const y = (v) => height - 6 - ((v - floor) / (max - floor)) * (height - 14);

  ctx.font = '11px ui-monospace, Menlo, monospace';
  ctx.fillStyle = '#6f7a9c';
  for (let k = 0; k <= 3; k++) {
    const v = floor + ((max - floor) * k) / 3;
    ctx.strokeStyle = '#ffffff0f';
    ctx.beginPath();
    ctx.moveTo(0, y(v));
    ctx.lineTo(width - padR, y(v));
    ctx.stroke();
    ctx.fillText(`${v < 10 ? v.toFixed(1) : Math.round(v)}${unit}`, width - padR + 6, y(v) + 4);
  }

  for (const s of series) {
    const offset = MAX_POINTS - s.values.length;
    ctx.beginPath();
    s.values.forEach((v, i) => (i ? ctx.lineTo(x(i + offset), y(v)) : ctx.moveTo(x(i + offset), y(v))));
    if (s.fill) {
      ctx.lineTo(x(MAX_POINTS - 1), height);
      ctx.lineTo(x(offset), height);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, 0, 0, height);
      g.addColorStop(0, `${s.color}55`);
      g.addColorStop(1, `${s.color}00`);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.beginPath();
      s.values.forEach((v, i) => (i ? ctx.lineTo(x(i + offset), y(v)) : ctx.moveTo(x(i + offset), y(v))));
    }
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

function render() {
  const p = points.at(-1);
  if (!p) return;
  $('k-cpu').textContent = `${p.cpu.avg}%`;
  $('k-loop').textContent = `${p.loop.p99} ms`;
  $('k-loop').className = p.loop.p99 > 100 ? 'bad' : p.loop.p99 > 30 ? 'warn' : '';
  $('k-elu').textContent = `${p.loop.utilization}%`;
  $('k-heap').textContent = fmtBytes(p.memory.heapUsed);
  $('k-rps').textContent = p.rps;
  $('k-pool').textContent = `${p.pool.busy}/${p.pool.size}${p.pool.queued ? ` +${p.pool.queued}` : ''}`;

  lineChart(
    $('c-loop'),
    [
      { values: points.map((q) => q.loop.max), color: '#f472b6' },
      { values: points.map((q) => q.loop.p99), color: '#38bdf8', fill: true },
      { values: points.map((q) => q.loop.p50), color: '#34d399' },
    ],
    { unit: 'ms', minMax: 25 },
  );
  lineChart($('c-cpu'), [{ values: points.map((q) => q.cpu.avg), color: '#38bdf8', fill: true }], {
    unit: '%',
    minMax: 100 / 1.15,
  });
  lineChart(
    $('c-mem'),
    [
      { values: points.map((q) => q.memory.rss / 1e6), color: '#a78bfa', fill: true },
      { values: points.map((q) => q.memory.heapUsed / 1e6), color: '#fbbf24' },
    ],
    { unit: 'MB', minMax: 50 },
  );
  $('mem-text').textContent = `System: ${fmtBytes(p.memory.systemTotal - p.memory.systemFree)} of ${fmtBytes(
    p.memory.systemTotal,
  )} used · uptime ${p.uptime}s · ${p.clients} dashboard(s) connected`;

  const cores = $('cores');
  if (cores.children.length !== p.cpu.cores.length) {
    cores.innerHTML = p.cpu.cores.map(() => '<div><i></i></div>').join('');
  }
  p.cpu.cores.forEach((v, i) => {
    const bar = cores.children[i].firstChild;
    bar.style.height = `${Math.max(v, 2)}%`;
    bar.style.background = v > 85 ? '#f472b6' : v > 50 ? '#fbbf24' : '#34d399';
    cores.children[i].title = `core ${i}: ${v}%`;
  });
}

function connect() {
  const es = new EventSource('/events');
  es.onopen = () => {
    $('status').textContent = '● live';
    $('status').className = 'pill live';
  };
  es.onerror = () => {
    $('status').textContent = 'reconnecting…';
    $('status').className = 'pill';
  };
  es.addEventListener('info', (e) => {
    const i = JSON.parse(e.data);
    $('host').textContent = `${i.hostname} · ${i.cpuModel} × ${i.cores} · ${i.platform} · Node ${i.node} · pid ${i.pid}`;
  });
  es.addEventListener('history', (e) => {
    points.splice(0, points.length, ...JSON.parse(e.data).slice(-MAX_POINTS));
    render();
  });
  es.addEventListener('metrics', (e) => {
    points.push(JSON.parse(e.data));
    if (points.length > MAX_POINTS) points.shift();
    render();
  });
  es.addEventListener('job', (e) => logJob(JSON.parse(e.data)));
}

let maxWall = 1;
function logJob(j) {
  maxWall = Math.max(maxWall, j.wallMs);
  const li = document.createElement('li');
  li.className = j.mode;
  li.innerHTML = `
    <span class="tag">${j.mode === 'worker' ? `workers · ${j.threads.length} threads` : 'main thread'}</span>
    <span class="bar"><i style="width:${(j.wallMs / maxWall) * 100}%"></i></span>
    <span class="nums">${j.jobs}× primes&lt;${j.limit.toLocaleString()} · wall <b>${j.wallMs} ms</b> · cpu ${j.cpuMs} ms</span>`;
  $('jobs-log').prepend(li);
  while ($('jobs-log').children.length > 8) $('jobs-log').lastChild.remove();
}

async function run(mode, button) {
  button.disabled = true;
  try {
    const q = new URLSearchParams({ mode, jobs: $('jobs').value, limit: $('limit').value });
    const res = await fetch(`/api/work?${q}`, { method: 'POST' });
    if (res.status === 429) alert('Rate limited. Wait a second.');
  } finally {
    button.disabled = false;
  }
}

$('run-worker').onclick = (e) => run('worker', e.currentTarget);
$('run-block').onclick = (e) => run('block', e.currentTarget);
$('limit').oninput = (e) => ($('limit-label').textContent = Number(e.target.value).toLocaleString());
$('jobs').oninput = (e) => ($('jobs-label').textContent = e.target.value);

$('burst').onclick = async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  const codes = await Promise.all(Array.from({ length: 60 }, () => fetch('/api/report.csv?rows=1').then((r) => r.status)));
  const ok = codes.filter((c) => c === 200).length;
  btn.textContent = `${ok} × 200 · ${codes.length - ok} × 429`;
  setTimeout(() => {
    btn.textContent = 'Fire 60 requests (rate limit)';
    btn.disabled = false;
  }, 3000);
};

window.addEventListener('resize', render);
connect();
