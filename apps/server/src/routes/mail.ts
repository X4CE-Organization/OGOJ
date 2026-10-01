import type { FastifyInstance } from 'fastify';
import { get, run } from '../db/index.js';
import { requireAdmin, requireUser } from '../lib/auth.js';
import { badRequest, forbidden, tooMany } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { num, bool } from '../settings/index.js';
import {
  consumeMailCode,
  issueMailCode,
  mailConfigured,
  mailEnabled,
  mailLogs,
  recentMailCodes,
  sendMail,
  siteName,
  verifyMail,
} from '../lib/mail.js';
import { hashPassword } from '../lib/crypto.js';

async function findAccount(account: string): Promise<{ id: number; username: string; email: string | null } | null> {
  const value = account.trim();
  if (!value) return null;
  const row = await get<{ id: number; username: string; email: string | null }>(
    'SELECT id, username, email FROM users WHERE username = ? OR email = ? LIMIT 1',
    [value, value.toLowerCase()],
  );
  return row ?? null;
}

export async function registerMailRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------------------- 发送验证码（找回密码 / 注册） */
  app.post(
    '/api/auth/mail-code',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (request) => {
      if (!mailEnabled()) throw forbidden('本站暂未开启邮件服务');
      const body = (request.body ?? {}) as any;
      const account = String(body.account ?? '').trim();
      const purpose = body.purpose === 'verify' ? 'verify' : 'reset';
      if (!account) throw badRequest(purpose === 'verify' ? '请填写邮箱' : '请填写用户名或邮箱');

      if (purpose === 'verify') {
        const email = account.toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('邮箱格式不正确');
        if (await get('SELECT id FROM users WHERE email = ?', [email])) throw badRequest('该邮箱已被注册');
        const interval = Math.max(10, num('mail_code_interval_seconds', 60));
        if ((await recentMailCodes(email, 'verify', interval)) > 0) {
          throw tooMany(`验证码发送过于频繁，请 ${interval} 秒后再试`);
        }
        const code = await issueMailCode({ email, purpose: 'verify' });
        const sent = await sendMail({
          to: email,
          subject: `[${siteName()}] 注册验证码`,
          category: 'system',
          skipThrottle: true,
          content: {
            title: '注册验证码',
            intro: '请在注册页面输入下面的验证码完成注册：',
            code,
            footnote: '如果这不是你本人的操作，忽略本邮件即可。',
          },
        });
        if (!sent.ok && !sent.skipped) throw badRequest(`邮件发送失败：${sent.error ?? '未知错误'}`);
        return { ok: true, masked: email.replace(/^(.).*(@.*)$/, '$1***$2') };
      }

      const user = await findAccount(account);
      const email = user?.email ?? (account.includes('@') ? account.toLowerCase() : '');
      if (!email) {
        // 不暴露账号是否存在，但也不发信
        return { ok: true };
      }

      const interval = Math.max(10, num('mail_code_interval_seconds', 60));
      if ((await recentMailCodes(email, 'reset', interval)) > 0) {
        throw tooMany(`验证码发送过于频繁，请 ${interval} 秒后再试`);
      }

      const code = await issueMailCode({ email, purpose: 'reset', userId: user?.id ?? null });
      const result = await sendMail({
        to: email,
        subject: `[${siteName()}] 找回密码验证码`,
        category: 'system',
        userId: user?.id ?? null,
        skipThrottle: true,
        content: {
          title: '找回密码',
          intro: '你正在重置 OGOJ 账号密码，请在页面上输入下面的验证码：',
          code,
          footnote: '如果这不是你本人的操作，忽略本邮件即可，你的密码不会改变。',
        },
      });
      if (!result.ok && !result.skipped) throw badRequest(`邮件发送失败：${result.error ?? '未知错误'}`);
      return { ok: true, masked: email.replace(/^(.).*(@.*)$/, '$1***$2') };
    },
  );

  /* ----------------------------------------------------------- 重置密码 */
  app.post(
    '/api/auth/reset-password',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (request) => {
      if (!bool('mail_reset_enabled', true)) throw forbidden('本站已关闭邮箱找回密码');
      if (!mailEnabled()) throw forbidden('本站暂未开启邮件服务');
      const body = (request.body ?? {}) as any;
      const account = String(body.account ?? '').trim();
      const code = String(body.code ?? '').trim();
      const password = String(body.password ?? '');
      if (!account || !code) throw badRequest('请填写账号与验证码');
      if (password.length < 6) throw badRequest('新密码至少 6 位');
      if (body.password2 !== undefined && body.password2 !== password) throw badRequest('两次输入的密码不一致');

      const user = await findAccount(account);
      if (!user?.email) throw badRequest('验证码不正确或已过期');
      if (!(await consumeMailCode({ email: user.email, purpose: 'reset', code }))) {
        throw badRequest('验证码不正确或已过期');
      }
      await run('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?', [
        await hashPassword(password),
        user.id,
      ]);
      await audit(request, 'user.reset_password', { targetType: 'user', targetId: user.id });
      return { ok: true };
    },
  );

  /* ------------------------------------------------------- 邮件通知偏好 */
  app.get('/api/mail/preferences', async (request) => {
    const user = await requireUser(request);
    const row = await get<{ email: string | null }>('SELECT email FROM users WHERE id = ?', [user.id]);
    const optout = await get('SELECT 1 AS x FROM mail_optouts WHERE user_id = ?', [user.id]);
    return {
      email: row?.email ?? '',
      enabled: !optout,
      serviceEnabled: mailEnabled(),
    };
  });

  app.put('/api/mail/preferences', async (request) => {
    const user = await requireUser(request);
    const body = (request.body ?? {}) as any;
    if (body.enabled) {
      await run('DELETE FROM mail_optouts WHERE user_id = ?', [user.id]);
    } else {
      await run('INSERT OR IGNORE INTO mail_optouts (user_id) VALUES (?)', [user.id]);
    }
    return { ok: true, enabled: Boolean(body.enabled) };
  });

  /* ------------------------------------------------------- 后台邮件管理 */
  app.get('/api/admin/mail/status', async (request) => {
    await requireAdmin(request);
    return {
      configured: mailConfigured(),
      enabled: mailEnabled(),
      logs: await mailLogs(30),
    };
  });

  app.post('/api/admin/mail/verify', async (request) => {
    await requireAdmin(request);
    const result = await verifyMail();
    return { ok: result.ok, error: result.error };
  });

  app.post('/api/admin/mail/test', async (request) => {
    const admin = await requireAdmin(request);
    const body = (request.body ?? {}) as any;
    const to = String(body.to ?? '').trim();
    if (!to) throw badRequest('请填写接收测试邮件的地址');
    if (!mailEnabled()) throw badRequest('请先启用邮件通知并填写 SMTP 服务器');

    const verify = await verifyMail();
    if (!verify.ok) throw badRequest(`SMTP 连接失败：${verify.error ?? '未知错误'}`);

    const result = await sendMail({
      to,
      subject: `[${siteName()}] SMTP 测试邮件`,
      category: 'system',
      userId: admin.id,
      skipThrottle: true,
      content: {
        title: 'SMTP 配置成功',
        intro: '如果你收到了这封邮件，说明 OGOJ 的邮件服务已经可以正常发信了。',
        lines: [`发信时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`],
        footnote: '本邮件由控制面板的「发送测试邮件」触发。',
      },
    });
    if (!result.ok) throw badRequest(result.error ?? '发送失败');
    await audit(request, 'mail.test', { detail: { to } });
    return { ok: true };
  });
}
