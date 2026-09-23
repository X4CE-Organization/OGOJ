import { all, db, run } from '../db/index.js';
import {
  defaultSettings,
  parseSetting,
  PUBLIC_SETTING_KEYS,
  SETTING_MAP,
  serializeSetting,
  type SettingField,
} from './registry.js';

let cache: Map<string, string> | null = null;

function load(): Map<string, string> {
  if (cache) return cache;
  const rows = all<{ key: string; value: string }>('SELECT key, value FROM settings');
  const map = new Map<string, string>(Object.entries(defaultSettings()));
  for (const row of rows) map.set(row.key, row.value);
  cache = map;
  return map;
}

export function invalidateSettings(): void {
  cache = null;
}

export function rawSetting(key: string): string | undefined {
  return load().get(key);
}

export function typedSetting<T = unknown>(key: string): T {
  const field = SETTING_MAP[key];
  if (!field) return load().get(key) as unknown as T;
  return parseSetting(load().get(key), field) as T;
}

export function str(key: string, fallback = ''): string {
  const value = rawSetting(key);
  return value === undefined || value === '' ? fallback : value;
}

export function num(key: string, fallback = 0): number {
  const value = Number(rawSetting(key));
  return Number.isFinite(value) ? value : fallback;
}

export function bool(key: string, fallback = false): boolean {
  const value = rawSetting(key);
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

export function json<T = any>(key: string, fallback: T): T {
  const value = rawSetting(key);
  if (value === undefined || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** All settings, values already coerced to their declared type. */
export function allSettings(options: { maskSecrets?: boolean } = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(SETTING_MAP)) {
    if (options.maskSecrets && field.secret && rawSetting(key)) {
      out[key] = '********';
      continue;
    }
    out[key] = typedSetting(key);
  }
  return out;
}

/** Subset of settings that is safe (and useful) to ship to the browser. */
export function publicSettings(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PUBLIC_SETTING_KEYS) {
    const field = SETTING_MAP[key];
    if (!field || field.secret) continue;
    out[key] = typedSetting(key);
  }
  return out;
}

export interface SettingChange {
  key: string;
  value: unknown;
  oldValue?: unknown;
}

/** Validate + persist a batch of settings, returning the applied changes. */
export function updateSettings(patch: Record<string, unknown>): SettingChange[] {
  const changes: SettingChange[] = [];
  const stmt = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  );
  db.transaction(() => {
    for (const [key, rawValue] of Object.entries(patch)) {
      const field: SettingField | undefined = SETTING_MAP[key];
      if (!field) continue;
      // A masked secret placeholder means "keep the stored value".
      if (field.secret && rawValue === '********') continue;
      const serialized = validate(field, rawValue);
      const oldValue = typedSetting(key);
      stmt.run(key, serialized);
      if (oldValue !== rawValue) changes.push({ key, value: rawValue, oldValue });
    }
  })();
  invalidateSettings();
  return changes;
}

export function validate(field: SettingField, value: unknown): string {
  switch (field.type) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number': {
      let num = Number(value);
      if (!Number.isFinite(num)) num = Number(field.default);
      if (field.min !== undefined) num = Math.max(field.min, num);
      if (field.max !== undefined) num = Math.min(field.max, num);
      return String(num);
    }
    case 'json': {
      if (typeof value === 'string') {
        try {
          JSON.parse(value);
          return value;
        } catch {
          return serializeSetting(field.default, field.type);
        }
      }
      return JSON.stringify(value ?? []);
    }
    default: {
      let text = String(value ?? '');
      if (typeof field.max === 'number') text = text.slice(0, Math.max(64, field.max));
      return text;
    }
  }
}

export function resetSettings(keys?: string[]): void {
  if (keys?.length) {
    const stmt = db.prepare('DELETE FROM settings WHERE key = ?');
    db.transaction(() => keys.forEach((k) => stmt.run(k)))();
  } else {
    run('DELETE FROM settings');
  }
  invalidateSettings();
}

export { SETTING_GROUPS, SETTINGS, SETTING_MAP } from './registry.js';
