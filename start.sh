#!/bin/sh
set -e

cd /opt/render/project/src

# This app's persistent database is Neon only. DATABASE_URL on Render points to
# the legacy Render Postgres database and must never be used as the app database.
if [ -z "$NEON_DATABASE_URL" ]; then
  echo "[start] ERROR: NEON_DATABASE_URL is not set. Refusing to start against legacy Render Postgres."
  exit 1
fi

case "$NEON_DATABASE_URL" in
  *".neon.tech"*) ;;
  *)
    echo "[start] ERROR: NEON_DATABASE_URL does not point to Neon. Refusing to start."
    exit 1
    ;;
esac

echo "[start] Checking Neon database schema..."
echo "[start] Running drizzle-kit push against Neon..."
(cd db && npx --yes drizzle-kit push --config drizzle.config.ts --force 2>&1) || echo "[start] Schema push skipped (tables may already exist)"

echo "[start] Starting API server..."
exec node --enable-source-maps ./api-server/dist/index.mjs
