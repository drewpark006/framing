#!/usr/bin/env python3
"""
serve.py — Single-origin server for the Framing app.

  Serves static files from apps/main/.
  Proxies POST /api/order/* to grove-server (writes).
  Handles GET /api/orders + GET /api/order/<id> by reading framing.sqlite
  directly (reads through the projection — Grove handles writes, we handle reads).
  Auto-assigns ticket_no on create (next-after-MAX from projection).
  Handles POST /api/order/scan_ticket by calling the Anthropic vision API.

Usage:
  python3 serve.py [PORT]               # default port 8080

Requires ANTHROPIC_API_KEY in the environment for /api/order/scan_ticket.
"""

import http.server
import urllib.request
import urllib.error
import urllib.parse
import os
import re
import sys
import sqlite3
import json
import base64

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "apps", "main")
DB_PATH = os.path.join(BASE_DIR, "framing.sqlite")

GROVE_SERVER = os.environ.get("GROVE_SERVER", "http://127.0.0.1:3000")
DEV_GROVE_SERVER = os.environ.get("DEV_GROVE_SERVER", "http://127.0.0.1:3010")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080

# Start the ticket sequence just past Phil's sample (0045672). Real shop's
# pad sample was 0045672, so the first ticket entered through the app reads
# 0045673 — feels continuous with his existing paper book.
TICKET_START = 45673


ORDER_COLUMNS = [
    "id", "created_at", "updated_at", "version",
    "ticket_no",
    "customer_name", "customer_phone", "customer_address", "customer_zip",
    "customer_email",
    "date_received", "date_promised",
    "description_of_item", "declared_value",
    "frame_size", "frame_molding_no", "frame_feet", "frame_price_per_foot",
    "frame_amount",
    "liner_size", "liner_no", "liner_feet", "liner_price_per_foot",
    "liner_amount",
    "mat1_type", "mat1_color",
    "mat1_margin_top_in", "mat1_margin_sides_in", "mat1_margin_bottom_in",
    "mat1_amount",
    "mat2_type", "mat2_color",
    "mat2_margin_top_in", "mat2_margin_sides_in", "mat2_margin_bottom_in",
    "mat2_amount",
    "glass_kind", "glass_amount",
    "mount_kind", "mount_backer_type", "mount_amount",
    "hanger_kind", "hanger_amount",
    "service_stretch", "service_repair", "service_block", "service_fitting",
    "services_amount",
    "misc_supplies", "misc_supplies_amount",
    "special_instructions",
    "subtotal", "tax_amount", "total", "deposit_amount", "balance_due",
    "customer_signature_png", "customer_signed_at",
    "artwork_photo_url",
    "stage",
]


def query_events(resource="order", limit=500):
    if not os.path.exists(DB_PATH):
        return []
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT resource, aggregate_id, stream_version, event_name, payload_json "
            "FROM grove_events WHERE resource = ? "
            "ORDER BY aggregate_id, stream_version LIMIT ?",
            (resource, limit),
        ).fetchall()
    except sqlite3.OperationalError as e:
        print(f"  [db error] {e}")
        return []
    finally:
        conn.close()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["payload"] = json.loads(d.pop("payload_json"))
        except Exception:
            d["payload"] = None
        out.append(d)
    return out


def order_table_exists():
    if not os.path.exists(DB_PATH):
        return False
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    try:
        row = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='order'"
        ).fetchone()
        return row is not None
    except sqlite3.OperationalError:
        return False
    finally:
        conn.close()


def query_orders(stage=None, order_id=None):
    if not order_table_exists():
        return []
    cols = ", ".join(f'"{c}"' for c in ORDER_COLUMNS)
    sql = f'SELECT {cols} FROM "order"'
    params = []
    where = []
    if stage:
        where.append("stage = ?")
        params.append(stage)
    if order_id:
        where.append("id = ?")
        params.append(order_id)
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY created_at DESC"

    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(sql, params).fetchall()
    except sqlite3.OperationalError as e:
        print(f"  [db error] {e}")
        return []
    finally:
        conn.close()

    return [dict(r) for r in rows]


