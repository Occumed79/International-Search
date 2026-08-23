import express, { Router, type IRouter, type Request } from "express";
import { gunzipSync } from "node:zlib";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { runApiProviderSearch } from "../services/apiProviderSearch";

const router: IRouter = Router();
const MAX_IMPORT_RECORDS = 100_000;
const DEFAULT_LIMIT = 100;

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

function clean(value: unknown, max = 500): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanMultiline(value: unknown, max = 8_000): string {
  return String(value ?? "").trim().slice(0, max);
}

function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeName(value: unknown): string {
  return clean(value, 240).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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
    externalId: asNumber(row.i),
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
    latitude: asNumber(row.lat),
    longitude: asNumber(row.lon),
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

function decodeImportedRecords(buffer: Buffer): CommandCenterRow[] {
  if (!buffer.length) throw new Error("Uploaded Command Center file is empty.");
  const asText = buffer.toString("utf8");

  if (/<!doctype html|<html/i.test(asText.slice(0, 2_000))) {
    const match = asText.match(/const\s+PAYLOAD\s*=\s*"([A-Za-z0-9+/=]+)"\s*;/);
    if (!match?.[1]) throw new Error("Could not locate the embedded Command Center PAYLOAD.");
    const decoded = gunzipSync(Buffer.from(match[1], "base64")).toString("utf8");
    const rows = JSON.parse(decoded);
    if (!Array.isArray(rows)) throw new Error("Command Center payload was not a provider-record array.");
    return rows;
  }

  try {
    const unzipped = gunzipSync(buffer).toString("utf8");
    const rows = JSON.parse(unzipped);
    if (!Array.isArray(rows)) throw new Error("Snapshot was not a provider-record array.");
    return rows;
  } catch {
    const rows = JSON.parse(asText);
    if (!Array.isArray(rows)) throw new Error("Uploaded JSON was not a provider-record array.");
    return rows;
  }
}

async function ensureNetworkTable(): Promise<void> {
  if (!pool) throw new Error("DATABASE_URL is required to use the existing-network dataset.");
  await pool.query(`
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
  `);
}

async function importNetworkRecords(records: NetworkRecord[]): Promise<number> {
  if (!pool) throw new Error("DATABASE_URL is required to import the existing-network dataset.");
  await ensureNetworkTable();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE network_provider_snapshot RESTART IDENTITY");

    const batchSize = 2_000;
    for (let start = 0; start < records.length; start += batchSize) {
      const batch = records.slice(start, start + batchSize).map((record) => ({
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
        `INSERT INTO network_provider_snapshot (
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

    await client.query("COMMIT");
    return records.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function splitServices(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => clean(item, 160)).filter(Boolean);
  return clean(value, 2_000).split(/[|,;\n]+/).map((item) => item.trim()).filter(Boolean);
}

function coverageScore(available: string[], required: string[]): { matched: string[]; missing: string[]; ratio: number } {
  if (!required.length) return { matched: [], missing: [], ratio: 1 };
  const normalizedAvailable = available.map((item) => item.toLowerCase());
  const matched: string[] = [];
  const missing: string[] = [];
  for (const requirement of required) {
    const needle = requirement.toLowerCase();
    const hit = normalizedAvailable.some((service) => service.includes(needle) || needle.includes(service));
    (hit ? matched : missing).push(requirement);
  }
  return { matched, missing, ratio: matched.length / required.length };
}

async function getExplicitIntelligence(externalIds: number[]): Promise<{
  availability: Map<number, string[]>;
  pricingCounts: Map<number, number>;
}> {
  const availability = new Map<number, string[]>();
  const pricingCounts = new Map<number, number>();
  if (!pool || externalIds.length === 0) return { availability, pricingCounts };

  try {
    const [availabilityResult, pricingResult] = await Promise.all([
      pool.query(
        `SELECT canonical_external_id,
                array_agg(DISTINCT component_name ORDER BY component_name) AS components
         FROM network_availability_snapshot
         WHERE canonical_external_id = ANY($1::int[])
         GROUP BY canonical_external_id`,
        [externalIds],
      ),
      pool.query(
        `SELECT canonical_external_id, COUNT(*)::int AS pricing_count
         FROM network_pricing_snapshot
         WHERE canonical_external_id = ANY($1::int[])
         GROUP BY canonical_external_id`,
        [externalIds],
      ),
    ]);

    for (const row of availabilityResult.rows) {
      availability.set(Number(row.canonical_external_id), Array.isArray(row.components) ? row.components.map(String) : []);
    }
    for (const row of pricingResult.rows) {
      pricingCounts.set(Number(row.canonical_external_id), Number(row.pricing_count) || 0);
    }
  } catch (error: any) {
    // The core network snapshot can be imported before the auxiliary intelligence
    // snapshot. Missing aux tables should not make existing-network search fail.
    if (error?.code !== "42P01") logger.warn({ error }, "Explicit network intelligence enrichment failed");
  }

  return { availability, pricingCounts };
}

async function searchExistingNetwork(params: {
  query?: string;
  country?: string;
  state?: string;
  city?: string;
  services?: string[];
  limit?: number;
}) {
  if (!pool) return [];
  await ensureNetworkTable();

  const values: unknown[] = [];
  const where: string[] = [];
  const query = clean(params.query, 200);
  const country = normalizeCountry(params.country);
  const state = clean(params.state, 100);
  const city = clean(params.city, 120);

  if (query) {
    values.push(`%${query}%`);
    const p = `$${values.length}`;
    where.push(`(name ILIKE ${p} OR organization_name ILIKE ${p} OR site_name ILIKE ${p} OR facility_type ILIKE ${p} OR city ILIKE ${p} OR state_region ILIKE ${p} OR address1 ILIKE ${p} OR services::text ILIKE ${p})`);
  }
  if (country) {
    values.push(country);
    where.push(`country ILIKE $${values.length}`);
  }
  if (state) {
    values.push(state);
    where.push(`state_region ILIKE $${values.length}`);
  }
  if (city) {
    values.push(`%${city}%`);
    where.push(`city ILIKE $${values.length}`);
  }

  const limit = Math.max(1, Math.min(500, Number(params.limit || DEFAULT_LIMIT)));
  values.push(limit);
  const result = await pool.query(
    `SELECT * FROM network_provider_snapshot
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY
       CASE network_status
         WHEN 'Active Agreement' THEN 0
         WHEN 'No Agreement Date' THEN 1
         WHEN 'Expired' THEN 2
         WHEN 'No Agreement / Unmatched' THEN 3
         WHEN '2026 New / Unreconciled' THEN 4
         ELSE 5
       END,
       name
     LIMIT $${values.length}`,
    values,
  );

  const externalIds = [...new Set(
    result.rows
      .map((row) => Number(row.external_id))
      .filter((id) => Number.isFinite(id)),
  )];
  const explicit = await getExplicitIntelligence(externalIds);
  const requiredServices = params.services || [];

  return result.rows.map((row) => {
    const externalId = Number.isFinite(Number(row.external_id)) ? Number(row.external_id) : null;
    const taggedServices = Array.isArray(row.services) ? row.services.map(String) : [];
    const explicitAvailability = externalId == null ? [] : (explicit.availability.get(externalId) || []);
    const services = [...new Set([...taggedServices, ...explicitAvailability])];
    const coverage = coverageScore(services, requiredServices);
    const pricingLineCount = externalId == null ? 0 : (explicit.pricingCounts.get(externalId) || 0);

    return {
      id: `network-${row.id}`,
      externalId,
      providerName: row.name,
      organizationName: row.organization_name,
      siteName: row.site_name,
      facilityType: row.facility_type,
      networkStatus: row.network_status,
      visible: row.visible,
      country: row.country,
      stateRegion: row.state_region,
      city: row.city,
      address: [row.address1, row.address2].filter(Boolean).join(", "),
      postalCode: row.postal_code,
      latitude: row.latitude,
      longitude: row.longitude,
      phone: row.phone,
      services,
      taggedServices,
      explicitAvailability,
      explicitAvailabilityCount: explicitAvailability.length,
      lastAppointment: row.last_appointment,
      pricingAvailable: Boolean(row.pricing_available || pricingLineCount > 0),
      pricingLineCount,
      activity2026: row.activity_2026,
      sourceStatus: row.source_status,
      matchedServices: coverage.matched,
      missingServices: coverage.missing,
      coverageRatio: coverage.ratio,
      source: "existing_network",
    };
  }).sort((a, b) => {
    if (b.coverageRatio !== a.coverageRatio) return b.coverageRatio - a.coverageRatio;
    if (a.networkStatus === "Active Agreement" && b.networkStatus !== "Active Agreement") return -1;
    if (b.networkStatus === "Active Agreement" && a.networkStatus !== "Active Agreement") return 1;
    return String(a.providerName).localeCompare(String(b.providerName));
  });
}

router.post(
  "/network/import",
  express.raw({ type: ["text/html", "application/octet-stream", "application/gzip", "application/x-gzip", "text/plain"], limit: "30mb" }),
  async (req: Request, res): Promise<void> => {
    try {
      if (!pool) {
        res.status(503).json({ error: "DATABASE_URL is required before importing the network snapshot." });
        return;
      }
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ""));
      const decoded = decodeImportedRecords(buffer);
      if (decoded.length > MAX_IMPORT_RECORDS) throw new Error(`Snapshot contains ${decoded.length} records; maximum is ${MAX_IMPORT_RECORDS}.`);
      const records = decoded.map(commandCenterRowToNetwork).filter((row): row is NetworkRecord => Boolean(row));
      const imported = await importNetworkRecords(records);
      res.json({ imported, sourceRecords: decoded.length, message: "Existing Occu-Med network snapshot imported." });
    } catch (error) {
      logger.error({ error }, "Command Center snapshot import failed");
      res.status(400).json({ error: error instanceof Error ? error.message : "Snapshot import failed." });
    }
  },
);

router.get("/network/stats", async (_req, res): Promise<void> => {
  try {
    if (!pool) {
      res.json({ total: 0, activeAgreements: 0, serviceTagged: 0, gpsReady: 0, pricingAvailable: 0, importedAt: null });
      return;
    }
    await ensureNetworkTable();
    const result = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE network_status = 'Active Agreement')::int AS active_agreements,
        COUNT(*) FILTER (WHERE jsonb_array_length(services) > 0)::int AS service_tagged,
        COUNT(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL)::int AS gps_ready,
        COUNT(*) FILTER (WHERE pricing_available)::int AS pricing_available,
        MAX(imported_at) AS imported_at
      FROM network_provider_snapshot
    `);
    const row = result.rows[0] || {};
    res.json({
      total: row.total || 0,
      activeAgreements: row.active_agreements || 0,
      serviceTagged: row.service_tagged || 0,
      gpsReady: row.gps_ready || 0,
      pricingAvailable: row.pricing_available || 0,
      importedAt: row.imported_at || null,
    });
  } catch (error) {
    logger.warn({ error }, "Network stats failed");
    res.status(500).json({ error: "Could not read network stats." });
  }
});

router.get("/network/search", async (req, res): Promise<void> => {
  try {
    const services = splitServices(req.query.services);
    const results = await searchExistingNetwork({
      query: clean(req.query.q, 200),
      country: clean(req.query.country, 80),
      state: clean(req.query.state, 100),
      city: clean(req.query.city, 120),
      services,
      limit: Number(req.query.limit || DEFAULT_LIMIT),
    });
    res.json({ results, total: results.length });
  } catch (error) {
    logger.warn({ error }, "Existing network search failed");
    res.status(500).json({ error: "Existing network search failed." });
  }
});

router.post("/sourcing/search", async (req, res): Promise<void> => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const query = clean(body.query, 200) || "occupational health";
    const country = normalizeCountry(body.country);
    const state = clean(body.state, 100);
    const city = clean(body.city, 120);
    const services = splitServices(body.services);
    const includeExternal = body.includeExternal !== false;
    const forceExternal = body.forceExternal === true;

    const existing = await searchExistingNetwork({ query, country, state, city, services, limit: 200 });
    const qualifiedExisting = existing.filter((row) => row.coverageRatio >= 1 && row.networkStatus === "Active Agreement");
    const shouldSearchOutside = includeExternal && (forceExternal || qualifiedExisting.length < 3);

    let external: Array<Record<string, unknown>> = [];
    let externalSources = { keenable: 0, tinyfish: 0, exa: 0 };
    let fallbackUsed = false;

    if (shouldSearchOutside) {
      const externalSearch = await runApiProviderSearch({
        query: [query, ...services].filter(Boolean).join(" "),
        country: country || undefined,
        state: state || undefined,
        city: city || undefined,
        providerType: clean(body.providerType, 80) || undefined,
        radiusMiles: Number(body.radiusMiles || 25),
      });
      externalSources = externalSearch.sources;
      fallbackUsed = externalSearch.fallbackUsed;

      const existingNames = new Set(existing.map((row) => normalizeName(row.providerName)));
      external = externalSearch.results.map((hit) => {
        const nameKey = normalizeName(hit.providerName);
        return {
          ...hit,
          source: "outside_network",
          networkStatus: existingNames.has(nameKey) ? "Existing / possible match" : "NEW — not in current network search",
          matchedServices: services,
          missingServices: [],
          coverageRatio: services.length ? 0.5 : 1,
        };
      });
    }

    res.json({
      requirement: { query, country, state, city, services },
      summary: {
        existingMatches: existing.length,
        qualifiedActiveMatches: qualifiedExisting.length,
        searchedOutsideNetwork: shouldSearchOutside,
        externalCandidates: external.length,
      },
      existing,
      external,
      externalSources,
      fallbackUsed,
    });
  } catch (error) {
    logger.error({ error }, "Provider sourcing search failed");
    res.status(500).json({ error: error instanceof Error ? error.message : "Provider sourcing search failed." });
  }
});

export default router;
