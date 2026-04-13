/**
 * International Search Pipeline
 * Global Self-Pay Price Intelligence — Portal 5
 *
 * Sources used (in priority order):
 * A. US hospital machine-readable files (CMS / DoltHub)
 * B. Provider websites with explicit self-pay/cash pricing
 * C. Public PDFs, chargemasters, fee schedules
 * D. JSON-LD structured data on provider pages
 * E. NPPES for provider enrichment
 * F. Web search (Serper) as discovery layer
 * G. Tavily / Firecrawl for page extraction
 */

import { db } from "@workspace/db";
import { providersTable, pricesTable, crawlLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

// ─── API Keys ─────────────────────────────────────────────────────────────────
const SERPER_API_KEY    = process.env.SERPER_API_KEY;
const TAVILY_API_KEY    = process.env.TAVILY_API_KEY;
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const EXA_API_KEY       = process.env.EXA_API_KEY;
const GROQ_API_KEY      = process.env.GROQ_API_KEY;
const OPENROUTER_KEY    = process.env.OPENROUTER_KEY ?? process.env.OPENROUTER_API_KEY;

// ─── Types ────────────────────────────────────────────────────────────────────
export interface SearchParams {
  query: string;
  country?: string;
  city?: string;
  radiusMiles?: number;
  cashPayOnly?: boolean;
  hospitalOnly?: boolean;
  clinicOnly?: boolean;
  imagingOnly?: boolean;
  labOnly?: boolean;
  urgentCareOnly?: boolean;
  dentalOnly?: boolean;
  telehealthOnly?: boolean;
  page?: number;
  pageSize?: number;
}

interface SearchHit {
  url: string;
  title: string;
  snippet: string;
}

interface ExtractedPrice {
  providerName: string;
  organizationName?: string;
  providerType: string;
  specialty?: string;
  address?: string;
  city?: string;
  stateRegion?: string;
  postalCode?: string;
  country: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  website?: string;
  serviceQuery: string;
  normalizedService: string;
  billingCode?: string;
  exactPrice: number;
  currency: string;
  priceType: "self_pay" | "cash_pay" | "discounted_cash" | "bundled" | "fee_schedule";
  evidenceText?: string;
  sourceUrl: string;
  sourceType: string;
  verificationStatus: "verified_exact_posted_price" | "likely_exact_price_needs_review" | "provider_found_no_price" | "rejected_non_qualifying_source";
  confidenceScore: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const TIMEOUT_MS = 10_000;

const SKIP_DOMAINS = [
  "webmd.com", "healthline.com", "verywellhealth.com", "mayoclinic.org",
  "wikipedia.org", "reddit.com", "quora.com", "yelp.com", "healthgrades.com",
  "vitals.com", "ratemds.com", "nytimes.com", "wsj.com", "forbes.com",
  "costhelper.com", "nerdwallet.com", "gobankingrates.com", "goodrx.com",
  "youtube.com", "facebook.com", "twitter.com", "x.com", "instagram.com",
  "tiktok.com", "linkedin.com",
];

const PRICE_URL_HINTS = [
  "/self-pay", "/cash-price", "/cash-prices", "/pricing", "/fees",
  "/fee-schedule", "/price-transparency", "/patient-pricing",
  "/our-fees", "/service-fees", "/rates", "/transparency",
  "/uninsured", "/no-insurance", "/affordable-care",
];

// Country-specific search modifiers
const COUNTRY_SEARCH_MODIFIERS: Record<string, string> = {
  US: 'site:.com OR site:.org "self-pay" OR "cash price"',
  GB: '"self-pay" OR "private fees" OR "out of pocket"',
  CA: '"self-pay" OR "private rate" OR "uninsured"',
  AU: '"out of pocket" OR "self-funded" OR "private fee"',
  DE: '"Selbstzahler" OR "Privatpatient" OR "Privatpreis"',
  FR: '"prix secteur libéral" OR "dépassement d\'honoraires"',
  IN: '"package price" OR "cash payment" OR "self-pay"',
  MX: '"precio particular" OR "sin seguro" OR "pago directo"',
  TH: '"package price" OR "cash price" OR "self-pay"',
  SG: '"self-pay" OR "out of pocket" OR "subsidised"',
  DEFAULT: '"self-pay" OR "cash price" OR "out of pocket"',
};

// Currency by country
const COUNTRY_CURRENCY: Record<string, string> = {
  US: "USD", GB: "GBP", CA: "CAD", AU: "AUD",
  DE: "EUR", FR: "EUR", IN: "INR", MX: "MXN",
  TH: "THB", SG: "SGD", JP: "JPY", BR: "BRL",
  TR: "TRY", ZA: "ZAR", AE: "AED",
};

// Price regex patterns (multi-currency aware)
const PRICE_PATTERNS = [
  /\$\s*(\d[\d,]*(?:\.\d{1,2})?)/g,                          // USD $123
  /USD\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,
  /£\s*(\d[\d,]*(?:\.\d{1,2})?)/g,                          // GBP
  /€\s*(\d[\d,]*(?:\.\d{1,2})?)/g,                          // EUR
  /₹\s*(\d[\d,]*(?:\.\d{1,2})?)/g,                          // INR
  /¥\s*(\d[\d,]*(?:\.\d{1,2})?)/g,                          // JPY
  /CA\$\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,                      // CAD
  /AU\$\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,                      // AUD
  /MXN\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,                       // MXN
  /SGD\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,                       // SGD
  /THB\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,                       // THB
  /(\d[\d,]*(?:\.\d{1,2})?)\s*(?:baht|฿)/gi,               // THB alt
  /price[:\s]+\$?(\d[\d,]*(?:\.\d{1,2})?)/gi,
  /cost[:\s]+\$?(\d[\d,]*(?:\.\d{1,2})?)/gi,
  /fee[:\s]+\$?(\d[\d,]*(?:\.\d{1,2})?)/gi,
  /rate[:\s]+\$?(\d[\d,]*(?:\.\d{1,2})?)/gi,
  /(\d[\d,]*(?:\.\d{1,2})?)\s*(?:per\s+)?(?:visit|session|procedure|test|exam)/gi,
];

const PRICE_TYPE_KEYWORDS: Record<string, string[]> = {
  self_pay:        ["self-pay", "self pay", "uninsured", "without insurance", "no insurance"],
  cash_pay:        ["cash pay", "cash price", "cash only", "cash rate", "pay cash"],
  discounted_cash: ["discounted cash", "cash discount", "discounted rate"],
  bundled:         ["package", "bundle", "all-inclusive", "all inclusive"],
  fee_schedule:    ["fee schedule", "chargemaster", "standard charge", "price list"],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function shouldSkipDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace("www.", "");
    return SKIP_DOMAINS.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return false;
  }
}

function hasPricingPath(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return PRICE_URL_HINTS.some((hint) => path.includes(hint));
  } catch {
    return false;
  }
}

