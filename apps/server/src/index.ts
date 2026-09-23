import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from './app.js';
import { config } from './config.js';
import { startWorker, stopWorker } from './judge/worker.js';
import { backupDatabase, listBackups } from './db/index.js';
import { bool, num, str } from './settings/index.js';

async function main() {
  const app = await buildApp();

  if (config.judge.enabled) {
    startWorker({ concurrency: num('judge_concurrency', config.judge.concurrency) });
    app.log.warn(`[ogoj] judge worker started (concurrency=${num('judge_concurrency', config.judge.concurrency)})`);
  }

  if (bool('auto_backup', true)) {
    const hours = Math.max(1, num('backup_interval_hours', 24));
    setInterval(
      () => {
        try {
          const file = backupDatabase('auto');
          const keep = Math.max(1, num('backup_keep', 10));
          const backups = listBackups().filter((b) => b.file.includes('-auto-'));
          for (const old of backups.slice(keep)) {
            try {
              fs.unlinkSync(path.join(config.paths.backups, old.file));
            } catch {
              /* ignore */
            }
          }
          app.log.warn(`[ogoj] database backed up to ${file}`);
        } catch (error) {
          app.log.error(`[ogoj] backup failed: ${String(error)}`);
        }
      },
      hours * 3600_000,
    ).unref();
  }

  try {
    await app.listen({ host: config.host, port: config.port });
    const siteName = str('site_name', 'OGOJ');
    // eslint-disable-next-line no-console
    console.log(`\n  ${siteName} - Oganesson Online Judge`);
    console.log(`  listening on http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
    console.log(`  data dir: ${config.dataDir}\n`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    app.log.warn(`[ogoj] received ${signal}, shutting down`);
    stopWorker();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[ogoj] failed to start:', error);
  process.exit(1);
});
