/**
 * Seed the database with the default super administrator and a set of demo
 * content so a fresh deployment is immediately usable.
 *
 *   npm run seed          # create missing data (keeps existing records)
 *   npm run reset         # wipe everything and seed again
 */
import fs from 'node:fs';
import { config } from '../config.js';
import { all, count, db, get, migrate, run, tx } from './index.js';
import { hashPassword } from '../lib/crypto.js';
import { addPoints } from '../lib/points.js';
import { saveTestcase } from '../lib/storage.js';
import { invalidateSettings } from '../settings/index.js';
import { evaluateAchievements, seedAchievements } from '../lib/achievements.js';

interface ProblemSeed {
  pid: string;
  title: string;
  difficulty: number;
  provider: string;
  tags: string[];
  background?: string;
  statement: string;
  inputFormat: string;
  outputFormat: string;
  hint?: string;
  timeLimit?: number;
  memoryLimit?: number;
  judgeMode?: 'standard' | 'spj' | 'interactive';
  spjCode?: string;
  samples: { input: string; output: string; explanation?: string }[];
  subtasks?: { id: number; score: number; cases: number[]; method?: 'min' | 'sum'; deps?: number[] }[];
  testcases: { input: string; output: string; score?: number; subtask?: number }[];
}

/**
 * Keep the *credentials* of the default administrator out of the site content.
 *
 * The account itself is a perfectly normal user as far as visitors are
 * concerned - what must never show up in the site is the announcement telling
 * everyone that "the super administrator is <name> / <password>".
 */
function cleanDefaultAdminTraces(): void {
  const username = config.seed.rootUsername;
  for (const phrase of [
    `默认超级管理员账号为 \`${username}\`，请首次登录后立即修改密码。`,
    '默认超级管理员账号为 `root`，请首次登录后立即修改密码。',
  ]) {
    run('UPDATE announcements SET content = REPLACE(content, ?, ?)', [
      phrase,
      '如需反馈问题，可以随时提交工单，管理员会尽快处理。',
    ]);
  }
  // Restore the account name/email if an earlier build anonymised them.
  run(`UPDATE users SET display_name = username WHERE username = ? AND display_name = '站长'`, [username]);
  run(`UPDATE users SET email = ? WHERE username = ? AND email = 'webmaster@ogoj.local'`, [
    `${username}@ogoj.local`,
    username,
  ]);
  run(`UPDATE audit_logs SET actor_name = ? WHERE actor_name = '站长'`, [username]);
  // Older seeds described these accounts by their staff role in the bio, which
  // already told every visitor who the administrators were.
  run(`UPDATE users SET bio = ? WHERE username = ? AND bio = 'OGOJ 系统管理员。'`, [
    '欢迎来到 OGOJ，祝你刷题愉快。',
    username,
  ]);
  run(`UPDATE users SET bio = ? WHERE username = 'admin' AND bio = '题目管理员。'`, ['喜欢出题与维护题库。']);
}

const TAGS: { name: string; color: string; category: string }[] = [
  { name: '模拟', color: '#60a5fa', category: '基础算法' },
  { name: '枚举', color: '#38bdf8', category: '基础算法' },
  { name: '字符串', color: '#22d3ee', category: '字符串' },
  { name: '动态规划', color: '#a78bfa', category: '动态规划' },
  { name: '贪心', color: '#f472b6', category: '基础算法' },
  { name: '图论', color: '#34d399', category: '图论' },
  { name: '数据结构', color: '#fbbf24', category: '数据结构' },
  { name: '数学', color: '#fb7185', category: '数学' },
  { name: '二分', color: '#818cf8', category: '基础算法' },
  { name: '前缀和', color: '#4ade80', category: '基础算法' },
  { name: 'Special Judge', color: '#f97316', category: '评测' },
  { name: '子任务', color: '#e879f9', category: '评测' },
];

