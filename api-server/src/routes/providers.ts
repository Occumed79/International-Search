import { Router, type IRouter } from "express";
import { db, providersTable, pricesTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { GetProviderParams, GetProviderPricesParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/providers/:id", async (req, res): Promise<void> => {
  const params = GetProviderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [provider] = await db
    .select()
    .from(providersTable)
    .where(eq(providersTable.id, params.data.id));

  if (!provider) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }

  const prices = await db
    .select()
    .from(pricesTable)
    .where(eq(pricesTable.providerId, provider.id));

  const sources = [...new Set(prices.map((p) => p.sourceType))];

  res.json({
    id: provider.id,
    name: provider.name,
    organizationName: provider.organizationName,
    npi: provider.npi,
    providerType: provider.providerType,
    specialty: provider.specialty,
    address: provider.address,
    city: provider.city,
    stateRegion: provider.stateRegion,
    postalCode: provider.postalCode,
    country: provider.country,
    latitude: provider.latitude,
    longitude: provider.longitude,
    phone: provider.phone,
    website: provider.website,
    priceCount: prices.length,
    lastUpdated: provider.lastUpdated.toISOString(),
    sources,
  });
});

router.get("/providers/:id/prices", async (req, res): Promise<void> => {
  const params = GetProviderPricesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const prices = await db
    .select({
      id: pricesTable.id,
      providerId: pricesTable.providerId,
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
    .where(eq(pricesTable.providerId, params.data.id))
    .orderBy(desc(pricesTable.confidenceScore));

  res.json(
    prices.map((p) => ({
      ...p,
      timestampFound: p.timestampFound.toISOString(),
    }))
  );
});

export default router;
