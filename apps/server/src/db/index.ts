import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config, ensureDataDirs } from '../config.js';
import { ALTERATIONS_SQL, SCHEMA_SQL } from './schema.js';

ensureDataDirs();

export const db = new Database(config.databaseFile);

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 8000');

/** Create every missing table / index. Safe to call on each boot. */
import { DEFAULT_DIFFICULTIES } from '../lib/difficulty-defaults.js';

export function migrate(): void {
  db.exec(SCHEMA_SQL);
  for (const sql of ALTERATIONS_SQL) {
    try {
      db.exec(sql);
    } catch {
      /* already applied */
    }
  }
  // 难度表为空时（新库或第一次升级的老库）写入内置的六级默认值
  const difficultyCount = db.prepare('SELECT COUNT(*) AS c FROM difficulties').get() as { c: number };
  if (!difficultyCount.c) {
    const insert = db.prepare('INSERT INTO difficulties (level, name, color, color_dark) VALUES (?, ?, ?, ?)');
    for (const item of DEFAULT_DIFFICULTIES) insert.run(item.level, item.name, item.color, item.colorDark);
  }
}

export function tableExists(name: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
    .get(name);
  return Boolean(row);
}

export type SqlParams = Record<string, unknown> | unknown[];

export function all<T = any>(sql: string, params?: SqlParams): T[] {
  const stmt = db.prepare(sql);
  return (Array.isArray(params) ? stmt.all(...params) : stmt.all(params ?? {})) as T[];
}

export function get<T = any>(sql: string, params?: SqlParams): T | undefined {
  const stmt = db.prepare(sql);
  return (Array.isArray(params) ? stmt.get(...params) : stmt.get(params ?? {})) as T | undefined;
}

export function run(sql: string, params?: SqlParams) {
  const stmt = db.prepare(sql);
  return Array.isArray(params) ? stmt.run(...params) : stmt.run(params ?? {});
}

export function pluck<T = any>(sql: string, params?: SqlParams): T | undefined {
  const row = get<Record<string, any>>(sql, params);
  if (!row) return undefined;
  return Object.values(row)[0] as T;
}

export function count(sql: string, params?: SqlParams): number {
  return Number(pluck<number>(sql, params) ?? 0);
}

/**
 * Run `fn` inside an IMMEDIATE transaction. Nested calls reuse the outer
 * transaction so helpers can be composed safely.
 */
let depth = 0;
export function tx<T>(fn: () => T): T {
  if (depth > 0) return fn();
  const exec = db.transaction((inner: () => T) => {
    depth += 1;
    try {
      return inner();
    } finally {
      depth -= 1;
    }
  });
  return exec(fn);
}

export function nowIso(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/** Full backup of the SQLite database into data/backups. */
export function backupDatabase(label = 'manual'): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(config.paths.backups, `ogoj-${label}-${stamp}.db`);
  db.prepare('VACUUM INTO ?').run(file);
  return file;
}

export function listBackups(): { file: string; size: number; created_at: string }[] {
  if (!fs.existsSync(config.paths.backups)) return [];
  return fs
    .readdirSync(config.paths.backups)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const full = path.join(config.paths.backups, f);
      const stat = fs.statSync(full);
      return { file: f, size: stat.size, created_at: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