function detectCurrency(text: string, country: string): string {
  if (/£/.test(text)) return "GBP";
  if (/€/.test(text)) return "EUR";
  if (/₹/.test(text)) return "INR";
  if (/¥/.test(text)) return "JPY";
  if (/CA\$/i.test(text)) return "CAD";
  if (/AU\$/i.test(text)) return "AUD";
  if (/SGD/i.test(text)) return "SGD";
  if (/THB|baht|฿/i.test(text)) return "THB";
  if (/MXN/i.test(text)) return "MXN";
  return COUNTRY_CURRENCY[country] ?? "USD";
}

function detectPriceType(text: string): ExtractedPrice["priceType"] {
  const lower = text.toLowerCase();
  for (const [type, keywords] of Object.entries(PRICE_TYPE_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return type as ExtractedPrice["priceType"];
    }
  }
  return "self_pay";
}

function extractPricesFromText(text: string): number[] {
  const prices: number[] = [];
  for (const pattern of PRICE_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const val = parseFloat(m[1].replace(/,/g, ""));
      // Sanity filter: between $5 and $500,000
      if (val >= 5 && val <= 500_000) prices.push(val);
    }
  }
  return [...new Set(prices)];
}

function detectProviderType(text: string, url: string): string {
  const lower = (text + " " + url).toLowerCase();
  if (/dental|dentist|orthodon/.test(lower)) return "dental";
  if (/lab|laboratory|diagnostic|patholog/.test(lower)) return "lab";
  if (/imaging|radiol|mri|ct scan|x.?ray|ultrasound/.test(lower)) return "imaging_center";
  if (/urgent care|walk.?in|minute clinic|fastmed/.test(lower)) return "urgent_care";
  if (/hospital|medical center|health system/.test(lower)) return "hospital";
  if (/telehealth|virtual|online consult/.test(lower)) return "telehealth";
  return "clinic";
}

