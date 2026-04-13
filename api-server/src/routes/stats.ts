import { Router, type IRouter } from "express";
import { db, providersTable, pricesTable, searchHistoryTable, crawlLogsTable } from "@workspace/db";
import { sql, desc, eq } from "drizzle-orm";
import { GetTopServicesQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/stats/summary", async (_req, res): Promise<void> => {
  const [providerCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(providersTable);

  const [priceCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pricesTable);

  const [sourceCount] = await db
    .select({ count: sql<number>`count(distinct ${pricesTable.sourceType})::int` })
    .from(pricesTable);

  const [countryCount] = await db
    .select({ count: sql<number>`count(distinct ${providersTable.country})::int` })
    .from(providersTable);

  const [stateCount] = await db
    .select({ count: sql<number>`count(distinct ${providersTable.stateRegion})::int` })
    .from(providersTable);

  const [avgConf] = await db
    .select({ avg: sql<number>`coalesce(avg(${pricesTable.confidenceScore}), 0)::float` })
    .from(pricesTable);

  const [searchCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(searchHistoryTable);

  res.json({
    totalProviders: providerCount?.count ?? 0,
    totalPrices: priceCount?.count ?? 0,
    totalSources: sourceCount?.count ?? 0,
    countriesCovered: countryCount?.count ?? 0,
    statesCovered: stateCount?.count ?? 0,
    avgConfidenceScore: Math.round((avgConf?.avg ?? 0) * 100) / 100,
    recentSearchCount: searchCount?.count ?? 0,
  });
});

router.get("/stats/top-services", async (req, res): Promise<void> => {
  const parsed = GetTopServicesQueryParams.safeParse(req.query);
  const limit = parsed.success ? (parsed.data.limit ?? 10) : 10;

  const topServices = await db
    .select({
      service: pricesTable.normalizedService,
      searchCount: sql<number>`count(*)::int`,
      avgPrice: sql<number>`round(avg(${pricesTable.exactPrice})::numeric, 2)::float`,
    })
    .from(pricesTable)
    .groupBy(pricesTable.normalizedService)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);

  res.json(topServices);
});

router.get("/stats/source-breakdown", async (_req, res): Promise<void> => {
  const [totalResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pricesTable);

  const total = totalResult?.count ?? 1;

  const breakdown = await db
    .select({
      sourceType: pricesTable.sourceType,
      count: sql<number>`count(*)::int`,
    })
    .from(pricesTable)
    .groupBy(pricesTable.sourceType)
    .orderBy(desc(sql`count(*)`));

  res.json(
    breakdown.map((b) => ({
      sourceType: b.sourceType,
      count: b.count,
      percentage: Math.round((b.count / total) * 10000) / 100,
    }))
  );
});

router.get("/admin/diagnostics", async (_req, res): Promise<void> => {
  const [totalCrawls] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(crawlLogsTable);

  const [successCrawls] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(crawlLogsTable)
    .where(eq(crawlLogsTable.status, "success"));

  const [failedCrawls] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(crawlLogsTable)
    .where(eq(crawlLogsTable.status, "failed"));

  const totalC = totalCrawls?.count ?? 0;
  const successC = successCrawls?.count ?? 0;
  const failedC = failedCrawls?.count ?? 0;

  const [rejectedPrices] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pricesTable)
    .where(eq(pricesTable.verificationStatus, "rejected_non_qualifying_source"));

  const [stalePrices] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pricesTable)
    .where(sql`${pricesTable.timestampFound} < now() - interval '90 days'`);

  const lastCrawl = await db
    .select({ crawledAt: crawlLogsTable.crawledAt })
    .from(crawlLogsTable)
    .orderBy(desc(crawlLogsTable.crawledAt))
    .limit(1);

  const connectors = await db
    .select({
      name: crawlLogsTable.connectorName,
      status: crawlLogsTable.status,
      lastRun: sql<string>`max(${crawlLogsTable.crawledAt})::text`,
      recordsIngested: sql<number>`sum(${crawlLogsTable.recordsIngested})::int`,
    })
    .from(crawlLogsTable)
    .groupBy(crawlLogsTable.connectorName, crawlLogsTable.status);

  res.json({
    totalCrawls: totalC,
    successfulCrawls: successC,
    failedCrawls: failedC,
    sourceHitRate: totalC > 0 ? Math.round((successC / totalC) * 10000) / 100 : 0,
    extractionSuccessRate: totalC > 0 ? Math.round((successC / totalC) * 10000) / 100 : 0,
    rejectedResults: rejectedPrices?.count ?? 0,
    staleResults: stalePrices?.count ?? 0,
    brokenSources: failedC,
    lastCrawlAt: lastCrawl[0]?.crawledAt?.toISOString() ?? null,
    connectorStatus: connectors.map((c) => ({
      name: c.name,
      status: c.status,
      lastRun: c.lastRun,
      recordsIngested: c.recordsIngested ?? 0,
    })),
  });
});

