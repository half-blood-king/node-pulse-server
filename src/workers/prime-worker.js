import { parentPort, threadId } from 'node:worker_threads';
import { countPrimes } from './primes.js';

parentPort.on('message', ({ id, limit }) => {
  const start = performance.now();
  const result = countPrimes(limit);
  parentPort.postMessage({ id, result, ms: Math.round(performance.now() - start), threadId });
});
