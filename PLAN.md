# Framing Order Handoff App

Working title for a Manzano/Grove app that solves the front-of-house to back-of-house handoff problem in small custom framing shops.

## Status

Plan only. Do NOT execute or build until Drew gives explicit go-ahead.

## Context

After customer discovery with Phil Sohn (family friend, runs an art and framing shop) on 2026-05-20, the pain point is narrow and clear. Phil has about 20 active framing orders at any time, all at different stages, tracked by going through a stack of 3-copy paper tickets. He has 2 staff doing production. The pain is not just paper, it is the handoff. The framer in the back often does not have everything he needs from the ticket alone, so he has to ask Phil or guess.

Phil verbally confirmed this in his own words:

> "yea the framing side would help. just so the framer is on the same page even though he didn't take the order. and know what to do."

Phil tried a retail POS before. It was glitchy, did not make life easier, older workers struggled with it. He has files he could pull from but never finished the migration. He is not anti-tech, he is burned by past tech.

He soft committed to looking at a prototype.

## Product Positioning

Not a POS. Not an order tracker. The one liner:

**An app that keeps the order taker and the framer on the same page even when they are not talking.**

Tight scope. Buildable in weeks. Maps cleanly to Manzano.

## Design Constraints from Phil's Feedback

1. Has to be reliable (he got burned by glitchy software before)
2. Has to be genuinely easier than paper, not just modern looking
3. Older workers need to use it on day one with no training

The third constraint is the moat. Lots of people can build a framing app with features. Building one that an older framer can use immediately is hard, and that is what wins Phil and similar shops.

## MVP Scope

What Phil needs in V1:

1. Phil at the counter inputs a frame order on a phone or tablet (replaces writing on the 3-copy paper)
2. Framer in the back sees the full spec without asking Phil (replaces handing off the carbon copy)
3. Framer marks progress through stages
4. Phil sees all active orders and their status (replaces going through the paper stack)
5. SMS to customer when their order is ready for pickup

What NOT to build in V1:

1. Retail POS (foot traffic does not justify it, market is crowded)
2. Payments processing (Phil already handles that)
3. Supplier reorders
4. Pricing calculator (defer, custom framing pricing is complex)
5. Anything requiring full catalog data entry (the too much work problem from his last POS attempt)

## Manzano Implementation

### Records (Grove modules)

**`order`** (replaces the paper ticket):
- customer_name, customer_phone
- frame_style, frame_color, frame_dimensions_h, frame_dimensions_w
- mat_spec (free text or json for multi layer)
- glass_type (enum: regular, museum, anti_glare, uv, conservation)
- mounting_type (enum: float, dry_mount, hinge, other)
- artwork_dimensions
- artwork_photo_url
- notes (special instructions)
- estimated_pickup_date
- deposit_amount (number only, no payment processing v1)

**`customer`** (optional v1, can be denormalized into order to start):
- name, phone, email
- notes for repeat customers

### State machine on `order`

```
intake to cutting_materials to assembly to ready_for_pickup to picked_up to completed
```

Allowed only in that order. The only branch is `intake to cancelled`. Audit log records every transition with timestamp and actor.

### Invariants

1. An order in intake state needs at least frame_style, dimensions, customer info
2. An order cannot move past assembly without all spec fields filled (the framer never gets an incomplete spec)
3. An order cannot move to picked_up without deposit_amount recorded
4. Artwork photo must be uploaded before assembly stage (framer sees art before unwrapping)

### Workflows and agents