router.get("/services/popular", async (_req, res): Promise<void> => {
  const services = await db
    .select({
      name: pricesTable.normalizedService,
      providerCount: sql<number>`count(distinct ${pricesTable.providerId})::int`,
      avgPrice: sql<number>`round(avg(${pricesTable.exactPrice})::numeric, 2)::float`,
    })
    .from(pricesTable)
    .groupBy(pricesTable.normalizedService)
    .orderBy(desc(sql`count(distinct ${pricesTable.providerId})`))
    .limit(20);

  const categoryMap: Record<string, string> = {
    mri: "imaging",
    "ct scan": "imaging",
    "x-ray": "imaging",
    xray: "imaging",
    mammogram: "imaging",
    ultrasound: "imaging",
    cbc: "lab",
    "blood test": "lab",
    "lab panel": "lab",
    colonoscopy: "procedure",
    echocardiogram: "cardiology",
    "stress test": "cardiology",
    dental: "dental",
    "urgent care": "urgent_care",
    vaccine: "pharmacy",
  };

  res.json(
    services.map((s) => {
      const name = s.name.toLowerCase();
      let category = "general";
      for (const [key, val] of Object.entries(categoryMap)) {
        if (name.includes(key)) {
          category = val;
          break;
        }
      }
      return {
        name: s.name,
        category,
        cptCode: null,
        avgPrice: s.avgPrice,
        providerCount: s.providerCount,
      };
    })
  );
});

router.post("/export/csv", async (req, res): Promise<void> => {
  const { searchId } = req.body;

  const prices = await db
    .select({
      providerName: providersTable.name,
      providerType: providersTable.providerType,
      city: providersTable.city,
      stateRegion: providersTable.stateRegion,
      country: providersTable.country,
      normalizedService: pricesTable.normalizedService,
      billingCode: pricesTable.billingCode,
      exactPrice: pricesTable.exactPrice,
      currency: pricesTable.currency,
      priceType: pricesTable.priceType,
      sourceType: pricesTable.sourceType,
      sourceUrl: pricesTable.sourceUrl,
      verificationStatus: pricesTable.verificationStatus,
    })
    .from(pricesTable)
    .innerJoin(providersTable, eq(pricesTable.providerId, providersTable.id))
    .limit(500);

  const headers = [
    "Provider Name",
    "Type",
    "City",
    "State",
    "Country",
    "Service",
    "Billing Code",
    "Price",
    "Currency",
    "Price Type",
    "Source Type",
    "Source URL",
    "Verification",
  ];

  const rows = prices.map((p) =>
    [
      p.providerName,
      p.providerType,
      p.city ?? "",
      p.stateRegion ?? "",
      p.country,
      p.normalizedService,
      p.billingCode ?? "",
      p.exactPrice.toString(),
      p.currency,
      p.priceType,
      p.sourceType,
      p.sourceUrl,
      p.verificationStatus,
    ]
      .map((v) => `"${v.replace(/"/g, '""')}"`)
      .join(",")
  );

  const csv = [headers.join(","), ...rows].join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=price-intelligence-export.csv");
  res.send(csv);
});

export default router;
