/**
 * 难度等级可以在后台自定义（名称 + 颜色），这里统一读写并做一层缓存。
 */
import { all } from '../db/index.js';
import { DEFAULT_DIFFICULTIES, type DifficultyDef } from './difficulty-defaults.js';

export { DEFAULT_DIFFICULTIES };
export type { DifficultyDef };

let cache: DifficultyDef[] | null = null;

export function invalidateDifficulties(): void {
  cache = null;
}

export function difficultyDefs(): DifficultyDef[] {
  if (cache) return cache;
  let rows: any[] = [];
  try {
    rows = all<any>('SELECT id, level, name, color, color_dark FROM difficulties ORDER BY level ASC');
  } catch {
    rows = [];
  }
  cache = rows.length
    ? rows.map((row) => ({
        id: Number(row.id),
        level: Number(row.level),
        name: String(row.name),
        color: String(row.color || '#52c41a'),
        colorDark: String(row.color_dark || row.color || '#52c41a'),
      }))
    : DEFAULT_DIFFICULTIES;
  return cache;
}

/** 取某个难度等级的定义，越界时退回最低等级 */
export function difficultyOf(level: number): DifficultyDef {
  const list = difficultyDefs();
  return list.find((item) => item.level === Number(level)) ?? list[0]!;
}

export function maxDifficultyLevel(): number {
  const list = difficultyDefs();
  return list[list.length - 1]?.level ?? 1;
}
