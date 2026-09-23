/**
 * Achievement (badge) engine.
 *
 * Every badge declares a machine-readable condition, for example
 *   {"type":"solved_count","threshold":50}
 * and the engine evaluates all active definitions for a user whenever
 * something meaningful happens (AC, contest, hack, post, purchase, ...).
 */
import { all, count, get, run, tx } from '../db/index.js';
import { addPoints } from './points.js';
import { sendMessage } from './notify.js';
import { bool } from '../settings/index.js';

export interface AchievementCondition {
  type: string;
  threshold?: number;
  value?: string;
}

export interface AchievementStats {
  solvedCount: number;
  acceptedCount: number;
  submissionCount: number;
  points: number;
  registerDays: number;
  contestCount: number;
  firstBloods: number;
  solutionCount: number;
  articleCount: number;
  discussionCount: number;
  replyCount: number;
  hackCount: number;
  hackSuccessCount: number;
  orderCount: number;
  maxDifficulty: number;
  bestDaySolved: number;
  nightOwl: boolean;
  earlyBird: boolean;
  teamCount: number;
  oauthCount: number;
  perfectScore: boolean;
}

export function collectStats(userId: number): AchievementStats {
  const user = get<any>(
    `SELECT solved_count, accepted_count, submission_count, points, contest_count,
            julianday('now') - julianday(created_at) AS days
       FROM users WHERE id = ?`,
    [userId],
  );
  const firstBloods = count(
    `SELECT COUNT(*) AS c FROM user_problem_stats s
      WHERE s.user_id = ? AND s.accepted > 0 AND s.first_ac_at IS NOT NULL
        AND s.first_ac_at <= COALESCE((
              SELECT MIN(s2.first_ac_at) FROM user_problem_stats s2
               WHERE s2.problem_id = s.problem_id AND s2.accepted > 0 AND s2.first_ac_at IS NOT NULL), s.first_ac_at)
        AND NOT EXISTS (
              SELECT 1 FROM user_problem_stats s3
               WHERE s3.problem_id = s.problem_id AND s3.accepted > 0
                 AND s3.first_ac_at IS NOT NULL AND s3.first_ac_at < s.first_ac_at)`,
    [userId],
  );
  const maxDifficulty = Number(
    get<{ d: number | null }>(
      `SELECT MAX(p.difficulty) AS d FROM user_problem_stats s
         JOIN problems p ON p.id = s.problem_id
        WHERE s.user_id = ? AND s.accepted > 0`,
      [userId],
    )?.d ?? 0,
  );
  const bestDaySolved = Number(
    get<{ c: number | null }>(
      `SELECT MAX(c) AS c FROM (
         SELECT COUNT(*) AS c FROM user_problem_stats
          WHERE user_id = ? AND accepted > 0 AND first_ac_at IS NOT NULL
          GROUP BY date(first_ac_at))`,
      [userId],
    )?.c ?? 0,
  );
  const nightOwl = Boolean(
    get(
      `SELECT 1 AS x FROM submissions WHERE user_id = ? AND status = 'AC'
        AND CAST(strftime('%H', created_at) AS INTEGER) BETWEEN 0 AND 4 LIMIT 1`,
      [userId],
    ),
  );
  const earlyBird = Boolean(
    get(
      `SELECT 1 AS x FROM submissions WHERE user_id = ? AND status = 'AC'
        AND CAST(strftime('%H', created_at) AS INTEGER) BETWEEN 5 AND 7 LIMIT 1`,
      [userId],
    ),
  );
  return {
    solvedCount: Number(user?.solved_count ?? 0),
    acceptedCount: Number(user?.accepted_count ?? 0),
    submissionCount: Number(user?.submission_count ?? 0),
    points: Number(user?.points ?? 0),
    registerDays: Math.floor(Number(user?.days ?? 0)),
    contestCount: Number(user?.contest_count ?? 0),
    firstBloods,
    solutionCount: count('SELECT COUNT(*) AS c FROM solutions WHERE author_id = ? AND is_deleted = 0', [userId]),
    articleCount: count('SELECT COUNT(*) AS c FROM articles WHERE author_id = ? AND is_deleted = 0', [userId]),
    discussionCount: count('SELECT COUNT(*) AS c FROM discussions WHERE author_id = ? AND is_deleted = 0', [userId]),
    replyCount: count('SELECT COUNT(*) AS c FROM discussion_replies WHERE author_id = ? AND is_deleted = 0', [userId]),
    hackCount: count('SELECT COUNT(*) AS c FROM hacks WHERE hacker_id = ?', [userId]),
    hackSuccessCount: count(`SELECT COUNT(*) AS c FROM hacks WHERE hacker_id = ? AND verdict = 'success'`, [userId]),
    orderCount: count(`SELECT COUNT(*) AS c FROM shop_orders WHERE user_id = ? AND status IN ('approved','completed')`, [userId]),
    maxDifficulty,
    bestDaySolved,
    nightOwl,
    earlyBird,
    teamCount: count('SELECT COUNT(*) AS c FROM team_members WHERE user_id = ?', [userId]),
    oauthCount: count('SELECT COUNT(*) AS c FROM oauth_accounts WHERE user_id = ?', [userId]),
    perfectScore: Boolean(
      get(
        `SELECT 1 AS x FROM submissions WHERE user_id = ? AND status = 'AC' AND score >= 100 LIMIT 1`,
        [userId],
      ),
    ),
  };
}

