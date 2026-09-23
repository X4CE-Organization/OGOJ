import type { FastifyInstance } from 'fastify';
import { all, get, run } from '../db/index.js';
import { hashPassword, signToken, verifyPassword } from '../lib/crypto.js';
import { requireUser, setAuthCookie, clearAuthCookie } from '../lib/auth.js';
import { badRequest, conflict, forbidden, tooMany, unauthorized } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { json as settingJson, bool, num, str } from '../settings/index.js';
import { addPoints } from '../lib/points.js';
import { levelOf, userBrief } from './helpers.js';

interface RegisterBody {
  username?: string;
  password?: string;
  password2?: string;
  email?: string;
  invite_code?: string;
}

function validateUsername(username: string): void {
  const min = num('username_min_length', 3);
  const max = num('username_max_length', 16);
  if (username.length < min) throw badRequest(`用户名至少 ${min} 个字符`);
  if (username.length > max) throw badRequest(`用户名最多 ${max} 个字符`);
  const pattern = str('username_regex', '^[A-Za-z0-9_]+$');
  try {
    if (!new RegExp(pattern).test(username)) throw badRequest('用户名包含不允许的字符');
  } catch (error) {
    if (error instanceof Error && error.message.includes('不允许')) throw error;
  }
  const banned = settingJson<string[]>('banned_usernames', []).map((s) => s.toLowerCase());
  if (banned.includes(username.toLowerCase())) throw badRequest('该用户名已被保留，请更换');
}

function validatePassword(password: string): void {
  const min = num('password_min_length', 8);
  if (password.length < min) throw badRequest(`密码至少 ${min} 位`);
  if (password.length > 128) throw badRequest('密码过长');
}

function registerLoginAttempt(username: string, ip: string, success: boolean, userId?: number): void {
  run(
    'INSERT INTO login_logs (user_id, username, ip, user_agent, success) VALUES (?, ?, ?, ?, ?)',
    [userId ?? null, username, ip, '', success ? 1 : 0],
  );
  const key = `login:${username}:${ip}`;
  if (success) {
    run('DELETE FROM rate_limits WHERE key = ?', [key]);
    return;
  }
  const limit = num('login_fail_limit', 10);
  if (limit <= 0) return;
  const row = get<{ count: number }>('SELECT count FROM rate_limits WHERE key = ?', [key]);
  const count = (row?.count ?? 0) + 1;
  const lockMinutes = num('login_lock_minutes', 15);
  run(
    `INSERT INTO rate_limits (key, count, expires_at)
     VALUES (?, ?, datetime('now', ?))
     ON CONFLICT(key) DO UPDATE SET count = ?, expires_at = datetime('now', ?)`,
    [key, count, `+${lockMinutes} minutes`, count, `+${lockMinutes} minutes`],
  );
}