const PROBLEMS: ProblemSeed[] = [
  {
    pid: 'P1001',
    title: 'A+B Problem',
    difficulty: 1,
    provider: 'OGOJ 原创',
    tags: ['模拟', '数学'],
    background: '这是 OGOJ 的第一道题目，用来验证你的评测环境是否正常。',
    statement:
      '输入两个整数 $a$ 和 $b$，输出它们的和。\n\n注意 $a$ 和 $b$ 的绝对值可能达到 $10^9$，请使用 64 位整数类型。',
    inputFormat: '一行两个整数 $a, b$，用空格分隔。',
    outputFormat: '一行一个整数，表示 $a + b$。',
    hint: '$$a + b = b + a$$',
    samples: [
      { input: '1 2', output: '3', explanation: '$1 + 2 = 3$。' },
      { input: '-5 8', output: '3' },
    ],
    testcases: [
      { input: '1 2\n', output: '3\n' },
      { input: '-5 8\n', output: '3\n' },
      { input: '1000000000 1000000000\n', output: '2000000000\n' },
      { input: '-1000000000 -1000000000\n', output: '-2000000000\n' },
      { input: '0 0\n', output: '0\n' },
    ],
  },
  {
    pid: 'P1002',
    title: '回文串判断',
    difficulty: 2,
    provider: 'OGOJ 原创',
    tags: ['字符串', '模拟'],
    statement:
      '给定一个只包含小写字母的字符串 $s$，判断它是否是回文串。\n\n回文串的定义是正着读和倒着读完全相同的字符串。',
    inputFormat: '一行一个字符串 $s$，长度不超过 $10^5$。',
    outputFormat: '如果 $s$ 是回文串输出 `Yes`，否则输出 `No`。',
    samples: [
      { input: 'abcba', output: 'Yes' },
      { input: 'abca', output: 'No' },
    ],
    testcases: [
      { input: 'abcba\n', output: 'Yes\n' },
      { input: 'abca\n', output: 'No\n' },
      { input: 'a\n', output: 'Yes\n' },
      { input: 'abccba\n', output: 'Yes\n' },
      { input: 'abcdef\n', output: 'No\n' },
    ],
  },
  {
    pid: 'P1003',
    title: '最大子段和',
    difficulty: 3,
    provider: '经典问题',
    tags: ['动态规划', '前缀和'],
    statement:
      '给定一个长度为 $n$ 的整数序列 $a_1, a_2, \\dots, a_n$，请找出一个连续的子段，使得这个子段内所有数字之和最大。\n\n如果所有数字都是负数，答案就是最大的单个数字。',
    inputFormat: '第一行一个整数 $n$（$1 \\le n \\le 2 \\times 10^5$）。\n\n第二行 $n$ 个整数 $a_i$（$|a_i| \\le 10^4$）。',
    outputFormat: '一行一个整数，表示最大的子段和。',
    samples: [
      { input: '5\n1 -2 3 4 -1', output: '7', explanation: '选择子段 $[3, 4, -1]$，和为 $6$；选择 $[3,4]$ 和为 $7$，这是最优解。' },
      { input: '4\n-1 -2 -3 -4', output: '-1' },
    ],
    subtasks: [
      { id: 1, score: 40, cases: [1, 2] },
      { id: 2, score: 60, cases: [3, 4, 5, 6], method: 'min', deps: [1] },
    ],
    testcases: [
      { input: '5\n1 -2 3 4 -1\n', output: '7\n', score: 20, subtask: 1 },
      { input: '4\n-1 -2 -3 -4\n', output: '-1\n', score: 20, subtask: 1 },
      { input: '1\n0\n', output: '0\n', score: 15, subtask: 2 },
      { input: '8\n5 -1 5 -1 5 -1 5 -1\n', output: '17\n', score: 15, subtask: 2 },
      { input: '6\n-2 11 -4 13 -5 2\n', output: '20\n', score: 15, subtask: 2 },
      { input: '10\n-1 2 3 -4 5 6 -7 8 9 -10\n', output: '22\n', score: 15, subtask: 2 },
    ],
  },
  {
    pid: 'P1004',
    title: '连通块计数',
    difficulty: 4,
    provider: 'OGOJ 原创',
    tags: ['图论', '数据结构'],
    statement:
      '给定一张 $n$ 个点 $m$ 条边的无向图（可能含有重边和自环），请统计图中连通块的个数。',
    inputFormat:
      '第一行两个整数 $n, m$（$1 \\le n \\le 10^5$，$0 \\le m \\le 2 \\times 10^5$）。\n\n接下来 $m$ 行，每行两个整数 $u, v$，表示一条连接 $u$ 与 $v$ 的边。',
    outputFormat: '一行一个整数，表示连通块个数。',
    samples: [
      { input: '5 3\n1 2\n2 3\n4 5', output: '2' },
      { input: '3 0', output: '3' },
    ],
    testcases: [
      { input: '5 3\n1 2\n2 3\n4 5\n', output: '2\n' },
      { input: '3 0\n', output: '3\n' },
      { input: '1 1\n1 1\n', output: '1\n' },
      { input: '6 6\n1 2\n2 3\n3 1\n4 5\n5 6\n6 4\n', output: '2\n' },
      { input: '4 5\n1 2\n2 1\n3 4\n4 3\n1 1\n', output: '2\n' },
    ],
  },
  {
    pid: 'P1005',
    title: '输出任意一组解',
    difficulty: 3,
    provider: 'OGOJ 原创',
    tags: ['Special Judge', '枚举'],
    statement:
      '给定 $n$ 和 $s$，请找出两个非负整数 $x, y$，满足 $x + y = s$ 且 $x \\times y$ 尽可能大。\n\n你只需要输出**任意一组**最优解。本题使用 Special Judge 评测。',
    inputFormat: '一行两个整数 $n$（占位，恒为 2）和 $s$（$0 \\le s \\le 10^9$）。',
    outputFormat: '一行两个整数 $x, y$，用空格分隔。',
    hint: '当 $x$ 与 $y$ 尽量接近时乘积最大。',
    judgeMode: 'spj',
    spjCode: `// OGOJ Special Judge 示例
// argv[1] = 输入文件, argv[2] = 选手输出, argv[3] = 标准答案
// 返回 0 表示通过，非 0 表示不通过；也可以输出 "score: x" 给出部分分。
#include <bits/stdc++.h>
using namespace std;

int main(int argc, char** argv) {
    if (argc < 4) return 3;                       // 参数不足，评测机将判定为系统错误
    ifstream fin(argv[1]), fout(argv[2]);
    if (!fin || !fout) return 3;

    long long n = 0, s = 0;
    if (!(fin >> n >> s)) return 3;

    long long x = -1, y = -1;
    if (!(fout >> x >> y)) {                       // 输出格式不符合要求
        cout << "无法从选手输出中读取两个整数" << endl;
        return 1;
    }
    if (x < 0 || y < 0) {
        cout << "x 和 y 必须是非负整数" << endl;
        return 1;
    }
    if (x + y != s) {
        cout << "x + y = " << x + y << "，但要求等于 " << s << endl;
        return 1;
    }
    long long best = (s / 2) * (s - s / 2);        // 最优乘积
    if (x * y < best) {
        cout << "乘积不是最优的: " << x * y << " < " << best << endl;
        return 1;
    }
    cout << "accepted, product = " << x * y << endl;
    return 0;
}
`,
    samples: [
      { input: '2 10', output: '5 5', explanation: '$5 + 5 = 10$，乘积为 $25$，是最优解。' },
    ],
    testcases: [
      { input: '2 10\n', output: '5 5\n' },
      { input: '2 7\n', output: '3 4\n' },
      { input: '2 0\n', output: '0 0\n' },
      { input: '2 1000000000\n', output: '500000000 500000000\n' },
    ],
  },
];

