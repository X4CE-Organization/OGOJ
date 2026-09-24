/**
 * 站内信 + 私信（用户之间的会话）。
 *
 * 会话用 `conversation_key = "<较小用户ID>-<较大用户ID>"` 标识，因此同两个人的
 * 所有私信天然聚合成一个对话，不需要额外的会话表。
 */
import type { FastifyInstance } from 'fastify';
import { all, count, get, run, tx } from '../db/index.js';
import { requireUser } from '../lib/auth.js';
import { badRequest, forbidden, notFound, tooMany } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { bool, num } from '../settings/index.js';
import { parseId, parsePage, rateLimit, sqlLike } from '../lib/util.js';

function conversationKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function briefUser(row: any, prefix: string) {
  return {
    id: row[`${prefix}_id`],
    username: row[`${prefix}_username`],
    display_name: row[`${prefix}_display`],
    avatar: row[`${prefix}_avatar`],
    role: row[`${prefix}_role`],
  };
}

function findUser(usernameOrId: string): any {
  const numeric = Number(usernameOrId);
  const row =
    Number.isInteger(numeric) && String(numeric) === usernameOrId
      ? get<any>('SELECT * FROM users WHERE id = ?', [numeric])
      : get<any>('SELECT * FROM users WHERE username = ?', [usernameOrId]);
  if (!row) throw notFound('用户不存在');
  return row;
}

