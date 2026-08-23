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
  const add = (value: unknown) => { values.push(value); return `$${values.length}`; };
  const name = clean(query.name, 240);

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

  const visibilityText = clean(query.visibility, 30);
  const visibility = asBoolFilter(visibilityText);
  if (visibility !== null) where.push(`${alias}.visible = ${add(visibility)}`);
  if (visibilityText === "unknown") where.push(`${alias}.visible IS NULL`);

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

router.get("/command-center-v2/pricing", async (req, res) => {
  try {
    if (!pool) throw new Error("Provider database is unavailable.");
    const filters = providerFilters(req.query as Record<string, unknown>, "p");
    const values = [...filters.values];
    const where = [...filters.where];
    const add = (value: unknown) => { values.push(value); return `$${values.length}`; };

    const q = clean(req.query.pq, 240);
    if (q) {
      const term = add(`%${q}%`);
      where.push(`(pr.network_name ILIKE ${term} OR pr.site_name ILIKE ${term} OR pr.city ILIKE ${term} OR pr.state_region ILIKE ${term} OR pr.country ILIKE ${term} OR pr.component_name ILIKE ${term})`);
    }
    const network = clean(req.query.pnet, 200); if (network) where.push(`pr.network_name ILIKE ${add(network)}`);
    const state = clean(req.query.pstate, 100); if (state) where.push(`pr.state_region ILIKE ${add(state)}`);
    const component = clean(req.query.pcomponent, 240); if (component) where.push(`pr.component_name ILIKE ${add(component)}`);
    const valueMode = clean(req.query.pvalue, 30);
    if (valueMode === "numeric") where.push("pr.numeric_price IS NOT NULL");
    if (valueMode === "text") where.push("pr.numeric_price IS NULL AND NULLIF(BTRIM(COALESCE(pr.source_price_text,'')), '') IS NOT NULL");

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(3000, Number(req.query.limit || 1200)));
    const rowValues = [...values, limit];

    const [rows, stats, networks, states, components] = await Promise.all([
      pool.query(`
        SELECT pr.id, pr.canonical_external_id, pr.network_name, pr.site_name, pr.city, pr.state_region, pr.postal_code, pr.country,
               pr.component_name, pr.numeric_price, pr.source_price_text, pr.effective_date, pr.expiration_date, pr.line_item_created
        FROM network_pricing_snapshot pr
        JOIN network_provider_snapshot p ON p.external_id = pr.canonical_external_id
        ${whereSql}
        ORDER BY pr.network_name NULLS LAST, pr.site_name NULLS LAST, pr.component_name
        LIMIT $${rowValues.length}
      `, rowValues),
      pool.query(`
        SELECT COUNT(*)::int AS records, COUNT(DISTINCT pr.canonical_external_id)::int AS clinics,
               COUNT(DISTINCT pr.component_name)::int AS line_items,
               ROUND(AVG(pr.numeric_price)::numeric,2) AS average_numeric_price
        FROM network_pricing_snapshot pr
        JOIN network_provider_snapshot p ON p.external_id = pr.canonical_external_id
        ${whereSql}
      `, values),
      pool.query(`SELECT DISTINCT network_name AS value FROM network_pricing_snapshot WHERE NULLIF(BTRIM(network_name),'') IS NOT NULL ORDER BY value LIMIT 600`),
      pool.query(`SELECT DISTINCT state_region AS value FROM network_pricing_snapshot WHERE NULLIF(BTRIM(state_region),'') IS NOT NULL ORDER BY value LIMIT 300`),
      pool.query(`SELECT component_name AS value, COUNT(*)::int AS count FROM network_pricing_snapshot GROUP BY component_name ORDER BY count DESC, value LIMIT 800`),
    ]);

    res.json({ rows: rows.rows, stats: stats.rows[0] || {}, options: { networks: networks.rows, states: states.rows, components: components.rows } });
  } catch (error) {
    logger.warn({ error }, "Command Center v2 pricing failed");
    res.status(500).json({ error: "Could not load filtered pricing records." });
  }
});

