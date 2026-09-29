import { config } from '../config.js';
import { get, run } from '../db/index.js';
import { judgeSubmission } from './index.js';

let running = false;
let active = 0;
let stopped = false;
let timer: NodeJS.Timeout | null = null;

/**
 * Claim the next waiting submission. SQLite guarantees the sub-select + update
 * is atomic, so several worker processes can safely share the same queue.
 */
async function claimNext(): Promise<number | null> {
  const row = await get<{ id: number }>(
    `UPDATE submissions
        SET status = 'Judging', claimed_at = datetime('now')
      WHERE id = (
        SELECT id FROM submissions
         WHERE status = 'Waiting'
         ORDER BY priority DESC, id ASC
         LIMIT 1
      )
      RETURNING id`,
  );
  return row?.id ?? null;
}

/** Re-queue submissions that were left in "Judging" after a crash. */
export async function requeueStale(olderThanMinutes = 15): Promise<number> {
  const info = await run(
    `UPDATE submissions SET status = 'Waiting', claimed_at = NULL
      WHERE status = 'Judging'
        AND (claimed_at IS NULL OR claimed_at < datetime('now', ?))`,
    [`-${olderThanMinutes} minutes`],
  );
  return info.changes;
}

export async function startWorker(options: { concurrency?: number; pollIntervalMs?: number } = {}): Promise<void> {
  const concurrency = options.concurrency ?? config.judge.concurrency;
  const pollInterval = options.pollIntervalMs ?? config.judge.pollIntervalMs;
  if (running) return;
  running = true;
  stopped = false;
  await requeueStale();

  const pump = async () => {
    if (stopped) return;
    while (active < concurrency && !stopped) {
      const id = await claimNext();
      if (id === null) break;
      active += 1;
      judgeSubmission(id)
        .catch(async (error) => {
          // eslint-disable-next-line no-console
          console.error(`[judge] submission #${id} crashed:`, error);
          await run(
            `UPDATE submissions SET status = 'SE', compile_output = ?
              WHERE id = ? AND status = 'Judging'`,
            [`评测进程异常：${error instanceof Error ? error.message : String(error)}`, id],
          );
        })
        .finally(async () => {
          active -= 1;
          void await pump();
        });
    }
  };

  const tick = async () => {
    try {
      await pump();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[judge] poll failed:', error);
    }
    if (!stopped) timer = setTimeout(tick, pollInterval);
  };
  void tick();
}

export function stopWorker(): void {
  stopped = true;
  running = false;
  if (timer) clearTimeout(timer);
}

export function workerState(): { running: boolean; active: number } {
  return { running, active };
}
