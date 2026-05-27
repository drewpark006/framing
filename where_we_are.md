# where we are rn

Last updated: 2026-05-27 (Wed)

A living status doc. Updated on every commit. Read this first when picking the work back up after a gap.

## Current focus

Ship a hosted, branded Verso app by Wed 2026-05-27 so Matt sees a real product. Code-side packaging just landed (Docker + fly.toml + login wall + Verso branding + PWA). Deploy is gated on Drew building a Linux grove-server binary and running fly deploy.

Demo URL for Wednesday: `verso-thomson-art.fly.dev`. The real Verso domain is deferred — versohq.com, verso.com, verso.studio are all taken. Pick the real URL Friday after Matt's reaction and Phil's sign-on. App chrome already reads "Verso" regardless of the URL.

A2P 10DLC / SMS work is still queued for Phil-Sunday but it's the slower track. Verso launch is the urgent one.

## What's done

- Schema + UI matches Phil's paper ticket FR-248-3 (intake, signature pad, /api/order/scan_ticket via Claude vision)
- Per-shop config: `shop.json` holds shop name/address/tax/ticket-seq/twilio sender; `serve.py` loads at startup and exposes `GET /api/shop`
- ORDER_COLUMNS uses PRAGMA introspection (no silent column drift on schema changes)
- Twilio SMS code path wired: `send_ready_sms` fires in a daemon thread after `mark_ready` returns 2xx. Phone normalizer handles common US formats. Skip paths log distinct `[sms skipped]` lines
- README rewritten as a real onboarding doc
- **Verso packaging landed:**
  - `Dockerfile` (multi-stage, python:3.14-slim runtime, grove-server copied from build context as `./grove-server`)
  - `entrypoint.sh` launches grove-server on 3000 + 3010 in background and execs `serve.py 8080` in foreground
  - `fly.toml` for app `verso-thomson-art`, region ewr, volume mount at /data
  - `.dockerignore` excludes git, sqlite, .venv, scan_samples
  - `serve.py` login wall: scrypt-verified `SHOP_USER` + `SHOP_PASS_HASH`, HMAC-signed `verso_session` cookie (90-day, httponly secure samesite=lax), middleware gates everything except `/login`, `/api/login`, `/healthz`, `/manifest.webmanifest`, `/assets/*`. Refuses to start without `SHOP_USER` + `SHOP_PASS_HASH` + `SECRET_KEY` env vars
  - `serve.py` `DB_PATH` now reads from env (default unchanged for local dev)
  - `apps/main/login.html` Verso-branded sign-in page on the dark POS palette
  - `scripts/hash_password.py` generates the scrypt-format hash for `SHOP_PASS_HASH`
  - PWA: `apps/main/manifest.webmanifest`, V-mark icons at 180px/512px + favicon, head tags + apple-mobile-web-app meta on all counter pages and login
  - Branding pass: all counter HTML chrome reads "Verso". Shop name "Thomson's Art & Frame" stays where it belongs (ticket header, SMS body)
- **Live cross-device sync landed:** `livePoll` helper in `counter.js` polls /api/orders (dashboard) and /api/order/&lt;id&gt; (detail) every 5s, hash-compares to skip re-render when nothing changed, and skips entirely when the tab is hidden. Header gets a "Synced just now" indicator with a green flash dot when new data lands. Smoke-tested: a single /counter/ load produces one immediate fetch then ~one every 5s; order detail does the same against /api/order/&lt;id&gt;. Intake page does NOT poll (would clobber typed input). Script tags carry a `?v=livesync` cache buster so the first deploy/refresh actually picks up the new bundle

## In flight

- Twilio A2P 10DLC Sole Proprietor registration, paused mid-form on Business Details step. About 4 screens deep; needs Drew's address, email, OTP'd mobile, then brand + campaign registration

## Queued (in order, Verso launch first)

