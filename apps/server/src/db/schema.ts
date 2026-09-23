/**
 * OGOJ database schema (SQLite).
 *
 * The schema is written as idempotent DDL so that `migrate()` can be executed on
 * every boot. Indexes and tables are created only when missing.
 */
export const SCHEMA_SQL = /* sql */ `
-- ---------------------------------------------------------------------------
-- Global key/value settings (see src/settings/registry.ts for the full list)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       TEXT NOT NULL UNIQUE,
  email          TEXT UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'user',       -- user | admin | superadmin
  display_name   TEXT,
  avatar         TEXT,
  banner         TEXT,
  bio            TEXT DEFAULT '',
  signature      TEXT DEFAULT '',
  school         TEXT DEFAULT '',
  gender         INTEGER NOT NULL DEFAULT 0,          -- 0 保密 1 男 2 女
  ccf_level      TEXT DEFAULT '',
  points         INTEGER NOT NULL DEFAULT 0,          -- 积分 (商店货币)
  rating         INTEGER NOT NULL DEFAULT 1500,       -- 咕值 / 比赛 rating
  is_banned      INTEGER NOT NULL DEFAULT 0,
  ban_reason     TEXT,
  is_private     INTEGER NOT NULL DEFAULT 0,          -- 隐藏提交记录 / 通过题目
  show_email     INTEGER NOT NULL DEFAULT 0,
  theme          TEXT NOT NULL DEFAULT 'light',
  invite_code    TEXT,
  solved_count   INTEGER NOT NULL DEFAULT 0,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  submission_count INTEGER NOT NULL DEFAULT 0,
  contest_count  INTEGER NOT NULL DEFAULT 0,
  last_login_at  TEXT,
  last_login_ip  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_points ON users(points DESC);
CREATE INDEX IF NOT EXISTS idx_users_solved ON users(solved_count DESC);
CREATE INDEX IF NOT EXISTS idx_users_rating ON users(rating DESC);

CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (follower_id, followee_id)
);

-- ---------------------------------------------------------------------------
-- Tags & problems
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tags (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL UNIQUE,
  color    TEXT NOT NULL DEFAULT '#60a5fa',
  category TEXT NOT NULL DEFAULT '算法',
  sort     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS problems (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pid             TEXT NOT NULL UNIQUE,               -- 显示编号, e.g. P1001 / OGOJ001
  title           TEXT NOT NULL,
  background      TEXT NOT NULL DEFAULT '',
  statement       TEXT NOT NULL DEFAULT '',
  input_format    TEXT NOT NULL DEFAULT '',
  output_format   TEXT NOT NULL DEFAULT '',
  hint            TEXT NOT NULL DEFAULT '',
  difficulty      INTEGER NOT NULL DEFAULT 1,          -- 1..7
  author_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  owner_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- 商店出题的用户
  provider        TEXT NOT NULL DEFAULT '',            -- 题目来源
  time_limit      INTEGER NOT NULL DEFAULT 1000,       -- ms
  memory_limit    INTEGER NOT NULL DEFAULT 256,        -- MB
  judge_mode      TEXT NOT NULL DEFAULT 'standard',    -- standard | spj | interactive
  compare_mode    TEXT NOT NULL DEFAULT '',            -- '' 表示使用全站默认
  spj_language    TEXT DEFAULT '',
  spj_code        TEXT DEFAULT '',
  inter_code      TEXT DEFAULT '',
  subtasks        TEXT NOT NULL DEFAULT '[]',          -- json: [{id,score,cases[],method,deps[]}]
  samples         TEXT NOT NULL DEFAULT '[]',          -- json: [{input,output,explanation}]
  allow_languages TEXT NOT NULL DEFAULT '[]',          -- json: [] 表示全部允许
  source_type     TEXT NOT NULL DEFAULT 'official',    -- official | user
  review_status   TEXT NOT NULL DEFAULT 'approved',    -- approved | pending | rejected
  review_note     TEXT DEFAULT '',
  is_public       INTEGER NOT NULL DEFAULT 1,
  is_contest_only INTEGER NOT NULL DEFAULT 0,
  allow_hack      INTEGER NOT NULL DEFAULT 0,          -- 是否允许对本题发起 hack
  hack_language   TEXT NOT NULL DEFAULT '',            -- 生成 hack 标准答案的参考程序语言
  hack_code       TEXT NOT NULL DEFAULT '',            -- 参考程序源码
  submit_count    INTEGER NOT NULL DEFAULT 0,
  accepted_count  INTEGER NOT NULL DEFAULT 0,
  favorite_count  INTEGER NOT NULL DEFAULT 0,
  deleted_at      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_problems_public ON problems(is_public, review_status);
CREATE INDEX IF NOT EXISTS idx_problems_difficulty ON problems(difficulty);
CREATE INDEX IF NOT EXISTS idx_problems_author ON problems(author_id);

CREATE TABLE IF NOT EXISTS problem_tags (
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (problem_id, tag_id)
);

CREATE TABLE IF NOT EXISTS problem_favorites (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, problem_id)
);

CREATE TABLE IF NOT EXISTS problem_votes (
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score      INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (problem_id, user_id)
);

CREATE TABLE IF NOT EXISTS testcases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id  INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  idx         INTEGER NOT NULL,
  subtask_id  INTEGER NOT NULL DEFAULT 0,
  score       INTEGER NOT NULL DEFAULT 10,
  input_file  TEXT NOT NULL,
  output_file TEXT NOT NULL,
  is_sample   INTEGER NOT NULL DEFAULT 0,
  is_hack     INTEGER NOT NULL DEFAULT 0,
  hack_id     INTEGER,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (problem_id, idx)
);

-- ---------------------------------------------------------------------------
-- Submissions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS submissions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id     INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contest_id     INTEGER,
  language       TEXT NOT NULL,
  code           TEXT NOT NULL,
  code_length    INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'Waiting',
  score          INTEGER NOT NULL DEFAULT 0,
  time_ms        INTEGER,
  memory_kb      INTEGER,
  compile_output TEXT DEFAULT '',
  detail         TEXT NOT NULL DEFAULT '[]',
  judge_log      TEXT DEFAULT '',
  judge_time_ms  INTEGER,
  is_public      INTEGER NOT NULL DEFAULT 1,
  priority       INTEGER NOT NULL DEFAULT 0,
  hacked         INTEGER NOT NULL DEFAULT 0,
  hack_id        INTEGER,
  claimed_at     TEXT,
  judged_at      TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_submissions_problem ON submissions(problem_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_contest ON submissions(contest_id, user_id);
CREATE INDEX IF NOT EXISTS idx_submissions_queue ON submissions(status, priority DESC, id ASC);

CREATE TABLE IF NOT EXISTS user_problem_stats (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id    INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  attempts      INTEGER NOT NULL DEFAULT 0,
  accepted      INTEGER NOT NULL DEFAULT 0,
  first_ac_at   TEXT,
  last_submit_at TEXT,
  PRIMARY KEY (user_id, problem_id)
);

-- ---------------------------------------------------------------------------
-- Contests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  subtitle        TEXT DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  rules           TEXT NOT NULL DEFAULT 'acm',        -- acm | oi | ioi
  start_time      TEXT NOT NULL,
  end_time        TEXT NOT NULL,
  freeze_minutes  INTEGER NOT NULL DEFAULT 0,
  is_public       INTEGER NOT NULL DEFAULT 1,
  need_register   INTEGER NOT NULL DEFAULT 1,
  password        TEXT DEFAULT '',
  show_rank       INTEGER NOT NULL DEFAULT 1,
  rated           INTEGER NOT NULL DEFAULT 1,
  allow_hack      INTEGER NOT NULL DEFAULT 1,
  open_hack       INTEGER NOT NULL DEFAULT 0,
  allow_languages TEXT NOT NULL DEFAULT '[]',
  origin          TEXT NOT NULL DEFAULT 'official',   -- official | user
  owner_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  review_status   TEXT NOT NULL DEFAULT 'approved',   -- approved | pending | rejected
  review_note     TEXT DEFAULT '',
  deleted_at      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contests_time ON contests(start_time DESC);

CREATE TABLE IF NOT EXISTS contest_problems (
  contest_id INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  order_no   INTEGER NOT NULL DEFAULT 1,
  label      TEXT NOT NULL DEFAULT '',
  score      INTEGER NOT NULL DEFAULT 100,
  PRIMARY KEY (contest_id, problem_id)
);

CREATE TABLE IF NOT EXISTS contest_registrations (
  contest_id    INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_rated      INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (contest_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Community: boards / discussions / solutions / articles / comments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discussion_boards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0,
  min_level   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS discussions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id      INTEGER REFERENCES discussion_boards(id) ON DELETE SET NULL,
  problem_id    INTEGER REFERENCES problems(id) ON DELETE CASCADE,
  contest_id    INTEGER REFERENCES contests(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL DEFAULT '',
  author_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_pinned     INTEGER NOT NULL DEFAULT 0,
  is_locked     INTEGER NOT NULL DEFAULT 0,
  is_deleted    INTEGER NOT NULL DEFAULT 0,
  views         INTEGER NOT NULL DEFAULT 0,
  reply_count   INTEGER NOT NULL DEFAULT 0,
  last_reply_at TEXT,
  last_reply_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_discussions_board ON discussions(board_id, is_deleted, is_pinned DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_discussions_problem ON discussions(problem_id, is_deleted);

CREATE TABLE IF NOT EXISTS discussion_replies (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  discussion_id INTEGER NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  author_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  floor         INTEGER NOT NULL DEFAULT 1,
  reply_to_id   INTEGER,
  is_deleted    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_replies_discussion ON discussion_replies(discussion_id, id);

CREATE TABLE IF NOT EXISTS solutions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id    INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  author_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,
  is_public     INTEGER NOT NULL DEFAULT 1,
  is_deleted    INTEGER NOT NULL DEFAULT 0,
  upvotes       INTEGER NOT NULL DEFAULT 0,
  downvotes     INTEGER NOT NULL DEFAULT 0,
  views         INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_solutions_problem ON solutions(problem_id, is_deleted, upvotes DESC);

CREATE TABLE IF NOT EXISTS solution_votes (
  solution_id INTEGER NOT NULL REFERENCES solutions(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  value       INTEGER NOT NULL,
  PRIMARY KEY (solution_id, user_id)
);

CREATE TABLE IF NOT EXISTS articles (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  summary    TEXT NOT NULL DEFAULT '',
  content    TEXT NOT NULL DEFAULT '',
  cover      TEXT DEFAULT '',
  category   TEXT NOT NULL DEFAULT '学习',
  author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_public  INTEGER NOT NULL DEFAULT 1,
  is_pinned  INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  views      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_articles_public ON articles(is_public, is_deleted, id DESC);

CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL,          -- problem | article | solution | contest | list
  target_id   INTEGER NOT NULL,
  author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  parent_id   INTEGER,
  is_deleted  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_id, is_deleted);

-- ---------------------------------------------------------------------------
-- 题单 / 训练
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover       TEXT DEFAULT '',
  type        TEXT NOT NULL DEFAULT 'user',  -- official | user | training
  difficulty  INTEGER NOT NULL DEFAULT 0,
  author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_public   INTEGER NOT NULL DEFAULT 1,
  is_deleted  INTEGER NOT NULL DEFAULT 0,
  views       INTEGER NOT NULL DEFAULT 0,
  favorites   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS list_problems (
  list_id    INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  order_no   INTEGER NOT NULL DEFAULT 1,
  note       TEXT DEFAULT '',
  PRIMARY KEY (list_id, problem_id)
);

CREATE TABLE IF NOT EXISTS list_progress (
  list_id    INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'todo',  -- todo | doing | done
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (list_id, user_id, problem_id)
);

CREATE TABLE IF NOT EXISTS list_favorites (
  list_id    INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (list_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 团队
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  avatar      TEXT DEFAULT '',
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_public   INTEGER NOT NULL DEFAULT 1,
  member_count INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id   INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member',   -- owner | admin | member
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS team_announcements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS team_problems (
  team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  added_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (team_id, problem_id)
);

-- ---------------------------------------------------------------------------
-- 商店 / 积分 / 权限配额
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shop_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  description  TEXT NOT NULL DEFAULT '',
  icon         TEXT DEFAULT 'package',
  price        INTEGER NOT NULL DEFAULT 100,
  kind         TEXT NOT NULL DEFAULT 'contest',   -- contest | problem | vip | custom
  stock        INTEGER NOT NULL DEFAULT -1,        -- -1 表示无限
  max_per_user INTEGER NOT NULL DEFAULT 0,         -- 0 表示不限
  is_active    INTEGER NOT NULL DEFAULT 1,
  sort         INTEGER NOT NULL DEFAULT 0,
  payload      TEXT NOT NULL DEFAULT '{}',
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shop_orders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no    TEXT NOT NULL UNIQUE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id     INTEGER REFERENCES shop_items(id) ON DELETE SET NULL,
  item_name   TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'contest',
  price       INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | cancelled
  payload     TEXT NOT NULL DEFAULT '{}',       -- 用户填写的申请内容
  note        TEXT DEFAULT '',                  -- 管理员处理备注
  handled_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  handled_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON shop_orders(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON shop_orders(status, id DESC);

CREATE TABLE IF NOT EXISTS point_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta         INTEGER NOT NULL,
  balance_after INTEGER NOT NULL DEFAULT 0,
  reason        TEXT NOT NULL DEFAULT '',
  ref_type      TEXT DEFAULT '',
  ref_id        INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_point_logs_user ON point_logs(user_id, id DESC);

-- 用户通过商店获得的权限配额 (创建比赛 / 出题)
CREATE TABLE IF NOT EXISTS grants (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                -- contest | problem
  total       INTEGER NOT NULL DEFAULT 1,
  used        INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT,
  order_id    INTEGER REFERENCES shop_orders(id) ON DELETE SET NULL,
  note        TEXT DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_grants_user ON grants(user_id, kind);

-- ---------------------------------------------------------------------------
-- 站内信 / 公告 / 轮播
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  to_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  type       TEXT NOT NULL DEFAULT 'system',   -- system | user | reply | judge | shop
  ref_type   TEXT DEFAULT '',
  ref_id     INTEGER,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_id, is_read, id DESC);

CREATE TABLE IF NOT EXISTS announcements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  type       TEXT NOT NULL DEFAULT 'notice',  -- notice | update | contest | important
  is_pinned  INTEGER NOT NULL DEFAULT 0,
  is_public  INTEGER NOT NULL DEFAULT 1,
  author_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  views      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS carousel (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL DEFAULT '',
  subtitle   TEXT NOT NULL DEFAULT '',
  image      TEXT NOT NULL DEFAULT '',
  link       TEXT NOT NULL DEFAULT '',
  sort       INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 审计日志
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name  TEXT DEFAULT '',
  action      TEXT NOT NULL,
  target_type TEXT DEFAULT '',
  target_id   TEXT DEFAULT '',
  detail      TEXT DEFAULT '',
  ip          TEXT DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(id DESC);

CREATE TABLE IF NOT EXISTS login_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  username   TEXT DEFAULT '',
  ip         TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  success    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key        TEXT PRIMARY KEY,
  count      INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 第三方登录（OAuth2）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,                    -- github | gitee | google | custom
  provider_user_id  TEXT NOT NULL,
  provider_username TEXT NOT NULL DEFAULT '',
  provider_email    TEXT NOT NULL DEFAULT '',
  avatar            TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_accounts(user_id);

-- ---------------------------------------------------------------------------
-- Hack 系统
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hacks (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  contest_id           INTEGER REFERENCES contests(id) ON DELETE SET NULL,
  problem_id           INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  hacker_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  target_user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  testcase_id          INTEGER,
  verdict              TEXT NOT NULL DEFAULT 'pending',   -- pending | success | fail | error
  input_file           TEXT NOT NULL DEFAULT '',
  answer_file          TEXT NOT NULL DEFAULT '',
  message              TEXT NOT NULL DEFAULT '',
  detail               TEXT NOT NULL DEFAULT '[]',
  status_before        TEXT NOT NULL DEFAULT '',
  status_after         TEXT NOT NULL DEFAULT '',
  score_delta          INTEGER NOT NULL DEFAULT 0,
  judged_at            TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_hacks_problem ON hacks(problem_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_hacks_contest ON hacks(contest_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_hacks_hacker ON hacks(hacker_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_hacks_target ON hacks(target_user_id, id DESC);

-- ---------------------------------------------------------------------------
-- 成就徽章
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS achievements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon        TEXT NOT NULL DEFAULT '🏅',
  category    TEXT NOT NULL DEFAULT 'milestone',   -- milestone | contest | community | skill | special
  rarity      TEXT NOT NULL DEFAULT 'common',      -- common | rare | epic | legendary
  condition   TEXT NOT NULL DEFAULT '{}',          -- {"type":"solved_count","threshold":10}
  points      INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  is_builtin  INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id INTEGER NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  unlocked_at    TEXT NOT NULL DEFAULT (datetime('now')),
  context        TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, achievement_id)
);
`;

/** Bumped whenever a destructive/manual migration is required. */
export const SCHEMA_VERSION = 2;

/**
 * Small, idempotent column additions for databases created by older builds.
 * Each entry is executed inside a try/catch (duplicate column errors ignored).
 */
export const ALTERATIONS_SQL: string[] = [
  `ALTER TABLE problems ADD COLUMN allow_hack INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE problems ADD COLUMN hack_language TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE problems ADD COLUMN hack_code TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE testcases ADD COLUMN is_hack INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE testcases ADD COLUMN hack_id INTEGER`,
  `ALTER TABLE testcases ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL`,
  `ALTER TABLE submissions ADD COLUMN hacked INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE submissions ADD COLUMN hack_id INTEGER`,
  `ALTER TABLE contests ADD COLUMN allow_hack INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE contests ADD COLUMN open_hack INTEGER NOT NULL DEFAULT 0`,
];