def next_ticket_no():
    """Pick the next sequential ticket_no by reading the projection.
    Single-station shop, no race concerns for v1."""
    if not order_table_exists():
        return f"{TICKET_START:07d}"
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    try:
        row = conn.execute(
            'SELECT MAX(CAST(ticket_no AS INTEGER)) FROM "order"'
        ).fetchone()
        max_n = row[0] if row else None
    except sqlite3.OperationalError:
        max_n = None
    finally:
        conn.close()
    if max_n is None or max_n < TICKET_START - 1:
        return f"{TICKET_START:07d}"
    return f"{int(max_n) + 1:07d}"


SCAN_PROMPT = """\
You are reading a paper frame-order ticket from Thomson's Art & Frame.
Extract the fields below and return STRICT JSON only (no prose, no code fences).
Use null for missing fields, never a string like "blank" or "?".
Numbers as numbers, not strings. Checkboxes return the selected enum value.

Fields to extract:
- customer_name, customer_phone, customer_address, customer_zip,
  date_received (ISO YYYY-MM-DD), date_promised (ISO YYYY-MM-DD),
  description_of_item, declared_value
- frame_size, frame_molding_no, frame_feet, frame_price_per_foot, frame_amount
- liner_size, liner_no, liner_feet, liner_price_per_foot, liner_amount
- mat1_type, mat1_color, mat1_margin_top_in, mat1_margin_sides_in,
  mat1_margin_bottom_in, mat1_amount
- mat2_type, mat2_color, mat2_margin_top_in, mat2_margin_sides_in,
  mat2_margin_bottom_in, mat2_amount
- glass_kind (one of: regular, non_glare, plexi, acrylic, mirror), glass_amount
- mount_kind (one of: dry, wet, museum), mount_backer_type, mount_amount
- hanger_kind (one of: wire, easel, sawtooth), hanger_amount
- service_stretch, service_repair, service_block, service_fitting (booleans)
- services_amount
- misc_supplies, misc_supplies_amount
- special_instructions
- subtotal, tax_amount, total, deposit_amount, balance_due
- ticket_no (string, zero-padded if visible)

Do NOT extract any credit card number; this app is not a POS.
Do NOT attempt to extract the customer signature; that is collected
on the iPad after scan.

If a date is written in MM/DD/YY, return the ISO form using year 2026
unless the year digits clearly say otherwise.

Return one top-level JSON object with exactly these keys.
"""


def call_anthropic_vision(image_b64, media_type):
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set in environment")

    body = {
        "model": "claude-opus-4-7",
        "max_tokens": 4096,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": image_b64,
                        },
                    },
                    {"type": "text", "text": SCAN_PROMPT},
                ],
            }
        ],
    }
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8")
    parsed = json.loads(raw)
    parts = parsed.get("content", [])
    text = ""
    for p in parts:
        if p.get("type") == "text":
            text += p.get("text", "")
    return text.strip()


