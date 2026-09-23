import type { FastifyInstance } from 'fastify';
import { all, count, get, run } from '../db/index.js';
import { requireAdmin, requireUser } from '../lib/auth.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { bool } from '../settings/index.js';
import { parseId } from '../lib/util.js';
import {
  achievementsForUser,
  conditionValue,
  collectStats,
  evaluateAchievements,
  parseCondition,
} from '../lib/achievements.js';

export interface AchievementDefinition {
  code: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  rarity: string;
  condition: string;
}

export async function registerAchievementRoutes(app: FastifyInstance): Promise<void> {
  /* ------------------------------------------------- 全部成就 + 我的进度 */
  app.get('/api/achievements', async (request) => {
    const user = request.user;
    const definitions = all<any>(
      `SELECT a.*, (SELECT COUNT(*) FROM user_achievements ua WHERE ua.achievement_id = a.id) AS holder_count
         FROM achievements a WHERE a.is_active = 1 ORDER BY a.sort ASC, a.id ASC`,
    );
    const unlocked = user
      ? new Map(
          all<{ achievement_id: number; unlocked_at: string }>(
            'SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = ?',
            [user.id],
          ).map((row) => [row.achievement_id, row.unlocked_at]),
        )
      : new Map<number, string>();
    const stats = user ? collectStats(user.id) : null;
    const items = definitions.map((definition) => {
      const condition = parseCondition(definition.condition);
      return {
        id: definition.id,
        code: definition.code,
        name: definition.name,
        description: definition.description,
        icon: definition.icon,
        category: definition.category,
        rarity: definition.rarity,
        points: definition.points,
        condition,
        target: Number(condition.threshold ?? 1),
        progress: stats ? conditionValue(condition, stats) : 0,
        unlocked: unlocked.has(definition.id),
        unlockedAt: unlocked.get(definition.id) ?? null,
        holderCount: definition.holder_count ?? 0,
      };
    });
    const categories = [...new Set(items.map((item) => item.category))];
    return {
      enabled: bool('achievement_enable', true),
      showLocked: bool('achievement_show_locked', true),
      items,
      categories,
      unlockedCount: items.filter((item) => item.unlocked).length,
      total: items.length,
    };
  });

  app.get('/api/users/:username/achievements', async (request) => {
    const username = String((request.params as any).username);
    const user = get<any>('SELECT id, username FROM users WHERE username = ?', [username]);
    if (!user) throw notFound('用户不存在');
    const items = achievementsForUser(user.id);
    const unlocked = items.filter((item) => item.unlocked);
    return {
      items: bool('achievement_show_locked', true)
        ? items
        : unlocked,
      unlocked: unlocked.map((item) => ({
        id: item.id,
        code: item.code,
        name: item.name,
        description: item.description,
        icon: item.icon,
        rarity: item.rarity,
        unlockedAt: item.unlockedAt,
      })),
      unlockedCount: unlocked.length,
      total: items.length,
      points: unlocked.reduce((sum, item) => sum + item.points, 0),
    };
  });

  /** Used by the "评估我的成就" button and after important events. */
  app.post('/api/achievements/check', async (request) => {
    const user = requireUser(request);
    const unlocked = evaluateAchievements(user.id);
    return { ok: true, unlocked };
  });

  /* ------------------------------------------------------------ 排行榜 */
  app.get('/api/achievements/rank', async () => {
    const items = all<any>(
      `SELECT u.id, u.username, u.display_name, u.avatar, COUNT(ua.achievement_id) AS achievement_count,
              (SELECT COALESCE(SUM(a2.points), 0) FROM user_achievements ua2
                 JOIN achievements a2 ON a2.id = ua2.achievement_id
                WHERE ua2.user_id = u.id) AS achievement_points
         FROM users u JOIN user_achievements ua ON ua.user_id = u.id
        GROUP BY u.id ORDER BY achievement_count DESC, achievement_points DESC LIMIT 50`,
    );
    return { items: items.map((item, index) => ({ ...item, rank: index + 1 })) };
  });

  /* ------------------------------------------------------- 管理员：增删改 */
  app.get('/api/admin/achievements', async (request) => {
    requireAdmin(request);
    const items = all<any>(
      `SELECT a.*, (SELECT COUNT(*) FROM user_achievements ua WHERE ua.achievement_id = a.id) AS holder_count
         FROM achievements a ORDER BY a.sort ASC, a.id ASC`,
    );
    return {
      items: items.map((item) => ({ ...item, conditionParsed: parseCondition(item.condition) })),
      stats: {
        total: items.length,
        active: items.filter((item) => item.is_active).length,
        unlocked: count('SELECT COUNT(*) AS c FROM user_achievements'),
      },
    };
  });

  app.post('/api/admin/achievements', async (request) => {
    requireAdmin(request);
    const body = (request.body ?? {}) as any;
    const code = String(body.code ?? '').trim() || `custom_${Date.now().toString(36)}`;
    if (get('SELECT id FROM achievements WHERE code = ?', [code])) throw conflict('成就代码已存在');
    const name = String(body.name ?? '').trim();
    if (!name) throw badRequest('请填写成就名称');
    const condition = typeof body.condition === 'string' ? body.condition : JSON.stringify(body.condition ?? {});
    try {
      JSON.parse(condition);
    } catch {
      throw badRequest('成就条件必须是合法的 JSON');
    }
    const info = run(
      `INSERT INTO achievements (code, name, description, icon, category, rarity, condition, points, is_active, is_builtin, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        code,
        name,
        String(body.description ?? ''),
        String(body.icon ?? '🏅'),
        String(body.category ?? 'milestone'),
        String(body.rarity ?? 'common'),
        condition,
        Number(body.points ?? 0) || 0,
        body.isActive === false ? 0 : 1,
        Number(body.sort ?? 100) || 100,
      ],
    );
    audit(request, 'achievement.create', { targetType: 'achievement', targetId: Number(info.lastInsertRowid) });
    return { ok: true, id: Number(info.lastInsertRowid) };
  });

  app.put('/api/admin/achievements/:id', async (request) => {
    requireAdmin(request);
    const id = parseId((request.params as any).id);
    const body = (request.body ?? {}) as any;
    const row = get<any>('SELECT * FROM achievements WHERE id = ?', [id]);
    if (!row) throw notFound('成就不存在');
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const key of ['name', 'description', 'icon', 'category', 'rarity']) {
      if (body[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(String(body[key]));
      }
    }
    if (body.condition !== undefined) {
      const condition = typeof body.condition === 'string' ? body.condition : JSON.stringify(body.condition);
      try {
        JSON.parse(condition);
      } catch {
        throw badRequest('成就条件必须是合法的 JSON');
      }
      fields.push('condition = ?');
      values.push(condition);
    }
    if (body.points !== undefined) {
      fields.push('points = ?');
      values.push(Number(body.points) || 0);
    }
    if (body.sort !== undefined) {
      fields.push('sort = ?');
      values.push(Number(body.sort) || 0);
    }
    if (body.isActive !== undefined) {
      fields.push('is_active = ?');
      values.push(body.isActive ? 1 : 0);
    }
    if (fields.length) run(`UPDATE achievements SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    audit(request, 'achievement.update', { targetType: 'achievement', targetId: id });
    return { ok: true };
  });

  app.delete('/api/admin/achievements/:id', async (request) => {
    requireAdmin(request);
    const id = parseId((request.params as any).id);
    run('DELETE FROM achievements WHERE id = ?', [id]);
    audit(request, 'achievement.delete', { targetType: 'achievement', targetId: id });
    return { ok: true };
  });

  /** Manually grant an achievement to a user. */
  app.post('/api/admin/achievements/:id/grant', async (request) => {
    requireAdmin(request);
    const id = parseId((request.params as any).id);
    const body = (request.body ?? {}) as any;
    const achievement = get<any>('SELECT * FROM achievements WHERE id = ?', [id]);
    if (!achievement) throw notFound('成就不存在');
    const target = body.userId
      ? get<any>('SELECT id, username FROM users WHERE id = ?', [Number(body.userId)])
      : get<any>('SELECT id, username FROM users WHERE username = ?', [String(body.username ?? '')]);
    if (!target) throw notFound('用户不存在');
    run('INSERT OR IGNORE INTO user_achievements (user_id, achievement_id, context) VALUES (?, ?, ?)', [
      target.id,
      id,
      'manual',
    ]);
    audit(request, 'achievement.grant', {
      targetType: 'achievement',
      targetId: id,
      detail: { username: target.username },
    });
    return { ok: true, username: target.username };
  });
}
