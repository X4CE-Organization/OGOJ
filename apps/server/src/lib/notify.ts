import { all, get, run } from '../db/index.js';
import { bool } from '../settings/index.js';

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
