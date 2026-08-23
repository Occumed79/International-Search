import { createHash } from "node:crypto";
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
  meta?: Record<string, unknown>;
};

type DbClient = Awaited<ReturnType<NonNullable<typeof pool>["connect"]>>;

type DatasetCounts = {
  providers: number;
  pricing: number;
  availability: number;
};

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
  const upper = raw.toUpperCase();
  if (["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"].includes(upper)) return "United States";
  return raw;
}

function commandCenterRowToNetwork(row: CommandCenterRow): NetworkRecord | null {
  const name = clean(row.n || row.site || row.org, 240);
  if (!name) return null;

  const services = Array.isArray(row.sv)
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
    services: [...new Set(services)],
    lastAppointment: clean(row.la || row.us2_last_appt, 100),
    pricingAvailable: Boolean(row.us2_pricing_flag || clean(row.pa, 20)),
    agreementComponentIds: cleanMultiline(row.pa),
    serviceComponentIds: cleanMultiline(row.ps),
    activity2026: clean(row.y26 || row.p26 || row.m26, 240),
    sourceStatus: clean(row.source_status, 160),
  };
}

function resolveBundledDatasetPath(): string {
  const candidates = [
    path.resolve(process.cwd(), "data", DATASET_FILENAME),
    path.resolve(process.cwd(), "..", "data", DATASET_FILENAME),
    path.resolve(process.cwd(), "..", "..", "data", DATASET_FILENAME),
  ];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`Bundled Command Center dataset not found. Expected ${DATASET_FILENAME} under the repository data directory.`);
  }
  return found;
}

function extractEmbeddedJson<T>(html: string, variableName: "PAYLOAD" | "AUX_PAYLOAD"): T {
  const expression = new RegExp(`const\\s+${variableName}\\s*=\\s*"([A-Za-z0-9+/=]+)"\\s*;`);
  const match = html.match(expression);
  if (!match?.[1]) throw new Error(`Could not locate embedded ${variableName} in the bundled Command Center HTML.`);
  const json = gunzipSync(Buffer.from(match[1], "base64")).toString("utf8");
  return JSON.parse(json) as T;
}

function decodeProviderRecords(html: string): NetworkRecord[] {
  const rows = extractEmbeddedJson<unknown>(html, "PAYLOAD");
  if (!Array.isArray(rows)) throw new Error("Command Center PAYLOAD is not a provider-record array.");

  const records = rows
    .map((row) => commandCenterRowToNetwork(row as CommandCenterRow))
    .filter((row): row is NetworkRecord => row !== null);

  if (records.length !== rows.length) {
    throw new Error(`Provider dataset validation failed: decoded ${rows.length.toLocaleString()} rows but only ${records.length.toLocaleString()} had usable provider identities.`);
  }
  return records;
}

