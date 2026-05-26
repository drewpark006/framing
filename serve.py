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
import threading
import hashlib
import hmac
import secrets
import time
from http.cookies import SimpleCookie

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "apps", "main")
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "framing.sqlite"))
SHOP_PATH = os.path.join(BASE_DIR, "shop.json")

GROVE_SERVER = os.environ.get("GROVE_SERVER", "http://127.0.0.1:3000")
DEV_GROVE_SERVER = os.environ.get("DEV_GROVE_SERVER", "http://127.0.0.1:3010")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080

# Twilio creds are secrets, so they stay in env. The sender phone number
# (twilio_from) is per-shop config and lives in shop.json.
TWILIO_SID = os.environ.get("TWILIO_SID", "").strip()
TWILIO_TOKEN = os.environ.get("TWILIO_TOKEN", "").strip()

# ---- Auth config -------------------------------------------------------------
#
# Verso runs behind a single shared shop login. We verify a username + scrypt
# hash from env, then issue an HMAC-signed session cookie. Refuse to start
# without all three secrets so prod can't accidentally come up wide open.
#
# SHOP_USER         — single shop username (plain string)
# SHOP_PASS_HASH    — scrypt hash string produced by scripts/hash_password.py:
#                       scrypt$<n>$<r>$<p>$<salt_b64>$<hash_b64>
# SECRET_KEY        — random string used to HMAC the session cookie

SHOP_USER = os.environ.get("SHOP_USER", "").strip()
SHOP_PASS_HASH = os.environ.get("SHOP_PASS_HASH", "").strip()
SECRET_KEY = os.environ.get("SECRET_KEY", "").strip()

SESSION_COOKIE = "verso_session"
SESSION_TTL_SECONDS = 90 * 24 * 60 * 60  # 90 days

# Paths exempt from auth. Anything not in this list / not under one of the
# prefixes requires a valid session cookie. /login and /api/login are public
# so the user can actually sign in; /healthz is public so Fly health checks
# don't 302 to /login (a 302 is not a healthy probe).
PUBLIC_EXACT = {"/login", "/api/login", "/healthz", "/manifest.webmanifest"}
PUBLIC_PREFIXES = ("/assets/",)
PUBLIC_EXACT_EXTRA = set()


def verify_password(password: str, stored: str) -> bool:
    """Verify a password against a stored scrypt hash string of the form
    scrypt$<n>$<r>$<p>$<salt_b64>$<hash_b64>. Constant-time compare."""
    if not stored or not password:
        return False
    parts = stored.split("$")
    if len(parts) != 6 or parts[0] != "scrypt":
        return False
    try:
        n = int(parts[1])
        r = int(parts[2])
        p = int(parts[3])
        salt = base64.b64decode(parts[4])
        expected = base64.b64decode(parts[5])
    except (ValueError, base64.binascii.Error):
        return False
    try:
        dk = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=n, r=r, p=p,
            dklen=len(expected),
        )
    except (ValueError, MemoryError):
        return False
    return hmac.compare_digest(dk, expected)


def _sign(payload: str) -> str:
    return hmac.new(
        SECRET_KEY.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256
    ).hexdigest()


def make_session_token(user: str, ttl_seconds: int = SESSION_TTL_SECONDS) -> str:
    """Cookie value format: '{user}|{expiry_unix}|{hmac_hex}'."""
    expiry = int(time.time()) + ttl_seconds
    payload = f"{user}|{expiry}"
    return f"{payload}|{_sign(payload)}"


def verify_session_token(token: str) -> bool:
    if not token or not SECRET_KEY:
        return False
    parts = token.split("|")
    if len(parts) != 3:
        return False
    user, expiry_s, sig = parts
    if user != SHOP_USER:
        return False
    try:
        expiry = int(expiry_s)
    except ValueError:
        return False
    if expiry < int(time.time()):
        return False
    expected = _sign(f"{user}|{expiry}")
    return hmac.compare_digest(expected, sig)


def is_public_path(path: str) -> bool:
    if path in PUBLIC_EXACT or path in PUBLIC_EXACT_EXTRA:
        return True
    for prefix in PUBLIC_PREFIXES:
        if path.startswith(prefix):
            return True
    return False


def request_is_authed(handler) -> bool:
    raw_cookie = handler.headers.get("Cookie", "")
    if not raw_cookie:
        return False
    try:
        jar = SimpleCookie()
        jar.load(raw_cookie)
    except Exception:
        return False
    morsel = jar.get(SESSION_COOKIE)
    if not morsel:
        return False
    return verify_session_token(morsel.value)