1. **Drew:** cross-compile grove-server for Linux. Prereqs: start Docker Desktop, `ssh-add ~/.ssh/id_github`. Then `./scripts/build-grove-linux.sh` (~30 min via qemu). Outputs `./grove-server` (linux/amd64 binary) in framing root
2. **Drew:** `fly launch --no-deploy` to register the app, `fly volumes create framing_data --region ewr --size 1`
3. **Drew:** `fly secrets set ANTHROPIC_API_KEY=... TWILIO_SID=... TWILIO_TOKEN=... TWILIO_FROM=+1914... SHOP_USER=... SHOP_PASS_HASH=$(python3 scripts/hash_password.py) SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))") DB_PATH=/data/framing.db`
4. **Drew:** `fly deploy`; demo URL is `verso-thomson-art.fly.dev`
5. **Drew:** smoke-test on iPad: Add to Home Screen, sign in, create a ticket end-to-end
6. Post-Matt: pick a real domain (tryverso.com, verso.app if available, or something else), register, point DNS at Fly, `fly certs create <domain>`
7. Finish A2P 10DLC Sole Proprietor registration in the Twilio console
8. Edit `send_ready_sms` body to append `Reply STOP to opt out.`
9. Verify Drew's number (`+12034294606`) in Twilio Verified Caller IDs
10. Smoke-test mark_ready end-to-end on the hosted Fly app once SMS is live
11. Scan accuracy validation against 5+ real Phil tickets (`scripts/scan_validate.py`); iterate `SCAN_PROMPT` if any critical field is below 80%
12. iPad sanity check: artwork photo flow + frame_size → frame_feet auto-fill

## Decisions made

- **Product brand is "Verso", domain deferred.** Why: bare-word "Verso" carries the brand equity (trademark filing is on "VERSO", Classes 9 + 42). verso.com is held by a Belgian retailer; versohq.com, verso.studio, verso.com all taken on 2026-05-26 search. Tomorrow demo runs from `verso-thomson-art.fly.dev`; pick the real URL Friday once Matt and Phil have weighed in
- **App chrome says "Verso", shop name "Thomson's Art & Frame" stays on tickets and SMS body.** Why: Verso is the product Matt sees, Thomson's is the shop on the printed customer-facing artifacts
- **One Fly app per shop for v1, no subdomain routing yet.** Why: only one shop (Phil's). Multi-shop slug routing waits for shop #2
- **Shared password per instance, no sign-up flow.** Why: Drew creates accounts manually, one shop = one credential pair. Sessions are HMAC-signed httponly secure cookies with 90-day expiry
- **Sole Proprietor brand under Drew's name**, not Standard under Thomson's, for A2P. Why: don't have Phil's EIN, and asking for it before he's signed on looks like a tax-ID ask to a prospect
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

- Stack runs via `./start.sh --no-browser`. Banner shows shop name + Twilio enabled/disabled status. Local dev needs `SHOP_USER` + `SHOP_PASS_HASH` + `SECRET_KEY` env vars set or serve.py refuses to start (generate the hash with `python3 scripts/hash_password.py`)
- Logs at `logs/{grove-app,grove-dev,serve}.log`. `serve.log` is line-buffered so `[sms sent]` / `[sms skipped]` lines appear in real time
- Smoke test pattern lives in the README under "Verification"
- The phone variant (`/`, `/new.html`, `/order.html`) is stale against the current schema. iPad/desktop counter at `/counter/` is the form factor
- For Fly deploy: the grove-server binary in `/Users/dpark/Manzano/grove/target/release/grove-server` is darwin/arm64. Must rebuild for Linux first (see queued #2) and copy to `./grove-server` in the framing repo root before `docker build .`
- Cross-machine sync (Mac ↔ Windows): the repo is the sync mechanism. Claude's auto-memory lives in `./.claude-memory/` and is symlinked into `~/.claude/projects/-Users-dpark-Manzano-framing/memory` on each machine. Daily flow: `git pull` when sitting down, `git push` before standing up. Only one machine in use at a time, so no conflict risk
