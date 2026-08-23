import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function clean(value: unknown, max = 300): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function splitList(value: unknown): string[] {
  return clean(value, 3000).split(/[|,;\n]+/).map((item) => item.trim()).filter(Boolean);
}

function asBoolFilter(value: string): boolean | null {
  if (value === "visible") return true;
  if (value === "hidden") return false;
  return null;
}

function providerFilters(query: Record<string, unknown>, alias = "p") {
  const values: unknown[] = [];
  const where: string[] = [];
  const name = clean(query.name, 240);

  const add = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };

  // Match the original Command Center behavior: an explicit clinic/network-name
  // search takes precedence over stale status/service/geography filters.
  if (name) {
    const p = add(`%${name}%`);
    where.push(`(${alias}.name ILIKE ${p} OR ${alias}.organization_name ILIKE ${p} OR ${alias}.site_name ILIKE ${p})`);
    return { values, where };
  }

  const details = clean(query.details, 300);
  if (details) {
    const p = add(`%${details}%`);
    where.push(`(
      ${alias}.name ILIKE ${p} OR ${alias}.organization_name ILIKE ${p} OR ${alias}.site_name ILIKE ${p}
      OR ${alias}.city ILIKE ${p} OR ${alias}.state_region ILIKE ${p} OR ${alias}.country ILIKE ${p}
      OR ${alias}.address1 ILIKE ${p} OR ${alias}.address2 ILIKE ${p} OR ${alias}.postal_code ILIKE ${p}
      OR ${alias}.phone ILIKE ${p} OR ${alias}.facility_type ILIKE ${p} OR ${alias}.services::text ILIKE ${p}
    )`);
  }

  const status = clean(query.status, 100);
  if (status && status !== "All Statuses") where.push(`${alias}.network_status = ${add(status)}`);

  const visibility = asBoolFilter(clean(query.visibility, 30));
  if (visibility !== null) where.push(`${alias}.visible = ${add(visibility)}`);
  if (clean(query.visibility, 30) === "unknown") where.push(`${alias}.visible IS NULL`);

  const activity = clean(query.activity, 80);
  if (activity === "new") where.push(`${alias}.activity_2026 ILIKE '%new%'`);
  else if (activity === "updated") where.push(`${alias}.activity_2026 ILIKE '%updated%'`);
  else if (activity === "any") where.push(`NULLIF(BTRIM(COALESCE(${alias}.activity_2026,'')), '') IS NOT NULL`);
  else if (activity === "none") where.push(`NULLIF(BTRIM(COALESCE(${alias}.activity_2026,'')), '') IS NULL`);

  const country = clean(query.country, 100);
  if (country && country !== "All Countries") where.push(`${alias}.country ILIKE ${add(country)}`);

  const state = clean(query.state, 100);
  if (state && state !== "All States / Regions") where.push(`${alias}.state_region ILIKE ${add(state)}`);

  const facility = clean(query.facility, 160);
  if (facility && facility !== "All Facility Types") where.push(`${alias}.facility_type ILIKE ${add(facility)}`);

  const services = splitList(query.services);
  if (services.length) {
    const mode = clean(query.serviceMode, 20).toLowerCase() === "all" ? "all" : "any";
    const clauses = services.map((service) => `${alias}.services::text ILIKE ${add(`%${service}%`)}`);
    where.push(`(${clauses.join(mode === "all" ? " AND " : " OR ")})`);
  }

  return { values, where };
}

function providerOrder(sort: string) {
  switch (sort) {
    case "city": return "city NULLS LAST, name";
    case "state": return "state_region NULLS LAST, city NULLS LAST, name";
    case "facility": return "facility_type NULLS LAST, name";
    case "lastAppointment": return "last_appointment DESC NULLS LAST, name";
    default: return "name";
  }
}

function mapProvider(row: any) {
  return {
    id: Number(row.id),
    externalId: row.external_id == null ? null : Number(row.external_id),
    name: row.name,
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
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    phone: row.phone,
    services: Array.isArray(row.services) ? row.services : [],
    lastAppointment: row.last_appointment,
    pricingAvailable: Boolean(row.pricing_available),
    activity2026: row.activity_2026,
    sourceStatus: row.source_status,
  };
}

