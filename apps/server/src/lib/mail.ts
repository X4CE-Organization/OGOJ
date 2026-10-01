/**
 * SMTP 邮件发送。
 *
 * - 配置全部来自「控制面板 → 系统设置 → 邮件通知」（smtp_* 系列）
 * - 没启用 / 没配 SMTP 时所有函数安全降级，不会影响主流程
 * - 每次发送都会写入 mail_logs，后台可查投递情况
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { all, get, run } from '../db/index.js';
import { config } from '../config.js';
import { bool, num, str } from '../settings/index.js';
import { randomCode, sha256 } from './crypto.js';

let cache: { fingerprint: string; transporter: Transporter } | null = null;

function fingerprint(): string {
  return JSON.stringify([
    str('smtp_host', ''),
    num('smtp_port', 465),
    bool('smtp_secure', true),
    str('smtp_user', ''),
    str('smtp_password', ''),
    bool('mail_allow_insecure_tls', false),
  ]);
}

export function mailConfigured(): boolean {
  return Boolean(str('smtp_host', '').trim());
}

export function mailEnabled(): boolean {
  return bool('smtp_enabled', false) && mailConfigured();
}

export function siteName(): string {
  return str('site_name', 'OGOJ') || 'OGOJ';
}

function getTransporter(): Transporter {
  const key = fingerprint();
  if (cache && cache.fingerprint === key) return cache.transporter;
  const user = str('smtp_user', '').trim();
  const transporter = nodemailer.createTransport({
    host: str('smtp_host', '').trim(),
    port: num('smtp_port', 465),
    secure: bool('smtp_secure', true),
    auth: user ? { user, pass: str('smtp_password', '') } : undefined,
    tls: { rejectUnauthorized: !bool('mail_allow_insecure_tls', false) },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    pool: true,
    maxConnections: 2,
  });
  cache = { fingerprint: key, transporter };
  return transporter;
}

/** 后台改完 SMTP 配置后调用，下次发送会重建连接 */
export function resetMailTransport(): void {
  try {
    cache?.transporter.close();
  } catch {
    /* ignore */
  }
  cache = null;
}

export function mailFrom(): string {
  const from = str('smtp_from', '').trim() || str('smtp_user', '').trim();
  const name = str('mail_from_name', '').trim() || siteName();
  if (!from) return '';
  return name ? `"${name.replace(/"/g, '')}" <${from}>` : from;
}

const CATEGORY_SETTING: Record<string, string> = {
  reply: 'notify_on_reply',
  judge: 'notify_on_judge',
  shop: 'notify_on_shop',
  system: 'notify_on_system',
};

export function mailCategoryAllowed(category: string): boolean {
  const key = CATEGORY_SETTING[category];
  return key ? bool(key, true) : true;
}

