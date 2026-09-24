/**
 * 团队 2.0
 *
 * 板块：讨论区 / 题目 / 作业 / 题单 / 比赛 / 成员 / 文件
 * 设置：名称、头像、介绍、公告、公开程度（公开团队 / 保护团队 / 私有团队）、
 *       成员上限、邀请、组别（自定义权限组）、成员管理、黑名单
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { all, count, get, run, tx } from '../db/index.js';
import { hasRole, requireUser } from '../lib/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { num, str } from '../settings/index.js';
import { parseId, parsePage, sqlLike, toBool } from '../lib/util.js';
import { randomCode } from '../lib/crypto.js';
import { sendMessage } from '../lib/notify.js';
import { uploadDir } from '../lib/storage.js';
import { evaluateAchievements } from '../lib/achievements.js';
import { config } from '../config.js';

type Permission =
  | 'members'
  | 'problems'
  | 'assignments'
  | 'contests'
  | 'lists'
  | 'files'
  | 'discussions'
  | 'settings'
  | 'applications';

const PERMISSION_COLUMN: Record<Permission, string> = {
  members: 'can_manage_members',
  problems: 'can_manage_problems',
  assignments: 'can_manage_assignments',
  contests: 'can_manage_contests',
  lists: 'can_manage_lists',
  files: 'can_manage_files',
  discussions: 'can_manage_discussions',
  settings: 'can_manage_settings',
  applications: 'can_review_applications',
};

interface TeamContext {
  team: any;
  membership: any | null;
  role: string; // owner | admin | member | guest
  isGlobalAdmin: boolean;
}

function loadTeam(slugOrId: string): any {
  const numeric = Number(slugOrId);
  const team = Number.isInteger(numeric) && String(numeric) === slugOrId
    ? get<any>('SELECT * FROM teams WHERE id = ?', [numeric])
    : get<any>('SELECT * FROM teams WHERE slug = ?', [slugOrId]);
  if (!team || team.is_deleted) throw notFound('团队不存在');
  return team;
}

/** 读取团队 + 当前用户身份；不做可见性校验，由调用方决定。 */
function context(request: FastifyRequest, slugOrId: string): TeamContext {
  const team = loadTeam(slugOrId);
  const membership = request.user
    ? get<any>('SELECT * FROM team_members WHERE team_id = ? AND user_id = ?', [team.id, request.user.id])
    : null;
  return {
    team,
    membership: membership ?? null,
    role: membership?.role ?? 'guest',
    isGlobalAdmin: hasRole(request.user, 'admin'),
  };
}

function isMember(ctx: TeamContext): boolean {
  return Boolean(ctx.membership) || ctx.isGlobalAdmin;
}

/** 站长 / 团长 / 管理员，或所属组别拥有该权限 */
function can(ctx: TeamContext, permission: Permission): boolean {
  if (ctx.isGlobalAdmin) return true;
  if (ctx.role === 'owner') return true;
  if (ctx.role !== 'admin' && !ctx.membership?.group_id) return false;
  if (ctx.role === 'admin') return true;
  const group = get<any>(`SELECT ${PERMISSION_COLUMN[permission]} AS allowed FROM team_groups WHERE id = ?`, [
    ctx.membership.group_id,
  ]);
  return Boolean(group?.allowed);
}

function requireMember(ctx: TeamContext): void {
  if (!ctx.membership && !ctx.isGlobalAdmin) throw forbidden('请先加入该团队');
}

function requirePermission(ctx: TeamContext, permission: Permission): void {
  if (!ctx.membership && !ctx.isGlobalAdmin) throw forbidden('请先加入该团队');
  if (!can(ctx, permission)) throw forbidden('你没有该操作的权限');
}

function isBlacklisted(teamId: number, userId?: number | null): boolean {
  if (!userId) return false;
  return Boolean(get('SELECT 1 AS x FROM team_blacklist WHERE team_id = ? AND user_id = ?', [teamId, userId]));
}

/** 团队对外可见性：公开团队任何人可看；私有团队仅成员可看 */
function assertVisible(ctx: TeamContext): void {
  if (ctx.team.is_public || isMember(ctx)) return;
  throw forbidden('该团队未公开');
}

function refreshCounters(teamId: number): void {
  tx(() => {
    run(
      `UPDATE teams SET
         member_count = (SELECT COUNT(*) FROM team_members WHERE team_id = ?),
         problem_count = (SELECT COUNT(*) FROM team_problems WHERE team_id = ?),
         discuss_count = (SELECT COUNT(*) FROM team_discussions WHERE team_id = ? AND is_deleted = 0),
         assignment_count = (SELECT COUNT(*) FROM team_assignments WHERE team_id = ? AND is_deleted = 0),
         contest_count = (SELECT COUNT(*) FROM contests WHERE team_id = ? AND deleted_at IS NULL),
         list_count = (SELECT COUNT(*) FROM team_lists WHERE team_id = ? AND is_deleted = 0),
         file_count = (SELECT COUNT(*) FROM team_files WHERE team_id = ? AND is_deleted = 0)
       WHERE id = ?`,
      [teamId, teamId, teamId, teamId, teamId, teamId, teamId, teamId],
    );
  });
}

/** 成员做出贡献时累积团队经验与个人贡献度 */
function awardContribution(teamId: number, userId: number, delta: number): void {
  run('UPDATE team_members SET contribution = contribution + ? WHERE team_id = ? AND user_id = ?', [
    delta,
    teamId,
    userId,
  ]);
  run('UPDATE teams SET experience = experience + ? WHERE id = ?', [Math.max(0, delta), teamId]);
}

function teamBrief(team: any, viewer: any) {
  return {
    id: team.id,
    name: team.name,
    slug: team.slug,
    avatar: team.avatar,
    background: team.background,
    description: team.description,
    category: team.category,
    joinPolicy: team.join_policy,
    isPublic: Boolean(team.is_public),
    memberCount: team.member_count,
    problemCount: team.problem_count,
    discussCount: team.discuss_count,
    assignmentCount: team.assignment_count,
    contestCount: team.contest_count,
    listCount: team.list_count,
    fileCount: team.file_count,
    experience: team.experience,
    maxMembers: team.max_members,
    owner: team.owner_username
      ? { id: team.owner_id, username: team.owner_username, display_name: team.owner_display, avatar: team.owner_avatar }
      : null,
    createdAt: team.created_at,
    myRole: viewer?.role ?? 'guest',
  };
}

/**
 * 加入团队：三种公开程度的行为都在这里
 *  - open     公开团队：直接加入
 *  - approval 保护团队：提交申请，等待管理员审核
 *  - closed   私有团队：必须凭邀请码
 */
async function applyJoin(request: FastifyRequest, team: any, body: Record<string, any>) {
  const user = requireUser(request);
  if (isBlacklisted(team.id, user.id)) throw forbidden('你已被该团队列入黑名单');
  if (get('SELECT 1 AS x FROM team_members WHERE team_id = ? AND user_id = ?', [team.id, user.id])) {
    throw conflict(`你已经在团队「${team.name}」中了`);
  }
  const max = team.max_members;
  if (max > 0 && count('SELECT COUNT(*) AS c FROM team_members WHERE team_id = ?', [team.id]) >= max) {
    throw conflict('团队人数已满');
  }
  const invited = body.inviteCode && String(body.inviteCode) === team.invite_code;

  if (team.join_policy === 'closed' && !invited) throw forbidden('这是私有团队，需要邀请码才能加入');
  if (team.join_policy === 'approval' && !invited) {
    const pending = get(
      `SELECT id FROM team_applications WHERE team_id = ? AND user_id = ? AND status = 'pending'`,
      [team.id, user.id],
    );
    if (pending) throw conflict('你已提交申请，请等待管理员审核');
    run(`INSERT INTO team_applications (team_id, user_id, message, status) VALUES (?, ?, ?, 'pending')`, [
      team.id,
      user.id,
      String(body.message ?? '').slice(0, 500),
    ]);
    for (const admin of all<{ user_id: number }>(
      `SELECT user_id FROM team_members WHERE team_id = ? AND role IN ('owner','admin')`,
      [team.id],
    )) {
      sendMessage({
        to: admin.user_id,
        title: `团队「${team.name}」有新的加入申请`,
        content: `${user.username} 申请加入团队。${body.message ? `\n\n申请留言：${body.message}` : ''}`,
        type: 'system',
        refType: 'team',
        refId: team.id,
      });
    }
    audit(request, 'team.apply', { targetType: 'team', targetId: team.id });
    return {
      ok: true,
      status: 'pending',
      team: { id: team.id, name: team.name, slug: team.slug },
      message: '申请已提交，等待管理员审核',
    };
  }

  tx(() => {
    const group = get<{ id: number }>('SELECT id FROM team_groups WHERE team_id = ? AND is_default = 1 LIMIT 1', [
      team.id,
    ]);
    run(`INSERT INTO team_members (team_id, user_id, role, group_id) VALUES (?, ?, 'member', ?)`, [
      team.id,
      user.id,
      group?.id ?? null,
    ]);
    run(
      `UPDATE team_applications SET status = 'approved', handled_at = datetime('now')
        WHERE team_id = ? AND user_id = ? AND status = 'pending'`,
      [team.id, user.id],
    );
  });
  refreshCounters(team.id);
  audit(request, 'team.join', { targetType: 'team', targetId: team.id });
  evaluateAchievements(user.id, { silent: true });
  return {
    ok: true,
    status: 'joined',
    team: { id: team.id, name: team.name, slug: team.slug },
    message: `已加入团队「${team.name}」`,
  };
}