router.get("/command-center-v2/availability", async (req, res) => {
  try {
    if (!pool) throw new Error("Provider database is unavailable.");
    const filters = providerFilters(req.query as Record<string, unknown>, "p");
    const values = [...filters.values];
    const where = [...filters.where];
    const add = (value: unknown) => { values.push(value); return `$${values.length}`; };

    const q = clean(req.query.aq, 240);
    if (q) {
      const term = add(`%${q}%`);
      where.push(`(av.network_name ILIKE ${term} OR av.site_name ILIKE ${term} OR av.city ILIKE ${term} OR av.state_region ILIKE ${term} OR av.country ILIKE ${term} OR av.component_name ILIKE ${term} OR av.component_type ILIKE ${term})`);
    }
    const network = clean(req.query.anet, 200); if (network) where.push(`av.network_name ILIKE ${add(network)}`);
    const state = clean(req.query.astate, 100); if (state) where.push(`av.state_region ILIKE ${add(state)}`);
    const type = clean(req.query.atype, 160); if (type) where.push(`av.component_type ILIKE ${add(type)}`);
    const component = clean(req.query.acomponent, 240); if (component) where.push(`av.component_name ILIKE ${add(component)}`);

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(3000, Number(req.query.limit || 1200)));
    const rowValues = [...values, limit];

    const [rows, stats, networks, states, types, components] = await Promise.all([
      pool.query(`
        SELECT av.id, av.canonical_external_id, av.network_name, av.site_name, av.city, av.state_region, av.postal_code, av.country,
               av.phone, av.component_name, av.component_type
        FROM network_availability_snapshot av
        JOIN network_provider_snapshot p ON p.external_id = av.canonical_external_id
        ${whereSql}
        ORDER BY av.component_name, av.network_name NULLS LAST, av.site_name NULLS LAST
        LIMIT $${rowValues.length}
      `, rowValues),
      pool.query(`
        SELECT COUNT(*)::int AS records, COUNT(DISTINCT av.canonical_external_id)::int AS clinics,
               COUNT(DISTINCT av.component_name)::int AS line_items, COUNT(DISTINCT av.component_type)::int AS component_types
        FROM network_availability_snapshot av
        JOIN network_provider_snapshot p ON p.external_id = av.canonical_external_id
        ${whereSql}
      `, values),
      pool.query(`SELECT DISTINCT network_name AS value FROM network_availability_snapshot WHERE NULLIF(BTRIM(network_name),'') IS NOT NULL ORDER BY value LIMIT 600`),
      pool.query(`SELECT DISTINCT state_region AS value FROM network_availability_snapshot WHERE NULLIF(BTRIM(state_region),'') IS NOT NULL ORDER BY value LIMIT 300`),
      pool.query(`SELECT component_type AS value, COUNT(*)::int AS count FROM network_availability_snapshot WHERE NULLIF(BTRIM(component_type),'') IS NOT NULL GROUP BY component_type ORDER BY count DESC, value LIMIT 200`),
      pool.query(`SELECT component_name AS value, COUNT(*)::int AS count FROM network_availability_snapshot GROUP BY component_name ORDER BY count DESC, value LIMIT 800`),
    ]);

    res.json({ rows: rows.rows, stats: stats.rows[0] || {}, options: { networks: networks.rows, states: states.rows, types: types.rows, components: components.rows } });
  } catch (error) {
    logger.warn({ error }, "Command Center v2 availability failed");
    res.status(500).json({ error: "Could not load filtered service availability." });
  }
});

