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
import { runApiProviderSearch } from "../services/apiProviderSearch";

const router: IRouter = Router();

const MAX_PAGE_SIZE = 50;
const MAX_QUERY_LEN = 120;
const MAX_CITY_LEN = 80;

function hasDb(): boolean {
  return db != null;
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

function sanitizeLikeFragment(input: string, maxLen: number): string {
  // Strip LIKE wildcards the user might inject; we add our own %
  return input
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[%_\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

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
    exactPrice: typeof hit.exactPrice === "number" && Number.isFinite(hit.exactPrice) ? hit.exactPrice : 0,
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
    confidenceScore:
      typeof hit.confidenceScore === "number" && Number.isFinite(hit.confidenceScore)
        ? Math.min(Math.max(hit.confidenceScore, 0), 1)
        : 0.5,
  };
}

function mergeProviderHits(primary: ProviderHit[], supplemental: ProviderHit[]): ProviderHit[] {
  const merged = new Map<string, ProviderHit>();
  for (const hit of [...primary, ...supplemental]) {
    const locationKey = `${(hit.city || "").toLowerCase()}|${(hit.country || "").toLowerCase()}`;
    const url = (hit.website || hit.sourceUrl || "").replace(/\/$/, "").toLowerCase();
    const name = String(hit.providerName || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const key = url ? `url:${url}` : `name:${name}|${locationKey}`;
    if (!key || key === "name:|") continue;

    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, hit);
      continue;
    }

    // Keep the primary API hit, but backfill structured map/contact fields
    // from OSM/Wikidata when available.
    merged.set(key, {
      ...existing,
      latitude: existing.latitude ?? hit.latitude,
      longitude: existing.longitude ?? hit.longitude,
      phone: existing.phone ?? hit.phone,
      postalCode: existing.postalCode ?? hit.postalCode,
      stateRegion: existing.stateRegion ?? hit.stateRegion,
      city: existing.city ?? hit.city,
      website: existing.website ?? hit.website,
    });
  }
  return Array.from(merged.values());
}

router.post("/search", async (req, res): Promise<void> => {
  try {
    const parsed = SearchPricesBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      return;
    }

    const {
      query: rawQuery,
      state: rawState,
      city: rawCity,
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

    const query = sanitizeLikeFragment(String(rawQuery || ""), MAX_QUERY_LEN);
    const city = sanitizeLikeFragment(String(rawCity || ""), MAX_CITY_LEN) || undefined;
    const state = sanitizeLikeFragment(String(rawState || ""), 40) || undefined;
    const country = normalizeCountry(parsed.data.country);

    if (isUsCountry(country) || isUsCountry(parsed.data.country || undefined)) {
      res.status(400).json({
        error: "United States searches are not supported on this portal. Use a non-US country or city.",
        blockedUs: true,
      });
      return;
    }

    if (!country && !city) {
      res.status(400).json({
        error: "Provide a non-US country and/or city to search for providers.",
      });
      return;
    }

    let resolvedType = providerType ? String(providerType).slice(0, 40) : undefined;
    if (!resolvedType) {
      if (hospitalOnly) resolvedType = "hospital";
      else if (clinicOnly) resolvedType = "clinic";
      else if (imagingOnly) resolvedType = "imaging_center";
      else if (labOnly) resolvedType = "lab";
      else if (urgentCareOnly) resolvedType = "urgent_care";
      else if (dentalOnly) resolvedType = "dental";
    }

    const pageNum = clampInt(page, 1, 100, 1);
    const pageSz = clampInt(pageSize, 1, MAX_PAGE_SIZE, 25);

    const discoveryParams = {
      query: query || resolvedType || "clinic",
      country,
      city,
      state,
      providerType: resolvedType,
      radiusMiles: typeof radiusMiles === "number" ? radiusMiles : 25,
    };

    // Keenable + TinyFish are the primary discovery layer. Existing OSM/
    // Wikidata/SearXNG remain supplemental for map coordinates and coverage.
    // Exa is invoked only inside runApiProviderSearch when primary coverage is low.
    const [apiSearch, multi] = await Promise.all([
      runApiProviderSearch(discoveryParams),
      runMultiModeSearch(discoveryParams),
    ]);

    if (multi.blockedUs) {
      res.status(400).json({
        error: multi.error || "United States searches are not supported on this portal.",
        blockedUs: true,
      });
      return;
    }

    const liveDiscovery = mergeProviderHits(apiSearch.results, multi.results);

    if (multi.error && liveDiscovery.length === 0) {
      res.status(400).json({ error: multi.error });
      return;
    }

    let dbFormatted: any[] = [];
    let searchId: number | null = null;

    if (hasDb() && query) {
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
          .filter((r) => r && !isUsCountry(r.country))
          .map((r) => ({
            ...r,
            timestampFound: r.timestampFound?.toISOString?.() ?? new Date().toISOString(),
          }));

        try {
          const histQuery = `${query} | ${country || ""} | ${city || ""}`.slice(0, 200);
          const [searchRecord] = await db
            .insert(searchHistoryTable)
            .values({
              query: histQuery,
              resultCount: liveDiscovery.length + dbFormatted.length,
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

    const live = liveDiscovery.map((h, i) => toApiResult(h, i));
    const seen = new Set(
      live.map(
        (r) =>
          `${(r.website || r.sourceUrl || "").toLowerCase()}|${String(r.providerName || "").toLowerCase()}`,
      ),
    );
    for (const row of dbFormatted) {
      const key = `${(row.website || row.sourceUrl || "").toLowerCase()}|${String(row.providerName || "").toLowerCase()}`;
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
        keenable: apiSearch.sources.keenable,
        tinyfish: apiSearch.sources.tinyfish,
        exaFallback: apiSearch.sources.exa,
        exaFallbackUsed: apiSearch.fallbackUsed,
        openstreetmap: multi.sources.osm,
        wikidata: multi.sources.wikidata,
        searxng: multi.sources.searxng,
        database: dbFormatted.length,
      },
      mode: "provider_discovery",
    });
  } catch (err: unknown) {
    logger.error({ err }, "Search endpoint error");
    res.status(500).json({
      error: "Internal server error",
      message: "Something went wrong while searching. Please try again.",
    });
  }
});

router.get("/search/suggestions", async (req, res): Promise<void> => {
  try {
    const parsed = GetSearchSuggestionsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query" });
      return;
    }

    const q = sanitizeLikeFragment(String(parsed.data.q || ""), 80).toLowerCase();
    if (!q) {
      res.json([]);
      return;
    }

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
      const pattern = `%${q}%`;
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
        ...services
          .filter((s) => s.normalizedService)
          .map((s) => ({
            text: String(s.normalizedService).slice(0, 120),
            billingCode: s.billingCode ? String(s.billingCode).slice(0, 20) : undefined,
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
    const limit = clampInt(parsed.success ? parsed.data.limit : 20, 1, 50, 20);
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
        query: String(h.query || "").slice(0, 200),
        resultCount: h.resultCount,
        searchedAt: h.searchedAt?.toISOString?.() ?? new Date().toISOString(),
      })),
    );
  } catch (err) {
    logger.warn({ err }, "History failed");
    res.json([]);
  }
});

export default router;
