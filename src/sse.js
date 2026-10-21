/**
 * Server-Sent Events hub. Keeps the set of open responses, broadcasts named
 * events, sends a comment heartbeat so proxies don't drop idle connections,
 * and forgets clients when their socket closes.
 */
export function createSseHub({ heartbeatMs = 15_000 } = {}) {
  const clients = new Set();
  let nextId = 1;

  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, heartbeatMs);
  heartbeat.unref();

  return {
    get size() {
      return clients.size;
    },

    connect(req, res, initial) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      clients.add(res);
      if (initial) for (const [event, data] of initial) send(res, event, data);
      req.on('close', () => clients.delete(res));
    },

    broadcast(event, data) {
      for (const res of clients) send(res, event, data);
    },

    close() {
      clearInterval(heartbeat);
      for (const res of clients) res.end();
      clients.clear();
    },
  };

  function send(res, event, data) {
    res.write(`id: ${nextId++}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}
