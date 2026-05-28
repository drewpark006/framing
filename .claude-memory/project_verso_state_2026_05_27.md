---
name: project-verso-state-2026-05-27
description: Verso state snapshot as of 2026-05-27 — code far along, demo deadline loosened, research phase opening
metadata:
  type: project
---

**Verso state, 2026-05-27.** Fact-of-the-day snapshot; for current truth always read `where_we_are.md` in the framing repo first.

**Where the product is:**
- Fly-deployable PWA. Login wall (scrypt + HMAC cookie). Twilio SMS on `mark_ready`. Claude vision intake scan via `/api/order/scan_ticket`. Live cross-device polling sync (`livePoll` in counter.js). Signature pad. Schema matches Phil's paper ticket FR-248-3. Single shop, single password.
- Pilot customer: Phil Sohn at Thomson's Art & Frame, White Plains NY. Two-person production (Phil + one back-of-house framer). The framer is the daily user; Phil is the buyer.
- Demo URL: `verso-thomson-art.fly.dev`. Real domain deferred (verso.com / versohq.com / verso.studio all taken on 2026-05-26).
- Seed data: 9 sample orders in `seed.js` (tickets 0045664–0045672) spanning all four active stages.

**What changed 2026-05-27:**
- Sunday 2026-05-31 demo deadline loosened. Drew now plans a Friday or next-week in-person Phil visit with a *finalized* product. Bottleneck is no longer code velocity, it's prep depth.
- Drew formally tasked Claude as primary planning agent (project + research). See [[user-drew-verso-role]].
- Phase 1 research underway — four workstreams (competitive, domain, UX/reliability, GTM/pricing). Output at `~/.claude/plans/research/` (private, not in repo).

**Why:** This snapshot exists so future Claude sessions can pick up the strategic frame without re-reading every memory. Project state, not feedback or convention.

**How to apply:**
- When the user references "the plan" / "the research" / "the workstreams" in future sessions, look in `~/.claude/plans/research/` (Windows) or `~/.claude/plans/research/` (Mac). The directory is per-machine.
- When code questions come up, the schema/state-machine source of truth is `modules/order/module.grove`; the runtime gluing serve.py + grove-server is documented in `where_we_are.md`.
- When demo deadlines come up, default to "Friday or next week, in-person at Thomson's" unless `where_we_are.md` says otherwise.
- This snapshot decays. If `where_we_are.md` and this memory disagree, trust `where_we_are.md` and update or delete this memory.

Related: [[project-framing-context]] (original v0a context, Phil's pain), [[reference-framing-location]] (paths), [[framing-where-we-are-on-commit]] (status doc convention).
