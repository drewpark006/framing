# where we are rn

Last updated: 2026-05-26 (Tue)

A living status doc. Updated on every commit. Read this first when picking the work back up after a gap.

## Current focus

Get the ready-for-pickup SMS landing on a real phone for the demos this weekend (Phil + Matt). Code path is done; blocked on US carrier compliance (A2P 10DLC).

## What's done

- Schema + UI matches Phil's paper ticket FR-248-3 (intake form, signature pad, /api/order/scan_ticket via Claude vision)
- Per-shop config refactor: `shop.json` holds shop name/address/tax/ticket-seq/twilio sender; `serve.py` loads at startup and exposes `GET /api/shop`
- ORDER_COLUMNS replaced with PRAGMA introspection (no more silent column drift on schema changes)
- Twilio SMS code path wired: `send_ready_sms` fires in a daemon thread after `mark_ready` returns 2xx, can't block the state transition. Phone normalizer handles common US formats. Skip paths log distinct `[sms skipped]` lines
- README rewritten from one line to a real onboarding doc
- ngrok tunnel running on `https://b25a-174-44-146-133.ngrok-free.app` for remote testing

## In flight

- Twilio A2P 10DLC Sole Proprietor registration, paused mid-form on Business Details step. About 4 screens deep; needs Drew's address, email, OTP'd mobile, then brand + campaign registration

## Queued (in order)

1. Finish A2P 10DLC Sole Proprietor registration in the Twilio console
2. Edit `send_ready_sms` body to append `Reply STOP to opt out.` (carriers want to see opt-out language; matches what we'll claim in the campaign sample messages)
3. Verify Drew's number (`+12034294606`) in Twilio Verified Caller IDs (trial accounts only deliver to verified destinations)
4. Smoke-test mark_ready end-to-end. Confirm Twilio Messages API shows `status=delivered` (not `undelivered`). Real phone buzz lands
5. After Phil signs on: consider migrating brand from "Drew Park (Sole Prop)" to "Thomson's Art & Frame (Standard)" using Phil's EIN
6. Scan accuracy validation against 5+ real Phil tickets (`scripts/scan_validate.py`); iterate `SCAN_PROMPT` if any critical field is below 80%
7. iPad sanity check: artwork photo flow + frame_size → frame_feet auto-fill

## Decisions made

- **Sole Proprietor brand under Drew's name**, not Standard under Thomson's. Why: don't have Phil's EIN, and asking for it before he's signed on looks like a tax-ID ask to a prospect. The message body still says "Thomson's Art & Frame" which carriers don't care about
- **914 US local long-code over toll-free.** Why: toll-free verification is 1-3 weeks, dead for Sunday. Local + A2P 10DLC sole prop approves in minutes to hours
- **Twilio sender (`twilio_from`) lives in `shop.json`, not env.** Why: per-shop, not a secret. SID + token stay in env because they ARE secrets
- **Build "demo mode" only as fallback.** Why: faking the SMS in the UI breaks the Manzano demo story for Matt (the whole point is showing state transition → real external side effect)
- **No back-of-house URL split.** Phil's production is counter + one framer sharing the same iPad. Split only when there are 2+ framers needing concurrent access
- **No JSON blob field for "v1 extensibility."** Defeats the typed Grove schema, which is the reason Grove was picked

## Open questions

- Is the Phil demo confirmed for Sunday 2026-05-31, or still tentative?
- Is Matt at the same Sunday session or a separate one?
- Does Thomson's have a real website? If yes, useful as the campaign URL instead of the github repo
- Will the A2P 10DLC campaign approve by Sunday morning? Sole prop brand is auto-approved, campaign vetting is faster for transactional but not guaranteed under 24h

## Demo timeline

- **Matt (Manzano angle):** v0a checkpoint was originally Thursday 2026-05-22. Status unclear — confirm if it happened and what feedback was. The SMS-actually-working is the value for Matt
- **Phil (customer):** original target was ~Monday 2026-05-25 (yesterday), now ~Sunday 2026-05-31 per the most recent execution plan. In-person at the shop

## Notes for future-Drew picking this back up

- Stack runs via `./start.sh --no-browser`. Banner shows shop name + Twilio enabled/disabled status
- Logs at `logs/{grove-app,grove-dev,serve}.log`. `serve.log` is line-buffered so `[sms sent]` / `[sms skipped]` lines appear in real time
- Smoke test pattern lives in the README under "Verification"
- The phone variant (`/`, `/new.html`, `/order.html`) is stale against the current schema. iPad/desktop counter at `/counter/` is the form factor
