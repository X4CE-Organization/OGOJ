import type { FastifyInstance } from 'fastify';
import { all, count, get, run } from '../db/index.js';
import { canSeeRoles, displayRole, hasRole, requireUser } from '../lib/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { bool, num } from '../settings/index.js';
import { parseId, parsePage, sqlLike } from '../lib/util.js';
import { problemSummary, submissionSummary, tagRows, levelOf } from './helpers.js';
import { publicUser } from './auth.js';

function findUser(usernameOrId: string): any {
  const numeric = Number(usernameOrId);
  const row = Number.isInteger(numeric) && String(numeric) === usernameOrId
    ? get<any>('SELECT * FROM users WHERE id = ?', [numeric])
    : get<any>('SELECT * FROM users WHERE username = ?', [usernameOrId]);
  if (!row) throw notFound('用户不存在');
  return row;
}

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------------------------------------------ list */
  app.get('/api/users', async (request) => {
    const query = request.query as any;
    const page = parsePage(query, num('user_list_page_size', 50));
    const conditions = ['is_banned = 0'];
    const params: unknown[] = [];
    if (query.q) {
      conditions.push(`(username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')`);
      const like = sqlLike(String(query.q));
      params.push(like, like);
    }
    // Only administrators may filter by role, otherwise anybody could look up
    // which accounts are staff members.
    if (query.role && canSeeRoles(request.user)) {
      conditions.push('role = ?');
      params.push(String(query.role));
    }
    const column =
      query.sort === 'points'
        ? 'points'
        : query.sort === 'rating'
          ? 'rating'
          : query.sort === 'newest'
            ? 'id'
            : 'solved_count';
    const direction = query.sort === 'newest' ? 'DESC' : 'DESC';
    const rows = all<any>(
      `SELECT id, username, display_name, avatar, bio, role, points, rating, solved_count,
              submission_count, accepted_count, created_at, last_login_at
         FROM users WHERE ${conditions.join(' AND ')}
        ORDER BY ${column} ${direction}, id ASC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    const total = count(`SELECT COUNT(*) AS c FROM users WHERE ${conditions.join(' AND ')}`, params);
    const viewer = request.user;
    return {
      items: rows.map((row) => ({
        ...row,
        role: displayRole(row.role, viewer, viewer?.id === row.id),
        level: levelOf(row.solved_count ?? 0),
      })),
      total,
      page: page.page,
      size: page.size,
      canSeeRoles: canSeeRoles(viewer),
    };
  });

  /* --------------------------------------------------------------- profile */
  app.get('/api/users/:username', async (request) => {
    const row = findUser(String((request.params as any).username));
    const viewer = request.user;
    const isSelf = viewer?.id === row.id;
    const isAdmin = hasRole(viewer, 'admin');
    const followers = count('SELECT COUNT(*) AS c FROM follows WHERE followee_id = ?', [row.id]);
    const following = count('SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?', [row.id]);
    const isFollowing = viewer
      ? Boolean(get('SELECT 1 AS x FROM follows WHERE follower_id = ? AND followee_id = ?', [viewer.id, row.id]))
      : false;
    const canSeeRecords = isSelf || isAdmin || !row.is_private;

    const solvedByDifficulty = canSeeRecords
      ? all<any>(
          `SELECT p.difficulty, COUNT(DISTINCT p.id) AS c
             FROM user_problem_stats s JOIN problems p ON p.id = s.problem_id
            WHERE s.user_id = ? AND s.accepted > 0 GROUP BY p.difficulty`,
          [row.id],
        )
      : [];
    const recentSubmissions = canSeeRecords
      ? all<any>(
          `SELECT s.id, s.problem_id, s.user_id, s.language, s.status, s.score, s.time_ms, s.memory_kb,
                  s.code_length, s.contest_id, s.created_at, p.pid, p.title AS problem_title,
                  u.username, u.display_name, u.avatar
             FROM submissions s JOIN problems p ON p.id = s.problem_id JOIN users u ON u.id = s.user_id
            WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 15`,
          [row.id],
        )
      : [];
    const solvedProblems = canSeeRecords
      ? all<any>(
          `SELECT p.*, st.first_ac_at, u.username AS author_name, u.display_name AS author_display
             FROM user_problem_stats st JOIN problems p ON p.id = st.problem_id
             LEFT JOIN users u ON u.id = p.author_id
            WHERE st.user_id = ? AND st.accepted > 0 AND p.deleted_at IS NULL
            ORDER BY st.first_ac_at DESC LIMIT 60`,
          [row.id],
        )
      : [];
    const tagMap = tagRows(solvedProblems.map((p) => p.id));
    const contestHistory = canSeeRecords
      ? all<any>(
          `SELECT c.id, c.title, c.rules, c.start_time, c.end_time, r.registered_at
             FROM contest_registrations r JOIN contests c ON c.id = r.contest_id
            WHERE r.user_id = ? ORDER BY c.start_time DESC LIMIT 20`,
          [row.id],
        )
      : [];
    const stats = get<any>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'AC' THEN 1 ELSE 0 END) AS accepted,
              COUNT(DISTINCT problem_id) AS problems
         FROM submissions WHERE user_id = ?`,
      [row.id],
    );
    const rank = count('SELECT COUNT(*) AS c FROM users WHERE solved_count > ?', [row.solved_count ?? 0]) + 1;

    return {
      profile: {
        ...publicUser(row),
        role: displayRole(row.role, viewer, isSelf),
        email: isSelf || isAdmin ? row.email : row.show_email ? row.email : null,
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at,
        rank,
        followers,
        following,
        isFollowing,
        isSelf,
        canSeeRecords,
        solvedByDifficulty,
        totalSubmissions: stats?.total ?? 0,
        acceptedSubmissions: stats?.accepted ?? 0,
        acceptanceRate:
          stats?.total > 0 ? Math.round(((stats.accepted ?? 0) / stats.total) * 1000) / 10 : 0,
      },
      recentSubmissions: recentSubmissions.map(submissionSummary),
      solvedProblems: solvedProblems.map((problem) => ({
        ...problemSummary(problem, { tags: tagMap.get(problem.id) ?? [] }),
        firstAcAt: problem.first_ac_at,
      })),
      contestHistory,
    };
  });

  app.get('/api/users/:username/submissions', async (request) => {
    const row = findUser(String((request.params as any).username));
    const viewer = request.user;
    if (row.is_private && viewer?.id !== row.id && !hasRole(viewer, 'admin')) {
      throw forbidden('该用户隐藏了提交记录');
    }
    const query = request.query as any;
    const page = parsePage(query, num('submission_page_size', 50));
    const conditions = ['s.user_id = ?'];
    const params: unknown[] = [row.id];
    if (query.status) {
      conditions.push('s.status = ?');
      params.push(String(query.status));
    }
    if (query.language) {
      conditions.push('s.language = ?');
      params.push(String(query.language));
    }
    const items = all<any>(
      `SELECT s.id, s.problem_id, s.user_id, s.language, s.status, s.score, s.time_ms, s.memory_kb,
              s.code_length, s.contest_id, s.created_at, p.pid, p.title AS problem_title,
              u.username, u.display_name, u.avatar
         FROM submissions s JOIN problems p ON p.id = s.problem_id JOIN users u ON u.id = s.user_id
        WHERE ${conditions.join(' AND ')} ORDER BY s.id DESC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    const total = count(
      `SELECT COUNT(*) AS c FROM submissions s WHERE ${conditions.join(' AND ')}`,
      params,
    );
    return { items: items.map(submissionSummary), total, page: page.page, size: page.size };
  });

  app.get('/api/users/:username/points', async (request) => {
    const row = findUser(String((request.params as any).username));
    const viewer = request.user;
    if (viewer?.id !== row.id && !hasRole(viewer, 'admin')) {
      throw forbidden('只能查看自己的积分记录');
    }
    const page = parsePage(request.query as any, 50);
    const items = all<any>(
      'SELECT * FROM point_logs WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
      [row.id, page.size, page.offset],
    );
    return {
      balance: row.points,
      items,
      total: count('SELECT COUNT(*) AS c FROM point_logs WHERE user_id = ?', [row.id]),
      page: page.page,
      size: page.size,
    };
  });

  /* ----------------------------------------------------------------- follow */
  app.post('/api/users/:username/follow', async (request) => {
    const user = requireUser(request);
    if (!bool('allow_follow', true)) throw forbidden('本站已关闭关注功能');
    const target = findUser(String((request.params as any).username));
    if (target.id === user.id) throw badRequest('不能关注自己');
    const existing = get('SELECT 1 AS x FROM follows WHERE follower_id = ? AND followee_id = ?', [
      user.id,
      target.id,
    ]);
    if (existing) {
      run('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?', [user.id, target.id]);
      return { ok: true, following: false };
    }
    run('INSERT INTO follows (follower_id, followee_id) VALUES (?, ?)', [user.id, target.id]);
    return { ok: true, following: true };
  });

  app.get('/api/users/:username/followers', async (request) => {
    const row = findUser(String((request.params as any).username));
    const items = all<any>(
      `SELECT u.id, u.username, u.display_name, u.avatar, u.solved_count, f.created_at
         FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followee_id = ?
        ORDER BY f.created_at DESC LIMIT 500`,
      [row.id],
    );
    return { items };
  });

  app.get('/api/users/:username/following', async (request) => {
    const row = findUser(String((request.params as any).username));
    const items = all<any>(
      `SELECT u.id, u.username, u.display_name, u.avatar, u.solved_count, f.created_at
         FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ?
        ORDER BY f.created_at DESC LIMIT 500`,
      [row.id],
    );
    return { items };
  });

  /* ------------------------------------------------------ 用户题目通过情况 */
  app.get('/api/users/:username/problems', async (request) => {
    const row = findUser(String((request.params as any).username));
    const viewer = request.user;
    if (row.is_private && viewer?.id !== row.id && !hasRole(viewer, 'admin')) {
      throw forbidden('该用户隐藏了通过题目');
    }
    const query = request.query as any;
    const status = query.status === 'todo' ? 'todo' : 'accepted';
    const page = parsePage(query, 50);
    const condition =
      status === 'accepted'
        ? 'st.accepted > 0'
        : 'st.accepted = 0 AND st.attempts > 0';
    const items = all<any>(
      `SELECT p.*, st.attempts, st.accepted, st.first_ac_at, u.username AS author_name, u.display_name AS author_display
         FROM user_problem_stats st JOIN problems p ON p.id = st.problem_id
         LEFT JOIN users u ON u.id = p.author_id
        WHERE st.user_id = ? AND ${condition} AND p.deleted_at IS NULL
        ORDER BY st.last_submit_at DESC LIMIT ? OFFSET ?`,
      [row.id, page.size, page.offset],
    );
    const total = count(
      `SELECT COUNT(*) AS c FROM user_problem_stats st JOIN problems p ON p.id = st.problem_id
        WHERE st.user_id = ? AND ${condition} AND p.deleted_at IS NULL`,
      [row.id],
    );
    const tagMap = tagRows(items.map((i) => i.id));
    return {
      items: items.map((item) => ({
        ...problemSummary(item, { tags: tagMap.get(item.id) ?? [] }),
        attempts: item.attempts,
        accepted: item.accepted,
        firstAcAt: item.first_ac_at,
      })),
      total,
      page: page.page,
      size: page.size,
    };
  });

  app.get('/api/users/:username/rating-history', async (request) => {
    const row = findUser(String((request.params as any).username));
    const items = all<any>(
      `SELECT c.id, c.title, c.rules, c.start_time, c.end_time, r.registered_at
         FROM contest_registrations r JOIN contests c ON c.id = r.contest_id
        WHERE r.user_id = ? ORDER BY c.start_time ASC`,
      [row.id],
    );
    return { items, rating: row.rating };
  });

  app.get('/api/users/:username/solutions', async (request) => {
    const row = findUser(String((request.params as any).username));
    const items = all<any>(
      `SELECT s.id, s.title, s.upvotes, s.views, s.created_at, s.is_public, p.pid, p.title AS problem_title
         FROM solutions s JOIN problems p ON p.id = s.problem_id
        WHERE s.author_id = ? AND s.is_deleted = 0 ORDER BY s.id DESC LIMIT 100`,
      [row.id],
    );
    return { items };
  });

  app.get('/api/users/:username/articles', async (request) => {
    const row = findUser(String((request.params as any).username));
    const items = all<any>(
      `SELECT id, title, summary, views, category, created_at FROM articles
        WHERE author_id = ? AND is_deleted = 0 ORDER BY id DESC LIMIT 100`,
      [row.id],
    );
    return { items };
  });

  app.get('/api/users/:username/discussions', async (request) => {
    const row = findUser(String((request.params as any).username));
    const items = all<any>(
      `SELECT d.id, d.title, d.reply_count, d.views, d.created_at FROM discussions d
        WHERE d.author_id = ? AND d.is_deleted = 0 ORDER BY d.id DESC LIMIT 100`,
      [row.id],
    );
    return { items };
  });

  /* ------------------------------------------------------------ 兑换配额 */
  app.get('/api/me/grants', async (request) => {
    const user = requireUser(request);
    const rows = all<any>(
      `SELECT id, kind, total, used, expires_at, note, created_at FROM grants
        WHERE user_id = ? ORDER BY id DESC`,
      [user.id],
    );
    const summary: Record<string, number> = {};
    for (const row of rows) {
      if (row.expires_at && new Date(`${row.expires_at.replace(' ', 'T')}Z`).getTime() < Date.now()) continue;
      summary[row.kind] = (summary[row.kind] ?? 0) + Math.max(0, row.total - row.used);
    }
    return { grants: rows, available: summary };
  });

  app.get('/api/me/overview', async (request) => {
    const user = requireUser(request);
    const todaySubmissions = count(
      `SELECT COUNT(*) AS c FROM submissions WHERE user_id = ? AND created_at >= date('now')`,
      [user.id],
    );
    const recentSubmissions = all<any>(
      `SELECT s.id, s.status, s.score, s.created_at, s.language, p.pid, p.title AS problem_title
         FROM submissions s JOIN problems p ON p.id = s.problem_id
        WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 10`,
      [user.id],
    );
    const solvedByDifficulty = all<any>(
      `SELECT p.difficulty, COUNT(DISTINCT p.id) AS c
         FROM user_problem_stats st JOIN problems p ON p.id = st.problem_id
        WHERE st.user_id = ? AND st.accepted > 0 GROUP BY p.difficulty`,
      [user.id],
    );
    const upcomingContests = all<any>(
      `SELECT c.id, c.title, c.start_time, c.end_time, c.rules FROM contests c
        WHERE c.is_public = 1 AND c.review_status = 'approved' AND c.end_time > datetime('now')
        ORDER BY c.start_time ASC LIMIT 5`,
    );
    const row = get<any>('SELECT * FROM users WHERE id = ?', [user.id]);
    return {
      user: publicUser(row),
      points: row.points,
      level: levelOf(row.solved_count ?? 0),
      todaySubmissions,
      recentSubmissions,
      solvedByDifficulty,
      upcomingContests,
      unreadMessages: count('SELECT COUNT(*) AS c FROM messages WHERE to_id = ? AND is_read = 0', [user.id]),
      favorites: count('SELECT COUNT(*) AS c FROM problem_favorites WHERE user_id = ?', [user.id]),
    };
  });
}
