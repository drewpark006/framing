---
name: framing-where-we-are-on-commit
description: "Before any git commit to the framing repo, update where_we_are.md so the living status doc never goes stale"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: e773869a-c649-4d65-ae2c-f1463f885009
---

Rule: every git commit to `/Users/dpark/Manzano/framing/` must include an updated `where_we_are.md`. Re-read the file, edit the dated header + Current focus + In flight + Queued + Decisions + Open questions sections to match the actual current state, then stage it alongside whatever else is being committed.

**Why:** Drew asked for a living status doc on 2026-05-26 so that picking the work back up after a gap does not require re-reading the conversation history. The file decays in value the moment it goes stale, so updating it must happen WITH the commit, not separately.

**How to apply:**
- This applies only to the framing repo, not other projects.
- Before staging files for any `git commit`, open `where_we_are.md` and bring it current. At minimum: bump the "Last updated" date, move just-finished items from "In flight" to "What's done," add any new decisions made or open questions raised in the session.
- If the commit is purely mechanical (typo fix, formatting), still update at least the date so it stays in sync.
- Stage `where_we_are.md` in the same commit as the rest of the work; do not split into a separate "status update" commit.

See also: [[reference-framing-location]] for the repo path.
