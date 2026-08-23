import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { runApiProviderSearch } from "../services/apiProviderSearch";

const router: IRouter = Router();
const DEFAULT_LIMIT = 100;

function clean(value: unknown, max = 500): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
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

async function ensureNetworkTable(): Promise<void> {
  if (!pool) throw new Error("NEON_DATABASE_URL is required for the provider network.");
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

async function getExplicitCandidateIds(requiredServices: string[]): Promise<number[]> {
  if (!pool || requiredServices.length === 0) return [];
  const patterns = requiredServices.map((service) => `%${service}%`);
  try {
    const result = await pool.query(
      `SELECT DISTINCT canonical_external_id
       FROM network_availability_snapshot
       WHERE component_name ILIKE ANY($1::text[])
       LIMIT 20000`,
      [patterns],
    );
    return result.rows.map((row) => Number(row.canonical_external_id)).filter((id) => Number.isFinite(id));
  } catch (error: any) {
    if (error?.code !== "42P01") logger.warn({ error }, "Explicit availability candidate lookup failed");
    return [];
  }
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
  const requiredServices = params.services || [];
  const explicitCandidateIds = await getExplicitCandidateIds(requiredServices);

  const discoveryClauses: string[] = [];
  if (query) {
    values.push(`%${query}%`);
    const p = `$${values.length}`;
    discoveryClauses.push(`name ILIKE ${p}`, `organization_name ILIKE ${p}`, `site_name ILIKE ${p}`, `facility_type ILIKE ${p}`, `services::text ILIKE ${p}`);
  }
  if (explicitCandidateIds.length > 0) {
    values.push(explicitCandidateIds);
    discoveryClauses.push(`external_id = ANY($${values.length}::int[])`);
  }
  for (const service of requiredServices) {
    values.push(`%${service}%`);
    discoveryClauses.push(`services::text ILIKE $${values.length}`);
  }
  if (discoveryClauses.length) where.push(`(${discoveryClauses.join(" OR ")})`);

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

  const externalIds = [...new Set(result.rows.map((row) => Number(row.external_id)).filter((id) => Number.isFinite(id)))];
  const explicit = await getExplicitIntelligence(externalIds);

  return result.rows.map((row) => {
    const externalId = Number.isFinite(Number(row.external_id)) ? Number(row.external_id) : null;
    const taggedServices = Array.isArray(row.services) ? row.services.map(String) : [];
    const explicitAvailability = externalId == null ? [] : (explicit.availability.get(externalId) || []);
    const allServices = [...new Set([...taggedServices, ...explicitAvailability])];
    const pricingCount = externalId == null ? 0 : (explicit.pricingCounts.get(externalId) || 0);
    const coverage = coverageScore(allServices, requiredServices);
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
      services: allServices,
      explicitAvailability,
      lastAppointment: row.last_appointment,
      pricingAvailable: Boolean(row.pricing_available || pricingCount > 0),
      pricingCount,
      activity2026: row.activity_2026,
      sourceStatus: row.source_status,
      matchedServices: coverage.matched,
      missingServices: coverage.missing,
      coverageRatio: coverage.ratio,
      source: "existing_network" as const,
    };
  }).sort((a, b) => {
    if (b.coverageRatio !== a.coverageRatio) return b.coverageRatio - a.coverageRatio;
    if (a.networkStatus === "Active Agreement" && b.networkStatus !== "Active Agreement") return -1;
    if (b.networkStatus === "Active Agreement" && a.networkStatus !== "Active Agreement") return 1;
    return String(a.providerName).localeCompare(String(b.providerName));
  });
}

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
      external = externalSearch.results.map((hit) => ({
        ...hit,
        source: "outside_network",
        networkStatus: existingNames.has(normalizeName(hit.providerName)) ? "Existing / possible match" : "NEW — not in current network search",
      }));
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
