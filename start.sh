#!/bin/sh
set -e

echo "[start] Checking Neon database schema..."
cd /opt/render/project/src

if [ -n "$NEON_DATABASE_URL" ]; then
  echo "[start] Running drizzle-kit push against Neon..."
  (cd db && npx --yes drizzle-kit push --config drizzle.config.ts --force 2>&1) || echo "[start] Schema push skipped (tables may already exist)"
else
  echo "[start] NEON_DATABASE_URL is not set — database features will be unavailable"
fi

echo "[start] Starting API server..."
exec node --enable-source-maps ./api-server/dist/index.mjs