function decodeAuxSnapshot(html: string): AuxSnapshot {
  const parsed = extractEmbeddedJson<unknown>(html, "AUX_PAYLOAD");
  if (!parsed || typeof parsed !== "object") throw new Error("Command Center AUX_PAYLOAD is invalid.");

  const aux = parsed as Partial<AuxSnapshot>;
  if (!Array.isArray(aux.clinics) || !Array.isArray(aux.components) || !Array.isArray(aux.types) || !Array.isArray(aux.prices) || !Array.isArray(aux.availability)) {
    throw new Error("AUX_PAYLOAD is missing clinics, components, pricing, or explicit availability arrays.");
  }
  return aux as AuxSnapshot;
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

async function ensureLiveTables(client: DbClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS network_provider_snapshot (
      id BIGSERIAL PRIMARY KEY,
      external_id INTEGER,
      name TEXT NOT NULL,
      organization_name TEXT,
      site_name TEXT,
      facility_type TEXT,
      network_status TEXT,
      visible BOOLEAN,
      country TEXT,
      state_region TEXT,
      city TEXT,
      address1 TEXT,
      address2 TEXT,
      postal_code TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      phone TEXT,
      services JSONB NOT NULL DEFAULT '[]'::jsonb,
      last_appointment TEXT,
      pricing_available BOOLEAN NOT NULL DEFAULT FALSE,
      agreement_component_ids TEXT,
      service_component_ids TEXT,
      activity_2026 TEXT,
      source_status TEXT,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS network_provider_snapshot_name_idx ON network_provider_snapshot USING gin (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(organization_name,'')));
    CREATE INDEX IF NOT EXISTS network_provider_snapshot_geo_idx ON network_provider_snapshot (country, state_region, city);
    CREATE INDEX IF NOT EXISTS network_provider_snapshot_status_idx ON network_provider_snapshot (network_status);
    CREATE INDEX IF NOT EXISTS network_provider_snapshot_services_idx ON network_provider_snapshot USING gin (services);

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

    CREATE TABLE IF NOT EXISTS network_dataset_state (
      dataset_key TEXT PRIMARY KEY,
      source_sha256 TEXT NOT NULL,
      provider_count INTEGER NOT NULL,
      pricing_count INTEGER NOT NULL,
      availability_count INTEGER NOT NULL,
      loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getCurrentDatasetState(client: DbClient): Promise<{ hash: string; counts: DatasetCounts } | null> {
  const state = await client.query(
    `SELECT source_sha256, provider_count, pricing_count, availability_count
     FROM network_dataset_state
     WHERE dataset_key = $1`,
    [DATASET_KEY],
  );
  const row = state.rows[0];
  if (!row) return null;

  return {
    hash: String(row.source_sha256),
    counts: {
      providers: Number(row.provider_count) || 0,
      pricing: Number(row.pricing_count) || 0,
      availability: Number(row.availability_count) || 0,
    },
  };
}

async function getLiveCounts(client: DbClient): Promise<DatasetCounts> {
  const result = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM network_provider_snapshot) AS providers,
      (SELECT COUNT(*)::int FROM network_pricing_snapshot) AS pricing,
      (SELECT COUNT(*)::int FROM network_availability_snapshot) AS availability
  `);
  const row = result.rows[0] || {};
  return {
    providers: Number(row.providers) || 0,
    pricing: Number(row.pricing) || 0,
    availability: Number(row.availability) || 0,
  };
}

function countsEqual(left: DatasetCounts, right: DatasetCounts): boolean {
  return left.providers === right.providers && left.pricing === right.pricing && left.availability === right.availability;
}

async function createStagingTables(client: DbClient): Promise<void> {
  await client.query(`
    CREATE TEMP TABLE network_provider_stage AS SELECT * FROM network_provider_snapshot WITH NO DATA;
    CREATE TEMP TABLE network_pricing_stage AS SELECT * FROM network_pricing_snapshot WITH NO DATA;
    CREATE TEMP TABLE network_availability_stage AS SELECT * FROM network_availability_snapshot WITH NO DATA;
  `);
}

async function stageProviders(client: DbClient, records: NetworkRecord[]): Promise<void> {
  for (let start = 0; start < records.length; start += PROVIDER_BATCH_SIZE) {
    const batch = records.slice(start, start + PROVIDER_BATCH_SIZE).map((record) => ({
      external_id: record.externalId,
      name: record.name,
      organization_name: record.organizationName,
      site_name: record.siteName,
      facility_type: record.facilityType,
      network_status: record.networkStatus,
      visible: record.visible,
      country: record.country,
      state_region: record.stateRegion,
      city: record.city,
      address1: record.address1,
      address2: record.address2,
      postal_code: record.postalCode,
      latitude: record.latitude,
      longitude: record.longitude,
      phone: record.phone,
      services: record.services,
      last_appointment: record.lastAppointment,
      pricing_available: record.pricingAvailable,
      agreement_component_ids: record.agreementComponentIds,
      service_component_ids: record.serviceComponentIds,
      activity_2026: record.activity2026,
      source_status: record.sourceStatus,
    }));

    await client.query(
      `INSERT INTO network_provider_stage (
        external_id, name, organization_name, site_name, facility_type, network_status, visible,
        country, state_region, city, address1, address2, postal_code, latitude, longitude, phone,
        services, last_appointment, pricing_available, agreement_component_ids, service_component_ids,
        activity_2026, source_status
      )
      SELECT
        x.external_id, x.name, x.organization_name, x.site_name, x.facility_type, x.network_status, x.visible,
        x.country, x.state_region, x.city, x.address1, x.address2, x.postal_code, x.latitude, x.longitude, x.phone,
        x.services, x.last_appointment, x.pricing_available, x.agreement_component_ids, x.service_component_ids,
        x.activity_2026, x.source_status
      FROM jsonb_to_recordset($1::jsonb) AS x(
        external_id INTEGER, name TEXT, organization_name TEXT, site_name TEXT, facility_type TEXT,
        network_status TEXT, visible BOOLEAN, country TEXT, state_region TEXT, city TEXT, address1 TEXT,
        address2 TEXT, postal_code TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, phone TEXT,
        services JSONB, last_appointment TEXT, pricing_available BOOLEAN, agreement_component_ids TEXT,
        service_component_ids TEXT, activity_2026 TEXT, source_status TEXT
      )`,
      [JSON.stringify(batch)],
    );
  }
}

async function stagePricing(client: DbClient, aux: AuxSnapshot): Promise<number> {
  let staged = 0;
  for (let start = 0; start < aux.prices.length; start += INTELLIGENCE_BATCH_SIZE) {
    const batch = aux.prices.slice(start, start + INTELLIGENCE_BATCH_SIZE).map((record) => {
      const clinicIndex = Number(record[0]);
      const componentIndex = Number(record[1]);
      return {
        ...clinicFields(aux, clinicIndex),
        component_name: clean(aux.components[componentIndex], 500),
        numeric_price: toNumber(record[2]),
        source_price_text: clean(record[3], 4_000),
        effective_date: clean(record[4], 80),
        expiration_date: clean(record[5], 80),
        line_item_created: clean(record[6], 80),
      };
    }).filter((row) => row.component_name);

    if (!batch.length) continue;
    await client.query(
      `INSERT INTO network_pricing_stage (
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
    staged += batch.length;
  }
  return staged;
}

async function stageAvailability(client: DbClient, aux: AuxSnapshot): Promise<number> {
  let staged = 0;
  for (let start = 0; start < aux.availability.length; start += INTELLIGENCE_BATCH_SIZE) {
    const batch = aux.availability.slice(start, start + INTELLIGENCE_BATCH_SIZE).map((record) => {
      const clinicIndex = Number(record[0]);
      const componentIndex = Number(record[1]);
      const typeIndex = Number(record[2]);
      return {
        ...clinicFields(aux, clinicIndex),
        component_name: clean(aux.components[componentIndex], 500),
        component_type: clean(aux.types[typeIndex], 200),
      };
    }).filter((row) => row.component_name);

    if (!batch.length) continue;
    await client.query(
      `INSERT INTO network_availability_stage (
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
    staged += batch.length;
  }
  return staged;
}

async function validateStagingCounts(client: DbClient, expected: DatasetCounts): Promise<void> {
  const result = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM network_provider_stage) AS providers,
      (SELECT COUNT(*)::int FROM network_pricing_stage) AS pricing,
      (SELECT COUNT(*)::int FROM network_availability_stage) AS availability
  `);
  const row = result.rows[0] || {};
  const actual: DatasetCounts = {
    providers: Number(row.providers) || 0,
    pricing: Number(row.pricing) || 0,
    availability: Number(row.availability) || 0,
  };

  if (!countsEqual(actual, expected)) {
    throw new Error(`Bundled dataset staging validation failed. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

async function publishStagedDataset(client: DbClient, sourceHash: string, counts: DatasetCounts): Promise<void> {
  await client.query(`TRUNCATE network_provider_snapshot, network_pricing_snapshot, network_availability_snapshot RESTART IDENTITY`);

  await client.query(`
    INSERT INTO network_provider_snapshot (
      external_id, name, organization_name, site_name, facility_type, network_status, visible,
      country, state_region, city, address1, address2, postal_code, latitude, longitude, phone,
      services, last_appointment, pricing_available, agreement_component_ids, service_component_ids,
      activity_2026, source_status
    )
    SELECT
      external_id, name, organization_name, site_name, facility_type, network_status, visible,
      country, state_region, city, address1, address2, postal_code, latitude, longitude, phone,
      services, last_appointment, pricing_available, agreement_component_ids, service_component_ids,
      activity_2026, source_status
    FROM network_provider_stage;

    INSERT INTO network_pricing_snapshot (
      canonical_external_id, network_name, site_name, address1, address2, city, state_region,
      postal_code, phone, country, provider_type, component_name, numeric_price, source_price_text,
      effective_date, expiration_date, line_item_created
    )
    SELECT
      canonical_external_id, network_name, site_name, address1, address2, city, state_region,
      postal_code, phone, country, provider_type, component_name, numeric_price, source_price_text,
      effective_date, expiration_date, line_item_created
    FROM network_pricing_stage;

    INSERT INTO network_availability_snapshot (
      canonical_external_id, network_name, site_name, address1, address2, city, state_region,
      postal_code, phone, country, provider_type, component_name, component_type
    )
    SELECT
      canonical_external_id, network_name, site_name, address1, address2, city, state_region,
      postal_code, phone, country, provider_type, component_name, component_type
    FROM network_availability_stage;
  `);

  await client.query(
    `INSERT INTO network_dataset_state (
       dataset_key, source_sha256, provider_count, pricing_count, availability_count, loaded_at
     ) VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (dataset_key) DO UPDATE SET
       source_sha256 = EXCLUDED.source_sha256,
       provider_count = EXCLUDED.provider_count,
       pricing_count = EXCLUDED.pricing_count,
       availability_count = EXCLUDED.availability_count,
       loaded_at = NOW()`,
    [DATASET_KEY, sourceHash, counts.providers, counts.pricing, counts.availability],
  );
}

export async function bootstrapNetworkData(): Promise<void> {
  if (!pool) {
    const message = "NEON_DATABASE_URL is required for the integrated provider network.";
    if (process.env.NODE_ENV === "production") throw new Error(message);
    logger.warn(message);
    return;
  }

  const datasetPath = resolveBundledDatasetPath();
  const fileBuffer = fs.readFileSync(datasetPath);
  const sourceHash = createHash("sha256").update(fileBuffer).digest("hex");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [DATASET_KEY]);
    await ensureLiveTables(client);

    const existingState = await getCurrentDatasetState(client);
    if (existingState?.hash === sourceHash) {
      const liveCounts = await getLiveCounts(client);
      if (countsEqual(liveCounts, existingState.counts)) {
        await client.query("COMMIT");
        logger.info({ datasetPath, sourceHash, ...liveCounts }, "Bundled Command Center dataset already current in Neon");
        return;
      }
      logger.warn({ expected: existingState.counts, actual: liveCounts }, "Neon dataset counts do not match recorded state; rebuilding from bundled snapshot");
    }

    const html = fileBuffer.toString("utf8");
    const providers = decodeProviderRecords(html);
    const aux = decodeAuxSnapshot(html);

    await createStagingTables(client);
    await stageProviders(client, providers);
    const pricingCount = await stagePricing(client, aux);
    const availabilityCount = await stageAvailability(client, aux);

    const expectedCounts: DatasetCounts = {
      providers: providers.length,
      pricing: pricingCount,
      availability: availabilityCount,
    };

    if (pricingCount !== aux.prices.length) {
      throw new Error(`Pricing dataset validation failed: expected ${aux.prices.length.toLocaleString()} rows, staged ${pricingCount.toLocaleString()}.`);
    }
    if (availabilityCount !== aux.availability.length) {
      throw new Error(`Availability dataset validation failed: expected ${aux.availability.length.toLocaleString()} rows, staged ${availabilityCount.toLocaleString()}.`);
    }

    await validateStagingCounts(client, expectedCounts);
    await publishStagedDataset(client, sourceHash, expectedCounts);
    await client.query("COMMIT");

    logger.info({ datasetPath, sourceHash, ...expectedCounts }, "Bundled Command Center dataset loaded into Neon");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
