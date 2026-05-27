---
name: reference-framing-location
description: Where the framing project lives and how to run it
metadata: 
  node_type: memory
  type: reference
  originSessionId: 40b83cf1-783c-4743-b3d3-f9ffd622a933
---

The Framing project is at `/Users/dpark/Manzano/framing/`.

**To run end-to-end (v0a as of 2026-05-20):**

1. `./start.sh` — boots all three services and opens the demo + dev console in the browser
   - grove-server (`--project`) on :3000 — writes via `apps/main/api/order/route.grove`
   - grove-server (`--module modules/order`) on :3010 — exposes dev console endpoints (`/api/_modules`, `/api/{module}/records`, `/api/{module}/_schema`)
   - `serve.py` on :8080 — static + GET projections (orders, events) + POST proxy to :3000 + dev-endpoint proxy to :3010
2. `node seed.js` — seeds 6 plausible orders across all stages (first time only; data persists)
3. Demo at http://127.0.0.1:8080/ , dev console at http://127.0.0.1:8080/dev.html
4. Ctrl+C stops everything (foreground only; backgrounded scripts only respond to SIGTERM due to bash's async signal handling)

Flags: `--no-browser`, `--no-db` (in-memory, dev console will be empty), `--app-port`, `--dev-port`, `--web-port`. Logs land in `logs/{grove-app,grove-dev,serve}.log`.

**Project structure:**
- `modules/order/module.grove` — the rich Grove module (record, enums, invariants, state machine, events, actions)
- `apps/main/api/order/route.grove` — POST routes mapping HTTP to grove actions
- `apps/main/index.html`, `new.html`, `order.html` — the three pages
- `apps/main/assets/style.css`, `app.js` — mobile-first UI
- `serve.py` — single-origin server: static + GET projections + POST proxy
- `seed.js` — sample data
- `agents/lib/grove.js` — read/write helpers (used by seed.js and any future agents)

**Grove binary:** `/Users/dpark/Manzano/grove/target/release/grove-server` (rebuilt 2026-05-20 with new typed-expression compiler pass). Source at `/Users/dpark/Manzano/grove/`.

**Reference projects** (older Grove syntax, may not compile against current grove binary): `/Users/dpark/Manzano/airbnb/`, `/Users/dpark/Manzano/sublet/`.
