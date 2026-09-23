import { all, get, run } from '../db/index.js';
import { bool } from '../settings/index.js';

export function sendMessage(options: {
  to: number;
  from?: number | null;
  title: string;
  content?: string;
  type?: 'system' | 'user' | 'reply' | 'judge' | 'shop';
  refType?: string;
  refId?: number | null;
  setting?: string;
}): void {
  if (options.setting && !bool(options.setting, true)) return;
  if (!get('SELECT id FROM users WHERE id = ?', [options.to])) return;
  run(
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

export function notifyAdmins(
  title: string,
  content: string,
  options: { refType?: string; refId?: number | null; minRole?: 'admin' | 'superadmin' } = {},
): void {
  const minRole = options.minRole ?? 'admin';
  const roles = minRole === 'admin' ? ['admin', 'superadmin'] : ['superadmin'];
  const rows = all<{ id: number }>(
    `SELECT id FROM users WHERE role IN (${roles.map(() => '?').join(',')})`,
    roles,
  );
  for (const row of rows) {
    sendMessage({
      to: row.id,
      title,
      content,
      type: 'system',
      refType: options.refType,
      refId: options.refId ?? null,
    });
  }
}
