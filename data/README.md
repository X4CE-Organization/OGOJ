# OGOJ runtime data

This directory holds runtime data and is **not** committed to git.

```
data/
├── testdata/        # Test cases: data/testdata/<problemId>/<case>.in|.out
├── uploads/         # Avatars, team files, site logo / homepage images
├── backups/         # pg_dump backups created from the admin panel
├── ogoj.db          # 旧版 SQLite 数据库（3.0 起只用于迁移到 PostgreSQL）
└── judge/           # Scratch space used while judging (auto cleaned)
```

从 3.0 起数据存在 **PostgreSQL** 里（用 `DATABASE_URL` 连接），这个目录只放
测试数据、上传文件与备份；迁移旧数据用 `npm run migrate:sqlite`。

Everything under `data/` is runtime state and is ignored by git, so a fresh clone
starts empty and is re-created by `npm run seed` on first run.
