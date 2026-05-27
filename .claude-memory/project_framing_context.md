---
name: project-framing-context
description: "The framing-order handoff app — customer Phil Sohn, current scope, demo timeline"
metadata: 
  node_type: memory
  type: project
  originSessionId: 40b83cf1-783c-4743-b3d3-f9ffd622a933
---

The Framing Order Handoff App is a Manzano/Grove project Drew is building for Phil Sohn (Drew's family friend), an art and framing shop owner.

**Customer pain:** Phil's framer in the back doesn't have everything he needs from the paper ticket alone and has to ask Phil or guess. 20 active orders at various stages, all tracked on 3-copy paper.

**Quote (Phil, 2026-05-20):** "yea the framing side would help. just so the framer is on the same page even though he didn't take the order. and know what to do."

**Phil's previous POS attempt failed because:** day-to-day use was glitchy, older workers struggled, and the "input the whole store" cost wasn't justified by their foot traffic. The "too much work" objection was about cataloging retail inventory, NOT about per-order intake.

**Two-checkpoint demo plan within the week of 2026-05-20:**
1. v0a: Show Matt on Thursday 2026-05-22 (Manzano demo angle — built fast on Grove, state machine, invariants)
2. v0b: Show Phil ~Monday 2026-05-25 (add photo-OCR migration tool to ingest his existing 20 paper tickets in 5 minutes — that addresses the switching cost objection)

**v0a built 2026-05-20** with: order module.grove (rich Grove, record, enums, invariants, state machine, validate, events, actions), route.grove for HTTP, mobile-first HTML/CSS/JS, serve.py proxy, seed.js with 6 plausible orders.

**v0b NOT YET BUILT:** photo OCR ingest agent, SMS to customer on ready_for_pickup.

**Scope is ticket formatting, not POS / sales (clarified 2026-05-22).** The app digitizes Phil's paper ticket form FR-248-3 (sample sequence 0045672) so the back-of-house framer has the full job spec. It is NOT a POS register and does NOT need to handle card processing. Drop the credit card field entirely; Phil can keep that on a separate slip if needed. Customer signature IS captured live on the iPad (turn the iPad to face the customer; they sign with a finger). The authorization paragraph from the paper ticket renders above the signature pad.

**How to apply:** When Phil says "POS" he means the failed in-store register attempt. The framing app should never grow toward sales / card processing / inventory cataloging features. Stay focused on the per-order intake-to-pickup flow.

**Why:** Phil is the buyer but his back-of-house framer is the daily user. Design for the framer first. Older worker, no training, must be reliable. See [[reference-framing-location]] for project paths.

**How to apply:** When Drew comes back to continue work, the next move is either (a) polish v0a for Matt's Thursday demo, or (b) start v0b (photo OCR ingest + SMS). Phil + 1 framer is the production staffing (not 2 framers).
