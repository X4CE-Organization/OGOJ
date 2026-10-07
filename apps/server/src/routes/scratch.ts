/**
 * Scratch：作品中心与编辑器对接。
 *
 * 编辑器本身是自托管的 MIT Scratch（scratch-gui）静态站点，放在 /scratch/ 下，
 * 通过 postMessage 和宿主页面通信：宿主负责把 .sb3 传到后端保存、把作品读回编辑器。
 * 这里只做作品的存储、发布、审核与浏览。
 */
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, count, get, run } from '../db/index.js';
import { requireUser, hasRole } from '../lib/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { num, bool, str } from '../settings/index.js';
import { config } from '../config.js';
import { audit } from '../lib/audit.js';
import { sendMessage } from '../lib/notify.js';

const MAX_TITLE = 80;

function featureOn(): boolean {
  return bool('scratch_enabled', true);
}

function scratchDir(): string {
  const dir = config.paths.scratch;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function summary(row: any, viewerId?: number, liked = false) {
  return {
    id: row.id,
    title: row.title,
    instructions: row.instructions,
    state: row.state,
    isFeatured: Boolean(row.is_featured),
    views: row.views,
    likeCount: row.like_count,
    liked,
    isMine: viewerId ? row.user_id === viewerId : false,
    thumbnail: row.thumbnail ? `/api/scratch/projects/${row.id}/thumbnail` : '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    author: row.username
      ? { id: row.user_id, username: row.username, displayName: row.display_name || row.username, avatar: row.avatar }
      : null,
  };
}

/** 作品可见性：已发布对所有人可见，其余只有本人和管理员可见 */
function canView(row: any, viewer: any): boolean {
  if (!row || row.is_deleted) return false;
  if (row.state === 'published') return true;
  if (!viewer) return false;
  return viewer.id === row.user_id || hasRole(viewer, 'admin');
}

function decodePayload(raw: unknown, limitBytes: number): Buffer {
  if (!raw) throw badRequest('缺少作品文件');
  const text = String(raw);
  const base64 = text.includes(',') ? text.slice(text.indexOf(',') + 1) : text;
  let buf: Buffer;
  try {
    buf = Buffer.from(base64, 'base64');
  } catch {
    throw badRequest('作品文件解析失败');
  }
  if (buf.length < 4) throw badRequest('作品文件为空');
  // sb3 是 zip，必须已 PK 开头
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw badRequest('作品文件不是合法的 sb3');
  if (buf.length > limitBytes) throw badRequest(`作品超过 ${Math.round(limitBytes / 1024 / 1024)}MB 上限`);
  return buf;
}

function saveBlob(prefix: string, id: number, ext: string, data: Buffer | string): string {
  const name = `${prefix}-${id}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(scratchDir(), name), data);
  return name;
}

function removeBlob(name?: string | null) {
  if (!name) return;
  try {
    fs.unlinkSync(path.join(scratchDir(), name));
  } catch {
    /* 文件可能已经不在 */
  }
}

export async function registerScratchRoutes(app: FastifyInstance): Promise<void> {
  /** 功能状态：前端据此决定是否显示入口 */
  app.get('/api/scratch/status', async (request) => {
    const viewer = request.user;
    const allowed = featureOn() && (bool('scratch_allow_guest_view', true) || Boolean(viewer));
    return {
      enabled: featureOn(),
      canCreate: featureOn() && bool('scratch_allow_create', true) && Boolean(viewer),
      needReview: bool('scratch_need_review', false),
      notice: str('scratch_editor_notice', ''),
      maxMb: num('scratch_max_mb', 32),
      visible: allowed,
    };
  });

  /** 作品中心列表 */
  app.get('/api/scratch/projects', async (request) => {
    if (!featureOn()) throw notFound('Scratch 功能已关闭');
    const viewer = request.user;
    if (!bool('scratch_allow_guest_view', true) && !viewer) throw forbidden('请先登录');
    const query = request.query as any;
    const page = Math.max(1, Number(query.page) || 1);
    const size = Math.min(60, Math.max(1, Number(query.size) || num('scratch_page_size', 24)));
    const keyword = String(query.q ?? '').trim();
    const author = String(query.author ?? '').trim();
    const sort = ['new', 'hot', 'views'].includes(String(query.sort)) ? String(query.sort) : 'new';

    const conditions = [`p.is_deleted = 0`, `p.state = 'published'`];
    const params: unknown[] = [];
    if (keyword) {
      conditions.push(`(p.title LIKE ? OR p.instructions LIKE ?)`);
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    if (author) {
      conditions.push(`u.username = ?`);
      params.push(author);
    }
    const where = conditions.join(' AND ');
    const order =
      sort === 'hot' ? 'p.like_count DESC, p.views DESC, p.id DESC' : sort === 'views' ? 'p.views DESC, p.id DESC' : 'p.is_featured DESC, p.id DESC';

    const items = await all<any>(
      `SELECT p.*, u.username, u.display_name, u.avatar
         FROM scratch_projects p JOIN users u ON u.id = p.user_id
        WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...params, size, (page - 1) * size],
    );
    const total = await count(
      `SELECT COUNT(*) AS c FROM scratch_projects p JOIN users u ON u.id = p.user_id WHERE ${where}`,
      params,
    );

    let likedIds = new Set<number>();
    if (viewer && items.length) {
      const rows = await all<any>(`SELECT project_id FROM scratch_likes WHERE user_id = ?`, [viewer.id]);
      likedIds = new Set(rows.map((r) => r.project_id));
    }
    return {
      items: items.map((row) => summary(row, viewer?.id, likedIds.has(row.id))),
      total,
      page,
      size,
      sort,
    };
  });

  /** 我的作品（含草稿、审核中） */
  app.get('/api/scratch/mine', async (request) => {
    if (!featureOn()) throw notFound('Scratch 功能已关闭');
    const user = await requireUser(request);
    const rows = await all<any>(
      `SELECT p.*, u.username, u.display_name, u.avatar
         FROM scratch_projects p JOIN users u ON u.id = p.user_id
        WHERE p.user_id = ? AND p.is_deleted = 0 ORDER BY p.id DESC`,
      [user.id],
    );
    return { items: rows.map((row) => ({ ...summary(row, user.id, false), notes: row.notes })) };
  });

  /** 作品详情 */
  app.get('/api/scratch/projects/:id', async (request) => {
    if (!featureOn()) throw notFound('Scratch 功能已关闭');
    const viewer = request.user;
    const { id } = request.params as { id: string };
    const row = await get<any>(
      `SELECT p.*, u.username, u.display_name, u.avatar
         FROM scratch_projects p JOIN users u ON u.id = p.user_id WHERE p.id = ?`,
      [Number(id)],
    );
    if (!canView(row, viewer)) throw notFound('作品不存在');
    if (row.state === 'published') {
      await run(`UPDATE scratch_projects SET views = views + 1 WHERE id = ?`, [row.id]);
    }
    const liked = viewer
      ? Boolean(await get<any>(`SELECT 1 AS x FROM scratch_likes WHERE project_id = ? AND user_id = ?`, [row.id, viewer.id]))
      : false;
    return {
      ...summary({ ...row, views: row.views + (row.state === 'published' ? 1 : 0) }, viewer?.id, liked),
      notes: viewer && (viewer.id === row.user_id || hasRole(viewer, 'admin')) ? row.notes : undefined,
      fileUrl: `/api/scratch/projects/${row.id}/file`,
      canEdit: Boolean(viewer && viewer.id === row.user_id && bool('scratch_allow_create', true)),
    };
  });

  /** 编辑器加载作品用：返回原始 .sb3 */
  app.get('/api/scratch/projects/:id/file', async (request, reply) => {
    if (!featureOn()) throw notFound('Scratch 功能已关闭');
    const { id } = request.params as { id: string };
    const row = await get<any>(`SELECT * FROM scratch_projects WHERE id = ?`, [Number(id)]);
    if (!canView(row, request.user)) throw notFound('作品不存在');
    const file = path.join(scratchDir(), row.file_path || '');
    if (!row.file_path || !fs.existsSync(file)) throw notFound('作品文件丢失');
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Cache-Control', 'no-store');
    // ?download=1：当成附件下载，文件名用作品标题（去掉文件系统不接受的字符）
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    if (query.download) {
      const safe =
        String(row.title ?? '')
          .replace(/[\\/:*?"<>|\r\n\t]+/g, '_')
          .replace(/^\.+/, '')
          .trim()
          .slice(0, 80) || 'scratch-project';
      reply.header(
        'Content-Disposition',
        `attachment; filename="${safe.replace(/[^\x20-\x7e]/g, '_')}.sb3"; filename*=UTF-8''${encodeURIComponent(safe)}.sb3`,
      );
    }
    return reply.send(fs.createReadStream(file));
  });

  app.get('/api/scratch/projects/:id/thumbnail', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await get<any>(`SELECT * FROM scratch_projects WHERE id = ?`, [Number(id)]);
    if (!canView(row, request.user)) throw notFound('作品不存在');
    const file = path.join(scratchDir(), row.thumbnail || '');
    if (!row.thumbnail || !fs.existsSync(file)) {
      reply.code(404);
      return { code: 'NOT_FOUND', message: '没有封面' };
    }
    reply.header('Content-Type', 'image/png');
    reply.header('Cache-Control', 'public, max-age=300');
    return reply.send(fs.createReadStream(file));
  });

  /** 保存作品（新建或覆盖）。body: { id?, title, instructions, notes, file(base64), thumbnail(base64 png) } */
  app.post('/api/scratch/projects', async (request, reply) => {
    if (!featureOn()) throw notFound('Scratch 功能已关闭');
    if (!bool('scratch_allow_create', true)) throw forbidden('管理员已关闭作品创作');
    const user = await requireUser(request);
    const body = (request.body ?? {}) as any;

    const limit = Math.max(1, num('scratch_max_mb', 32)) * 1024 * 1024;
    const data = decodePayload(body.file ?? body.data, limit);
    const title = String(body.title ?? '').trim().slice(0, MAX_TITLE) || '未命名作品';
    const instructions = String(body.instructions ?? '').slice(0, 5000);
    const notes = String(body.notes ?? '').slice(0, 5000);

    let id = body.id ? Number(body.id) : 0;
    let existing: any = null;
    if (id) {
      existing = await get<any>(`SELECT * FROM scratch_projects WHERE id = ?`, [id]);
      if (!existing || existing.is_deleted) throw notFound('作品不存在');
      if (existing.user_id !== user.id && !hasRole(user, 'admin')) throw forbidden('只能修改自己的作品');
    } else {
      const mine = await count(`SELECT COUNT(*) AS c FROM scratch_projects WHERE user_id = ? AND is_deleted = 0`, [user.id]);
      const cap = num('scratch_max_per_user', 50);
      if (cap > 0 && mine >= cap) throw conflict(`每人最多保存 ${cap} 个作品，请先删掉一些`);
    }

    const filePath = saveBlob('proj', id || Date.now(), '.sb3', data);
    let thumbPath = existing?.thumbnail ?? '';
    if (body.thumbnail) {
      const raw = String(body.thumbnail);
      const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
      const png = Buffer.from(base64, 'base64');
      if (png.length > 64 || png.length < 1024 * 1024) {
        const next = saveBlob('thumb', id || Date.now(), '.png', png);
        removeBlob(thumbPath);
        thumbPath = next;
      }
    }

    if (id) {
      removeBlob(existing.file_path);
      await run(
        `UPDATE scratch_projects
            SET title = ?, instructions = ?, notes = ?, file_path = ?, file_size = ?, thumbnail = ?,
                updated_at = datetime('now')
          WHERE id = ?`,
        [title, instructions, notes, filePath, data.length, thumbPath, id],
      );
    } else {
      const created = await get<any>(
        `INSERT INTO scratch_projects (user_id, title, instructions, notes, file_path, file_size, thumbnail, state)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft') RETURNING id`,
        [user.id, title, instructions, notes, filePath, data.length, thumbPath],
      );
      id = created.id;
    }
    await audit(request, existing ? 'scratch.update' : 'scratch.create', {
      targetType: 'scratch_project',
      targetId: id,
      detail: title,
    });
    const saved = await get<any>(`SELECT * FROM scratch_projects WHERE id = ?`, [id]);
    return reply.code(existing ? 200 : 201).send({ id, state: saved.state, updatedAt: saved.updated_at });
  });

  /** 提交发布 / 撤回成草稿 */
  app.post('/api/scratch/projects/:id/publish', async (request) => {
    if (!featureOn()) throw notFound('Scratch 功能已关闭');
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const row = await get<any>(`SELECT * FROM scratch_projects WHERE id = ?`, [Number(id)]);
    if (!row || row.is_deleted) throw notFound('作品不存在');
    if (row.user_id !== user.id) throw forbidden('只能发布自己的作品');
    if (!row.file_path) throw badRequest('请先保存作品再发布');

    const needReview = bool('scratch_need_review', false) && !hasRole(user, 'admin');
    const state = needReview ? 'pending' : 'published';
    await run(
      `UPDATE scratch_projects SET state = ?, published_at = COALESCE(published_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`,
      [state, row.id],
    );
    await audit(request, 'scratch.publish', { targetType: 'scratch_project', targetId: row.id, detail: row.title });
    if (state === 'pending') await sendMessage({ to: row.user_id, title: '作品已提交审核', content: row.title });
    return { state };
  });

  app.post('/api/scratch/projects/:id/unpublish', async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const row = await get<any>(`SELECT * FROM scratch_projects WHERE id = ?`, [Number(id)]);
    if (!row || row.is_deleted) throw notFound('作品不存在');
    if (row.user_id !== user.id && !hasRole(user, 'admin')) throw forbidden();
    await run(`UPDATE scratch_projects SET state = 'draft' WHERE id = ?`, [row.id]);
    return { state: 'draft' };
  });

  app.delete('/api/scratch/projects/:id', async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const row = await get<any>(`SELECT * FROM scratch_projects WHERE id = ?`, [Number(id)]);
    if (!row || row.is_deleted) throw notFound('作品不存在');
    if (row.user_id !== user.id && !hasRole(user, 'admin')) throw forbidden();
    await run(`UPDATE scratch_projects SET is_deleted = 1 WHERE id = ?`, [row.id]);
    await audit(request, 'scratch.delete', { targetType: 'scratch_project', targetId: row.id, detail: row.title });
    return { ok: true };
  });

  app.post('/api/scratch/projects/:id/like', async (request) => {
    if (!featureOn()) throw notFound('Scratch 功能已关闭');
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const row = await get<any>(`SELECT * FROM scratch_projects WHERE id = ?`, [Number(id)]);
    if (!canView(row, user)) throw notFound('作品不存在');
    const existing = await get<any>(`SELECT 1 AS x FROM scratch_likes WHERE project_id = ? AND user_id = ?`, [row.id, user.id]);
    if (existing) {
      await run(`DELETE FROM scratch_likes WHERE project_id = ? AND user_id = ?`, [row.id, user.id]);
      await run(`UPDATE scratch_projects SET like_count = CASE WHEN like_count > 0 THEN like_count - 1 ELSE 0 END WHERE id = ?`, [row.id]);
      return { liked: false, likeCount: Math.max(0, row.like_count - 1) };
    }
    await run(`INSERT INTO scratch_likes (project_id, user_id) VALUES (?, ?)`, [row.id, user.id]);
    await run(`UPDATE scratch_projects SET like_count = like_count + 1 WHERE id = ?`, [row.id]);
    if (row.user_id !== user.id) await sendMessage({ to: row.user_id, title: '有人赞了你的 Scratch 项目', content: row.title });
    return { liked: true, likeCount: row.like_count + 1 };
  });

  /* ------------------------------------------------------------- 管理 */

  app.get('/api/admin/scratch/projects', async (request) => {
    const admin = await requireUser(request);
    if (!hasRole(admin, 'admin')) throw forbidden();
    const query = request.query as any;
    const state = String(query.state ?? '').trim();
    const page = Math.max(1, Number(query.page) || 1);
    const size = Math.min(100, Math.max(1, Number(query.size) || 30));
    const conditions = [`p.is_deleted = 0`];
    const params: unknown[] = [];
    if (state) {
      conditions.push('p.state = ?');
      params.push(state);
    }
    const where = conditions.join(' AND ');
    const items = await all<any>(
      `SELECT p.*, u.username, u.display_name FROM scratch_projects p JOIN users u ON u.id = p.user_id
        WHERE ${where} ORDER BY p.id DESC LIMIT ? OFFSET ?`,
      [...params, size, (page - 1) * size],
    );
    const total = await count(`SELECT COUNT(*) AS c FROM scratch_projects p WHERE ${where}`, params);
    return { items: items.map((row) => summary(row)), total, page, size };
  });

  app.put('/api/admin/scratch/projects/:id', async (request) => {
    const admin = await requireUser(request);
    if (!hasRole(admin, 'admin')) throw forbidden();
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as any;
    const row = await get<any>(`SELECT * FROM scratch_projects WHERE id = ?`, [Number(id)]);
    if (!row || row.is_deleted) throw notFound('作品不存在');
    const sets: string[] = [];
    const params: unknown[] = [];
    if (typeof body.state === 'string' && ['draft', 'published', 'pending', 'rejected', 'removed'].includes(body.state)) {
      sets.push('state = ?');
      params.push(body.state);
    }
    if (typeof body.featured === 'boolean') {
      sets.push('is_featured = ?');
      params.push(body.featured ? 1 : 0);
    }
    if (!sets.length) throw badRequest('没有要修改的字段');
    await run(`UPDATE scratch_projects SET ${sets.join(', ')} WHERE id = ?`, [...params, row.id]);
    await audit(request, 'admin.scratch_update', { targetType: 'scratch_project', targetId: row.id, detail: JSON.stringify(body) });
    if (body.state === 'published') await sendMessage({ to: row.user_id, title: `作品《${row.title}》已通过审核`, content: '现在可以在作品中心看到了' });
    if (body.state === 'rejected') await sendMessage({ to: row.user_id, title: `作品《${row.title}》未通过审核`, content: String(body.reason ?? '') });
    return { ok: true };
  });

  app.delete('/api/admin/scratch/projects/:id', async (request) => {
    const admin = await requireUser(request);
    if (!hasRole(admin, 'admin')) throw forbidden();
    const { id } = request.params as { id: string };
    const row = await get<any>(`SELECT * FROM scratch_projects WHERE id = ?`, [Number(id)]);
    if (!row) throw notFound('作品不存在');
    removeBlob(row.file_path);
    removeBlob(row.thumbnail);
    await run(`UPDATE scratch_projects SET is_deleted = 1 WHERE id = ?`, [row.id]);
    await audit(request, 'admin.scratch_delete', { targetType: 'scratch_project', targetId: row.id, detail: row.title });
    return { ok: true };
  });
}
