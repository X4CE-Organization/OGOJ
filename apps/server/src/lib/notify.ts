import { all, get, run } from '../db/index.js';
import { config } from '../config.js';
import { bool } from '../settings/index.js';
import { mailEnabled, mailUser, siteName } from './mail.js';

/** 站内信里的关联对象 → 邮件里的直达链接 */
const REF_PATH: Record<string, string> = {
  moment: '/moment/',
  discussion: '/discussion/',
  article: '/article/',
  solution: '/solution/',
  ticket: '/tickets/',
  contest: '/contest/',
  problem: '/problem/',
  submission: '/record/',
};

export async function sendMessage(options: {
  to: number;
  from?: number | null;
  title: string;
  content?: string;
  type?: 'system' | 'user' | 'reply' | 'judge' | 'shop';
  refType?: string;
  refId?: number | null;
  setting?: string;
}): Promise<void> {
  if (options.setting && !bool(options.setting, true)) return;
  if (!await get('SELECT id FROM users WHERE id = ?', [options.to])) return;
  await run(
    `INSERT INTO messages (from_id, to_id, title, content, type, ref_type, ref_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      options.from ?? null,
      options.to,
      options.title.slice(0, 200),
      options.content ?? '',
      options.type ?? 'system',
      options.refType ?? '',
      options.refId ?? null,
    ],
  );

  // 站内信照旧；配好 SMTP 后再镜像一封邮件（异步发送，不影响请求耗时）
  if (mailEnabled()) {
    const category = options.type === 'reply' ? 'reply' : options.type === 'judge' ? 'judge' : options.type === 'shop' ? 'shop' : 'system';
    const path = options.refType ? REF_PATH[options.refType] : undefined;
    const link = path && options.refId ? `${config.siteUrl.replace(/\/$/, '')}${path}${options.refId}` : '';
    void mailUser(options.to, {
      subject: `[${siteName()}] ${options.title}`,
      category,
      content: {
        title: options.title,
        intro: options.content?.slice(0, 400) ?? '',
        button: link ? { label: '在站内查看', url: link } : undefined,
        footnote: '你可以在「个人设置 → 通知」里关闭邮件提醒。',
      },
    }).catch(() => undefined);
  }
}

export async function notifyAdmins(
  title: string,
  content: string,
  options: { refType?: string; refId?: number | null; minRole?: 'admin' | 'superadmin' } = {},
): Promise<void> {
  const minRole = options.minRole ?? 'admin';
  const roles = minRole === 'admin' ? ['admin', 'superadmin'] : ['superadmin'];
  const rows = await all<{ id: number }>(
    `SELECT id FROM users WHERE role IN (${roles.map(() => '?').join(',')})`,
    roles,
  );
  for (const row of rows) {
    await sendMessage({
      to: row.id,
      title,
      content,
      type: 'system',
      refType: options.refType,
      refId: options.refId ?? null,
    });
  }
}
