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

  /* ----------------------------------------------------------------- 团队 */
  app.get('/api/teams', async (request) => {
    const query = request.query as any;
    const page = parsePage(query, 20);
    const conditions = ['1 = 1'];
    const params: unknown[] = [];
    if (!hasRole(request.user, 'admin')) conditions.push('t.is_public = 1');
    if (query.q) {
      conditions.push(`(t.name LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')`);
      const like = sqlLike(String(query.q));
      params.push(like, like);
    }
    if (query.mine === 'true') {
      const user = requireUser(request);
      conditions.push('EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = t.id AND tm.user_id = ?)');
      params.push(user.id);
    }
    const items = all<any>(
      `SELECT t.*, u.username AS owner_name FROM teams t JOIN users u ON u.id = t.owner_id
        WHERE ${conditions.join(' AND ')} ORDER BY t.member_count DESC, t.id ASC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    const total = count(`SELECT COUNT(*) AS c FROM teams t WHERE ${conditions.join(' AND ')}`, params);
    return { items, total, page: page.page, size: page.size };
  });

  app.get('/api/teams/:slug', async (request) => {
    const slug = String((request.params as any).slug);
    const team = get<any>('SELECT * FROM teams WHERE slug = ?', [slug]);
    if (!team) throw notFound('团队不存在');
    const viewer = request.user;
    const membership = viewer
      ? get<any>('SELECT * FROM team_members WHERE team_id = ? AND user_id = ?', [team.id, viewer.id])
      : null;
    if (!team.is_public && !membership && !hasRole(viewer, 'admin')) throw forbidden('该团队未公开');
    const members = all<any>(
      `SELECT u.id, u.username, u.display_name, u.avatar, u.solved_count, u.role AS user_role, tm.role, tm.joined_at
         FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = ?
        ORDER BY CASE tm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, tm.joined_at ASC`,
      [team.id],
    );
    const announcements = membership || team.is_public
      ? all<any>(
          `SELECT a.*, u.username FROM team_announcements a JOIN users u ON u.id = a.author_id
            WHERE a.team_id = ? ORDER BY a.id DESC LIMIT 50`,
          [team.id],
        )
      : [];
    const problems = all<any>(
      `SELECT p.id, p.pid, p.title, p.difficulty FROM team_problems tp JOIN problems p ON p.id = tp.problem_id
        WHERE tp.team_id = ? ORDER BY tp.created_at DESC LIMIT 200`,
      [team.id],
    );
    return {
      team: { ...team, membership: membership?.role ?? null, canManage: membership?.role === 'owner' || membership?.role === 'admin' || hasRole(viewer, 'admin') },
      members,
      announcements,
      problems,
    };
  });

  app.post('/api/teams', async (request) => {
    const user = requireUser(request);
    const body = (request.body ?? {}) as any;
    const name = String(body.name ?? '').trim();
    if (name.length < 2) throw badRequest('团队名称至少 2 个字符');
    if (get('SELECT id FROM teams WHERE name = ?', [name])) throw conflict('团队名称已存在');
    const slug = uniqueSlug(String(body.slug ?? name), (candidate) =>
      Boolean(get('SELECT id FROM teams WHERE slug = ?', [candidate])),
    );
    const teamId = tx(() => {
      const info = run(
        `INSERT INTO teams (name, slug, description, avatar, owner_id, is_public) VALUES (?, ?, ?, ?, ?, ?)`,
        [name, slug, String(body.description ?? ''), String(body.avatar ?? ''), user.id, body.isPublic === false ? 0 : 1],
      );
      const id = Number(info.lastInsertRowid);
      run(`INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'owner')`, [id, user.id]);
      return id;
    });
    audit(request, 'team.create', { targetType: 'team', targetId: teamId, detail: { name } });
    return { ok: true, id: teamId, slug };
  });

  app.put('/api/teams/:slug', async (request) => {
    const user = requireUser(request);
    const team = get<any>('SELECT * FROM teams WHERE slug = ?', [String((request.params as any).slug)]);
    if (!team) throw notFound('团队不存在');
    const membership = get<any>('SELECT * FROM team_members WHERE team_id = ? AND user_id = ?', [team.id, user.id]);
    if (!hasRole(user, 'admin') && membership?.role !== 'owner') throw forbidden('只有团长可以修改团队信息');
    const body = (request.body ?? {}) as any;
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of [
      ['name', 'name'],
      ['description', 'description'],
      ['avatar', 'avatar'],
    ] as const) {
      if (body[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push(String(body[key]));
      }
    }
    if (body.isPublic !== undefined) {
      fields.push('is_public = ?');
      values.push(body.isPublic ? 1 : 0);
    }
    if (fields.length) run(`UPDATE teams SET ${fields.join(', ')} WHERE id = ?`, [...values, team.id]);
    return { ok: true };
  });

  app.delete('/api/teams/:slug', async (request) => {
    const user = requireUser(request);
    const team = get<any>('SELECT * FROM teams WHERE slug = ?', [String((request.params as any).slug)]);
    if (!team) throw notFound('团队不存在');
    if (!hasRole(user, 'admin') && team.owner_id !== user.id) throw forbidden('只有团长或管理员可以解散团队');
    run('DELETE FROM teams WHERE id = ?', [team.id]);
    audit(request, 'team.delete', { targetType: 'team', targetId: team.id });
    return { ok: true };
  });

  app.post('/api/teams/:slug/join', async (request) => {
    const user = requireUser(request);
    const team = get<any>('SELECT * FROM teams WHERE slug = ?', [String((request.params as any).slug)]);
    if (!team) throw notFound('团队不存在');
    const existing = get('SELECT 1 AS x FROM team_members WHERE team_id = ? AND user_id = ?', [team.id, user.id]);
    if (existing) throw conflict('你已经加入该团队');
    run(`INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'member')`, [team.id, user.id]);
    run('UPDATE teams SET member_count = member_count + 1 WHERE id = ?', [team.id]);
    return { ok: true, joined: true };
  });

  app.post('/api/teams/:slug/leave', async (request) => {
    const user = requireUser(request);
    const team = get<any>('SELECT * FROM teams WHERE slug = ?', [String((request.params as any).slug)]);
    if (!team) throw notFound('团队不存在');
    if (team.owner_id === user.id) throw badRequest('团长不能退出团队，请先转让或解散团队');
    run('DELETE FROM team_members WHERE team_id = ? AND user_id = ?', [team.id, user.id]);
    run('UPDATE teams SET member_count = MAX(0, member_count - 1) WHERE id = ?', [team.id]);
    return { ok: true, joined: false };
  });

  app.post('/api/teams/:slug/members/:userId/role', async (request) => {
    const user = requireUser(request);
    const team = get<any>('SELECT * FROM teams WHERE slug = ?', [String((request.params as any).slug)]);
    if (!team) throw notFound('团队不存在');
    const membership = get<any>('SELECT * FROM team_members WHERE team_id = ? AND user_id = ?', [team.id, user.id]);
    if (!hasRole(user, 'admin') && membership?.role !== 'owner') throw forbidden('只有团长可以调整成员身份');
    const targetId = parseId((request.params as any).userId);
    const role = ['admin', 'member'].includes((request.body as any)?.role) ? (request.body as any).role : 'member';
    run('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?', [role, team.id, targetId]);
    return { ok: true };
  });

  app.delete('/api/teams/:slug/members/:userId', async (request) => {
    const user = requireUser(request);
    const team = get<any>('SELECT * FROM teams WHERE slug = ?', [String((request.params as any).slug)]);
    if (!team) throw notFound('团队不存在');
    const membership = get<any>('SELECT * FROM team_members WHERE team_id = ? AND user_id = ?', [team.id, user.id]);
    if (!hasRole(user, 'admin') && membership?.role !== 'owner') throw forbidden('只有团长可以移除成员');
    const targetId = parseId((request.params as any).userId);
    if (targetId === team.owner_id) throw badRequest('不能移除团长');
    run('DELETE FROM team_members WHERE team_id = ? AND user_id = ?', [team.id, targetId]);
    run('UPDATE teams SET member_count = MAX(0, member_count - 1) WHERE id = ?', [team.id]);
    return { ok: true };
  });

  app.post('/api/teams/:slug/announcements', async (request) => {
    const user = requireUser(request);
    const team = get<any>('SELECT * FROM teams WHERE slug = ?', [String((request.params as any).slug)]);
    if (!team) throw notFound('团队不存在');
    const membership = get<any>('SELECT * FROM team_members WHERE team_id = ? AND user_id = ?', [team.id, user.id]);
    if (!hasRole(user, 'admin') && !['owner', 'admin'].includes(membership?.role ?? '')) {
      throw forbidden('只有团队管理员可以发布公告');
    }
    const body = (request.body ?? {}) as any;
    const title = String(body.title ?? '').trim();
    if (!title) throw badRequest('公告标题不能为空');
    const info = run(
      `INSERT INTO team_announcements (team_id, author_id, title, content) VALUES (?, ?, ?, ?)`,
      [team.id, user.id, title.slice(0, 150), String(body.content ?? '')],
    );
    return { ok: true, id: Number(info.lastInsertRowid) };
  });

  app.post('/api/teams/:slug/problems', async (request) => {
    const user = requireUser(request);
    const team = get<any>('SELECT * FROM teams WHERE slug = ?', [String((request.params as any).slug)]);
    if (!team) throw notFound('团队不存在');
    const membership = get<any>('SELECT * FROM team_members WHERE team_id = ? AND user_id = ?', [team.id, user.id]);
    if (!hasRole(user, 'admin') && !['owner', 'admin'].includes(membership?.role ?? '')) {
      throw forbidden('只有团队管理员可以管理团队题目');
    }
    const problemId = Number((request.body as any)?.problemId);
    if (!get('SELECT id FROM problems WHERE id = ?', [problemId])) throw notFound('题目不存在');
    run('INSERT OR IGNORE INTO team_problems (team_id, problem_id, added_by) VALUES (?, ?, ?)', [
      team.id,
      problemId,
      user.id,
    ]);
    return { ok: true };
  });

  app.delete('/api/teams/:slug/problems/:problemId', async (request) => {
    const user = requireUser(request);
    const team = get<any>('SELECT * FROM teams WHERE slug = ?', [String((request.params as any).slug)]);
    if (!team) throw notFound('团队不存在');
    const membership = get<any>('SELECT * FROM team_members WHERE team_id = ? AND user_id = ?', [team.id, user.id]);
    if (!hasRole(user, 'admin') && !['owner', 'admin'].includes(membership?.role ?? '')) throw forbidden();
    run('DELETE FROM team_problems WHERE team_id = ? AND problem_id = ?', [
      team.id,
      parseId((request.params as any).problemId),
    ]);
    return { ok: true };
  });

  void slugify;
  void bool;
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