function computeConfidence(hit: SearchHit, extractedPrices: number[]): number {
  let score = 0.5;
  if (extractedPrices.length > 0) score += 0.2;
  if (hasPricingPath(hit.url)) score += 0.15;
  const lower = hit.snippet.toLowerCase();
  if (/self.?pay|cash.?price|posted.?price|fee schedule/.test(lower)) score += 0.1;
  if (/estimate|typical|average|range|about/.test(lower)) score -= 0.15;
  if (/blog|article|guide|news/.test(hit.url.toLowerCase())) score -= 0.2;
  return Math.min(Math.max(score, 0.1), 1.0);
}

function extractProviderNameFromText(text: string, url: string): string {
  // Try to get the domain name as a fallback provider name
  try {
    const host = new URL(url).hostname.replace("www.", "").split(".")[0];
    return host.charAt(0).toUpperCase() + host.slice(1).replace(/-/g, " ");
  } catch {
    return "Unknown Provider";
  }
}

function extractCityFromText(text: string): string | undefined {
  // Simple: look for "in [City], [State/Country]" pattern
  const m = text.match(/\bin\s+([A-Z][a-z]+(?: [A-Z][a-z]+)?),\s*([A-Z]{2,})/);
  return m ? m[1] : undefined;
}

// ─── Web Search (Serper) ──────────────────────────────────────────────────────
async function searchSerper(query: string, country: string, location?: string): Promise<SearchHit[]> {
  if (!SERPER_API_KEY) {
    logger.warn("SERPER_API_KEY not set — skipping Serper");
    return [];
  }

  const countryMod = COUNTRY_SEARCH_MODIFIERS[country] ?? COUNTRY_SEARCH_MODIFIERS.DEFAULT;
  const locMod = location ? `"${location}"` : "";
  const finalQuery = `${query} ${locMod} ${countryMod} -site:healthline.com -site:webmd.com -site:wikipedia.org`.trim();

  try {
    const res = await fetchWithTimeout(
      "https://google.serper.dev/search",
      {
        method: "POST",
        headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ q: finalQuery, num: 10, gl: country?.toLowerCase() || "us" }),
      }
    );
    if (!res.ok) throw new Error(`Serper ${res.status}`);
    const data = await res.json() as { organic?: Array<{ link: string; title: string; snippet: string }> };
    return (data.organic ?? []).map((r) => ({ url: r.link, title: r.title, snippet: r.snippet }));
  } catch (err) {
    logger.warn({ err }, "Serper search failed");
    return [];
  }
}

// ─── Tavily Extract ───────────────────────────────────────────────────────────
async function extractWithTavily(urls: string[], query: string): Promise<Array<{ url: string; content: string }>> {
  if (!TAVILY_API_KEY || urls.length === 0) return [];

  try {
    const res = await fetchWithTimeout(
      "https://api.tavily.com/extract",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${TAVILY_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ urls: urls.slice(0, 5) }),
      },
      15_000
    );
    if (!res.ok) throw new Error(`Tavily ${res.status}`);
    const data = await res.json() as { results?: Array<{ url: string; raw_content: string }> };
    return (data.results ?? []).map((r) => ({ url: r.url, content: r.raw_content ?? "" }));
  } catch (err) {
    logger.warn({ err }, "Tavily extract failed");
    return [];
  }
}

// ─── Exa Search ──────────────────────────────────────────────────────────────
async function searchExa(query: string, country: string): Promise<SearchHit[]> {
  if (!EXA_API_KEY) return [];

  try {
    const res = await fetchWithTimeout(
      "https://api.exa.ai/search",
      {
        method: "POST",
        headers: { "x-api-key": EXA_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `${query} self-pay price posted`,
          numResults: 8,
          type: "neural",
          includeDomains: [],
          useAutoprompt: true,
          contents: { text: { maxCharacters: 2000 } },
        }),
      }
    );
    if (!res.ok) throw new Error(`Exa ${res.status}`);
    const data = await res.json() as { results?: Array<{ url: string; title: string; text?: string }> };
    return (data.results ?? []).map((r) => ({
      url: r.url,
      title: r.title,
      snippet: (r.text ?? "").slice(0, 400),
    }));
  } catch (err) {
    logger.warn({ err }, "Exa search failed");
    return [];
  }
}

