import { all, get } from '../db/index.js';
import type { AuthUser } from '../lib/auth.js';
import { json as settingJson, num, str } from '../settings/index.js';

export const DIFFICULTY_NAMES = [
  '入门',
  '普及',
  '提高',
  'NOIP',
  'NOI',
  'IOI',
];

export const DIFFICULTY_COLORS = [
  '#52c41a', // 入门 - 绿
  '#3498db', // 普及 - 蓝
  '#9d3dcf', // 提高 - 紫
  '#f39c11', // NOIP - 橙
  '#fe4c61', // NOI  - 红
  '#111827', // IOI  - 黑
];

/** 深色模式下使用的配色：黑色在深底上不可读，换成浅灰 */
export const DIFFICULTY_COLORS_DARK = [
  '#52c41a',
  '#3498db',
  '#9d3dcf',
  '#f39c11',
  '#fe4c61',
  '#e5e7eb',
];

export interface UserBrief {
  id: number;
  username: string;
  display_name: string | null;
  avatar: string | null;
  role: string;
  points?: number;
  solved_count?: number;
  rating?: number;
  bio?: string;
}

export function userBrief(row: any): UserBrief | null {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name ?? null,
    avatar: row.avatar ?? null,
    role: row.role ?? 'user',
    points: row.points,
    solved_count: row.solved_count,
    rating: row.rating,
  };
}

export function levelOf(solvedCount: number): { name: string; index: number; next: number } {
  const names = settingJson<string[]>('level_names', ['新手上路']);
  const thresholds = settingJson<number[]>('level_thresholds', [0]);
  let index = 0;
  for (let i = 0; i < thresholds.length; i += 1) {
    if (solvedCount >= (thresholds[i] ?? 0)) index = i;
  }
  return {
    name: names[index] ?? names[names.length - 1] ?? '新手上路',
    index,
    next: thresholds[index + 1] ?? -1,
  };
}

export function tagRows(problemIds: number[]): Map<number, any[]> {
  const map = new Map<number, any[]>();
  if (!problemIds.length) return map;
  const rows = all<any>(
    `SELECT pt.problem_id, t.id, t.name, t.color, t.category
       FROM problem_tags pt JOIN tags t ON t.id = pt.tag_id
      WHERE pt.problem_id IN (${problemIds.map(() => '?').join(',')})`,
    problemIds,
  );
  for (const row of rows) {
    const list = map.get(row.problem_id) ?? [];
    list.push({ id: row.id, name: row.name, color: row.color, category: row.category });
    map.set(row.problem_id, list);
  }
  return map;
}

export function problemSummary(row: any, options: { tags?: any[]; showRate?: boolean } = {}) {
  const total = row.submit_count ?? 0;
  const accepted = row.accepted_count ?? 0;
  return {
    id: row.id,
    pid: row.pid,
    title: row.title,
    difficulty: row.difficulty,
    difficultyName: DIFFICULTY_NAMES[row.difficulty - 1] ?? DIFFICULTY_NAMES[0],
    difficultyColor: DIFFICULTY_COLORS[row.difficulty - 1] ?? DIFFICULTY_COLORS[0],
    difficultyColorDark: DIFFICULTY_COLORS_DARK[row.difficulty - 1] ?? DIFFICULTY_COLORS_DARK[0],
    tags: options.tags ?? [],
    provider: row.provider ?? '',
    submitCount: total,
    acceptedCount: accepted,
    passRate: options.showRate === false ? undefined : total > 0 ? Math.round((accepted / total) * 1000) / 10 : 0,
    timeLimit: row.time_limit,
    memoryLimit: row.memory_limit,
    isPublic: Boolean(row.is_public),
    reviewStatus: row.review_status,
    sourceType: row.source_type,
    createdAt: row.created_at,
    author: row.author_name
      ? { id: row.author_id, username: row.author_name, display_name: row.author_display }
      : null,
  };
}

export function submissionSummary(row: any) {
  return {
    id: row.id,
    problemId: row.problem_id,
    problemPid: row.pid,
    problemTitle: row.problem_title,
    user: {
      id: row.user_id,
      username: row.username,
      display_name: row.display_name,
      avatar: row.avatar,
    },
    language: row.language,
    status: row.status,
    score: row.score,
    timeMs: row.time_ms,
    memoryKb: row.memory_kb,
    codeLength: row.code_length,
    contestId: row.contest_id,
    createdAt: row.created_at,
  };
}

export function canSeePrivate(user: AuthUser | null, ownerId: number): boolean {
  if (!user) return false;
  if (user.id === ownerId) return true;
  return user.role === 'admin' || user.role === 'superadmin';
}

export function problemVisibilityClause(): string {
  return 'p.is_public = 1 AND p.review_status = \'approved\' AND p.deleted_at IS NULL';
}

export function isProblemVisibleTo(row: any, user: AuthUser | null): boolean {
  if (!row) return false;
  if (row.is_public && row.review_status === 'approved' && !row.deleted_at) return true;
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'superadmin') return true;
  if (row.owner_id === user.id || row.author_id === user.id) return true;
  return false;
}

export function nextProblemPid(): string {
  const prefix = str('problem_id_prefix', 'P') || 'P';
  const start = num('problem_id_start', 1001);
  const rows = all<{ pid: string }>(
    `SELECT pid FROM problems WHERE pid LIKE ? ORDER BY LENGTH(pid) DESC, pid DESC LIMIT 2000`,
    [`${prefix}%`],
  );
  let max = start - 1;
  for (const row of rows) {
    const numeric = Number(row.pid.slice(prefix.length));
    if (Number.isFinite(numeric) && numeric > max) max = numeric;
  }
  return `${prefix}${Math.max(max + 1, start)}`;
}

export function problemDetailExtras(problemId: number, user: AuthUser | null) {
  const stats = get<any>(
    'SELECT attempts, accepted, first_ac_at FROM user_problem_stats WHERE user_id = ? AND problem_id = ?',
    [user?.id ?? 0, problemId],
  );
  const votes = get<{ avg: number | null; count: number }>(
    'SELECT AVG(score) AS avg, COUNT(*) AS count FROM problem_votes WHERE problem_id = ?',
    [problemId],
  );
  return {
    myStats: stats
      ? { attempts: stats.attempts, accepted: stats.accepted, firstAcAt: stats.first_ac_at }
      : { attempts: 0, accepted: 0, firstAcAt: null },
    difficultyVote: {
      average: votes?.avg ? Math.round((votes.avg as number) * 10) / 10 : null,
      count: votes?.count ?? 0,
    },
  };
}
