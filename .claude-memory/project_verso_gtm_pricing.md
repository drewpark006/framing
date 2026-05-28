---
name: project-verso-gtm-pricing
description: Verso GTM + pricing decisions 2026-05-27 — market 8,688 indie shops / $1B / pricing $49+$69 tiers / WCAF Orlando Feb 2026 / OCR is the conversion lever
metadata:
  type: project
---

**Workstream D findings, 2026-05-27.** Full brief at `~/.claude/plans/research/gtm-pricing.md`.

**Market size (durable):**
- US Custom Picture Framing industry ≈ **$1B revenue** (IBISWorld 2022, most recent public figure).
- **8,688 independent picture frame shops** in the US as of May 2025. Total locations 15,565 (44.2% chain-affiliated — Michaels 1,200+, Hobby Lobby 1,000+, FastFrame, etc).
- Top-3 states by shop count: CA (1,704), TX (1,099), NY (1,010). New York being top-3 helps Phil's Westchester pilot regionally.
- At 10% indie penetration × $49/mo blended = $511K ARR. Real money for an indie SaaS but small relative to vertical-SaaS standards.

**Pricing decision (proposed, not yet ratified by Drew):**
- **Solo Shop — $49/mo.** Single owner-framer setup, unlimited orders, signature pad, SMS via Twilio, photo-OCR intake. Single shop-branded Twilio sender. 30-day trial.
- **Two-Person Shop — $69/mo.** Adds multi-user login, framer-only view, per-user audit fields.
- No payment processing in either tier — concede that lane to Square/Stripe/Lightspeed.
- **Free for Phil**, indefinitely.
- 30-day opt-in (no CC) free trial. CC-required trials convert ~3× higher but tank signup volume — wrong tradeoff for first-customer-discovery phase.

**Why this pricing:** SMB SaaS floor is $25–30/mo (Jobber, Vagaro, FramingPOS). Mid-band $50–100. Premium $89+ (Lightspeed Basic, Virtual Framer $125). Verso sits in the gap between commodity-modern (FramingPOS) and premium-modern (Virtual Framer), 3× under Virtual Framer, 30% over FramingPOS to signal step-up in focus.

**Trial conversion target — durable benchmark:** 20% trial-to-paid year-1 (between the 8.9% opt-in 2026 baseline and the 31.4% opt-out 2026 average, lifted by the OCR-data-lock-in lever). Year-1 funnel goal: 50 trial signups → 10 paying shops → $6–8K ARR by month 12.

**The OCR-ingest wizard is the conversion lever.** During the trial, user scans their existing 20 paper tickets and now has 20 digital orders in Verso. Walking away from payment = walking away from their existing business in the system. Same dynamic as QuickBooks lock-in. **Protect this — do NOT expose OCR to non-trial users.**

**Distribution channel ranking (in order of leverage per dollar):**
1. **Direct outreach** — Drew calls/visits shops, starting with Phil's network + PPFA chapter intros. First 5–20 customers.
2. **WCAF Expo 2026** — Feb 27–Mar 1, 2026, **Rosen Shingle Creek, Orlando FL** (first time on East Coast; moved from Vegas). **Walk the floor**; talk to 30 shops in one weekend. Booth/sponsor only after 10+ paying customers.
3. **PPFA membership** — $150/year retail business + $62.50 per additional framer. Drew should join. Inside-the-tent ticket; chapter event access; Framers' Corner forum (warmer twin of The Grumble).
4. **Picture Framing Magazine article pitch** — story-led ("AI digitizes paper tickets in 5 minutes" case study with Phil), much higher fit than display ads.
5. **The Grumble / r/framing** — trust-building, not lead-gen. Don't astroturf.
6. **Distributor reps (Larson-Juhl, Studio Moulding, etc.)** — long game (12–24 months). Reps mentioning Verso to small shops compounds. Premature now; revisit at 10+ paying shops.

**Competitors at chain-customer level (NOT addressable for Verso):** Michaels (1,200+ stores), Hobby Lobby (1,000+, ~40–60% cheaper than Michaels on basic framing per industry comparisons). They handle custom framing internally — not customers. They are competition at the *consumer*'s decision layer, not in our sales pipeline.

**How to apply:**
- When asked about Verso pricing, cite $49 Solo / $69 Two-Person, 30-day opt-in trial, free for Phil. These are not final but should be the default position pending Drew sign-off.
- When asked about distribution, default to direct outreach + walk-the-floor at WCAF Orlando Feb 2026. Push back on premature booth/sponsorship spend.
- When the conversion-lever framing is questioned, point to the OCR-data-lock-in dynamic. This is the single most important product-led-growth feature.

Related: [[project-verso-state-2026-05-27]], [[project-verso-competitive-landscape]] (positioning thesis informs pricing), [[project-verso-ux-reliability-findings]] (the demo iPad has to actually work for the trial to start well).
