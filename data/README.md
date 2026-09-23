# OGOJ runtime data

This directory holds runtime data and is **not** committed to git.

```
data/
├── ogoj.db          # SQLite database (users, problems, submissions, ...)
├── testdata/        # Test cases: data/testdata/<problemId>/<case>.in|.out
├── uploads/         # Avatars, problem attachments, carousel images
└── judge/           # Scratch space used while judging (auto cleaned)
```

Back up `ogoj.db` **and** `testdata/` together — they reference each other.
