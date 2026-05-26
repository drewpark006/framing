#!/usr/bin/env bash
# Build grove-server for linux/amd64 inside Docker. Output: ./grove-server
# in the framing repo root, ready for `docker build .` of the main Dockerfile.
#
# Prereqs:
#   - Docker Desktop running
#   - ssh-add ~/.ssh/id_github  (jqt + jqlite are ssh:// deps from manzanohq)
#   - GROVE_DIR env var if grove isn't at ../grove relative to framing
#
# Time: 20-40 min via qemu emulation on Apple Silicon.

set -euo pipefail

FRAMING_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GROVE_DIR="${GROVE_DIR:-$(cd "$FRAMING_DIR/../grove" 2>/dev/null && pwd || true)}"

if [[ -z "${GROVE_DIR:-}" || ! -d "$GROVE_DIR/grove-server" ]]; then
  echo "error: can't find grove repo. Set GROVE_DIR=/path/to/grove" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "error: docker daemon not reachable. Start Docker Desktop." >&2
  exit 1
fi

if ! ssh-add -l >/dev/null 2>&1; then
  echo "error: ssh-agent has no keys. Run: ssh-add ~/.ssh/id_github" >&2
  exit 1
fi

echo "Building grove-server for linux/amd64..."
echo "  grove repo:  $GROVE_DIR"
echo "  output:      $FRAMING_DIR/grove-server"
echo

TMP_CTX="$(mktemp -d)"
trap "rm -rf $TMP_CTX" EXIT

cat > "$TMP_CTX/Dockerfile" <<'EOF'
# syntax=docker/dockerfile:1.7
FROM --platform=linux/amd64 rust:1.83-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      git openssh-client pkg-config libssl-dev ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p -m 700 /root/.ssh && \
    ssh-keyscan github.com >> /root/.ssh/known_hosts 2>/dev/null

ENV CARGO_NET_GIT_FETCH_WITH_CLI=true

WORKDIR /grove
COPY --from=grove . /grove

RUN --mount=type=ssh \
    cargo build --release --package grove-server

RUN mkdir /out && cp /grove/target/release/grove-server /out/grove-server
EOF

DOCKER_BUILDKIT=1 docker buildx build \
  --platform linux/amd64 \
  --ssh default \
  --load \
  --build-context "grove=$GROVE_DIR" \
  -t grove-server-build:tmp \
  -f "$TMP_CTX/Dockerfile" \
  "$TMP_CTX"

CID="$(docker create grove-server-build:tmp)"
docker cp "$CID:/out/grove-server" "$FRAMING_DIR/grove-server"
docker rm "$CID" >/dev/null
docker rmi grove-server-build:tmp >/dev/null

chmod +x "$FRAMING_DIR/grove-server"

echo
echo "done."
file "$FRAMING_DIR/grove-server"
