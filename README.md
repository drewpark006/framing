# framing

A digital ticket for a small custom-frame shop. Replaces the 3-copy paper ticket book so the counter operator and the back-of-house framer stay on the same page even when they are not talking.

Built for Thomson's Art & Frame in White Plains, NY. State machine moves an order through intake, cutting materials, assembly, ready for pickup, and picked up. The customer gets a text the moment the frame is ready.

## Stack

Three processes share one SQLite file:

| process | port | role |
|---|---|---|
| `grove-server --project` | 3000 | handles writes via `apps/main/api/order/route.grove`, projects events into `framing.sqlite` |
| `grove-server --module`  | 3010 | dev console endpoints (`/api/_modules`, records, schema) |
| `serve.py`               | 8080 | static files, read API (queries the projection), proxy for writes, Claude vision for ticket scan, Twilio for ready-SMS |

Grove is the event-sourced source of truth; the SQLite table is a derived projection. All reads come from the projection, all writes go through Grove.

## Running

```bash
./start.sh                  # all three services + open browser
./start.sh --no-browser
./start.sh --no-db          # in-memory (dev console will be empty)
```

Logs land in `logs/{grove-app,grove-dev,serve}.log`. Ctrl-C stops everything.

## URLs

| path | what |
|---|---|
| `/counter/` | iPad/desktop counter dashboard (the demo) |
| `/counter/intake.html` | new ticket |
| `/counter/order.html?id=...` | order detail + stage actions |
| `/dev.html` | Grove dev console (raw event log, schema, records) |
| `/healthz` | health check |
| `/` | older phone variant (v0a); known stale against the current schema |

## Configuration

### shop.json

Per-shop config at the repo root. Single source of truth.

```json
{
  "shop_name": "Thomson's Art & Frame",
  "shop_address": "184 Mamaroneck Avenue, White Plains, NY 10601",
  "shop_phone": "(914) 949-4885",
  "shop_email": "info@thomsonsart.com",
  "ticket_seq_start": 45673,
  "tax_rate": 0.08375,
  "twilio_from": ""
}
```

Edit and restart `serve.py` to apply. `serve.py` fails fast if this file is missing or invalid.

### Environment

| var | what for | required |
|---|---|---|
| `ANTHROPIC_API_KEY` | `/api/order/scan_ticket` (paper-ticket OCR via Claude vision) | no, but the endpoint 500s without it |
| `TWILIO_SID`, `TWILIO_TOKEN` | ready-for-pickup SMS | no, missing leaves a clean `[sms skipped]` in `logs/serve.log` |

The Twilio sending number is NOT in env. It lives in `shop.json` under `twilio_from` because it is per-shop, not a secret.

## Key files

| file | what |
|---|---|
| `modules/order/module.grove` | the order aggregate (schema, events, state machine, invariants) |
| `apps/main/api/order/route.grove` | HTTP bindings, `POST /api/order/<action>` to an aggregate action |
| `serve.py` | static + read + proxy + scan + SMS |
| `apps/main/assets/counter.js` | iPad/desktop UI: three controllers (dashboard, intake, order detail) |
| `apps/main/assets/counter.css` | styles for the same |
| `shop.json` | per-shop config |
| `scripts/scan_validate.py` | drive scan endpoint over a folder of ticket photos, write per-field accuracy markdown |

## Scan accuracy workflow

The intake page has a "Scan ticket" button that sends a photo of a paper ticket to `/api/order/scan_ticket`, which calls Claude vision and pre-fills the digital ticket from the extracted fields. To check accuracy before relying on it in front of a customer:

1. Drop ticket photos in `scripts/scan_samples/` (jpg / png / webp).
2. With the stack running and `ANTHROPIC_API_KEY` set, run:
   ```bash
   python3 scripts/scan_validate.py
   ```
3. Open `scripts/scan_accuracy.md` and hand-fill the "Ground truth" column for each ticket from the photo. The threshold for relying on scan in production is roughly 80% on the critical fields (customer name + phone, frame size + molding, mat color, glass kind, dates, deposit, total).

## Public access for testing

To expose the local stack to a phone or remote tester:

```bash
ngrok http 8080
```

The first hit shows ngrok's interstitial; click "Visit Site" once.

## What's not in v1

- Multi-tenant. One shop on one db file.
- Auth. Anything on `:8080` can write to `:3000`.
- Vendor catalog. Frame moldings and mat colors are short hardcoded preset lists in `counter.js`.
- A back-of-house URL. Production is the counter and one framer sharing the same station; split when there is demand.
- Phone variant (`/`, `/new.html`, `/order.html`) is older than the current schema and will error in places. The iPad/desktop counter is the current form factor.
