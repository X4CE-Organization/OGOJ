import type { FastifyInstance } from 'fastify';
import { all, count, get, run } from '../db/index.js';
import { hasRole, requireAdmin, requireUser } from '../lib/auth.js';
import { badRequest, forbidden, notFound, tooMany } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { bool, json as settingJson, num } from '../settings/index.js';
import { parseId, parsePage, rateLimit, sqlLike } from '../lib/util.js';
import { sendMessage } from '../lib/notify.js';
import { addPoints } from '../lib/points.js';
import { evaluateAchievements } from '../lib/achievements.js';

function checkBannedWords(text: string): void {
  const banned = settingJson<string[]>('banned_words', []);
  for (const word of banned) {
    if (word && text.includes(word)) throw badRequest(`内容包含敏感词「${word}」，请修改后重试`);
  }
}

function userBrief(row: any) {
  return {
    id: row.author_id ?? row.user_id ?? row.id,
    username: row.username,
    display_name: row.display_name,
    avatar: row.avatar,
    solved_count: row.solved_count,
  };
}

export async function registerCommunityRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------- boards */
  app.get('/api/boards', async () => {
    const rows = all<any>('SELECT * FROM discussion_boards ORDER BY sort ASC, id ASC');
    return { boards: rows.length ? rows : settingJson<any[]>('board_names', []) };
  });

  /* ----------------------------------------------------------- discussions */
  app.get('/api/discussions', async (request) => {
    if (!bool('enable_discussion', true)) return { items: [], total: 0, page: 1, size: 0 };
    const query = request.query as any;
    const page = parsePage(query, num('discussion_page_size', 30));
    const conditions = ['d.is_deleted = 0'];
    const params: unknown[] = [];
    if (query.board) {
      conditions.push('b.slug = ?');
      params.push(String(query.board));
    }
    if (query.problemId) {
      conditions.push('d.problem_id = ?');
      params.push(Number(query.problemId));
    } else if (query.contestId) {
      conditions.push('d.contest_id = ?');
      params.push(Number(query.contestId));
    }
    if (query.user) {
      conditions.push('u.username = ?');
      params.push(String(query.user));
    }
    if (query.q) {
      conditions.push(`(d.title LIKE ? ESCAPE '\\' OR d.content LIKE ? ESCAPE '\\')`);
      const like = sqlLike(String(query.q));
      params.push(like, like);
    }
    const order =
      query.sort === 'hot'
        ? 'd.reply_count DESC, d.views DESC, d.id DESC'
        : query.sort === 'new_reply'
          ? 'COALESCE(d.last_reply_at, d.created_at) DESC'
          : 'd.is_pinned DESC, d.id DESC';
    const rows = all<any>(
      `SELECT d.id, d.title, d.problem_id, d.contest_id, d.is_pinned, d.is_locked, d.views, d.reply_count,
              d.created_at, d.last_reply_at, d.board_id, b.slug AS board_slug, b.name AS board_name,
              u.id AS author_id, u.username, u.display_name, u.avatar, u.solved_count,
              p.pid AS problem_pid, p.title AS problem_title
         FROM discussions d
         LEFT JOIN discussion_boards b ON b.id = d.board_id
         JOIN users u ON u.id = d.author_id
         LEFT JOIN problems p ON p.id = d.problem_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    const total = count(
      `SELECT COUNT(*) AS c FROM discussions d JOIN users u ON u.id = d.author_id
         LEFT JOIN discussion_boards b ON b.id = d.board_id WHERE ${conditions.join(' AND ')}`,
      params,
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        board: { slug: row.board_slug, name: row.board_name },
        problem: row.problem_id ? { id: row.problem_id, pid: row.problem_pid, title: row.problem_title } : null,
        contestId: row.contest_id,
        isPinned: Boolean(row.is_pinned),
        isLocked: Boolean(row.is_locked),
        views: row.views,
        replyCount: row.reply_count,
        createdAt: row.created_at,
        lastReplyAt: row.last_reply_at,
        author: userBrief(row),
      })),
      total,
      page: page.page,
      size: page.size,
    };
  });

  app.get('/api/discussions/:id', async (request) => {
    const id = parseId((request.params as any).id);
    const row = get<any>(
      `SELECT d.*, b.slug AS board_slug, b.name AS board_name,
              u.id AS author_id, u.username, u.display_name, u.avatar, u.solved_count,
              p.pid AS problem_pid, p.title AS problem_title
         FROM discussions d LEFT JOIN discussion_boards b ON b.id = d.board_id
         JOIN users u ON u.id = d.author_id LEFT JOIN problems p ON p.id = d.problem_id
        WHERE d.id = ?`,
      [id],
    );
    if (!row || (row.is_deleted && !hasRole(request.user, 'admin'))) throw notFound('帖子不存在');
    run('UPDATE discussions SET views = views + 1 WHERE id = ?', [id]);
    const replies = all<any>(
      `SELECT r.id, r.content, r.floor, r.created_at, r.is_deleted, r.reply_to_id,
              u.id AS author_id, u.username, u.display_name, u.avatar, u.solved_count,
              s.username AS reply_to_username
         FROM discussion_replies r JOIN users u ON u.id = r.author_id
         LEFT JOIN discussion_replies parent ON parent.id = r.reply_to_id
         LEFT JOIN users s ON s.id = parent.author_id
        WHERE r.discussion_id = ? ORDER BY r.floor ASC LIMIT 1000`,
      [id],
    );
    const viewer = request.user;
    return {
      discussion: {
        id: row.id,
        title: row.title,
        content: row.content,
        board: { slug: row.board_slug, name: row.board_name },
        problem: row.problem_id ? { id: row.problem_id, pid: row.problem_pid, title: row.problem_title } : null,
        contestId: row.contest_id,
        isPinned: Boolean(row.is_pinned),
        isLocked: Boolean(row.is_locked),
        views: row.views + 1,
        replyCount: row.reply_count,
        createdAt: row.created_at,
        author: userBrief(row),
        canEdit: Boolean(viewer && (viewer.id === row.author_id || hasRole(viewer, 'admin'))),
      },
      replies: replies.map((reply) => ({
        id: reply.id,
        floor: reply.floor,
        content: reply.content,
        createdAt: reply.created_at,
        isDeleted: Boolean(reply.is_deleted),
        author: userBrief(reply),
        replyTo: reply.reply_to_id ? { id: reply.reply_to_id, username: reply.reply_to_username } : null,
        canEdit: Boolean(viewer && (viewer.id === reply.author_id || hasRole(viewer, 'admin'))),
      })),
    };
  });

  app.post('/api/discussions', async (request) => {
    const user = requireUser(request);
    if (!bool('enable_discussion', true)) throw forbidden('讨论区已关闭');
    const minSolved = num('post_min_solved', 0);
    const solved = get<{ solved_count: number }>('SELECT solved_count FROM users WHERE id = ?', [user.id]);
    if (minSolved > 0 && (solved?.solved_count ?? 0) < minSolved) {
      throw forbidden(`发帖需要至少通过 ${minSolved} 道题目`);
    }
    const interval = num('post_interval_seconds', 15);
    if (!rateLimit(`post:${user.id}`, interval)) {
      throw tooMany(`发帖过于频繁，请 ${interval} 秒后再试`);
    }
    const body = (request.body ?? {}) as any;
    const title = String(body.title ?? '').trim();
    const content = String(body.content ?? '').trim();
    if (title.length < 3) throw badRequest('标题至少 3 个字符');
    if (title.length > 150) throw badRequest('标题最多 150 个字符');
    if (!content) throw badRequest('内容不能为空');
    checkBannedWords(`${title}\n${content}`);

    let boardId: number | null = null;
    if (body.board) {
      const board = get<{ id: number }>('SELECT id FROM discussion_boards WHERE slug = ?', [String(body.board)]);
      boardId = board?.id ?? null;
      if (!boardId) {
        const fromSettings = settingJson<any[]>('board_names', []).find((b) => b.slug === body.board);
        if (fromSettings) {
          boardId = Number(
            run('INSERT INTO discussion_boards (slug, name, description) VALUES (?, ?, ?)', [
              fromSettings.slug,
              fromSettings.name,
              fromSettings.description ?? '',
            ]).lastInsertRowid,
          );
        }
      }
    }

    const info = run(
      `INSERT INTO discussions (board_id, problem_id, contest_id, title, content, author_id, last_reply_at, last_reply_user_id)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
      [
        boardId,
        body.problemId ? Number(body.problemId) : null,
        body.contestId ? Number(body.contestId) : null,
        title,
        content,
        user.id,
        user.id,
      ],
    );
    const discussionId = Number(info.lastInsertRowid);
    const points = num('points_per_discussion', 0);
    if (points > 0 && bool('enable_points', true)) {
      addPoints(user.id, points, '发布讨论', { refType: 'discussion', refId: discussionId });
    }
    evaluateAchievements(user.id);
    audit(request, 'discussion.create', { targetType: 'discussion', targetId: discussionId });
    return { ok: true, id: discussionId };
  });

  app.put('/api/discussions/:id', async (request) => {
    const user = requireUser(request);
    const id = parseId((request.params as any).id);
    const row = get<any>('SELECT * FROM discussions WHERE id = ?', [id]);
    if (!row) throw notFound('帖子不存在');
    if (row.author_id !== user.id && !hasRole(user, 'admin')) throw forbidden();
    const body = (request.body ?? {}) as any;
    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (title.length < 3) throw badRequest('标题至少 3 个字符');
      checkBannedWords(title);
      fields.push('title = ?');
      values.push(title);
    }
    if (body.content !== undefined) {
      const content = String(body.content);
      checkBannedWords(content);
      fields.push('content = ?');
      values.push(content);
    }
    if (hasRole(user, 'admin')) {
      if (body.isPinned !== undefined) {
        fields.push('is_pinned = ?');
        values.push(body.isPinned ? 1 : 0);
      }
      if (body.isLocked !== undefined) {
        fields.push('is_locked = ?');
        values.push(body.isLocked ? 1 : 0);
      }
    }
    if (fields.length) {
      fields.push(`updated_at = datetime('now')`);
      run(`UPDATE discussions SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    }
    audit(request, 'discussion.update', { targetType: 'discussion', targetId: id });
    return { ok: true };
  });

  app.delete('/api/discussions/:id', async (request) => {
    const user = requireUser(request);
    const id = parseId((request.params as any).id);
    const row = get<any>('SELECT * FROM discussions WHERE id = ?', [id]);
    if (!row) throw notFound('帖子不存在');
    if (row.author_id !== user.id && !hasRole(user, 'admin')) throw forbidden('只能删除自己的帖子');
    run('UPDATE discussions SET is_deleted = 1 WHERE id = ?', [id]);
    audit(request, 'discussion.delete', { targetType: 'discussion', targetId: id });
    return { ok: true };
  });

  app.post('/api/discussions/:id/replies', async (request) => {
    const user = requireUser(request);
    const id = parseId((request.params as any).id);
    const discussion = get<any>('SELECT * FROM discussions WHERE id = ? AND is_deleted = 0', [id]);
    if (!discussion) throw notFound('帖子不存在');
    if (discussion.is_locked && !hasRole(user, 'admin')) throw forbidden('该帖子已锁定，无法回复');
    const interval = num('post_interval_seconds', 15);
    if (!rateLimit(`reply:${user.id}`, Math.min(interval, 5))) throw tooMany('回复过于频繁');
    const body = (request.body ?? {}) as any;
    const content = String(body.content ?? '').trim();
    if (!content) throw badRequest('回复内容不能为空');
    if (content.length > 10000) throw badRequest('回复内容过长');
    checkBannedWords(content);

    const floor = (get<{ maxFloor: number | null }>(
      'SELECT MAX(floor) AS maxFloor FROM discussion_replies WHERE discussion_id = ?',
      [id],
    )?.maxFloor ?? 0) + 1;
    const info = run(
      `INSERT INTO discussion_replies (discussion_id, author_id, content, floor, reply_to_id)
       VALUES (?, ?, ?, ?, ?)`,
      [id, user.id, content, floor, body.replyToId ? Number(body.replyToId) : null],
    );
    run(
      `UPDATE discussions SET reply_count = reply_count + 1, last_reply_at = datetime('now'),
         last_reply_user_id = ? WHERE id = ?`,
      [user.id, id],
    );
    if (discussion.author_id !== user.id && bool('notify_on_reply', true)) {
      sendMessage({
        to: discussion.author_id,
        from: user.id,
        title: `你的帖子「${discussion.title}」有新回复`,
        content: content.slice(0, 500),
        type: 'reply',
        refType: 'discussion',
        refId: id,
      });
    }
    if (body.replyToId) {
      const parent = get<any>('SELECT author_id FROM discussion_replies WHERE id = ?', [Number(body.replyToId)]);
      if (parent && parent.author_id !== user.id && parent.author_id !== discussion.author_id) {
        sendMessage({
          to: parent.author_id,
          from: user.id,
          title: '有人回复了你',
          content: content.slice(0, 500),
          type: 'reply',
          refType: 'discussion',
          refId: id,
        });
      }
    }
    evaluateAchievements(user.id, { silent: true });
    return { ok: true, id: Number(info.lastInsertRowid), floor };
  });

  app.delete('/api/discussion-replies/:id', async (request) => {
    const user = requireUser(request);
    const id = parseId((request.params as any).id);
    const row = get<any>('SELECT * FROM discussion_replies WHERE id = ?', [id]);
    if (!row) throw notFound('回复不存在');
    if (row.author_id !== user.id && !hasRole(user, 'admin')) throw forbidden('只能删除自己的回复');
    run('UPDATE discussion_replies SET is_deleted = 1, content = ? WHERE id = ?', ['[该回复已被删除]', id]);
    run('UPDATE discussions SET reply_count = MAX(0, reply_count - 1) WHERE id = ?', [row.discussion_id]);
    audit(request, 'reply.delete', { targetType: 'reply', targetId: id });
    return { ok: true };
  });

  /* ----------------------------------------------------------------- 题解 */
  app.get('/api/solutions/:id', async (request) => {
    const id = parseId((request.params as any).id);
    const row = get<any>(
      `SELECT s.*, u.username, u.display_name, u.avatar, p.pid, p.title AS problem_title,
              (SELECT value FROM solution_votes v WHERE v.solution_id = s.id AND v.user_id = ?) AS my_vote
         FROM solutions s JOIN users u ON u.id = s.author_id JOIN problems p ON p.id = s.problem_id
        WHERE s.id = ? AND s.is_deleted = 0`,
      [request.user?.id ?? 0, id],
    );
    if (!row) throw notFound('题解不存在');
    if (!row.is_public && row.author_id !== request.user?.id && !hasRole(request.user, 'admin')) {
      throw forbidden('该题解尚未公开');
    }
    run('UPDATE solutions SET views = views + 1 WHERE id = ?', [id]);
    return {
      solution: {
        ...row,
        myVote: row.my_vote ?? 0,
        canEdit: Boolean(request.user && (request.user.id === row.author_id || hasRole(request.user, 'admin'))),
      },
    };
  });

  app.post('/api/solutions', async (request) => {
    const user = requireUser(request);
    if (!bool('enable_solution', true)) throw forbidden('题解区已关闭');
    const minSolved = num('solution_min_solved', 0);
    const stats = get<{ solved_count: number }>('SELECT solved_count FROM users WHERE id = ?', [user.id]);
    if (minSolved > 0 && (stats?.solved_count ?? 0) < minSolved) {
      throw forbidden(`发布题解需要至少通过 ${minSolved} 道题目`);
    }
    const body = (request.body ?? {}) as any;
    const problemId = Number(body.problemId);
    const problem = get<any>('SELECT id, pid, owner_id, author_id FROM problems WHERE id = ?', [problemId]);
    if (!problem) throw notFound('题目不存在');

    const solved = get(
      'SELECT 1 AS x FROM user_problem_stats WHERE user_id = ? AND problem_id = ? AND accepted > 0',
      [user.id, problemId],
    );
    const isAuthor = problem.owner_id === user.id || problem.author_id === user.id;
    if (!solved && !hasRole(user, 'admin') && !isAuthor) {
      throw forbidden('通过本题后才能发布题解');
    }
    const title = String(body.title ?? '').trim() || '题解';
    const content = String(body.content ?? '').trim();
    if (content.length < 10) throw badRequest('题解内容太短');
    const needApprove = bool('solution_need_approved', false) && !hasRole(user, 'admin');
    const info = run(
      `INSERT INTO solutions (problem_id, author_id, title, content, is_public) VALUES (?, ?, ?, ?, ?)`,
      [problemId, user.id, title.slice(0, 150), content, needApprove ? 0 : 1],
    );
    const solutionId = Number(info.lastInsertRowid);
    const points = num('points_per_solution', 0);
    if (points > 0 && bool('enable_points', true)) {
      addPoints(user.id, points, '发布题解', { refType: 'solution', refId: solutionId });
    }
    evaluateAchievements(user.id);
    audit(request, 'solution.create', { targetType: 'solution', targetId: solutionId });
    return { ok: true, id: solutionId, pending: needApprove };
  });

  app.put('/api/solutions/:id', async (request) => {
    const user = requireUser(request);
    const id = parseId((request.params as any).id);
    const row = get<any>('SELECT * FROM solutions WHERE id = ?', [id]);
    if (!row) throw notFound('题解不存在');
    if (row.author_id !== user.id && !hasRole(user, 'admin')) throw forbidden();
    const body = (request.body ?? {}) as any;
    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.title !== undefined) {
      fields.push('title = ?');
      values.push(String(body.title).slice(0, 150));
    }
    if (body.content !== undefined) {
      fields.push('content = ?');
      values.push(String(body.content));
    }
    if (body.isPublic !== undefined && hasRole(user, 'admin')) {
      fields.push('is_public = ?');
      values.push(body.isPublic ? 1 : 0);
    }
    if (fields.length) {
      fields.push(`updated_at = datetime('now')`);
      run(`UPDATE solutions SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    }
    return { ok: true };
  });

  app.delete('/api/solutions/:id', async (request) => {
    const user = requireUser(request);
    const id = parseId((request.params as any).id);
    const row = get<any>('SELECT * FROM solutions WHERE id = ?', [id]);
    if (!row) throw notFound('题解不存在');
    if (row.author_id !== user.id && !hasRole(user, 'admin')) throw forbidden();
    run('UPDATE solutions SET is_deleted = 1 WHERE id = ?', [id]);
    audit(request, 'solution.delete', { targetType: 'solution', targetId: id });
    return { ok: true };
  });

  app.post('/api/solutions/:id/vote', async (request) => {
    const user = requireUser(request);
    const id = parseId((request.params as any).id);
    const row = get<any>('SELECT * FROM solutions WHERE id = ?', [id]);
    if (!row) throw notFound('题解不存在');
    const value = Number((request.body as any)?.value) === -1 ? -1 : 1;
    const existing = get<any>('SELECT value FROM solution_votes WHERE solution_id = ? AND user_id = ?', [
      id,
      user.id,
    ]);
    if (existing) {
      if (existing.value === value) {
        run('DELETE FROM solution_votes WHERE solution_id = ? AND user_id = ?', [id, user.id]);
        run(
          `UPDATE solutions SET ${value === 1 ? 'upvotes' : 'downvotes'} = MAX(0, ${
            value === 1 ? 'upvotes' : 'downvotes'
          } - 1) WHERE id = ?`,
          [id],
        );
        return { ok: true, vote: 0 };
      }
      run('UPDATE solution_votes SET value = ? WHERE solution_id = ? AND user_id = ?', [value, id, user.id]);
      if (value === 1) {
        run('UPDATE solutions SET upvotes = upvotes + 1, downvotes = MAX(0, downvotes - 1) WHERE id = ?', [id]);
      } else {
        run('UPDATE solutions SET downvotes = downvotes + 1, upvotes = MAX(0, upvotes - 1) WHERE id = ?', [id]);
      }
      return { ok: true, vote: value };
    }
    run('INSERT INTO solution_votes (solution_id, user_id, value) VALUES (?, ?, ?)', [id, user.id, value]);
    run(`UPDATE solutions SET ${value === 1 ? 'upvotes' : 'downvotes'} = ${
      value === 1 ? 'upvotes' : 'downvotes'
    } + 1 WHERE id = ?`, [id]);
    return { ok: true, vote: value };
  });

  /* ----------------------------------------------------------------- 专栏 */
  app.get('/api/articles', async (request) => {
    if (!bool('enable_article', true)) return { items: [], total: 0, page: 1, size: 0 };
    const query = request.query as any;
    const page = parsePage(query, 20);
    const conditions = ['a.is_deleted = 0', 'a.is_public = 1'];
    const params: unknown[] = [];
    if (query.category) {
      conditions.push('a.category = ?');
      params.push(String(query.category));
    }
    if (query.user) {
      conditions.push('u.username = ?');
      params.push(String(query.user));
    }
    if (query.q) {
      conditions.push(`(a.title LIKE ? ESCAPE '\\' OR a.summary LIKE ? ESCAPE '\\')`);
      const like = sqlLike(String(query.q));
      params.push(like, like);
    }
    const rows = all<any>(
      `SELECT a.id, a.title, a.summary, a.cover, a.category, a.views, a.is_pinned, a.created_at,
              u.id AS author_id, u.username, u.display_name, u.avatar
         FROM articles a JOIN users u ON u.id = a.author_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY a.is_pinned DESC, a.id DESC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    const total = count(
      `SELECT COUNT(*) AS c FROM articles a JOIN users u ON u.id = a.author_id WHERE ${conditions.join(' AND ')}`,
      params,
    );
    return {
      items: rows.map((row) => ({ ...row, author: userBrief(row) })),
      total,
      page: page.page,
      size: page.size,
    };
  });

  app.get('/api/articles/:id', async (request) => {
    const id = parseId((request.params as any).id);
    const row = get<any>(
      `SELECT a.*, u.id AS author_id, u.username, u.display_name, u.avatar
         FROM articles a JOIN users u ON u.id = a.author_id WHERE a.id = ?`,
      [id],
    );
    if (!row || (row.is_deleted && !hasRole(request.user, 'admin'))) throw notFound('文章不存在');
    if (!row.is_public && row.author_id !== request.user?.id && !hasRole(request.user, 'admin')) {
      throw forbidden('无权查看该文章');
    }
    run('UPDATE articles SET views = views + 1 WHERE id = ?', [id]);
    return {
      article: {
        ...row,
        author: userBrief(row),
        canEdit: Boolean(request.user && (request.user.id === row.author_id || hasRole(request.user, 'admin'))),
      },
    };
  });

  app.post('/api/articles', async (request) => {
    const user = requireUser(request);
    if (!bool('enable_article', true)) throw forbidden('专栏已关闭');
    const body = (request.body ?? {}) as any;
    const title = String(body.title ?? '').trim();
    const content = String(body.content ?? '').trim();
    if (title.length < 3) throw badRequest('标题至少 3 个字符');
    if (content.length < 20) throw badRequest('正文太短');
    checkBannedWords(`${title}\n${content}`);
    const info = run(
      `INSERT INTO articles (title, summary, content, cover, category, author_id, is_public)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        title.slice(0, 150),
        String(body.summary ?? content.replace(/[#>*`]/g, '').slice(0, 200)),
        content,
        String(body.cover ?? ''),
        String(body.category ?? '学习'),
        user.id,
        body.isPublic === false ? 0 : 1,
      ],
    );
    evaluateAchievements(user.id);
    return { ok: true, id: Number(info.lastInsertRowid) };
  });

  app.put('/api/articles/:id', async (request) => {
    const user = requireUser(request);
    const id = parseId((request.params as any).id);
    const row = get<any>('SELECT * FROM articles WHERE id = ?', [id]);
    if (!row) throw notFound('文章不存在');
    if (row.author_id !== user.id && !hasRole(user, 'admin')) throw forbidden();
    const body = (request.body ?? {}) as any;
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of [
      ['title', 'title'],
      ['summary', 'summary'],
      ['content', 'content'],
      ['cover', 'cover'],
      ['category', 'category'],
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
    if (body.isPinned !== undefined && hasRole(user, 'admin')) {
      fields.push('is_pinned = ?');
      values.push(body.isPinned ? 1 : 0);
    }
    if (fields.length) {
      fields.push(`updated_at = datetime('now')`);
      run(`UPDATE articles SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    }
    return { ok: true };
  });

  app.delete('/api/articles/:id', async (request) => {
    const user = requireUser(request);
    const id = parseId((request.params as any).id);
    const row = get<any>('SELECT * FROM articles WHERE id = ?', [id]);
    if (!row) throw notFound('文章不存在');
    if (row.author_id !== user.id && !hasRole(user, 'admin')) throw forbidden();
    run('UPDATE articles SET is_deleted = 1 WHERE id = ?', [id]);
    audit(request, 'article.delete', { targetType: 'article', targetId: id });
    return { ok: true };
  });

  /* ----------------------------------------------------------------- 评论 */
  app.get('/api/comments', async (request) => {
    const query = request.query as any;
    const targetType = String(query.targetType ?? '');
    const targetId = Number(query.targetId ?? 0);
    if (!targetType || !targetId) throw badRequest('缺少评论目标');
    const rows = all<any>(
      `SELECT c.id, c.content, c.created_at, c.parent_id, c.is_deleted,
              u.id AS author_id, u.username, u.display_name, u.avatar
         FROM comments c JOIN users u ON u.id = c.author_id
        WHERE c.target_type = ? AND c.target_id = ? ORDER BY c.id ASC LIMIT 500`,
      [targetType, targetId],
    );
    return { items: rows.map((row) => ({ ...row, author: userBrief(row) })) };
  });

  app.post('/api/comments', async (request) => {
    const user = requireUser(request);
    if (!bool('enable_comment', true)) throw forbidden('评论功能已关闭');
    const body = (request.body ?? {}) as any;
    const targetType = String(body.targetType ?? '');
    const targetId = Number(body.targetId ?? 0);
    if (!targetType || !targetId) throw badRequest('缺少评论目标');
    const content = String(body.content ?? '').trim();
    if (!content) throw badRequest('评论内容不能为空');
    checkBannedWords(content);
    const info = run(
      `INSERT INTO comments (target_type, target_id, author_id, content, parent_id) VALUES (?, ?, ?, ?, ?)`,
      [targetType, targetId, user.id, content.slice(0, 2000), body.parentId ? Number(body.parentId) : null],
    );
    return { ok: true, id: Number(info.lastInsertRowid) };
  });

  app.delete('/api/comments/:id', async (request) => {
    const user = requireUser(request);
    const id = parseId((request.params as any).id);
    const row = get<any>('SELECT * FROM comments WHERE id = ?', [id]);
    if (!row) throw notFound('评论不存在');
    if (row.author_id !== user.id && !hasRole(user, 'admin')) throw forbidden();
    run('UPDATE comments SET is_deleted = 1 WHERE id = ?', [id]);
    return { ok: true };
  });

  /* -------------------------------------------------------- admin 审核题解 */
  app.get('/api/admin/solutions', async (request) => {
    requireAdmin(request);
    const query = request.query as any;
    const page = parsePage(query, 30);
    const conditions = ['s.is_deleted = 0'];
    const params: unknown[] = [];
    if (query.pending === 'true') conditions.push('s.is_public = 0');
    if (query.q) {
      conditions.push(`s.title LIKE ? ESCAPE '\\'`);
      params.push(sqlLike(String(query.q)));
    }
    const rows = all<any>(
      `SELECT s.*, u.username, p.pid, p.title AS problem_title FROM solutions s
         JOIN users u ON u.id = s.author_id JOIN problems p ON p.id = s.problem_id
        WHERE ${conditions.join(' AND ')} ORDER BY s.id DESC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    const total = count(`SELECT COUNT(*) AS c FROM solutions s WHERE ${conditions.join(' AND ')}`, params);
    return { items: rows, total, page: page.page, size: page.size };
  });
}