export async function registerTeamRoutes(app: FastifyInstance): Promise<void> {
  /* ============================================================= 团队列表 */
  app.get('/api/teams', async (request) => {
    const query = request.query as any;
    const page = parsePage(query, 24);
    const conditions = ['t.is_deleted = 0'];
    const params: unknown[] = [];
    if (!hasRole(request.user, 'admin')) conditions.push('t.is_public = 1');
    if (query.q) {
      conditions.push(`(t.name LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')`);
      const like = sqlLike(String(query.q));
      params.push(like, like);
    }
    if (query.category) {
      conditions.push('t.category = ?');
      params.push(String(query.category));
    }
    if (query.policy) {
      conditions.push('t.join_policy = ?');
      params.push(String(query.policy));
    }
    if (query.mine === 'true') {
      const user = requireUser(request);
      conditions.push(
        `(t.owner_id = ? OR EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = t.id AND m.user_id = ?))`,
      );
      params.push(user.id, user.id);
    }
    const order =
      query.sort === 'newest'
        ? 't.id DESC'
        : query.sort === 'problems'
          ? 't.problem_count DESC, t.id ASC'
          : query.sort === 'top'
            ? 't.experience DESC, t.member_count DESC, t.problem_count DESC, t.id ASC'
            : 't.member_count DESC, t.experience DESC, t.id ASC';
    const where = `WHERE ${conditions.join(' AND ')}`;
    const rows = all<any>(
      `SELECT t.*, u.username AS owner_username, u.display_name AS owner_display, u.avatar AS owner_avatar
         FROM teams t JOIN users u ON u.id = t.owner_id
        ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    const roles = new Map<number, string>();
    if (request.user) {
      for (const row of all<{ team_id: number; role: string }>(
        'SELECT team_id, role FROM team_members WHERE user_id = ?',
        [request.user.id],
      )) {
        roles.set(row.team_id, row.role);
      }
    }
    return {
      items: rows.map((row) => teamBrief(row, roles.get(row.id) ? { role: roles.get(row.id) } : null)),
      total: count(`SELECT COUNT(*) AS c FROM teams t ${where}`, params),
      page: page.page,
      size: page.size,
      categories: all<{ category: string; c: number }>(
        `SELECT category, COUNT(*) AS c FROM teams WHERE is_deleted = 0 AND category <> '' GROUP BY category ORDER BY c DESC`,
      ),
    };
  });

  /* ============================================================= 创建团队 */
  app.post('/api/teams', async (request) => {
    const user = requireUser(request);
    const body = (request.body ?? {}) as any;
    const name = String(body.name ?? '').trim();
    if (name.length < 2) throw badRequest('团队名称至少 2 个字符');
    if (name.length > 40) throw badRequest('团队名称最多 40 个字符');
    if (get('SELECT id FROM teams WHERE name = ? AND is_deleted = 0', [name])) throw conflict('团队名称已存在');
    const limit = num('team_create_max_per_user', 3);
    if (limit > 0 && !hasRole(user, 'admin')) {
      const owned = count('SELECT COUNT(*) AS c FROM teams WHERE owner_id = ? AND is_deleted = 0', [user.id]);
      if (owned >= limit) throw conflict(`每人最多创建 ${limit} 个团队`);
    }
    const base = String(body.slug ?? name);
    let slug = base
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '') || `team-${Date.now().toString(36)}`;
    let index = 1;
    while (get('SELECT id FROM teams WHERE slug = ?', [slug])) {
      slug = `${base.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')}-${index}`;
      index += 1;
    }
    const policy = ['open', 'approval', 'closed'].includes(body.joinPolicy) ? body.joinPolicy : 'open';
    const teamId = tx(() => {
      const info = run(
        `INSERT INTO teams (name, slug, description, avatar, background, announcement, join_policy,
           category, max_members, allow_member_invite, invite_code, owner_id, is_public)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          name,
          slug,
          String(body.description ?? ''),
          String(body.avatar ?? ''),
          String(body.background ?? ''),
          String(body.announcement ?? ''),
          policy,
          String(body.category ?? ''),
          Math.max(0, Number(body.maxMembers ?? 0) || 0),
          body.allowMemberInvite === false ? 0 : 1,
          randomCode(8),
          user.id,
          body.isPublic === false ? 0 : 1,
        ],
      );
      const id = Number(info.lastInsertRowid);
      run(`INSERT INTO team_members (team_id, user_id, role, contribution) VALUES (?, ?, 'owner', 0)`, [id, user.id]);
      // 默认组别：普通成员
      run(
        `INSERT INTO team_groups (team_id, name, color, description, is_default, sort)
         VALUES (?, '普通成员', '#94a3b8', '加入团队后的默认组别', 1, 0)`,
        [id],
      );
      return id;
    });
    refreshCounters(teamId);
    audit(request, 'team.create', { targetType: 'team', targetId: teamId, detail: { name } });
    evaluateAchievements(user.id, { silent: true });
    return { ok: true, id: teamId, slug };
  });

  /* ============================================================= 团队概览 */
  app.get('/api/teams/:slug', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    assertVisible(ctx);
    const team = get<any>(
      `SELECT t.*, u.username AS owner_username, u.display_name AS owner_display, u.avatar AS owner_avatar
         FROM teams t JOIN users u ON u.id = t.owner_id WHERE t.id = ?`,
      [ctx.team.id],
    );
    const member = isMember(ctx);
    const group = ctx.membership?.group_id
      ? get<any>('SELECT id, name, color FROM team_groups WHERE id = ?', [ctx.membership.group_id])
      : null;
    const pendingApplication = request.user
      ? get<any>(
          `SELECT id, status, message, created_at FROM team_applications
            WHERE team_id = ? AND user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`,
          [ctx.team.id, request.user.id],
        )
      : null;
    const permissions = Object.fromEntries(
      Object.keys(PERMISSION_COLUMN).map((key) => [key, can(ctx, key as Permission)]),
    );
    return {
      team: {
        ...teamBrief(team, ctx.membership),
        announcement: member ? ctx.team.announcement : '',
        // 未加入时只能看到团队介绍
        intro: ctx.team.description,
        inviteCode: can(ctx, 'members') ? ctx.team.invite_code : undefined,
      },
      membership: ctx.membership
        ? {
            role: ctx.membership.role,
            nickname: ctx.membership.nickname,
            contribution: ctx.membership.contribution,
            joinedAt: ctx.membership.joined_at,
            group,
          }
        : null,
      permissions,
      blacklisted: isBlacklisted(ctx.team.id, request.user?.id),
      pendingApplication: pendingApplication ?? null,
      stats: {
        members: count('SELECT COUNT(*) AS c FROM team_members WHERE team_id = ?', [ctx.team.id]),
        problems: count('SELECT COUNT(*) AS c FROM team_problems WHERE team_id = ?', [ctx.team.id]),
        discussions: count('SELECT COUNT(*) AS c FROM team_discussions WHERE team_id = ? AND is_deleted = 0', [
          ctx.team.id,
        ]),
        assignments: count('SELECT COUNT(*) AS c FROM team_assignments WHERE team_id = ? AND is_deleted = 0', [
          ctx.team.id,
        ]),
        contests: count('SELECT COUNT(*) AS c FROM contests WHERE team_id = ? AND deleted_at IS NULL', [ctx.team.id]),
        lists: count('SELECT COUNT(*) AS c FROM team_lists WHERE team_id = ? AND is_deleted = 0', [ctx.team.id]),
        files: count('SELECT COUNT(*) AS c FROM team_files WHERE team_id = ? AND is_deleted = 0', [ctx.team.id]),
        pendingApplications: can(ctx, 'applications')
          ? count(`SELECT COUNT(*) AS c FROM team_applications WHERE team_id = ? AND status = 'pending'`, [ctx.team.id])
          : 0,
      },
      recentProblems: all<any>(
        `SELECT p.id, p.pid, p.title, p.difficulty FROM team_problems tp JOIN problems p ON p.id = tp.problem_id
          WHERE tp.team_id = ? ORDER BY tp.is_pinned DESC, tp.order_no ASC, tp.created_at DESC LIMIT 8`,
        [ctx.team.id],
      ),
      recentDiscussions: all<any>(
        `SELECT d.id, d.title, d.reply_count, d.created_at, u.username, u.display_name
           FROM team_discussions d JOIN users u ON u.id = d.author_id
          WHERE d.team_id = ? AND d.is_deleted = 0 ORDER BY d.is_pinned DESC, d.id DESC LIMIT 6`,
        [ctx.team.id],
      ),
      upcomingAssignments: all<any>(
        `SELECT id, title, start_time, end_time FROM team_assignments
          WHERE team_id = ? AND is_deleted = 0 ORDER BY COALESCE(end_time, '9999') ASC LIMIT 5`,
        [ctx.team.id],
      ),
      topMembers: all<any>(
        `SELECT m.contribution, m.joined_at, m.role, u.id, u.username, u.display_name, u.avatar, u.solved_count
           FROM team_members m JOIN users u ON u.id = m.user_id
          WHERE m.team_id = ? ORDER BY m.contribution DESC, u.solved_count DESC LIMIT 8`,
        [ctx.team.id],
      ),
    };
  });

  /* ========================================================= 团队设置维护 */
  app.put('/api/teams/:slug', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    requirePermission(ctx, 'settings');
    const body = (request.body ?? {}) as any;
    const fields: string[] = [];
    const values: unknown[] = [];
    const set = (column: string, value: unknown) => {
      fields.push(`${column} = ?`);
      values.push(value);
    };
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length < 2) throw badRequest('团队名称至少 2 个字符');
      if (get('SELECT id FROM teams WHERE name = ? AND id <> ?', [name, ctx.team.id])) throw conflict('团队名称已存在');
      set('name', name);
    }
    for (const [key, column] of [
      ['description', 'description'],
      ['avatar', 'avatar'],
      ['background', 'background'],
      ['announcement', 'announcement'],
      ['category', 'category'],
    ] as const) {
      if (body[key] !== undefined) set(column, String(body[key]));
    }
    if (body.joinPolicy !== undefined) {
      const policy = ['open', 'approval', 'closed'].includes(body.joinPolicy) ? body.joinPolicy : 'open';
      set('join_policy', policy);
    }
    if (body.maxMembers !== undefined) set('max_members', Math.max(0, Number(body.maxMembers) || 0));
    if (body.allowMemberInvite !== undefined) set('allow_member_invite', body.allowMemberInvite ? 1 : 0);
    if (body.isPublic !== undefined) set('is_public', body.isPublic ? 1 : 0);
    if (body.resetInviteCode) set('invite_code', randomCode(8));
    if (!fields.length) throw badRequest('没有需要更新的内容');
    run(`UPDATE teams SET ${fields.join(', ')} WHERE id = ?`, [...values, ctx.team.id]);
    audit(request, 'team.update', { targetType: 'team', targetId: ctx.team.id, detail: Object.keys(body) });
    return { ok: true };
  });

  app.delete('/api/teams/:slug', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    if (ctx.role !== 'owner' && !ctx.isGlobalAdmin) throw forbidden('只有团长可以解散团队');
    run('UPDATE teams SET is_deleted = 1, is_public = 0 WHERE id = ?', [ctx.team.id]);
    audit(request, 'team.delete', { targetType: 'team', targetId: ctx.team.id });
    return { ok: true };
  });

  /* ============================================================= 加入退出 */
  app.post('/api/teams/:slug/join', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    return applyJoin(request, ctx.team, (request.body ?? {}) as any);
  });

  /** 按团队名称加入：用户只需要输入团队名称，再按该团队的公开程度处理 */
  app.post('/api/teams/join-by-name', async (request) => {
    const user = requireUser(request);
    const body = (request.body ?? {}) as any;
    const name = String(body.name ?? '').trim();
    if (!name) throw badRequest('请输入团队名称');
    const team =
      get<any>('SELECT * FROM teams WHERE is_deleted = 0 AND (name = ? COLLATE NOCASE OR slug = ? COLLATE NOCASE)', [
        name,
        name,
      ]) ??
      get<any>('SELECT * FROM teams WHERE is_deleted = 0 AND name LIKE ? COLLATE NOCASE ORDER BY member_count DESC LIMIT 1', [
        `%${name}%`,
      ]);
    if (!team) throw notFound(`没有找到名为「${name}」的团队`);
    const membership = get('SELECT 1 AS x FROM team_members WHERE team_id = ? AND user_id = ?', [team.id, user.id]);
    if (membership) throw conflict(`你已经在团队「${team.name}」中了`);
    return applyJoin(request, team, { ...body, name: team.name });
  });

  app.post('/api/teams/:slug/leave', async (request) => {
    const user = requireUser(request);
    const ctx = context(request, String((request.params as any).slug));
    if (!ctx.membership) throw badRequest('你不在该团队中');
    if (ctx.role === 'owner') throw badRequest('团长不能退出团队，请先转让团队或解散团队');
    run('DELETE FROM team_members WHERE team_id = ? AND user_id = ?', [ctx.team.id, user.id]);
    refreshCounters(ctx.team.id);
    return { ok: true };
  });

  /* ============================================================= 加入申请 */
  app.get('/api/teams/:slug/applications', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    requirePermission(ctx, 'applications');
    const status = String((request.query as any)?.status ?? 'pending');
    const items = all<any>(
      `SELECT a.*, u.username, u.display_name, u.avatar, u.solved_count
         FROM team_applications a JOIN users u ON u.id = a.user_id
        WHERE a.team_id = ? AND a.status = ? ORDER BY a.id DESC LIMIT 200`,
      [ctx.team.id, status],
    );
    return { items, pending: count(`SELECT COUNT(*) AS c FROM team_applications WHERE team_id = ? AND status = 'pending'`, [ctx.team.id]) };
  });

  app.post('/api/teams/:slug/applications/:id', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    requirePermission(ctx, 'applications');
    const id = parseId((request.params as any).id);
    const application = get<any>('SELECT * FROM team_applications WHERE id = ? AND team_id = ?', [id, ctx.team.id]);
    if (!application) throw notFound('申请不存在');
    const approve = (request.body as any)?.approve !== false;
    const note = String((request.body as any)?.note ?? '');
    if (approve) {
      const max = ctx.team.max_members;
      if (max > 0 && count('SELECT COUNT(*) AS c FROM team_members WHERE team_id = ?', [ctx.team.id]) >= max) {
        throw conflict('团队人数已满');
      }
      tx(() => {
        const group = get<{ id: number }>('SELECT id FROM team_groups WHERE team_id = ? AND is_default = 1 LIMIT 1', [
          ctx.team.id,
        ]);
        run(`INSERT OR IGNORE INTO team_members (team_id, user_id, role, group_id) VALUES (?, ?, 'member', ?)`, [
          ctx.team.id,
          application.user_id,
          group?.id ?? null,
        ]);
      });
    }
    run(
      `UPDATE team_applications SET status = ?, handled_by = ?, handled_at = datetime('now'), note = ?
        WHERE id = ?`,
      [approve ? 'approved' : 'rejected', request.user!.id, note, id],
    );
    refreshCounters(ctx.team.id);
    sendMessage({
      to: application.user_id,
      title: approve ? `你已加入团队「${ctx.team.name}」` : `加入团队「${ctx.team.name}」的申请未通过`,
      content: approve ? '欢迎加入团队！' : note || '管理员未通过你的加入申请。',
      type: 'system',
      refType: 'team',
      refId: ctx.team.id,
    });
    audit(request, 'team.application_review', { targetType: 'team', targetId: ctx.team.id, detail: { id, approve } });
    return { ok: true };
  });

  /* ============================================================= 成员管理 */
  app.get('/api/teams/:slug/members', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    assertVisible(ctx);
    const query = request.query as any;
    const conditions = ['m.team_id = ?'];
    const params: unknown[] = [ctx.team.id];
    if (query.q) {
      conditions.push(`(u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\' OR m.nickname LIKE ? ESCAPE '\\')`);
      const like = sqlLike(String(query.q));
      params.push(like, like, like);
    }
    if (query.group) {
      conditions.push('m.group_id = ?');
      params.push(Number(query.group));
    }
    if (query.role) {
      conditions.push('m.role = ?');
      params.push(String(query.role));
    }
    const items = all<any>(
      `SELECT m.role, m.nickname, m.contribution, m.joined_at, g.name AS group_name, g.color AS group_color,
              u.id, u.username, u.display_name, u.avatar, u.solved_count, u.points, u.role AS user_role
         FROM team_members m JOIN users u ON u.id = m.user_id
         LEFT JOIN team_groups g ON g.id = m.group_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.contribution DESC, m.joined_at ASC`,
      params,
    );
    return {
      items,
      groups: all<any>('SELECT * FROM team_groups WHERE team_id = ? ORDER BY sort ASC, id ASC', [ctx.team.id]),
      canManage: can(ctx, 'members'),
    };
  });

  app.put('/api/teams/:slug/members/:userId', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    requirePermission(ctx, 'members');
    const userId = parseId((request.params as any).userId);
    const membership = get<any>('SELECT * FROM team_members WHERE team_id = ? AND user_id = ?', [ctx.team.id, userId]);
    if (!membership) throw notFound('该用户不是团队成员');
    const body = (request.body ?? {}) as any;
    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.role !== undefined && ctx.role === 'owner') {
      const role = ['admin', 'member'].includes(body.role) ? body.role : 'member';
      fields.push('role = ?');
      values.push(role);
    }
    if (body.groupId !== undefined) {
      const groupId = Number(body.groupId) || 0;
      if (groupId) {
        const group = get('SELECT id FROM team_groups WHERE id = ? AND team_id = ?', [groupId, ctx.team.id]);
        if (!group) throw badRequest('组别不存在');
      }
      fields.push('group_id = ?');
      values.push(groupId || null);
    }
    if (body.nickname !== undefined) {
      fields.push('nickname = ?');
      values.push(String(body.nickname).slice(0, 32));
    }
    if (body.contribution !== undefined && ctx.role === 'owner') {
      fields.push('contribution = ?');
      values.push(Number(body.contribution) || 0);
    }
    if (!fields.length) throw badRequest('没有需要更新的内容');
    run(`UPDATE team_members SET ${fields.join(', ')} WHERE team_id = ? AND user_id = ?`, [
      ...values,
      ctx.team.id,
      userId,
    ]);
    audit(request, 'team.member_update', { targetType: 'team', targetId: ctx.team.id, detail: { userId, ...body } });
    return { ok: true };
  });

  app.delete('/api/teams/:slug/members/:userId', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    requirePermission(ctx, 'members');
    const userId = parseId((request.params as any).userId);
    if (userId === ctx.team.owner_id) throw badRequest('不能移除团长');
    run('DELETE FROM team_members WHERE team_id = ? AND user_id = ?', [ctx.team.id, userId]);
    refreshCounters(ctx.team.id);
    if (toBool((request.query as any)?.blacklist, false)) {
      run(
        `INSERT OR REPLACE INTO team_blacklist (team_id, user_id, reason, created_by) VALUES (?, ?, ?, ?)`,
        [ctx.team.id, userId, String((request.query as any)?.reason ?? '被移出团队'), request.user!.id],
      );
    }
    sendMessage({
      to: userId,
      title: `你已被移出团队「${ctx.team.name}」`,
      content: String((request.query as any)?.reason ?? ''),
      type: 'system',
      refType: 'team',
      refId: ctx.team.id,
    });
    audit(request, 'team.member_remove', { targetType: 'team', targetId: ctx.team.id, detail: { userId } });
    return { ok: true };
  });

  /** 转让团队 */
  app.post('/api/teams/:slug/transfer', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    if (ctx.role !== 'owner' && !ctx.isGlobalAdmin) throw forbidden('只有团长可以转让团队');
    const targetId = Number((request.body as any)?.userId);
    const membership = get('SELECT 1 AS x FROM team_members WHERE team_id = ? AND user_id = ?', [
      ctx.team.id,
      targetId,
    ]);
    if (!membership) throw badRequest('对方不是团队成员');
    tx(() => {
      run(`UPDATE team_members SET role = 'admin' WHERE team_id = ? AND user_id = ?`, [ctx.team.id, ctx.team.owner_id]);
      run(`UPDATE team_members SET role = 'owner' WHERE team_id = ? AND user_id = ?`, [ctx.team.id, targetId]);
      run('UPDATE teams SET owner_id = ? WHERE id = ?', [targetId, ctx.team.id]);
    });
    audit(request, 'team.transfer', { targetType: 'team', targetId: ctx.team.id, detail: { targetId } });
    return { ok: true };
  });

  /* ================================================================ 组别 */
  app.get('/api/teams/:slug/groups', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    assertVisible(ctx);
    const items = all<any>(
      `SELECT g.*, (SELECT COUNT(*) FROM team_members m WHERE m.group_id = g.id) AS member_count
         FROM team_groups g WHERE g.team_id = ? ORDER BY g.sort ASC, g.id ASC`,
      [ctx.team.id],
    );
    return { items, canManage: can(ctx, 'settings') };
  });

  app.post('/api/teams/:slug/groups', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    requirePermission(ctx, 'settings');
    const body = (request.body ?? {}) as any;
    const name = String(body.name ?? '').trim();
    if (!name) throw badRequest('组别名称不能为空');
    const info = run(
      `INSERT INTO team_groups (team_id, name, color, description, can_manage_members, can_manage_problems,
         can_manage_assignments, can_manage_contests, can_manage_lists, can_manage_files,
         can_manage_discussions, can_manage_settings, can_review_applications, sort, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ctx.team.id,
        name.slice(0, 32),
        String(body.color ?? '#60a5fa'),
        String(body.description ?? ''),
        body.permissions?.members ? 1 : 0,
        body.permissions?.problems ? 1 : 0,
        body.permissions?.assignments ? 1 : 0,
        body.permissions?.contests ? 1 : 0,
        body.permissions?.lists ? 1 : 0,
        body.permissions?.files ? 1 : 0,
        body.permissions?.discussions ? 1 : 0,
        body.permissions?.settings ? 1 : 0,
        body.permissions?.applications ? 1 : 0,
        Number(body.sort ?? 100) || 100,
        body.isDefault ? 1 : 0,
      ],
    );
    if (body.isDefault) {
      const id = Number(info.lastInsertRowid);
      run('UPDATE team_groups SET is_default = 0 WHERE team_id = ? AND id <> ?', [ctx.team.id, id]);
    }
    audit(request, 'team.group_create', { targetType: 'team', targetId: ctx.team.id, detail: { name } });
    return { ok: true, id: Number(info.lastInsertRowid) };
  });

  app.put('/api/teams/:slug/groups/:id', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    requirePermission(ctx, 'settings');
    const id = parseId((request.params as any).id);
    const group = get<any>('SELECT * FROM team_groups WHERE id = ? AND team_id = ?', [id, ctx.team.id]);
    if (!group) throw notFound('组别不存在');
    const body = (request.body ?? {}) as any;
    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.name !== undefined) {
      fields.push('name = ?');
      values.push(String(body.name).slice(0, 32));
    }
    if (body.color !== undefined) {
      fields.push('color = ?');
      values.push(String(body.color));
    }
    if (body.description !== undefined) {
      fields.push('description = ?');
      values.push(String(body.description));
    }
    if (body.sort !== undefined) {
      fields.push('sort = ?');
      values.push(Number(body.sort) || 0);
    }
    if (body.permissions && typeof body.permissions === 'object') {
      for (const key of Object.keys(PERMISSION_COLUMN) as Permission[]) {
        if (body.permissions[key] !== undefined) {
          fields.push(`${PERMISSION_COLUMN[key]} = ?`);
          values.push(body.permissions[key] ? 1 : 0);
        }
      }
    }
    if (fields.length) run(`UPDATE team_groups SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    if (body.isDefault) run('UPDATE team_groups SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE team_id = ?', [id, ctx.team.id]);
    audit(request, 'team.group_update', { targetType: 'team', targetId: ctx.team.id, detail: { id, ...body } });
    return { ok: true };
  });

  app.delete('/api/teams/:slug/groups/:id', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    requirePermission(ctx, 'settings');
    const id = parseId((request.params as any).id);
    if (get('SELECT id FROM team_groups WHERE team_id = ? AND is_default = 1', [ctx.team.id])?.id === id) {
      throw badRequest('默认组别不能删除');
    }
    run('UPDATE team_members SET group_id = NULL WHERE team_id = ? AND group_id = ?', [ctx.team.id, id]);
    run('DELETE FROM team_groups WHERE id = ? AND team_id = ?', [id, ctx.team.id]);
    return { ok: true };
  });

  /* ============================================================== 黑名单 */
  app.get('/api/teams/:slug/blacklist', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    requirePermission(ctx, 'members');
    const items = all<any>(
      `SELECT b.reason, b.created_at, u.id, u.username, u.display_name, u.avatar
         FROM team_blacklist b JOIN users u ON u.id = b.user_id WHERE b.team_id = ? ORDER BY b.created_at DESC`,
      [ctx.team.id],
    );
    return { items };
  });

  app.post('/api/teams/:slug/blacklist', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    requirePermission(ctx, 'members');
    const body = (request.body ?? {}) as any;
    const target = body.userId
      ? get<any>('SELECT id, username FROM users WHERE id = ?', [Number(body.userId)])
      : get<any>('SELECT id, username FROM users WHERE username = ?', [String(body.username ?? '')]);
    if (!target) throw notFound('用户不存在');
    if (target.id === ctx.team.owner_id) throw badRequest('不能把团长加入黑名单');
    tx(() => {
      run(
        `INSERT OR REPLACE INTO team_blacklist (team_id, user_id, reason, created_by) VALUES (?, ?, ?, ?)`,
        [ctx.team.id, target.id, String(body.reason ?? ''), request.user!.id],
      );
      run('DELETE FROM team_members WHERE team_id = ? AND user_id = ?', [ctx.team.id, target.id]);
    });
    refreshCounters(ctx.team.id);
    audit(request, 'team.blacklist_add', { targetType: 'team', targetId: ctx.team.id, detail: { username: target.username } });
    return { ok: true };
  });

  app.delete('/api/teams/:slug/blacklist/:userId', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    requirePermission(ctx, 'members');
    run('DELETE FROM team_blacklist WHERE team_id = ? AND user_id = ?', [
      ctx.team.id,
      parseId((request.params as any).userId),
    ]);
    return { ok: true };
  });

  /* ============================================================ 讨论区 */
  app.get('/api/teams/:slug/discussions', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    assertVisible(ctx);
    const query = request.query as any;
    const page = parsePage(query, 20);
    const conditions = ['d.team_id = ?', 'd.is_deleted = 0'];
    const params: unknown[] = [ctx.team.id];
    if (query.category) {
      conditions.push('d.category = ?');
      params.push(String(query.category));
    }
    if (query.q) {
      conditions.push(`d.title LIKE ? ESCAPE '\\'`);
      params.push(sqlLike(String(query.q)));
    }
    const items = all<any>(
      `SELECT d.*, u.username, u.display_name, u.avatar
         FROM team_discussions d JOIN users u ON u.id = d.author_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY d.is_pinned DESC, COALESCE(d.last_reply_at, d.created_at) DESC LIMIT ? OFFSET ?`,
      [...params, page.size, page.offset],
    );
    return {
      items,
      total: count(`SELECT COUNT(*) AS c FROM team_discussions d WHERE ${conditions.join(' AND ')}`, params),
      page: page.page,
      size: page.size,
      canManage: can(ctx, 'discussions'),
      canPost: isMember(ctx),
    };
  });

  app.get('/api/teams/:slug/discussions/:id', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    assertVisible(ctx);
    const id = parseId((request.params as any).id);
    const discussion = get<any>(
      `SELECT d.*, u.username, u.display_name, u.avatar FROM team_discussions d
         JOIN users u ON u.id = d.author_id WHERE d.id = ? AND d.team_id = ?`,
      [id, ctx.team.id],
    );
    if (!discussion || (discussion.is_deleted && !can(ctx, 'discussions'))) throw notFound('帖子不存在');
    if (!isMember(ctx) && !ctx.team.is_public) throw forbidden('该团队未公开');
    run('UPDATE team_discussions SET views = views + 1 WHERE id = ?', [id]);
    const replies = all<any>(
      `SELECT r.*, u.username, u.display_name, u.avatar FROM team_discussion_replies r
         JOIN users u ON u.id = r.author_id WHERE r.discussion_id = ? ORDER BY r.floor ASC LIMIT 500`,
      [id],
    );
    return {
      discussion: { ...discussion, views: discussion.views + 1, canManage: can(ctx, 'discussions') },
      replies,
      canReply: isMember(ctx) && !discussion.is_locked,
    };
  });

  app.post('/api/teams/:slug/discussions', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    requireMember(ctx);
    const body = (request.body ?? {}) as any;
    const title = String(body.title ?? '').trim();
    const content = String(body.content ?? '').trim();
    if (title.length < 2) throw badRequest('标题至少 2 个字符');
    if (!content) throw badRequest('内容不能为空');
    const category = ['general', 'solution', 'help', 'announcement'].includes(body.category)
      ? body.category
      : 'general';
    if (category === 'announcement' && !can(ctx, 'discussions')) throw forbidden('只有管理员可以发布公告帖');
    const info = run(
      `INSERT INTO team_discussions (team_id, author_id, category, title, content, is_pinned, last_reply_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [ctx.team.id, request.user!.id, category, title.slice(0, 150), content, category === 'announcement' ? 1 : 0],
    );
    refreshCounters(ctx.team.id);
    awardContribution(ctx.team.id, request.user!.id, 1);
    audit(request, 'team.discussion_create', { targetType: 'team', targetId: ctx.team.id });
    return { ok: true, id: Number(info.lastInsertRowid) };
  });

  app.post('/api/teams/:slug/discussions/:id/replies', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    requireMember(ctx);
    const id = parseId((request.params as any).id);
    const discussion = get<any>('SELECT * FROM team_discussions WHERE id = ? AND team_id = ? AND is_deleted = 0', [
      id,
      ctx.team.id,
    ]);
    if (!discussion) throw notFound('帖子不存在');
    if (discussion.is_locked && !can(ctx, 'discussions')) throw forbidden('该帖子已锁定');
    const content = String((request.body as any)?.content ?? '').trim();
    if (!content) throw badRequest('回复内容不能为空');
    const floor =
      (get<{ maxFloor: number | null }>(
        'SELECT MAX(floor) AS maxFloor FROM team_discussion_replies WHERE discussion_id = ?',
        [id],
      )?.maxFloor ?? 0) + 1;
    run('INSERT INTO team_discussion_replies (discussion_id, author_id, content, floor) VALUES (?, ?, ?, ?)', [
      id,
      request.user!.id,
      content,
      floor,
    ]);
    run(
      `UPDATE team_discussions SET reply_count = reply_count + 1, last_reply_at = datetime('now') WHERE id = ?`,
      [id],
    );
    if (discussion.author_id !== request.user!.id) {
      sendMessage({
        to: discussion.author_id,
        from: request.user!.id,
        title: `团队「${ctx.team.name}」的帖子有新回复`,
        content: content.slice(0, 300),
        type: 'reply',
        refType: 'team_discussion',
        refId: id,
      });
    }
    return { ok: true, floor };
  });

  app.put('/api/teams/:slug/discussions/:id', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    const id = parseId((request.params as any).id);
    const discussion = get<any>('SELECT * FROM team_discussions WHERE id = ? AND team_id = ?', [id, ctx.team.id]);
    if (!discussion) throw notFound('帖子不存在');
    if (discussion.author_id !== request.user!.id && !can(ctx, 'discussions')) throw forbidden();
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
    if (can(ctx, 'discussions')) {
      if (body.isPinned !== undefined) {
        fields.push('is_pinned = ?');
        values.push(body.isPinned ? 1 : 0);
      }
      if (body.isLocked !== undefined) {
        fields.push('is_locked = ?');
        values.push(body.isLocked ? 1 : 0);
      }
      if (body.isDeleted !== undefined) {
        fields.push('is_deleted = ?');
        values.push(body.isDeleted ? 1 : 0);
      }
    }
    if (fields.length) run(`UPDATE team_discussions SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    if (body.isDeleted) refreshCounters(ctx.team.id);
    return { ok: true };
  });

  app.delete('/api/teams/:slug/discussions/:id', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    const id = parseId((request.params as any).id);
    const discussion = get<any>('SELECT * FROM team_discussions WHERE id = ? AND team_id = ?', [id, ctx.team.id]);
    if (!discussion) throw notFound('帖子不存在');
    if (discussion.author_id !== request.user!.id && !can(ctx, 'discussions')) throw forbidden();
    run('UPDATE team_discussions SET is_deleted = 1 WHERE id = ?', [id]);
    refreshCounters(ctx.team.id);
    return { ok: true };
  });

  app.delete('/api/teams/:slug/discussions/:id/replies/:replyId', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    const replyId = parseId((request.params as any).replyId);
    const reply = get<any>('SELECT * FROM team_discussion_replies WHERE id = ?', [replyId]);
    if (!reply) throw notFound('回复不存在');
    if (reply.author_id !== request.user!.id && !can(ctx, 'discussions')) throw forbidden();
    run(`UPDATE team_discussion_replies SET is_deleted = 1, content = '[该回复已被删除]' WHERE id = ?`, [replyId]);
    run('UPDATE team_discussions SET reply_count = MAX(0, reply_count - 1) WHERE id = ?', [reply.discussion_id]);
    return { ok: true };
  });

  /* ============================================================== 题目 */
  app.get('/api/teams/:slug/problems', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    assertVisible(ctx);
    const query = request.query as any;
    const page = parsePage(query, 50);
    const conditions = ['tp.team_id = ?', 'p.deleted_at IS NULL'];
    const params: unknown[] = [ctx.team.id];
    if (query.q) {
      conditions.push(`(p.title LIKE ? ESCAPE '\\' OR p.pid LIKE ? ESCAPE '\\')`);
      const like = sqlLike(String(query.q));
      params.push(like, like);
    }
    if (query.difficulty) {
      conditions.push('p.difficulty = ?');
      params.push(Number(query.difficulty));
    }
    const viewer = request.user;
    const items = all<any>(
      `SELECT p.id, p.pid, p.title, p.difficulty, p.submit_count, p.accepted_count, p.time_limit, p.memory_limit,
              tp.note, tp.order_no, tp.is_pinned, tp.created_at, u.username AS added_by_name,
              (SELECT accepted FROM user_problem_stats st WHERE st.user_id = ? AND st.problem_id = p.id) AS my_accepted,
              (SELECT attempts FROM user_problem_stats st WHERE st.user_id = ? AND st.problem_id = p.id) AS my_attempts
         FROM team_problems tp JOIN problems p ON p.id = tp.problem_id
         LEFT JOIN users u ON u.id = tp.added_by
        WHERE ${conditions.join(' AND ')}
        ORDER BY tp.is_pinned DESC, tp.order_no ASC, tp.created_at DESC LIMIT ? OFFSET ?`,
      [viewer?.id ?? 0, viewer?.id ?? 0, ...params, page.size, page.offset],
    );
    const solved = viewer
      ? count(
          `SELECT COUNT(*) AS c FROM team_problems tp
             JOIN user_problem_stats st ON st.problem_id = tp.problem_id AND st.user_id = ? AND st.accepted > 0
            WHERE tp.team_id = ?`,
          [viewer.id, ctx.team.id],
        )
      : 0;
    const total = count(
      `SELECT COUNT(*) AS c FROM team_problems tp JOIN problems p ON p.id = tp.problem_id
        WHERE ${conditions.join(' AND ')}`,
      params,
    );
    return {
      items: items.map((row) => ({
        ...row,
        myAccepted: Boolean(row.my_accepted),
        myAttempts: row.my_attempts ?? 0,
      })),
      total,
      solved,
      page: page.page,
      size: page.size,
      canManage: can(ctx, 'problems'),
    };
  });

  app.post('/api/teams/:slug/problems', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    requirePermission(ctx, 'problems');
    const body = (request.body ?? {}) as any;
    const ids: number[] = Array.isArray(body.problemIds)
      ? body.problemIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
      : [Number(body.problemId)].filter((n) => Number.isInteger(n) && n > 0);
    if (!ids.length) throw badRequest('请选择要添加的题目');
    const added: number[] = [];
    tx(() => {
      let order = Number(
        get<{ maxOrder: number | null }>('SELECT MAX(order_no) AS maxOrder FROM team_problems WHERE team_id = ?', [
          ctx.team.id,
        ])?.maxOrder ?? 0,
      );
      for (const problemId of ids) {
        if (!get('SELECT id FROM problems WHERE id = ? AND deleted_at IS NULL', [problemId])) continue;
        const existing = get('SELECT 1 AS x FROM team_problems WHERE team_id = ? AND problem_id = ?', [
          ctx.team.id,
          problemId,
        ]);
        if (existing) {
          if (body.note !== undefined) {
            run('UPDATE team_problems SET note = ? WHERE team_id = ? AND problem_id = ?', [
              String(body.note),
              ctx.team.id,
              problemId,
            ]);
          }
          continue;
        }
        order += 1;
        run(
          `INSERT INTO team_problems (team_id, problem_id, added_by, note, order_no) VALUES (?, ?, ?, ?, ?)`,
          [ctx.team.id, problemId, request.user!.id, String(body.note ?? ''), order],
        );
        added.push(problemId);
      }
    });
    refreshCounters(ctx.team.id);
    audit(request, 'team.problem_add', { targetType: 'team', targetId: ctx.team.id, detail: { count: added.length } });
    return { ok: true, added: added.length };
  });

  app.put('/api/teams/:slug/problems/:problemId', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    requirePermission(ctx, 'problems');
    const problemId = parseId((request.params as any).problemId);
    const body = (request.body ?? {}) as any;
    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.note !== undefined) {
      fields.push('note = ?');
      values.push(String(body.note));
    }
    if (body.order !== undefined) {
      fields.push('order_no = ?');
      values.push(Number(body.order) || 0);
    }
    if (body.isPinned !== undefined) {
      fields.push('is_pinned = ?');
      values.push(body.isPinned ? 1 : 0);
    }
    if (!fields.length) throw badRequest('没有需要更新的内容');
    run(`UPDATE team_problems SET ${fields.join(', ')} WHERE team_id = ? AND problem_id = ?`, [
      ...values,
      ctx.team.id,
      problemId,
    ]);
    return { ok: true };
  });

  app.delete('/api/teams/:slug/problems/:problemId', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    requirePermission(ctx, 'problems');
    run('DELETE FROM team_problems WHERE team_id = ? AND problem_id = ?', [
      ctx.team.id,
      parseId((request.params as any).problemId),
    ]);
    refreshCounters(ctx.team.id);
    return { ok: true };
  });

  /* ============================================================== 作业 */
  app.get('/api/teams/:slug/assignments', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    requireMember(ctx);
    const items = all<any>(
      `SELECT a.*, u.username AS creator_name, g.name AS group_name, g.color AS group_color,
              (SELECT COUNT(*) FROM team_assignment_problems p WHERE p.assignment_id = a.id) AS problem_count
         FROM team_assignments a
         LEFT JOIN users u ON u.id = a.created_by
         LEFT JOIN team_groups g ON g.id = a.target_group_id
        WHERE a.team_id = ? AND a.is_deleted = 0 ORDER BY a.id DESC LIMIT 100`,
      [ctx.team.id],
    );
    const viewer = request.user;
    const withProgress = items.map((item) => {
      const problems = all<any>(
        `SELECT p.problem_id FROM team_assignment_problems p WHERE p.assignment_id = ? ORDER BY p.order_no`,
        [item.id],
      );
      const solved = viewer
        ? count(
            `SELECT COUNT(*) AS c FROM team_assignment_problems ap
               JOIN submissions s ON s.problem_id = ap.problem_id AND s.user_id = ? AND s.status = 'AC'
               JOIN team_assignments a ON a.id = ap.assignment_id
              WHERE ap.assignment_id = ? AND (a.start_time IS NULL OR s.created_at >= a.start_time)
                AND (a.end_time IS NULL OR s.created_at <= a.end_time)`,
            [viewer.id, item.id],
          )
        : 0;
      return { ...item, problemIds: problems.map((p) => p.problem_id), mySolved: solved };
    });
    return { items: withProgress, canManage: can(ctx, 'assignments'), canSubmit: isMember(ctx) };
  });

  app.get('/api/teams/:slug/assignments/:id', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    requireMember(ctx);
    const id = parseId((request.params as any).id);
    const assignment = get<any>(
      `SELECT a.*, u.username AS creator_name, g.name AS group_name FROM team_assignments a
         LEFT JOIN users u ON u.id = a.created_by
         LEFT JOIN team_groups g ON g.id = a.target_group_id
        WHERE a.id = ? AND a.team_id = ? AND a.is_deleted = 0`,
      [id, ctx.team.id],
    );
    if (!assignment) throw notFound('作业不存在');
    const problems = all<any>(
      `SELECT p.id, p.pid, p.title, p.difficulty, ap.order_no, ap.score,
              (SELECT status FROM submissions s WHERE s.user_id = ? AND s.problem_id = p.id
                AND (a.start_time IS NULL OR s.created_at >= a.start_time)
                AND (a.end_time IS NULL OR s.created_at <= a.end_time)
                ORDER BY s.id DESC LIMIT 1) AS my_last_status,
              (SELECT id FROM submissions s WHERE s.user_id = ? AND s.problem_id = p.id AND s.status = 'AC'
                AND (a.start_time IS NULL OR s.created_at >= a.start_time)
                AND (a.end_time IS NULL OR s.created_at <= a.end_time)
                ORDER BY s.id ASC LIMIT 1) AS my_ac_id
         FROM team_assignment_problems ap
         JOIN problems p ON p.id = ap.problem_id
         JOIN team_assignments a ON a.id = ap.assignment_id
        WHERE ap.assignment_id = ? ORDER BY ap.order_no ASC`,
      [request.user?.id ?? 0, request.user?.id ?? 0, id],
    );
    const members = all<any>(
      `SELECT u.id, u.username, u.display_name, u.avatar, m.contribution,
              (SELECT COUNT(*) FROM team_assignment_problems ap
                 JOIN submissions s ON s.problem_id = ap.problem_id AND s.user_id = u.id AND s.status = 'AC'
                WHERE ap.assignment_id = ? AND (a.start_time IS NULL OR s.created_at >= a.start_time)
                  AND (a.end_time IS NULL OR s.created_at <= a.end_time)) AS solved
         FROM team_members m JOIN users u ON u.id = m.user_id
         JOIN team_assignments a ON a.id = ?
        WHERE m.team_id = ? ORDER BY solved DESC, m.contribution DESC LIMIT 200`,
      [id, id, ctx.team.id],
    );
    return {
      assignment,
      problems: problems.map((p) => ({
        ...p,
        mySolved: Boolean(p.my_ac_id),
      })),
      members,
      canManage: can(ctx, 'assignments'),
      canSubmit: isMember(ctx),
    };
  });

  app.post('/api/teams/:slug/assignments', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    requirePermission(ctx, 'assignments');
    const body = (request.body ?? {}) as any;
    const title = String(body.title ?? '').trim();
    if (title.length < 2) throw badRequest('作业标题至少 2 个字符');
    const ids = Array.isArray(body.problemIds)
      ? body.problemIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
      : [];
    if (!ids.length) throw badRequest('请至少选择一道题目');
    const assignmentId = tx(() => {
      const info = run(
        `INSERT INTO team_assignments (team_id, title, description, start_time, end_time, target_group_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          ctx.team.id,
          title.slice(0, 120),
          String(body.description ?? ''),
          body.startTime ? String(body.startTime) : null,
          body.endTime ? String(body.endTime) : null,
          body.targetGroupId ? Number(body.targetGroupId) : null,
          request.user!.id,
        ],
      );
      const id = Number(info.lastInsertRowid);
      ids.forEach((problemId: number, index: number) => {
        run(
          `INSERT OR IGNORE INTO team_assignment_problems (assignment_id, problem_id, order_no, score)
           VALUES (?, ?, ?, ?)`,
          [id, problemId, index + 1, Math.max(0, Number(body.score ?? 100) || 100)],
        );
      });
      return id;
    });
    refreshCounters(ctx.team.id);
    const members = all<{ user_id: number }>('SELECT user_id FROM team_members WHERE team_id = ?', [ctx.team.id]);
    for (const member of members) {
      if (member.user_id === request.user!.id) continue;
      sendMessage({
        to: member.user_id,
        title: `团队「${ctx.team.name}」发布了新作业：${title}`,
        content: `共 ${ids.length} 道题目，记得按时完成。`,
        type: 'system',
        refType: 'team_assignment',
        refId: assignmentId,
      });
    }
    audit(request, 'team.assignment_create', { targetType: 'team', targetId: ctx.team.id, detail: { title } });
    return { ok: true, id: assignmentId };
  });

  app.put('/api/teams/:slug/assignments/:id', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    requirePermission(ctx, 'assignments');
    const id = parseId((request.params as any).id);
    const assignment = get<any>('SELECT * FROM team_assignments WHERE id = ? AND team_id = ?', [id, ctx.team.id]);
    if (!assignment) throw notFound('作业不存在');
    const body = (request.body ?? {}) as any;
    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.title !== undefined) {
      fields.push('title = ?');
      values.push(String(body.title).slice(0, 120));
    }
    if (body.description !== undefined) {
      fields.push('description = ?');
      values.push(String(body.description));
    }
    if (body.startTime !== undefined) {
      fields.push('start_time = ?');
      values.push(body.startTime ? String(body.startTime) : null);
    }
    if (body.endTime !== undefined) {
      fields.push('end_time = ?');
      values.push(body.endTime ? String(body.endTime) : null);
    }
    if (body.targetGroupId !== undefined) {
      fields.push('target_group_id = ?');
      values.push(body.targetGroupId ? Number(body.targetGroupId) : null);
    }
    if (body.isDeleted !== undefined) {
      fields.push('is_deleted = ?');
      values.push(body.isDeleted ? 1 : 0);
    }
    if (fields.length) {
      fields.push(`updated_at = datetime('now')`);
      run(`UPDATE team_assignments SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    }
    if (Array.isArray(body.problemIds)) {
      tx(() => {
        run('DELETE FROM team_assignment_problems WHERE assignment_id = ?', [id]);
        body.problemIds
          .map(Number)
          .filter((n: number) => Number.isInteger(n) && n > 0)
          .forEach((problemId: number, index: number) => {
            run(
              `INSERT OR IGNORE INTO team_assignment_problems (assignment_id, problem_id, order_no, score)
               VALUES (?, ?, ?, 100)`,
              [id, problemId, index + 1],
            );
          });
      });
    }
    if (body.isDeleted) refreshCounters(ctx.team.id);
    audit(request, 'team.assignment_update', { targetType: 'team', targetId: ctx.team.id, detail: { id } });
    return { ok: true };
  });

  app.delete('/api/teams/:slug/assignments/:id', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    requirePermission(ctx, 'assignments');
    run('UPDATE team_assignments SET is_deleted = 1 WHERE id = ? AND team_id = ?', [
      parseId((request.params as any).id),
      ctx.team.id,
    ]);
    refreshCounters(ctx.team.id);
    return { ok: true };
  });

  /* ============================================================== 题单 */
  app.get('/api/teams/:slug/lists', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    assertVisible(ctx);
    const items = all<any>(
      `SELECT l.*, u.username AS creator_name,
              (SELECT COUNT(*) FROM team_list_items i WHERE i.list_id = l.id) AS problem_count
         FROM team_lists l LEFT JOIN users u ON u.id = l.created_by
        WHERE l.team_id = ? AND l.is_deleted = 0 ORDER BY l.id DESC LIMIT 100`,
      [ctx.team.id],
    );
    return { items, canManage: can(ctx, 'lists'), canCreate: isMember(ctx) };
  });

  app.get('/api/teams/:slug/lists/:id', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    assertVisible(ctx);
    const id = parseId((request.params as any).id);
    const list = get<any>('SELECT * FROM team_lists WHERE id = ? AND team_id = ? AND is_deleted = 0', [id, ctx.team.id]);
    if (!list) throw notFound('题单不存在');
    if (!list.is_public && !isMember(ctx)) throw forbidden('该题单仅团队成员可见');
    const problems = all<any>(
      `SELECT p.id, p.pid, p.title, p.difficulty, i.order_no, i.note,
              (SELECT accepted FROM user_problem_stats st WHERE st.user_id = ? AND st.problem_id = p.id) AS my_accepted
         FROM team_list_items i JOIN problems p ON p.id = i.problem_id
        WHERE i.list_id = ? ORDER BY i.order_no ASC`,
      [request.user?.id ?? 0, id],
    );
    return {
      list,
      problems: problems.map((p) => ({ ...p, myAccepted: Boolean(p.my_accepted) })),
      canManage: can(ctx, 'lists') || list.created_by === request.user?.id,
    };
  });

  app.post('/api/teams/:slug/lists', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    requireMember(ctx);
    const body = (request.body ?? {}) as any;
    const title = String(body.title ?? '').trim();
    if (title.length < 2) throw badRequest('题单名称至少 2 个字符');
    const ids = Array.isArray(body.problemIds)
      ? body.problemIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
      : [];
    const listId = tx(() => {
      const info = run(
        `INSERT INTO team_lists (team_id, title, description, created_by, is_public) VALUES (?, ?, ?, ?, ?)`,
        [
          ctx.team.id,
          title.slice(0, 120),
          String(body.description ?? ''),
          request.user!.id,
          body.isPublic ? 1 : 0,
        ],
      );
      const id = Number(info.lastInsertRowid);
      ids.forEach((problemId: number, index: number) => {
        run('INSERT OR IGNORE INTO team_list_items (list_id, problem_id, order_no, note) VALUES (?, ?, ?, ?)', [
          id,
          problemId,
          index + 1,
          '',
        ]);
      });
      return id;
    });
    refreshCounters(ctx.team.id);
    return { ok: true, id: listId };
  });

  app.put('/api/teams/:slug/lists/:id', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    const id = parseId((request.params as any).id);
    const list = get<any>('SELECT * FROM team_lists WHERE id = ? AND team_id = ?', [id, ctx.team.id]);
    if (!list) throw notFound('题单不存在');
    if (list.created_by !== request.user!.id && !can(ctx, 'lists')) throw forbidden();
    const body = (request.body ?? {}) as any;
    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.title !== undefined) {
      fields.push('title = ?');
      values.push(String(body.title).slice(0, 120));
    }
    if (body.description !== undefined) {
      fields.push('description = ?');
      values.push(String(body.description));
    }
    if (body.isPublic !== undefined) {
      fields.push('is_public = ?');
      values.push(body.isPublic ? 1 : 0);
    }
    if (fields.length) run(`UPDATE team_lists SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    if (Array.isArray(body.problemIds)) {
      tx(() => {
        run('DELETE FROM team_list_items WHERE list_id = ?', [id]);
        body.problemIds
          .map(Number)
          .filter((n: number) => Number.isInteger(n) && n > 0)
          .forEach((problemId: number, index: number) => {
            run('INSERT OR IGNORE INTO team_list_items (list_id, problem_id, order_no, note) VALUES (?, ?, ?, ?)', [
              id,
              problemId,
              index + 1,
              '',
            ]);
          });
      });
    }
    return { ok: true };
  });

  app.delete('/api/teams/:slug/lists/:id', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    const id = parseId((request.params as any).id);
    const list = get<any>('SELECT * FROM team_lists WHERE id = ? AND team_id = ?', [id, ctx.team.id]);
    if (!list) throw notFound('题单不存在');
    if (list.created_by !== request.user!.id && !can(ctx, 'lists')) throw forbidden();
    run('UPDATE team_lists SET is_deleted = 1 WHERE id = ?', [id]);
    refreshCounters(ctx.team.id);
    return { ok: true };
  });

  /* ============================================================== 比赛 */
  app.get('/api/teams/:slug/contests', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    assertVisible(ctx);
    const items = all<any>(
      `SELECT c.id, c.title, c.subtitle, c.rules, c.start_time, c.end_time, c.is_public, c.created_at,
              (SELECT COUNT(*) FROM contest_problems cp WHERE cp.contest_id = c.id) AS problem_count,
              (SELECT COUNT(*) FROM contest_registrations r WHERE r.contest_id = c.id) AS participant_count
         FROM contests c WHERE c.team_id = ? AND c.deleted_at IS NULL ORDER BY c.start_time DESC LIMIT 100`,
      [ctx.team.id],
    );
    return { items, canManage: can(ctx, 'contests'), canCreate: isMember(ctx) };
  });

  /** 团队比赛复用主站比赛：创建时带上 teamId，参与者按团队成员报名 */
  app.post('/api/teams/:slug/contests', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    requirePermission(ctx, 'contests');
    const body = (request.body ?? {}) as any;
    const title = String(body.title ?? '').trim();
    if (title.length < 2) throw badRequest('比赛名称至少 2 个字符');
    const startTime = String(body.startTime ?? '');
    const endTime = String(body.endTime ?? '');
    if (!startTime || !endTime) throw badRequest('请填写比赛起止时间');
    const rules = ['acm', 'oi', 'ioi'].includes(body.rules) ? body.rules : 'acm';
    const ids = Array.isArray(body.problemIds)
      ? body.problemIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
      : [];
    const contestId = tx(() => {
      const info = run(
        `INSERT INTO contests (title, subtitle, description, rules, start_time, end_time, is_public, need_register,
           show_rank, rated, team_id, origin, owner_id, author_id, review_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 0, ?, 'official', ?, ?, 'approved')`,
        [
          title.slice(0, 120),
          String(body.subtitle ?? ''),
          String(body.description ?? ''),
          rules,
          startTime,
          endTime,
          body.isPublic ? 1 : 0,
          ctx.team.id,
          request.user!.id,
          request.user!.id,
        ],
      );
      const id = Number(info.lastInsertRowid);
      ids.forEach((problemId: number, index: number) => {
        run(
          `INSERT OR IGNORE INTO contest_problems (contest_id, problem_id, order_no, label, score)
           VALUES (?, ?, ?, ?, 100)`,
          [id, problemId, index + 1, String.fromCharCode(65 + index)],
        );
      });
      // 团队成员自动报名，省去逐个报名
      const members = all<{ user_id: number }>('SELECT user_id FROM team_members WHERE team_id = ?', [ctx.team.id]);
      for (const member of members) {
        run('INSERT OR IGNORE INTO contest_registrations (contest_id, user_id) VALUES (?, ?)', [id, member.user_id]);
      }
      return id;
    });
    refreshCounters(ctx.team.id);
    audit(request, 'team.contest_create', { targetType: 'team', targetId: ctx.team.id, detail: { title } });
    return { ok: true, id: contestId };
  });

  /* ============================================================== 文件 */
  app.get('/api/teams/:slug/files', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    assertVisible(ctx);
    const items = all<any>(
      `SELECT f.*, u.username AS uploader_name, u.display_name AS uploader_display, u.avatar AS uploader_avatar
         FROM team_files f LEFT JOIN users u ON u.id = f.uploader_id
        WHERE f.team_id = ? AND f.is_deleted = 0 AND (f.is_public = 1 OR ?)
        ORDER BY f.id DESC LIMIT 200`,
      [ctx.team.id, isMember(ctx) ? 1 : 0],
    );
    return { items, canManage: can(ctx, 'files'), canUpload: isMember(ctx) };
  });

  app.post('/api/teams/:slug/files', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    requireMember(ctx);
    const file = await (request as any).file({
      limits: { fileSize: num('team_file_max_mb', 64) * 1024 * 1024 },
    });
    if (!file) throw badRequest('请选择要上传的文件');
    const buffer = await file.toBuffer();
    const dir = uploadDir(path.join('teams', String(ctx.team.id)));
    const safeName = path
      .basename(file.filename || 'file')
      .replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_')
      .slice(-80);
    const stored = `${Date.now().toString(36)}-${safeName}`;
    fs.writeFileSync(path.join(dir, stored), buffer);
    const displayName = String((request.query as any)?.name ?? '').trim() || safeName;
    const info = run(
      `INSERT INTO team_files (team_id, uploader_id, name, filename, path, size, mimetype, description, is_public)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ctx.team.id,
        request.user!.id,
        displayName.slice(0, 120),
        safeName,
        path.join('teams', String(ctx.team.id), stored),
        buffer.length,
        file.mimetype || 'application/octet-stream',
        String((request.query as any)?.description ?? ''),
        toBool((request.query as any)?.public, false) ? 1 : 0,
      ],
    );
    refreshCounters(ctx.team.id);
    awardContribution(ctx.team.id, request.user!.id, 2);
    audit(request, 'team.file_upload', { targetType: 'team', targetId: ctx.team.id, detail: { name: displayName } });
    return { ok: true, id: Number(info.lastInsertRowid) };
  });

  app.get('/api/teams/:slug/files/:id', async (request, reply) => {
    const ctx = context(request, String((request.params as any).slug));
    assertVisible(ctx);
    const id = parseId((request.params as any).id);
    const file = get<any>('SELECT * FROM team_files WHERE id = ? AND team_id = ? AND is_deleted = 0', [
      id,
      ctx.team.id,
    ]);
    if (!file) throw notFound('文件不存在');
    if (!file.is_public && !isMember(ctx)) throw forbidden('该文件仅团队成员可下载');
    const full = path.join(config.paths.uploads, file.path);
    if (!fs.existsSync(full)) throw notFound('文件已丢失');
    run('UPDATE team_files SET downloads = downloads + 1 WHERE id = ?', [id]);
    reply.header('Content-Type', file.mimetype || 'application/octet-stream');
    reply.header(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file.filename)}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    return reply.send(fs.createReadStream(full));
  });

  app.put('/api/teams/:slug/files/:id', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    const id = parseId((request.params as any).id);
    const file = get<any>('SELECT * FROM team_files WHERE id = ? AND team_id = ?', [id, ctx.team.id]);
    if (!file) throw notFound('文件不存在');
    if (file.uploader_id !== request.user!.id && !can(ctx, 'files')) throw forbidden();
    const body = (request.body ?? {}) as any;
    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.name !== undefined) {
      fields.push('name = ?');
      values.push(String(body.name).slice(0, 120));
    }
    if (body.description !== undefined) {
      fields.push('description = ?');
      values.push(String(body.description));
    }
    if (body.isPublic !== undefined) {
      fields.push('is_public = ?');
      values.push(body.isPublic ? 1 : 0);
    }
    if (!fields.length) throw badRequest('没有需要更新的内容');
    run(`UPDATE team_files SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    return { ok: true };
  });

  app.delete('/api/teams/:slug/files/:id', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    const id = parseId((request.params as any).id);
    const file = get<any>('SELECT * FROM team_files WHERE id = ? AND team_id = ?', [id, ctx.team.id]);
    if (!file) throw notFound('文件不存在');
    if (file.uploader_id !== request.user!.id && !can(ctx, 'files')) throw forbidden();
    run('UPDATE team_files SET is_deleted = 1 WHERE id = ?', [id]);
    try {
      fs.rmSync(path.join(config.paths.uploads, file.path), { force: true });
    } catch {
      /* 文件可能已不存在 */
    }
    refreshCounters(ctx.team.id);
    return { ok: true };
  });

  /* ========================================================= 团队统计面板 */
  app.get('/api/teams/:slug/statistics', async (request) => {
    const ctx = context(request, String((request.params as any).slug));
    requireMember(ctx);
    const difficultyDistribution = all<any>(
      `SELECT p.difficulty, COUNT(DISTINCT p.id) AS c FROM team_problems tp
         JOIN problems p ON p.id = tp.problem_id WHERE tp.team_id = ? GROUP BY p.difficulty`,
      [ctx.team.id],
    );
    const solvedByMember = all<any>(
      `SELECT u.id, u.username, u.display_name, u.avatar,
              (SELECT COUNT(*) FROM team_problems tp
                 JOIN user_problem_stats st ON st.problem_id = tp.problem_id AND st.user_id = u.id AND st.accepted > 0
                WHERE tp.team_id = ?) AS solved
         FROM team_members m JOIN users u ON u.id = m.user_id
        WHERE m.team_id = ? ORDER BY solved DESC LIMIT 20`,
      [ctx.team.id, ctx.team.id],
    );
    const recentActivity = all<any>(
      `SELECT s.id, s.status, s.created_at, p.pid, p.title, u.username, u.display_name
         FROM submissions s
         JOIN problems p ON p.id = s.problem_id
         JOIN team_problems tp ON tp.problem_id = p.id AND tp.team_id = ?
         JOIN users u ON u.id = s.user_id
        ORDER BY s.id DESC LIMIT 15`,
      [ctx.team.id],
    );
    return { difficultyDistribution, solvedByMember, recentActivity };
  });
}
