# OGOJ runtime data

This directory holds runtime data and is **not** committed to git.

```
data/
├── ogoj.db          # SQLite database (users, problems, submissions, ...)
├── ogoj.db-wal      # SQLite WAL / shared-memory files (temporary)
├── testdata/        # Test cases: data/testdata/<problemId>/<case>.in|.out
├── uploads/         # Avatars, team files, site logo / homepage images
├── backups/         # Manual database backups created from the admin panel
└── judge/           # Scratch space used while judging (auto cleaned)
```

Back up `ogoj.db` **and** `testdata/` together — they reference each other.

Everything under `data/` is runtime state and is ignored by git, so a fresh clone
starts empty and is re-created by `npm run seed` on first run.