export function conditionValue(condition: AchievementCondition, stats: AchievementStats): number {
  const flag = (value: boolean) => (value ? 1 : 0);
  switch (condition.type) {
    case 'solved_count':
      return stats.solvedCount;
    case 'accepted_count':
      return stats.acceptedCount;
    case 'submission_count':
      return stats.submissionCount;
    case 'points':
      return stats.points;
    case 'register_days':
      return stats.registerDays;
    case 'contest_count':
      return stats.contestCount;
    case 'first_blood':
      return stats.firstBloods;
    case 'solution_count':
      return stats.solutionCount;
    case 'article_count':
      return stats.articleCount;
    case 'discussion_count':
      return stats.discussionCount;
    case 'reply_count':
      return stats.replyCount;
    case 'hack_count':
      return stats.hackCount;
    case 'hack_success':
      return stats.hackSuccessCount;
    case 'shop_order':
      return stats.orderCount;
    case 'difficulty_clear':
      return stats.maxDifficulty;
    case 'day_solved':
      return stats.bestDaySolved;
    case 'team_count':
      return stats.teamCount;
    case 'oauth_bound':
      return stats.oauthCount;
    case 'night_owl':
      return flag(stats.nightOwl);
    case 'early_bird':
      return flag(stats.earlyBird);
    case 'perfect_score':
      return flag(stats.perfectScore);
    default:
      return 0;
  }
}

export interface AchievementRow {
  id: number;
  code: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  rarity: string;
  condition: string;
  points: number;
  is_active: number;
  sort: number;
}

export function parseCondition(raw: string): AchievementCondition {
  try {
    const parsed = JSON.parse(raw || '{}');
    return typeof parsed === 'object' && parsed ? (parsed as AchievementCondition) : { type: 'unknown' };
  } catch {
    return { type: 'unknown' };
  }
}

export function isUnlocked(condition: AchievementCondition, stats: AchievementStats): boolean {
  const target = Number(condition.threshold ?? 1);
  return conditionValue(condition, stats) >= target;
}

/**
 * Evaluate every active badge for a user and unlock the ones whose condition is
 * now satisfied. Returns the list of newly unlocked achievements.
 */
export function evaluateAchievements(
  userId: number,
  options: { silent?: boolean } = {},
): AchievementRow[] {
  if (!bool('achievement_enable', true)) return [];
  const unlocked = new Set(
    all<{ achievement_id: number }>('SELECT achievement_id FROM user_achievements WHERE user_id = ?', [
      userId,
    ]).map((row) => row.achievement_id),
  );
  const definitions = all<AchievementRow>(
    'SELECT * FROM achievements WHERE is_active = 1 ORDER BY sort ASC, id ASC',
  );
  const pending = definitions.filter(
    (definition) => !unlocked.has(definition.id) && isUnlocked(parseCondition(definition.condition), collectStats(userId)),
  );
  if (!pending.length) return [];

  // Stats are collected once; conditions above already matched against them.
  const stats = collectStats(userId);
  const newly: AchievementRow[] = [];
  tx(() => {
    for (const definition of pending) {
      const condition = parseCondition(definition.condition);
      if (!isUnlocked(condition, stats)) continue;
      run(
        `INSERT OR IGNORE INTO user_achievements (user_id, achievement_id, context) VALUES (?, ?, ?)`,
        [userId, definition.id, condition.type],
      );
      if (definition.points > 0 && bool('enable_points', true)) {
        addPoints(userId, definition.points, `解锁成就「${definition.name}」`, {
          refType: 'achievement',
          refId: definition.id,
        });
      }
      newly.push(definition);
    }
  });

  if (!options.silent && bool('achievement_notify', true)) {
    for (const achievement of newly) {
      sendMessage({
        to: userId,
        title: `${achievement.icon} 解锁成就：${achievement.name}`,
        content: `${achievement.description}${achievement.points > 0 ? `\n\n奖励 ${achievement.points} 积分。` : ''}`,
        type: 'system',
        refType: 'achievement',
        refId: achievement.id,
      });
    }
  }
  return newly;
}