function insertSettingsDefaults(): void {
  // settings are read with defaults; this only records the current values so
  // the control panel shows something on a fresh install.
  run(`INSERT INTO settings (key, value) SELECT 'site_name', 'OGOJ'
       WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'site_name')`);
}

async function seedUsers(): Promise<Record<string, number>> {
  const password = config.seed.rootPassword;
  const hash = await hashPassword(password);
  const users: { username: string; email: string; role: string; bio: string; school: string }[] = [
    {
      username: config.seed.rootUsername,
      email: config.seed.rootEmail,
      role: 'superadmin',
      bio: '欢迎来到 OGOJ，祝你刷题愉快。',
      school: 'OGOJ',
    },
    { username: 'admin', email: 'admin@ogoj.local', role: 'admin', bio: '喜欢出题与维护题库。', school: 'OGOJ' },
    { username: 'alice', email: 'alice@ogoj.local', role: 'user', bio: '正在学习动态规划。', school: '示例中学' },
    { username: 'bob', email: 'bob@ogoj.local', role: 'user', bio: '喜欢图论与数据结构。', school: '样例大学' },
    { username: 'carol', email: 'carol@ogoj.local', role: 'user', bio: 'OGOJ 新人，请多指教。', school: '' },
  ];

  const ids: Record<string, number> = {};
  for (const user of users) {
    const existing = get<{ id: number }>('SELECT id FROM users WHERE username = ?', [user.username]);
    if (existing) {
      ids[user.username] = existing.id;
      if (user.role === 'superadmin') {
        run('UPDATE users SET role = ?, password_hash = ? WHERE id = ?', ['superadmin', hash, existing.id]);
      }
      continue;
    }
    const info = run(
      `INSERT INTO users (username, email, password_hash, role, display_name, bio, school, points)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [user.username, user.email, hash, user.role, user.username, user.bio, user.school, 0],
    );
    ids[user.username] = Number(info.lastInsertRowid);
  }
  return ids;
}

function seedTags(): Map<string, number> {
  const map = new Map<string, number>();
  for (const tag of TAGS) {
    const existing = get<{ id: number }>('SELECT id FROM tags WHERE name = ?', [tag.name]);
    if (existing) {
      map.set(tag.name, existing.id);
      continue;
    }
    const info = run('INSERT INTO tags (name, color, category) VALUES (?, ?, ?)', [
      tag.name,
      tag.color,
      tag.category,
    ]);
    map.set(tag.name, Number(info.lastInsertRowid));
  }
  return map;
}

function seedProblems(authorId: number, tagIds: Map<string, number>): number[] {
  const created: number[] = [];
  for (const problem of PROBLEMS) {
    const existing = get<{ id: number }>('SELECT id FROM problems WHERE pid = ?', [problem.pid]);
    if (existing) {
      created.push(existing.id);
      continue;
    }
    const info = run(
      `INSERT INTO problems
        (pid, title, background, statement, input_format, output_format, hint, difficulty, author_id, owner_id,
         provider, time_limit, memory_limit, judge_mode, spj_language, spj_code, subtasks, samples,
         allow_languages, source_type, review_status, is_public)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'official', 'approved', 1)`,
      [
        problem.pid,
        problem.title,
        problem.background ?? '',
        problem.statement,
        problem.inputFormat,
        problem.outputFormat,
        problem.hint ?? '',
        problem.difficulty,
        authorId,
        authorId,
        problem.provider,
        problem.timeLimit ?? 1000,
        problem.memoryLimit ?? 256,
        problem.judgeMode ?? 'standard',
        problem.judgeMode === 'spj' ? 'cpp' : '',
        problem.spjCode ?? '',
        JSON.stringify(problem.subtasks ?? []),
        JSON.stringify(problem.samples),
      ],
    );
    const problemId = Number(info.lastInsertRowid);
    created.push(problemId);
    for (const name of problem.tags) {
      const tagId = tagIds.get(name);
      if (tagId) run('INSERT OR IGNORE INTO problem_tags (problem_id, tag_id) VALUES (?, ?)', [problemId, tagId]);
    }
    problem.testcases.forEach((testcase, index) => {
      const saved = saveTestcase(problemId, index + 1, testcase.input, testcase.output);
      run(
        `INSERT INTO testcases (problem_id, idx, subtask_id, score, input_file, output_file, is_sample)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          problemId,
          index + 1,
          testcase.subtask ?? 0,
          testcase.score ?? Math.floor(100 / problem.testcases.length),
          saved.inputFile,
          saved.outputFile,
          index < problem.samples.length ? 1 : 0,
        ],
      );
    });
    // mark solved counts realistically (nobody has submitted yet)
    run('UPDATE problems SET submit_count = 0, accepted_count = 0 WHERE id = ?', [problemId]);
  }

  return created;
}

