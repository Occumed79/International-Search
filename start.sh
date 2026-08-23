#!/bin/sh
set -e

cd /opt/render/project/src

# The live Render service historically used DATABASE_URL for this same Neon
# database. During the NEON_DATABASE_URL migration, do a one-way compatibility
# handoff only when the legacy value is unmistakably a Neon connection. This
# never permits a second database provider or a non-Neon fallback.
if [ -z "$NEON_DATABASE_URL" ] && [ -n "$DATABASE_URL" ]; then
  case "$DATABASE_URL" in
    *".neon.tech"*)
      export NEON_DATABASE_URL="$DATABASE_URL"
      echo "[start] Recovered legacy Neon connection into NEON_DATABASE_URL for this process"
      ;;
    *)
      echo "[start] NEON_DATABASE_URL is not set and legacy DATABASE_URL is not Neon — refusing non-Neon fallback"
      ;;
  esac
fi

echo "[start] Checking Neon database schema..."

if [ -n "$NEON_DATABASE_URL" ]; then
  echo "[start] Running drizzle-kit push against Neon..."
  (cd db && npx --yes drizzle-kit push --config drizzle.config.ts --force 2>&1) || echo "[start] Schema push skipped (tables may already exist)"
else
  echo "[start] NEON_DATABASE_URL is not set — database features will be unavailable"
fi

echo "[start] Starting API server..."
exec node --enable-source-maps ./api-server/dist/index.mjs
