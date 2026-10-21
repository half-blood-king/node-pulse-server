import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const { server, close } = createApp();

server.listen(port, () => {
  console.log(`pulse server listening on http://localhost:${port}`);
});

// Graceful shutdown: stop accepting connections, end SSE streams, stop workers.
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received, shutting down…`);
    const force = setTimeout(() => process.exit(1), 5000);
    force.unref();
    await close();
    console.log('bye');
    process.exit(0);
  });
}
