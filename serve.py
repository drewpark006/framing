#!/usr/bin/env python3
"""
serve.py — Single-origin server for the Framing app.

  Serves static files from apps/main/.
  Proxies POST /api/order/* to grove-server (writes).
  Handles GET /api/orders + GET /api/order/<id> by reading framing.sqlite
  directly (reads through the projection — Grove handles writes, we handle reads).

Usage:
  python3 serve.py [PORT]               # default port 8080
"""

import http.server
import urllib.request
import urllib.error
import urllib.parse
import os
import sys
import sqlite3
import json

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "apps", "main")
DB_PATH = os.path.join(BASE_DIR, "framing.sqlite")

GROVE_SERVER = os.environ.get("GROVE_SERVER", "http://127.0.0.1:3000")
# Dev grove-server runs in --module mode and exposes the dev console endpoints
# (/api/_modules, /api/{module}/records, /api/{module}/_schema) that the
# --project server doesn't mount. Sharing the same SQLite DB.
DEV_GROVE_SERVER = os.environ.get("DEV_GROVE_SERVER", "http://127.0.0.1:3010")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080


# Columns on the `order` projection table that we want to expose to the UI.
# Everything else (pk, created_by, updated_by, etc.) is internal.
ORDER_COLUMNS = [
    "id", "created_at", "updated_at", "version",
    "customer_name", "customer_phone", "customer_email",
    "frame_style", "frame_color", "frame_width_in", "frame_height_in",
    "mat_spec", "glass_type", "mounting_type",
    "artwork_width_in", "artwork_height_in", "artwork_photo_url",
    "notes", "estimated_pickup_date",
    "deposit_amount", "final_balance",
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


def query_orders(stage=None, order_id=None):
    if not os.path.exists(DB_PATH):
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


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # Pretty URLs: / → index.html
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

        if path == "/healthz":
            self._send_json({"ok": True})
            return

        # Dev console proxy: forward introspection GETs to the dev grove-server.
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
        # All POSTs to /api/order/* proxy to grove-server.
        if not self.path.startswith("/api/order/"):
            self.send_error(404, "Not found")
            return

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b""

        url = GROVE_SERVER + self.path
        req = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": self.headers.get("Content-Type", "application/json")},
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

    def _send_json(self, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(200)
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
    print()
    print(f"  Open: http://127.0.0.1:{PORT}/")
    print()
    server = http.server.HTTPServer(("0.0.0.0", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