export interface AchievementWithState extends AchievementRow {
  conditionParsed: AchievementCondition;
  unlocked: boolean;
  unlockedAt: string | null;
  progress: number;
  target: number;
  holderCount: number;
}

export function achievementsForUser(userId: number): AchievementWithState[] {
  const stats = collectStats(userId);
  const unlockedRows = all<{ achievement_id: number; unlocked_at: string }>(
    'SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = ?',
    [userId],
  );
  const unlockedMap = new Map(unlockedRows.map((row) => [row.achievement_id, row.unlocked_at]));
  const holders = new Map(
    all<{ achievement_id: number; c: number }>(
      'SELECT achievement_id, COUNT(*) AS c FROM user_achievements GROUP BY achievement_id',
    ).map((row) => [row.achievement_id, row.c]),
  );
  return all<AchievementRow>('SELECT * FROM achievements WHERE is_active = 1 ORDER BY sort ASC, id ASC').map(
    (row) => {
      const condition = parseCondition(row.condition);
      return {
        ...row,
        conditionParsed: condition,
        unlocked: unlockedMap.has(row.id),
        unlockedAt: unlockedMap.get(row.id) ?? null,
        progress: conditionValue(condition, stats),
        target: Number(condition.threshold ?? 1),
        holderCount: holders.get(row.id) ?? 0,
      };
    },
  );
}

