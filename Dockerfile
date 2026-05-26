# Dockerfile — Framing app (Verso launch on Fly.io)
#
# Approach for grove-server binary: option (b) — Drew copies a Linux-built
# grove-server into the build context as ./grove-server before `docker build .`.
# Rationale: keeps the build context to one repo (no parent-of-both gymnastics),
# avoids needing the grove source tree in the deploy image, and lets Drew swap
# in a new binary without touching this Dockerfile.
#
# Build prep (Drew, on a machine that can produce a linux/amd64 binary):
#   cd ../grove && cargo build --release --package grove-server \
#     --target x86_64-unknown-linux-gnu
#   cp ../grove/target/x86_64-unknown-linux-gnu/release/grove-server \
#      ./grove-server
#   docker build -t framing:latest .
#
# Note: the existing target/release/grove-server in this repo's sibling
# checkout is a darwin/arm64 Mach-O — it will NOT run in this container.
# A Linux build is required.

# Stage 1 — stage the grove-server binary so we can chmod/verify it in
# isolation. Nothing here needs Rust; we just take what Drew has already
# built and prep it for the runtime stage.
FROM debian:bookworm-slim AS binary
WORKDIR /stage
COPY grove-server /stage/grove-server
RUN chmod +x /stage/grove-server \
    && /stage/grove-server --help >/dev/null 2>&1 || true

# Stage 2 — runtime. serve.py is stdlib-only (no requirements.txt), so
# python:3.14-slim with no extra pip installs is sufficient.
FROM python:3.14-slim AS runtime

# ca-certificates for outbound HTTPS to Anthropic + Twilio.
# libssl/libgcc are pulled in by glibc on slim, but pin ca-certificates.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Runtime files. Keep this list explicit so .dockerignore + COPY are the
# only things deciding what lands in the image.
COPY serve.py        /app/serve.py
COPY shop.json       /app/shop.json
COPY grove.toml      /app/grove.toml
COPY apps/           /app/apps/
COPY modules/        /app/modules/

# grove-server from stage 1.
COPY --from=binary /stage/grove-server /usr/local/bin/grove-server

# Entrypoint that boots both grove-servers + serve.py.
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Persistent SQLite db lives on a Fly volume mounted at /data.
# serve.py needs to read DB_PATH from env for this to work — see fly.toml
# header comment for the contract.
ENV DB_PATH=/data/framing.db \
    PYTHONUNBUFFERED=1 \
    PORT=8080

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
