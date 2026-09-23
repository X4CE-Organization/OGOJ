import path from 'node:path';
import { badRequest } from './errors.js';

export interface Page {
  page: number;
  size: number;
  offset: number;
}

export function parsePage(
  query: Record<string, unknown>,
  defaultSize = 50,
  maxSize = 200,
): Page {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const size = Math.min(maxSize, Math.max(1, Number(query.size ?? defaultSize) || defaultSize));
  return { page, size, offset: (page - 1) * size };
}

export function parseId(value: unknown): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('无效的 ID');
  return id;
}

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `item-${Date.now().toString(36)}`;
}

export function uniqueSlug(base: string, exists: (slug: string) => boolean): string {
  let slug = slugify(base);
  let i = 1;
  while (exists(slug)) {
    slug = `${slugify(base)}-${i}`;
    i += 1;
  }
  return slug;
}

export function sqlLike(term: string): string {
  return `%${term.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
}

export function nowSql(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export function toBool(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const s = String(value).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

export function toInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function safeJoin(base: string, target: string): string {
  const resolved = path.resolve(base, target);
  if (!resolved.startsWith(path.resolve(base))) throw badRequest('非法的文件路径');
  return resolved;
}

export function secondsBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000);
}

export function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

/** Cheap in-memory rate limiter for actions that are not covered by the API limiter. */
const buckets = new Map<string, number>();
export function rateLimit(key: string, intervalSeconds: number): boolean {
  if (intervalSeconds <= 0) return true;
  const last = buckets.get(key);
  const now = Date.now();
  if (last && now - last < intervalSeconds * 1000) return false;
  buckets.set(key, now);
  if (buckets.size > 20000) {
    for (const [k, v] of buckets) if (now - v > 3600_000) buckets.delete(k);
  }
  return true;
}

export function pick<T extends Record<string, unknown>>(obj: T, keys: string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (key in obj) out[key] = obj[key];
  return out as Partial<T>;
}
