#!/bin/sh
set -e

echo "[start] Running database migration..."
cd /opt/render/project/src

# Run drizzle-kit push to ensure schema exists
if [ -n "$DATABASE_URL" ]; then
  node_modules/.bin/drizzle-kit push --config db/drizzle.config.ts --force 2>&1 || echo "[start] Migration warning (may already be up to date)"
else
  echo "[start] No DATABASE_URL — skipping migration"
fi

echo "[start] Starting server..."
exec node --enable-source-maps ./api-server/dist/index.mjs