function seedContests(ownerId: number, problemIds: number[]): void {
  const now = Date.now();
  const fmt = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
  const contests = [
    {
      title: 'OGOJ 新手赛 #1',
      subtitle: '面向新手的入门比赛',
      description:
        '## 比赛说明\n\n欢迎参加 OGOJ 新手赛！本场比赛包含 2 道入门题目，适合刚接触 OJ 的同学。\n\n- 赛制：ACM\n- 时长：3 小时\n- 允许语言：全部',
      rules: 'acm',
      start: fmt(now + 2 * 86400_000),
      end: fmt(now + 2 * 86400_000 + 3 * 3600_000),
      problems: problemIds.slice(0, 2),
    },
    {
      title: 'OGOJ 算法挑战赛 #1',
      subtitle: 'OI 赛制 · 子任务计分',
      description: '## 比赛说明\n\n本场比赛采用 OI 赛制，题目按子任务给分，比赛结束前不显示排行榜。',
      rules: 'oi',
      start: fmt(now - 3600_000),
      end: fmt(now + 4 * 3600_000),
      problems: problemIds.slice(2, 5),
    },
  ];
  for (const contest of contests) {
    if (get('SELECT id FROM contests WHERE title = ?', [contest.title])) continue;
    const info = run(
      `INSERT INTO contests (title, subtitle, description, rules, start_time, end_time, freeze_minutes,
         is_public, need_register, show_rank, rated, origin, owner_id, author_id, review_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1, 'official', ?, ?, 'approved')`,
      [contest.title, contest.subtitle, contest.description, contest.rules, contest.start, contest.end, 0, ownerId, ownerId],
    );
    const contestId = Number(info.lastInsertRowid);
    contest.problems.forEach((problemId, index) => {
      run(
        `INSERT INTO contest_problems (contest_id, problem_id, order_no, label, score) VALUES (?, ?, ?, ?, 100)`,
        [contestId, problemId, index + 1, String.fromCharCode(65 + index)],
      );
    });
  }
}

