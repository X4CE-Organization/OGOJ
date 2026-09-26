import type { FastifyInstance } from 'fastify';
import { all, backupDatabase, count, db, get, listBackups, run, tx } from '../db/index.js';
import { hasRole, requireAdmin, requireSuperAdmin, requireUser } from '../lib/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { hashPassword } from '../lib/crypto.js';
import { addPoints } from '../lib/points.js';
import { sendMessage } from '../lib/notify.js';
import { SETTING_GROUPS, SETTINGS, allSettings, publicSettings, rawSetting, resetSettings, updateSettings } from '../settings/index.js';
import { num, str, bool } from '../settings/index.js';
import { parseId, parsePage, sqlLike, toBool } from '../lib/util.js';
import { judgeStats, rejudge } from '../judge/index.js';
import { AVAILABLE_LANGUAGE_IDS } from '../judge/languages.js';
import { workerState } from '../judge/worker.js';

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  /** Total size of the SQLite database file in bytes. */
  function databaseSize(): number {
    const row = db
      .prepare('SELECT page_count * page_size AS size FROM pragma_page_count(), pragma_page_size()')
      .get() as { size?: number } | undefined;
    return Number(row?.size ?? 0);
  }

  /* ------------------------------------------------------------ 控制面板 */
  app.get('/api/admin/dashboard', async (request) => {
    requireAdmin(request);
    const today = "date('now')";
    const users = {
      total: count('SELECT COUNT(*) AS c FROM users'),
      banned: count('SELECT COUNT(*) AS c FROM users WHERE is_banned = 1'),
      admins: count(`SELECT COUNT(*) AS c FROM users WHERE role IN ('admin','superadmin')`),
      newToday: count(`SELECT COUNT(*) AS c FROM users WHERE created_at >= ${today}`),
      active7d: count(`SELECT COUNT(*) AS c FROM users WHERE last_login_at >= datetime('now','-7 days')`),
    };
    const problems = {
      total: count(`SELECT COUNT(*) AS c FROM problems WHERE deleted_at IS NULL`),
      public: count(`SELECT COUNT(*) AS c FROM problems WHERE is_public = 1 AND review_status = 'approved' AND deleted_at IS NULL`),
      pending: count(`SELECT COUNT(*) AS c FROM problems WHERE review_status = 'pending'`),
      contestOnly: count(`SELECT COUNT(*) AS c FROM problems WHERE is_contest_only = 1`),
    };
    const submissions = {
      total: count('SELECT COUNT(*) AS c FROM submissions'),
      today: count(`SELECT COUNT(*) AS c FROM submissions WHERE created_at >= ${today}`),
      accepted: count(`SELECT COUNT(*) AS c FROM submissions WHERE status = 'AC'`),
      waiting: count(`SELECT COUNT(*) AS c FROM submissions WHERE status = 'Waiting'`),
      judging: count(`SELECT COUNT(*) AS c FROM submissions WHERE status = 'Judging'`),
      error: count(`SELECT COUNT(*) AS c FROM submissions WHERE status IN ('SE','UKOE')`),
    };
    const contests = {
      total: count('SELECT COUNT(*) AS c FROM contests WHERE deleted_at IS NULL'),
      running: count(`SELECT COUNT(*) AS c FROM contests WHERE start_time <= datetime('now') AND end_time >= datetime('now')`),
      upcoming: count(`SELECT COUNT(*) AS c FROM contests WHERE start_time > datetime('now')`),
      pending: count(`SELECT COUNT(*) AS c FROM contests WHERE review_status = 'pending'`),
    };
    const community = {
      discussions: count('SELECT COUNT(*) AS c FROM discussions WHERE is_deleted = 0'),
      replies: count('SELECT COUNT(*) AS c FROM discussion_replies WHERE is_deleted = 0'),
      articles: count('SELECT COUNT(*) AS c FROM articles WHERE is_deleted = 0'),
      solutions: count('SELECT COUNT(*) AS c FROM solutions WHERE is_deleted = 0'),
      pendingSolutions: count('SELECT COUNT(*) AS c FROM solutions WHERE is_deleted = 0 AND is_public = 0'),
    };
    const shop = {
      items: count('SELECT COUNT(*) AS c FROM shop_items'),
      pendingOrders: count(`SELECT COUNT(*) AS c FROM shop_orders WHERE status = 'pending'`),
      orders: count('SELECT COUNT(*) AS c FROM shop_orders'),
      pointsInCirculation: Number(get<{ total: number | null }>('SELECT SUM(points) AS total FROM users')?.total ?? 0),
    };
    const trend = all<any>(
      `SELECT date(created_at) AS day, COUNT(*) AS submissions,
              SUM(CASE WHEN status = 'AC' THEN 1 ELSE 0 END) AS accepted
         FROM submissions WHERE created_at >= date('now', '-13 days')
        GROUP BY day ORDER BY day ASC`,
    );
    const userTrend = all<any>(
      `SELECT date(created_at) AS day, COUNT(*) AS users FROM users
        WHERE created_at >= date('now', '-13 days') GROUP BY day ORDER BY day ASC`,
    );
    const topProblems = all<any>(
      `SELECT p.id, p.pid, p.title, COUNT(s.id) AS submissions FROM problems p
         LEFT JOIN submissions s ON s.problem_id = p.id
        WHERE p.deleted_at IS NULL GROUP BY p.id ORDER BY submissions DESC LIMIT 10`,
    );
    const recentActions = all<any>(
      `SELECT id, actor_name, action, target_type, target_id, created_at FROM audit_logs
        ORDER BY id DESC LIMIT 12`,
    );
    const system = {
      judge: judgeStats(),
      worker: workerState(),
      dbSize: databaseSize(),
      sqliteVersion: (db.prepare('SELECT sqlite_version() AS v').get() as any)?.v,
      nodeVersion: process.version,
      platform: process.platform,
      uptime: Math.round(process.uptime()),
      memory: process.memoryUsage(),
      languages: AVAILABLE_LANGUAGE_IDS,
      backups: listBackups().slice(0, 5),
    };
    return { users, problems, submissions, contests, community, shop, trend, userTrend, topProblems, recentActions, system };
  });

  /* ------------------------------------------------------------- 系统设置 */
  app.get('/api/admin/settings', async (request) => {
    requireSuperAdmin(request);
    return {
      groups: SETTING_GROUPS,
      fields: SETTINGS,
      values: allSettings({ maskSecrets: true }),
      publicValues: publicSettings(),
    };
  });

  app.put('/api/admin/settings', async (request) => {
    requireSuperAdmin(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const patch = (body.values ?? body) as Record<string, unknown>;
    if (typeof patch !== 'object' || patch === null) throw badRequest('请求体格式不正确');
    const changes = updateSettings(patch);
    audit(request, 'settings.update', { detail: changes.map((c) => c.key) });
    return { ok: true, changed: changes.map((c) => c.key), values: allSettings({ maskSecrets: true }) };
  });

  app.post('/api/admin/settings/reset', async (request) => {
    requireSuperAdmin(request);
    const keys = (request.body as any)?.keys;
    resetSettings(Array.isArray(keys) && keys.length ? keys.map(String) : undefined);
    audit(request, 'settings.reset', { detail: { keys } });
    return { ok: true, values: allSettings({ maskSecrets: true }) };
  });

  app.get('/api/admin/settings/export', async (request, reply) => {
    requireSuperAdmin(request);
    reply.header('Content-Disposition', 'attachment; filename="ogoj-settings.json"');
    return allSettings();
  });

  /* ------------------------------------------------------------- 用户管理 */
  app.get('/api/admin/users', async (request) => {
    requireAdmin(request);
    const query = request.query as any;
    const page = parsePage(query, 50, 500);
    const conditions = ['1 = 1'];
    const params: unknown[] = [];
    if (query.q) {
      conditions.push(`(username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')`);
      const like = sqlLike(String(query.q));
      params.push(like, like, like);
    }
    if (query.role) {
      conditions.push('role = ?');
      params.push(String(query.role));
    }
    if (query.banned === 'true') conditions.push('is_banned = 1');
    if (query.banned === 'false') conditions.push('is_banned = 0');
    const items = all<any>(
      `SELECT id, username, email, role, display_name, avatar, points, rating, is_banned, ban_reason,
              solved_count, submission_count, created_at, last_login_at, last_login_ip
         FROM users WHERE ${conditions.join(' AND ')}
        ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    const total = count(`SELECT COUNT(*) AS c FROM users WHERE ${conditions.join(' AND ')}`, params);
    return { items, total, page: page.page, size: page.size };
  });

  app.put('/api/admin/users/:id', async (request) => {
    const admin = requireAdmin(request);
    const id = parseId((request.params as any).id);
    const target = get<any>('SELECT * FROM users WHERE id = ?', [id]);
    if (!target) throw notFound('用户不存在');
    const body = (request.body ?? {}) as any;

    if (body.role !== undefined) {
      requireSuperAdmin(request);
      const role = ['user', 'admin', 'superadmin'].includes(body.role) ? body.role : 'user';
      if (target.id === admin.id && role !== 'superadmin') {
        throw badRequest('不能降低自己的权限');
      }
      run('UPDATE users SET role = ? WHERE id = ?', [role, id]);
      sendMessage({
        to: id,
        title: '你的权限已变更',
        content: `管理员将你的角色调整为 ${role}。`,
        type: 'system',
      });
    }

    if (body.isBanned !== undefined) {
      if (target.role === 'superadmin' && !hasRole(admin, 'superadmin')) {
        throw forbidden('不能封禁超级管理员');
      }
      run('UPDATE users SET is_banned = ?, ban_reason = ? WHERE id = ?', [
        body.isBanned ? 1 : 0,
        String(body.banReason ?? ''),
        id,
      ]);
    }

    if (body.points !== undefined) {
      requireSuperAdmin(request);
      const delta = Number(body.points);
      if (Number.isFinite(delta) && delta !== 0) {
        addPoints(id, delta, `管理员调整（${admin.username}）`, { refType: 'admin', refId: admin.id });
      }
    }

    if (typeof body.password === 'string' && body.password) {
      requireSuperAdmin(request);
      if (body.password.length < Number(num('password_min_length', 8))) throw badRequest('密码太短');
      run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(body.password), id]);
    }

    if (body.profile && typeof body.profile === 'object') {
      const fields: string[] = [];
      const values: unknown[] = [];
      for (const key of ['display_name', 'bio', 'school', 'avatar', 'banner', 'email']) {
        if (body.profile[key] !== undefined) {
          fields.push(`${key} = ?`);
          values.push(String(body.profile[key] ?? ''));
        }
      }
      if (fields.length) run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    }

    audit(request, 'admin.user_update', { targetType: 'user', targetId: id, detail: Object.keys(body) });
    return { ok: true, user: get<any>('SELECT * FROM users WHERE id = ?', [id]) };
  });

  app.delete('/api/admin/users/:id', async (request) => {
    const admin = requireSuperAdmin(request);
    const id = parseId((request.params as any).id);
    if (id === admin.id) throw badRequest('不能删除自己的账号');
    const target = get<any>('SELECT * FROM users WHERE id = ?', [id]);
    if (!target) throw notFound('用户不存在');
    if (target.role === 'superadmin') throw forbidden('不能删除超级管理员');
    tx(() => run('DELETE FROM users WHERE id = ?', [id]));
    audit(request, 'admin.user_delete', { targetType: 'user', targetId: id, detail: { username: target.username } });
    return { ok: true };
  });

  /* ------------------------------------------------------------ 题目审核 */
  app.post('/api/admin/problems/:id/review', async (request) => {
    requireAdmin(request);
    const id = parseId((request.params as any).id);
    const problem = get<any>('SELECT * FROM problems WHERE id = ?', [id]);
    if (!problem) throw notFound('题目不存在');
    const body = (request.body ?? {}) as any;
    const approve = body.approve !== false;
    run('UPDATE problems SET review_status = ?, review_note = ?, is_public = ? WHERE id = ?', [
      approve ? 'approved' : 'rejected',
      String(body.note ?? ''),
      approve ? 1 : 0,
      id,
    ]);
    if (problem.owner_id) {
      sendMessage({
        to: problem.owner_id,
        title: approve ? `题目 ${problem.pid} 已通过审核` : `题目 ${problem.pid} 未通过审核`,
        content: approve
          ? '你提交的题目已通过审核并公开。'
          : `审核未通过：${body.note ?? '请修改后重新提交'}`,
        type: 'system',
        refType: 'problem',
        refId: id,
      });
    }
    audit(request, 'admin.problem_review', { targetType: 'problem', targetId: id, detail: { approve } });
    return { ok: true };
  });

  app.get('/api/admin/problems', async (request) => {
    requireAdmin(request);
    const query = request.query as any;
    const page = parsePage(query, 50);
    const conditions = ['p.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (query.review) {
      conditions.push('p.review_status = ?');
      params.push(String(query.review));
    }
    if (query.q) {
      conditions.push(`(p.title LIKE ? ESCAPE '\\' OR p.pid LIKE ? ESCAPE '\\')`);
      const like = sqlLike(String(query.q));
      params.push(like, like);
    }
    const items = all<any>(
      `SELECT p.*, u.username AS owner_name,
              (SELECT COUNT(*) FROM testcases t WHERE t.problem_id = p.id) AS testcase_count
         FROM problems p LEFT JOIN users u ON u.id = p.owner_id
        WHERE ${conditions.join(' AND ')} ORDER BY LENGTH(p.pid) ASC, p.pid ASC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    return {
      items,
      total: count(`SELECT COUNT(*) AS c FROM problems p WHERE ${conditions.join(' AND ')}`, params),
      page: page.page,
      size: page.size,
    };
  });

  /* ------------------------------------------------------------ 比赛审核 */
  app.post('/api/admin/contests/:id/review', async (request) => {
    requireAdmin(request);
    const id = parseId((request.params as any).id);
    const contest = get<any>('SELECT * FROM contests WHERE id = ?', [id]);
    if (!contest) throw notFound('比赛不存在');
    const body = (request.body ?? {}) as any;
    const approve = body.approve !== false;
    run('UPDATE contests SET review_status = ?, review_note = ?, is_public = ? WHERE id = ?', [
      approve ? 'approved' : 'rejected',
      String(body.note ?? ''),
      approve ? 1 : 0,
      id,
    ]);
    if (contest.owner_id) {
      sendMessage({
        to: contest.owner_id,
        title: approve ? '比赛已通过审核' : '比赛未通过审核',
        content: approve
          ? `「${contest.title}」已通过审核，用户可以报名了。`
          : `「${contest.title}」审核未通过：${body.note ?? '请修改后重新提交'}`,
        type: 'system',
        refType: 'contest',
        refId: id,
      });
    }
    audit(request, 'admin.contest_review', { targetType: 'contest', targetId: id, detail: { approve } });
    return { ok: true };
  });

  /* ---------------------------------------------------------- 轮播图管理 */
  app.get('/api/admin/carousel', async (request) => {
    requireAdmin(request);
    return { items: all<any>('SELECT * FROM carousel ORDER BY sort ASC, id ASC') };
  });

  app.post('/api/admin/carousel', async (request) => {
    requireAdmin(request);
    const body = (request.body ?? {}) as any;
    if (!String(body.image ?? '').trim()) throw badRequest('请上传轮播图片');
    const info = run(
      `INSERT INTO carousel (title, subtitle, image, link, sort, is_active) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        String(body.title ?? ''),
        String(body.subtitle ?? ''),
        String(body.image),
        String(body.link ?? ''),
        Number(body.sort ?? 0) || 0,
        body.isActive === false ? 0 : 1,
      ],
    );
    audit(request, 'carousel.create', { targetType: 'carousel', targetId: Number(info.lastInsertRowid) });
    return { ok: true, id: Number(info.lastInsertRowid) };
  });

  app.put('/api/admin/carousel/:id', async (request) => {
    requireAdmin(request);
    const id = parseId((request.params as any).id);
    const body = (request.body ?? {}) as any;
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const key of ['title', 'subtitle', 'image', 'link']) {
      if (body[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(String(body[key]));
      }
    }
    if (body.sort !== undefined) {
      fields.push('sort = ?');
      values.push(Number(body.sort) || 0);
    }
    if (body.isActive !== undefined) {
      fields.push('is_active = ?');
      values.push(body.isActive ? 1 : 0);
    }
    if (fields.length) run(`UPDATE carousel SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    audit(request, 'carousel.update', { targetType: 'carousel', targetId: id });
    return { ok: true };
  });

  app.delete('/api/admin/carousel/:id', async (request) => {
    requireAdmin(request);
    const id = parseId((request.params as any).id);
    run('DELETE FROM carousel WHERE id = ?', [id]);
    audit(request, 'carousel.delete', { targetType: 'carousel', targetId: id });
    return { ok: true };
  });

  /* ------------------------------------------------------------ 公告管理 */
  app.get('/api/admin/announcements', async (request) => {
    requireAdmin(request);
    return {
      items: all<any>(
        `SELECT a.*, u.username FROM announcements a LEFT JOIN users u ON u.id = a.author_id
          ORDER BY a.is_pinned DESC, a.id DESC LIMIT 200`,
      ),
    };
  });

  app.post('/api/admin/announcements', async (request) => {
    const admin = requireAdmin(request);
    const body = (request.body ?? {}) as any;
    const title = String(body.title ?? '').trim();
    if (!title) throw badRequest('公告标题不能为空');
    const info = run(
      `INSERT INTO announcements (title, content, type, is_pinned, is_public, author_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        title.slice(0, 200),
        String(body.content ?? ''),
        ['notice', 'update', 'contest', 'important'].includes(body.type) ? body.type : 'notice',
        body.isPinned ? 1 : 0,
        body.isPublic === false ? 0 : 1,
        admin.id,
      ],
    );
    audit(request, 'announcement.create', { targetType: 'announcement', targetId: Number(info.lastInsertRowid) });
    return { ok: true, id: Number(info.lastInsertRowid) };
  });

  app.put('/api/admin/announcements/:id', async (request) => {
    requireAdmin(request);
    const id = parseId((request.params as any).id);
    const body = (request.body ?? {}) as any;
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const key of ['title', 'content', 'type']) {
      if (body[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(String(body[key]));
      }
    }
    for (const [key, column] of [
      ['isPinned', 'is_pinned'],
      ['isPublic', 'is_public'],
    ] as const) {
      if (body[key] !== undefined) {
        fields.push(`${column} = ?`);
        values.push(body[key] ? 1 : 0);
      }
    }
    if (fields.length) {
      fields.push(`updated_at = datetime('now')`);
      run(`UPDATE announcements SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    }
    audit(request, 'announcement.update', { targetType: 'announcement', targetId: id });
    return { ok: true };
  });

  app.delete('/api/admin/announcements/:id', async (request) => {
    requireAdmin(request);
    const id = parseId((request.params as any).id);
    run('DELETE FROM announcements WHERE id = ?', [id]);
    return { ok: true };
  });

  /* ---------------------------------------------------- 内容审核 / 帖子管理 */
  app.get('/api/admin/discussions', async (request) => {
    requireAdmin(request);
    const query = request.query as any;
    const page = parsePage(query, 50);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.deleted === 'true') conditions.push('d.is_deleted = 1');
    else conditions.push('d.is_deleted = 0');
    if (query.q) {
      conditions.push(`(d.title LIKE ? ESCAPE '\\' OR d.content LIKE ? ESCAPE '\\')`);
      const like = sqlLike(String(query.q));
      params.push(like, like);
    }
    const items = all<any>(
      `SELECT d.*, u.username FROM discussions d JOIN users u ON u.id = d.author_id
        WHERE ${conditions.join(' AND ')} ORDER BY d.id DESC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    return {
      items,
      total: count(`SELECT COUNT(*) AS c FROM discussions d WHERE ${conditions.join(' AND ')}`, params),
      page: page.page,
      size: page.size,
    };
  });

  app.get('/api/admin/articles', async (request) => {
    requireAdmin(request);
    const page = parsePage(request.query as any, 50);
    const items = all<any>(
      `SELECT a.*, u.username FROM articles a JOIN users u ON u.id = a.author_id
        WHERE a.is_deleted = 0 ORDER BY a.id DESC LIMIT ? OFFSET ?`,
      [page.size, page.offset],
    );
    return { items, total: count('SELECT COUNT(*) AS c FROM articles WHERE is_deleted = 0'), page: page.page, size: page.size };
  });

  /* --------------------------------------------------------- 日志 & 维护 */
  app.get('/api/admin/audit-logs', async (request) => {
    requireSuperAdmin(request);
    const query = request.query as any;
    const page = parsePage(query, 50, 500);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.action) {
      conditions.push('action LIKE ?');
      params.push(`%${query.action}%`);
    }
    if (query.actor) {
      conditions.push('actor_name = ?');
      params.push(String(query.actor));
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const items = all<any>(
      `SELECT * FROM audit_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    return {
      items,
      total: count(`SELECT COUNT(*) AS c FROM audit_logs ${where}`, params),
      page: page.page,
      size: page.size,
    };
  });

  app.get('/api/admin/login-logs', async (request) => {
    requireSuperAdmin(request);
    const page = parsePage(request.query as any, 50, 500);
    const items = all<any>(
      `SELECT * FROM login_logs ORDER BY id DESC LIMIT ? OFFSET ?`,
      [page.size, page.offset],
    );
    return { items, total: count('SELECT COUNT(*) AS c FROM login_logs'), page: page.page, size: page.size };
  });

  app.get('/api/admin/backups', async (request) => {
    requireSuperAdmin(request);
    return { items: listBackups() };
  });

  app.post('/api/admin/backups', async (request) => {
    requireSuperAdmin(request);
    const file = backupDatabase('manual');
    audit(request, 'admin.backup', { detail: { file } });
    return { ok: true, file: file.split('/').pop() };
  });

  app.post('/api/admin/judge/requeue', async (request) => {
    requireAdmin(request);
    const body = (request.body ?? {}) as any;
    const affected = rejudge({
      problemId: body.problemId ? Number(body.problemId) : undefined,
      contestId: body.contestId ? Number(body.contestId) : undefined,
      submissionIds: Array.isArray(body.submissionIds) ? body.submissionIds.map(Number) : undefined,
    });
    audit(request, 'admin.requeue', { detail: { ...body, affected } });
    return { ok: true, affected };
  });

  app.get('/api/admin/judge/status', async (request) => {
    requireAdmin(request);
    const recent = all<any>(
      `SELECT s.id, s.status, s.time_ms, s.memory_kb, s.created_at, p.pid, u.username
         FROM submissions s JOIN problems p ON p.id = s.problem_id JOIN users u ON u.id = s.user_id
        ORDER BY s.id DESC LIMIT 30`,
    );
    return { ...judgeStats(), worker: workerState(), recent };
  });

  app.get('/api/admin/maintenance/info', async (request) => {
    requireSuperAdmin(request);
    const tables = all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    );
    const sizes = tables.map((table) => ({
      table: table.name,
      rows: count(`SELECT COUNT(*) AS c FROM "${table.name}"`),
    }));
    return {
      database: {
        file: str('site_url', ''),
        size: databaseSize(),
        tables: sizes,
        journalMode: (db.prepare('PRAGMA journal_mode').get() as any)?.journal_mode,
      },
      backups: listBackups(),
      uptime: Math.round(process.uptime()),
    };
  });

  app.post('/api/admin/maintenance/vacuum', async (request) => {
    requireSuperAdmin(request);
    db.exec('VACUUM');
    audit(request, 'admin.vacuum');
    return { ok: true };
  });

  app.post('/api/admin/maintenance/cleanup', async (request) => {
    requireSuperAdmin(request);
    const days = Math.max(1, Number((request.body as any)?.days ?? num('judge_log_keep_days', 30)) || 30);
    const info = run(
      `UPDATE submissions SET detail = '[]', judge_log = '' WHERE judged_at < datetime('now', ?)`,
      [`-${days} days`],
    );
    audit(request, 'admin.cleanup', { detail: { days, affected: info.changes } });
    return { ok: true, affected: info.changes };
  });

  /* --------------------------------------------------------------- 广播 */
  app.post('/api/admin/broadcast', async (request) => {
    requireSuperAdmin(request);
    const body = (request.body ?? {}) as any;
    const title = String(body.title ?? '').trim();
    const content = String(body.content ?? '');
    if (!title) throw badRequest('请填写公告标题');
    const role = ['user', 'admin', 'superadmin'].includes(body.role) ? body.role : null;
    const targets = all<{ id: number }>(
      `SELECT id FROM users ${role ? 'WHERE role = ?' : ''}`,
      role ? [role] : [],
    );
    tx(() => {
      for (const target of targets) {
        sendMessage({ to: target.id, title, content, type: 'system' });
      }
    });
    audit(request, 'admin.broadcast', { detail: { title, count: targets.length } });
    return { ok: true, sent: targets.length };
  });

  /* -------------------------------------------------- 快速封禁/解封帖子 */
  app.post('/api/admin/discussions/:id/moderate', async (request) => {
    requireAdmin(request);
    const id = parseId((request.params as any).id);
    const body = (request.body ?? {}) as any;
    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.isDeleted !== undefined) {
      fields.push('is_deleted = ?');
      values.push(body.isDeleted ? 1 : 0);
    }
    if (body.isPinned !== undefined) {
      fields.push('is_pinned = ?');
      values.push(body.isPinned ? 1 : 0);
    }
    if (body.isLocked !== undefined) {
      fields.push('is_locked = ?');
      values.push(body.isLocked ? 1 : 0);
    }
    if (!fields.length) throw badRequest('没有需要修改的内容');
    run(`UPDATE discussions SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    audit(request, 'admin.discussion_moderate', { targetType: 'discussion', targetId: id, detail: body });
    return { ok: true };
  });

  /* --------------------------------------------------------- 站点信息速览 */
  app.get('/api/admin/system', async (request) => {
    requireAdmin(request);
    const user = request.user!;
    return {
      canManageUsers: hasRole(user, 'superadmin'),
      canEditSettings: hasRole(user, 'superadmin'),
      canManageProblems: true,
      maintenance: bool('maintenance_mode', false),
      siteName: str('site_name', 'OGOJ'),
      maintenanceMessage: rawSetting('maintenance_message'),
      serverTime: new Date().toISOString(),
      worker: workerState(),
      judge: judgeStats(),
      pending: {
        problems: count(`SELECT COUNT(*) AS c FROM problems WHERE review_status = 'pending'`),
        contests: count(`SELECT COUNT(*) AS c FROM contests WHERE review_status = 'pending'`),
        solutions: count(`SELECT COUNT(*) AS c FROM solutions WHERE is_public = 0 AND is_deleted = 0`),
        orders: count(`SELECT COUNT(*) AS c FROM shop_orders WHERE status = 'pending'`),
      },
    };
  });

  void conflict;
  void toBool;
  void requireUser;
}
