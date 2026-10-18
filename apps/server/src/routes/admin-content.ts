/**
 * 控制面板 → 内容管理
 *
 * 普通管理员就能用，不用超管：
 *   - 文章广场：改标题 / 摘要 / 分类 / 正文，置顶、公开、删除、恢复
 *   - 帖子（讨论）：改标题 / 正文，置顶、锁定、删除、恢复
 *   - 评论：文章 / 题目 / 题解 / 比赛 / 题单 / 讨论区回复 / 动态评论，改文字、删除、恢复
 *   - 私信 / 站内信：改标题 / 正文、删除（这张表没有软删除，删除即硬删除）
 *   - 题解：改标题 / 正文、公开、删除、恢复
 *   - 动态：改正文、置顶、删除、恢复
 *
 * 所有写操作都会写审计日志（只记 id 与字段，不把正文整段写进日志）。
 */
import type { FastifyInstance } from 'fastify';
import { all, count, get, run } from '../db/index.js';
import { requireAdmin } from '../lib/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { parseId, parsePage, sqlLike } from '../lib/util.js';

const TEXT_MAX = 200_000;

/** 文本字段：去掉首尾空白并截断，空字符串由调用方决定是否允许 */
function text(value: unknown, max = TEXT_MAX): string {
  return String(value ?? '').trim().slice(0, max);
}

/** 请求体里出现才更新：把 undefined 过滤掉，避免「没传就清空」 */
function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function flag(value: unknown): 0 | 1 {
  return value ? 1 : 0;
}

/** 评论来源 → 表名与说明，避免把表名直接拼进 URL 失去校验 */
const COMMENT_SOURCES: Record<string, { table: string; label: string }> = {
  comment: { table: 'comments', label: '普通评论' },
  discussion: { table: 'discussion_replies', label: '讨论区回复' },
  moment: { table: 'moment_comments', label: '动态评论' },
};

