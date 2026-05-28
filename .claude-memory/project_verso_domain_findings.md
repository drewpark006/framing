---
name: project-verso-domain-findings
description: Verso domain-knowledge findings 2026-05-27 — schema is already at industry-de-facto coverage, GlassKind enum is the only real gap
metadata:
  type: project
---

**Workstream B (product domain knowledge) findings, 2026-05-27.** Full research at `~/.claude/plans/research/domain.md`.

**Top-line:** Verso's schema already matches or exceeds industry-de-facto work-order coverage. **No new field gaps surfaced.** The two outstanding gaps were already in PLAN.md before research started: audit fields (`order_taken_by` / `created_by`) and separate artwork dimensions.

**The one real domain gap: `GlassKind` enum.** Tru Vue is the industry authority; their 6-product taxonomy is the canonical vocabulary that POS systems and distributors use. Verso's current enum (`regular, non_glare, plexi, acrylic, mirror`) conflates several distinct industry tiers:
- No `conservation_clear` (mid-tier, 99% UV, glass) — a Larson-Juhl line item with its own price
- No `museum` (premium, 99% UV + anti-reflective, glass) — Tru Vue Museum Glass®
- `acrylic` is too vague — collapses standard plexi, Conservation Clear Acrylic, and Optium Museum Acrylic into one slot
- Worst case: a framer pulls the wrong inventory sheet because the ticket said "acrylic" when the customer paid for Optium

**Migration recommendation:** NOT before the Phil visit. Gate on a Phil question first: *"When the framer cuts glass, how does he know what tier to pull? Do you sell Conservation Clear or Museum Glass, or mostly regular?"* If mostly basic tiers, leave it alone. If he sells the conservation tiers, migrate to:
```
regular, non_glare, conservation_clear, museum,
plexi, conservation_clear_acrylic, optium_museum_acrylic, mirror
```

**Pricing-model finding:** the industry uses three models, often combined — per-foot (moulding), United Inches (UI = height + width, dominant convention per Larson-Juhl/Victor/Jayeness price lists), and sliding-scale markups (lower markup on expensive items, higher on cheap). Verso captures per-foot manually and has no calculator. **This is a deliberate scope choice** — the Workstream A positioning thesis says ticket-first, not POS-first. Building a pricing engine pulls Verso into LifeSaver/FramingPOS territory.

**No public PPFA standard form exists.** Searched the PPFA site, newsletters, Framers' Corner forum. The CPF/MCPF certification doesn't include a "standard ticket template" deliverable. The de facto standard is what POS systems implicitly support.

**How to apply:**
- When evaluating a "should we add field X" proposal, default no unless Phil's framer raised it. The schema is already at industry coverage.
- When considering pricing-engine work, push back. Workstream A positioning + Workstream B both say defer this.
- When the GlassKind question arises during V1.1 planning, the migration is small and pre-designed. Don't expand it on the demo branch.

Related: [[project-verso-competitive-landscape]] (positioning thesis), [[project-verso-state-2026-05-27]] (current state).
