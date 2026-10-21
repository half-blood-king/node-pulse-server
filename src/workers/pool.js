import { Worker } from 'node:worker_threads';

/**
 * Fixed-size worker_threads pool with a FIFO queue. `run()` returns a promise
 * that resolves when a worker finishes the task; extra tasks wait their turn.
 */
export function createPool(file, size) {
  const idle = [];
  const all = [];
  const queue = [];
  const pending = new Map();
  let nextId = 1;
  let closed = false;

  for (let i = 0; i < size; i++) spawn();

  function spawn() {
    const worker = new Worker(file);
    worker.on('message', (msg) => {
      const task = pending.get(msg.id);
      pending.delete(msg.id);
      task?.resolve(msg);
      release(worker);
    });
    worker.on('error', (err) => {
      for (const [id, task] of pending) {
        if (task.worker === worker) {
          pending.delete(id);
          task.reject(err);
        }
      }
      all.splice(all.indexOf(worker), 1);
      if (!closed) spawn();
    });
    all.push(worker);
    idle.push(worker);
    drain();
  }

  function release(worker) {
    idle.push(worker);
    drain();
  }

  function drain() {
    while (idle.length && queue.length) {
      const worker = idle.shift();
      const task = queue.shift();
      task.worker = worker;
      pending.set(task.id, task);
      worker.postMessage({ id: task.id, ...task.payload });
    }
  }

  return {
    run(payload) {
      if (closed) return Promise.reject(new Error('Pool is closed'));
      return new Promise((resolve, reject) => {
        queue.push({ id: nextId++, payload, resolve, reject });
        drain();
      });
    },
    stats() {
      return { size, busy: size - idle.length, queued: queue.length };
    },
    async close() {
      closed = true;
      await Promise.all(all.map((w) => w.terminate()));
    },
  };
}