router.get("/command-center/options", async (_req, res) => {
  try {
    if (!pool) throw new Error("Provider database is unavailable.");
    const [countries, states, facilities, services] = await Promise.all([
      pool.query(`SELECT country AS value, COUNT(*)::int AS count FROM network_provider_snapshot WHERE NULLIF(BTRIM(country),'') IS NOT NULL GROUP BY country ORDER BY count DESC, country LIMIT 300`),
      pool.query(`SELECT state_region AS value, COUNT(*)::int AS count FROM network_provider_snapshot WHERE NULLIF(BTRIM(state_region),'') IS NOT NULL GROUP BY state_region ORDER BY count DESC, state_region LIMIT 500`),
      pool.query(`SELECT facility_type AS value, COUNT(*)::int AS count FROM network_provider_snapshot WHERE NULLIF(BTRIM(facility_type),'') IS NOT NULL GROUP BY facility_type ORDER BY count DESC, facility_type LIMIT 300`),
      pool.query(`SELECT service AS value, COUNT(*)::int AS count FROM network_provider_snapshot CROSS JOIN LATERAL jsonb_array_elements_text(services) s(service) WHERE NULLIF(BTRIM(service),'') IS NOT NULL GROUP BY service ORDER BY count DESC, service LIMIT 80`),
    ]);
    res.json({ countries: countries.rows, states: states.rows, facilities: facilities.rows, services: services.rows });
  } catch (error) {
    logger.warn({ error }, "Command Center options failed");
    res.status(500).json({ error: "Could not load Command Center filters." });
  }
});

router.get("/command-center/directory", async (req, res) => {
  try {
    if (!pool) throw new Error("Provider database is unavailable.");
    const filters = providerFilters(req.query as Record<string, unknown>);
    const sort = providerOrder(clean(req.query.sort, 40));
    const limit = Math.max(1, Math.min(3000, Number(req.query.limit || 800)));
    const values = [...filters.values, limit];
    const whereSql = filters.where.length ? `WHERE ${filters.where.join(" AND ")}` : "";
    const [rows, totals] = await Promise.all([
      pool.query(`SELECT * FROM network_provider_snapshot p ${whereSql} ORDER BY ${sort} LIMIT $${values.length}`, values),
      pool.query(`SELECT COUNT(*)::int AS total, COUNT(DISTINCT NULLIF(city,''))::int AS cities, COUNT(DISTINCT NULLIF(country,''))::int AS countries, COUNT(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL)::int AS gps_ready, COUNT(*) FILTER (WHERE network_status='Active Agreement')::int AS active FROM network_provider_snapshot p ${whereSql}`, filters.values),
    ]);
    res.json({ results: rows.rows.map(mapProvider), snapshot: totals.rows[0] || {}, returned: rows.rowCount || 0 });
  } catch (error) {
    logger.warn({ error }, "Command Center directory failed");
    res.status(500).json({ error: "Could not load provider directory." });
  }
});

router.get("/command-center/map", async (req, res) => {
  try {
    if (!pool) throw new Error("Provider database is unavailable.");
    const filters = providerFilters(req.query as Record<string, unknown>);
    filters.where.push("p.latitude IS NOT NULL", "p.longitude IS NOT NULL");
    const limit = Math.max(1, Math.min(50000, Number(req.query.limit || 40000)));
    const values = [...filters.values, limit];
    const result = await pool.query(`
      SELECT id, external_id, name, organization_name, site_name, facility_type, network_status, country, state_region, city,
             address1, address2, postal_code, phone, latitude, longitude, services
      FROM network_provider_snapshot p
      WHERE ${filters.where.join(" AND ")}
      ORDER BY id
      LIMIT $${values.length}
    `, values);
    res.json({
      total: result.rowCount || 0,
      points: result.rows.map((row) => ({
        id: Number(row.id), externalId: row.external_id == null ? null : Number(row.external_id), name: row.name,
        organizationName: row.organization_name, facilityType: row.facility_type, networkStatus: row.network_status,
        country: row.country, stateRegion: row.state_region, city: row.city,
        address: [row.address1, row.address2].filter(Boolean).join(", "), postalCode: row.postal_code, phone: row.phone,
        latitude: Number(row.latitude), longitude: Number(row.longitude), services: Array.isArray(row.services) ? row.services : [],
      })),
    });
  } catch (error) {
    logger.warn({ error }, "Command Center map failed");
    res.status(500).json({ error: "Could not load provider map." });
  }
});

