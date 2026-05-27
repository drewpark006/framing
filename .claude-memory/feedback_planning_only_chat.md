---
name: feedback-planning-only-chat
description: This chat session is for generating plans and ideas only; execution happens in other agents
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 40b83cf1-783c-4743-b3d3-f9ffd622a933
---

In the framing-project chat, Drew defaults to using this session for planning and idea generation, and executing plans in separate agents. But this is a soft default, not absolute: if Drew gives a direct execution instruction in this chat ("do it", "go", "execute"), follow it.

**Why:** Drew said 2026-05-20: "this chat will only be for coming up with ideas and plans and i will execute them in other agnets" after I drafted a plan and was about to call ExitPlanMode. Later the same day, after another plan + critique cycle, he replied "do it / youre the execution agent dummy" and wanted execution in this chat. On 2026-05-22 he repeated this with "you are the execution agents stupid" after I again drafted an updated plan instead of executing on "make those changes and then go". So the rule is: plan by default, but obey direct overrides — especially "go", "do it", "execute", "make those changes and then go", or any imperative that follows a finalized plan.

**How to apply:**
- Default to plan output (no ExitPlanMode, no Edit/Write/Bash for execution work).
- READ tools (Read, Bash for git status / file listing, Explore agents) are always fine.
- When a plan is ready, save to `/Users/dpark/.claude/plans/<slug>.md` and offer to `pbcopy` it so Drew can paste into a fresh agent.
- If Drew explicitly tells this chat to execute, do it. Do not refuse on the grounds of this memory.
- After Drew confirms a plan and ends with an imperative ("go", "do it", "make those changes and then go"), default to EXECUTING — do not produce yet another plan revision. The plan revision belongs in the response if Drew asks for one; otherwise the imperative means run the work in this chat.
