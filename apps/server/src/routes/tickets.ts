import type { FastifyInstance } from 'fastify';
import { all, count, get, run, tx } from '../db/index.js';
import { hasRole, requireAdmin, requireSuperAdmin, requireUser } from '../lib/auth.js';
import { badRequest, conflict, forbidden, notFound, tooMany } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { bool, json as settingJson, num, str } from '../settings/index.js';
import { parseId, parsePage, rateLimit, sqlLike } from '../lib/util.js';
import { randomCode } from '../lib/crypto.js';
import { sendMessage, notifyAdmins } from '../lib/notify.js';
import { evaluateAchievements } from '../lib/achievements.js';

const STATUS_LABEL: Record<string, string> = {
  open: '待处理',
  processing: '处理中',
  replied: '已回复',
  resolved: '已解决',
  closed: '已关闭',
};

const PRIORITY_LABEL: Record<string, string> = {
  low: '低',
  normal: '普通',
  high: '高',
  urgent: '紧急',
};

interface TicketCategory {
  value: string;
  label: string;
  description?: string;
}

function categories(): TicketCategory[] {
  const configured = settingJson<TicketCategory[]>('ticket_categories', []);
  return Array.isArray(configured) && configured.length
    ? configured
    : [
        { value: 'bug', label: '站点故障 / Bug' },
        { value: 'problem', label: '题目问题' },
        { value: 'account', label: '账号问题' },
        { value: 'other', label: '其它' },
      ];
}

function categoryLabel(value: string): string {
  return categories().find((item) => item.value === value)?.label ?? value;
}

function ticketNo(): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `TK${stamp}${randomCode(4)}`;
}

/** Close tickets that stayed "resolved" for too long (lazy maintenance). */
export function autoCloseTickets(): number {
  const days = num('ticket_auto_close_days', 7);
  if (days <= 0) return 0;
  const info = run(
    `UPDATE tickets SET status = 'closed', closed_at = datetime('now'), updated_at = datetime('now')
      WHERE status = 'resolved' AND resolved_at IS NOT NULL AND resolved_at < datetime('now', ?)`,
    [`-${days} days`],
  );
  return info.changes;
}

function ticketSummary(row: any) {
  return {
    id: row.id,
    ticketNo: row.ticket_no,
    title: row.title,
    category: row.category,
    categoryLabel: categoryLabel(row.category),
    priority: row.priority,
    priorityLabel: PRIORITY_LABEL[row.priority] ?? row.priority,
    status: row.status,
    statusLabel: STATUS_LABEL[row.status] ?? row.status,
    isEscalated: Boolean(row.is_escalated),
    relatedType: row.related_type,
    relatedId: row.related_id,
    relatedLabel: row.related_label,
    replyCount: row.reply_count,
    lastReplyAt: row.last_reply_at,
    lastReplyBy: row.last_reply_by,
    assignee: row.assignee_name
      ? { id: row.assignee_id, username: row.assignee_name, display_name: row.assignee_display }
      : null,
    user: {
      id: row.user_id,
      username: row.username,
      display_name: row.display_name,
      avatar: row.avatar,
    },
    rating: row.rating ?? null,
    unreadForAdmin: Boolean(row.unread_for_admin),
    unreadForUser: Boolean(row.unread_for_user),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    closedAt: row.closed_at,
  };
}

