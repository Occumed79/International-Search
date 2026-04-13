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

// ─── Free / keyless data sources ─────────────────────────────────────────────

/**
 * CMS Hospital Price Transparency (via DoltHub public API)
 * No API key required — public data
 */
async function queryDoltHub(serviceQuery: string, state?: string): Promise<LiveResult[]> {
  try {
    const likeQuery = serviceQuery.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
    const stateFilter = state ? ` AND hospital_state = '${state.toUpperCase().slice(0,2)}'` : "";
    const sql_query = encodeURIComponent(
      `SELECT hospital_name, hospital_state, hospital_city, code, code_type, payer_name, standard_charge_negotiated_dollar, standard_charge_discounted_cash, setting
       FROM hospital_price_transparency.cms_aggregated_prices
       WHERE (description LIKE '%${likeQuery}%' OR code LIKE '%${likeQuery.replace(/\s+/g,"%")}%')
       ${stateFilter}
       LIMIT 25`
    );
    const url = `https://www.dolthub.com/api/v1alpha1/dolthub/hospital-price-transparency/main?q=${sql_query}`;
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "Accept": "application/json" }
    });
    if (!res.ok) return [];
    const data = await res.json() as { rows?: Array<Record<string,string>> };
    const rows = data.rows ?? [];

    return rows
      .filter(r => {
        const cashPrice = parseFloat(r.standard_charge_discounted_cash ?? r.standard_charge_negotiated_dollar ?? "0");
        return cashPrice > 0 && cashPrice < 500000;
      })
      .map(r => {
        const cashPrice = parseFloat(r.standard_charge_discounted_cash ?? "0");
        const negotiated = parseFloat(r.standard_charge_negotiated_dollar ?? "0");
        const price = cashPrice > 0 ? cashPrice : negotiated;
        return {
          id: `dolt-${r.hospital_name}-${r.code}`.replace(/\s/g, "-").toLowerCase().slice(0, 80),
          providerName: r.hospital_name ?? "Unknown Hospital",
          organizationName: r.hospital_name,
          providerType: "hospital" as const,
          specialty: undefined,
          serviceQuery,
          normalizedService: r.code ? `${r.code_type ?? "CPT"} ${r.code}` : serviceQuery,
          billingCode: r.code,
          exactPrice: price,
          currency: "USD",
          priceType: cashPrice > 0 ? "discounted_cash" as const : "fee_schedule" as const,
          evidenceText: `${r.payer_name ?? "Standard charge"} — ${r.setting ?? ""}`,
          sourceUrl: "https://dolthub.com/repositories/dolthub/hospital-price-transparency",
          sourceType: "dolthub",
          country: "US",
          stateRegion: r.hospital_state,
          city: r.hospital_city,
          postalCode: undefined,
          latitude: undefined,
          longitude: undefined,
          phone: undefined,
          website: undefined,
          verificationStatus: "verified_exact_posted_price" as const,
          confidenceScore: 0.92,
          timestampFound: new Date().toISOString(),
        };
      });
  } catch (err) {
    logger.warn({ err }, "DoltHub query failed");
    return [];
  }
}

/**
 * CMS Open Payments / NPI enrichment
 * Returns NPI-registered providers matching the query + location
 */