1. SMS to customer when status hits ready_for_pickup (Twilio integration)
2. Reminder ping if pickup has not happened in 14 days
3. End of day summary for Phil (what is in progress, what is ready, what is stalled)
4. Optional WOW demo agent that takes a photo of an existing paper ticket and extracts the fields into a new digital order (this is the AI angle that directly addresses Phil's "too much work" objection from his last POS attempt)

## GTM

### First pilot: Phil's shop

1. Build prototype in 2 to 3 weeks
2. Deliver in person, 30 minute setup session (do not email and hope)
3. Run alongside paper tickets for 1 to 2 weeks (parallel run, no risk to him)
4. Switch over fully if it sticks

### After Phil validates

1. Find 5 to 10 other small custom framing shops in Columbus area
2. Frame manufacturer distributor networks (Larson-Juhl, Studio Moulding) know small framers
3. PPFA (Professional Picture Framers Association) has member directories
4. Subreddits r/framing, FrameTek forums

### Revenue model

1. $50 to $100 per month per shop (small enough not to scare them, big enough to be real)
2. Or $25 per active order with a free tier
3. Phil free pilot for goodwill, convert after 2 to 3 months if it sticks

## What Carries Over from Sublet

The Grove migration substrate from `/Users/dpark/Manzano/sublet/` is universal:

1. `agents/lib/grove.js` (the loadRecords and callAction patterns) drops in directly, copy this file
2. `start.sh` structure for launching grove-server
3. The pattern of agents reading SQLite projections and POSTing actions
4. `interview.js` style conversational data entry for the order intake flow
5. Anthropic SDK plus Claude call patterns for the photo extraction agent

The airbnb sibling project at `/Users/dpark/Manzano/airbnb/` is the canonical Grove example. Read `airbnb/agents/auto-accept.js` and `airbnb/modules/reservation/module.grove` before writing anything new.

## Risks

1. **Phil might say yes but never use it.** Mitigation: build a minimal v0 first, show him in 1 week, do not sink 3 weeks of work first.
2. **Older workers might struggle even with careful design.** Mitigation: test with the actual framer, not just Phil. Sit with him during setup.
3. **Custom framing has long tail domain knowledge you do not have.** Mitigation: do not build a catalog, use free text v1. Catalog comes later when you have framer feedback.
4. **FrameReady exists as competition.** Mitigation: FrameReady costs $1000+ to start, is desktop only, and has a 2010s UX. You compete on simplicity and mobile, not features.
5. **Market is small (a few thousand independent framers in US).** Mitigation: profitable solo business or wedge into broader small business software later, not VC scale.
6. **Phil agrees but the framer is the actual daily user.** Mitigation: design FOR the framer first. Phil is the buyer, framer is the user.

## Open Questions

1. Phil's explicit yes to looking at a prototype (in progress as of 2026-05-20)
2. Does the framer have a phone or tablet he is willing to use
3. What is Phil's typical order value (determines monthly fee)
4. What is Phil's volume per week (orders, not active count)
5. Is there a second small framer in Drew's network for pilot 2

## Order of Operations (when given go-ahead)

1. Get Phil's explicit yes (already in progress)
2. Get 2 more framing shop conversations (ask Phil who he knows)
3. Spin up `/Users/dpark/Manzano/framing/` with `grove.toml` and `start.sh`
4. Build `modules/order/module.grove` with spec above
5. Build `modules/customer/module.grove`
6. Write `agents/intake.js` (order entry flow)
7. Write `agents/production.js` (framer side state transitions)
8. Build mobile-first web UI (Phil and framer will use phones)
9. Add SMS notifications via Twilio when order hits ready_for_pickup
10. Photo upload plus Claude vision agent that ingests existing paper tickets (the WOW demo)
11. Deliver to Phil in person, 30 minute setup session

## Relationship to Other Plans

This is a parallel discovery, not a replacement for the retreat plan at `/Users/dpark/.claude/plans/is-there-anyway-we-optimized-eagle.md`. The retreat plan still stands as the higher conviction pick because:

1. AAIV is a tight existing network for Drew
2. Retreat ACV could be higher (event registration is multi hundred per attendee)
3. Phil is one customer, not yet a market

After Matt's Thursday meeting (2026-05-22) and Fri-Mon validation conversations, decide:

1. Option A: framing as second parallel pilot, retreats as primary
2. Option B: framing as backup if AAIV validation does not land
3. Option C: pick one, park the other

## Customer Discovery Notes (for reference)

The conversation that led to this plan (paraphrased):

- Drew opened with: "im building software with ai, was wondering if you had a part of the business thats annoying recently. could be POS, scheduling, anything"
- Phil: "we have plenty of things that could be better. we're so old school. can you make apps?"
- Confirmed paper tickets for frame orders (3 copies: customer, shop, records)
- Confirmed 2 person production (Phil plus a back of house framer)
- 20 active orders at different stages, tracked by going through tickets
- "never lost" an order but the system is "really really old school. non digital"
- Tried a POS before, "everything was glitchy", "didn't make life easier like it should have", older workers struggled
- "the whole store needs to be inputted into a POS system. but it's too much work"
- He was talking about retail POS (barcode scanning erasers, etc.) when he said "too much work"
- When narrowed to just framing side: "yea the framing side would help. just so the framer is on the same page even though he didn't take the order"

Phil's emotional state by end of conversation: engaged, self-aware about being behind, soft-committed to looking at a prototype.