router.get("/command-center-v2/insights", async (req, res) => {
  try {
    if (!pool) throw new Error("Provider database is unavailable.");
    const filters = providerFilters(req.query as Record<string, unknown>, "p");
    const whereSql = filters.where.length ? `WHERE ${filters.where.join(" AND ")}` : "";
    const usWhereSql = filters.where.length
      ? `WHERE (${filters.where.join(" AND ")}) AND p.country ILIKE 'United States'`
      : `WHERE p.country ILIKE 'United States'`;

    const [summary, states, services, organizations, pricingByState] = await Promise.all([
      pool.query(`
        WITH fp AS (SELECT * FROM network_provider_snapshot p ${whereSql}),
        price AS (
          SELECT COUNT(*)::int AS records, COUNT(DISTINCT pr.canonical_external_id)::int AS clinics,
                 ROUND(AVG(pr.numeric_price)::numeric,2) AS average_price,
                 ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pr.numeric_price)::numeric,2) AS median_price
          FROM network_pricing_snapshot pr
          JOIN fp ON fp.external_id = pr.canonical_external_id
          WHERE pr.numeric_price IS NOT NULL
        ),
        availability AS (
          SELECT COUNT(*)::int AS records, COUNT(DISTINCT av.canonical_external_id)::int AS clinics
          FROM network_availability_snapshot av
          JOIN fp ON fp.external_id = av.canonical_external_id
        )
        SELECT COUNT(*)::int AS locations,
               COUNT(*) FILTER (WHERE network_status='Active Agreement')::int AS active,
               COUNT(*) FILTER (WHERE jsonb_array_length(services)>0)::int AS service_tagged,
               COUNT(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL)::int AS gps_ready,
               COUNT(DISTINCT NULLIF(country,''))::int AS countries,
               COUNT(DISTINCT NULLIF(state_region,''))::int AS states_regions,
               COUNT(DISTINCT NULLIF(city,''))::int AS cities,
               COALESCE((SELECT records FROM price),0)::int AS pricing_records,
               COALESCE((SELECT clinics FROM price),0)::int AS priced_clinics,
               (SELECT average_price FROM price) AS average_price,
               (SELECT median_price FROM price) AS median_price,
               COALESCE((SELECT records FROM availability),0)::int AS availability_records,
               COALESCE((SELECT clinics FROM availability),0)::int AS availability_clinics
        FROM fp
      `, filters.values),
      pool.query(`
        WITH fp AS (SELECT * FROM network_provider_snapshot p ${usWhereSql})
        SELECT state_region AS state,
               COUNT(*)::int AS locations,
               COUNT(*) FILTER (WHERE network_status='Active Agreement')::int AS active,
               COUNT(*) FILTER (WHERE jsonb_array_length(services)>0)::int AS service_tagged,
               COUNT(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL)::int AS gps_ready,
               COUNT(DISTINCT NULLIF(city,''))::int AS cities
        FROM fp
        WHERE NULLIF(BTRIM(COALESCE(state_region,'')), '') IS NOT NULL
        GROUP BY state_region
        ORDER BY locations DESC, state_region
      `, filters.values),
      pool.query(`
        WITH fp AS (SELECT * FROM network_provider_snapshot p ${whereSql})
        SELECT service, COUNT(DISTINCT fp.id)::int AS locations
        FROM fp CROSS JOIN LATERAL jsonb_array_elements_text(fp.services) s(service)
        WHERE NULLIF(BTRIM(service),'') IS NOT NULL
        GROUP BY service ORDER BY locations DESC, service LIMIT 20
      `, filters.values),
      pool.query(`
        WITH fp AS (SELECT * FROM network_provider_snapshot p ${whereSql})
        SELECT COALESCE(NULLIF(organization_name,''), name, 'Unknown') AS organization,
               COUNT(*)::int AS locations,
               COUNT(*) FILTER (WHERE network_status='Active Agreement')::int AS active,
               COUNT(DISTINCT NULLIF(country,''))::int AS countries
        FROM fp
        GROUP BY COALESCE(NULLIF(organization_name,''), name, 'Unknown')
        ORDER BY locations DESC, organization LIMIT 15
      `, filters.values),
      pool.query(`
        WITH fp AS (SELECT * FROM network_provider_snapshot p ${usWhereSql})
        SELECT fp.state_region AS state,
               COUNT(pr.id)::int AS pricing_records,
               COUNT(DISTINCT pr.canonical_external_id)::int AS priced_clinics,
               ROUND(AVG(pr.numeric_price)::numeric,2) AS average_price,
               ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pr.numeric_price)::numeric,2) AS median_price
        FROM fp
        JOIN network_pricing_snapshot pr ON pr.canonical_external_id = fp.external_id
        WHERE pr.numeric_price IS NOT NULL AND NULLIF(BTRIM(COALESCE(fp.state_region,'')), '') IS NOT NULL
        GROUP BY fp.state_region
        ORDER BY pricing_records DESC, fp.state_region
      `, filters.values),
    ]);

    res.json({
      summary: summary.rows[0] || {},
      states: states.rows,
      services: services.rows,
      organizations: organizations.rows,
      pricingByState: pricingByState.rows,
    });
  } catch (error) {
    logger.warn({ error }, "Command Center v2 insights failed");
    res.status(500).json({ error: "Could not build provider and pricing insights." });
  }
});

export default router;
