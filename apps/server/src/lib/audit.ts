import type { FastifyRequest } from 'fastify';
import { run } from '../db/index.js';
import { bool } from '../settings/index.js';

export function audit(
  request: FastifyRequest,
  action: string,
  options: { targetType?: string; targetId?: string | number; detail?: unknown } = {},
): void {
  if (!bool('enable_audit_log', true)) return;
  try {
    run(
      `INSERT INTO audit_logs (actor_id, actor_name, action, target_type, target_id, detail, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        request.user?.id ?? null,
        request.user?.username ?? 'anonymous',
        action,
        options.targetType ?? '',
        options.targetId === undefined ? '' : String(options.targetId),
        options.detail === undefined
          ? ''
          : typeof options.detail === 'string'
            ? options.detail
            : JSON.stringify(options.detail).slice(0, 4000),
        request.ip ?? '',
      ],
    );
  } catch {
    /* auditing must never break the request */
  }
}
