#!/usr/bin/env bash
# entrypoint.sh — Container entrypoint for the Framing app.
#
# Boots the same three-process stack as start.sh, minus the dev niceties
# (no log files, no port-in-use checks, no auto-open). All three processes
# share one SQLite db on the Fly volume at $DB_PATH.
#
#   1. grove-server --project  on :3000   handles writes (route.grove)
#   2. grove-server --module   on :3010   dev console endpoints
#   3. python3 serve.py 8080              static + reads + proxy (foreground)
#
# Logs go to stdout/stderr so `fly logs` shows everything interleaved.
# SIGTERM (which Fly sends on machine stop) is forwarded to the background
# grove-servers so they shut down cleanly before the container exits.

set -e

PROJECT_DIR="/app"
APP_PORT="${APP_PORT:-3000}"
DEV_PORT="${DEV_PORT:-3010}"
WEB_PORT="${PORT:-8080}"
DB_PATH="${DB_PATH:-/data/framing.db}"

# Make sure the volume mount point is writable; first boot on a fresh volume
# will have an empty /data and grove-server will create the db file.
mkdir -p "$(dirname "$DB_PATH")"

echo "[entrypoint] db=$DB_PATH app=$APP_PORT dev=$DEV_PORT web=$WEB_PORT"

# Start grove-server in project mode (writes via route.grove).
grove-server \
  --project "$PROJECT_DIR" \
  --listen "127.0.0.1:$APP_PORT" \
  --db "$DB_PATH" &
GROVE_APP_PID=$!

# Start grove-server in module mode (dev console endpoints).
grove-server \
  --module "$PROJECT_DIR/modules/order" \
  --listen "127.0.0.1:$DEV_PORT" \
  --db "$DB_PATH" &
GROVE_DEV_PID=$!

# Forward shutdown signals to the background grove-servers, then let the
# foreground python process exit. `wait` on each pid drains them cleanly.
shutdown() {
  echo "[entrypoint] caught signal, stopping grove-servers..."
  kill -TERM "$GROVE_APP_PID" "$GROVE_DEV_PID" 2>/dev/null || true
  wait "$GROVE_APP_PID" 2>/dev/null || true
  wait "$GROVE_DEV_PID" 2>/dev/null || true
  echo "[entrypoint] done."
}
trap shutdown SIGTERM SIGINT

# Give grove-server a moment to bind before serve.py starts proxying.
sleep 1

export GROVE_SERVER="http://127.0.0.1:$APP_PORT"
export DEV_GROVE_SERVER="http://127.0.0.1:$DEV_PORT"

# Foreground: serve.py on :8080. exec so signals reach Python directly,
# but note: the trap above only fires while the shell is still running.
# We want the trap, so we run python as a child and wait on it.
python3 "$PROJECT_DIR/serve.py" "$WEB_PORT" &
SERVE_PID=$!

wait "$SERVE_PID"
