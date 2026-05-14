import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

if (process.env.DATABASE_URL) {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  db = drizzle(pool, { schema });
} else {
  console.warn(
    "[db] DATABASE_URL not set — running in no-database mode. " +
    "Cached results will be unavailable; live sources (DoltHub, NPI, CMS) will still work."
  );
}

export { pool, db };
export * from "./schema";
