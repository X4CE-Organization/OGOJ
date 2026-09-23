import type { FastifyInstance } from 'fastify';
import { all, count, get, run } from '../db/index.js';
import { publicSettings, bool, num, str, json as settingJson } from '../settings/index.js';
import { parsePage, sqlLike } from '../lib/util.js';
import { DIFFICULTY_COLORS, DIFFICULTY_NAMES, problemSummary, submissionSummary, tagRows } from './helpers.js';
import { AVAILABLE_LANGUAGE_IDS, LANGUAGES } from '../judge/languages.js';
import { judgeStats } from '../judge/index.js';

export async function registerPublicRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async () => ({
    settings: publicSettings(),
    groups: undefined,
  }));

  app.get('/api/meta', async () => {
    const enabled = settingJson<string[]>('enabled_languages', ['cpp']);
    return {
      settings: publicSettings(),
      difficulties: DIFFICULTY_NAMES.map((name, index) => ({
        value: index + 1,
        name,
        color: DIFFICULTY_COLORS[index],
      })),
      languages: LANGUAGES.filter((lang) => AVAILABLE_LANGUAGE_IDS.includes(lang.id)).map((lang) => ({
        id: lang.id,
        name: lang.name,
        editor: lang.editor,
        template: lang.template ?? '',
        enabled: enabled.includes(lang.id),
      })),
      boards: settingJson<any[]>('board_names', []),
      judge: judgeStats(),
    };
  });

  app.get('/api/public/home', async () => {
    const modules = settingJson<string[]>('show_home_modules', []);
    const carousel = bool('enable_carousel', true)
      ? all<any>(
          'SELECT id, title, subtitle, image, link FROM carousel WHERE is_active = 1 ORDER BY sort ASC, id ASC LIMIT 10',
        )
      : [];
    const announcements = all<any>(
      `SELECT id, title, content, type, is_pinned, created_at FROM announcements
        WHERE is_public = 1 ORDER BY is_pinned DESC, id DESC LIMIT 8`,
    );
    const stats = {
      users: count('SELECT COUNT(*) AS c FROM users'),
      problems: count(`SELECT COUNT(*) AS c FROM problems WHERE is_public = 1 AND review_status = 'approved' AND deleted_at IS NULL`),
      submissions: count('SELECT COUNT(*) AS c FROM submissions'),
      accepted: count(`SELECT COUNT(*) AS c FROM submissions WHERE status = 'AC'`),
      contests: count('SELECT COUNT(*) AS c FROM contests WHERE is_public = 1'),
      todaySubmissions: count(`SELECT COUNT(*) AS c FROM submissions WHERE created_at >= date('now')`),
      todayAccepted: count(`SELECT COUNT(*) AS c FROM submissions WHERE status = 'AC' AND created_at >= date('now')`),
    };
    const recentProblems = all<any>(
      `SELECT p.*, u.username AS author_name, u.display_name AS author_display
         FROM problems p LEFT JOIN users u ON u.id = p.author_id
        WHERE p.is_public = 1 AND p.review_status = 'approved' AND p.deleted_at IS NULL
        ORDER BY p.id DESC LIMIT 10`,
    );
    const recentContests = all<any>(
      `SELECT id, title, rules, start_time, end_time, origin FROM contests
        WHERE is_public = 1 AND review_status = 'approved'
          AND end_time > datetime('now', '-30 days')
        ORDER BY start_time DESC LIMIT 6`,
    );
    const recentDiscussions = all<any>(
      `SELECT d.id, d.title, d.reply_count, d.created_at, d.problem_id, u.username, u.display_name, u.avatar
         FROM discussions d JOIN users u ON u.id = d.author_id
        WHERE d.is_deleted = 0 AND d.problem_id IS NULL
        ORDER BY d.id DESC LIMIT 8`,
    );
    const ranklist = all<any>(
      `SELECT id, username, display_name, avatar, solved_count, rating, points
         FROM users WHERE is_banned = 0 ORDER BY solved_count DESC, id ASC LIMIT 10`,
    );
    const tags = all<any>(
      `SELECT t.id, t.name, t.color, COUNT(pt.problem_id) AS use_count
         FROM tags t LEFT JOIN problem_tags pt ON pt.tag_id = t.id
         JOIN problems p ON p.id = pt.problem_id AND p.is_public = 1
        GROUP BY t.id HAVING use_count > 0 ORDER BY use_count DESC LIMIT 30`,
    );
    const problemIds = recentProblems.map((p) => p.id);
    const tagMap = tagRows(problemIds);

    return {
      modules,
      notice: str('home_notice', ''),
      carousel,
      announcements,
      stats,
      recentProblems: recentProblems.map((row) => problemSummary(row, { tags: tagMap.get(row.id) ?? [] })),
      recentContests: recentContests.map((row) => ({
        ...row,
        status: contestStatus(row.start_time, row.end_time),
      })),
      recentDiscussions,
      ranklist,
      tags,
    };
  });

  app.get('/api/public/announcements', async (request) => {
    const page = parsePage(request.query as any, 20);
    const rows = all<any>(
      `SELECT a.*, u.username AS author_name, u.display_name AS author_display
         FROM announcements a LEFT JOIN users u ON u.id = a.author_id
        WHERE a.is_public = 1
        ORDER BY a.is_pinned DESC, a.id DESC LIMIT ? OFFSET ?`,
      [page.size, page.offset],
    );
    const total = count('SELECT COUNT(*) AS c FROM announcements WHERE is_public = 1');
    return { items: rows, total, page: page.page, size: page.size };
  });

  app.get('/api/public/announcements/:id', async (request) => {
    const id = Number((request.params as any).id);
    const row = get<any>('SELECT * FROM announcements WHERE id = ? AND is_public = 1', [id]);
    if (!row) return { announcement: null };
    run('UPDATE announcements SET views = views + 1 WHERE id = ?', [id]);
    return { announcement: row };
  });

  app.get('/api/public/stats', async () => {
    const weeks = all<{ day: string; total: number; accepted: number }>(
      `SELECT date(created_at) AS day, COUNT(*) AS total,
              SUM(CASE WHEN status = 'AC' THEN 1 ELSE 0 END) AS accepted
         FROM submissions WHERE created_at >= date('now', '-13 days')
        GROUP BY day ORDER BY day ASC`,
    );
    const statusDistribution = all<{ status: string; c: number }>(
      'SELECT status, COUNT(*) AS c FROM submissions GROUP BY status ORDER BY c DESC',
    );
    const languageDistribution = all<{ language: string; c: number }>(
      'SELECT language, COUNT(*) AS c FROM submissions GROUP BY language ORDER BY c DESC',
    );
    const difficultyDistribution = all<{ difficulty: number; c: number }>(
      `SELECT difficulty, COUNT(*) AS c FROM problems
        WHERE is_public = 1 AND review_status = 'approved' AND deleted_at IS NULL GROUP BY difficulty`,
    );
    return { weeks, statusDistribution, languageDistribution, difficultyDistribution };
  });

  app.get('/api/public/rank', async (request) => {
    const query = request.query as any;
    const page = parsePage(query, 50);
    const sortBy = ['solved', 'points', 'rating', 'submissions'].includes(query.sort) ? query.sort : 'solved';
    const column =
      sortBy === 'points'
        ? 'points'
        : sortBy === 'rating'
          ? 'rating'
          : sortBy === 'submissions'
            ? 'submission_count'
            : 'solved_count';
    const search = String(query.q ?? '').trim();
    const where = search ? 'WHERE username LIKE ? ESCAPE \'\\\' OR display_name LIKE ? ESCAPE \'\\\'' : '';
    const params = search ? [sqlLike(search), sqlLike(search)] : [];
    const items = all<any>(
      `SELECT id, username, display_name, avatar, solved_count, points, rating, submission_count, accepted_count
         FROM users ${where} ${where ? 'AND' : 'WHERE'} is_banned = 0
        ORDER BY ${column} DESC, id ASC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    const total = count(
      `SELECT COUNT(*) AS c FROM users ${where} ${where ? 'AND' : 'WHERE'} is_banned = 0`,
      params,
    );
    return {
      items: items.map((row, index) => ({ ...row, rank: page.offset + index + 1 })),
      total,
      page: page.page,
      size: page.size,
      sort: sortBy,
    };
  });

  app.get('/api/public/search', async (request) => {
    const query = request.query as any;
    const term = String(query.q ?? '').trim();
    if (!term) return { problems: [], users: [], discussions: [], articles: [], lists: [] };
    const like = sqlLike(term);
    const limit = Math.min(50, Math.max(1, Number(query.limit ?? 10)));
    const scope = query.scope ? String(query.scope) : 'all';
    const include = (name: string) => scope === 'all' || scope === name;

    const problems = include('problems')
      ? all<any>(
          `SELECT id, pid, title, difficulty, submit_count, accepted_count FROM problems
            WHERE is_public = 1 AND review_status = 'approved' AND deleted_at IS NULL
              AND (title LIKE ? ESCAPE '\\' OR pid LIKE ? ESCAPE '\\')
            ORDER BY id DESC LIMIT ?`,
          [like, like, limit],
        )
      : [];
    const users = include('users')
      ? all<any>(
          `SELECT id, username, display_name, avatar, solved_count, role FROM users
            WHERE (username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\') AND is_banned = 0
            ORDER BY solved_count DESC LIMIT ?`,
          [like, like, limit],
        )
      : [];
    const discussions = include('discussions')
      ? all<any>(
          `SELECT d.id, d.title, d.reply_count, d.created_at, u.username FROM discussions d
             JOIN users u ON u.id = d.author_id
            WHERE d.is_deleted = 0 AND d.title LIKE ? ESCAPE '\\' ORDER BY d.id DESC LIMIT ?`,
          [like, limit],
        )
      : [];
    const articles = include('articles')
      ? all<any>(
          `SELECT a.id, a.title, a.summary, a.created_at, u.username FROM articles a
             JOIN users u ON u.id = a.author_id
            WHERE a.is_public = 1 AND a.is_deleted = 0 AND (a.title LIKE ? ESCAPE '\\' OR a.summary LIKE ? ESCAPE '\\')
            ORDER BY a.id DESC LIMIT ?`,
          [like, like, limit],
        )
      : [];
    const lists = include('lists')
      ? all<any>(
          `SELECT id, title, description, type, author_id FROM lists
            WHERE is_public = 1 AND is_deleted = 0 AND title LIKE ? ESCAPE '\\' LIMIT ?`,
          [like, limit],
        )
      : [];
    return { problems, users, discussions, articles, lists };
  });

  app.get('/api/public/problems/tags', async () => {
    return { tags: all<any>('SELECT * FROM tags ORDER BY sort ASC, id ASC') };
  });

  app.get('/api/public/submissions', async (request) => {
    if (!bool('show_others_code', true)) return { items: [], total: 0, page: 1, size: 0 };
    const query = request.query as any;
    const page = parsePage(query, num('submission_page_size', 50));
    const items = all<any>(
      `SELECT s.id, s.problem_id, s.user_id, s.language, s.status, s.score, s.time_ms, s.memory_kb,
              s.code_length, s.contest_id, s.created_at,
              p.pid, p.title AS problem_title,
              u.username, u.display_name, u.avatar
         FROM submissions s
         JOIN problems p ON p.id = s.problem_id
         JOIN users u ON u.id = s.user_id
        WHERE s.is_public = 1 AND (s.contest_id IS NULL OR EXISTS (
                SELECT 1 FROM contests c WHERE c.id = s.contest_id AND c.end_time < datetime('now')))
        ORDER BY s.id DESC LIMIT ? OFFSET ?`,
      [page.size, page.offset],
    );
    return { items: items.map(submissionSummary), page: page.page, size: page.size };
  });
}

export function contestStatus(start: string, end: string): 'upcoming' | 'running' | 'ended' {
  const parse = (value: string) => {
    if (!value) return Number.NaN;
    if (value.includes('T') || value.includes('Z')) return new Date(value).getTime();
    return new Date(`${value.replace(' ', 'T')}Z`).getTime();
  };
  const now = Date.now();
  const startAt = parse(start);
  const endAt = parse(end);
  if (now < startAt) return 'upcoming';
  if (now > endAt) return 'ended';
  return 'running';
}
