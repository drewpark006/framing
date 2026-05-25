#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# start.sh — Launch the full framing stack with one command.
#
# Boots three processes against the same framing.sqlite:
#   1. grove-server (--project)  on :3000   handles writes via route.grove
#   2. grove-server (--module)   on :3010   exposes dev console endpoints
#                                           (/api/_modules, /api/{module}/records,
#                                           /api/{module}/_schema) — used by /dev.html
#   3. serve.py                  on :8080   static + GET projections + POST proxy
#
# Usage:
#   ./start.sh                    # all 3 services, persist to framing.sqlite
#   ./start.sh --no-browser       # don't auto-open the demo
#   ./start.sh --no-db            # in-memory (dev console will be empty)
#   ./start.sh --app-port 3100    # override grove-server (project) port
#   ./start.sh --dev-port 3110    # override grove-server (module) port
#   ./start.sh --web-port 8090    # override serve.py port
#
# Ctrl+C stops everything.
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GROVE_DIR="$(cd "$SCRIPT_DIR/../grove" && pwd)"

APP_PORT="3000"
DEV_PORT="3010"
WEB_PORT="8080"
USE_DB=true
OPEN_BROWSER=true
DB_FILE="$SCRIPT_DIR/framing.sqlite"
LOG_DIR="$SCRIPT_DIR/logs"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-port) APP_PORT="$2"; shift 2 ;;
    --dev-port) DEV_PORT="$2"; shift 2 ;;
    --web-port) WEB_PORT="$2"; shift 2 ;;
    --no-db) USE_DB=false; shift ;;
    --no-browser) OPEN_BROWSER=false; shift ;;
    -h|--help)
      sed -n '2,21p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Validate paths and binaries
# ---------------------------------------------------------------------------
for dir in "$SCRIPT_DIR/modules/order" "$GROVE_DIR"; do
  [[ -d "$dir" ]] || { echo "Error: directory not found: $dir" >&2; exit 1; }
done

GROVE_SERVER="$GROVE_DIR/target/release/grove-server"
[[ -x "$GROVE_SERVER" ]] || GROVE_SERVER="$GROVE_DIR/target/debug/grove-server"
if [[ ! -x "$GROVE_SERVER" ]]; then
  echo "Error: grove-server binary not found." >&2
  echo "  Build it: cd $GROVE_DIR && cargo build --release --package grove-server" >&2
  exit 1
fi

PYTHON="$(command -v python3 || true)"
if [[ -z "$PYTHON" ]]; then
  echo "Error: python3 not found." >&2
  exit 1
fi

# ANTHROPIC_API_KEY enables /api/order/scan_ticket (Phil's paper-ticket OCR).
# Not fatal if missing — the rest of the app works, just no scan.
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "Note: ANTHROPIC_API_KEY not set — /api/order/scan_ticket will return 500."
fi

# TWILIO_SID + TWILIO_TOKEN enable the ready-for-pickup SMS. The sender
# phone number ("twilio_from") lives in shop.json, not env. With any of
# the three missing/empty, mark_ready still transitions the order — the
# server log shows a clean [sms skipped] line.
if [[ -z "${TWILIO_SID:-}" || -z "${TWILIO_TOKEN:-}" ]]; then
  echo "Note: TWILIO_SID / TWILIO_TOKEN not set — ready-for-pickup SMS disabled."
fi

# ---------------------------------------------------------------------------
# Bail early if ports are already in use — don't silently fight an old server
# ---------------------------------------------------------------------------
for port_pair in "app:$APP_PORT" "dev:$DEV_PORT" "web:$WEB_PORT"; do
  name="${port_pair%%:*}"
  port="${port_pair##*:}"
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Error: port $port ($name) is already in use." >&2
    echo "  Free it: lsof -tiTCP:$port -sTCP:LISTEN | xargs kill" >&2
    exit 1
  fi
done

