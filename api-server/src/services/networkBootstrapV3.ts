import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const DATASET_KEY = "occumed-command-center-rich-v3";
const DATASET_FILENAME = "OccuMed_Command_Center.html";
const PROVIDER_BATCH_SIZE = 1_500;
const INTELLIGENCE_BATCH_SIZE = 4_000;

type DbPool = NonNullable<typeof pool>;
type Row = Record<string, unknown>;
type Counts = { providers: number; pricing: number; availability: number };

type ProviderRecord = {
  externalId: number | null;
  name: string;
  organizationName: string;
  siteName: string;
  siteDisplay: string;
  facilityType: string;
  networkStatus: string;
  visible: boolean | null;
  country: string;
  stateRegion: string;
  city: string;
  county: string;
  address1: string;
  address2: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
  coordinateQuality: string;
  phone: string;
  fax: string;
  contactName: string;
  timezone: string;
  hoursScheduling: string;
  billingTerms: string;
  sourceCreatedAt: string;
  sourceCreatedBy: string;
  harvest: string;
  services: string[];
  lastAppointment: string;
  pricingAvailable: boolean;
  approvedIds: string;
  signedIds: string;
  activity2026: string;
  activity2026Category: string;
  agreement2026: string;
  agreementDate2026: string;
  pricingServiceComponents2026: string;
  internalNotes: string;
  examineeInstructions: string;
  auditHistory: string;
  sourceStatus: string;
};

type AuxSnapshot = {
  clinics: unknown[][];
  components: string[];
  types: string[];
  prices: unknown[][];
  availability: unknown[][];
};

