/**
 * 表情包：上传图片 / GIF，支持公开分享、收藏别人的表情、发到私信与讨论里。
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { all, count, get, run } from '../db/index.js';
import { hasRole, requireUser } from '../lib/auth.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { num } from '../settings/index.js';
import { publicUploadPath, uploadDir } from '../lib/storage.js';

/** 表情包允许的图片类型 */
const STICKER_TYPES = new Map<string, string>([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
]);

function stickerPayload(row: any, viewerId: number | null) {
  return {
    id: row.id,
    name: row.name,
    pack: row.pack || '默认',
    url: row.url,
    mimetype: row.mimetype,
    isPublic: Boolean(row.is_public),
    useCount: row.use_count ?? 0,
    createdAt: row.created_at,
    owner: {
      id: row.owner_id,
      username: row.owner_username ?? '',
      display_name: row.owner_display ?? row.owner_username ?? '',
      avatar: row.owner_avatar ?? null,
    },
    mine: row.owner_id === viewerId,
    collected: Boolean(row.collected),
  };
}

export async function registerStickerRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------------------------------------- 列表 */
  app.get('/api/stickers', async (request) => {
    const viewer = await requireUser(request);
    const query = (request.query ?? {}) as Record<string, string>;
    const scope = ['mine', 'favorites', 'public'].includes(query.scope) ? query.scope : 'mine';
    const keyword = String(query.q ?? '').trim();
    const conditions = ['s.is_deleted = 0'];
    const params: unknown[] = [];

    if (scope === 'mine') {
      conditions.push('s.owner_id = ?');
      params.push(viewer.id);
    } else if (scope === 'favorites') {
      conditions.push('EXISTS (SELECT 1 FROM user_stickers us WHERE us.sticker_id = s.id AND us.user_id = ?)');
      params.push(viewer.id);
    } else {
      conditions.push('s.is_public = 1');
    }
    if (keyword) {
      conditions.push('(s.name LIKE ? OR s.pack LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    const rows = await all<any>(
      `SELECT s.*, u.username AS owner_username, u.display_name AS owner_display, u.avatar AS owner_avatar,
              EXISTS (SELECT 1 FROM user_stickers us WHERE us.sticker_id = s.id AND us.user_id = ?) AS collected
         FROM stickers s LEFT JOIN users u ON u.id = s.owner_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY s.use_count DESC, s.id DESC
        LIMIT 500`,
      [viewer.id, ...params],
    );

    return {
      scope,
      items: rows.map((row) => stickerPayload(row, viewer.id)),
      counts: {
        mine: await count('SELECT COUNT(*) AS c FROM stickers WHERE owner_id = ? AND is_deleted = 0', [viewer.id]),
        favorites: await count(
          'SELECT COUNT(*) AS c FROM user_stickers us JOIN stickers s ON s.id = us.sticker_id AND s.is_deleted = 0 WHERE us.user_id = ?',
          [viewer.id],
        ),
        public: await count('SELECT COUNT(*) AS c FROM stickers WHERE is_public = 1 AND is_deleted = 0'),
      },
    };
  });

  /* ------------------------------------------------------------- 上传 */
  app.post('/api/stickers', async (request) => {
    const user = await requireUser(request);
    const query = (request.query ?? {}) as Record<string, string>;
    const file = await (request as any).file({
      limits: { fileSize: num('max_upload_size_mb', 64) * 1024 * 1024 },
    });
    if (!file) throw badRequest('请选择要上传的图片或 GIF');
    const mimetype = String(file.mimetype ?? '');
    const ext = STICKER_TYPES.get(mimetype);
    if (!ext) throw badRequest('表情包只支持 jpg / png / gif / webp 图片');
    const buffer = await file.toBuffer();
    if (!buffer.length) throw badRequest('文件内容为空');
    if (buffer.length > 5 * 1024 * 1024) throw badRequest('表情包不能超过 5 MB');

    const name = String(query.name ?? '').trim().slice(0, 40) || '表情';
    const pack = String(query.pack ?? '').trim().slice(0, 24) || '默认';
    const isPublic = !['0', 'false', 'off'].includes(String(query.public ?? '1').toLowerCase());

    const dir = uploadDir('sticker');
    const filename = `${Date.now().toString(36)}-${randomBytes(5).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(dir, filename), buffer);
    const url = publicUploadPath(path.join('sticker', filename));

    const info = await run(
      `INSERT INTO stickers (owner_id, name, pack, url, mimetype, is_public) VALUES (?, ?, ?, ?, ?, ?)`,
      [user.id, name, pack, url, mimetype, isPublic ? 1 : 0],
    );
    const id = Number(info.lastInsertRowid);
    await audit(request, 'sticker.create', { targetType: 'sticker', targetId: id, detail: { name, pack, isPublic } });
    const row = await get<any>(
      `SELECT s.*, u.username AS owner_username, u.display_name AS owner_display, u.avatar AS owner_avatar, 1 AS collected
         FROM stickers s LEFT JOIN users u ON u.id = s.owner_id WHERE s.id = ?`,
      [id],
    );
    return { ok: true, sticker: stickerPayload(row, user.id) };
  });

  /* ------------------------------------------------------------- 删除 */
  app.delete('/api/stickers/:id', async (request) => {
    const user = await requireUser(request);
    const id = Number((request.params as any).id);
    const row = await get<any>('SELECT * FROM stickers WHERE id = ? AND is_deleted = 0', [id]);
    if (!row) throw notFound('表情不存在');
    if (row.owner_id !== user.id && !hasRole(user, 'admin')) throw forbidden('只能删除自己上传的表情');
    await run('UPDATE stickers SET is_deleted = 1 WHERE id = ?', [id]);
    await audit(request, 'sticker.delete', { targetType: 'sticker', targetId: id });
    return { ok: true };
  });

  /* ------------------------------------------------------------- 收藏 */
  app.post('/api/stickers/:id/collect', async (request) => {
    const user = await requireUser(request);
    const id = Number((request.params as any).id);
    const row = await get<any>('SELECT * FROM stickers WHERE id = ? AND is_deleted = 0', [id]);
    if (!row) throw notFound('表情不存在');
    if (row.owner_id !== user.id && !row.is_public) throw forbidden('这个表情没有公开');
    await run('INSERT OR IGNORE INTO user_stickers (user_id, sticker_id) VALUES (?, ?)', [user.id, id]);
    await audit(request, 'sticker.collect', { targetType: 'sticker', targetId: id });
    return { ok: true, collected: true };
  });

  app.delete('/api/stickers/:id/collect', async (request) => {
    const user = await requireUser(request);
    const id = Number((request.params as any).id);
    await run('DELETE FROM user_stickers WHERE user_id = ? AND sticker_id = ?', [user.id, id]);
    return { ok: true, collected: false };
  });

  /* ------------------------------------------------------------- 使用计数 */
  app.post('/api/stickers/:id/use', async (request) => {
    await requireUser(request);
    const id = Number((request.params as any).id);
    await run('UPDATE stickers SET use_count = use_count + 1 WHERE id = ? AND is_deleted = 0', [id]);
    return { ok: true };
  });
}
