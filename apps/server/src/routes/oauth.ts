import type { FastifyInstance, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { all, get, run, tx } from '../db/index.js';
import { requireUser, setAuthCookie } from '../lib/auth.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { randomToken, signJson, signToken, verifyJson } from '../lib/crypto.js';
import {
  buildAuthorizeUrl,
  callbackUrl,
  enabledProviders,
  exchangeCode,
  fetchProfile,
  providerConfig,
  redirectBase,
  safeUsername,
} from '../lib/oauth.js';
import { bool, num, str } from '../settings/index.js';
import { audit } from '../lib/audit.js';
import { evaluateAchievements } from '../lib/achievements.js';

interface OAuthState {
  p: string;
  r: string;
  u: number;
  n: string;
}

function frontendRedirect(reply: FastifyReply, params: Record<string, string>): void {
  const base = redirectBase();
  const search = new URLSearchParams(params);
  reply.redirect(`${base}/oauth/callback?${search.toString()}`, 302);
}

export async function registerOAuthRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------------------------------------- metadata */
  app.get('/api/auth/oauth/providers', async (request) => {
    const providers = enabledProviders();
    const bindings = request.user
      ? all<any>('SELECT provider, provider_username, provider_email, created_at FROM oauth_accounts WHERE user_id = ?', [
          request.user.id,
        ])
      : [];
    return {
      enabled: bool('oauth_enabled', true),
      showOnLogin: bool('oauth_show_on_login', true),
      allowBind: bool('oauth_allow_bind', true),
      autoRegister: bool('oauth_auto_register', true),
      providers: providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        bindUrl: `/api/auth/oauth/${provider.id}/start?bind=1`,
        loginUrl: `/api/auth/oauth/${provider.id}/start`,
      })),
      bindings,
    };
  });

  /* ---------------------------------------------------------------- start */
  app.get('/api/auth/oauth/:provider/start', async (request, reply) => {
    const providerId = String((request.params as any).provider);
    const config = providerConfig(providerId);
    if (!config) throw notFound('不支持的第三方登录方式');
    if (!config.enabled) {
      return reply.code(400).send({
        code: 400,
        message: `${config.name} 登录尚未配置，请联系管理员`,
      });
    }
    const query = request.query as any;
    const bind = query.bind === '1' || query.bind === 'true';
    if (bind) {
      if (!bool('oauth_allow_bind', true)) throw forbidden('本站未开放第三方账号绑定');
      requireUser(request);
    }
    const state = signJson(
      {
        p: providerId,
        r: typeof query.redirect === 'string' && query.redirect.startsWith('/') ? query.redirect : '/',
        u: bind && request.user ? request.user.id : 0,
        n: randomToken(8),
      } satisfies OAuthState,
      900,
    );
    const url = buildAuthorizeUrl(config, state);
    if (query.json === '1') return { ok: true, url, redirectUri: callbackUrl(providerId) };
    return reply.redirect(url, 302);
  });

  /* ------------------------------------------------------------- callback */
  app.get('/api/auth/oauth/:provider/callback', async (request, reply) => {
    const providerId = String((request.params as any).provider);
    const query = request.query as any;
    const config = providerConfig(providerId);
    if (!config || !config.enabled) {
      return frontendRedirect(reply, { error: '第三方登录未启用' });
    }
    if (query.error) {
      return frontendRedirect(reply, { error: String(query.error_description ?? query.error) });
    }
    const state = verifyJson<OAuthState>(String(query.state ?? ''));
    if (!state || state.p !== providerId) {
      return frontendRedirect(reply, { error: '登录状态校验失败，请重试' });
    }
    const code = String(query.code ?? '');
    if (!code) return frontendRedirect(reply, { error: '缺少授权码' });

    const token = await exchangeCode(config, code);
    if ('error' in token) {
      audit(request, 'oauth.error', { detail: { provider: providerId, error: token.error } });
      return frontendRedirect(reply, { error: token.error });
    }
    const profileResult = await fetchProfile(config, token.accessToken);
    if ('error' in profileResult) {
      audit(request, 'oauth.error', { detail: { provider: providerId, error: profileResult.error } });
      return frontendRedirect(reply, { error: profileResult.error });
    }
    const { profile } = profileResult;

    const link = get<any>('SELECT * FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?', [
      providerId,
      profile.providerUserId,
    ]);

    /* ------------------------------------------------------------- binding */
    if (state.u) {
      const user = get<any>('SELECT * FROM users WHERE id = ?', [state.u]);
      if (!user) return frontendRedirect(reply, { error: '账号不存在' });
      if (link && link.user_id !== user.id) {
        return frontendRedirect(reply, { error: '该第三方账号已绑定到其他用户' });
      }
      if (!link) {
        run(
          `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_username, provider_email, avatar)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [user.id, providerId, profile.providerUserId, profile.username, profile.email, profile.avatar],
        );
      }
      audit(request, 'oauth.bind', { targetType: 'user', targetId: user.id, detail: { provider: providerId } });
      evaluateAchievements(user.id);
      return frontendRedirect(reply, { bound: providerId });
    }

    /* --------------------------------------------------------------- login */
    let user = link ? get<any>('SELECT * FROM users WHERE id = ?', [link.user_id]) : null;

    if (!user && profile.email && bool('oauth_bind_by_email', true)) {
      user = get<any>('SELECT * FROM users WHERE email IS NOT NULL AND email = ?', [profile.email.toLowerCase()]);
      if (user) {
        run(
          `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_username, provider_email, avatar)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [user.id, providerId, profile.providerUserId, profile.username, profile.email, profile.avatar],
        );
      }
    }

    if (!user) {
      if (!bool('oauth_auto_register', true)) {
        return frontendRedirect(reply, { error: '该第三方账号尚未绑定 OGOJ 账号，请联系管理员' });
      }
      const role = str('oauth_default_role', 'user') === 'admin' ? 'admin' : 'user';
      const username = safeUsername(
        profile.username,
        (candidate) => Boolean(get('SELECT id FROM users WHERE username = ?', [candidate])),
      );
      const userId = tx(() => {
        const info = run(
          `INSERT INTO users (username, email, password_hash, role, display_name, avatar, is_private)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            username,
            profile.email ? profile.email.toLowerCase() : null,
            // Random password: the account is meant to be used through OAuth,
            // an administrator can always reset it later.
            bcrypt.hashSync(randomToken(16), 10),
            role,
            profile.username.slice(0, 32) || username,
            profile.avatar || null,
            bool('hide_private_by_default', false) ? 1 : 0,
          ],
        );
        const id = Number(info.lastInsertRowid);
        run(
          `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_username, provider_email, avatar)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, providerId, profile.providerUserId, profile.username, profile.email, profile.avatar],
        );
        return id;
      });
      user = get<any>('SELECT * FROM users WHERE id = ?', [userId]);
      audit(request, 'oauth.register', {
        targetType: 'user',
        targetId: userId,
        detail: { provider: providerId },
      });
    }

    if (!user) return frontendRedirect(reply, { error: '登录失败' });
    if (user.is_banned) {
      return frontendRedirect(reply, { error: `账号已被封禁：${user.ban_reason || '违反社区规范'}` });
    }

    /* ------------------------------------------------------- keep in sync */
    if (link) {
      run('UPDATE oauth_accounts SET provider_username = ?, provider_email = ?, avatar = ? WHERE id = ?', [
        profile.username,
        profile.email,
        profile.avatar,
        link.id,
      ]);
    }
    if (!user.avatar && profile.avatar) {
      run('UPDATE users SET avatar = ? WHERE id = ?', [profile.avatar, user.id]);
    }
    run(`UPDATE users SET last_login_at = datetime('now'), last_login_ip = ? WHERE id = ?`, [
      request.ip,
      user.id,
    ]);
    run(
      'INSERT INTO login_logs (user_id, username, ip, user_agent, success) VALUES (?, ?, ?, ?, 1)',
      [user.id, user.username, request.ip, `oauth:${providerId}`],
    );

    const days = num('session_days', 14);
    const jwt = signToken({ sub: user.id, username: user.username, role: user.role }, days * 86400);
    setAuthCookie(reply, jwt, days);
    audit(request, 'oauth.login', { targetType: 'user', targetId: user.id, detail: { provider: providerId } });
    evaluateAchievements(user.id);
    return frontendRedirect(reply, { token: jwt, redirect: state.r || '/' });
  });

  /* ------------------------------------------------------- bind / unbind */
  app.get('/api/auth/oauth/bindings', async (request) => {
    const user = requireUser(request);
    const bindings = all<any>(
      `SELECT provider, provider_username, provider_email, created_at FROM oauth_accounts
        WHERE user_id = ? ORDER BY created_at ASC`,
      [user.id],
    );
    const providers = enabledProviders().map((provider) => ({
      id: provider.id,
      name: provider.name,
      bound: bindings.some((item) => item.provider === provider.id),
    }));
    return { bindings, providers };
  });

  app.delete('/api/auth/oauth/bindings/:provider', async (request) => {
    const user = requireUser(request);
    const provider = String((request.params as any).provider);
    const row = get<any>('SELECT * FROM oauth_accounts WHERE user_id = ? AND provider = ?', [user.id, provider]);
    if (!row) throw notFound('未绑定该第三方账号');
    const remaining = all<any>('SELECT provider FROM oauth_accounts WHERE user_id = ?', [user.id]).length;
    if (remaining <= 1) {
      const hasPassword = Boolean(get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [user.id]));
      if (!hasPassword) throw badRequest('解绑后你将无法登录，请先设置密码');
    }
    run('DELETE FROM oauth_accounts WHERE id = ?', [row.id]);
    audit(request, 'oauth.unbind', { targetType: 'user', targetId: user.id, detail: { provider } });
    return { ok: true };
  });

  /* ---------------------------------------------- simulate for local tests */
  app.get('/api/auth/oauth/debug/callback-url', async (request) => {
    requireUser(request);
    return {
      base: redirectBase(),
      callbacks: enabledProviders().map((provider) => ({
        provider: provider.id,
        url: callbackUrl(provider.id),
      })),
    };
  });

}