router.get("/command-center/coverage", async (req, res) => {
  try {
    if (!pool) throw new Error("Provider database is unavailable.");
    const filters = providerFilters(req.query as Record<string, unknown>);
    const geo = clean(req.query.geo, 20);
    const column = geo === "country" ? "country" : geo === "city" ? "city" : "state_region";
    filters.where.push(`NULLIF(BTRIM(COALESCE(p.${column},'')), '') IS NOT NULL`);
    const whereSql = `WHERE ${filters.where.join(" AND ")}`;
    const result = await pool.query(`
      SELECT p.${column} AS geography,
        COUNT(*)::int AS locations,
        COUNT(*) FILTER (WHERE p.network_status='Active Agreement')::int AS active,
        COUNT(*) FILTER (WHERE p.services::text ILIKE '%medical%' OR p.services::text ILIKE '%physical%')::int AS medical,
        COUNT(*) FILTER (WHERE p.services::text ILIKE '%drug%' OR p.services::text ILIKE '%alcohol%')::int AS drug_testing,
        COUNT(*) FILTER (WHERE p.services::text ILIKE '%lab%' OR p.services::text ILIKE '%blood%' OR p.services::text ILIKE '%cbc%')::int AS laboratory,
        COUNT(*) FILTER (WHERE p.services::text ILIKE '%dental%')::int AS dental,
        COUNT(*) FILTER (WHERE p.services::text ILIKE '%hearing%' OR p.services::text ILIKE '%audio%')::int AS hearing,
        COUNT(*) FILTER (WHERE p.services::text ILIKE '%imag%' OR p.services::text ILIKE '%x-ray%' OR p.services::text ILIKE '%xray%' OR p.services::text ILIKE '%mamm%')::int AS imaging,
        COUNT(*) FILTER (WHERE p.services::text ILIKE '%vacc%' OR p.services::text ILIKE '%immun%')::int AS vaccinations,
        COUNT(*) FILTER (WHERE p.services::text ILIKE '%fit test%' OR p.services::text ILIKE '%respirator%')::int AS fit_test
      FROM network_provider_snapshot p ${whereSql}
      GROUP BY p.${column}
      ORDER BY locations DESC, geography
      LIMIT 500
    `, filters.values);
    const totals = await pool.query(`SELECT COUNT(*)::int AS locations, COUNT(*) FILTER (WHERE network_status='Active Agreement')::int AS active, COUNT(*) FILTER (WHERE jsonb_array_length(services)>0)::int AS service_tagged, COUNT(DISTINCT ${column})::int AS geographies FROM network_provider_snapshot p ${whereSql}`, filters.values);
    res.json({ rows: result.rows, summary: totals.rows[0] || {} });
  } catch (error) {
    logger.warn({ error }, "Command Center coverage failed");
    res.status(500).json({ error: "Could not load service coverage." });
  }
});

router.get("/command-center/organizations", async (req, res) => {
  try {
    if (!pool) throw new Error("Provider database is unavailable.");
    const filters = providerFilters(req.query as Record<string, unknown>);
    const orgSearch = clean(req.query.orgSearch, 200);
    if (orgSearch) {
      filters.values.push(`%${orgSearch}%`);
      filters.where.push(`COALESCE(NULLIF(p.organization_name,''), p.name) ILIKE $${filters.values.length}`);
    }
    const whereSql = filters.where.length ? `WHERE ${filters.where.join(" AND ")}` : "";
    const result = await pool.query(`
      SELECT COALESCE(NULLIF(p.organization_name,''), p.name, 'Unknown') AS organization,
        COUNT(DISTINCT p.id)::int AS locations,
        COUNT(DISTINCT p.id) FILTER (WHERE p.network_status='Active Agreement')::int AS active,
        COUNT(DISTINCT NULLIF(p.country,''))::int AS countries,
        COUNT(DISTINCT NULLIF(p.state_region,''))::int AS states_regions,
        COUNT(DISTINCT NULLIF(p.city,''))::int AS cities,
        STRING_AGG(DISTINCT s.service, ' · ' ORDER BY s.service) FILTER (WHERE NULLIF(BTRIM(s.service),'') IS NOT NULL) AS documented_services
      FROM network_provider_snapshot p
      LEFT JOIN LATERAL jsonb_array_elements_text(p.services) s(service) ON TRUE
      ${whereSql}
      GROUP BY COALESCE(NULLIF(p.organization_name,''), p.name, 'Unknown')
      ORDER BY locations DESC, organization
      LIMIT 500
    `, filters.values);
    res.json({ rows: result.rows });
  } catch (error) {
    logger.warn({ error }, "Command Center organizations failed");
    res.status(500).json({ error: "Could not load organization rollup." });
  }
});

