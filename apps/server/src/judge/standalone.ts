/**
 * Standalone judge worker: `npm run judge`
 *
 * Runs the judging queue without the HTTP API — handy when you want to move
 * judging work onto a beefier machine that shares the same data directory
 * (e.g. over NFS) or when you run several workers for higher throughput.
 */
import { config } from '../config.js';
import { migrate } from '../db/index.js';
import { startWorker, workerState } from './worker.js';

async function main() {
  migrate();
  console.log(`[ogoj-judge] starting worker (concurrency=${config.judge.concurrency})`);
  startWorker();
  setInterval(() => {
    const state = workerState();
    console.log(`[ogoj-judge] running=${state.running} active=${state.active}`);
  }, 60_000).unref();
}

main().catch((error) => {
  console.error('[ogoj-judge] fatal:', error);
  process.exit(1);
});
