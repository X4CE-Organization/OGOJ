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

function momentEnabled(): boolean {
  return bool('enable_moment', true);
}

/** 图片只接受本站上传目录或 http(s) 链接，长度与数量都按后台设置限制 */
function parseImages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const max = Math.max(0, num('moment_max_images', 9));
  if (max <= 0) return [];
  const out: string[] = [];
  for (const item of value) {
    const url = String(item ?? '').trim();
    if (!url || url.length > 500) continue;
    if (!/^(\/uploads\/|https?:\/\/)/i.test(url)) continue;
    if (!out.includes(url)) out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

function parseImageColumn(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function authorOf(row: any) {
  return {
    id: row.author_id,
    username: row.username,
    display_name: row.display_name ?? null,
    avatar: row.avatar ?? null,
    solved_count: row.solved_count ?? 0,
    rating: row.rating ?? 1500,
  };
}

function formatMoment(row: any, options: { liked?: boolean; viewerId?: number | null; viewerRole?: string } = {}) {
  const viewerId = options.viewerId ?? null;
  return {
    id: row.id,
    content: row.content,
    images: parseImageColumn(row.images),
    isPinned: Boolean(row.is_pinned),
    isDeleted: Boolean(row.is_deleted),
    likeCount: row.like_count ?? 0,
    commentCount: row.comment_count ?? 0,
    liked: Boolean(options.liked),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    edited: row.updated_at && row.updated_at !== row.created_at,
    author: authorOf(row),
    mine: viewerId !== null && row.author_id === viewerId,
    canDelete:
      viewerId !== null &&
      (row.author_id === viewerId || options.viewerRole === 'admin' || options.viewerRole === 'superadmin'),
    canPin: options.viewerRole === 'admin' || options.viewerRole === 'superadmin',
  };
}

function snippet(text: string, length = 60): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > length ? `${clean.slice(0, length)}…` : clean;
}

export async function registerMomentRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------------------------------------------ 列表 */
  app.get('/api/moments', async (request) => {
    if (!momentEnabled()) return { items: [], total: 0, page: 1, size: 0, enabled: false };
    const query = request.query as any;
    const page = parsePage(query, num('moment_page_size', 20), 100);
    const viewer = request.user;
    const conditions = ['m.is_deleted = 0'];
    const params: unknown[] = [];

    const scope = String(query.scope ?? 'all');
    if (scope === 'mine') {
      if (!viewer) return { items: [], total: 0, page: page.page, size: page.size, enabled: true };
      conditions.push('m.author_id = ?');
      params.push(viewer.id);
    } else if (scope === 'following') {
      if (!viewer) return { items: [], total: 0, page: page.page, size: page.size, enabled: true };
      conditions.push('m.author_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)');
      params.push(viewer.id);
    } else if (scope === 'liked') {
      if (!viewer) return { items: [], total: 0, page: page.page, size: page.size, enabled: true };
      conditions.push('m.id IN (SELECT moment_id FROM moment_likes WHERE user_id = ?)');
      params.push(viewer.id);
    }

    if (query.user) {
      conditions.push('u.username = ?');
      params.push(String(query.user));
    }
    if (query.q) {
      const like = sqlLike(String(query.q));
      conditions.push(`m.content LIKE ? ESCAPE '\\'`);
      params.push(like);
    }

    const where = conditions.join(' AND ');
    const rows = await all<any>(
      `SELECT m.*, u.username, u.display_name, u.avatar, u.solved_count, u.rating
         FROM moments m JOIN users u ON u.id = m.author_id
        WHERE ${where}
        ORDER BY m.is_pinned DESC, m.id DESC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    const total = await count(
      `SELECT COUNT(*) AS c FROM moments m JOIN users u ON u.id = m.author_id WHERE ${where}`,
      params,
    );

    const liked = new Set<number>();
    if (viewer && rows.length) {
      const ids = rows.map((row) => row.id);
      const likedRows = await all<{ moment_id: number }>(
        `SELECT moment_id FROM moment_likes WHERE user_id = ? AND moment_id IN (${ids.map(() => '?').join(',')})`,
        [viewer.id, ...ids],
      );
      for (const row of likedRows) liked.add(row.moment_id);
    }

    return {
      items: rows.map((row) =>
        formatMoment(row, { liked: liked.has(row.id), viewerId: viewer?.id, viewerRole: viewer?.role }),
      ),
      total,
      page: page.page,
      size: page.size,
      enabled: true,
    };
  });

  /* -------------------------------------------------------------- 单条详情 */
  app.get('/api/moments/:id', async (request) => {
    const id = parseId((request.params as any).id);
    const row = await get<any>(
      `SELECT m.*, u.username, u.display_name, u.avatar, u.solved_count, u.rating
         FROM moments m JOIN users u ON u.id = m.author_id WHERE m.id = ?`,
      [id],
    );
    if (!row) throw notFound('动态不存在');
    const viewer = request.user;
    if (row.is_deleted && !hasRole(viewer, 'admin')) throw notFound('动态不存在');

    let liked = false;
    if (viewer) {
      liked = Boolean(
        await get('SELECT 1 AS x FROM moment_likes WHERE moment_id = ? AND user_id = ?', [id, viewer.id]),
      );
    }
    const comments = await all<any>(
      `SELECT c.id, c.content, c.parent_id, c.created_at, c.author_id,
              u.username, u.display_name, u.avatar, u.solved_count, u.rating
         FROM moment_comments c JOIN users u ON u.id = c.author_id
        WHERE c.moment_id = ? AND c.is_deleted = 0
        ORDER BY c.id ASC LIMIT 500`,
      [id],
    );
    return {
      moment: formatMoment(row, { liked, viewerId: viewer?.id, viewerRole: viewer?.role }),
      comments: comments.map((comment) => ({
        id: comment.id,
        content: comment.content,
        parentId: comment.parent_id,
        createdAt: comment.created_at,
        author: authorOf(comment),
        mine: Boolean(viewer && comment.author_id === viewer.id),
        canDelete: Boolean(
          viewer && (comment.author_id === viewer.id || row.author_id === viewer.id || hasRole(viewer, 'admin')),
        ),
      })),
    };
  });

  /* ------------------------------------------------------------------ 发布 */
  app.post('/api/moments', async (request) => {
    const user = await requireUser(request);
    if (!momentEnabled()) throw forbidden('动态功能已关闭');
    const minSolved = num('moment_min_solved', 0);
    if (minSolved > 0) {
      const row = await get<{ solved_count: number }>('SELECT solved_count FROM users WHERE id = ?', [user.id]);
      if ((row?.solved_count ?? 0) < minSolved) throw forbidden(`发布动态需要至少通过 ${minSolved} 道题目`);
    }
    const interval = num('moment_interval_seconds', 20);
    if (interval > 0 && !rateLimit(`moment:${user.id}`, interval)) {
      throw tooMany(`发布过于频繁，请 ${interval} 秒后再试`);
    }
    const dailyLimit = num('moment_daily_limit', 50);
    if (dailyLimit > 0) {
      const today = await count(
        `SELECT COUNT(*) AS c FROM moments WHERE author_id = ? AND created_at >= date('now')`,
        [user.id],
      );
      if (today >= dailyLimit) throw forbidden(`今天已经发满 ${dailyLimit} 条动态了，明天再来吧`);
    }

    const body = (request.body ?? {}) as any;
    const content = String(body.content ?? '').trim();
    const images = parseImages(body.images);
    const maxLength = num('moment_max_length', 2000);
    if (!content && !images.length) throw badRequest('写点内容或者配张图吧');
    if (content.length > maxLength) throw badRequest(`动态最多 ${maxLength} 个字符`);
    if (images.length && num('moment_max_images', 9) <= 0) throw badRequest('本站已关闭动态配图');
    checkBannedWords(content);

    const info = await run('INSERT INTO moments (author_id, content, images) VALUES (?, ?, ?)', [
      user.id,
      content,
      JSON.stringify(images),
    ]);
    const momentId = Number(info.lastInsertRowid);

    const points = num('points_per_moment', 1);
    if (points > 0 && bool('enable_points', true)) {
      await addPoints(user.id, points, '发布动态', { refType: 'moment', refId: momentId });
    }
    await evaluateAchievements(user.id);
    await audit(request, 'moment.create', { targetType: 'moment', targetId: momentId });
    return { ok: true, id: momentId };
  });

  /* ------------------------------------------------------------------ 编辑 */
  app.put('/api/moments/:id', async (request) => {
    const user = await requireUser(request);
    const id = parseId((request.params as any).id);
    const row = await get<any>('SELECT * FROM moments WHERE id = ?', [id]);
    if (!row || row.is_deleted) throw notFound('动态不存在');
    if (row.author_id !== user.id && !hasRole(user, 'admin')) throw forbidden();
    const body = (request.body ?? {}) as any;
    const content = String(body.content ?? '').trim();
    const images = parseImages(body.images);
    const maxLength = num('moment_max_length', 2000);
    if (!content && !images.length) throw badRequest('写点内容或者配张图吧');
    if (content.length > maxLength) throw badRequest(`动态最多 ${maxLength} 个字符`);
    checkBannedWords(content);
    await run(`UPDATE moments SET content = ?, images = ?, updated_at = datetime('now') WHERE id = ?`, [
      content,
      JSON.stringify(images),
      id,
    ]);
    await audit(request, 'moment.update', { targetType: 'moment', targetId: id });
    return { ok: true };
  });

  /* ------------------------------------------------------------------ 删除 */
  app.delete('/api/moments/:id', async (request) => {
    const user = await requireUser(request);
    const id = parseId((request.params as any).id);
    const row = await get<any>('SELECT id, author_id FROM moments WHERE id = ?', [id]);
    if (!row) throw notFound('动态不存在');
    if (row.author_id !== user.id && !hasRole(user, 'admin')) throw forbidden();
    await run('UPDATE moments SET is_deleted = 1 WHERE id = ?', [id]);
    await audit(request, 'moment.delete', { targetType: 'moment', targetId: id });
    return { ok: true };
  });

  /* ------------------------------------------------------------------ 点赞 */
  app.post('/api/moments/:id/like', async (request) => {
    const user = await requireUser(request);
    if (!bool('moment_allow_like', true)) throw forbidden('本站已关闭动态点赞');
    const id = parseId((request.params as any).id);
    const row = await get<any>('SELECT id, author_id, content FROM moments WHERE id = ?', [id]);
    if (!row || row.is_deleted) throw notFound('动态不存在');
    const existing = await get('SELECT 1 AS x FROM moment_likes WHERE moment_id = ? AND user_id = ?', [id, user.id]);
    if (existing) {
      await run('DELETE FROM moment_likes WHERE moment_id = ? AND user_id = ?', [id, user.id]);
      await run('UPDATE moments SET like_count = GREATEST(like_count - 1, 0) WHERE id = ?', [id]);
      return { ok: true, liked: false };
    }
    await run('INSERT INTO moment_likes (moment_id, user_id) VALUES (?, ?)', [id, user.id]);
    await run('UPDATE moments SET like_count = like_count + 1 WHERE id = ?', [id]);
    if (row.author_id !== user.id) {
      await sendMessage({
        to: row.author_id,
        from: user.id,
        title: `${user.username} 点赞了你的动态`,
        content: snippet(row.content || '[图片]'),
        type: 'user',
        refType: 'moment',
        refId: id,
        setting: 'moment_notify',
      });
    }
    return { ok: true, liked: true };
  });

  /* ------------------------------------------------------------------ 评论 */
  app.get('/api/moments/:id/comments', async (request) => {
    const id = parseId((request.params as any).id);
    const rows = await all<any>(
      `SELECT c.id, c.content, c.parent_id, c.created_at, c.author_id,
              u.username, u.display_name, u.avatar, u.solved_count, u.rating
         FROM moment_comments c JOIN users u ON u.id = c.author_id
        WHERE c.moment_id = ? AND c.is_deleted = 0
        ORDER BY c.id ASC LIMIT 500`,
      [id],
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        content: row.content,
        parentId: row.parent_id,
        createdAt: row.created_at,
        author: authorOf(row),
      })),
    };
  });

  app.post('/api/moments/:id/comments', async (request) => {
    const user = await requireUser(request);
    if (!momentEnabled()) throw forbidden('动态功能已关闭');
    if (!bool('moment_allow_comment', true)) throw forbidden('本站已关闭动态评论');
    const id = parseId((request.params as any).id);
    const moment = await get<any>('SELECT id, author_id, content FROM moments WHERE id = ?', [id]);
    if (!moment || moment.is_deleted) throw notFound('动态不存在');
    const interval = num('post_interval_seconds', 15);
    if (interval > 0 && !rateLimit(`moment-comment:${user.id}`, interval)) {
      throw tooMany(`回复过于频繁，请 ${interval} 秒后再试`);
    }
    const body = (request.body ?? {}) as any;
    const content = String(body.content ?? '').trim();
    if (!content) throw badRequest('评论内容不能为空');
    const maxLength = num('moment_comment_max_length', 500);
    if (content.length > maxLength) throw badRequest(`评论最多 ${maxLength} 个字符`);
    checkBannedWords(content);
    const parentId = body.parentId ? Number(body.parentId) : null;
    const info = await run(
      'INSERT INTO moment_comments (moment_id, author_id, parent_id, content) VALUES (?, ?, ?, ?)',
      [id, user.id, parentId, content],
    );
    await run('UPDATE moments SET comment_count = comment_count + 1 WHERE id = ?', [id]);

    if (moment.author_id !== user.id) {
      await sendMessage({
        to: moment.author_id,
        from: user.id,
        title: `${user.username} 评论了你的动态`,
        content,
        type: 'reply',
        refType: 'moment',
        refId: id,
        setting: 'moment_notify',
      });
    }
    if (parentId) {
      const parent = await get<{ author_id: number }>(
        'SELECT author_id FROM moment_comments WHERE id = ? AND is_deleted = 0',
        [parentId],
      );
      if (parent && parent.author_id !== user.id && parent.author_id !== moment.author_id) {
        await sendMessage({
          to: parent.author_id,
          from: user.id,
          title: `${user.username} 回复了你的评论`,
          content,
          type: 'reply',
          refType: 'moment',
          refId: id,
          setting: 'moment_notify',
        });
      }
    }
    await evaluateAchievements(user.id);
    return { ok: true, id: Number(info.lastInsertRowid) };
  });

  app.delete('/api/moments/comments/:id', async (request) => {
    const user = await requireUser(request);
    const id = parseId((request.params as any).id);
    const row = await get<any>(
      `SELECT c.id, c.author_id, c.moment_id, m.author_id AS moment_author
         FROM moment_comments c JOIN moments m ON m.id = c.moment_id WHERE c.id = ?`,
      [id],
    );
    if (!row) throw notFound('评论不存在');
    if (row.author_id !== user.id && row.moment_author !== user.id && !hasRole(user, 'admin')) {
      throw forbidden();
    }
    await run('UPDATE moment_comments SET is_deleted = 1 WHERE id = ?', [id]);
    await run('UPDATE moments SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = ?', [row.moment_id]);
    return { ok: true };
  });

  /* ------------------------------------------------------------ 后台管理 */
  app.get('/api/admin/moments', async (request) => {
    await requireAdmin(request);
    const query = request.query as any;
    const page = parsePage(query, 50);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.deleted === 'true') conditions.push('m.is_deleted = 1');
    else if (query.deleted === 'false') conditions.push('m.is_deleted = 0');
    if (query.q) {
      conditions.push(`m.content LIKE ? ESCAPE '\\'`);
      params.push(sqlLike(String(query.q)));
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const items = await all<any>(
      `SELECT m.*, u.username, u.display_name, u.avatar FROM moments m JOIN users u ON u.id = m.author_id
        ${where} ORDER BY m.is_pinned DESC, m.id DESC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    return {
      items: items.map((row) => ({
        id: row.id,
        content: row.content,
        images: parseImageColumn(row.images),
        isPinned: Boolean(row.is_pinned),
        isDeleted: Boolean(row.is_deleted),
        likeCount: row.like_count,
        commentCount: row.comment_count,
        createdAt: row.created_at,
        username: row.username,
        displayName: row.display_name,
        avatar: row.avatar,
      })),
      total: await count(`SELECT COUNT(*) AS c FROM moments m ${where}`, params),
      stats: {
        total: await count('SELECT COUNT(*) AS c FROM moments WHERE is_deleted = 0'),
        deleted: await count('SELECT COUNT(*) AS c FROM moments WHERE is_deleted = 1'),
        pinned: await count('SELECT COUNT(*) AS c FROM moments WHERE is_deleted = 0 AND is_pinned = 1'),
        today: await count(`SELECT COUNT(*) AS c FROM moments WHERE created_at >= date('now')`),
      },
      page: page.page,
      size: page.size,
    };
  });

  app.post('/api/admin/moments/:id/pin', async (request) => {
    await requireAdmin(request);
    const id = parseId((request.params as any).id);
    const row = await get<{ is_pinned: number }>('SELECT is_pinned FROM moments WHERE id = ?', [id]);
    if (!row) throw notFound('动态不存在');
    const next = row.is_pinned ? 0 : 1;
    await run('UPDATE moments SET is_pinned = ? WHERE id = ?', [next, id]);
    await audit(request, next ? 'moment.pin' : 'moment.unpin', { targetType: 'moment', targetId: id });
    return { ok: true, pinned: Boolean(next) };
  });

  app.post('/api/admin/moments/:id/restore', async (request) => {
    await requireAdmin(request);
    const id = parseId((request.params as any).id);
    await run('UPDATE moments SET is_deleted = 0 WHERE id = ?', [id]);
    await audit(request, 'moment.restore', { targetType: 'moment', targetId: id });
    return { ok: true };
  });

  app.delete('/api/admin/moments/:id', async (request) => {
    await requireAdmin(request);
    const id = parseId((request.params as any).id);
    await run('UPDATE moments SET is_deleted = 1, is_pinned = 0 WHERE id = ?', [id]);
    await audit(request, 'moment.delete', { targetType: 'moment', targetId: id });
    return { ok: true };
  });
}