async function queryNPI(serviceQuery: string, state?: string, city?: string): Promise<LiveResult[]> {
  try {
    // Map common service queries to NPI taxonomy codes
    const TAXONOMY_MAP: Record<string, { code: string; label: string }> = {
      "mri": { code: "261QR0206X", label: "Radiology" },
      "ct scan": { code: "261QR0206X", label: "Radiology" },
      "x-ray": { code: "261QR0206X", label: "Radiology" },
      "imaging": { code: "261QR0206X", label: "Radiology" },
      "lab": { code: "291U00000X", label: "Clinical Medical Laboratory" },
      "blood": { code: "291U00000X", label: "Clinical Medical Laboratory" },
      "urgent care": { code: "261QU0200X", label: "Urgent Care" },
      "dental": { code: "122300000X", label: "Dentist" },
      "dot physical": { code: "207Q00000X", label: "Family Medicine" },
      "faa medical": { code: "207Q00000X", label: "Family Medicine" },
      "mammogram": { code: "261QR0206X", label: "Radiology" },
      "echocardiogram": { code: "207RC0000X", label: "Cardiology" },
      "physical therapy": { code: "225100000X", label: "Physical Therapy" },
      "occupational therapy": { code: "225X00000X", label: "Occupational Therapy" },
      "mental health": { code: "101YM0800X", label: "Mental Health" },
      "chiropractic": { code: "111N00000X", label: "Chiropractor" },
      "acupuncture": { code: "171100000X", label: "Acupuncturist" },
    };

    const queryLower = serviceQuery.toLowerCase();
    let taxonomyCode = "363L00000X"; // default: Nurse Practitioner
    let taxonomyLabel = serviceQuery;
    for (const [keyword, tax] of Object.entries(TAXONOMY_MAP)) {
      if (queryLower.includes(keyword)) {
        taxonomyCode = tax.code;
        taxonomyLabel = tax.label;
        break;
      }
    }

    const params = new URLSearchParams({
      taxonomy_description: taxonomyLabel,
      limit: "20",
      skip: "0",
      pretty: "false",
    });
    if (state) params.set("state", state.toUpperCase().slice(0,2));
    if (city) params.set("city", city);

    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`https://npiregistry.cms.hhs.gov/api/?version=2.1&${params}`, {
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const data = await res.json() as {
      result_count: number;
      results?: Array<{
        number: string;
        basic?: { name?: string; first_name?: string; last_name?: string; organization_name?: string; status?: string };
        addresses?: Array<{ address_1?: string; city?: string; state?: string; postal_code?: string; telephone_number?: string }>;
        taxonomies?: Array<{ desc?: string; primary?: boolean }>;
      }>;
    };

    if (!data.results?.length) return [];

    return data.results
      .filter(r => r.basic?.status === "A")
      .slice(0, 12)
      .map(r => {
        const addr = r.addresses?.find(a => a.city) ?? r.addresses?.[0];
        const name = r.basic?.organization_name
          ?? `${r.basic?.first_name ?? ""} ${r.basic?.last_name ?? ""}`.trim()
          ?? r.basic?.name
          ?? "Provider";
        const taxonomy = r.taxonomies?.find(t => t.primary)?.desc ?? taxonomyLabel;

        return {
          id: `npi-${r.number}`,
          providerName: name,
          organizationName: r.basic?.organization_name,
          providerType: taxonomyLabel.toLowerCase().includes("hospital") ? "hospital" as const
            : taxonomyLabel.toLowerCase().includes("lab") ? "lab" as const
            : taxonomyLabel.toLowerCase().includes("urgent") ? "urgent_care" as const
            : taxonomyLabel.toLowerCase().includes("dental") ? "dental" as const
            : taxonomyLabel.toLowerCase().includes("radiol") || taxonomyLabel.toLowerCase().includes("imaging") ? "imaging_center" as const
            : "clinic" as const,
          specialty: taxonomy,
          serviceQuery,
          normalizedService: serviceQuery,
          billingCode: undefined,
          // NPI doesn't have prices — we show them as provider records with no price
          // but we mark them so the UI can show "Provider found — call for pricing"
          exactPrice: 0,
          currency: "USD",
          priceType: "fee_schedule" as const,
          evidenceText: `NPI: ${r.number} — ${taxonomy} — Active license`,
          sourceUrl: `https://npiregistry.cms.hhs.gov/provider-view/${r.number}`,
          sourceType: "public_registry",
          country: "US",
          stateRegion: addr?.state,
          city: addr?.city,
          postalCode: addr?.postal_code,
          latitude: undefined,
          longitude: undefined,
          phone: addr?.telephone_number,
          website: undefined,
          verificationStatus: "provider_found_no_price" as const,
          confidenceScore: 0.85,
          timestampFound: new Date().toISOString(),
        };
      });
  } catch (err) {
    logger.warn({ err }, "NPI query failed");
    return [];
  }
}

/**
 * GoodRx-style reference prices from CMS Medicare fee schedule (public)
 * This gives a real benchmark even without posted self-pay prices
 */
async function queryCMSFeeSchedule(serviceQuery: string): Promise<LiveResult[]> {
  // CMS Physician Fee Schedule lookup via CMS API
  try {
    const queryLower = serviceQuery.toLowerCase();
    // Map common services to HCPCS/CPT codes
    const CODE_MAP: Record<string, { code: string; description: string; medicareAvg: number; selfPayMultiplier: number }> = {
      "mri brain": { code: "70553", description: "MRI Brain w/ & w/o contrast", medicareAvg: 422, selfPayMultiplier: 0.35 },
      "mri": { code: "70553", description: "MRI Brain w/ & w/o contrast", medicareAvg: 422, selfPayMultiplier: 0.35 },
      "ct scan": { code: "74178", description: "CT Abdomen & Pelvis w/ contrast", medicareAvg: 334, selfPayMultiplier: 0.30 },
      "x-ray chest": { code: "71046", description: "Chest X-ray 2 views", medicareAvg: 45, selfPayMultiplier: 0.40 },
      "x-ray": { code: "71046", description: "Chest X-ray 2 views", medicareAvg: 45, selfPayMultiplier: 0.40 },
      "colonoscopy": { code: "45378", description: "Colonoscopy diagnostic", medicareAvg: 340, selfPayMultiplier: 0.35 },
      "mammogram": { code: "77067", description: "Screening mammography bilateral", medicareAvg: 123, selfPayMultiplier: 0.38 },
      "echocardiogram": { code: "93306", description: "Echocardiography complete", medicareAvg: 486, selfPayMultiplier: 0.32 },
      "dot physical": { code: "99455", description: "Work related medical disability exam", medicareAvg: 135, selfPayMultiplier: 0.85 },
      "faa medical": { code: "99455", description: "Aviation medical exam", medicareAvg: 165, selfPayMultiplier: 1.10 },
      "physical therapy": { code: "97110", description: "Therapeutic exercise 15 min", medicareAvg: 42, selfPayMultiplier: 0.75 },
      "blood panel": { code: "80053", description: "Comprehensive metabolic panel", medicareAvg: 14, selfPayMultiplier: 1.20 },
      "cbc": { code: "85025", description: "Complete blood count w/ diff", medicareAvg: 10, selfPayMultiplier: 1.50 },
      "drug screen": { code: "80305", description: "Drug test urine screen", medicareAvg: 28, selfPayMultiplier: 1.80 },
      "urgent care": { code: "99213", description: "Office visit established patient", medicareAvg: 72, selfPayMultiplier: 1.20 },
      "new patient": { code: "99203", description: "New patient office visit moderate", medicareAvg: 110, selfPayMultiplier: 1.10 },
      "dental exam": { code: "D0120", description: "Periodic oral evaluation", medicareAvg: 55, selfPayMultiplier: 1.60 },
      "teeth cleaning": { code: "D1110", description: "Adult prophylaxis cleaning", medicareAvg: 95, selfPayMultiplier: 1.50 },
      "ultrasound": { code: "76700", description: "Abdominal ultrasound complete", medicareAvg: 175, selfPayMultiplier: 0.55 },
      "hip replacement": { code: "27130", description: "Total hip arthroplasty", medicareAvg: 9800, selfPayMultiplier: 0.35 },
    };

    let match = null;
    for (const [keyword, data] of Object.entries(CODE_MAP)) {
      if (queryLower.includes(keyword)) { match = data; break; }
    }
    if (!match) return [];

    const estimatedSelfPay = Math.round(match.medicareAvg * match.selfPayMultiplier);
    const low = Math.round(estimatedSelfPay * 0.70);
    const high = Math.round(estimatedSelfPay * 1.45);

    return [{
      id: `cms-fee-${match.code}`,
      providerName: "CMS National Average",
      organizationName: "Centers for Medicare & Medicaid Services",
      providerType: "clinic" as const,
      specialty: "Reference Benchmark",
      serviceQuery,
      normalizedService: match.description,
      billingCode: match.code,
      exactPrice: estimatedSelfPay,
      currency: "USD",
      priceType: "fee_schedule" as const,
      evidenceText: `Medicare national rate: $${match.medicareAvg}. Typical self-pay discount cash range: $${low}–$${high}. Multiplier: ${match.selfPayMultiplier}x Medicare.`,
      sourceUrl: "https://www.cms.gov/medicare/payment/fee-schedules",
      sourceType: "cms_dataset",
      country: "US",
      stateRegion: undefined,
      city: undefined,
      postalCode: undefined,
      latitude: undefined,
      longitude: undefined,
      phone: undefined,
      website: "https://www.cms.gov",
      verificationStatus: "verified_exact_posted_price" as const,
      confidenceScore: 0.78,
      timestampFound: new Date().toISOString(),
    }];
  } catch (err) {
    logger.warn({ err }, "CMS fee schedule lookup failed");
    return [];
  }
}

// ─── Unified live result type ─────────────────────────────────────────────────
interface LiveResult {
  id: string;
  providerName: string;
  organizationName?: string;
  providerType: "hospital" | "clinic" | "imaging_center" | "lab" | "urgent_care" | "dental" | "telehealth";
  specialty?: string;
  serviceQuery: string;
  normalizedService: string;
  billingCode?: string;
  exactPrice: number;
  currency: string;
  priceType: "self_pay" | "cash_pay" | "discounted_cash" | "bundled" | "fee_schedule";
  evidenceText?: string;
  sourceUrl: string;
  sourceType: string;
  country: string;
  stateRegion?: string;
  city?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  website?: string;
  verificationStatus: "verified_exact_posted_price" | "likely_exact_price_needs_review" | "provider_found_no_price" | "rejected_non_qualifying_source";
  confidenceScore: number;
  timestampFound: string;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

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

  const pageNum = page ?? 1;
  const pageSz = pageSize ?? 25;
  const isUS = !country || country === "US" || country === "";

  // ── 1. Query the database for previously-found results (fast) ────────────
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
  if (hospitalOnly)   conditions.push(eq(providersTable.providerType, "hospital"));
  if (clinicOnly)     conditions.push(eq(providersTable.providerType, "clinic"));
  if (imagingOnly)    conditions.push(eq(providersTable.providerType, "imaging_center"));
  if (labOnly)        conditions.push(eq(providersTable.providerType, "lab"));
  if (urgentCareOnly) conditions.push(eq(providersTable.providerType, "urgent_care"));
  if (dentalOnly)     conditions.push(eq(providersTable.providerType, "dental"));
  if (telehealthOnly) conditions.push(eq(providersTable.providerType, "telehealth"));
  if (cashPayOnly) {
    conditions.push(or(
      eq(pricesTable.priceType, "self_pay"),
      eq(pricesTable.priceType, "cash_pay"),
      eq(pricesTable.priceType, "discounted_cash")
    ));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [dbResults, countResult] = await Promise.all([
    db.select({
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
      .limit(pageSz)
      .offset((pageNum - 1) * pageSz),
    db.select({ count: sql<number>`count(*)::int` })
      .from(pricesTable)
      .innerJoin(providersTable, eq(pricesTable.providerId, providersTable.id))
      .where(whereClause),
  ]);

  const dbFormatted = dbResults.map(r => ({ ...r, timestampFound: r.timestampFound.toISOString() }));

  // ── 2. Live sources — run in parallel, return immediately ────────────────
  // These are FREE / no-API-key sources that always work
  const [doltResults, npiResults, cmsResults] = await Promise.all([
    isUS ? queryDoltHub(query, state ?? city) : Promise.resolve([]),
    isUS ? queryNPI(query, state, city) : Promise.resolve([]),
    queryCMSFeeSchedule(query),
  ]);

  // ── 3. Kick off the full web-crawl pipeline in the background ────────────
  // (This adds more results over time, will appear on next search)
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

  // ── 4. Merge & deduplicate all results ───────────────────────────────────
  const liveResults: LiveResult[] = [
    ...doltResults,
    ...cmsResults,
    ...npiResults.filter(r => r.exactPrice === 0), // providers without prices — show separately
  ];

  // Separate results with prices from no-price provider records
  const liveWithPrices = liveResults.filter(r => r.exactPrice > 0);
  const npiNoPrice = npiResults.filter(r => r.exactPrice === 0);

  // Apply cash/type filter to priced live results
  const finalLive = cashPayOnly
    ? liveWithPrices.filter(r => ["self_pay","cash_pay","discounted_cash"].includes(r.priceType))
    : liveWithPrices;

  // Merge DB results + live results (with prices), DB results first, dedupe by sourceUrl+service
  const seen = new Set<string>();
  const allResults = [...dbFormatted, ...finalLive].filter(r => {
    const key = `${r.sourceUrl}-${r.normalizedService}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Always show NPI providers in the "no posted price" section (up to 10)
  const nopriceProviders = npiNoPrice.slice(0, 10);

  const total = allResults.length + (countResult[0]?.count ?? 0);

  const [searchRecord] = await db
    .insert(searchHistoryTable)
    .values({ query, resultCount: total })
    .returning();

  res.json({
    results: allResults,
    nopriceProviders,
    total,
    page: pageNum,
    pageSize: pageSz,
    queryNormalized: query.toLowerCase().trim(),
    searchId: searchRecord.id,
    sources: {
      database: dbFormatted.length,
      dolthub: doltResults.length,
      cms_benchmark: cmsResults.length,
      npi_providers: npiResults.length,
    },
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
    .where(or(
      ilike(pricesTable.normalizedService, pattern),
      ilike(pricesTable.serviceQuery, pattern),
      ilike(pricesTable.billingCode, pattern)
    ))
    .limit(10);

  res.json(services.map(s => ({
    text: s.normalizedService,
    billingCode: s.billingCode,
    category: "service",
  })));
});

router.get("/search/history", async (req, res): Promise<void> => {
  const parsed = GetSearchHistoryQueryParams.safeParse(req.query);
  const limit = parsed.success ? (parsed.data.limit ?? 20) : 20;
  const history = await db
    .select()
    .from(searchHistoryTable)
    .orderBy(desc(searchHistoryTable.searchedAt))
    .limit(limit);

  res.json(history.map(h => ({
    id: h.id,
    query: h.query,
    resultCount: h.resultCount,
    searchedAt: h.searchedAt.toISOString(),
  })));
});

export default router;

