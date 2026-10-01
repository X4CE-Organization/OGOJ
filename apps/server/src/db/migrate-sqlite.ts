/**
 * 把旧的 SQLite 数据库（data/ogoj.db）整体导入 PostgreSQL。
 *
 *   DATABASE_URL=postgres://... SQLITE_FILE=./data/ogoj.db npm run migrate:sqlite -w @ogoj/server
 *
 * 特点：表按外键依赖顺序复制、自增序列自动校正、可重复执行（先清空目标表再写）。
 */
import fs from 'node:fs';
import { all, tx, run, closePool } from './index.js';
import { config } from '../config.js';
import { migrate } from './index.js';

/**
 * better-sqlite3 是可选依赖（原生模块，生产镜像里不安装）：
 * 只有执行 SQLite → PostgreSQL 迁移时才需要它。
 */
async function loadSqlite(): Promise<any> {
  try {
    // 用变量做说明符，避免在没有安装这个可选依赖时触发类型解析报错
    const specifier = 'better-sqlite3';
    const module = (await import(specifier)) as any;
    return module.default ?? module;
  } catch {
    throw new Error(
      '迁移需要 better-sqlite3，请先在项目根目录执行 `npm i better-sqlite3` 后再运行本命令。',
    );
  }
}

/** 依赖顺序：被引用的表在前 */
const TABLE_ORDER = [
  'settings',
  'users',
  'follows',
  'tags',
  'difficulties',
  'stickers',
  'user_stickers',
  'problems',
  'problem_tags',
  'problem_favorites',
  'problem_votes',
  'testcases',
  'submissions',
  'user_problem_stats',
  'teams',
  'contests',
  'contest_problems',
  'contest_registrations',
  'discussion_boards',
  'discussions',
  'discussion_replies',
  'solutions',
  'solution_votes',
  'articles',
  'comments',
  'lists',
  'list_problems',
  'list_progress',
  'list_favorites',
  'team_members',
  'team_announcements',
  'team_problems',
  'team_groups',
  'team_applications',
  'team_blacklist',
  'team_discussions',
  'team_discussion_replies',
  'team_lists',
  'team_list_items',
  'team_assignments',
  'team_assignment_problems',
  'team_files',
  'achievements',
  'user_achievements',
  'point_logs',
  'shop_items',
  'shop_orders',
  'grants',
  'announcements',
  'carousel',
  'messages',
  'tickets',
  'ticket_replies',
  'audit_logs',
  'login_logs',
  'rate_limits',
];

async function main() {
  const file = process.env.SQLITE_FILE ?? config.databaseFile;
  if (!fs.existsSync(file)) {
    console.error(`找不到 SQLite 文件：${file}`);
    process.exit(1);
  }
  console.log(`从 ${file} 导入到 ${config.databaseUrl.replace(/:[^:@/]+@/, ':***@')}`);

  const Database = await loadSqlite();
  const sqlite = new Database(file, { readonly: true });
  await migrate(); // 先建好 PostgreSQL 表结构

  // 以 PostgreSQL 的表为准，避免 SQLite 里缺少/多余的列
  const pgTables = (
    await all<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'`,
      ['public'],
    )
  ).map((row) => row.table_name);
  const sqliteTables = new Set(
    (
      sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as {
        name: string;
      }[]
    ).map((row) => row.name),
  );

  const ordered = [
    ...TABLE_ORDER.filter((table) => pgTables.includes(table) && sqliteTables.has(table)),
    ...pgTables.filter((table) => sqliteTables.has(table) && !TABLE_ORDER.includes(table)),
  ];

  let copied = 0;
  await tx(async () => {
    // 先清空（用 CASCADE 处理外键）
    await run(`TRUNCATE TABLE ${ordered.map((table) => `"${table}"`).join(', ')} RESTART IDENTITY CASCADE`);
    for (const table of ordered) {
      const columns = (
        await all<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ?`,
          ['public', table],
        )
      ).map((row) => row.column_name);
      const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
      if (!rows.length) continue;
      const usable = columns.filter((column) => rows[0]![column] !== undefined || true);
      const placeholders = usable.map((_, index) => `$${index + 1}`).join(', ');
      for (const row of rows) {
        const values = usable.map((column) => {
          const value = row[column];
          if (value === undefined) return null;
          if (typeof value === 'boolean') return value ? 1 : 0;
          return value;
        });
        await run(`INSERT INTO "${table}" (${usable.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`, values);
        copied += 1;
      }
      // 自增序列校正
      if (columns.includes('id')) {
        await all(
          `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 1), true)`,
        );
      }
      console.log(`  ${table}: ${rows.length} 行`);
    }
  });

  console.log(`导入完成，共 ${copied} 行。`);
  sqlite.close();
  await closePool();
}

main().catch(async (error) => {
  console.error('导入失败:', error);
  await closePool().catch(() => undefined);
  process.exit(1);
});