export async function registerAdminContentRoutes(app: FastifyInstance): Promise<void> {
  /* --------------------------------------------------------------- 概览 */
  app.get('/api/admin/content/stats', async (request) => {
    await requireAdmin(request);
    const [articles, posts, comments, messages, solutions, moments] = await Promise.all([
      count('SELECT COUNT(*) AS c FROM articles WHERE is_deleted = 0'),
      count('SELECT COUNT(*) AS c FROM discussions WHERE is_deleted = 0'),
      count(
        `SELECT
           (SELECT COUNT(*) FROM comments WHERE is_deleted = 0) +
           (SELECT COUNT(*) FROM discussion_replies WHERE is_deleted = 0) +
           (SELECT COUNT(*) FROM moment_comments WHERE is_deleted = 0) AS c`,
      ),
      count('SELECT COUNT(*) AS c FROM messages'),
      count('SELECT COUNT(*) AS c FROM solutions WHERE is_deleted = 0'),
      count('SELECT COUNT(*) AS c FROM moments WHERE is_deleted = 0'),
    ]);
    return { articles, posts, comments, messages, solutions, moments };
  });

  /* --------------------------------------------------------------- 文章 */
  app.get('/api/admin/content/articles', async (request) => {
    await requireAdmin(request);
    const query = request.query as any;
    const page = parsePage(query, 30);
    const conditions = ['a.is_deleted = ?'];
    const params: unknown[] = [query.deleted === 'true' ? 1 : 0];
    if (query.keyword) {
      const like = sqlLike(String(query.keyword));
      conditions.push(`(a.title LIKE ? ESCAPE '\\' OR a.summary LIKE ? ESCAPE '\\' OR a.content LIKE ? ESCAPE '\\')`);
      params.push(like, like, like);
    }
    const where = conditions.join(' AND ');
    const items = await all<any>(
      `SELECT a.id, a.title, a.summary, a.content, a.cover, a.category,
              a.is_public, a.is_pinned, a.is_deleted, a.views, a.created_at, a.updated_at,
              a.author_id, u.username AS author
         FROM articles a JOIN users u ON u.id = a.author_id
        WHERE ${where}
        ORDER BY a.id DESC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    return {
      items: items.map((row) => ({
        ...row,
        is_public: Boolean(row.is_public),
        is_pinned: Boolean(row.is_pinned),
        is_deleted: Boolean(row.is_deleted),
      })),
      total: await count(`SELECT COUNT(*) AS c FROM articles a WHERE ${where}`, params),
      page: page.page,
      size: page.size,
    };
  });

  app.put('/api/admin/content/articles/:id', async (request) => {
    await requireAdmin(request);
    const id = parseId((request.params as any).id);
    const row = await get<any>('SELECT * FROM articles WHERE id = ?', [id]);
    if (!row) throw notFound('文章不存在');
    const body = (request.body ?? {}) as Record<string, unknown>;
    const fields: string[] = [];
    const values: unknown[] = [];
    if (has(body, 'title')) {
      const title = text(body.title, 200);
      if (!title) throw badRequest('标题不能为空');
      fields.push('title = ?');
      values.push(title);
    }
    if (has(body, 'summary')) {
      fields.push('summary = ?');
      values.push(text(body.summary, 1000));
    }
    if (has(body, 'category')) {
      const category = text(body.category, 40) || '学习';
      fields.push('category = ?');
      values.push(category);
    }
    if (has(body, 'content')) {
      const content = text(body.content);
      if (!content) throw badRequest('正文不能为空');
      fields.push('content = ?');
      values.push(content);
    }
    if (has(body, 'isPublic')) {
      fields.push('is_public = ?');
      values.push(flag(body.isPublic));
    }
    if (has(body, 'isPinned')) {
      fields.push('is_pinned = ?');
      values.push(flag(body.isPinned));
    }
    if (has(body, 'isDeleted')) {
      fields.push('is_deleted = ?');
      values.push(flag(body.isDeleted));
    }
    if (!fields.length) throw badRequest('没有需要修改的内容');
    fields.push("updated_at = datetime('now')");
    await run(`UPDATE articles SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    await audit(request, 'admin.content_article_update', {
      targetType: 'article',
      targetId: id,
      detail: { fields: Object.keys(body), title: row.title },
    });
    return { ok: true };
  });

  app.delete('/api/admin/content/articles/:id', async (request) => {
    await requireAdmin(request);
    const id = parseId((request.params as any).id);
    const row = await get<any>('SELECT title FROM articles WHERE id = ?', [id]);
    if (!row) throw notFound('文章不存在');
    await run(`UPDATE articles SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?`, [id]);
    await audit(request, 'admin.content_article_delete', {
      targetType: 'article',
      targetId: id,
      detail: { title: row.title },
    });
    return { ok: true };
  });

  /* --------------------------------------------------------- 帖子（讨论） */
  app.get('/api/admin/content/posts', async (request) => {
    await requireAdmin(request);
    const query = request.query as any;
    const page = parsePage(query, 30);
    const conditions = ['d.is_deleted = ?'];
    const params: unknown[] = [query.deleted === 'true' ? 1 : 0];
    if (query.keyword) {
      const like = sqlLike(String(query.keyword));
      conditions.push(`(d.title LIKE ? ESCAPE '\\' OR d.content LIKE ? ESCAPE '\\')`);
      params.push(like, like);
    }
    const where = conditions.join(' AND ');
    const items = await all<any>(
      `SELECT d.id, d.title, d.content, d.board_id, d.problem_id, d.is_pinned, d.is_locked,
              d.is_deleted, d.views, d.reply_count, d.created_at, d.updated_at,
              d.author_id, u.username AS author
         FROM discussions d JOIN users u ON u.id = d.author_id
        WHERE ${where}
        ORDER BY d.id DESC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    return {
      items: items.map((row) => ({
        ...row,
        is_pinned: Boolean(row.is_pinned),
        is_locked: Boolean(row.is_locked),
        is_deleted: Boolean(row.is_deleted),
      })),
      total: await count(`SELECT COUNT(*) AS c FROM discussions d WHERE ${where}`, params),
      page: page.page,
      size: page.size,
    };
  });

  app.put('/api/admin/content/posts/:id', async (request) => {
    await requireAdmin(request);
    const id = parseId((request.params as any).id);
    const row = await get<any>('SELECT title FROM discussions WHERE id = ?', [id]);
    if (!row) throw notFound('帖子不存在');
    const body = (request.body ?? {}) as Record<string, unknown>;
    const fields: string[] = [];
    const values: unknown[] = [];
    if (has(body, 'title')) {
      const title = text(body.title, 200);
      if (!title) throw badRequest('标题不能为空');
      fields.push('title = ?');
      values.push(title);
    }
    if (has(body, 'content')) {
      const content = text(body.content);
      if (!content) throw badRequest('正文不能为空');
      fields.push('content = ?');
      values.push(content);
    }
    if (has(body, 'isPinned')) {
      fields.push('is_pinned = ?');
      values.push(flag(body.isPinned));
    }
    if (has(body, 'isLocked')) {
      fields.push('is_locked = ?');
      values.push(flag(body.isLocked));
    }
    if (has(body, 'isDeleted')) {
      fields.push('is_deleted = ?');
      values.push(flag(body.isDeleted));
    }
    if (!fields.length) throw badRequest('没有需要修改的内容');
    fields.push("updated_at = datetime('now')");
    await run(`UPDATE discussions SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    await audit(request, 'admin.content_post_update', {
      targetType: 'discussion',
      targetId: id,
      detail: { fields: Object.keys(body), title: row.title },
    });
    return { ok: true };
  });

  app.delete('/api/admin/content/posts/:id', async (request) => {
    await requireAdmin(request);
    const id = parseId((request.params as any).id);
    const row = await get<any>('SELECT title FROM discussions WHERE id = ?', [id]);
    if (!row) throw notFound('帖子不存在');
    await run(`UPDATE discussions SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?`, [id]);
    await audit(request, 'admin.content_post_delete', {
      targetType: 'discussion',
      targetId: id,
      detail: { title: row.title },
    });
    return { ok: true };
  });

  /* --------------------------------------------------------------- 评论 */
  /** 三种评论来源合成一张表，便于统一搜索与分页 */
  const commentUnion = `
    SELECT c.id, 'comment' AS source, c.target_type AS type, c.content, c.author_id,
           u.username AS author, c.created_at, c.is_deleted, c.target_id, c.parent_id,
           CASE c.target_type
             WHEN 'article' THEN (SELECT title FROM articles WHERE id = c.target_id)
             WHEN 'problem' THEN (SELECT title FROM problems WHERE id = c.target_id)
             WHEN 'solution' THEN (SELECT title FROM solutions WHERE id = c.target_id)
             WHEN 'contest' THEN (SELECT title FROM contests WHERE id = c.target_id)
             WHEN 'list' THEN (SELECT title FROM lists WHERE id = c.target_id)
             ELSE NULL
           END AS target_title
      FROM comments c JOIN users u ON u.id = c.author_id
    UNION ALL
    SELECT r.id, 'discussion' AS source, 'discussion' AS type, r.content, r.author_id,
           u2.username AS author, r.created_at, r.is_deleted, r.discussion_id AS target_id, r.reply_to_id AS parent_id,
           d.title AS target_title
      FROM discussion_replies r
      JOIN users u2 ON u2.id = r.author_id
      LEFT JOIN discussions d ON d.id = r.discussion_id
    UNION ALL
    SELECT mc.id, 'moment' AS source, 'moment' AS type, mc.content, mc.author_id,
           u3.username AS author, mc.created_at, mc.is_deleted, mc.moment_id AS target_id, mc.parent_id,
           substr(m.content, 1, 60) AS target_title
      FROM moment_comments mc
      JOIN users u3 ON u3.id = mc.author_id
      LEFT JOIN moments m ON m.id = mc.moment_id
  `;

  app.get('/api/admin/content/comments', async (request) => {
    await requireAdmin(request);
    const query = request.query as any;
    const page = parsePage(query, 30);
    const conditions = ['t.is_deleted = ?'];
    const params: unknown[] = [query.deleted === 'true' ? 1 : 0];
    if (query.type) {
      conditions.push('t.type = ?');
      params.push(String(query.type));
    }
    if (query.keyword) {
      const like = sqlLike(String(query.keyword));
      conditions.push(`(t.content LIKE ? ESCAPE '\\' OR t.author LIKE ? ESCAPE '\\')`);
      params.push(like, like);
    }
    const where = conditions.join(' AND ');
    const items = await all<any>(
      `SELECT t.* FROM (${commentUnion}) t WHERE ${where}
        ORDER BY t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    return {
      items: items.map((row) => ({ ...row, is_deleted: Boolean(row.is_deleted) })),
      total: await count(`SELECT COUNT(*) AS c FROM (${commentUnion}) t WHERE ${where}`, params),
      page: page.page,
      size: page.size,
    };
  });

  app.put('/api/admin/content/comments/:source/:id', async (request) => {
    await requireAdmin(request);
    const params = request.params as { source: string; id: string };
    const source = COMMENT_SOURCES[params.source];
    if (!source) throw badRequest('不支持的评论类型');
    const id = parseId(params.id);
    const row = await get<any>(`SELECT * FROM ${source.table} WHERE id = ?`, [id]);
    if (!row) throw notFound('评论不存在');
    const body = (request.body ?? {}) as Record<string, unknown>;
    const fields: string[] = [];
    const values: unknown[] = [];
    if (has(body, 'content')) {
      const content = text(body.content, 20_000);
      if (!content) throw badRequest('评论内容不能为空');
      fields.push('content = ?');
      values.push(content);
    }
    if (has(body, 'isDeleted')) {
      fields.push('is_deleted = ?');
      values.push(flag(body.isDeleted));
    }
    if (!fields.length) throw badRequest('没有需要修改的内容');
    await run(`UPDATE ${source.table} SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    await audit(request, 'admin.content_comment_update', {
      targetType: params.source,
      targetId: id,
      detail: { fields: Object.keys(body) },
    });
    return { ok: true };
  });

  app.delete('/api/admin/content/comments/:source/:id', async (request) => {
    await requireAdmin(request);
    const params = request.params as { source: string; id: string };
    const source = COMMENT_SOURCES[params.source];
    if (!source) throw badRequest('不支持的评论类型');
    const id = parseId(params.id);
    const row = await get<any>(`SELECT * FROM ${source.table} WHERE id = ?`, [id]);
    if (!row) throw notFound('评论不存在');
    await run(`UPDATE ${source.table} SET is_deleted = 1 WHERE id = ?`, [id]);
    // 讨论区 / 动态的计数跟着重算，避免删了评论数量还挂着
    if (params.source === 'discussion' && row.discussion_id) {
      await run(
        `UPDATE discussions SET reply_count =
           (SELECT COUNT(*) FROM discussion_replies WHERE discussion_id = ? AND is_deleted = 0)
         WHERE id = ?`,
        [row.discussion_id, row.discussion_id],
      );
    }
    if (params.source === 'moment' && row.moment_id) {
      await run(
        `UPDATE moments SET comment_count =
           (SELECT COUNT(*) FROM moment_comments WHERE moment_id = ? AND is_deleted = 0)
         WHERE id = ?`,
        [row.moment_id, row.moment_id],
      );
    }
    await audit(request, 'admin.content_comment_delete', {
      targetType: params.source,
      targetId: id,
      detail: { targetId: row.target_id ?? row.discussion_id ?? row.moment_id ?? null },
    });
    return { ok: true };
  });

  /* --------------------------------------------------------- 私信 / 站内信 */
  app.get('/api/admin/content/messages', async (request) => {
    await requireAdmin(request);
    const query = request.query as any;
    const page = parsePage(query, 30);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.type) {
      conditions.push('m.type = ?');
      params.push(String(query.type));
    }
    if (query.keyword) {
      const like = sqlLike(String(query.keyword));
      conditions.push(
        `(m.title LIKE ? ESCAPE '\\' OR m.content LIKE ? ESCAPE '\\' OR COALESCE(f.username,'') LIKE ? ESCAPE '\\' OR t.username LIKE ? ESCAPE '\\')`,
      );
      params.push(like, like, like, like);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const items = await all<any>(
      `SELECT m.id, m.from_id, m.to_id, m.title, m.content, m.type, m.conversation_key,
              m.parent_id, m.is_read, m.created_at,
              f.username AS from_user, t.username AS to_user
         FROM messages m
         LEFT JOIN users f ON f.id = m.from_id
         JOIN users t ON t.id = m.to_id
         ${where}
        ORDER BY m.id DESC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    return {
      items: items.map((row) => ({ ...row, is_read: Boolean(row.is_read) })),
      total: await count(
        `SELECT COUNT(*) AS c FROM messages m
           LEFT JOIN users f ON f.id = m.from_id
           JOIN users t ON t.id = m.to_id ${where}`,
        params,
      ),
      page: page.page,
      size: page.size,
    };
  });

  app.put('/api/admin/content/messages/:id', async (request) => {
    await requireAdmin(request);
    const id = parseId((request.params as any).id);
    const row = await get<any>('SELECT * FROM messages WHERE id = ?', [id]);
    if (!row) throw notFound('消息不存在');
    const body = (request.body ?? {}) as Record<string, unknown>;
    const fields: string[] = [];
    const values: unknown[] = [];
    if (has(body, 'title')) {
      fields.push('title = ?');
      values.push(text(body.title, 200) || '（无标题）');
    }
    if (has(body, 'content')) {
      const content = text(body.content);
      if (!content) throw badRequest('消息内容不能为空');
      fields.push('content = ?');
      values.push(content);
    }
    if (!fields.length) throw badRequest('没有需要修改的内容');
    await run(`UPDATE messages SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    await audit(request, 'admin.content_message_update', {
      targetType: 'message',
      targetId: id,
      detail: { fields: Object.keys(body), from: row.from_id, to: row.to_id },
    });
    return { ok: true };
  });

  app.delete('/api/admin/content/messages/:id', async (request) => {
    await requireAdmin(request);
    const id = parseId((request.params as any).id);
    const row = await get<any>('SELECT * FROM messages WHERE id = ?', [id]);
    if (!row) throw notFound('消息不存在');
    await run('DELETE FROM messages WHERE id = ?', [id]);
    await audit(request, 'admin.content_message_delete', {
      targetType: 'message',
      targetId: id,
      detail: { from: row.from_id, to: row.to_id, type: row.type },
    });
    return { ok: true };
  });

  /* --------------------------------------------------------------- 题解 */
  app.get('/api/admin/content/solutions', async (request) => {
    await requireAdmin(request);
    const query = request.query as any;
    const page = parsePage(query, 30);
    const conditions = ['s.is_deleted = ?'];
    const params: unknown[] = [query.deleted === 'true' ? 1 : 0];
    if (query.keyword) {
      const like = sqlLike(String(query.keyword));
      conditions.push(`(s.title LIKE ? ESCAPE '\\' OR s.content LIKE ? ESCAPE '\\')`);
      params.push(like, like);
    }
    const where = conditions.join(' AND ');
    const items = await all<any>(
      `SELECT s.id, s.problem_id, s.title, s.content, s.is_public, s.is_deleted,
              s.upvotes, s.downvotes, s.views, s.created_at, s.updated_at,
              s.author_id, u.username AS author, p.title AS problem_title
         FROM solutions s
         JOIN users u ON u.id = s.author_id
         LEFT JOIN problems p ON p.id = s.problem_id
        WHERE ${where}
        ORDER BY s.id DESC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    return {
      items: items.map((row) => ({
        ...row,
        is_public: Boolean(row.is_public),
        is_deleted: Boolean(row.is_deleted),
      })),
      total: await count(`SELECT COUNT(*) AS c FROM solutions s WHERE ${where}`, params),
      page: page.page,
      size: page.size,
    };
  });

  app.put('/api/admin/content/solutions/:id', async (request) => {
    await requireAdmin(request);
    const id = parseId((request.params as any).id);
    const row = await get<any>('SELECT title FROM solutions WHERE id = ?', [id]);
    if (!row) throw notFound('题解不存在');
    const body = (request.body ?? {}) as Record<string, unknown>;
    const fields: string[] = [];
    const values: unknown[] = [];
    if (has(body, 'title')) {
      const title = text(body.title, 200);
      if (!title) throw badRequest('标题不能为空');
      fields.push('title = ?');
      values.push(title);
    }
    if (has(body, 'content')) {
      const content = text(body.content);
      if (!content) throw badRequest('正文不能为空');
      fields.push('content = ?');
      values.push(content);
    }
    if (has(body, 'isPublic')) {
      fields.push('is_public = ?');
      values.push(flag(body.isPublic));
    }
    if (has(body, 'isDeleted')) {
      fields.push('is_deleted = ?');
      values.push(flag(body.isDeleted));
    }
    if (!fields.length) throw badRequest('没有需要修改的内容');
    fields.push("updated_at = datetime('now')");
    await run(`UPDATE solutions SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    await audit(request, 'admin.content_solution_update', {
      targetType: 'solution',
      targetId: id,
      detail: { fields: Object.keys(body), title: row.title },
    });
    return { ok: true };
  });

  app.delete('/api/admin/content/solutions/:id', async (request) => {
    await requireAdmin(request);
    const id = parseId((request.params as any).id);
    const row = await get<any>('SELECT title FROM solutions WHERE id = ?', [id]);
    if (!row) throw notFound('题解不存在');
    await run(`UPDATE solutions SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?`, [id]);
    await audit(request, 'admin.content_solution_delete', {
      targetType: 'solution',
      targetId: id,
      detail: { title: row.title },
    });
    return { ok: true };
  });

  /* --------------------------------------------------------------- 动态 */
  app.get('/api/admin/content/moments', async (request) => {
    await requireAdmin(request);
    const query = request.query as any;
    const page = parsePage(query, 30);
    const conditions = ['m.is_deleted = ?'];
    const params: unknown[] = [query.deleted === 'true' ? 1 : 0];
    if (query.keyword) {
      const like = sqlLike(String(query.keyword));
      conditions.push(`(m.content LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')`);
      params.push(like, like);
    }
    const where = conditions.join(' AND ');
    const items = await all<any>(
      `SELECT m.id, m.content, m.images, m.is_pinned, m.is_deleted, m.like_count, m.comment_count,
              m.created_at, m.updated_at, m.author_id, u.username AS author
         FROM moments m JOIN users u ON u.id = m.author_id
        WHERE ${where}
        ORDER BY m.id DESC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    return {
      items: items.map((row) => ({
        ...row,
        is_pinned: Boolean(row.is_pinned),
        is_deleted: Boolean(row.is_deleted),
      })),
      total: await count(`SELECT COUNT(*) AS c FROM moments m JOIN users u ON u.id = m.author_id WHERE ${where}`, params),
      page: page.page,
      size: page.size,
    };
  });

  app.put('/api/admin/content/moments/:id', async (request) => {
    await requireAdmin(request);
    const id = parseId((request.params as any).id);
    const row = await get<any>('SELECT id FROM moments WHERE id = ?', [id]);
    if (!row) throw notFound('动态不存在');
    const body = (request.body ?? {}) as Record<string, unknown>;
    const fields: string[] = [];
    const values: unknown[] = [];
    if (has(body, 'content')) {
      const content = text(body.content, 5000);
      if (!content) throw badRequest('动态内容不能为空');
      fields.push('content = ?');
      values.push(content);
    }
    if (has(body, 'isPinned')) {
      fields.push('is_pinned = ?');
      values.push(flag(body.isPinned));
    }
    if (has(body, 'isDeleted')) {
      fields.push('is_deleted = ?');
      values.push(flag(body.isDeleted));
    }
    if (!fields.length) throw badRequest('没有需要修改的内容');
    fields.push("updated_at = datetime('now')");
    await run(`UPDATE moments SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    await audit(request, 'admin.content_moment_update', {
      targetType: 'moment',
      targetId: id,
      detail: { fields: Object.keys(body) },
    });
    return { ok: true };
  });

  app.delete('/api/admin/content/moments/:id', async (request) => {
    await requireAdmin(request);
    const id = parseId((request.params as any).id);
    const row = await get<any>('SELECT id FROM moments WHERE id = ?', [id]);
    if (!row) throw notFound('动态不存在');
    await run(`UPDATE moments SET is_deleted = 1, updated_at = datetime('now') WHERE id = ?`, [id]);
    await audit(request, 'admin.content_moment_delete', { targetType: 'moment', targetId: id });
    return { ok: true };
  });
}
