import type { FastifyInstance } from 'fastify';
import { all, count, get, run, tx } from '../db/index.js';
import { hasRole, requireUser } from '../lib/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { bool } from '../settings/index.js';
import { parseId, parsePage, slugify, sqlLike, uniqueSlug } from '../lib/util.js';
import { problemSummary, tagRows } from './helpers.js';

export async function registerListRoutes(app: FastifyInstance): Promise<void> {
  /* ----------------------------------------------------------------- 题单 */
  app.get('/api/lists', async (request) => {
    const query = request.query as any;
    const page = parsePage(query, 20);
    const conditions = ['l.is_deleted = 0'];
    const params: unknown[] = [];
    if (query.type && ['official', 'user', 'training'].includes(query.type)) {
      conditions.push('l.type = ?');
      params.push(String(query.type));
    } else if (!hasRole(request.user, 'admin')) {
      conditions.push('l.is_public = 1');
    }
    if (query.mine === 'true') {
      const user = requireUser(request);
      conditions.push('l.author_id = ?');
      params.push(user.id);
    }
    if (query.q) {
      conditions.push(`(l.title LIKE ? ESCAPE '\\' OR l.description LIKE ? ESCAPE '\\')`);
      const like = sqlLike(String(query.q));
      params.push(like, like);
    }
    const items = all<any>(
      `SELECT l.*, u.username, u.display_name, u.avatar,
              (SELECT COUNT(*) FROM list_problems lp WHERE lp.list_id = l.id) AS problem_count
         FROM lists l JOIN users u ON u.id = l.author_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY l.type = 'official' DESC, l.id DESC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    const total = count(`SELECT COUNT(*) AS c FROM lists l WHERE ${conditions.join(' AND ')}`, params);
    return { items, total, page: page.page, size: page.size };
  });

  app.get('/api/lists/:id', async (request) => {
    const id = parseId((request.params as any).id);
    const list = get<any>(
      `SELECT l.*, u.username, u.display_name, u.avatar FROM lists l JOIN users u ON u.id = l.author_id
        WHERE l.id = ? AND l.is_deleted = 0`,
      [id],
    );
    if (!list) throw notFound('题单不存在');
    const viewer = request.user;
    const canEdit = Boolean(viewer && (viewer.id === list.author_id || hasRole(viewer, 'admin')));
    if (!list.is_public && !canEdit) throw forbidden('该题单未公开');
    run('UPDATE lists SET views = views + 1 WHERE id = ?', [id]);

    const problems = all<any>(
      `SELECT p.*, lp.order_no, lp.note, u.username AS author_name, u.display_name AS author_display,
              (SELECT status FROM list_progress pr WHERE pr.list_id = lp.list_id AND pr.user_id = ? AND pr.problem_id = p.id) AS my_status,
              (SELECT accepted FROM user_problem_stats st WHERE st.user_id = ? AND st.problem_id = p.id) AS my_accepted
         FROM list_problems lp JOIN problems p ON p.id = lp.problem_id
         LEFT JOIN users u ON u.id = p.author_id
        WHERE lp.list_id = ? AND p.deleted_at IS NULL ORDER BY lp.order_no ASC`,
      [viewer?.id ?? 0, viewer?.id ?? 0, id],
    );
    const tagMap = tagRows(problems.map((p) => p.id));
    const myProgress = problems.map((p) => ({
      problemId: p.id,
      status: p.my_accepted ? 'done' : (p.my_status ?? 'todo'),
      accepted: Boolean(p.my_accepted),
    }));
    const favorited = viewer
      ? Boolean(get('SELECT 1 AS x FROM list_favorites WHERE list_id = ? AND user_id = ?', [id, viewer.id]))
      : false;
    return {
      list: { ...list, canEdit },
      favorited,
      problems: problems.map((problem) => ({
        ...problemSummary(problem, { tags: tagMap.get(problem.id) ?? [] }),
        order: problem.order_no,
        note: problem.note,
        myStatus: problem.my_accepted ? 'done' : (problem.my_status ?? 'todo'),
        myAccepted: Boolean(problem.my_accepted),
      })),
      progress: {
        total: problems.length,
        done: myProgress.filter((p) => p.status === 'done').length,
        items: myProgress,
      },
    };
  });

  app.post('/api/lists', async (request) => {
    const user = requireUser(request);
    const body = (request.body ?? {}) as any;
    const title = String(body.title ?? '').trim();
    if (title.length < 2) throw badRequest('题单名称至少 2 个字符');
    const type = hasRole(user, 'admin') && body.type === 'official' ? 'official' : 'user';
    const info = run(
      `INSERT INTO lists (title, description, cover, type, difficulty, author_id, is_public)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        title.slice(0, 120),
        String(body.description ?? ''),
        String(body.cover ?? ''),
        type,
        Math.max(0, Number(body.difficulty ?? 0) || 0),
        user.id,
        body.isPublic === false ? 0 : 1,
      ],
    );
    const listId = Number(info.lastInsertRowid);
    if (Array.isArray(body.problemIds)) setListProblems(listId, body.problemIds);
    audit(request, 'list.create', { targetType: 'list', targetId: listId, detail: { title } });
    return { ok: true, id: listId };
  });

  app.put('/api/lists/:id', async (request) => {
    const user = requireUser(request);
    const id = parseId((request.params as any).id);
    const list = get<any>('SELECT * FROM lists WHERE id = ? AND is_deleted = 0', [id]);
    if (!list) throw notFound('题单不存在');
    if (list.author_id !== user.id && !hasRole(user, 'admin')) throw forbidden();
    const body = (request.body ?? {}) as any;
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of [
      ['title', 'title'],
      ['description', 'description'],
      ['cover', 'cover'],
    ] as const) {
      if (body[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push(String(body[key]));
      }
    }
    if (body.difficulty !== undefined) {
      fields.push('difficulty = ?');
      values.push(Math.max(0, Number(body.difficulty) || 0));
    }
    if (body.isPublic !== undefined) {
      fields.push('is_public = ?');
      values.push(body.isPublic ? 1 : 0);
    }
    if (body.type !== undefined && hasRole(user, 'admin')) {
      fields.push('type = ?');
      values.push(String(body.type));
    }
    if (fields.length) {
      fields.push(`updated_at = datetime('now')`);
      run(`UPDATE lists SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    }
    if (Array.isArray(body.problemIds)) setListProblems(id, body.problemIds);
    return { ok: true };
  });

  app.delete('/api/lists/:id', async (request) => {
    const user = requireUser(request);
    const id = parseId((request.params as any).id);
    const list = get<any>('SELECT * FROM lists WHERE id = ?', [id]);
    if (!list) throw notFound('题单不存在');
    if (list.author_id !== user.id && !hasRole(user, 'admin')) throw forbidden();
    run('UPDATE lists SET is_deleted = 1, is_public = 0 WHERE id = ?', [id]);
    return { ok: true };
  });

  app.post('/api/lists/:id/favorite', async (request) => {
    const user = requireUser(request);
    const id = parseId((request.params as any).id);
    const existing = get('SELECT 1 AS x FROM list_favorites WHERE list_id = ? AND user_id = ?', [id, user.id]);
    if (existing) {
      run('DELETE FROM list_favorites WHERE list_id = ? AND user_id = ?', [id, user.id]);
      run('UPDATE lists SET favorites = MAX(0, favorites - 1) WHERE id = ?', [id]);
      return { ok: true, favorited: false };
    }
    run('INSERT INTO list_favorites (list_id, user_id) VALUES (?, ?)', [id, user.id]);
    run('UPDATE lists SET favorites = favorites + 1 WHERE id = ?', [id]);
    return { ok: true, favorited: true };
  });

  app.post('/api/lists/:id/progress', async (request) => {
    const user = requireUser(request);
    const id = parseId((request.params as any).id);
    const body = (request.body ?? {}) as any;
    const problemId = Number(body.problemId);
    const status = ['todo', 'doing', 'done'].includes(body.status) ? body.status : 'todo';
    if (!problemId) throw badRequest('缺少题目');
    run(
      `INSERT INTO list_progress (list_id, user_id, problem_id, status) VALUES (?, ?, ?, ?)
       ON CONFLICT(list_id, user_id, problem_id) DO UPDATE SET status = excluded.status,
         updated_at = datetime('now')`,
      [id, user.id, problemId, status],
    );
    return { ok: true };
  });

  /* 团队相关接口见 routes/teams.ts */
}

function setListProblems(listId: number, problemIds: unknown[]): void {
  const ids = problemIds.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  tx(() => {
    const existing = all<any>('SELECT problem_id, note FROM list_problems WHERE list_id = ?', [listId]);
    const notes = new Map(existing.map((row) => [row.problem_id, row.note]));
    run('DELETE FROM list_problems WHERE list_id = ?', [listId]);
    ids.forEach((problemId, index) => {
      run('INSERT INTO list_problems (list_id, problem_id, order_no, note) VALUES (?, ?, ?, ?)', [
        listId,
        problemId,
        index + 1,
        notes.get(problemId) ?? '',
      ]);
    });
  });
}
