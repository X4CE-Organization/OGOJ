import { get, run, tx } from '../db/index.js';
import { badRequest } from './errors.js';
import { bool, num } from '../settings/index.js';

export type PointReason =
  | 'accepted'
  | 'first_blood'
  | 'daily_login'
  | 'solution'
  | 'discussion'
  | 'contest'
  | 'shop'
  | 'admin'
  | 'register';

export interface PointResult {
  delta: number;
  balance: number;
}

export function currentPoints(userId: number): number {
  return Number(get<{ points: number }>('SELECT points FROM users WHERE id = ?', [userId])?.points ?? 0);
}

/**
 * Add (or subtract) points in a transaction and write an audit trail entry.
 * Negative balances are rejected unless the administrator enabled them.
 */
export function addPoints(
  userId: number,
  delta: number,
  reason: string,
  options: { refType?: string; refId?: number | null; reasonKind?: PointReason } = {},
): PointResult {
  if (!Number.isFinite(delta) || delta === 0) {
    return { delta: 0, balance: currentPoints(userId) };
  }
  return tx(() => {
    const user = get<{ points: number }>('SELECT points FROM users WHERE id = ?', [userId]);
    if (!user) throw badRequest('用户不存在');
    let next = user.points + delta;
    if (next < 0) {
      if (!bool('points_can_be_negative', false)) {
        throw badRequest(`积分不足，当前 ${user.points}，需要 ${Math.abs(delta)}`);
      }
      next = Math.min(next, 0);
    }
    run('UPDATE users SET points = ? WHERE id = ?', [next, userId]);
    run(
      `INSERT INTO point_logs (user_id, delta, balance_after, reason, ref_type, ref_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, delta, next, reason, options.refType ?? '', options.refId ?? null],
    );
    return { delta, balance: next };
  });
}

export function spendPoints(
  userId: number,
  amount: number,
  reason: string,
  options: { refType?: string; refId?: number | null } = {},
): PointResult {
  if (amount <= 0) throw badRequest('消耗积分必须为正数');
  return addPoints(userId, -amount, reason, options);
}

export function pointsForAccepted(): number {
  return num('points_per_accepted', 1);
}

export function pointsForFirstBlood(): number {
  return num('points_first_ac_bonus', 5);
}