mkdir -p "$LOG_DIR"

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
echo "┌─────────────────────────────────────────────────────┐"
echo "│           Framing — full dev stack                  │"
echo "└─────────────────────────────────────────────────────┘"
echo ""
echo "  Project        : $SCRIPT_DIR"
echo "  Grove          : $GROVE_DIR ($GROVE_SERVER)"
if $USE_DB; then
  echo "  Database       : $DB_FILE"
else
  echo "  Database       : in-memory (records will not persist; dev console empty)"
fi
echo "  Logs           : $LOG_DIR/{grove-app,grove-dev,serve}.log"
echo ""

# ---------------------------------------------------------------------------
# Clean up all child processes on exit / Ctrl+C.
# pkill -P $$ kills every direct child of this shell, which is more robust
# than tracking PIDs manually — survives signal-handling quirks when the
# script is backgrounded or piped.
# ---------------------------------------------------------------------------
cleanup() {
  trap '' EXIT INT TERM
  echo ""
  echo "Stopping services..."
  pkill -TERM -P $$ 2>/dev/null || true
  sleep 0.5
  pkill -KILL -P $$ 2>/dev/null || true
  echo "Done."
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# Build shared grove-server args
# ---------------------------------------------------------------------------
db_args=()
if $USE_DB; then
  db_args=(--db "$DB_FILE")
fi

# ---------------------------------------------------------------------------
# Start grove-server (project mode — handles writes via route.grove)
# ---------------------------------------------------------------------------
echo "▸ grove-server (project) → http://127.0.0.1:$APP_PORT"
"$GROVE_SERVER" \
  --project "$SCRIPT_DIR" \
  --listen "127.0.0.1:$APP_PORT" \
  "${db_args[@]}" \
  >"$LOG_DIR/grove-app.log" 2>&1 &

# ---------------------------------------------------------------------------
# Start grove-server (module mode — exposes dev console endpoints)
# ---------------------------------------------------------------------------
echo "▸ grove-server (dev)     → http://127.0.0.1:$DEV_PORT"
"$GROVE_SERVER" \
  --module "$SCRIPT_DIR/modules/order" \
  --listen "127.0.0.1:$DEV_PORT" \
  "${db_args[@]}" \
  >"$LOG_DIR/grove-dev.log" 2>&1 &

# ---------------------------------------------------------------------------
# Wait briefly so both grove-servers are listening before serve.py starts
# proxying, then start serve.py.
# ---------------------------------------------------------------------------
sleep 1.5

echo "▸ serve.py               → http://127.0.0.1:$WEB_PORT"
GROVE_SERVER="http://127.0.0.1:$APP_PORT" \
DEV_GROVE_SERVER="http://127.0.0.1:$DEV_PORT" \
  "$PYTHON" "$SCRIPT_DIR/serve.py" "$WEB_PORT" \
  >"$LOG_DIR/serve.log" 2>&1 &

sleep 1

# ---------------------------------------------------------------------------
# Quick health check before reporting ready
# ---------------------------------------------------------------------------
for url in \
  "http://127.0.0.1:$APP_PORT/" \
  "http://127.0.0.1:$DEV_PORT/api/_modules" \
  "http://127.0.0.1:$WEB_PORT/healthz"
do
  if ! curl -sSf -o /dev/null --max-time 2 "$url"; then
    echo ""
    echo "Warning: health check failed for $url"
    echo "  Check $LOG_DIR/ for details."
  fi
done

echo ""
echo "Ready."
echo ""
echo "  Demo         : http://127.0.0.1:$WEB_PORT/"
echo "  Dev console  : http://127.0.0.1:$WEB_PORT/dev.html"
echo ""
echo "Press Ctrl+C to stop."
echo ""

if $OPEN_BROWSER && command -v open >/dev/null 2>&1; then
  open "http://127.0.0.1:$WEB_PORT/" || true
  open "http://127.0.0.1:$WEB_PORT/dev.html" || true
fi

# Block until a signal or all children exit. The trap handles SIGINT/SIGTERM.
wait
