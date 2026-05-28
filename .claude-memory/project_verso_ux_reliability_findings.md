---
name: project-verso-ux-reliability-findings
description: Verso UX + reliability findings 2026-05-27 — older-user touch targets/fonts, iPad PWA realities, signature pad gotchas, receipt vs SMS decision
metadata:
  type: project
---

**Workstream C findings, 2026-05-27.** Full research at `~/.claude/plans/research/ux-reliability.md`.

**The durable rules:**

1. **Touch target floor = 44×44 px on iPad** (Apple HIG + WCAG 2.5.5 AAA). 24×24 is the WCAG 2.5.8 AA minimum but insufficient for an older framer.
2. **Font size floor = 16 px (≈12 pt) on iPad for body text**; section titles bigger. NN/g's senior guidelines. Verso's current 12px section titles are below this.
3. **iPad PWA in 2026:** Add-to-Home-Screen is still manual with no install prompts (improved slightly in iOS 26 — home-screen sites now open as web apps by default). Push notifications require home-screen install first and don't work in EU. **No Background Sync API, no Periodic Background Sync, no Background Fetch — never coming.** Service workers do caching + push only.
4. **iOS Safari evicts storage after ~7 days of non-use** unless PWA-installed with persistent-storage permission. Don't promise drafts are saved forever.
5. **SMS beats push for customer notification.** The customer doesn't install the PWA; their phone gets SMS. Push is staff-only (V2+).
6. **Don't build a full offline dashboard.** Multi-user state means stale data is unsafe to show. Offline-draft for the intake form only, if at all.

**Demo-day fixes flagged (do before Phil visit):**
- Confirmation modal on `mark_ready` (currently fires Twilio SMS with no confirmation)
- Bump intake form font sizes (≥16 px), add required-field affordances (asterisk + label + top-of-form note + native `<input type="date">`)

**Receipt printing decision (gated on Phil question):**
- **Default recommendation: SMS the ticket summary URL.** Twilio is wired; near-zero per-send cost; matches "back-of-house tool not POS" positioning.
- **If Phil insists on paper:** Star Micronics TSP654II AirPrint (~$300–400), Ethernet + WLAN, Apple-certified, no driver needed on iPad. TSP847II for 112mm wider receipts.
- Question to ask: *"At intake today, what do you hand the customer? A copy of the paper ticket, a receipt, or nothing?"*

**Signature pad polish items (30-min audit pre-demo):**
- `touch-action: none` on the canvas CSS
- devicePixelRatio scaling so retina iPad doesn't render blurry
- Landscape/portrait redraw test
- Apple Pencil works out of the box; verify on demo iPad if Phil owns one

**Why this is in memory:** these rules generalize across Verso's UI surface — every future form, modal, or component decision should default to these numbers. Future Claude should not re-derive them from web search.

**How to apply:**
- When proposing UI changes, default to 44×44 touch targets and ≥16 px body text. Cite these without re-searching.
- When asked "should we add an offline mode," answer: draft-only for intake, never for dashboard.
- When the receipt-printing decision comes up, default to SMS; recommend Star TSP654II only on Phil's request.

Related: [[project-verso-state-2026-05-27]], [[project-verso-competitive-landscape]] (positioning), [[project-verso-domain-findings]].
