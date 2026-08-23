import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const DATASET_KEY = "occumed-command-center";
const DATASET_FILENAME = "OccuMed_Command_Center.html";
const PROVIDER_BATCH_SIZE = 2_000;
const INTELLIGENCE_BATCH_SIZE = 4_000;

type CommandCenterRow = Record<string, unknown>;
type DbPool = NonNullable<typeof pool>;

type NetworkRecord = {
  externalId: number | null;
  name: string;
  organizationName: string;
  siteName: string;
  facilityType: string;
  networkStatus: string;
  visible: boolean | null;
  country: string;
  stateRegion: string;
  city: string;
  address1: string;
  address2: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
  phone: string;
  services: string[];
  lastAppointment: string;
  pricingAvailable: boolean;
  agreementComponentIds: string;
  serviceComponentIds: string;
  activity2026: string;
  sourceStatus: string;
};

type AuxSnapshot = {
  clinics: unknown[][];
  components: string[];
  types: string[];
  prices: unknown[][];
  availability: unknown[][];
};

type DatasetCounts = { providers: number; pricing: number; availability: number };

function clean(value: unknown, max = 500): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanMultiline(value: unknown, max = 8_000): string {
  return String(value ?? "").trim().slice(0, max);
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeCountry(value: unknown): string {
  const raw = clean(value, 80);
  return ["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"].includes(raw.toUpperCase())
    ? "United States"
    : raw;
}

function resolveDatasetPath(): string {
  const candidates = [
    path.resolve(process.cwd(), "data", DATASET_FILENAME),
    path.resolve(process.cwd(), "..", "data", DATASET_FILENAME),
    path.resolve(process.cwd(), "..", "..", "data", DATASET_FILENAME),
  ];
  const found = candidates.find(fs.existsSync);
  if (!found) throw new Error(`Bundled dataset ${DATASET_FILENAME} was not found.`);
  return found;
}

function extractEmbeddedJson<T>(html: string, variableName: "PAYLOAD" | "AUX_PAYLOAD"): T {
  const match = html.match(new RegExp(`const\\s+${variableName}\\s*=\\s*"([A-Za-z0-9+/=]+)"\\s*;`));
  if (!match?.[1]) throw new Error(`Could not locate ${variableName} in ${DATASET_FILENAME}.`);
  return JSON.parse(gunzipSync(Buffer.from(match[1], "base64")).toString("utf8")) as T;
}

function decodeProviders(html: string): NetworkRecord[] {
  const rows = extractEmbeddedJson<unknown>(html, "PAYLOAD");
  if (!Array.isArray(rows)) throw new Error("PAYLOAD is not an array.");

  const providers = rows.map((raw) => {
    const row = raw as CommandCenterRow;
    const name = clean(row.n || row.site || row.org, 240);
    if (!name) return null;
    const rawServices = Array.isArray(row.sv)
      ? row.sv.map((value) => clean(value, 160)).filter(Boolean)
      : clean(row.sv, 2_000).split(/[|,;\n]+/).map((value) => value.trim()).filter(Boolean);

    return {
      externalId: toNumber(row.i),
      name,
      organizationName: clean(row.org || row.n, 240),
      siteName: clean(row.site || row.n, 240),
      facilityType: clean(row.ft, 120),
      networkStatus: clean(row.st, 120) || "Unknown",
      visible: typeof row.v === "boolean" ? row.v : null,
      country: normalizeCountry(row.co),
      stateRegion: clean(row.rg, 100),
      city: clean(row.cy || row.cty, 120),
      address1: clean(row.a, 300),
      address2: clean(row.a2, 200),
      postalCode: clean(row.z, 40),
      latitude: toNumber(row.lat),
      longitude: toNumber(row.lon),
      phone: clean(row.ph, 80),
      services: [...new Set(rawServices)],
      lastAppointment: clean(row.la || row.us2_last_appt, 100),
      pricingAvailable: Boolean(row.us2_pricing_flag || clean(row.pa, 20)),
      agreementComponentIds: cleanMultiline(row.pa),
      serviceComponentIds: cleanMultiline(row.ps),
      activity2026: clean(row.y26 || row.p26 || row.m26, 240),
      sourceStatus: clean(row.source_status, 160),
    } satisfies NetworkRecord;
  }).filter((row): row is NetworkRecord => row !== null);

  if (providers.length !== rows.length) {
    throw new Error(`Provider validation failed: expected ${rows.length}, decoded ${providers.length}.`);
  }
  return providers;
}

function decodeAux(html: string): AuxSnapshot {
  const value = extractEmbeddedJson<unknown>(html, "AUX_PAYLOAD") as Partial<AuxSnapshot>;
  if (!value || !Array.isArray(value.clinics) || !Array.isArray(value.components) || !Array.isArray(value.types) || !Array.isArray(value.prices) || !Array.isArray(value.availability)) {
    throw new Error("AUX_PAYLOAD is incomplete.");
  }
  return value as AuxSnapshot;
}

function clinicFields(aux: AuxSnapshot, clinicIndex: number): Record<string, unknown> {
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
    country: normalizeCountry(clinic[9]),
    provider_type: clean(clinic[10], 120),
  };
}