router.get("/command-center/pricing", async (req, res) => {
  try {
    if (!pool) throw new Error("Provider database is unavailable.");
    const values: unknown[] = [];
    const where: string[] = [];
    const add = (value: unknown) => { values.push(value); return `$${values.length}`; };
    const q = clean(req.query.q, 240);
    if (q) {
      const p = add(`%${q}%`);
      where.push(`(network_name ILIKE ${p} OR site_name ILIKE ${p} OR city ILIKE ${p} OR state_region ILIKE ${p} OR component_name ILIKE ${p})`);
    }
    const network = clean(req.query.network, 200); if (network) where.push(`network_name ILIKE ${add(network)}`);
    const state = clean(req.query.state, 100); if (state) where.push(`state_region ILIKE ${add(state)}`);
    const component = clean(req.query.component, 240); if (component) where.push(`component_name ILIKE ${add(component)}`);
    const valueMode = clean(req.query.valueMode, 30);
    if (valueMode === "numeric") where.push("numeric_price IS NOT NULL");
    if (valueMode === "text") where.push("numeric_price IS NULL AND NULLIF(BTRIM(COALESCE(source_price_text,'')), '') IS NOT NULL");
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(3000, Number(req.query.limit || 1000)));
    const rowValues = [...values, limit];
    const [rows, stats, networks, states, components] = await Promise.all([
      pool.query(`SELECT id, canonical_external_id, network_name, site_name, city, state_region, postal_code, country, component_name, numeric_price, source_price_text, effective_date, expiration_date, line_item_created FROM network_pricing_snapshot ${whereSql} ORDER BY network_name NULLS LAST, site_name NULLS LAST, component_name LIMIT $${rowValues.length}`, rowValues),
      pool.query(`SELECT COUNT(*)::int AS records, COUNT(DISTINCT canonical_external_id)::int AS clinics, COUNT(DISTINCT component_name)::int AS line_items, ROUND(AVG(numeric_price)::numeric,2) AS average_numeric_price FROM network_pricing_snapshot ${whereSql}`, values),
      pool.query(`SELECT DISTINCT network_name AS value FROM network_pricing_snapshot WHERE NULLIF(BTRIM(network_name),'') IS NOT NULL ORDER BY value LIMIT 600`),
      pool.query(`SELECT DISTINCT state_region AS value FROM network_pricing_snapshot WHERE NULLIF(BTRIM(state_region),'') IS NOT NULL ORDER BY value LIMIT 300`),
      pool.query(`SELECT component_name AS value, COUNT(*)::int AS count FROM network_pricing_snapshot GROUP BY component_name ORDER BY count DESC, value LIMIT 800`),
    ]);
    res.json({ rows: rows.rows, stats: stats.rows[0] || {}, options: { networks: networks.rows, states: states.rows, components: components.rows } });
  } catch (error) {
    logger.warn({ error }, "Command Center pricing failed");
    res.status(500).json({ error: "Could not load pricing records." });
  }
});

