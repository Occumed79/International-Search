#!/bin/sh
set -e

echo "[start] Checking database schema..."
cd /opt/render/project/src

if [ -n "$DATABASE_URL" ]; then
  echo "[start] Running drizzle-kit push..."
  # Use pnpm dlx to ensure drizzle-kit is available even if not in node_modules
  (cd db && DATABASE_URL="$DATABASE_URL" npx --yes drizzle-kit push --config drizzle.config.ts --force 2>&1) || echo "[start] Schema push skipped (tables may already exist)"
else
  echo "[start] No DATABASE_URL set — running in no-database mode"
fi

echo "[start] Starting API server..."
exec node --enable-source-maps ./api-server/dist/index.mjs