function clean(value: unknown, max = 500): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanMultiline(value: unknown, max = 20_000): string {
  return String(value ?? "").trim().slice(0, max);
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeCountry(value: unknown): string {
  const raw = clean(value, 100);
  return ["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"].includes(raw.toUpperCase()) ? "United States" : raw;
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

function decodeProviders(html: string): ProviderRecord[] {
  const rawRows = extractEmbeddedJson<unknown>(html, "PAYLOAD");
  if (!Array.isArray(rawRows)) throw new Error("PAYLOAD is not an array.");
  const providers = rawRows.map((raw) => {
    const row = raw as Row;
    const name = clean(row.n || row.site || row.org, 240);
    if (!name) return null;
    const services = Array.isArray(row.sv)
      ? row.sv.map((value) => clean(value, 180)).filter(Boolean)
      : clean(row.sv, 4_000).split(/[|,;\n]+/).map((value) => value.trim()).filter(Boolean);
    return {
      externalId: toNumber(row.i),
      name,
      organizationName: clean(row.org || row.n, 240),
      siteName: clean(row.site || row.n, 240),
      siteDisplay: clean(row.site_display || row.site || row.n, 300),
      facilityType: clean(row.ft, 160),
      networkStatus: clean(row.st, 120) || "Unknown",
      visible: typeof row.v === "boolean" ? row.v : null,
      country: normalizeCountry(row.co),
      stateRegion: clean(row.rg, 100),
      city: clean(row.cy, 120),
      county: clean(row.cty, 160),
      address1: clean(row.a, 300),
      address2: clean(row.a2, 250),
      postalCode: clean(row.z, 50),
      latitude: toNumber(row.lat),
      longitude: toNumber(row.lon),
      coordinateQuality: clean(row.gpsq, 240),
      phone: clean(row.ph, 100),
      fax: clean(row.fx, 100),
      contactName: clean(row.cn, 300),
      timezone: clean(row.tz, 160),
      hoursScheduling: cleanMultiline(row.hr, 12_000),
      billingTerms: cleanMultiline(row.bill, 4_000),
      sourceCreatedAt: clean(row.cr, 120),
      sourceCreatedBy: clean(row.ca, 300),
      harvest: cleanMultiline(row.hc, 4_000),
      services: [...new Set(services)],
      lastAppointment: clean(row.la || row.us2_last_appt, 120),
      pricingAvailable: Boolean(row.us2_pricing_flag || clean(row.pa, 20)),
      approvedIds: cleanMultiline(row.pa, 20_000),
      signedIds: cleanMultiline(row.ps, 20_000),
      activity2026: clean(row.y26, 240),
      activity2026Category: clean(row.m26, 500),
      agreement2026: cleanMultiline(row.d26, 4_000),
      agreementDate2026: clean(row.c26, 160),
      pricingServiceComponents2026: cleanMultiline(row.p26, 16_000),
      internalNotes: cleanMultiline(row.no || row.mpr, 20_000),
      examineeInstructions: cleanMultiline(row.ins, 20_000),
      auditHistory: cleanMultiline(row.au, 20_000),
      sourceStatus: clean(row.source_status, 240),
    } satisfies ProviderRecord;
  }).filter((row): row is ProviderRecord => row !== null);
  if (providers.length !== rawRows.length) throw new Error(`Provider validation failed: expected ${rawRows.length}, decoded ${providers.length}.`);
  return providers;
}

function decodeAux(html: string): AuxSnapshot {
  const value = extractEmbeddedJson<unknown>(html, "AUX_PAYLOAD") as Partial<AuxSnapshot>;
  if (!value || !Array.isArray(value.clinics) || !Array.isArray(value.components) || !Array.isArray(value.types) || !Array.isArray(value.prices) || !Array.isArray(value.availability)) throw new Error("AUX_PAYLOAD is incomplete.");
  return value as AuxSnapshot;
}

function clinicFields(aux: AuxSnapshot, clinicIndex: number) {
  const clinic = aux.clinics[clinicIndex] || [];
  return {
    canonical_external_id: toNumber(clinic[0]), network_name: clean(clinic[1], 240), site_name: clean(clinic[2], 240),
    address1: clean(clinic[3], 300), address2: clean(clinic[4], 220), city: clean(clinic[5], 120), state_region: clean(clinic[6], 100),
    postal_code: clean(clinic[7], 50), phone: clean(clinic[8], 100), country: normalizeCountry(clinic[9]), provider_type: clean(clinic[10], 160),
  };
}

async function ensureTables(dbPool: DbPool) {
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS network_provider_snapshot (
      id BIGSERIAL PRIMARY KEY, external_id INTEGER, name TEXT NOT NULL, organization_name TEXT, site_name TEXT,
      facility_type TEXT, network_status TEXT, visible BOOLEAN, country TEXT, state_region TEXT, city TEXT,
      address1 TEXT, address2 TEXT, postal_code TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
      phone TEXT, services JSONB NOT NULL DEFAULT '[]'::jsonb, last_appointment TEXT,
      pricing_available BOOLEAN NOT NULL DEFAULT FALSE, agreement_component_ids TEXT, service_component_ids TEXT,
      activity_2026 TEXT, source_status TEXT, imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE network_provider_snapshot ADD COLUMN IF NOT EXISTS site_display TEXT;
    ALTER TABLE network_provider_snapshot ADD COLUMN IF NOT EXISTS county TEXT;
    ALTER TABLE network_provider_snapshot ADD COLUMN IF NOT EXISTS coordinate_quality TEXT;
    ALTER TABLE network_provider_snapshot ADD COLUMN IF NOT EXISTS fax TEXT;
    ALTER TABLE network_provider_snapshot ADD COLUMN IF NOT EXISTS contact_name TEXT;
    ALTER TABLE network_provider_snapshot ADD COLUMN IF NOT EXISTS timezone TEXT;
    ALTER TABLE network_provider_snapshot ADD COLUMN IF NOT EXISTS hours_scheduling TEXT;
    ALTER TABLE network_provider_snapshot ADD COLUMN IF NOT EXISTS billing_terms TEXT;
    ALTER TABLE network_provider_snapshot ADD COLUMN IF NOT EXISTS source_created_at TEXT;
    ALTER TABLE network_provider_snapshot ADD COLUMN IF NOT EXISTS source_created_by TEXT;
    ALTER TABLE network_provider_snapshot ADD COLUMN IF NOT EXISTS harvest TEXT;
    ALTER TABLE network_provider_snapshot ADD COLUMN IF NOT EXISTS activity_2026_category TEXT;
    ALTER TABLE network_provider_snapshot ADD COLUMN IF NOT EXISTS agreement_2026 TEXT;
    ALTER TABLE network_provider_snapshot ADD COLUMN IF NOT EXISTS agreement_date_2026 TEXT;
    ALTER TABLE network_provider_snapshot ADD COLUMN IF NOT EXISTS pricing_service_components_2026 TEXT;
    ALTER TABLE network_provider_snapshot ADD COLUMN IF NOT EXISTS internal_notes TEXT;
    ALTER TABLE network_provider_snapshot ADD COLUMN IF NOT EXISTS examinee_instructions TEXT;
    ALTER TABLE network_provider_snapshot ADD COLUMN IF NOT EXISTS audit_history TEXT;
    CREATE INDEX IF NOT EXISTS network_provider_snapshot_geo_idx ON network_provider_snapshot (country, state_region, city);
    CREATE INDEX IF NOT EXISTS network_provider_snapshot_status_idx ON network_provider_snapshot (network_status);
    CREATE INDEX IF NOT EXISTS network_provider_snapshot_services_idx ON network_provider_snapshot USING gin (services);

    CREATE TABLE IF NOT EXISTS network_pricing_snapshot (
      id BIGSERIAL PRIMARY KEY, canonical_external_id INTEGER, network_name TEXT, site_name TEXT, address1 TEXT,
      address2 TEXT, city TEXT, state_region TEXT, postal_code TEXT, phone TEXT, country TEXT, provider_type TEXT,
      component_name TEXT NOT NULL, numeric_price DOUBLE PRECISION, source_price_text TEXT, effective_date TEXT,
      expiration_date TEXT, line_item_created TEXT, imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS network_availability_snapshot (
      id BIGSERIAL PRIMARY KEY, canonical_external_id INTEGER, network_name TEXT, site_name TEXT, address1 TEXT,
      address2 TEXT, city TEXT, state_region TEXT, postal_code TEXT, phone TEXT, country TEXT, provider_type TEXT,
      component_name TEXT NOT NULL, component_type TEXT, imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
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
    ALTER TABLE network_provider_stage ADD COLUMN IF NOT EXISTS site_display TEXT;
    ALTER TABLE network_provider_stage ADD COLUMN IF NOT EXISTS county TEXT;
    ALTER TABLE network_provider_stage ADD COLUMN IF NOT EXISTS coordinate_quality TEXT;
    ALTER TABLE network_provider_stage ADD COLUMN IF NOT EXISTS fax TEXT;
    ALTER TABLE network_provider_stage ADD COLUMN IF NOT EXISTS contact_name TEXT;
    ALTER TABLE network_provider_stage ADD COLUMN IF NOT EXISTS timezone TEXT;
    ALTER TABLE network_provider_stage ADD COLUMN IF NOT EXISTS hours_scheduling TEXT;
    ALTER TABLE network_provider_stage ADD COLUMN IF NOT EXISTS billing_terms TEXT;
    ALTER TABLE network_provider_stage ADD COLUMN IF NOT EXISTS source_created_at TEXT;
    ALTER TABLE network_provider_stage ADD COLUMN IF NOT EXISTS source_created_by TEXT;
    ALTER TABLE network_provider_stage ADD COLUMN IF NOT EXISTS harvest TEXT;
    ALTER TABLE network_provider_stage ADD COLUMN IF NOT EXISTS activity_2026_category TEXT;
    ALTER TABLE network_provider_stage ADD COLUMN IF NOT EXISTS agreement_2026 TEXT;
    ALTER TABLE network_provider_stage ADD COLUMN IF NOT EXISTS agreement_date_2026 TEXT;
    ALTER TABLE network_provider_stage ADD COLUMN IF NOT EXISTS pricing_service_components_2026 TEXT;
    ALTER TABLE network_provider_stage ADD COLUMN IF NOT EXISTS internal_notes TEXT;
    ALTER TABLE network_provider_stage ADD COLUMN IF NOT EXISTS examinee_instructions TEXT;
    ALTER TABLE network_provider_stage ADD COLUMN IF NOT EXISTS audit_history TEXT;

    CREATE TABLE IF NOT EXISTS network_pricing_stage (
      run_id TEXT NOT NULL, canonical_external_id INTEGER, network_name TEXT, site_name TEXT, address1 TEXT, address2 TEXT,
      city TEXT, state_region TEXT, postal_code TEXT, phone TEXT, country TEXT, provider_type TEXT, component_name TEXT NOT NULL,
      numeric_price DOUBLE PRECISION, source_price_text TEXT, effective_date TEXT, expiration_date TEXT, line_item_created TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS network_availability_stage (
      run_id TEXT NOT NULL, canonical_external_id INTEGER, network_name TEXT, site_name TEXT, address1 TEXT, address2 TEXT,
      city TEXT, state_region TEXT, postal_code TEXT, phone TEXT, country TEXT, provider_type TEXT, component_name TEXT NOT NULL,
      component_type TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await dbPool.query(`DELETE FROM network_provider_stage WHERE created_at < NOW() - INTERVAL '24 hours'`);
  await dbPool.query(`DELETE FROM network_pricing_stage WHERE created_at < NOW() - INTERVAL '24 hours'`);
  await dbPool.query(`DELETE FROM network_availability_stage WHERE created_at < NOW() - INTERVAL '24 hours'`);
}

async function liveCounts(dbPool: DbPool): Promise<Counts> {
  const result = await dbPool.query(`SELECT (SELECT COUNT(*)::int FROM network_provider_snapshot) providers, (SELECT COUNT(*)::int FROM network_pricing_snapshot) pricing, (SELECT COUNT(*)::int FROM network_availability_snapshot) availability`);
  const row = result.rows[0] || {};
  return { providers: Number(row.providers) || 0, pricing: Number(row.pricing) || 0, availability: Number(row.availability) || 0 };
}

function sameCounts(a: Counts, b: Counts) { return a.providers === b.providers && a.pricing === b.pricing && a.availability === b.availability; }

async function current(dbPool: DbPool, sourceHash: string) {
  const result = await dbPool.query(`SELECT source_sha256, provider_count, pricing_count, availability_count FROM network_dataset_state WHERE dataset_key=$1`, [DATASET_KEY]);
  const row = result.rows[0];
  if (!row || String(row.source_sha256) !== sourceHash) return false;
  return sameCounts(await liveCounts(dbPool), { providers: Number(row.provider_count) || 0, pricing: Number(row.pricing_count) || 0, availability: Number(row.availability_count) || 0 });
}

async function cleanup(dbPool: DbPool, runId: string) {
  await dbPool.query(`DELETE FROM network_provider_stage WHERE run_id=$1`, [runId]);
  await dbPool.query(`DELETE FROM network_pricing_stage WHERE run_id=$1`, [runId]);
  await dbPool.query(`DELETE FROM network_availability_stage WHERE run_id=$1`, [runId]);
}

async function stageProviders(dbPool: DbPool, runId: string, providers: ProviderRecord[]) {
  for (let start = 0; start < providers.length; start += PROVIDER_BATCH_SIZE) {
    const batch = providers.slice(start, start + PROVIDER_BATCH_SIZE).map((r) => ({
      external_id: r.externalId, name: r.name, organization_name: r.organizationName, site_name: r.siteName, site_display: r.siteDisplay,
      facility_type: r.facilityType, network_status: r.networkStatus, visible: r.visible, country: r.country, state_region: r.stateRegion,
      city: r.city, county: r.county, address1: r.address1, address2: r.address2, postal_code: r.postalCode,
      latitude: r.latitude, longitude: r.longitude, coordinate_quality: r.coordinateQuality, phone: r.phone, fax: r.fax,
      contact_name: r.contactName, timezone: r.timezone, hours_scheduling: r.hoursScheduling, billing_terms: r.billingTerms,
      source_created_at: r.sourceCreatedAt, source_created_by: r.sourceCreatedBy, harvest: r.harvest, services: r.services,
      last_appointment: r.lastAppointment, pricing_available: r.pricingAvailable, agreement_component_ids: r.approvedIds,
      service_component_ids: r.signedIds, activity_2026: r.activity2026, activity_2026_category: r.activity2026Category,
      agreement_2026: r.agreement2026, agreement_date_2026: r.agreementDate2026,
      pricing_service_components_2026: r.pricingServiceComponents2026, internal_notes: r.internalNotes,
      examinee_instructions: r.examineeInstructions, audit_history: r.auditHistory, source_status: r.sourceStatus,
    }));
    await dbPool.query(`INSERT INTO network_provider_stage (
      run_id, external_id, name, organization_name, site_name, site_display, facility_type, network_status, visible,
      country, state_region, city, county, address1, address2, postal_code, latitude, longitude, coordinate_quality,
      phone, fax, contact_name, timezone, hours_scheduling, billing_terms, source_created_at, source_created_by, harvest,
      services, last_appointment, pricing_available, agreement_component_ids, service_component_ids, activity_2026,
      activity_2026_category, agreement_2026, agreement_date_2026, pricing_service_components_2026, internal_notes,
      examinee_instructions, audit_history, source_status
    ) SELECT $2::text, x.external_id, x.name, x.organization_name, x.site_name, x.site_display, x.facility_type,
      x.network_status, x.visible, x.country, x.state_region, x.city, x.county, x.address1, x.address2, x.postal_code,
      x.latitude, x.longitude, x.coordinate_quality, x.phone, x.fax, x.contact_name, x.timezone, x.hours_scheduling,
      x.billing_terms, x.source_created_at, x.source_created_by, x.harvest, x.services, x.last_appointment,
      x.pricing_available, x.agreement_component_ids, x.service_component_ids, x.activity_2026, x.activity_2026_category,
      x.agreement_2026, x.agreement_date_2026, x.pricing_service_components_2026, x.internal_notes,
      x.examinee_instructions, x.audit_history, x.source_status
    FROM jsonb_to_recordset($1::jsonb) AS x(
      external_id INTEGER, name TEXT, organization_name TEXT, site_name TEXT, site_display TEXT, facility_type TEXT,
      network_status TEXT, visible BOOLEAN, country TEXT, state_region TEXT, city TEXT, county TEXT, address1 TEXT,
      address2 TEXT, postal_code TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, coordinate_quality TEXT,
      phone TEXT, fax TEXT, contact_name TEXT, timezone TEXT, hours_scheduling TEXT, billing_terms TEXT,
      source_created_at TEXT, source_created_by TEXT, harvest TEXT, services JSONB, last_appointment TEXT,
      pricing_available BOOLEAN, agreement_component_ids TEXT, service_component_ids TEXT, activity_2026 TEXT,
      activity_2026_category TEXT, agreement_2026 TEXT, agreement_date_2026 TEXT, pricing_service_components_2026 TEXT,
      internal_notes TEXT, examinee_instructions TEXT, audit_history TEXT, source_status TEXT
    )`, [JSON.stringify(batch), runId]);
    logger.info({ runId, stagedProviders: Math.min(start + batch.length, providers.length), providerTotal: providers.length }, "Command Center provider staging progress");
  }
}

async function stagePricing(dbPool: DbPool, runId: string, aux: AuxSnapshot) {
  let count = 0;
  for (let start = 0; start < aux.prices.length; start += INTELLIGENCE_BATCH_SIZE) {
    const batch = aux.prices.slice(start, start + INTELLIGENCE_BATCH_SIZE).map((record) => ({
      ...clinicFields(aux, Number(record[0])), component_name: clean(aux.components[Number(record[1])], 500) || "Unspecified pricing line item",
      numeric_price: toNumber(record[2]), source_price_text: cleanMultiline(record[3], 4_000), effective_date: clean(record[4], 80),
      expiration_date: clean(record[5], 80), line_item_created: clean(record[6], 80),
    }));
    await dbPool.query(`INSERT INTO network_pricing_stage (
      run_id, canonical_external_id, network_name, site_name, address1, address2, city, state_region, postal_code, phone,
      country, provider_type, component_name, numeric_price, source_price_text, effective_date, expiration_date, line_item_created
    ) SELECT $2::text, x.canonical_external_id, x.network_name, x.site_name, x.address1, x.address2, x.city, x.state_region,
      x.postal_code, x.phone, x.country, x.provider_type, x.component_name, x.numeric_price, x.source_price_text,
      x.effective_date, x.expiration_date, x.line_item_created FROM jsonb_to_recordset($1::jsonb) AS x(
      canonical_external_id INTEGER, network_name TEXT, site_name TEXT, address1 TEXT, address2 TEXT, city TEXT,
      state_region TEXT, postal_code TEXT, phone TEXT, country TEXT, provider_type TEXT, component_name TEXT,
      numeric_price DOUBLE PRECISION, source_price_text TEXT, effective_date TEXT, expiration_date TEXT, line_item_created TEXT
    )`, [JSON.stringify(batch), runId]);
    count += batch.length;
  }
  return count;
}

async function stageAvailability(dbPool: DbPool, runId: string, aux: AuxSnapshot) {
  let count = 0;
  for (let start = 0; start < aux.availability.length; start += INTELLIGENCE_BATCH_SIZE) {
    const batch = aux.availability.slice(start, start + INTELLIGENCE_BATCH_SIZE).map((record) => ({
      ...clinicFields(aux, Number(record[0])), component_name: clean(aux.components[Number(record[1])], 500), component_type: clean(aux.types[Number(record[2])], 200),
    })).filter((row) => row.component_name);
    await dbPool.query(`INSERT INTO network_availability_stage (
      run_id, canonical_external_id, network_name, site_name, address1, address2, city, state_region, postal_code, phone,
      country, provider_type, component_name, component_type
    ) SELECT $2::text, x.canonical_external_id, x.network_name, x.site_name, x.address1, x.address2, x.city, x.state_region,
      x.postal_code, x.phone, x.country, x.provider_type, x.component_name, x.component_type FROM jsonb_to_recordset($1::jsonb) AS x(
      canonical_external_id INTEGER, network_name TEXT, site_name TEXT, address1 TEXT, address2 TEXT, city TEXT,
      state_region TEXT, postal_code TEXT, phone TEXT, country TEXT, provider_type TEXT, component_name TEXT, component_type TEXT
    )`, [JSON.stringify(batch), runId]);
    count += batch.length;
  }
  return count;
}

async function validateStage(dbPool: DbPool, runId: string, expected: Counts) {
  const result = await dbPool.query(`SELECT (SELECT COUNT(*)::int FROM network_provider_stage WHERE run_id=$1) providers, (SELECT COUNT(*)::int FROM network_pricing_stage WHERE run_id=$1) pricing, (SELECT COUNT(*)::int FROM network_availability_stage WHERE run_id=$1) availability`, [runId]);
  const row = result.rows[0] || {};
  const actual = { providers: Number(row.providers) || 0, pricing: Number(row.pricing) || 0, availability: Number(row.availability) || 0 };
  if (!sameCounts(actual, expected)) throw new Error(`Staging count mismatch. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
}

async function publish(dbPool: DbPool, runId: string, sourceHash: string, counts: Counts) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [DATASET_KEY]);
    await client.query(`TRUNCATE network_provider_snapshot, network_pricing_snapshot, network_availability_snapshot RESTART IDENTITY`);
    await client.query(`INSERT INTO network_provider_snapshot (
      external_id, name, organization_name, site_name, site_display, facility_type, network_status, visible, country,
      state_region, city, county, address1, address2, postal_code, latitude, longitude, coordinate_quality, phone, fax,
      contact_name, timezone, hours_scheduling, billing_terms, source_created_at, source_created_by, harvest, services,
      last_appointment, pricing_available, agreement_component_ids, service_component_ids, activity_2026,
      activity_2026_category, agreement_2026, agreement_date_2026, pricing_service_components_2026, internal_notes,
      examinee_instructions, audit_history, source_status
    ) SELECT external_id, name, organization_name, site_name, site_display, facility_type, network_status, visible, country,
      state_region, city, county, address1, address2, postal_code, latitude, longitude, coordinate_quality, phone, fax,
      contact_name, timezone, hours_scheduling, billing_terms, source_created_at, source_created_by, harvest, services,
      last_appointment, pricing_available, agreement_component_ids, service_component_ids, activity_2026,
      activity_2026_category, agreement_2026, agreement_date_2026, pricing_service_components_2026, internal_notes,
      examinee_instructions, audit_history, source_status FROM network_provider_stage WHERE run_id=$1`, [runId]);
    await client.query(`INSERT INTO network_pricing_snapshot (
      canonical_external_id, network_name, site_name, address1, address2, city, state_region, postal_code, phone, country,
      provider_type, component_name, numeric_price, source_price_text, effective_date, expiration_date, line_item_created
    ) SELECT canonical_external_id, network_name, site_name, address1, address2, city, state_region, postal_code, phone,
      country, provider_type, component_name, numeric_price, source_price_text, effective_date, expiration_date,
      line_item_created FROM network_pricing_stage WHERE run_id=$1`, [runId]);
    await client.query(`INSERT INTO network_availability_snapshot (
      canonical_external_id, network_name, site_name, address1, address2, city, state_region, postal_code, phone, country,
      provider_type, component_name, component_type
    ) SELECT canonical_external_id, network_name, site_name, address1, address2, city, state_region, postal_code, phone,
      country, provider_type, component_name, component_type FROM network_availability_stage WHERE run_id=$1`, [runId]);
    await client.query(`INSERT INTO network_dataset_state (dataset_key, source_sha256, provider_count, pricing_count, availability_count, loaded_at)
      VALUES ($1,$2,$3,$4,$5,NOW()) ON CONFLICT (dataset_key) DO UPDATE SET source_sha256=EXCLUDED.source_sha256,
      provider_count=EXCLUDED.provider_count, pricing_count=EXCLUDED.pricing_count, availability_count=EXCLUDED.availability_count,
      loaded_at=NOW()`, [DATASET_KEY, sourceHash, counts.providers, counts.pricing, counts.availability]);
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
  if (await current(dbPool, sourceHash)) {
    logger.info({ datasetPath, sourceHash, ...(await liveCounts(dbPool)) }, "Rich Command Center dataset already current in Neon");
    return;
  }

  const html = fileBuffer.toString("utf8");
  const runId = randomUUID();
  try {
    let providerCount = 0;
    {
      const providers = decodeProviders(html);
      providerCount = providers.length;
      await stageProviders(dbPool, runId, providers);
    }
    const aux = decodeAux(html);
    const pricing = await stagePricing(dbPool, runId, aux);
    const availability = await stageAvailability(dbPool, runId, aux);
    const expected = { providers: providerCount, pricing, availability };
    if (pricing !== aux.prices.length) throw new Error(`Pricing validation failed: expected ${aux.prices.length}, staged ${pricing}.`);
    if (availability !== aux.availability.length) throw new Error(`Availability validation failed: expected ${aux.availability.length}, staged ${availability}.`);
    await validateStage(dbPool, runId, expected);
    await publish(dbPool, runId, sourceHash, expected);
    const live = await liveCounts(dbPool);
    if (!sameCounts(live, expected)) throw new Error(`Published count mismatch. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(live)}.`);
    logger.info({ datasetPath, sourceHash, runId, ...expected }, "Rich Command Center dataset loaded into Neon");
  } finally {
    await cleanup(dbPool, runId).catch((error: unknown) => logger.warn({ error, runId }, "Could not clean rich bootstrap staging rows"));
  }
}