function lockedOut(username: string, ip: string): boolean {
  const limit = num('login_fail_limit', 10);
  if (limit <= 0) return false;
  const row = get<{ count: number; expires_at: string }>(
    'SELECT count, expires_at FROM rate_limits WHERE key = ?',
    [`login:${username}:${ip}`],
  );
  if (!row) return false;
  if (new Date(`${row.expires_at}Z`).getTime() < Date.now()) {
    run('DELETE FROM rate_limits WHERE key = ?', [`login:${username}:${ip}`]);
    return false;
  }
  return row.count >= limit;
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/register', {
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
    handler: async (request, reply) => {
      if (!bool('allow_register', true)) throw forbidden('本站暂未开放注册');
      const body = (request.body ?? {}) as RegisterBody;
      const username = (body.username ?? '').trim();
      const password = body.password ?? '';
      if (!username) throw badRequest('请填写用户名');
      if (!body.password2 || body.password2 !== password) throw badRequest('两次输入的密码不一致');
      validateUsername(username);
      validatePassword(password);

      if (bool('register_need_invite', false)) {
        const expected = str('invite_code', '');
        if (!expected || (body.invite_code ?? '').trim() !== expected) {
          throw forbidden('邀请码不正确');
        }
      }

      const email = (body.email ?? '').trim().toLowerCase();
      if (bool('register_need_email', false) && !email) throw badRequest('请填写邮箱');
      if (email) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('邮箱格式不正确');
        const suffixes = settingJson<string[]>('register_email_suffix', []);
        if (suffixes.length) {
          const domain = email.split('@')[1] ?? '';
          if (!suffixes.some((suffix) => domain === suffix || domain.endsWith(`.${suffix}`))) {
            throw badRequest(`仅允许使用 ${suffixes.join('、')} 邮箱注册`);
          }
        }
      }

      if (get('SELECT id FROM users WHERE username = ?', [username])) {
        throw conflict('该用户名已被注册');
      }
      if (email && get('SELECT id FROM users WHERE email = ?', [email])) {
        throw conflict('该邮箱已被注册');
      }

      const role = str('default_role', 'user') === 'admin' ? 'admin' : 'user';
      const info = run(
        `INSERT INTO users (username, email, password_hash, role, display_name, is_private, invite_code)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          username,
          email || null,
          await hashPassword(password),
          role,
          username,
          bool('hide_private_by_default', false) ? 1 : 0,
          null,
        ],
      );
      const userId = Number(info.lastInsertRowid);
      audit(request, 'user.register', { targetType: 'user', targetId: userId, detail: { username } });

      const token = signToken({ sub: userId, username, role }, num('session_days', 14) * 86400);
      setAuthCookie(reply, token, num('session_days', 14));
      const user = get<any>('SELECT * FROM users WHERE id = ?', [userId]);
      return { token, user: publicUser(user) };
    },
  });

  app.post('/api/auth/login', {
    config: { rateLimit: { max: 30, timeWindow: '5 minutes' } },
    handler: async (request, reply) => {
      const body = (request.body ?? {}) as { username?: string; password?: string; remember?: boolean };
      const account = (body.username ?? '').trim();
      const password = body.password ?? '';
      if (!account || !password) throw badRequest('请填写用户名和密码');
      if (lockedOut(account, request.ip)) throw tooMany('登录失败次数过多，请稍后再试');

      const user = get<any>(
        'SELECT * FROM users WHERE username = ? OR (email IS NOT NULL AND email = ?)',
        [account, account.toLowerCase()],
      );
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        registerLoginAttempt(account, request.ip, false);
        throw unauthorized('用户名或密码错误');
      }
      if (user.is_banned) {
        throw forbidden(`账号已被封禁：${user.ban_reason || '违反社区规范'}`);
      }

      registerLoginAttempt(account, request.ip, true, user.id);
      const days = body.remember === false ? 1 : num('session_days', 14);
      const token = signToken({ sub: user.id, username: user.username, role: user.role }, days * 86400);
      setAuthCookie(reply, token, days);
      run(
        `UPDATE users SET last_login_at = datetime('now'), last_login_ip = ? WHERE id = ?`,
        [request.ip, user.id],
      );

      const daily = num('points_daily_login', 0);
      if (daily > 0 && bool('enable_points', true)) {
        const lastLogin = user.last_login_at as string | null;
        const today = new Date().toISOString().slice(0, 10);
        if (!lastLogin || !lastLogin.startsWith(today)) {
          addPoints(user.id, daily, '每日登录');
        }
      }
      audit(request, 'user.login', { targetType: 'user', targetId: user.id });
      const fresh = get<any>('SELECT * FROM users WHERE id = ?', [user.id]);
      return { token, user: publicUser(fresh) };
    },
  });

  app.post('/api/auth/logout', async (request, reply) => {
    clearAuthCookie(reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (request) => {
    const user = requireUser(request);
    const row = get<any>('SELECT * FROM users WHERE id = ?', [user.id]);
    if (!row) throw unauthorized();
    const unread = get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM messages WHERE to_id = ? AND is_read = 0',
      [user.id],
    );
    const grants = all<any>(
      `SELECT kind, SUM(total - used) AS remaining FROM grants
        WHERE user_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
        GROUP BY kind`,
      [user.id],
    );
    return {
      user: publicUser(row),
      profile: {
        email: row.show_email || row.id === user.id ? row.email : null,
        bio: row.bio,
        school: row.school,
        ccfLevel: row.ccf_level,
        gender: row.gender,
        theme: row.theme,
        isPrivate: Boolean(row.is_private),
        showEmail: Boolean(row.show_email),
        createdAt: row.created_at,
        lastLoginAt: row.last_login_at,
      },
      unreadMessages: unread?.c ?? 0,
      level: levelOf(row.solved_count ?? 0),
      grants: Object.fromEntries(grants.map((g) => [g.kind, g.remaining ?? 0])),
    };
  });

  app.put('/api/auth/profile', async (request) => {
    const user = requireUser(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const fields: string[] = [];
    const values: unknown[] = [];
    const assign = (column: string, value: unknown) => {
      fields.push(`${column} = ?`);
      values.push(value);
    };
    if (typeof body.bio === 'string') assign('bio', body.bio.slice(0, 500));
    if (typeof body.school === 'string') assign('school', body.school.slice(0, 100));
    if (typeof body.ccf_level === 'string') assign('ccf_level', body.ccf_level.slice(0, 50));
    if (typeof body.gender === 'number') assign('gender', Math.max(0, Math.min(2, body.gender)));
    if (typeof body.theme === 'string' && ['light', 'dark', 'system'].includes(body.theme)) {
      assign('theme', body.theme);
    }
    if (typeof body.is_private === 'boolean') assign('is_private', body.is_private ? 1 : 0);
    if (typeof body.show_email === 'boolean') assign('show_email', body.show_email ? 1 : 0);
    if (typeof body.display_name === 'string' && body.display_name.trim()) {
      assign('display_name', body.display_name.trim().slice(0, 32));
    }
    if (typeof body.avatar === 'string') assign('avatar', body.avatar.slice(0, 500));
    if (typeof body.banner === 'string') assign('banner', body.banner.slice(0, 500));
    if (typeof body.email === 'string') {
      const email = body.email.trim().toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('邮箱格式不正确');
      if (email) {
        const taken = get('SELECT id FROM users WHERE email = ? AND id <> ?', [email, user.id]);
        if (taken) throw conflict('该邮箱已被其他账号使用');
      }
      assign('email', email || null);
    }
    if (fields.length) {
      fields.push(`updated_at = datetime('now')`);
      run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, [...values, user.id]);
      audit(request, 'user.update_profile', { targetType: 'user', targetId: user.id });
    }
    return { ok: true, user: publicUser(get<any>('SELECT * FROM users WHERE id = ?', [user.id])) };
  });

  app.put('/api/auth/password', async (request, reply) => {
    const user = requireUser(request);
    const body = (request.body ?? {}) as { old_password?: string; new_password?: string; new_password2?: string };
    if (!body.new_password || body.new_password !== body.new_password2) {
      throw badRequest('两次输入的新密码不一致');
    }
    validatePassword(body.new_password);
    const row = get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [user.id]);
    if (!row) throw unauthorized();
    if (!(await verifyPassword(body.old_password ?? '', row.password_hash))) {
      throw badRequest('原密码不正确');
    }
    run(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`, [
      await hashPassword(body.new_password),
      user.id,
    ]);
    audit(request, 'user.change_password', { targetType: 'user', targetId: user.id });
    clearAuthCookie(reply);
    return { ok: true, message: '密码已修改，请重新登录' };
  });

  app.get('/api/auth/check-username', async (request) => {
    const username = String((request.query as any)?.username ?? '').trim();
    if (!username) return { available: false, reason: '请输入用户名' };
    try {
      validateUsername(username);
    } catch (error) {
      return { available: false, reason: error instanceof Error ? error.message : '用户名不可用' };
    }
    const exists = Boolean(get('SELECT id FROM users WHERE username = ?', [username]));
    return { available: !exists, reason: exists ? '该用户名已被注册' : '' };
  });

  app.post('/api/auth/renew', async (request, reply) => {
    const user = requireUser(request);
    const row = get<any>('SELECT * FROM users WHERE id = ?', [user.id]);
    const days = num('session_days', 14);
    const token = signToken({ sub: user.id, username: user.username, role: user.role }, days * 86400);
    setAuthCookie(reply, token, days);
    return { token, user: publicUser(row) };
  });
}

export function publicUser(row: any) {
  if (!row) return null;
  return {
    ...userBrief(row),
    bio: row.bio ?? '',
    signature: row.signature ?? '',
    points: row.points,
    rating: row.rating,
    solvedCount: row.solved_count,
    submissionCount: row.submission_count,
    acceptedCount: row.accepted_count,
    contestCount: row.contest_count,
    isPrivate: Boolean(row.is_private),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    level: levelOf(row.solved_count ?? 0),
    banner: row.banner ?? '',
    school: row.school ?? '',
    ccfLevel: row.ccf_level ?? '',
    gender: row.gender ?? 0,
  };
}