export interface MailContent {
  title: string;
  intro?: string;
  lines?: string[];
  code?: string;
  button?: { label: string; url: string };
  footnote?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 统一的邮件模板：站点名 + 标题 + 正文 + 可选按钮 / 验证码 */
export function renderMail(content: MailContent): { html: string; text: string } {
  const name = siteName();
  const url = str('site_url', '') || config.siteUrl;
  const color = str('theme_color', '#2563eb') || '#2563eb';
  const lines = content.lines ?? [];

  const text = [
    content.title,
    '',
    content.intro ?? '',
    ...lines,
    content.code ? `验证码：${content.code}` : '',
    content.button ? `${content.button.label}：${content.button.url}` : '',
    '',
    `—— ${name}${url ? ` (${url})` : ''}`,
  ]
    .filter((line) => line !== '')
    .join('\n');

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">
    <div style="padding:18px 24px;background:${color};color:#ffffff;font-size:16px;font-weight:600">${escapeHtml(name)}</div>
    <div style="padding:24px">
      <h1 style="margin:0 0 12px;font-size:18px;line-height:1.4">${escapeHtml(content.title)}</h1>
      ${content.intro ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.7;color:#334155">${escapeHtml(content.intro)}</p>` : ''}
      ${
        lines.length
          ? `<div style="font-size:14px;line-height:1.7;color:#334155">${lines
              .map((line) => `<p style="margin:0 0 8px">${escapeHtml(line)}</p>`)
              .join('')}</div>`
          : ''
      }
      ${
        content.code
          ? `<div style="margin:18px 0;padding:14px;text-align:center;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px">
        <div style="font-size:12px;color:#64748b;margin-bottom:6px">验证码（10 分钟内有效）</div>
        <div style="font-size:26px;font-weight:700;letter-spacing:4px;font-family:ui-monospace,Menlo,monospace">${escapeHtml(content.code)}</div>
      </div>`
          : ''
      }
      ${
        content.button
          ? `<div style="margin:20px 0 4px"><a href="${escapeHtml(content.button.url)}" style="display:inline-block;padding:10px 18px;background:${color};color:#ffffff;border-radius:8px;text-decoration:none;font-size:14px">${escapeHtml(content.button.label)}</a></div>`
          : ''
      }
      ${content.footnote ? `<p style="margin:16px 0 0;font-size:12px;color:#94a3b8">${escapeHtml(content.footnote)}</p>` : ''}
    </div>
    <div style="padding:14px 24px;background:#f8fafc;font-size:12px;color:#94a3b8">本邮件由 ${escapeHtml(name)} 自动发送，请勿直接回复。</div>
  </div>
</body></html>`;

  return { html, text };
}

export interface SendMailOptions {
  to: string;
  subject: string;
  content: MailContent;
  category?: string;
  userId?: number | null;
  /** 跳过节流检查（验证码、测试邮件） */
  skipThrottle?: boolean;
}

export interface SendMailResult {
  ok: boolean;
  error?: string;
  skipped?: boolean;
}

/** 底层发送：负责降级、节流与写日志 */
export async function sendMail(options: SendMailOptions): Promise<SendMailResult> {
  const to = options.to.trim();
  if (!mailEnabled()) return { ok: false, skipped: true, error: '未启用邮件通知或未配置 SMTP' };
  if (!to) return { ok: false, skipped: true, error: '收件人为空' };

  const from = mailFrom();
  if (!from) return { ok: false, skipped: true, error: '未配置发件人地址' };

  const category = options.category ?? 'system';
  const throttle = Math.max(0, num('mail_throttle_seconds', 60));
  if (throttle > 0 && !options.skipThrottle) {
    const recent = await get<{ id: number }>(
      `SELECT id FROM mail_logs WHERE to_email = ? AND status = 'sent' AND created_at > datetime('now', ?) LIMIT 1`,
      [to, `-${throttle} seconds`],
    );
    if (recent) return { ok: false, skipped: true, error: '发送过于频繁，已跳过' };
  }

  const { html, text } = renderMail(options.content);
  try {
    await getTransporter().sendMail({
      from,
      to,
      subject: options.subject.slice(0, 160),
      text,
      html,
      replyTo: str('mail_reply_to', '').trim() || undefined,
    });
    await run(
      `INSERT INTO mail_logs (to_email, subject, category, status, user_id) VALUES (?, ?, ?, 'sent', ?)`,
      [to, options.subject.slice(0, 160), category, options.userId ?? null],
    );
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await run(
      `INSERT INTO mail_logs (to_email, subject, category, status, error, user_id) VALUES (?, ?, ?, 'failed', ?, ?)`,
      [to, options.subject.slice(0, 160), category, message.slice(0, 500), options.userId ?? null],
    );
    console.warn(`[ogoj] 邮件发送失败（${to}）：${message}`);
    return { ok: false, error: message };
  }
}

/** 给某个用户发信：自动检查邮箱、退订状态与分类开关 */
export async function mailUser(
  userId: number,
  options: { subject: string; content: MailContent; category?: string },
): Promise<SendMailResult> {
  if (!mailEnabled()) return { ok: false, skipped: true, error: '未启用邮件通知' };
  const category = options.category ?? 'system';
  if (!mailCategoryAllowed(category)) return { ok: false, skipped: true, error: '该类型邮件已关闭' };
  const user = await get<{ email: string | null }>('SELECT email FROM users WHERE id = ?', [userId]);
  const email = (user?.email ?? '').trim();
  if (!email) return { ok: false, skipped: true, error: '该用户未填写邮箱' };
  const optout = await get('SELECT 1 AS x FROM mail_optouts WHERE user_id = ?', [userId]);
  if (optout) return { ok: false, skipped: true, error: '该用户已退订邮件通知' };
  return sendMail({ to: email, subject: options.subject, content: options.content, category, userId });
}

/** 连接检测，后台「发送测试邮件」用 */
export async function verifyMail(): Promise<SendMailResult> {
  if (!mailConfigured()) return { ok: false, error: '未配置 SMTP 服务器地址' };
  try {
    await getTransporter().verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/* ------------------------------------------------------------ 邮箱验证码 */

export async function issueMailCode(options: {
  email: string;
  purpose: 'reset' | 'verify';
  userId?: number | null;
  ttlMinutes?: number;
}): Promise<string> {
  const email = options.email.trim().toLowerCase();
  const ttl = Math.max(1, options.ttlMinutes ?? 10);
  const code = randomCode(6, '0123456789');
  // 同一邮箱同一用途的旧验证码直接作废
  await run('UPDATE mail_codes SET used = 1 WHERE email = ? AND purpose = ? AND used = 0', [email, options.purpose]);
  await run(
    `INSERT INTO mail_codes (email, code, purpose, user_id, expires_at) VALUES (?, ?, ?, ?, datetime('now', ?))`,
    [email, sha256(code), options.purpose, options.userId ?? null, `+${ttl} minutes`],
  );
  return code;
}

export async function consumeMailCode(options: {
  email: string;
  purpose: 'reset' | 'verify';
  code: string;
}): Promise<boolean> {
  const email = options.email.trim().toLowerCase();
  const row = await get<{ id: number; code: string; attempts: number }>(
    `SELECT id, code, attempts FROM mail_codes
      WHERE email = ? AND purpose = ? AND used = 0 AND expires_at > datetime('now')
      ORDER BY id DESC LIMIT 1`,
    [email, options.purpose],
  );
  if (!row) return false;
  if (row.attempts >= 5) return false;
  if (row.code !== sha256(options.code.trim())) {
    await run('UPDATE mail_codes SET attempts = attempts + 1 WHERE id = ?', [row.id]);
    return false;
  }
  await run('UPDATE mail_codes SET used = 1 WHERE id = ?', [row.id]);
  return true;
}

export async function recentMailCodes(email: string, purpose: string, withinSeconds: number): Promise<number> {
  const row = await get<{ c: number }>(
    `SELECT COUNT(*) AS c FROM mail_codes WHERE email = ? AND purpose = ? AND created_at > datetime('now', ?)`,
    [email.trim().toLowerCase(), purpose, `-${Math.max(1, withinSeconds)} seconds`],
  );
  return Number(row?.c ?? 0);
}

export async function mailLogs(limit = 30): Promise<any[]> {
  return all(
    `SELECT id, to_email, subject, category, status, error, created_at FROM mail_logs ORDER BY id DESC LIMIT ?`,
    [Math.min(200, Math.max(1, limit))],
  );
}
