import express, { Router, type IRouter, type Request } from "express";
import { gunzipSync } from "node:zlib";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

type AuxSnapshot = {
  clinics: unknown[][];
  components: string[];
  types: string[];
  prices: unknown[][];
  availability: unknown[][];
  meta?: Record<string, unknown>;
};

function clean(value: unknown, max = 2_000): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function decodeAuxSnapshot(buffer: Buffer): AuxSnapshot {
  if (!buffer.length) throw new Error("Uploaded Command Center file is empty.");
  const asText = buffer.toString("utf8");

  let parsed: unknown;
  if (/<!doctype html|<html/i.test(asText.slice(0, 2_000))) {
    const match = asText.match(/const\s+AUX_PAYLOAD\s*=\s*"([A-Za-z0-9+/=]+)"\s*;/);
    if (!match?.[1]) throw new Error("Could not locate the embedded Command Center AUX_PAYLOAD.");
    parsed = JSON.parse(gunzipSync(Buffer.from(match[1], "base64")).toString("utf8"));
  } else {
    try {
      parsed = JSON.parse(gunzipSync(buffer).toString("utf8"));
    } catch {
      parsed = JSON.parse(asText);
    }
  }

  if (!parsed || typeof parsed !== "object") throw new Error("Auxiliary Command Center payload is invalid.");
  const aux = parsed as Partial<AuxSnapshot>;
  if (!Array.isArray(aux.clinics) || !Array.isArray(aux.components) || !Array.isArray(aux.types) || !Array.isArray(aux.prices) || !Array.isArray(aux.availability)) {
    throw new Error("Auxiliary payload is missing clinics, components, pricing, or availability arrays.");
  }
  return aux as AuxSnapshot;
}

async function ensureTables(): Promise<void> {
  if (!pool) throw new Error("DATABASE_URL is required to import network intelligence.");
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

function clinicFields(aux: AuxSnapshot, clinicIndex: number) {
  const clinic = aux.clinics[clinicIndex] || [];
  return {
    canonical_external_id: toNumber(clinic[0]),
    network_name: clean(clinic[1], 240),
    site_name: clean(clinic[2], 240),
    address1: clean(clinic[3], 300),
    address2: clean(clinic[4], 200),
    city: clean(clinic[5], 120),
    state_region: clean(clinic[6], 100),
    postal_code: clean(clinic[7], 40),
    phone: clean(clinic[8], 80),
    country: clean(clinic[9], 80),
    provider_type: clean(clinic[10], 120),
  };
}

async function importAux(aux: AuxSnapshot): Promise<{ pricing: number; availability: number }> {
  if (!pool) throw new Error("DATABASE_URL is required to import network intelligence.");
  await ensureTables();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE network_pricing_snapshot, network_availability_snapshot RESTART IDENTITY");

    const pricingBatchSize = 4_000;
    for (let start = 0; start < aux.prices.length; start += pricingBatchSize) {
      const batch = aux.prices.slice(start, start + pricingBatchSize).map((record) => {
        const ci = Number(record[0]);
        const componentIndex = Number(record[1]);
        return {
          ...clinicFields(aux, ci),
          component_name: clean(aux.components[componentIndex], 500),
          numeric_price: toNumber(record[2]),
          source_price_text: clean(record[3], 4_000),
          effective_date: clean(record[4], 80),
          expiration_date: clean(record[5], 80),
          line_item_created: clean(record[6], 80),
        };
      }).filter((row) => row.component_name);

      await client.query(
        `INSERT INTO network_pricing_snapshot (
          canonical_external_id, network_name, site_name, address1, address2, city, state_region,
          postal_code, phone, country, provider_type, component_name, numeric_price, source_price_text,
          effective_date, expiration_date, line_item_created
        )
        SELECT
          x.canonical_external_id, x.network_name, x.site_name, x.address1, x.address2, x.city, x.state_region,
          x.postal_code, x.phone, x.country, x.provider_type, x.component_name, x.numeric_price, x.source_price_text,
          x.effective_date, x.expiration_date, x.line_item_created
        FROM jsonb_to_recordset($1::jsonb) AS x(
          canonical_external_id INTEGER, network_name TEXT, site_name TEXT, address1 TEXT, address2 TEXT,
          city TEXT, state_region TEXT, postal_code TEXT, phone TEXT, country TEXT, provider_type TEXT,
          component_name TEXT, numeric_price DOUBLE PRECISION, source_price_text TEXT, effective_date TEXT,
          expiration_date TEXT, line_item_created TEXT
        )`,
        [JSON.stringify(batch)],
      );
    }

    const availabilityBatchSize = 4_000;
    for (let start = 0; start < aux.availability.length; start += availabilityBatchSize) {
      const batch = aux.availability.slice(start, start + availabilityBatchSize).map((record) => {
        const ci = Number(record[0]);
        const componentIndex = Number(record[1]);
        const typeIndex = Number(record[2]);
        return {
          ...clinicFields(aux, ci),
          component_name: clean(aux.components[componentIndex], 500),
          component_type: clean(aux.types[typeIndex], 200),
        };
      }).filter((row) => row.component_name);

      await client.query(
        `INSERT INTO network_availability_snapshot (
          canonical_external_id, network_name, site_name, address1, address2, city, state_region,
          postal_code, phone, country, provider_type, component_name, component_type
        )
        SELECT
          x.canonical_external_id, x.network_name, x.site_name, x.address1, x.address2, x.city, x.state_region,
          x.postal_code, x.phone, x.country, x.provider_type, x.component_name, x.component_type
        FROM jsonb_to_recordset($1::jsonb) AS x(
          canonical_external_id INTEGER, network_name TEXT, site_name TEXT, address1 TEXT, address2 TEXT,
          city TEXT, state_region TEXT, postal_code TEXT, phone TEXT, country TEXT, provider_type TEXT,
          component_name TEXT, component_type TEXT
        )`,
        [JSON.stringify(batch)],
      );
    }

    await client.query("COMMIT");
    return { pricing: aux.prices.length, availability: aux.availability.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

router.post(
  "/network/import-intelligence",
  express.raw({ type: ["text/html", "application/octet-stream", "application/gzip", "application/x-gzip", "text/plain"], limit: "30mb" }),
  async (req: Request, res): Promise<void> => {
    try {
      if (!pool) {
        res.status(503).json({ error: "DATABASE_URL is required before importing network intelligence." });
        return;
      }
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ""));
      const aux = decodeAuxSnapshot(buffer);
      const imported = await importAux(aux);
      res.json({
        imported,
        clinics: aux.clinics.length,
        components: aux.components.length,
        componentTypes: aux.types.length,
        meta: aux.meta || {},
        message: "Pricing and explicit service-availability intelligence imported.",
      });
    } catch (error) {
      logger.error({ error }, "Command Center intelligence import failed");
      res.status(400).json({ error: error instanceof Error ? error.message : "Network intelligence import failed." });
    }
  },
);

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
