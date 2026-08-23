import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

async function ensureTables(): Promise<void> {
  if (!pool) throw new Error("NEON_DATABASE_URL is required for network intelligence.");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS network_pricing_snapshot (
      id BIGSERIAL PRIMARY KEY,
      canonical_external_id INTEGER,
      network_name TEXT,
      site_name TEXT,
      address1 TEXT,
      address2 TEXT,
      city TEXT,
      state_region TEXT,
      postal_code TEXT,
      phone TEXT,
      country TEXT,
      provider_type TEXT,
      component_name TEXT NOT NULL,
      numeric_price DOUBLE PRECISION,
      source_price_text TEXT,
      effective_date TEXT,
      expiration_date TEXT,
      line_item_created TEXT,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS network_pricing_snapshot_external_idx ON network_pricing_snapshot (canonical_external_id);
    CREATE INDEX IF NOT EXISTS network_pricing_snapshot_geo_idx ON network_pricing_snapshot (country, state_region, city);
    CREATE INDEX IF NOT EXISTS network_pricing_snapshot_component_idx ON network_pricing_snapshot (component_name);

    CREATE TABLE IF NOT EXISTS network_availability_snapshot (
      id BIGSERIAL PRIMARY KEY,
      canonical_external_id INTEGER,
      network_name TEXT,
      site_name TEXT,
      address1 TEXT,
      address2 TEXT,
      city TEXT,
      state_region TEXT,
      postal_code TEXT,
      phone TEXT,
      country TEXT,
      provider_type TEXT,
      component_name TEXT NOT NULL,
      component_type TEXT,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS network_availability_snapshot_external_idx ON network_availability_snapshot (canonical_external_id);
    CREATE INDEX IF NOT EXISTS network_availability_snapshot_geo_idx ON network_availability_snapshot (country, state_region, city);
    CREATE INDEX IF NOT EXISTS network_availability_snapshot_component_idx ON network_availability_snapshot (component_name);
  `);
}

router.get("/network/intelligence-stats", async (_req, res): Promise<void> => {
  try {
    if (!pool) {
      res.json({ pricingRecords: 0, availabilityLinks: 0, pricedClinics: 0, availabilityClinics: 0, importedAt: null });
      return;
    }
    await ensureTables();
    const [pricing, availability] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS records, COUNT(DISTINCT canonical_external_id)::int AS clinics, MAX(imported_at) AS imported_at FROM network_pricing_snapshot`),
      pool.query(`SELECT COUNT(*)::int AS records, COUNT(DISTINCT canonical_external_id)::int AS clinics, MAX(imported_at) AS imported_at FROM network_availability_snapshot`),
    ]);
    res.json({
      pricingRecords: pricing.rows[0]?.records || 0,
      availabilityLinks: availability.rows[0]?.records || 0,
      pricedClinics: pricing.rows[0]?.clinics || 0,
      availabilityClinics: availability.rows[0]?.clinics || 0,
      importedAt: pricing.rows[0]?.imported_at || availability.rows[0]?.imported_at || null,
    });
  } catch (error) {
    logger.warn({ error }, "Network intelligence stats failed");
    res.status(500).json({ error: "Could not read network intelligence stats." });
  }
});

router.get("/network/intelligence/:externalId", async (req, res): Promise<void> => {
  try {
    if (!pool) {
      res.json({ pricing: [], availability: [], pricingCount: 0, availabilityCount: 0 });
      return;
    }
    await ensureTables();
    const externalId = Number(req.params.externalId);
    if (!Number.isFinite(externalId)) {
      res.status(400).json({ error: "Invalid provider identifier." });
      return;
    }

    const [pricingResult, availabilityResult] = await Promise.all([
      pool.query(
        `SELECT component_name, numeric_price, source_price_text, effective_date, expiration_date, line_item_created
         FROM network_pricing_snapshot
         WHERE canonical_external_id = $1
         ORDER BY component_name
         LIMIT 2000`,
        [externalId],
      ),
      pool.query(
        `SELECT component_name, component_type
         FROM network_availability_snapshot
         WHERE canonical_external_id = $1
         ORDER BY component_name
         LIMIT 2000`,
        [externalId],
      ),
    ]);

    res.json({
      pricingCount: pricingResult.rowCount || 0,
      availabilityCount: availabilityResult.rowCount || 0,
      pricing: pricingResult.rows.map((row) => ({
        componentName: row.component_name,
        numericPrice: row.numeric_price,
        sourcePriceText: row.source_price_text,
        effectiveDate: row.effective_date,
        expirationDate: row.expiration_date,
        lineItemCreated: row.line_item_created,
      })),
      availability: availabilityResult.rows.map((row) => ({
        componentName: row.component_name,
        componentType: row.component_type,
      })),
    });
  } catch (error) {
    logger.warn({ error }, "Provider intelligence lookup failed");
    res.status(500).json({ error: "Provider intelligence lookup failed." });
  }
});

export default router;
