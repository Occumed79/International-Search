import { Router, type IRouter } from "express";
import { db, providersTable, pricesTable, searchHistoryTable } from "@workspace/db";
import { eq, ilike, or, and, sql, desc } from "drizzle-orm";
import {
  SearchPricesBody,
  GetSearchSuggestionsQueryParams,
  GetSearchHistoryQueryParams,
} from "@workspace/api-zod";
import { runInternationalSearch } from "../services/searchPipeline";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/search", async (req, res): Promise<void> => {
  const parsed = SearchPricesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const {
    query, country, state, city, providerType,
    cashPayOnly, hospitalOnly, clinicOnly, imagingOnly,
    labOnly, urgentCareOnly, dentalOnly, telehealthOnly,
    page, pageSize,
  } = parsed.data;

  // Kick off the live search pipeline asynchronously
  setImmediate(() => {
    runInternationalSearch({
      query,
      country: country ?? "",
      city,
      cashPayOnly,
      hospitalOnly,
      clinicOnly,
      imagingOnly,
      labOnly,
      urgentCareOnly,
      dentalOnly,
      telehealthOnly,
    }).catch((err: unknown) => logger.error({ err }, "International search pipeline error"));
  });

  // Query existing DB results immediately (pipeline fills in more over time)
  const conditions = [];
  const searchPattern = `%${query}%`;

  conditions.push(
    or(
      ilike(pricesTable.serviceQuery, searchPattern),
      ilike(pricesTable.normalizedService, searchPattern),
      ilike(pricesTable.billingCode, searchPattern),
      ilike(providersTable.name, searchPattern),
      ilike(providersTable.specialty, searchPattern)
    )
  );

  if (country) conditions.push(eq(providersTable.country, country));
  if (state) conditions.push(eq(providersTable.stateRegion, state));
  if (city) conditions.push(ilike(providersTable.city, `%${city}%`));

  if (providerType) conditions.push(eq(providersTable.providerType, providerType));
  if (hospitalOnly)  conditions.push(eq(providersTable.providerType, "hospital"));
  if (clinicOnly)    conditions.push(eq(providersTable.providerType, "clinic"));
  if (imagingOnly)   conditions.push(eq(providersTable.providerType, "imaging_center"));
  if (labOnly)       conditions.push(eq(providersTable.providerType, "lab"));
  if (urgentCareOnly)conditions.push(eq(providersTable.providerType, "urgent_care"));
  if (dentalOnly)    conditions.push(eq(providersTable.providerType, "dental"));
  if (telehealthOnly)conditions.push(eq(providersTable.providerType, "telehealth"));

  if (cashPayOnly) {
    conditions.push(
      or(
        eq(pricesTable.priceType, "self_pay"),
        eq(pricesTable.priceType, "cash_pay"),
        eq(pricesTable.priceType, "discounted_cash")
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const offsetVal = ((page ?? 1) - 1) * (pageSize ?? 25);

  const results = await db
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
    .limit(pageSize ?? 25)
    .offset(offsetVal);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pricesTable)
    .innerJoin(providersTable, eq(pricesTable.providerId, providersTable.id))
    .where(whereClause);

  const total = countResult?.count ?? 0;

  const formattedResults = results.map((r) => ({
    ...r,
    timestampFound: r.timestampFound.toISOString(),
  }));

  const [searchRecord] = await db
    .insert(searchHistoryTable)
    .values({ query, resultCount: total })
    .returning();

  res.json({
    results: formattedResults,
    nopriceProviders: [],  // populated once no-price tracking is fully wired
    total,
    page: page ?? 1,
    pageSize: pageSize ?? 25,
    queryNormalized: query.toLowerCase().trim(),
    searchId: searchRecord.id,
  });
});

router.get("/search/suggestions", async (req, res): Promise<void> => {
  const parsed = GetSearchSuggestionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { q } = parsed.data;
  const pattern = `%${q}%`;

  const services = await db
    .selectDistinct({ normalizedService: pricesTable.normalizedService, billingCode: pricesTable.billingCode })
    .from(pricesTable)
    .where(
      or(
        ilike(pricesTable.normalizedService, pattern),
        ilike(pricesTable.serviceQuery, pattern),
        ilike(pricesTable.billingCode, pattern)
      )
    )
    .limit(10);

  const suggestions = services.map((s) => ({
    text: s.normalizedService,
    billingCode: s.billingCode,
    category: "service",
  }));

  res.json(suggestions);
});

router.get("/search/history", async (req, res): Promise<void> => {
  const parsed = GetSearchHistoryQueryParams.safeParse(req.query);
  const limit = parsed.success ? (parsed.data.limit ?? 20) : 20;

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
    }))
  );
});

export default router;