export async function registerMessageRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------------------------------------- 消息列表 */
  app.get('/api/messages', async (request) => {
    const user = requireUser(request);
    const query = request.query as any;
    const page = parsePage(query, 30);
    const conditions = ['m.to_id = ?'];
    const params: unknown[] = [user.id];
    if (query.unread === 'true') conditions.push('m.is_read = 0');
    if (query.type) {
      conditions.push('m.type = ?');
      params.push(String(query.type));
    }
    if (query.system === 'true') conditions.push(`m.type <> 'user'`);
    const items = all<any>(
      `SELECT m.*, u.username AS from_username, u.display_name AS from_display, u.avatar AS from_avatar,
              u.role AS from_role
         FROM messages m LEFT JOIN users u ON u.id = m.from_id
        WHERE ${conditions.join(' AND ')} ORDER BY m.id DESC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    return {
      items,
      total: count(`SELECT COUNT(*) AS c FROM messages m WHERE ${conditions.join(' AND ')}`, params),
      unread: count('SELECT COUNT(*) AS c FROM messages WHERE to_id = ? AND is_read = 0', [user.id]),
      unreadSystem: count(`SELECT COUNT(*) AS c FROM messages WHERE to_id = ? AND is_read = 0 AND type <> 'user'`, [
        user.id,
      ]),
      unreadPrivate: count(`SELECT COUNT(*) AS c FROM messages WHERE to_id = ? AND is_read = 0 AND type = 'user'`, [
        user.id,
      ]),
      page: page.page,
      size: page.size,
    };
  });

  /* --------------------------------------------------------- 私信会话列表 */
  app.get('/api/messages/conversations', async (request) => {
    const user = requireUser(request);
    if (!bool('enable_private_message', true)) return { items: [], total: 0 };
    const query = request.query as any;
    const term = String(query.q ?? '').trim();

    // 每个会话取最后一条消息 + 对方信息 + 未读数
    const rows = all<any>(
      `WITH pairs AS (
         SELECT CASE WHEN m.from_id = ? THEN m.to_id ELSE m.from_id END AS peer_id,
                MAX(m.id) AS last_id,
                SUM(CASE WHEN m.to_id = ? AND m.is_read = 0 THEN 1 ELSE 0 END) AS unread
           FROM messages m
          WHERE m.type = 'user' AND (m.from_id = ? OR m.to_id = ?)
          GROUP BY peer_id
       )
       SELECT p.peer_id, p.unread, m.id, m.content, m.created_at, m.from_id, m.to_id,
              u.username AS peer_username, u.display_name AS peer_display, u.avatar AS peer_avatar,
              u.role AS peer_role, u.last_login_at AS peer_last_login
         FROM pairs p
         JOIN messages m ON m.id = p.last_id
         JOIN users u ON u.id = p.peer_id
        ORDER BY m.id DESC`,
      [user.id, user.id, user.id, user.id],
    );
    const filtered = term
      ? rows.filter((row) => {
          const like = term.toLowerCase();
          return (
            String(row.peer_username ?? '').toLowerCase().includes(like) ||
            String(row.peer_display ?? '').toLowerCase().includes(like) ||
            String(row.content ?? '').toLowerCase().includes(like)
          );
        })
      : rows;
    return {
      items: filtered.map((row) => ({
        user: {
          id: row.peer_id,
          username: row.peer_username,
          display_name: row.peer_display,
          avatar: row.peer_avatar,
          role: row.peer_role,
        },
        unread: row.unread ?? 0,
        lastMessage: {
          id: row.id,
          content: row.content,
          createdAt: row.created_at,
          fromMe: row.from_id === user.id,
        },
        lastActiveAt: row.peer_last_login,
      })),
      total: filtered.length,
      unreadTotal: filtered.reduce((sum, row) => sum + (row.unread ?? 0), 0),
    };
  });

  /* ------------------------------------------------------------- 私信会话 */
  app.get('/api/messages/conversation/:username', async (request) => {
    const user = requireUser(request);
    const peer = findUser(String((request.params as any).username));
    if (peer.id === user.id) throw badRequest('不能和自己私信');
    const key = conversationKey(user.id, peer.id);
    const query = request.query as any;
    const limit = Math.min(200, Math.max(10, Number(query.limit ?? 100)));
    const before = query.before ? Number(query.before) : null;

    const conditions = ['m.conversation_key = ?', `m.type = 'user'`];
    const params: unknown[] = [key];
    if (before) {
      conditions.push('m.id < ?');
      params.push(before);
    }
    const rows = all<any>(
      `SELECT m.*, u.username AS from_username, u.display_name AS from_display, u.avatar AS from_avatar,
              u.role AS from_role
         FROM messages m LEFT JOIN users u ON u.id = m.from_id
        WHERE ${conditions.join(' AND ')} ORDER BY m.id DESC LIMIT ?`,
      [...params, limit],
    );
    run(
      `UPDATE messages SET is_read = 1 WHERE conversation_key = ? AND to_id = ? AND is_read = 0`,
      [key, user.id],
    );
    return {
      user: {
        id: peer.id,
        username: peer.username,
        display_name: peer.display_name,
        avatar: peer.avatar,
        role: peer.role,
        solved_count: peer.solved_count,
        last_login_at: peer.last_login_at,
      },
      messages: rows.reverse().map((row) => ({
        id: row.id,
        fromMe: row.from_id === user.id,
        from: briefUser(row, 'from'),
        content: row.content,
        createdAt: row.created_at,
        isRead: Boolean(row.is_read),
      })),
      hasMore: rows.length === limit,
    };
  });

  /* --------------------------------------------------------- 发送私信 */
  app.post('/api/messages', async (request) => {
    const user = requireUser(request);
    if (!bool('enable_private_message', true)) throw forbidden('本站未开放私信功能');
    const body = (request.body ?? {}) as any;
    const recipient = String(body.to ?? body.toUsername ?? '').trim();
    if (!recipient) throw badRequest('请选择收件人');
    const target = findUser(recipient);
    if (target.id === user.id) throw badRequest('不能给自己发私信');
    if (target.is_banned) throw badRequest('该用户已被封禁');

    const content = String(body.content ?? '').trim();
    if (!content) throw badRequest('私信内容不能为空');
    const maxLength = num('pm_max_length', 2000);
    if (content.length > maxLength) throw badRequest(`私信内容最多 ${maxLength} 个字符`);

    const interval = num('pm_rate_limit_seconds', 10);
    if (!rateLimit(`pm:${user.id}`, interval)) {
      throw tooMany(`发送过于频繁，请 ${interval} 秒后再试`);
    }

    const key = conversationKey(user.id, target.id);
    const id = tx(() =>
      Number(
        run(
          `INSERT INTO messages (from_id, to_id, title, content, type, conversation_key, parent_id)
           VALUES (?, ?, ?, ?, 'user', ?, ?)`,
          [
            user.id,
            target.id,
            String(body.title ?? `来自 ${user.display_name || user.username} 的私信`).slice(0, 100),
            content,
            key,
            body.parentId ? Number(body.parentId) : null,
          ],
        ).lastInsertRowid,
      ),
    );
    audit(request, 'message.send', { targetType: 'user', targetId: target.id, detail: { length: content.length } });
    return { ok: true, id, conversationKey: key };
  });

  /** 未读汇总：给顶栏图标用 */
  app.get('/api/messages/summary', async (request) => {
    const user = requireUser(request);
    return {
      unread: count('SELECT COUNT(*) AS c FROM messages WHERE to_id = ? AND is_read = 0', [user.id]),
      unreadSystem: count(`SELECT COUNT(*) AS c FROM messages WHERE to_id = ? AND is_read = 0 AND type <> 'user'`, [
        user.id,
      ]),
      unreadPrivate: count(`SELECT COUNT(*) AS c FROM messages WHERE to_id = ? AND is_read = 0 AND type = 'user'`, [
        user.id,
      ]),
      conversations: count(
        `SELECT COUNT(DISTINCT conversation_key) AS c FROM messages
          WHERE type = 'user' AND (from_id = ? OR to_id = ?)`,
        [user.id, user.id],
      ),
      enabled: bool('enable_private_message', true),
    };
  });

  /* ------------------------------------------------------------ 单条消息 */
  app.get('/api/messages/:id', async (request) => {
    const user = requireUser(request);
    const id = parseId((request.params as any).id);
    const row = get<any>(
      `SELECT m.*, u.username AS from_username, u.display_name AS from_display, u.avatar AS from_avatar
         FROM messages m LEFT JOIN users u ON u.id = m.from_id
        WHERE m.id = ? AND (m.to_id = ? OR m.from_id = ?)`,
      [id, user.id, user.id],
    );
    if (!row) throw notFound('消息不存在');
    if (row.to_id === user.id) run('UPDATE messages SET is_read = 1 WHERE id = ?', [id]);
    return { message: { ...row, is_read: 1 } };
  });

  app.post('/api/messages/read-all', async (request) => {
    const user = requireUser(request);
    const body = (request.body ?? {}) as any;
    if (body.conversationKey) {
      run('UPDATE messages SET is_read = 1 WHERE conversation_key = ? AND to_id = ? AND is_read = 0', [
        String(body.conversationKey),
        user.id,
      ]);
    } else if (body.privateOnly) {
      run(`UPDATE messages SET is_read = 1 WHERE to_id = ? AND is_read = 0 AND type = 'user'`, [user.id]);
    } else {
      run('UPDATE messages SET is_read = 1 WHERE to_id = ? AND is_read = 0', [user.id]);
    }
    return { ok: true };
  });

  app.delete('/api/messages/:id', async (request) => {
    const user = requireUser(request);
    const id = parseId((request.params as any).id);
    run('DELETE FROM messages WHERE id = ? AND (to_id = ? OR from_id = ?)', [id, user.id, user.id]);
    return { ok: true };
  });

  /** 清空与某个用户的整个会话（只删除自己可见的部分） */
  app.delete('/api/messages/conversation/:username', async (request) => {
    const user = requireUser(request);
    const peer = findUser(String((request.params as any).username));
    const key = conversationKey(user.id, peer.id);
    run('DELETE FROM messages WHERE conversation_key = ? AND (to_id = ? OR from_id = ?)', [key, user.id, user.id]);
    audit(request, 'message.clear_conversation', { targetType: 'user', targetId: peer.id });
    return { ok: true };
  });

  /** 搜索可以私信的用户（供发件人选择器使用） */
  app.get('/api/messages/recipients', async (request) => {
    requireUser(request);
    const term = String((request.query as any)?.q ?? '').trim();
    if (!term) return { items: [] };
    const like = sqlLike(term);
    const items = all<any>(
      `SELECT id, username, display_name, avatar, role, solved_count FROM users
        WHERE is_banned = 0 AND (username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')
        ORDER BY solved_count DESC LIMIT 10`,
      [like, like],
    );
    return { items };
  });
}
