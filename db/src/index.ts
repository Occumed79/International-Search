import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// Neon is the single canonical persistent database for this app.
const connectionString = process.env.NEON_DATABASE_URL;

let _pool: pg.Pool | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

if (connectionString) {
  _pool = new Pool({ connectionString });
  _db = drizzle(_pool, { schema });
} else {
  console.warn(
    "[db] NEON_DATABASE_URL not set — running in no-database mode. " +
    "Existing-network, pricing, availability, cache, bookmarks, and history data will be unavailable."
  );
}

// Export as the non-null type; callers must guard with `if (!db)` / `if (!pool)` before use.
export const pool = _pool;
export const db = _db as ReturnType<typeof drizzle<typeof schema>>;
export * from "./schema";
