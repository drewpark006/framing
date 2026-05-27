---
name: framing-machine-tag
description: Tag every where_we_are.md bullet and commit subject with (Windows) or (Mac) so Drew can tell which machine did what
metadata:
  type: feedback
---

When working in the framing repo, mark every new `where_we_are.md` bullet and every commit subject line with `(Windows)` or `(Mac)` indicating which machine made the change.

**Why:** Drew alternates between his Windows desktop and his MacBook, and the per-machine SQLite databases (`framing.sqlite`) are NOT shared — only the code in git is. When a change touches seed data, schema, or anything that requires re-seeding/migrating the local DB, Drew needs to know which machine already has the side effects applied and which one still needs to catch up. The tag is the at-a-glance signal.

**How to apply:**
- For `where_we_are.md` "What's done" bullets: append ` (Windows)` or ` (Mac)` to the end of the bullet for changes I make in this session.
- For commit messages: append the same tag at the end of the subject line, e.g. `seed.js: add 6 more sample orders for demo dashboard (Windows)`.
- Don't backfill tags on existing bullets/commits — only mark new entries from this session.
- The current machine is determinable from the platform info at session start (`win32` → Windows, `darwin` → Mac).
- This is purely about visibility — the actual git workflow still follows [[framing-git-workflow]].

**Related concern:** `framing.sqlite` is in `.gitignore` (along with `*.sqlite-journal`, `*.sqlite-wal`, `*.sqlite-shm`), so customer data never lands on GitHub. Don't ever add it. If a future task asks me to commit a sample DB, ask first.