def _load_shop():
    try:
        with open(SHOP_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise SystemExit(f"Error: {SHOP_PATH} not found. Create it before starting.")
    except json.JSONDecodeError as e:
        raise SystemExit(f"Error: {SHOP_PATH} is not valid JSON: {e}")


SHOP = _load_shop()


_order_columns_cache = None


def _load_order_columns():
    """Read column names from the projection via PRAGMA. Cached on first
    successful read so a fresh db that picks up later still works."""
    global _order_columns_cache
    if _order_columns_cache:
        return _order_columns_cache
    if not os.path.exists(DB_PATH):
        return []
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    try:
        rows = conn.execute('PRAGMA table_info("order")').fetchall()
    except sqlite3.OperationalError:
        return []
    finally:
        conn.close()
    cols = [r[1] for r in rows]
    if cols:
        _order_columns_cache = cols
    return cols


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
    columns = _load_order_columns()
    if not columns:
        return []
    cols = ", ".join(f'"{c}"' for c in columns)
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
    start = int(SHOP.get("ticket_seq_start", 1))
    if not order_table_exists():
        return f"{start:07d}"
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
    if max_n is None or max_n < start - 1:
        return f"{start:07d}"
    return f"{int(max_n) + 1:07d}"


SCAN_PROMPT = f"""\
You are reading a paper frame-order ticket from {SHOP.get("shop_name", "a custom framing shop")}.
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


def normalize_phone(raw):
    """Normalize a customer phone to E.164 (+1...) for Twilio. Strips
    non-digits, prepends +1 for a 10-digit US number, or + for 11 digits
    starting with 1. Pass-through if it already starts with +. Returns
    None if it can't be normalized — caller skips SMS in that case."""
    if not raw:
        return None
    s = str(raw).strip()
    if not s:
        return None
    if s.startswith("+"):
        return s
    digits = "".join(c for c in s if c.isdigit())
    if len(digits) == 10:
        return "+1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits
    return None


def send_ready_sms(customer_phone, customer_name, ticket_no):
    """Send a ready-for-pickup SMS via Twilio. Skip cleanly on any
    missing input and log one line. Fire-and-forget; failure must not
    propagate to the caller."""
    twilio_from = SHOP.get("twilio_from", "").strip()
    if not TWILIO_SID:
        print(f"  [sms skipped] missing TWILIO_SID (ticket #{ticket_no})")
        return
    if not TWILIO_TOKEN:
        print(f"  [sms skipped] missing TWILIO_TOKEN (ticket #{ticket_no})")
        return
    if not twilio_from:
        print(f"  [sms skipped] no shop.twilio_from configured (ticket #{ticket_no})")
        return
    to = normalize_phone(customer_phone)
    if not to:
        print(f"  [sms skipped] no phone for ticket #{ticket_no}")
        return

    shop_name = SHOP.get("shop_name", "the shop")
    body_text = (
        f"Your frame is ready for pickup at {shop_name}. "
        f"Bring your ticket #{ticket_no}."
    )
    form = urllib.parse.urlencode({
        "To": to,
        "From": twilio_from,
        "Body": body_text,
    }).encode("utf-8")
    auth = base64.b64encode(f"{TWILIO_SID}:{TWILIO_TOKEN}".encode("utf-8")).decode("ascii")
    url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Messages.json"
    req = urllib.request.Request(
        url,
        data=form,
        headers={
            "Authorization": f"Basic {auth}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
        print(f"  [sms sent] to {to} for ticket #{ticket_no}")
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")[:300]
        print(f"  [sms failed] Twilio {e.code} for ticket #{ticket_no}: {err_body}")
    except Exception as e:
        print(f"  [sms failed] for ticket #{ticket_no}: {e}")


def fire_ready_sms_for(order_id):
    """Background-thread entry point: look up the order, send the SMS."""
    rows = query_orders(order_id=order_id)
    if not rows:
        print(f"  [sms skipped] order {order_id} not found after mark_ready")
        return
    o = rows[0]
    send_ready_sms(o.get("customer_phone"), o.get("customer_name"), o.get("ticket_no"))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    # ---- Auth gate ---------------------------------------------------------
    def _redirect(self, location, status=302):
        self.send_response(status)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _gate(self, path):
        """Returns True if the request should be allowed to proceed. If False,
        a response (302 to /login) has already been written."""
        if is_public_path(path):
            return True
        if request_is_authed(self):
            return True
        self._redirect("/login")
        return False

    def _serve_login_page(self):
        login_path = os.path.join(STATIC_DIR, "login.html")
        try:
            with open(login_path, "rb") as f:
                body = f.read()
        except FileNotFoundError:
            self.send_error(500, "login.html missing")
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # Login page should not be cached so we always pick up new builds.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _handle_login_post(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b""
        # Accept form-encoded (preferred) or JSON.
        ctype = self.headers.get("Content-Type", "").lower()
        username = ""
        password = ""
        try:
            if ctype.startswith("application/json"):
                data = json.loads(raw.decode("utf-8") or "{}")
                username = str(data.get("username", "")).strip()
                password = str(data.get("password", ""))
            else:
                fields = urllib.parse.parse_qs(raw.decode("utf-8"), keep_blank_values=True)
                username = (fields.get("username", [""])[0] or "").strip()
                password = fields.get("password", [""])[0] or ""
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_text("invalid request", status=400)
            return

        if not username or not password:
            self._send_text("sign-in failed", status=401)
            return
        # Constant-time username compare to avoid leaking validity by timing.
        user_ok = hmac.compare_digest(username, SHOP_USER)
        pass_ok = verify_password(password, SHOP_PASS_HASH)
        if not (user_ok and pass_ok):
            self._send_text("sign-in failed", status=401)
            return

        token = make_session_token(SHOP_USER)
        max_age = SESSION_TTL_SECONDS
        cookie = (
            f"{SESSION_COOKIE}={token}; Max-Age={max_age}; Path=/; "
            f"HttpOnly; Secure; SameSite=Lax"
        )
        body = b"ok"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def _send_text(self, text, status=200):
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/login":
            self._serve_login_page()
            return

        if not self._gate(path):
            return

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

        if path == "/api/shop":
            self._send_json(SHOP)
            return

        if path == "/healthz":
            body = b"ok"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
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
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/login":
            self._handle_login_post()
            return

        if not self._gate(path):
            return

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

        is_mark_ready = self.path == "/api/order/mark_ready"

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
            if is_mark_ready and 200 <= resp.status < 300:
                # Fire SMS after the HTTP response is flushed; failure in
                # the thread must never block or break the state transition.
                try:
                    req_payload = json.loads(body.decode("utf-8")) if body else {}
                    oid = req_payload.get("id")
                except (json.JSONDecodeError, UnicodeDecodeError):
                    oid = None
                if oid:
                    threading.Thread(
                        target=fire_ready_sms_for, args=(oid,), daemon=True
                    ).start()
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
    # Make stdout line-buffered so banner + [sms skipped] / request logs
    # appear in logs/serve.log immediately instead of after the process buffer fills.
    sys.stdout.reconfigure(line_buffering=True)

    # Refuse to start without the auth secrets. Bypassing auth in dev was
    # tempting but it's a prod footgun, so we just require the secrets
    # everywhere. scripts/hash_password.py generates SHOP_PASS_HASH.
    missing = [name for name, val in (
        ("SHOP_USER", SHOP_USER),
        ("SHOP_PASS_HASH", SHOP_PASS_HASH),
        ("SECRET_KEY", SECRET_KEY),
    ) if not val]
    if missing:
        sys.stderr.write(
            "Error: missing required auth env vars: "
            + ", ".join(missing)
            + "\n  Generate SHOP_PASS_HASH with: python3 scripts/hash_password.py\n"
            + "  Then export SHOP_USER, SHOP_PASS_HASH, SECRET_KEY before starting.\n"
        )
        sys.exit(2)

    print("┌─────────────────────────────────────────────┐")
    print("│        Framing app — proxy server           │")
    print("└─────────────────────────────────────────────┘")
    print()
    print(f"  Listening    : http://0.0.0.0:{PORT}  (reachable on LAN)")
    print(f"  Static       : {STATIC_DIR}")
    print(f"  Database     : {DB_PATH}")
    print(f"  Grove server : {GROVE_SERVER}")
    print(f"  Shop         : {SHOP.get('shop_name', '?')} (config: {SHOP_PATH})")
    print(f"  Auth         : shop user '{SHOP_USER}', session cookie '{SESSION_COOKIE}'")
    sms_ready = bool(TWILIO_SID and TWILIO_TOKEN and SHOP.get("twilio_from", "").strip())
    print(f"  Twilio SMS   : {'enabled' if sms_ready else 'disabled (mark_ready will log [sms skipped])'}")
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