async function ensureTables(dbPool: DbPool): Promise<void> {
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS network_provider_snapshot (
      id BIGSERIAL PRIMARY KEY, external_id INTEGER, name TEXT NOT NULL, organization_name TEXT, site_name TEXT,
      facility_type TEXT, network_status TEXT, visible BOOLEAN, country TEXT, state_region TEXT, city TEXT,
      address1 TEXT, address2 TEXT, postal_code TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
      phone TEXT, services JSONB NOT NULL DEFAULT '[]'::jsonb, last_appointment TEXT,
      pricing_available BOOLEAN NOT NULL DEFAULT FALSE, agreement_component_ids TEXT, service_component_ids TEXT,
      activity_2026 TEXT, source_status TEXT, imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS network_provider_snapshot_geo_idx ON network_provider_snapshot (country, state_region, city);
    CREATE INDEX IF NOT EXISTS network_provider_snapshot_status_idx ON network_provider_snapshot (network_status);
    CREATE INDEX IF NOT EXISTS network_provider_snapshot_services_idx ON network_provider_snapshot USING gin (services);

    CREATE TABLE IF NOT EXISTS network_pricing_snapshot (
      id BIGSERIAL PRIMARY KEY, canonical_external_id INTEGER, network_name TEXT, site_name TEXT, address1 TEXT,
      address2 TEXT, city TEXT, state_region TEXT, postal_code TEXT, phone TEXT, country TEXT, provider_type TEXT,
      component_name TEXT NOT NULL, numeric_price DOUBLE PRECISION, source_price_text TEXT, effective_date TEXT,
      expiration_date TEXT, line_item_created TEXT, imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS network_pricing_snapshot_external_idx ON network_pricing_snapshot (canonical_external_id);
    CREATE INDEX IF NOT EXISTS network_pricing_snapshot_geo_idx ON network_pricing_snapshot (country, state_region, city);
    CREATE INDEX IF NOT EXISTS network_pricing_snapshot_component_idx ON network_pricing_snapshot (component_name);

    CREATE TABLE IF NOT EXISTS network_availability_snapshot (
      id BIGSERIAL PRIMARY KEY, canonical_external_id INTEGER, network_name TEXT, site_name TEXT, address1 TEXT,
      address2 TEXT, city TEXT, state_region TEXT, postal_code TEXT, phone TEXT, country TEXT, provider_type TEXT,
      component_name TEXT NOT NULL, component_type TEXT, imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS network_availability_snapshot_external_idx ON network_availability_snapshot (canonical_external_id);
    CREATE INDEX IF NOT EXISTS network_availability_snapshot_geo_idx ON network_availability_snapshot (country, state_region, city);
    CREATE INDEX IF NOT EXISTS network_availability_snapshot_component_idx ON network_availability_snapshot (component_name);

    CREATE TABLE IF NOT EXISTS network_dataset_state (
      dataset_key TEXT PRIMARY KEY, source_sha256 TEXT NOT NULL, provider_count INTEGER NOT NULL,
      pricing_count INTEGER NOT NULL, availability_count INTEGER NOT NULL, loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS network_provider_stage (
      run_id TEXT NOT NULL, external_id INTEGER, name TEXT NOT NULL, organization_name TEXT, site_name TEXT,
      facility_type TEXT, network_status TEXT, visible BOOLEAN, country TEXT, state_region TEXT, city TEXT,
      address1 TEXT, address2 TEXT, postal_code TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
      phone TEXT, services JSONB NOT NULL DEFAULT '[]'::jsonb, last_appointment TEXT,
      pricing_available BOOLEAN NOT NULL DEFAULT FALSE, agreement_component_ids TEXT, service_component_ids TEXT,
      activity_2026 TEXT, source_status TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS network_provider_stage_run_idx ON network_provider_stage (run_id);

    CREATE TABLE IF NOT EXISTS network_pricing_stage (
      run_id TEXT NOT NULL, canonical_external_id INTEGER, network_name TEXT, site_name TEXT, address1 TEXT,
      address2 TEXT, city TEXT, state_region TEXT, postal_code TEXT, phone TEXT, country TEXT, provider_type TEXT,
      component_name TEXT NOT NULL, numeric_price DOUBLE PRECISION, source_price_text TEXT, effective_date TEXT,
      expiration_date TEXT, line_item_created TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS network_pricing_stage_run_idx ON network_pricing_stage (run_id);

    CREATE TABLE IF NOT EXISTS network_availability_stage (
      run_id TEXT NOT NULL, canonical_external_id INTEGER, network_name TEXT, site_name TEXT, address1 TEXT,
      address2 TEXT, city TEXT, state_region TEXT, postal_code TEXT, phone TEXT, country TEXT, provider_type TEXT,
      component_name TEXT NOT NULL, component_type TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS network_availability_stage_run_idx ON network_availability_stage (run_id);
  `);

  await dbPool.query(`DELETE FROM network_provider_stage WHERE created_at < NOW() - INTERVAL '24 hours'`);
  await dbPool.query(`DELETE FROM network_pricing_stage WHERE created_at < NOW() - INTERVAL '24 hours'`);
  await dbPool.query(`DELETE FROM network_availability_stage WHERE created_at < NOW() - INTERVAL '24 hours'`);
}

async function getLiveCounts(dbPool: DbPool): Promise<DatasetCounts> {
  const result = await dbPool.query(`SELECT
    (SELECT COUNT(*)::int FROM network_provider_snapshot) AS providers,
    (SELECT COUNT(*)::int FROM network_pricing_snapshot) AS pricing,
    (SELECT COUNT(*)::int FROM network_availability_snapshot) AS availability`);
  const row = result.rows[0] || {};
  return { providers: Number(row.providers) || 0, pricing: Number(row.pricing) || 0, availability: Number(row.availability) || 0 };
}

function countsEqual(a: DatasetCounts, b: DatasetCounts): boolean {
  return a.providers === b.providers && a.pricing === b.pricing && a.availability === b.availability;
}

async function isCurrent(dbPool: DbPool, sourceHash: string): Promise<boolean> {
  const result = await dbPool.query(
    `SELECT source_sha256, provider_count, pricing_count, availability_count FROM network_dataset_state WHERE dataset_key=$1`,
    [DATASET_KEY],
  );
  const row = result.rows[0];
  if (!row || String(row.source_sha256) !== sourceHash) return false;
  const expected = { providers: Number(row.provider_count) || 0, pricing: Number(row.pricing_count) || 0, availability: Number(row.availability_count) || 0 };
  return countsEqual(await getLiveCounts(dbPool), expected);
}

async function cleanupRun(dbPool: DbPool, runId: string): Promise<void> {
  await dbPool.query(`DELETE FROM network_provider_stage WHERE run_id=$1`, [runId]);
  await dbPool.query(`DELETE FROM network_pricing_stage WHERE run_id=$1`, [runId]);
  await dbPool.query(`DELETE FROM network_availability_stage WHERE run_id=$1`, [runId]);
}

async function stageProviders(dbPool: DbPool, runId: string, records: NetworkRecord[]): Promise<void> {
  for (let start = 0; start < records.length; start += PROVIDER_BATCH_SIZE) {
    const batch = records.slice(start, start + PROVIDER_BATCH_SIZE).map((record) => ({
      external_id: record.externalId, name: record.name, organization_name: record.organizationName,
      site_name: record.siteName, facility_type: record.facilityType, network_status: record.networkStatus,
      visible: record.visible, country: record.country, state_region: record.stateRegion, city: record.city,
      address1: record.address1, address2: record.address2, postal_code: record.postalCode,
      latitude: record.latitude, longitude: record.longitude, phone: record.phone, services: record.services,
      last_appointment: record.lastAppointment, pricing_available: record.pricingAvailable,
      agreement_component_ids: record.agreementComponentIds, service_component_ids: record.serviceComponentIds,
      activity_2026: record.activity2026, source_status: record.sourceStatus,
    }));

    await dbPool.query(`INSERT INTO network_provider_stage (
      run_id, external_id, name, organization_name, site_name, facility_type, network_status, visible,
      country, state_region, city, address1, address2, postal_code, latitude, longitude, phone, services,
      last_appointment, pricing_available, agreement_component_ids, service_component_ids, activity_2026, source_status
    ) SELECT $2::text, x.external_id, x.name, x.organization_name, x.site_name, x.facility_type, x.network_status,
      x.visible, x.country, x.state_region, x.city, x.address1, x.address2, x.postal_code, x.latitude, x.longitude,
      x.phone, x.services, x.last_appointment, x.pricing_available, x.agreement_component_ids,
      x.service_component_ids, x.activity_2026, x.source_status
    FROM jsonb_to_recordset($1::jsonb) AS x(
      external_id INTEGER, name TEXT, organization_name TEXT, site_name TEXT, facility_type TEXT, network_status TEXT,
      visible BOOLEAN, country TEXT, state_region TEXT, city TEXT, address1 TEXT, address2 TEXT, postal_code TEXT,
      latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, phone TEXT, services JSONB, last_appointment TEXT,
      pricing_available BOOLEAN, agreement_component_ids TEXT, service_component_ids TEXT, activity_2026 TEXT, source_status TEXT
    )`, [JSON.stringify(batch), runId]);
  }
}

async function stagePricing(dbPool: DbPool, runId: string, aux: AuxSnapshot): Promise<number> {
  let count = 0;
  for (let start = 0; start < aux.prices.length; start += INTELLIGENCE_BATCH_SIZE) {
    const batch = aux.prices.slice(start, start + INTELLIGENCE_BATCH_SIZE).map((record) => ({
      ...clinicFields(aux, Number(record[0])),
      component_name: clean(aux.components[Number(record[1])], 500) || "Unspecified pricing line item",
      numeric_price: toNumber(record[2]), source_price_text: clean(record[3], 4_000),
      effective_date: clean(record[4], 80), expiration_date: clean(record[5], 80), line_item_created: clean(record[6], 80),
    }));
    if (!batch.length) continue;
    await dbPool.query(`INSERT INTO network_pricing_stage (
      run_id, canonical_external_id, network_name, site_name, address1, address2, city, state_region, postal_code,
      phone, country, provider_type, component_name, numeric_price, source_price_text, effective_date, expiration_date, line_item_created
    ) SELECT $2::text, x.canonical_external_id, x.network_name, x.site_name, x.address1, x.address2, x.city,
      x.state_region, x.postal_code, x.phone, x.country, x.provider_type, x.component_name, x.numeric_price,
      x.source_price_text, x.effective_date, x.expiration_date, x.line_item_created
    FROM jsonb_to_recordset($1::jsonb) AS x(
      canonical_external_id INTEGER, network_name TEXT, site_name TEXT, address1 TEXT, address2 TEXT, city TEXT,
      state_region TEXT, postal_code TEXT, phone TEXT, country TEXT, provider_type TEXT, component_name TEXT,
      numeric_price DOUBLE PRECISION, source_price_text TEXT, effective_date TEXT, expiration_date TEXT, line_item_created TEXT
    )`, [JSON.stringify(batch), runId]);
    count += batch.length;
  }
  return count;
}

async function stageAvailability(dbPool: DbPool, runId: string, aux: AuxSnapshot): Promise<number> {
  let count = 0;
  for (let start = 0; start < aux.availability.length; start += INTELLIGENCE_BATCH_SIZE) {
    const batch = aux.availability.slice(start, start + INTELLIGENCE_BATCH_SIZE).map((record) => ({
      ...clinicFields(aux, Number(record[0])),
      component_name: clean(aux.components[Number(record[1])], 500),
      component_type: clean(aux.types[Number(record[2])], 200),
    })).filter((row) => row.component_name);
    if (!batch.length) continue;
    await dbPool.query(`INSERT INTO network_availability_stage (
      run_id, canonical_external_id, network_name, site_name, address1, address2, city, state_region, postal_code,
      phone, country, provider_type, component_name, component_type
    ) SELECT $2::text, x.canonical_external_id, x.network_name, x.site_name, x.address1, x.address2, x.city,
      x.state_region, x.postal_code, x.phone, x.country, x.provider_type, x.component_name, x.component_type
    FROM jsonb_to_recordset($1::jsonb) AS x(
      canonical_external_id INTEGER, network_name TEXT, site_name TEXT, address1 TEXT, address2 TEXT, city TEXT,
      state_region TEXT, postal_code TEXT, phone TEXT, country TEXT, provider_type TEXT, component_name TEXT, component_type TEXT
    )`, [JSON.stringify(batch), runId]);
    count += batch.length;
  }
  return count;
}

async function validateStage(dbPool: DbPool, runId: string, expected: DatasetCounts): Promise<void> {
  const result = await dbPool.query(`SELECT
    (SELECT COUNT(*)::int FROM network_provider_stage WHERE run_id=$1) AS providers,
    (SELECT COUNT(*)::int FROM network_pricing_stage WHERE run_id=$1) AS pricing,
    (SELECT COUNT(*)::int FROM network_availability_stage WHERE run_id=$1) AS availability`, [runId]);
  const row = result.rows[0] || {};
  const actual = { providers: Number(row.providers) || 0, pricing: Number(row.pricing) || 0, availability: Number(row.availability) || 0 };
  if (!countsEqual(actual, expected)) throw new Error(`Staging count mismatch. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
}

async function publish(dbPool: DbPool, runId: string, sourceHash: string, counts: DatasetCounts): Promise<void> {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [DATASET_KEY]);
    await client.query(`TRUNCATE network_provider_snapshot, network_pricing_snapshot, network_availability_snapshot RESTART IDENTITY`);

    await client.query(`INSERT INTO network_provider_snapshot (
      external_id, name, organization_name, site_name, facility_type, network_status, visible, country, state_region,
      city, address1, address2, postal_code, latitude, longitude, phone, services, last_appointment, pricing_available,
      agreement_component_ids, service_component_ids, activity_2026, source_status
    ) SELECT external_id, name, organization_name, site_name, facility_type, network_status, visible, country, state_region,
      city, address1, address2, postal_code, latitude, longitude, phone, services, last_appointment, pricing_available,
      agreement_component_ids, service_component_ids, activity_2026, source_status
    FROM network_provider_stage WHERE run_id=$1`, [runId]);

    await client.query(`INSERT INTO network_pricing_snapshot (
      canonical_external_id, network_name, site_name, address1, address2, city, state_region, postal_code, phone,
      country, provider_type, component_name, numeric_price, source_price_text, effective_date, expiration_date, line_item_created
    ) SELECT canonical_external_id, network_name, site_name, address1, address2, city, state_region, postal_code, phone,
      country, provider_type, component_name, numeric_price, source_price_text, effective_date, expiration_date, line_item_created
    FROM network_pricing_stage WHERE run_id=$1`, [runId]);

    await client.query(`INSERT INTO network_availability_snapshot (
      canonical_external_id, network_name, site_name, address1, address2, city, state_region, postal_code, phone,
      country, provider_type, component_name, component_type
    ) SELECT canonical_external_id, network_name, site_name, address1, address2, city, state_region, postal_code, phone,
      country, provider_type, component_name, component_type FROM network_availability_stage WHERE run_id=$1`, [runId]);

    await client.query(`INSERT INTO network_dataset_state (
      dataset_key, source_sha256, provider_count, pricing_count, availability_count, loaded_at
    ) VALUES ($1,$2,$3,$4,$5,NOW()) ON CONFLICT (dataset_key) DO UPDATE SET
      source_sha256=EXCLUDED.source_sha256, provider_count=EXCLUDED.provider_count,
      pricing_count=EXCLUDED.pricing_count, availability_count=EXCLUDED.availability_count, loaded_at=NOW()`,
      [DATASET_KEY, sourceHash, counts.providers, counts.pricing, counts.availability]);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function bootstrapNetworkData(): Promise<void> {
  if (!pool) throw new Error("NEON_DATABASE_URL is required for the integrated provider network.");
  const dbPool = pool;
  const datasetPath = resolveDatasetPath();
  const fileBuffer = fs.readFileSync(datasetPath);
  const sourceHash = createHash("sha256").update(fileBuffer).digest("hex");

  await ensureTables(dbPool);
  if (await isCurrent(dbPool, sourceHash)) {
    logger.info({ datasetPath, sourceHash, ...(await getLiveCounts(dbPool)) }, "Bundled Command Center dataset already current in Neon");
    return;
  }

  const html = fileBuffer.toString("utf8");
  const providers = decodeProviders(html);
  const aux = decodeAux(html);
  const runId = randomUUID();

  try {
    await stageProviders(dbPool, runId, providers);
    const pricing = await stagePricing(dbPool, runId, aux);
    const availability = await stageAvailability(dbPool, runId, aux);
    const expected = { providers: providers.length, pricing, availability };

    if (pricing !== aux.prices.length) throw new Error(`Pricing validation failed: expected ${aux.prices.length}, staged ${pricing}.`);
    if (availability !== aux.availability.length) throw new Error(`Availability validation failed: expected ${aux.availability.length}, staged ${availability}.`);

    await validateStage(dbPool, runId, expected);
    await publish(dbPool, runId, sourceHash, expected);

    const live = await getLiveCounts(dbPool);
    if (!countsEqual(live, expected)) throw new Error(`Published count mismatch. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(live)}.`);

    logger.info({ datasetPath, sourceHash, runId, ...expected }, "Bundled Command Center dataset loaded into Neon");
  } finally {
    await cleanupRun(dbPool, runId).catch((error: unknown) => logger.warn({ error, runId }, "Could not clean bootstrap staging rows"));
  }
}