def parse_scan_response(text):
    """The model is asked for strict JSON but sometimes wraps it in
    ```json ... ``` fences or adds a prose preamble. Be lenient."""
    cleaned = text.strip()
    # Strip code fences if present.
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", cleaned, re.DOTALL)
    if fence:
        cleaned = fence.group(1).strip()
    # Find the first { ... last } if there is leading prose.
    if not cleaned.startswith("{"):
        first = cleaned.find("{")
        last = cleaned.rfind("}")
        if first != -1 and last != -1 and last > first:
            cleaned = cleaned[first:last + 1]
    return json.loads(cleaned)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/":
            self.path = "/index.html"
            return super().do_GET()

        if path == "/api/orders":
            params = urllib.parse.parse_qs(parsed.query)
            stage = params.get("stage", [None])[0]
            self._send_json({"orders": query_orders(stage=stage)})
            return

        if path == "/api/_events":
            self._send_json({"events": query_events()})
            return

        if path == "/api/_next_ticket":
            self._send_json({"ticket_no": next_ticket_no()})
            return

        if path == "/healthz":
            self._send_json({"ok": True})
            return

        if path == "/api/_modules" or path.endswith("/records") or path.endswith("/_schema"):
            self._proxy_get(DEV_GROVE_SERVER + path + (("?" + parsed.query) if parsed.query else ""))
            return

        if path.startswith("/api/order/"):
            order_id = path[len("/api/order/"):]
            rows = query_orders(order_id=order_id)
            if not rows:
                self.send_error(404, "Order not found")
                return
            self._send_json(rows[0])
            return

        super().do_GET()

    def _proxy_get(self, url):
        try:
            with urllib.request.urlopen(url) as resp:
                body = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except urllib.error.HTTPError as e:
            body = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", e.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except urllib.error.URLError as e:
            self.send_error(502, f"dev grove-server unavailable: {e.reason}")

    def do_POST(self):
        if not self.path.startswith("/api/order/"):
            self.send_error(404, "Not found")
            return

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b""

        # Special-case: scan_ticket is handled here, not proxied to grove-server.
        if self.path == "/api/order/scan_ticket":
            self._handle_scan_ticket(body)
            return

        # On create, inject the next ticket_no from the projection so the
        # client can't pick it (or duplicate one). The body may already
        # have a ticket_no field from the scan flow — we override it.
        if self.path == "/api/order/create":
            try:
                payload = json.loads(body.decode("utf-8")) if body else {}
            except json.JSONDecodeError:
                self.send_error(400, "Invalid JSON")
                return
            payload["ticket_no"] = next_ticket_no()
            body = json.dumps(payload).encode("utf-8")

        url = GROVE_SERVER + self.path
        req = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(req) as resp:
                resp_body = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.send_header("Content-Length", str(len(resp_body)))
                self.end_headers()
                self.wfile.write(resp_body)
        except urllib.error.HTTPError as e:
            resp_body = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", e.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(resp_body)))
            self.end_headers()
            self.wfile.write(resp_body)
        except urllib.error.URLError as e:
            self.send_error(502, f"grove-server unavailable: {e.reason}")

    def _handle_scan_ticket(self, body):
        try:
            payload = json.loads(body.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_json({"ok": False, "error": "Invalid JSON in request body"}, status=400)
            return
        data_url = payload.get("image_data_url", "")
        if not data_url or not isinstance(data_url, str):
            self._send_json({"ok": False, "error": "Missing image_data_url"}, status=400)
            return
        # Parse data URL: "data:image/jpeg;base64,XXXX..."
        m = re.match(r"^data:(image/[a-z0-9.+-]+);base64,(.+)$", data_url, re.IGNORECASE | re.DOTALL)
        if not m:
            self._send_json({"ok": False, "error": "Unsupported image format"}, status=400)
            return
        media_type = m.group(1).lower()
        image_b64 = m.group(2).strip()
        try:
            base64.b64decode(image_b64, validate=True)
        except Exception:
            self._send_json({"ok": False, "error": "Invalid base64 payload"}, status=400)
            return

        try:
            text = call_anthropic_vision(image_b64, media_type)
        except RuntimeError as e:
            self._send_json({"ok": False, "error": str(e)}, status=500)
            return
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            self._send_json({
                "ok": False,
                "error": f"Anthropic API error {e.code}",
                "detail": err_body[:500],
            }, status=502)
            return
        except Exception as e:
            self._send_json({"ok": False, "error": f"Vision call failed: {e}"}, status=502)
            return

        try:
            fields = parse_scan_response(text)
        except (json.JSONDecodeError, ValueError) as e:
            self._send_json({
                "ok": False,
                "error": "parse failed",
                "detail": str(e),
                "raw": text[:1500],
            }, status=200)
            return

        # Never trust scan to carry a signature; UI captures it live.
        fields["customer_signature_png"] = None
        fields["customer_signed_at"] = None
        self._send_json({"ok": True, "fields": fields})

    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(f"  {self.address_string()} {fmt % args}")


if __name__ == "__main__":
    print("┌─────────────────────────────────────────────┐")
    print("│        Framing app — proxy server           │")
    print("└─────────────────────────────────────────────┘")
    print()
    print(f"  Listening    : http://0.0.0.0:{PORT}  (reachable on LAN)")
    print(f"  Static       : {STATIC_DIR}")
    print(f"  Database     : {DB_PATH}")
    print(f"  Grove server : {GROVE_SERVER}")
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("  WARN         : ANTHROPIC_API_KEY not set — /api/order/scan_ticket will 500")
    print()
    print(f"  Open: http://127.0.0.1:{PORT}/")
    print()
    server = http.server.HTTPServer(("0.0.0.0", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
