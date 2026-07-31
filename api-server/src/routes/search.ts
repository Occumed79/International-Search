import { Router, type IRouter } from "express";
import { db, providersTable, pricesTable, searchHistoryTable } from "@workspace/db";
import { eq, ilike, or, and, sql, desc } from "drizzle-orm";
import {
  SearchPricesBody,
  GetSearchSuggestionsQueryParams,
  GetSearchHistoryQueryParams,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import {
  runMultiModeSearch,
  isUsCountry,
  normalizeCountry,
  type ProviderHit,
} from "../services/multiModeSearch";

const router: IRouter = Router();

function hasDb(): boolean {
  return db != null;
}

/** Map live provider hits into the API result shape (price fields optional / zero). */
function toApiResult(hit: ProviderHit, idx: number) {
  return {
    id: hit.id,
    providerId: idx + 1,
    providerName: hit.providerName,
    organizationName: hit.organizationName,
    providerType: hit.providerType,
    specialty: hit.specialty,
    serviceQuery: hit.serviceQuery,
    normalizedService: hit.normalizedService,
    billingCode: hit.billingCode,
    exactPrice: hit.exactPrice ?? 0,
    currency: hit.currency || "",
    priceType: hit.priceType || "fee_schedule",
    evidenceText: hit.evidenceText,
    sourceUrl: hit.sourceUrl,
    sourceType: hit.sourceType,
    country: hit.country,
    stateRegion: hit.stateRegion,
    city: hit.city,
    postalCode: hit.postalCode,
    latitude: hit.latitude,
    longitude: hit.longitude,
    phone: hit.phone,
    website: hit.website,
    timestampFound: hit.timestampFound,
    verificationStatus: hit.verificationStatus,
    confidenceScore: hit.confidenceScore,
  };
}

router.post("/search", async (req, res): Promise<void> => {
  try {
    const parsed = SearchPricesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const {
      query,
      state,
      city,
      providerType,
      radiusMiles,
      page,
      pageSize,
      hospitalOnly,
      clinicOnly,
      imagingOnly,
      labOnly,
      urgentCareOnly,
      dentalOnly,
    } = parsed.data;

    const country = normalizeCountry(parsed.data.country);

    // ── Hard US exclusion ────────────────────────────────────────────────────
    if (isUsCountry(country)) {
      res.status(400).json({
        error: "United States searches are not supported on this portal. Use a non-US country or city.",
        blockedUs: true,
      });
      return;
    }

    // Infer provider type from filter flags if not explicit
    let resolvedType = providerType || undefined;
    if (!resolvedType) {
      if (hospitalOnly) resolvedType = "hospital";
      else if (clinicOnly) resolvedType = "clinic";
      else if (imagingOnly) resolvedType = "imaging_center";
      else if (labOnly) resolvedType = "lab";
      else if (urgentCareOnly) resolvedType = "urgent_care";
      else if (dentalOnly) resolvedType = "dental";
    }

    const pageNum = page ?? 1;
    const pageSz = pageSize ?? 25;

    // ── Tier 1 multi-mode (OSM + Wikidata + SearXNG) ─────────────────────────
    const multi = await runMultiModeSearch({
      query: query || resolvedType || "clinic",
      country,
      city: city ?? undefined,
      state: state ?? undefined,
      providerType: resolvedType,
      radiusMiles: radiusMiles ?? 25,
    });

    // ── DB cache (non-US only) ───────────────────────────────────────────────
    let dbFormatted: any[] = [];
    let searchId: number | null = null;

    if (hasDb()) {
      try {
        const conditions = [];
        const searchPattern = `%${query}%`;
        conditions.push(
          or(
            ilike(pricesTable.serviceQuery, searchPattern),
            ilike(pricesTable.normalizedService, searchPattern),
            ilike(providersTable.name, searchPattern),
            ilike(providersTable.specialty, searchPattern),
          ),
        );
        // Exclude US from DB results
        conditions.push(sql`UPPER(${providersTable.country}) NOT IN ('US', 'USA', 'UNITED STATES')`);
        if (country) conditions.push(eq(providersTable.country, country));
        if (state) conditions.push(eq(providersTable.stateRegion, state));
        if (city) conditions.push(ilike(providersTable.city, `%${city}%`));

        const whereClause = and(...conditions);

        const dbResults = await db
          .select({
            id: pricesTable.id,
            providerId: providersTable.id,
            providerName: providersTable.name,
            organizationName: providersTable.organizationName,
            providerType: providersTable.providerType,
            specialty: providersTable.specialty,
            serviceQuery: pricesTable.serviceQuery,
            normalizedService: pricesTable.normalizedService,
            billingCode: pricesTable.billingCode,
            exactPrice: pricesTable.exactPrice,
            currency: pricesTable.currency,
            priceType: pricesTable.priceType,
            evidenceText: pricesTable.evidenceText,
            sourceUrl: pricesTable.sourceUrl,
            sourceType: pricesTable.sourceType,
            country: providersTable.country,
            stateRegion: providersTable.stateRegion,
            city: providersTable.city,
            postalCode: providersTable.postalCode,
            latitude: providersTable.latitude,
            longitude: providersTable.longitude,
            phone: providersTable.phone,
            website: providersTable.website,
            timestampFound: pricesTable.timestampFound,
            verificationStatus: pricesTable.verificationStatus,
            confidenceScore: pricesTable.confidenceScore,
          })
          .from(pricesTable)
          .innerJoin(providersTable, eq(pricesTable.providerId, providersTable.id))
          .where(whereClause)
          .orderBy(desc(pricesTable.confidenceScore))
          .limit(pageSz);

        dbFormatted = (dbResults as any[])
          .filter((r) => !isUsCountry(r.country))
          .map((r) => ({
            ...r,
            timestampFound: r.timestampFound?.toISOString?.() ?? new Date().toISOString(),
          }));

        try {
          const [searchRecord] = await db
            .insert(searchHistoryTable)
            .values({
              query: `${query} | ${country || ""} | ${city || ""}`,
              resultCount: multi.results.length + dbFormatted.length,
            })
            .returning();
          searchId = searchRecord?.id ?? null;
        } catch (histErr) {
          logger.warn({ histErr }, "search history write failed");
        }
      } catch (dbErr) {
        logger.warn({ dbErr }, "DB cache query failed — continuing with live modes");
      }
    }

    // Prefer multi-mode provider hits; append DB rows not already represented
    const live = multi.results.map((h, i) => toApiResult(h, i));
    const seen = new Set(
      live.map((r) => `${(r.website || r.sourceUrl || "").toLowerCase()}|${r.providerName.toLowerCase()}`),
    );
    for (const row of dbFormatted) {
      const key = `${(row.website || row.sourceUrl || "").toLowerCase()}|${String(row.providerName).toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      live.push(row);
    }

    const start = (pageNum - 1) * pageSz;
    const pageResults = live.slice(start, start + pageSz);

    res.json({
      results: pageResults,
      nopriceProviders: pageResults
        .filter((r) => !r.exactPrice || r.exactPrice === 0)
        .slice(0, 50)
        .map((r) => ({
          providerId: r.providerId,
          providerName: r.providerName,
          providerType: r.providerType,
          city: r.city,
          stateRegion: r.stateRegion,
          country: r.country,
          reason: "Provider directory result — pricing not required",
          website: r.website,
          phone: r.phone,
          sourceType: r.sourceType,
        })),
      total: live.length,
      page: pageNum,
      pageSize: pageSz,
      queryNormalized: (query || resolvedType || "").toLowerCase().trim(),
      searchId,
      sources: {
        openstreetmap: multi.sources.osm,
        wikidata: multi.sources.wikidata,
        searxng: multi.sources.searxng,
        database: dbFormatted.length,
      },
      mode: "provider_discovery",
    });
  } catch (err: unknown) {
    logger.error({ err }, "Search endpoint error");
    const message = err instanceof Error ? err.message : "Search failed";
    res.status(500).json({ error: "Internal server error", message });
  }
});

router.get("/search/suggestions", async (req, res): Promise<void> => {
  try {
    const parsed = GetSearchSuggestionsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    // Static provider-type suggestions (non-US portal)
    const q = parsed.data.q.toLowerCase();
    const types = [
      { text: "Occupational Health", category: "provider_type" },
      { text: "Clinic", category: "provider_type" },
      { text: "Hospital", category: "provider_type" },
      { text: "Urgent Care", category: "provider_type" },
      { text: "Imaging Center", category: "provider_type" },
      { text: "Laboratory", category: "provider_type" },
      { text: "Dental", category: "provider_type" },
      { text: "Pharmacy", category: "provider_type" },
    ].filter((t) => t.text.toLowerCase().includes(q));

    if (!hasDb()) {
      res.json(types);
      return;
    }

    try {
      const pattern = `%${parsed.data.q}%`;
      const services = await db
        .selectDistinct({
          normalizedService: pricesTable.normalizedService,
          billingCode: pricesTable.billingCode,
        })
        .from(pricesTable)
        .where(
          or(
            ilike(pricesTable.normalizedService, pattern),
            ilike(pricesTable.serviceQuery, pattern),
          ),
        )
        .limit(8);

      res.json([
        ...types,
        ...services.map((s) => ({
          text: s.normalizedService,
          billingCode: s.billingCode,
          category: "service",
        })),
      ]);
    } catch {
      res.json(types);
    }
  } catch (err) {
    logger.warn({ err }, "Suggestions failed");
    res.json([]);
  }
});

router.get("/search/history", async (req, res): Promise<void> => {
  try {
    const parsed = GetSearchHistoryQueryParams.safeParse(req.query);
    const limit = parsed.success ? (parsed.data.limit ?? 20) : 20;
    if (!hasDb()) {
      res.json([]);
      return;
    }
    const history = await db
      .select()
      .from(searchHistoryTable)
      .orderBy(desc(searchHistoryTable.searchedAt))
      .limit(limit);

    res.json(
      history.map((h) => ({
        id: h.id,
        query: h.query,
        resultCount: h.resultCount,
        searchedAt: h.searchedAt.toISOString(),
      })),
    );
  } catch (err) {
    logger.warn({ err }, "History failed");
    res.json([]);
  }
});

export default router;