function seedCommunity(userIds: Record<string, number>, problemIds: number[]): void {
  const boards = [
    { slug: 'general', name: '综合讨论', description: '随便聊聊' },
    { slug: 'algorithm', name: '算法讨论', description: '算法与数据结构' },
    { slug: 'help', name: '求助问答', description: '遇到问题？来这里提问' },
    { slug: 'contest', name: '比赛讨论', description: '比赛相关话题' },
    { slug: 'announce', name: '站务公告', description: '站点相关公告' },
  ];
  for (const board of boards) {
    if (get('SELECT id FROM discussion_boards WHERE slug = ?', [board.slug])) continue;
    run('INSERT INTO discussion_boards (slug, name, description) VALUES (?, ?, ?)', [
      board.slug,
      board.name,
      board.description,
    ]);
  }
  const general = get<{ id: number }>('SELECT id FROM discussion_boards WHERE slug = ?', ['general']);
  const help = get<{ id: number }>('SELECT id FROM discussion_boards WHERE slug = ?', ['help']);

  const posts = [
    {
      boardId: general?.id ?? null,
      authorId: userIds.root,
      title: '欢迎来到 OGOJ！',
      content:
        'OGOJ（Oganesson Online Judge）是一个完全开源的在线评测系统。\n\n**你可以做什么：**\n\n- 在题库中刷题，通过题目获得积分\n- 参加比赛，与其他人一较高下\n- 在商店用积分兑换「创建比赛」「出题」等特权\n- 发布题解与文章，分享你的思路\n\n遇到问题欢迎在本帖回复。',
      replies: [
        { author: userIds.alice, content: '界面很清爽，已经开始刷题啦！' },
        { author: userIds.bob, content: '请问子任务计分是怎么算的？' },
        { author: userIds.root, content: '子任务默认「全对才得分」，管理员也可以在题目设置里改成按测试点累加。' },
      ],
    },
    {
      boardId: help?.id ?? null,
      authorId: userIds.carol,
      title: 'P1003 最大子段和 一直 WA，求助',
      content: '我的做法是枚举所有子段求和，为什么只能拿到部分分？\n\n题目在 [P1003](/problem/P1003)。',
      replies: [
        { author: userIds.bob, content: '枚举所有子段的复杂度是 $O(n^2)$，$n$ 到 $2\\times10^5$ 会超时，试试前缀和 + 贪心。' },
      ],
    },
  ];
  for (const post of posts) {
    if (get('SELECT id FROM discussions WHERE title = ?', [post.title])) continue;
    const info = run(
      `INSERT INTO discussions (board_id, title, content, author_id, reply_count, last_reply_at, last_reply_user_id)
       VALUES (?, ?, ?, ?, ?, datetime('now'), ?)`,
      [post.boardId, post.title, post.content, post.authorId, post.replies.length, post.authorId],
    );
    const discussionId = Number(info.lastInsertRowid);
    post.replies.forEach((reply, index) => {
      run(
        `INSERT INTO discussion_replies (discussion_id, author_id, content, floor) VALUES (?, ?, ?, ?)`,
        [discussionId, reply.author, reply.content, index + 1],
      );
    });
  }

  if (!get('SELECT id FROM articles LIMIT 1')) {
    run(
      `INSERT INTO articles (title, summary, content, category, author_id, is_public)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [
        '从零开始：如何在 OGOJ 上出一套自己的比赛',
        '本文介绍使用积分兑换比赛资格、准备题目、配置赛制与发布比赛的完整流程。',
        '## 一、准备积分\n\n每通过一道题目可以获得积分，攒够之后到 [商店](/shop) 兑换「创建一次比赛」。\n\n## 二、创建比赛\n\n在比赛页面点击「创建比赛」，填写赛制、起止时间与题目列表。\n\n## 三、发布\n\n提交后等待管理员审核，通过后其他用户即可报名参加。',
        '教程',
        userIds.root,
      ],
    );
  }

  if (!get('SELECT id FROM lists LIMIT 1')) {
    const info = run(
      `INSERT INTO lists (title, description, type, difficulty, author_id, is_public)
       VALUES (?, ?, 'official', 2, ?, 1)`,
      ['OGOJ 新手题单', '从 A+B 到图论，循序渐进地掌握基础算法。', userIds.root],
    );
    const listId = Number(info.lastInsertRowid);
    problemIds.slice(0, 4).forEach((problemId, index) => {
      run('INSERT INTO list_problems (list_id, problem_id, order_no, note) VALUES (?, ?, ?, ?)', [
        listId,
        problemId,
        index + 1,
        '',
      ]);
    });
  }

  if (!get('SELECT id FROM teams LIMIT 1')) {
    const info = run(
      `INSERT INTO teams (name, slug, description, owner_id, member_count) VALUES (?, ?, ?, ?, 3)`,
      ['OGOJ 官方团队', 'ogoj-official', 'OGOJ 官方团队，负责题库与比赛的组织。', userIds.root],
    );
    const teamId = Number(info.lastInsertRowid);
    for (const [userId, role] of [
      [userIds.root, 'owner'],
      [userIds.admin, 'admin'],
      [userIds.alice, 'member'],
    ] as [number, string][]) {
      run('INSERT OR IGNORE INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)', [teamId, userId, role]);
    }
    run('INSERT INTO team_announcements (team_id, author_id, title, content) VALUES (?, ?, ?, ?)', [
      teamId,
      userIds.root,
      '团队成立',
      '欢迎加入 OGOJ 官方团队！',
    ]);
  }
}

function seedShop(): void {
  const items = [
    {
      slug: 'create-contest',
      name: '创建一次比赛',
      kind: 'contest',
      icon: 'trophy',
      price: 100,
      description:
        '兑换后可获得一次创建自定义比赛的资格。创建的比赛需要管理员审核，通过后其他用户可以报名参加。\n\n- 自定义赛制（ACM / OI / IOI）\n- 自定义题目与时长\n- 支持密码与报名限制',
      sort: 1,
    },
    {
      slug: 'create-problem',
      name: '出一道题',
      kind: 'problem',
      icon: 'file-plus',
      price: 60,
      description:
        '兑换后可获得一次出题资格。你可以上传测试数据、配置子任务与 Special Judge，审核通过后题目会进入题库。',
      sort: 2,
    },
    {
      slug: 'contest-pack-5',
      name: '比赛资格 ×5',
      kind: 'contest',
      icon: 'package',
      price: 400,
      description: '一次性兑换 5 次创建比赛的资格，比单独兑换更划算。',
      sort: 3,
    },
    {
      slug: 'profile-decoration',
      name: '个人主页装扮',
      kind: 'custom',
      icon: 'sparkles',
      price: 50,
      description: '自定义个人主页背景图与签名档，让你的主页更有个性。管理员审核后生效。',
      sort: 4,
    },
  ];
  for (const item of items) {
    if (get('SELECT id FROM shop_items WHERE slug = ?', [item.slug])) continue;
    run(
      `INSERT INTO shop_items (name, slug, description, icon, price, kind, stock, max_per_user, is_active, sort, payload)
       VALUES (?, ?, ?, ?, ?, ?, -1, 0, 1, ?, ?)`,
      [
        item.name,
        item.slug,
        item.description,
        item.icon,
        item.price,
        item.kind,
        item.sort,
        JSON.stringify(item.slug === 'contest-pack-5' ? { grantKind: 'contest', total: 5 } : {}),
      ],
    );
  }
}

function seedHomepage(ownerId: number): void {
  if (!count('SELECT COUNT(*) AS c FROM carousel')) {
    const banners = [
      {
        title: 'OGOJ · Oganesson Online Judge',
        subtitle: '开源、自由、功能完整的在线评测系统',
        link: '/problems',
        sort: 1,
      },
      {
        title: '做完一题，就离大佬更近一步',
        subtitle: '每通过一道题目都能获得积分，可在商店兑换比赛与出题资格',
        link: '/shop',
        sort: 2,
      },
      {
        title: '参加比赛，证明自己',
        subtitle: 'ACM / OI / IOI 三种赛制，实时排行榜与封榜功能',
        link: '/contests',
        sort: 3,
      },
    ];
    for (const banner of banners) {
      run('INSERT INTO carousel (title, subtitle, image, link, sort, is_active) VALUES (?, ?, ?, ?, ?, 1)', [
        banner.title,
        banner.subtitle,
        '',
        banner.link,
        banner.sort,
      ]);
    }
  }
  if (!count('SELECT COUNT(*) AS c FROM announcements')) {
    run(
      `INSERT INTO announcements (title, content, type, is_pinned, is_public, author_id) VALUES (?, ?, 'important', 1, 1, ?)`,
      [
        'OGOJ 正式上线，欢迎使用！',
        'OGOJ 是一个完全开源的在线评测系统，支持题目、评测、比赛、讨论、题解、文章广场、题单、团队与积分商店。\n\n站点还提供成就徽章与工单支持，欢迎体验；遇到问题可以随时提交工单。',
        ownerId,
      ],
    );
    run(
      `INSERT INTO announcements (title, content, type, is_pinned, is_public, author_id) VALUES (?, ?, 'update', 0, 1, ?)`,
      [
        '积分商店上线：做完题目即可兑换比赛与出题资格',
        '每通过一道题目获得 1 点积分，全站首杀额外获得 5 点积分。积分可以在 [商店](/shop) 兑换「创建一次比赛」「出一道题」等特权。',
        ownerId,
      ],
    );
  }
}

function seedSubmissions(userIds: Record<string, number>, problemIds: number[]): void {
  if (count('SELECT COUNT(*) AS c FROM submissions')) return;
  const code =
    '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    long long a, b;\n    if (cin >> a >> b) cout << a + b << "\\n";\n    return 0;\n}\n';
  const samples: [string, keyof typeof userIds, string, string, number, number][] = [
    ['alice', 'alice', 'AC', code, 3, 1520],
    ['bob', 'bob', 'AC', code, 5, 1980],
    ['carol', 'carol', 'WA', 'print(sum(map(int, input().split())))\n', 42, 7800],
  ];
  for (const [, username, status, source, timeMs, memoryKb] of samples) {
    const userId = userIds[username];
    const problemId = problemIds[0]!;
    const info = run(
      `INSERT INTO submissions (problem_id, user_id, language, code, code_length, status, score, time_ms,
         memory_kb, judged_at, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), '[]')`,
      [
        problemId,
        userId,
        String(username) === 'carol' ? 'python3' : 'cpp',
        source,
        Buffer.byteLength(source),
        status,
        status === 'AC' ? 100 : 0,
        timeMs,
        memoryKb,
      ],
    );
    const submissionId = Number(info.lastInsertRowid);
    run('UPDATE problems SET submit_count = submit_count + 1 WHERE id = ?', [problemId]);
    run(
      `INSERT INTO user_problem_stats (user_id, problem_id, attempts, accepted, first_ac_at, last_submit_at)
       VALUES (?, ?, 1, ?, ?, datetime('now'))
       ON CONFLICT(user_id, problem_id) DO UPDATE SET attempts = attempts + 1, accepted = accepted + ?`,
      [userId, problemId, status === 'AC' ? 1 : 0, status === 'AC' ? new Date().toISOString().slice(0, 19) : null, status === 'AC' ? 1 : 0],
    );
    if (status === 'AC') {
      run('UPDATE problems SET accepted_count = accepted_count + 1 WHERE id = ?', [problemId]);
      run('UPDATE users SET solved_count = solved_count + 1 WHERE id = ?', [userId]);
      addPoints(userId, 1, '通过题目 P1001', { refType: 'problem', refId: problemId });
    }
    void submissionId;
  }
  // give the demo accounts a starting balance so the shop can be explored
  for (const username of ['alice', 'bob', 'carol']) {
    run('UPDATE users SET points = 120 WHERE id = ? AND points < 20', [userIds[username]!]);
  }
  run('UPDATE users SET points = 0 WHERE username = ?', [config.seed.rootUsername]);
}

export async function seed(options: { silent?: boolean } = {}): Promise<void> {
  migrate();
  insertSettingsDefaults();
  invalidateSettings();
  const userIds = await seedUsers();
  cleanDefaultAdminTraces();
  const tagIds = seedTags();
  const problemIds = seedProblems(userIds.root!, tagIds);
  seedContests(userIds.root!, problemIds);
  seedCommunity(userIds, problemIds);
  seedShop();
  seedHomepage(userIds.root!);
  seedSubmissions(userIds, problemIds);
  const newBadges = seedAchievements();
  // Give the demo accounts the badges they already qualify for.
  for (const userId of Object.values(userIds)) {
    try {
      evaluateAchievements(userId, { silent: true });
    } catch {
      /* ignore */
    }
  }

  if (!options.silent) {
    const stats = {
      users: count('SELECT COUNT(*) AS c FROM users'),
      problems: count('SELECT COUNT(*) AS c FROM problems'),
      testcases: count('SELECT COUNT(*) AS c FROM testcases'),
      contests: count('SELECT COUNT(*) AS c FROM contests'),
      submissions: count('SELECT COUNT(*) AS c FROM submissions'),
      shopItems: count('SELECT COUNT(*) AS c FROM shop_items'),
      achievements: count('SELECT COUNT(*) AS c FROM achievements'),
    };
    // eslint-disable-next-line no-console
    console.log('OGOJ seed complete:');
    console.table(stats);
    // eslint-disable-next-line no-console
    console.log(
      `\n超级管理员: ${config.seed.rootUsername} / ${config.seed.rootPassword}\n` +
        `普通管理员: admin / ${config.seed.rootPassword}\n` +
        `示例用户: alice, bob, carol / ${config.seed.rootPassword}`,
    );
    if (newBadges > 0) console.log(`已写入 ${newBadges} 个成就徽章定义。`);
  }
}

/** Remove every row from the database (keeps the schema and test data files). */
export function wipe(): void {
  const tables = all<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
  );
  tx(() => {
    db.exec('PRAGMA foreign_keys = OFF');
    for (const table of tables) {
      if (table.name === 'settings') continue;
      run(`DELETE FROM "${table.name}"`);
    }
    run(`DELETE FROM sqlite_sequence`);
    db.exec('PRAGMA foreign_keys = ON');
  });
  for (const dir of [config.paths.testdata]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

const invokedDirectly = process.argv[1]?.includes('seed');
if (invokedDirectly) {
  seed()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('seed failed:', error);
      process.exit(1);
    });
}