export async function registerTicketRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------------------------------------- 元信息 */
  app.get('/api/tickets/meta', async (request) => {
    const user = request.user;
    const openCount = user
      ? count(`SELECT COUNT(*) AS c FROM tickets WHERE user_id = ? AND status IN ('open','processing','replied')`, [
          user.id,
        ])
      : 0;
    return {
      enabled: bool('enable_tickets', true),
      showEntry: bool('ticket_show_entry', true),
      categories: categories(),
      allowPriority: bool('ticket_allow_priority', true),
      allowRating: bool('ticket_allow_rating', true),
      notice: str('ticket_notice', ''),
      maxOpen: num('ticket_max_open', 5),
      maxContentKb: num('ticket_max_content_kb', 8),
      openCount,
      unread: user ? count('SELECT COUNT(*) AS c FROM tickets WHERE user_id = ? AND unread_for_user = 1', [user.id]) : 0,
    };
  });

  /* ------------------------------------------------------------- 提交工单 */
  app.post('/api/tickets', async (request) => {
    const user = requireUser(request);
    if (!bool('enable_tickets', true)) throw forbidden('本站暂未开放工单系统');
    const body = (request.body ?? {}) as any;

    const title = String(body.title ?? '').trim();
    const content = String(body.content ?? '').trim();
    if (title.length < 4) throw badRequest('工单标题至少 4 个字符');
    if (title.length > 150) throw badRequest('工单标题最多 150 个字符');
    if (content.length < 10) throw badRequest('请详细描述你的问题（至少 10 个字符）');
    const maxKb = num('ticket_max_content_kb', 8);
    if (Buffer.byteLength(content, 'utf8') > maxKb * 1024) {
      throw badRequest(`工单内容不能超过 ${maxKb} KB`);
    }

    const config = categories();
    const category = config.some((item) => item.value === body.category) ? String(body.category) : config[0]!.value;
    let priority = bool('ticket_allow_priority', true) && ['low', 'normal', 'high', 'urgent'].includes(body.priority)
      ? body.priority
      : 'normal';
    if (!hasRole(user, 'admin') && priority === 'urgent') priority = 'high';

    const interval = num('ticket_rate_limit_seconds', 60);
    if (!rateLimit(`ticket:${user.id}`, interval)) {
      throw tooMany(`提交工单过于频繁，请 ${interval} 秒后再试`);
    }
    const maxOpen = num('ticket_max_open', 5);
    if (maxOpen > 0 && !hasRole(user, 'admin')) {
      const openCount = count(
        `SELECT COUNT(*) AS c FROM tickets WHERE user_id = ? AND status IN ('open','processing','replied')`,
        [user.id],
      );
      if (openCount >= maxOpen) {
        throw conflict(`你已有 ${openCount} 个未完成的工单，请等待处理完成后再提交`);
      }
    }

    const relatedType = ['problem', 'submission', 'contest', 'discussion', 'user']
      .includes(String(body.relatedType ?? ''))
      ? String(body.relatedType)
      : '';
    const relatedId = relatedType && Number.isFinite(Number(body.relatedId)) ? Number(body.relatedId) : null;
    let relatedLabel = '';
    if (relatedType === 'problem' && relatedId) {
      const problem = get<{ pid: string; title: string }>('SELECT pid, title FROM problems WHERE id = ?', [relatedId]);
      relatedLabel = problem ? `${problem.pid} ${problem.title}` : '';
    } else if (relatedType === 'submission' && relatedId) {
      relatedLabel = `提交 #${relatedId}`;
    } else if (relatedType === 'contest' && relatedId) {
      const contest = get<{ title: string }>('SELECT title FROM contests WHERE id = ?', [relatedId]);
      relatedLabel = contest?.title ?? '';
    } else if (relatedType === 'discussion' && relatedId) {
      const discussion = get<{ title: string }>('SELECT title FROM discussions WHERE id = ?', [relatedId]);
      relatedLabel = discussion?.title ?? '';
    } else if (relatedType === 'user') {
      relatedLabel = String(body.relatedLabel ?? '').slice(0, 100);
    }

    const id = tx(() =>
      Number(
        run(
          `INSERT INTO tickets (ticket_no, user_id, category, title, content, priority, related_type, related_id, related_label)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [ticketNo(), user.id, category, title, content, priority, relatedType, relatedId, relatedLabel],
        ).lastInsertRowid,
      ),
    );

    if (bool('ticket_notify_admin', true)) {
      notifyAdmins(
        `📮 新工单：${title}`,
        `用户 ${user.username} 提交了「${categoryLabel(category)}」工单（优先级：${PRIORITY_LABEL[priority]}）。\n\n${content.slice(0, 300)}`,
        { refType: 'ticket', refId: id },
      );
    }
    audit(request, 'ticket.create', { targetType: 'ticket', targetId: id, detail: { category, priority } });
    evaluateAchievements(user.id, { silent: true });
    return { ok: true, id, ticketNo: get<{ ticket_no: string }>('SELECT ticket_no FROM tickets WHERE id = ?', [id])?.ticket_no };
  });

  /* ------------------------------------------------------------- 我的工单 */
  app.get('/api/tickets', async (request) => {
    const user = requireUser(request);
    autoCloseTickets();
    const query = request.query as any;
    const page = parsePage(query, num('ticket_list_page_size', 20));
    const conditions: string[] = [];
    const params: unknown[] = [];
    const isAdmin = hasRole(user, 'admin');

    if (isAdmin && query.all === 'true') {
      // administrators can list every ticket through the same endpoint
    } else {
      conditions.push('t.user_id = ?');
      params.push(user.id);
    }
    if (query.status && query.status !== 'all') {
      if (query.status === 'unfinished') {
        conditions.push(`t.status IN ('open','processing','replied')`);
      } else {
        conditions.push('t.status = ?');
        params.push(String(query.status));
      }
    }
    if (query.category) {
      conditions.push('t.category = ?');
      params.push(String(query.category));
    }
    if (query.q) {
      conditions.push(`(t.title LIKE ? ESCAPE '\\' OR t.content LIKE ? ESCAPE '\\' OR t.ticket_no LIKE ? ESCAPE '\\')`);
      const like = sqlLike(String(query.q));
      params.push(like, like, like);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = all<any>(
      `SELECT t.*, u.username, u.display_name, u.avatar,
              a.username AS assignee_name, a.display_name AS assignee_display
         FROM tickets t
         JOIN users u ON u.id = t.user_id
         LEFT JOIN users a ON a.id = t.assignee_id
         ${where}
        ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'processing' THEN 1 WHEN 'replied' THEN 2 WHEN 'resolved' THEN 3 ELSE 4 END,
                 t.is_escalated DESC, COALESCE(t.last_reply_at, t.created_at) DESC
        LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    const total = count(`SELECT COUNT(*) AS c FROM tickets t ${where}`, params);
    return {
      items: rows.map(ticketSummary),
      total,
      page: page.page,
      size: page.size,
      counts: {
        open: count(`SELECT COUNT(*) AS c FROM tickets WHERE status = 'open'`),
        processing: count(`SELECT COUNT(*) AS c FROM tickets WHERE status = 'processing'`),
        replied: count(`SELECT COUNT(*) AS c FROM tickets WHERE status = 'replied'`),
        resolved: count(`SELECT COUNT(*) AS c FROM tickets WHERE status = 'resolved'`),
        closed: count(`SELECT COUNT(*) AS c FROM tickets WHERE status = 'closed'`),
        mine: count('SELECT COUNT(*) AS c FROM tickets WHERE user_id = ?', [user.id]),
      },
    };
  });

  /* ------------------------------------------------------------- 工单详情 */
  app.get('/api/tickets/:id', async (request) => {
    const user = requireUser(request);
    const id = parseId((request.params as any).id);
    const ticket = get<any>(
      `SELECT t.*, u.username, u.display_name, u.avatar,
              a.username AS assignee_name, a.display_name AS assignee_display
         FROM tickets t JOIN users u ON u.id = t.user_id
         LEFT JOIN users a ON a.id = t.assignee_id
        WHERE t.id = ?`,
      [id],
    );
    if (!ticket) throw notFound('工单不存在');
    const isAdmin = hasRole(user, 'admin');
    if (ticket.user_id !== user.id && !isAdmin) throw forbidden('无权查看该工单');

    const replies = all<any>(
      `SELECT r.*, u.username, u.display_name, u.avatar, u.role
         FROM ticket_replies r JOIN users u ON u.id = r.author_id
        WHERE r.ticket_id = ? ${isAdmin ? '' : 'AND r.is_internal = 0'}
        ORDER BY r.id ASC`,
      [id],
    );
    // Mark as read for the current side.
    if (isAdmin) run('UPDATE tickets SET unread_for_admin = 0 WHERE id = ?', [id]);
    else run('UPDATE tickets SET unread_for_user = 0 WHERE id = ?', [id]);

    return {
      ticket: {
        ...ticketSummary(ticket),
        content: ticket.content,
        rating: ticket.rating ?? null,
        ratingComment: ticket.rating_comment,
        canReply: ticket.status !== 'closed' || isAdmin,
        canManage: isAdmin,
        canRate:
          ticket.user_id === user.id &&
          bool('ticket_allow_rating', true) &&
          ['resolved', 'closed'].includes(ticket.status) &&
          !ticket.rating,
      },
      replies: replies.map((reply) => ({
        id: reply.id,
        content: reply.content,
        isInternal: Boolean(reply.is_internal),
        createdAt: reply.created_at,
        author: {
          id: reply.author_id,
          username: reply.username,
          display_name: reply.display_name,
          avatar: reply.avatar,
          role: reply.role,
        },
      })),
    };
  });

  /* ---------------------------------------------------------------- 回复 */
  app.post('/api/tickets/:id/replies', async (request) => {
    const user = requireUser(request);
    const id = parseId((request.params as any).id);
    const ticket = get<any>('SELECT * FROM tickets WHERE id = ?', [id]);
    if (!ticket) throw notFound('工单不存在');
    const isAdmin = hasRole(user, 'admin');
    if (ticket.user_id !== user.id && !isAdmin) throw forbidden('无权回复该工单');
    if (ticket.status === 'closed' && !isAdmin) throw forbidden('工单已关闭，如需继续请重新提交工单');

    const body = (request.body ?? {}) as any;
    const content = String(body.content ?? '').trim();
    if (!content) throw badRequest('回复内容不能为空');
    const maxKb = num('ticket_max_content_kb', 8);
    if (Buffer.byteLength(content, 'utf8') > maxKb * 1024) throw badRequest(`回复内容不能超过 ${maxKb} KB`);
    const isInternal = isAdmin && Boolean(body.isInternal);

    tx(() => {
      run('INSERT INTO ticket_replies (ticket_id, author_id, content, is_internal) VALUES (?, ?, ?, ?)', [
        id,
        user.id,
        content,
        isInternal ? 1 : 0,
      ]);
      const nextStatus = isInternal
        ? ticket.status
        : isAdmin
          ? ticket.status === 'closed'
            ? 'closed'
            : 'replied'
          : ['resolved', 'closed'].includes(ticket.status)
            ? 'processing'
            : 'open';
      run(
        `UPDATE tickets SET reply_count = reply_count + 1, last_reply_at = datetime('now'),
           last_reply_by = ?, status = ?, unread_for_admin = ?, unread_for_user = ?,
           resolved_at = CASE WHEN ? IN ('resolved','closed') THEN resolved_at ELSE NULL END,
           updated_at = datetime('now')
         WHERE id = ?`,
        [
          isAdmin ? 'admin' : 'user',
          nextStatus,
          isInternal ? ticket.unread_for_admin : 1,
          isAdmin && !isInternal ? 1 : 0,
          nextStatus,
          id,
        ],
      );
    });

    if (!isInternal) {
      if (isAdmin && bool('ticket_notify_user', true)) {
        sendMessage({
          to: ticket.user_id,
          title: `工单 ${ticket.ticket_no} 有新的回复`,
          content: `管理员回复了你的工单「${ticket.title}」：\n\n${content.slice(0, 500)}`,
          type: 'system',
          refType: 'ticket',
          refId: id,
        });
      }
      if (!isAdmin && bool('ticket_notify_admin', true)) {
        notifyAdmins(`工单 ${ticket.ticket_no} 有新回复`, `用户 ${user.username} 补充了内容：\n\n${content.slice(0, 300)}`, {
          refType: 'ticket',
          refId: id,
        });
      }
    }
    audit(request, 'ticket.reply', { targetType: 'ticket', targetId: id, detail: { internal: isInternal } });
    return { ok: true };
  });

  /* ------------------------------------------------------ 关闭 / 重开 / 评价 */
  app.post('/api/tickets/:id/status', async (request) => {
    const user = requireUser(request);
    const id = parseId((request.params as any).id);
    const ticket = get<any>('SELECT * FROM tickets WHERE id = ?', [id]);
    if (!ticket) throw notFound('工单不存在');
    const isAdmin = hasRole(user, 'admin');
    if (ticket.user_id !== user.id && !isAdmin) throw forbidden('无权操作该工单');
    const body = (request.body ?? {}) as any;
    const status = String(body.status ?? '');
    if (!['open', 'processing', 'replied', 'resolved', 'closed'].includes(status)) {
      throw badRequest('无效的工单状态');
    }
    if (!isAdmin && !['closed', 'open'].includes(status)) throw forbidden('只有管理员可以修改处理状态');
    if (!isAdmin && status === 'closed' && ticket.user_id !== user.id) throw forbidden();

    tx(() => {
      run(
        `UPDATE tickets SET status = ?,
           resolved_at = CASE WHEN ? = 'resolved' THEN datetime('now')
                              WHEN ? IN ('open','processing') THEN NULL
                              ELSE resolved_at END,
           closed_at = CASE WHEN ? = 'closed' THEN datetime('now') ELSE closed_at END,
           unread_for_user = CASE WHEN ? = 'resolved' THEN 1 ELSE unread_for_user END,
           updated_at = datetime('now')
         WHERE id = ?`,
        [status, status, status, status, status, id],
      );
      if (body.note) {
        run('INSERT INTO ticket_replies (ticket_id, author_id, content, is_internal) VALUES (?, ?, ?, 0)', [
          id,
          user.id,
          String(body.note),
        ]);
        run('UPDATE tickets SET reply_count = reply_count + 1, last_reply_at = datetime(\'now\') WHERE id = ?', [id]);
      }
    });

    if (isAdmin && bool('ticket_notify_user', true)) {
      const label = STATUS_LABEL[status] ?? status;
      sendMessage({
        to: ticket.user_id,
        title: `工单 ${ticket.ticket_no} 状态更新：${label}`,
        content: `你的工单「${ticket.title}」已被标记为「${label}」。${body.note ? `\n\n处理说明：${body.note}` : ''}`,
        type: 'system',
        refType: 'ticket',
        refId: id,
      });
    }
    audit(request, 'ticket.status', { targetType: 'ticket', targetId: id, detail: { status } });
    return { ok: true, status };
  });

  app.post('/api/tickets/:id/rating', async (request) => {
    const user = requireUser(request);
    if (!bool('ticket_allow_rating', true)) throw forbidden('本站未开放工单评价');
    const id = parseId((request.params as any).id);
    const ticket = get<any>('SELECT * FROM tickets WHERE id = ?', [id]);
    if (!ticket) throw notFound('工单不存在');
    if (ticket.user_id !== user.id) throw forbidden('只有工单提交者可以评价');
    if (!['resolved', 'closed'].includes(ticket.status)) throw badRequest('工单处理完成后才能评价');
    const body = (request.body ?? {}) as any;
    const rating = Math.max(1, Math.min(5, Number(body.rating) || 5));
    run(
      `UPDATE tickets SET rating = ?, rating_comment = ?, rated_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?`,
      [rating, String(body.comment ?? '').slice(0, 500), id],
    );
    audit(request, 'ticket.rating', { targetType: 'ticket', targetId: id, detail: { rating } });
    return { ok: true, rating };
  });

  /* --------------------------------------------------------- 管理员处理台 */
  app.get('/api/admin/tickets', async (request) => {
    requireAdmin(request);
    autoCloseTickets();
    const query = request.query as any;
    const page = parsePage(query, num('ticket_list_page_size', 20));
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.status && query.status !== 'all') {
      if (query.status === 'unfinished') conditions.push(`t.status IN ('open','processing','replied')`);
      else {
        conditions.push('t.status = ?');
        params.push(String(query.status));
      }
    }
    if (query.category) {
      conditions.push('t.category = ?');
      params.push(String(query.category));
    }
    if (query.priority) {
      conditions.push('t.priority = ?');
      params.push(String(query.priority));
    }
    if (query.assignee === 'me') {
      conditions.push('t.assignee_id = ?');
      params.push(request.user!.id);
    }
    if (query.assignee === 'none') conditions.push('t.assignee_id IS NULL');
    if (query.escalated === 'true') conditions.push('t.is_escalated = 1');
    if (query.q) {
      conditions.push(
        `(t.title LIKE ? ESCAPE '\\' OR t.content LIKE ? ESCAPE '\\' OR t.ticket_no LIKE ? ESCAPE '\\'
          OR u.username LIKE ? ESCAPE '\\')`,
      );
      const like = sqlLike(String(query.q));
      params.push(like, like, like, like);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = all<any>(
      `SELECT t.*, u.username, u.display_name, u.avatar, u.role AS user_role,
              a.username AS assignee_name, a.display_name AS assignee_display
         FROM tickets t JOIN users u ON u.id = t.user_id
         LEFT JOIN users a ON a.id = t.assignee_id
         ${where}
        ORDER BY t.is_escalated DESC,
                 CASE t.status WHEN 'open' THEN 0 WHEN 'processing' THEN 1 WHEN 'replied' THEN 2 WHEN 'resolved' THEN 3 ELSE 4 END,
                 CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                 COALESCE(t.last_reply_at, t.created_at) DESC
        LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    const total = count(
      `SELECT COUNT(*) AS c FROM tickets t JOIN users u ON u.id = t.user_id ${where}`,
      params,
    );
    const ratingRow = get<{ avg: number | null; c: number }>(
      'SELECT AVG(rating) AS avg, COUNT(*) AS c FROM tickets WHERE rating IS NOT NULL',
    );
    return {
      items: rows.map(ticketSummary),
      total,
      page: page.page,
      size: page.size,
      stats: {
        open: count(`SELECT COUNT(*) AS c FROM tickets WHERE status = 'open'`),
        processing: count(`SELECT COUNT(*) AS c FROM tickets WHERE status = 'processing'`),
        replied: count(`SELECT COUNT(*) AS c FROM tickets WHERE status = 'replied'`),
        resolved: count(`SELECT COUNT(*) AS c FROM tickets WHERE status = 'resolved'`),
        closed: count(`SELECT COUNT(*) AS c FROM tickets WHERE status = 'closed'`),
        unread: count('SELECT COUNT(*) AS c FROM tickets WHERE unread_for_admin = 1'),
        escalated: count('SELECT COUNT(*) AS c FROM tickets WHERE is_escalated = 1'),
        today: count(`SELECT COUNT(*) AS c FROM tickets WHERE created_at >= date('now')`),
        avgRating: ratingRow?.avg ? Math.round(ratingRow.avg * 10) / 10 : null,
        ratingCount: ratingRow?.c ?? 0,
        byCategory: all<{ category: string; c: number }>(
          'SELECT category, COUNT(*) AS c FROM tickets GROUP BY category ORDER BY c DESC',
        ).map((row) => ({ ...row, label: categoryLabel(row.category) })),
      },
    };
  });

  app.put('/api/admin/tickets/:id', async (request) => {
    const admin = requireAdmin(request);
    const id = parseId((request.params as any).id);
    const ticket = get<any>('SELECT * FROM tickets WHERE id = ?', [id]);
    if (!ticket) throw notFound('工单不存在');
    const body = (request.body ?? {}) as any;
    const fields: string[] = [];
    const values: unknown[] = [];

    if (body.status !== undefined) {
      const status = String(body.status);
      if (!['open', 'processing', 'replied', 'resolved', 'closed'].includes(status)) {
        throw badRequest('无效的工单状态');
      }
      fields.push('status = ?');
      values.push(status);
      if (status === 'resolved') {
        fields.push('resolved_at = datetime(\'now\')', 'unread_for_user = 1');
      }
      if (status === 'closed') fields.push('closed_at = datetime(\'now\')', 'unread_for_user = 1');
      if (status === 'open' || status === 'processing') {
        fields.push('resolved_at = NULL', 'closed_at = NULL');
      }
    }
    if (body.priority !== undefined) {
      const priority = String(body.priority);
      if (!['low', 'normal', 'high', 'urgent'].includes(priority)) throw badRequest('无效的优先级');
      fields.push('priority = ?');
      values.push(priority);
    }
    if (body.category !== undefined && categories().some((item) => item.value === body.category)) {
      fields.push('category = ?');
      values.push(String(body.category));
    }
    if (body.assigneeId !== undefined) {
      if (body.assigneeId === null || body.assigneeId === 0) {
        fields.push('assignee_id = NULL');
      } else {
        const target = get<{ id: number; role: string }>('SELECT id, role FROM users WHERE id = ?', [
          Number(body.assigneeId),
        ]);
        if (!target) throw notFound('指派的用户不存在');
        if (!['admin', 'superadmin'].includes(target.role)) throw badRequest('只能指派给管理员');
        fields.push('assignee_id = ?');
        values.push(target.id);
      }
    }
    if (body.isEscalated !== undefined) {
      fields.push('is_escalated = ?');
      values.push(body.isEscalated ? 1 : 0);
    }
    if (body.markRead) fields.push('unread_for_admin = 0');
    if (!fields.length) throw badRequest('没有需要更新的内容');
    fields.push(`updated_at = datetime('now')`);
    values.push(id);
    run(`UPDATE tickets SET ${fields.join(', ')} WHERE id = ?`, values);

    if (body.status && bool('ticket_notify_user', true)) {
      const label = STATUS_LABEL[String(body.status)] ?? String(body.status);
      sendMessage({
        to: ticket.user_id,
        title: `工单 ${ticket.ticket_no} 状态更新：${label}`,
        content: `你的工单「${ticket.title}」当前状态：${label}。`,
        type: 'system',
        refType: 'ticket',
        refId: id,
      });
    }
    audit(request, 'admin.ticket_update', {
      targetType: 'ticket',
      targetId: id,
      detail: { fields: Object.keys(body), by: admin.username },
    });
    return { ok: true };
  });

  app.post('/api/admin/tickets/:id/assign-me', async (request) => {
    const admin = requireAdmin(request);
    const id = parseId((request.params as any).id);
    const ticket = get<any>('SELECT * FROM tickets WHERE id = ?', [id]);
    if (!ticket) throw notFound('工单不存在');
    run(
      `UPDATE tickets SET assignee_id = ?, status = CASE WHEN status = 'open' THEN 'processing' ELSE status END,
         unread_for_admin = 0, updated_at = datetime('now') WHERE id = ?`,
      [admin.id, id],
    );
    audit(request, 'admin.ticket_assign', { targetType: 'ticket', targetId: id, detail: { assignee: admin.username } });
    return { ok: true };
  });

  app.delete('/api/admin/tickets/:id', async (request) => {
    requireSuperAdmin(request);
    const id = parseId((request.params as any).id);
    const ticket = get<any>('SELECT * FROM tickets WHERE id = ?', [id]);
    if (!ticket) throw notFound('工单不存在');
    tx(() => {
      run('DELETE FROM ticket_replies WHERE ticket_id = ?', [id]);
      run('DELETE FROM tickets WHERE id = ?', [id]);
    });
    audit(request, 'admin.ticket_delete', { targetType: 'ticket', targetId: id, detail: { no: ticket.ticket_no } });
    return { ok: true };
  });

  app.get('/api/admin/tickets/:id', async (request) => {
    requireAdmin(request);
    const id = parseId((request.params as any).id);
    run('UPDATE tickets SET unread_for_admin = 0 WHERE id = ?', [id]);
    const ticket = get<any>(
      `SELECT t.*, u.username, u.display_name, u.avatar, a.username AS assignee_name
         FROM tickets t JOIN users u ON u.id = t.user_id
         LEFT JOIN users a ON a.id = t.assignee_id WHERE t.id = ?`,
      [id],
    );
    if (!ticket) throw notFound('工单不存在');
    const replies = all<any>(
      `SELECT r.*, u.username, u.display_name, u.avatar, u.role
         FROM ticket_replies r JOIN users u ON u.id = r.author_id
        WHERE r.ticket_id = ? ORDER BY r.id ASC`,
      [id],
    );
    return { ticket: ticketSummary(ticket), content: ticket.content, replies };
  });
}