router.get("/command-center/availability", async (req, res) => {
  try {
    if (!pool) throw new Error("Provider database is unavailable.");
    const values: unknown[] = [];
    const where: string[] = [];
    const add = (value: unknown) => { values.push(value); return `$${values.length}`; };
    const q = clean(req.query.q, 240);
    if (q) {
      const p = add(`%${q}%`);
      where.push(`(network_name ILIKE ${p} OR site_name ILIKE ${p} OR city ILIKE ${p} OR state_region ILIKE ${p} OR component_name ILIKE ${p} OR component_type ILIKE ${p})`);
    }
    const network = clean(req.query.network, 200); if (network) where.push(`network_name ILIKE ${add(network)}`);
    const state = clean(req.query.state, 100); if (state) where.push(`state_region ILIKE ${add(state)}`);
    const type = clean(req.query.type, 160); if (type) where.push(`component_type ILIKE ${add(type)}`);
    const component = clean(req.query.component, 240); if (component) where.push(`component_name ILIKE ${add(component)}`);
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(3000, Number(req.query.limit || 1000)));
    const rowValues = [...values, limit];
    const [rows, stats, networks, states, types, components] = await Promise.all([
      pool.query(`SELECT id, canonical_external_id, network_name, site_name, city, state_region, postal_code, country, phone, component_name, component_type FROM network_availability_snapshot ${whereSql} ORDER BY component_name, network_name NULLS LAST, site_name NULLS LAST LIMIT $${rowValues.length}`, rowValues),
      pool.query(`SELECT COUNT(*)::int AS records, COUNT(DISTINCT canonical_external_id)::int AS clinics, COUNT(DISTINCT component_name)::int AS line_items, COUNT(DISTINCT component_type)::int AS component_types FROM network_availability_snapshot ${whereSql}`, values),
      pool.query(`SELECT DISTINCT network_name AS value FROM network_availability_snapshot WHERE NULLIF(BTRIM(network_name),'') IS NOT NULL ORDER BY value LIMIT 600`),
      pool.query(`SELECT DISTINCT state_region AS value FROM network_availability_snapshot WHERE NULLIF(BTRIM(state_region),'') IS NOT NULL ORDER BY value LIMIT 300`),
      pool.query(`SELECT component_type AS value, COUNT(*)::int AS count FROM network_availability_snapshot WHERE NULLIF(BTRIM(component_type),'') IS NOT NULL GROUP BY component_type ORDER BY count DESC, value LIMIT 200`),
      pool.query(`SELECT component_name AS value, COUNT(*)::int AS count FROM network_availability_snapshot GROUP BY component_name ORDER BY count DESC, value LIMIT 800`),
    ]);
    res.json({ rows: rows.rows, stats: stats.rows[0] || {}, options: { networks: networks.rows, states: states.rows, types: types.rows, components: components.rows } });
  } catch (error) {
    logger.warn({ error }, "Command Center availability failed");
    res.status(500).json({ error: "Could not load service availability." });
  }
});

router.get("/command-center/quality", async (_req, res) => {
  try {
    if (!pool) throw new Error("Provider database is unavailable.");
    const result = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE latitude IS NULL OR longitude IS NULL)::int AS missing_coordinates,
        COUNT(*) FILTER (WHERE NULLIF(BTRIM(COALESCE(address1,'')), '') IS NULL)::int AS missing_address,
        COUNT(*) FILTER (WHERE NULLIF(BTRIM(COALESCE(phone,'')), '') IS NULL)::int AS missing_phone,
        COUNT(*) FILTER (WHERE jsonb_array_length(services)=0)::int AS missing_services,
        COUNT(*) FILTER (WHERE visible IS FALSE)::int AS hidden,
        COUNT(*) FILTER (WHERE visible IS NULL)::int AS unknown_visibility,
        COUNT(*) FILTER (WHERE NULLIF(BTRIM(COALESCE(organization_name,'')), '') IS NULL)::int AS missing_organization,
        COUNT(*) FILTER (WHERE NULLIF(BTRIM(COALESCE(network_status,'')), '') IS NULL)::int AS missing_status
      FROM network_provider_snapshot
    `);
    const statuses = await pool.query(`SELECT COALESCE(NULLIF(network_status,''),'Unknown') AS label, COUNT(*)::int AS count FROM network_provider_snapshot GROUP BY label ORDER BY count DESC`);
    res.json({ summary: result.rows[0] || {}, statuses: statuses.rows });
  } catch (error) {
    logger.warn({ error }, "Command Center quality failed");
    res.status(500).json({ error: "Could not load data-quality analysis." });
  }
});

router.get("/command-center/source-audit", async (_req, res) => {
  try {
    if (!pool) throw new Error("Provider database is unavailable.");
    const [state, provider, pricing, availability] = await Promise.all([
      pool.query(`SELECT dataset_key, source_sha256, provider_count, pricing_count, availability_count, loaded_at FROM network_dataset_state ORDER BY loaded_at DESC LIMIT 10`),
      pool.query(`SELECT COUNT(*)::int AS count, MAX(imported_at) AS imported_at FROM network_provider_snapshot`),
      pool.query(`SELECT COUNT(*)::int AS count, MAX(imported_at) AS imported_at FROM network_pricing_snapshot`),
      pool.query(`SELECT COUNT(*)::int AS count, MAX(imported_at) AS imported_at FROM network_availability_snapshot`),
    ]);
    res.json({ datasetState: state.rows, live: { providers: provider.rows[0], pricing: pricing.rows[0], availability: availability.rows[0] } });
  } catch (error) {
    logger.warn({ error }, "Command Center source audit failed");
    res.status(500).json({ error: "Could not load source audit." });
  }
});

export default router;