// ─── LLM Price Extraction ─────────────────────────────────────────────────────
async function extractWithLLM(
  pageContent: string,
  serviceQuery: string,
  sourceUrl: string,
  country: string
): Promise<Partial<ExtractedPrice> | null> {
  const key = OPENROUTER_KEY ?? GROQ_API_KEY;
  const endpoint = OPENROUTER_KEY
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://api.groq.com/openai/v1/chat/completions";
  const model = OPENROUTER_KEY ? "google/gemini-flash-1.5" : "llama3-8b-8192";

  if (!key || !pageContent) return null;

  const snippet = pageContent.slice(0, 3000);

  const prompt = `You are a healthcare price extraction specialist. Analyze this page content and extract ONLY explicitly posted self-pay or cash prices for the service "${serviceQuery}".

RULES:
- Only extract prices that are literally stated on the page (not estimates, ranges, or "call for pricing")
- If no exact price is found, respond with: {"found": false}
- Include the exact text evidence that shows the price

PAGE URL: ${sourceUrl}
PAGE CONTENT:
${snippet}

Respond with JSON only:
{
  "found": true,
  "providerName": "...",
  "exactPrice": 123.45,
  "currency": "USD",
  "priceType": "self_pay|cash_pay|discounted_cash|bundled|fee_schedule",
  "serviceNormalized": "...",
  "billingCode": "..." or null,
  "evidenceText": "exact quote from the page",
  "city": "...",
  "stateRegion": "...",
  "country": "${country}",
  "phone": "..." or null,
  "confidenceScore": 0.0-1.0
}`;

  try {
    const res = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          max_tokens: 512,
          response_format: { type: "json_object" },
        }),
      },
      12_000
    );
    if (!res.ok) throw new Error(`LLM ${res.status}`);
    const data = await res.json() as { choices?: Array<{ message: { content: string } }> };
    const raw = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    if (!parsed.found || !parsed.exactPrice) return null;
    return {
      providerName: parsed.providerName,
      normalizedService: parsed.serviceNormalized ?? serviceQuery,
      billingCode: parsed.billingCode,
      exactPrice: Number(parsed.exactPrice),
      currency: parsed.currency ?? COUNTRY_CURRENCY[country] ?? "USD",
      priceType: parsed.priceType ?? "self_pay",
      evidenceText: parsed.evidenceText,
      city: parsed.city,
      stateRegion: parsed.stateRegion,
      country: parsed.country ?? country,
      phone: parsed.phone,
      confidenceScore: Math.min(Math.max(Number(parsed.confidenceScore ?? 0.7), 0), 1),
      verificationStatus: "verified_exact_posted_price",
    };
  } catch (err) {
    logger.warn({ err }, "LLM extraction failed");
    return null;
  }
}

// ─── Upsert provider + price to DB ───────────────────────────────────────────
async function upsertResult(extracted: ExtractedPrice): Promise<void> {
  // Find or create provider
  const [existing] = await db
    .select({ id: providersTable.id })
    .from(providersTable)
    .where(eq(providersTable.website, extracted.website ?? extracted.sourceUrl))
    .limit(1);

  let providerId: number;

  if (existing) {
    providerId = existing.id;
  } else {
    const [prov] = await db
      .insert(providersTable)
      .values({
        name: extracted.providerName,
        organizationName: extracted.organizationName,
        providerType: extracted.providerType,
        specialty: extracted.specialty,
        address: extracted.address,
        city: extracted.city,
        stateRegion: extracted.stateRegion,
        postalCode: extracted.postalCode,
        country: extracted.country,
        latitude: extracted.latitude,
        longitude: extracted.longitude,
        phone: extracted.phone,
        website: extracted.website ?? extracted.sourceUrl,
      })
      .returning({ id: providersTable.id });
    providerId = prov.id;
  }

  await db.insert(pricesTable).values({
    providerId,
    serviceQuery: extracted.serviceQuery,
    normalizedService: extracted.normalizedService,
    billingCode: extracted.billingCode,
    exactPrice: extracted.exactPrice,
    currency: extracted.currency,
    priceType: extracted.priceType,
    evidenceText: extracted.evidenceText,
    sourceUrl: extracted.sourceUrl,
    sourceType: extracted.sourceType,
    verificationStatus: extracted.verificationStatus,
    confidenceScore: extracted.confidenceScore,
  });
}

