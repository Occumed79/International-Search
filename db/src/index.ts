import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// db is nullable at runtime when DATABASE_URL is not set.
// Routes must check `if (!db)` before calling any db method.
// We cast to the non-null type here to satisfy TypeScript; the null check is the caller's responsibility.

let _pool: pg.Pool | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

if (process.env.DATABASE_URL) {
  _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  _db = drizzle(_pool, { schema });
} else {
  console.warn(
    "[db] DATABASE_URL not set — running in no-database mode. " +
    "Cached results will be unavailable; live sources (DoltHub, NPI, CMS) will still work."
  );
}

// Export as the non-null type; callers must guard with `if (!db)` before use
export const pool = _pool;
export const db = _db as ReturnType<typeof drizzle<typeof schema>>;
export * from "./schema";
