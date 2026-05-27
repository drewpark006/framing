---
name: framing-git-workflow
description: Framing repo workflow — pull before starting work, push after finishing, maintain `backup` branch on origin pointing at HEAD~1 for one-step rollback
metadata:
  type: feedback
---

For the framing repo (`/Users/dpark/Manzano/framing` on Mac, `$HOME\manzano\framing` on Windows), Drew alternates between Mac and Windows. Git is the sync mechanism. Follow this workflow:

**Why:** Drew works on one machine at a time. If I forget to pull, I'll diverge from the other machine's state. If I forget to push, the other machine will be missing my work the next time he sits down there. The backup branch gives a one-step rollback if a push turns out to be broken.

**How to apply:**

1. **At the start of a session/task**, before making changes: `git pull` in the framing repo. If pull would conflict with uncommitted local work, ask Drew before clobbering anything.

2. **Before pushing new commits**, update the `backup` branch on origin to point at the commit currently on remote main (i.e. the state we're about to replace):
   ```
   git fetch
   git push origin "$(git rev-parse origin/main):refs/heads/backup" --force
   ```
   Then push main normally:
   ```
   git push origin main
   ```

3. **To roll back one step** if a push was bad:
   ```
   git fetch
   git reset --hard origin/backup
   git push --force origin main
   ```
   Only do this with Drew's explicit OK — force-pushing main is destructive.

4. **At the end of a task** (or when Drew is wrapping up), commit and push using the steps in 2.

Related: [[framing-where-we-are-on-commit]] (refresh where_we_are.md as part of every commit), [[framing-location]].