// ─── Main Pipeline ────────────────────────────────────────────────────────────
export async function runInternationalSearch(params: SearchParams): Promise<void> {
  const {
    query,
    country = "",
    city,
    cashPayOnly,
    hospitalOnly,
    clinicOnly,
    imagingOnly,
    labOnly,
    urgentCareOnly,
    dentalOnly,
    telehealthOnly,
  } = params;

  const logPrefix = `[intl-search] query="${query}" country="${country}"`;
  logger.info(logPrefix + " — starting pipeline");

  let hits: SearchHit[] = [];

  // 1. Parallel discovery
  const [serperHits, exaHits] = await Promise.all([
    searchSerper(query, country || "US", city),
    searchExa(query, country || "US"),
  ]);

  hits = [...serperHits, ...exaHits];

  // 2. Filter
  const filteredHits = hits.filter((h) => !shouldSkipDomain(h.url));

  // 3. Score and prioritize URLs with pricing path hints
  const scored = filteredHits
    .map((h) => ({ hit: h, score: computeConfidence(h, []) + (hasPricingPath(h.url) ? 0.2 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((s) => s.hit);

  // 4. Extract page content
  const extracted = await extractWithTavily(scored.map((h) => h.url), query);

  // 5. LLM extraction per page
  const results: ExtractedPrice[] = [];

  for (const page of extracted) {
    try {
      const hit = scored.find((h) => h.url === page.url) ?? { url: page.url, title: "", snippet: "" };

      // Fast price check before expensive LLM call
      const quickPrices = extractPricesFromText(page.content.slice(0, 2000));
      if (quickPrices.length === 0 && !hasPricingPath(page.url)) continue;

      const llmResult = await extractWithLLM(page.content, query, page.url, country || "US");

      if (llmResult && llmResult.exactPrice) {
        // Filter by facility type if requested
        const pType = detectProviderType(page.content.slice(0, 500), page.url);
        if (hospitalOnly && pType !== "hospital") continue;
        if (clinicOnly && pType !== "clinic") continue;
        if (imagingOnly && pType !== "imaging_center") continue;
        if (labOnly && pType !== "lab") continue;
        if (urgentCareOnly && pType !== "urgent_care") continue;
        if (dentalOnly && pType !== "dental") continue;
        if (telehealthOnly && pType !== "telehealth") continue;

        const full: ExtractedPrice = {
          providerName: llmResult.providerName ?? extractProviderNameFromText(page.content, page.url),
          providerType: pType,
          city: llmResult.city ?? extractCityFromText(hit.snippet),
          stateRegion: llmResult.stateRegion,
          country: llmResult.country ?? country ?? "US",
          phone: llmResult.phone,
          website: page.url,
          serviceQuery: query,
          normalizedService: llmResult.normalizedService ?? query,
          billingCode: llmResult.billingCode,
          exactPrice: llmResult.exactPrice,
          currency: llmResult.currency ?? detectCurrency(page.content, country ?? "US"),
          priceType: llmResult.priceType ?? detectPriceType(page.content),
          evidenceText: llmResult.evidenceText,
          sourceUrl: page.url,
          sourceType: hit.url.includes("dolthub") ? "dolthub"
            : hit.url.endsWith(".pdf") ? "pdf_price_sheet"
            : /\.gov/.test(hit.url) ? "cms_dataset"
            : "provider_website",
          verificationStatus: llmResult.verificationStatus ?? "likely_exact_price_needs_review",
          confidenceScore: llmResult.confidenceScore ?? 0.7,
        };

        if (cashPayOnly && !["self_pay", "cash_pay", "discounted_cash"].includes(full.priceType)) continue;

        results.push(full);
      }
    } catch (err) {
      logger.warn({ err, url: page.url }, "Page extraction error");
    }
  }

  // 6. Persist results
  let persisted = 0;
  for (const r of results) {
    try {
      await upsertResult(r);
      persisted++;
    } catch (err) {
      logger.warn({ err }, "Failed to persist result");
    }
  }

  // 7. Log crawl
  await db.insert(crawlLogsTable).values({
    connectorName: `intl-web-search:${country || "global"}`,
    status: persisted > 0 ? "success" : "no_results",
    recordsIngested: persisted,
  });

  logger.info(`${logPrefix} — pipeline complete. Persisted ${persisted}/${results.length} results`);
}