export const BUILTIN_ACHIEVEMENTS: {
  code: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  rarity: string;
  condition: AchievementCondition;
  points: number;
  sort: number;
}[] = [
  { code: 'first_ac', name: '初次通过', description: '通过第一道题目，正式踏上 OI 之路。', icon: '🌟', category: 'milestone', rarity: 'common', condition: { type: 'solved_count', threshold: 1 }, points: 2, sort: 1 },
  { code: 'solved_5', name: '小试牛刀', description: '累计通过 5 道题目。', icon: '🥉', category: 'milestone', rarity: 'common', condition: { type: 'solved_count', threshold: 5 }, points: 5, sort: 2 },
  { code: 'solved_20', name: '渐入佳境', description: '累计通过 20 道题目。', icon: '🥈', category: 'milestone', rarity: 'common', condition: { type: 'solved_count', threshold: 20 }, points: 10, sort: 3 },
  { code: 'solved_50', name: '勤学苦练', description: '累计通过 50 道题目。', icon: '🥇', category: 'milestone', rarity: 'rare', condition: { type: 'solved_count', threshold: 50 }, points: 20, sort: 4 },
  { code: 'solved_100', name: '百题斩', description: '累计通过 100 道题目。', icon: '💯', category: 'milestone', rarity: 'rare', condition: { type: 'solved_count', threshold: 100 }, points: 50, sort: 5 },
  { code: 'solved_300', name: '题海行者', description: '累计通过 300 道题目。', icon: '🌊', category: 'milestone', rarity: 'epic', condition: { type: 'solved_count', threshold: 300 }, points: 120, sort: 6 },
  { code: 'solved_700', name: '登峰造极', description: '累计通过 700 道题目。', icon: '🏔️', category: 'milestone', rarity: 'legendary', condition: { type: 'solved_count', threshold: 700 }, points: 300, sort: 7 },
  { code: 'difficulty_5', name: '挑战省选', description: '通过一道难度达到「提高+/省选−」及以上的题目。', icon: '⚔️', category: 'skill', rarity: 'rare', condition: { type: 'difficulty_clear', threshold: 5 }, points: 15, sort: 8 },
  { code: 'difficulty_6', name: '省选选手', description: '通过一道「省选/NOI−」或更难的题目。', icon: '🐉', category: 'skill', rarity: 'epic', condition: { type: 'difficulty_clear', threshold: 6 }, points: 40, sort: 9 },
  { code: 'difficulty_7', name: '征服 NOI', description: '通过一道「NOI/NOI+/CTSC」级别的题目。', icon: '👑', category: 'skill', rarity: 'legendary', condition: { type: 'difficulty_clear', threshold: 7 }, points: 100, sort: 10 },
  { code: 'first_blood_1', name: '一血猎人', description: '拿到一次全站首杀。', icon: '🩸', category: 'skill', rarity: 'rare', condition: { type: 'first_blood', threshold: 1 }, points: 10, sort: 11 },
  { code: 'first_blood_10', name: '首杀大师', description: '累计拿到 10 次全站首杀。', icon: '🗡️', category: 'skill', rarity: 'epic', condition: { type: 'first_blood', threshold: 10 }, points: 60, sort: 12 },
  { code: 'hack_1', name: '第一位猎人', description: '成功 Hack 一次他人的提交。', icon: '🏹', category: 'skill', rarity: 'rare', condition: { type: 'hack_success', threshold: 1 }, points: 15, sort: 13 },
  { code: 'hack_10', name: '造数据专家', description: '成功 Hack 10 次，让假算法无处遁形。', icon: '🧪', category: 'skill', rarity: 'epic', condition: { type: 'hack_success', threshold: 10 }, points: 80, sort: 14 },
  { code: 'contest_1', name: '初次登场', description: '参加第一场比赛。', icon: '🎫', category: 'contest', rarity: 'common', condition: { type: 'contest_count', threshold: 1 }, points: 5, sort: 15 },
  { code: 'contest_10', name: '赛场常客', description: '累计参加 10 场比赛。', icon: '🏟️', category: 'contest', rarity: 'rare', condition: { type: 'contest_count', threshold: 10 }, points: 30, sort: 16 },
  { code: 'contest_30', name: '比赛狂人', description: '累计参加 30 场比赛。', icon: '🎖️', category: 'contest', rarity: 'epic', condition: { type: 'contest_count', threshold: 30 }, points: 90, sort: 17 },
  { code: 'solution_1', name: '授人以渔', description: '发布第一篇题解。', icon: '📝', category: 'community', rarity: 'common', condition: { type: 'solution_count', threshold: 1 }, points: 5, sort: 18 },
  { code: 'solution_20', name: '题解作者', description: '累计发布 20 篇题解。', icon: '📚', category: 'community', rarity: 'rare', condition: { type: 'solution_count', threshold: 20 }, points: 40, sort: 19 },
  { code: 'article_5', name: '专栏作家', description: '累计发布 5 篇文章。', icon: '✍️', category: 'community', rarity: 'rare', condition: { type: 'article_count', threshold: 5 }, points: 30, sort: 20 },
  { code: 'discussion_10', name: '社区活跃者', description: '发布 10 个讨论帖。', icon: '💬', category: 'community', rarity: 'common', condition: { type: 'discussion_count', threshold: 10 }, points: 20, sort: 21 },
  { code: 'reply_50', name: '热心解答', description: '累计回复 50 次。', icon: '🤝', category: 'community', rarity: 'rare', condition: { type: 'reply_count', threshold: 50 }, points: 30, sort: 22 },
  { code: 'points_500', name: '积分富豪', description: '积分达到 500。', icon: '💰', category: 'special', rarity: 'epic', condition: { type: 'points', threshold: 500 }, points: 0, sort: 23 },
  { code: 'shop_1', name: '兑换达人', description: '在商店成功兑换一次商品。', icon: '🛒', category: 'special', rarity: 'common', condition: { type: 'shop_order', threshold: 1 }, points: 5, sort: 24 },
  { code: 'night_owl', name: '夜猫子', description: '在凌晨 0-5 点通过一道题目。', icon: '🦉', category: 'special', rarity: 'rare', condition: { type: 'night_owl', threshold: 1 }, points: 10, sort: 25 },
  { code: 'early_bird', name: '早起鸟', description: '在清晨 5-8 点通过一道题目。', icon: '🐦', category: 'special', rarity: 'rare', condition: { type: 'early_bird', threshold: 1 }, points: 10, sort: 26 },
  { code: 'day_5', name: '爆发的一天', description: '单日通过 5 道题目。', icon: '🚀', category: 'special', rarity: 'rare', condition: { type: 'day_solved', threshold: 5 }, points: 20, sort: 27 },
  { code: 'team_1', name: '并肩作战', description: '加入一个团队。', icon: '🧑‍🤝‍🧑', category: 'special', rarity: 'common', condition: { type: 'team_count', threshold: 1 }, points: 5, sort: 28 },
  { code: 'oauth_bound', name: '快捷登录', description: '绑定一个第三方账号。', icon: '🔗', category: 'special', rarity: 'common', condition: { type: 'oauth_bound', threshold: 1 }, points: 5, sort: 29 },
  { code: 'veteran', name: 'OGOJ 元老', description: '注册满 365 天。', icon: '🏛️', category: 'special', rarity: 'legendary', condition: { type: 'register_days', threshold: 365 }, points: 200, sort: 30 },
];

/** Insert the built-in badge definitions (idempotent). */
export function seedAchievements(): number {
  let created = 0;
  for (const badge of BUILTIN_ACHIEVEMENTS) {
    const existing = get<{ id: number }>('SELECT id FROM achievements WHERE code = ?', [badge.code]);
    if (existing) continue;
    run(
      `INSERT INTO achievements (code, name, description, icon, category, rarity, condition, points, is_active, is_builtin, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`,
      [
        badge.code,
        badge.name,
        badge.description,
        badge.icon,
        badge.category,
        badge.rarity,
        JSON.stringify(badge.condition),
        badge.points,
        badge.sort,
      ],
    );
    created += 1;
  }
  return created;
}
