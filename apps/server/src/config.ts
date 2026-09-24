import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (apps/server/src -> ../../..). */
export const ROOT_DIR = path.resolve(here, '../../..');

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

function resolveFromRoot(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(ROOT_DIR, value);
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isProd: (process.env.NODE_ENV ?? 'development') === 'production',
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 8080),
  siteUrl: process.env.SITE_URL ?? 'http://localhost:8080',

  jwtSecret: process.env.JWT_SECRET || 'ogoj-insecure-development-secret-change-me',
  jwtExpiresDays: Number(process.env.JWT_EXPIRES_DAYS ?? 14),

  dataDir: resolveFromRoot(process.env.DATA_DIR ?? './data'),
  databaseFile: resolveFromRoot(process.env.DATABASE_FILE ?? './data/ogoj.db'),

  judge: {
    enabled: bool(process.env.JUDGE_ENABLED, true),
    concurrency: Math.max(1, Number(process.env.JUDGE_CONCURRENCY ?? 2)),
    sandbox: (process.env.JUDGE_SANDBOX ?? 'none') as 'none' | 'isolate',
    pollIntervalMs: Number(process.env.JUDGE_POLL_INTERVAL_MS ?? 700),
  },

  seed: {
    rootUsername: process.env.ROOT_USERNAME ?? 'root',
    rootPassword: process.env.ROOT_PASSWORD ?? 'ogoj123456',
    rootEmail: process.env.ROOT_EMAIL ?? 'webmaster@ogoj.local',
  },

  paths: {
    get testdata() {
      return path.join(config.dataDir, 'testdata');
    },
    get uploads() {
      return path.join(config.dataDir, 'uploads');
    },
    get judge() {
      return path.join(config.dataDir, 'judge');
    },
    get backups() {
      return path.join(config.dataDir, 'backups');
    },
    get webDist() {
      return path.join(ROOT_DIR, 'apps/web/dist');
    },
  },
} as const;

export function ensureDataDirs(): void {
  for (const dir of [
    config.dataDir,
    config.paths.testdata,
    config.paths.uploads,
    config.paths.judge,
    config.paths.backups,
    path.dirname(config.databaseFile),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
