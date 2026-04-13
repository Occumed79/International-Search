/**
 * Surgical Search Pipeline — Portal 5
 * Global Self-Pay Price Intelligence
 *
 * Architecture:
 *   Layer 1 — Query Engineering  : build precision boolean queries per engine
 *   Layer 2 — Multi-Engine Search: Serper (Google) + Exa (neural) in parallel
 *   Layer 3 — Deep Extraction    : Tavily + Jina extracts full page text
 *   Layer 4 — LLM Adjudication  : Groq/Llama rejects noise, extracts only exact prices
 *   Layer 5 — Persist            : upsert to DB for instant future hits
 */

import { db } from "@workspace/db";
import { providersTable, pricesTable, crawlLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const SERPER_API_KEY    = process.env.SERPER_API_KEY;
const TAVILY_API_KEY    = process.env.TAVILY_API_KEY;
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const EXA_API_KEY       = process.env.EXA_API_KEY;
const GROQ_API_KEY      = process.env.GROQ_API_KEY;
const OPENROUTER_KEY    = process.env.OPENROUTER_KEY ?? process.env.OPENROUTER_API_KEY;
const JINA_API_KEY      = process.env.JINA_API_KEY;

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
  score?: number;
  hasPageContent?: boolean;
  pageContent?: string;
}

export interface ExtractedPrice {
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

const TIMEOUT_MS = 12_000;

const SKIP_DOMAINS = new Set([
  "webmd.com", "healthline.com", "verywellhealth.com", "mayoclinic.org",
  "wikipedia.org", "reddit.com", "quora.com", "yelp.com", "healthgrades.com",
  "vitals.com", "ratemds.com", "nytimes.com", "wsj.com", "forbes.com",
  "costhelper.com", "nerdwallet.com", "gobankingrates.com", "goodrx.com",
  "youtube.com", "facebook.com", "twitter.com", "x.com", "instagram.com",
  "tiktok.com", "linkedin.com", "pinterest.com", "bing.com", "google.com",
  "drugs.com", "rxlist.com", "medicinenet.com", "everydayhealth.com",
  "health.com", "prevention.com", "sharecare.com", "zocdoc.com",
]);

const PRICE_URL_SIGNALS = [
  "/self-pay", "/cash-price", "/cash-prices", "/pricing", "/fees",
  "/fee-schedule", "/price-transparency", "/patient-pricing", "/price-list",
  "/our-fees", "/service-fees", "/rates", "/transparency", "/chargemaster",
  "/uninsured", "/no-insurance", "/affordable-care", "/financial",
  "/standard-charges", "/charge-description-master", "/cdm",
];

const COUNTRY_PRICE_TERMS: Record<string, string[]> = {
  US:  ["self-pay price", "cash price", "posted price", "uninsured rate"],
  GB:  ["self-pay fee", "private fee", "out of pocket", "self-funded"],
  CA:  ["self-pay", "private rate", "uninsured", "out of pocket"],
  AU:  ["out of pocket", "self-funded", "private fee", "gap fee"],
  DE:  ["Selbstzahler", "Privatpatient", "Privatpreis", "IGel"],
  FR:  ["secteur liberal", "depassement honoraires", "tarif conventionnel"],
  IN:  ["package price", "cash payment", "self-pay", "OPD charges"],
  MX:  ["precio particular", "sin seguro", "pago directo", "honorarios"],
  TH:  ["package price", "cash price", "self-pay"],
  SG:  ["self-pay", "out of pocket", "subsidised", "private rate"],
  JP:  ["jifi", "jiyuu shinsatsu"],
  BR:  ["particular", "sem plano", "preco particular"],
  AE:  ["self-pay", "cash price", "private rate"],
  DEFAULT: ["self-pay price", "cash price", "out of pocket", "posted price"],
};

const COUNTRY_CURRENCY: Record<string, string> = {
  US: "USD", GB: "GBP", CA: "CAD", AU: "AUD",
  DE: "EUR", FR: "EUR", IN: "INR", MX: "MXN",
  TH: "THB", SG: "SGD", JP: "JPY", BR: "BRL",
  TR: "TRY", ZA: "ZAR", AE: "AED",
};

const SERPER_GL: Record<string, string> = {
  US: "us", GB: "gb", CA: "ca", AU: "au",
  DE: "de", FR: "fr", IN: "in", MX: "mx",
  TH: "th", SG: "sg", JP: "jp", BR: "br",
};

const PRICE_PATTERNS = [
  /\$\s*(\d[\d,]*(?:\.\d{1,2})?)/g,
  /USD\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,
  /\u00a3\s*(\d[\d,]*(?:\.\d{1,2})?)/g,
  /\u20ac\s*(\d[\d,]*(?:\.\d{1,2})?)/g,
  /\u20b9\s*(\d[\d,]*(?:\.\d{1,2})?)/g,
  /\u00a5\s*(\d[\d,]*(?:\.\d{1,2})?)/g,
  /CA\$\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,
  /AU\$\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,
  /MXN\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,
  /SGD\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,
  /THB\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,
  /price[:\s]+\$?(\d[\d,]*(?:\.\d{1,2})?)/gi,
  /cost[:\s]+\$?(\d[\d,]*(?:\.\d{1,2})?)/gi,
  /fee[:\s]+\$?(\d[\d,]*(?:\.\d{1,2})?)/gi,
];

const PRICE_TYPE_KEYWORDS: Record<string, string[]> = {
  self_pay:        ["self-pay", "self pay", "uninsured", "without insurance", "no insurance"],
  cash_pay:        ["cash pay", "cash price", "cash only", "cash rate", "pay cash"],
  discounted_cash: ["discounted cash", "cash discount", "prompt pay"],
  bundled:         ["package", "bundle", "all-inclusive"],
  fee_schedule:    ["fee schedule", "chargemaster", "standard charge", "price list"],
};

// ─── Layer 1: Surgical Query Engineering ─────────────────────────────────────
function buildSurgicalQuery(
  service: string,
  country: string,
  location?: string,
  engine: "google" | "neural" = "google"
): string {
  const priceTerms = COUNTRY_PRICE_TERMS[country] ?? COUNTRY_PRICE_TERMS.DEFAULT;
  const priceClause = `("${priceTerms[0]}" OR "${priceTerms[1]}")`;
  const locClause = location ? `"${location}" ` : "";
  const excludes = "-site:healthline.com -site:webmd.com -site:wikipedia.org -site:reddit.com -site:costhelper.com -site:goodrx.com -site:quora.com";

  if (engine === "neural") {
    return `${service} exact posted price ${priceTerms[0]} ${locClause}provider website`;
  }
  return `"${service}" ${locClause}${priceClause} ${excludes}`.trim();
}

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
    const host = new URL(url).hostname.replace(/^www\./, "");
    const base = host.split(".").slice(-2).join(".");
    return SKIP_DOMAINS.has(host) || SKIP_DOMAINS.has(base);
  } catch {
    return false;
  }
}

function hasPricingPath(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return PRICE_URL_SIGNALS.some(hint => path.includes(hint));
  } catch {
    return false;
  }
}

function detectCurrency(text: string, country: string): string {
  if (/\u00a3/.test(text)) return "GBP";
  if (/\u20ac/.test(text)) return "EUR";
  if (/\u20b9/.test(text)) return "INR";
  if (/\u00a5/.test(text)) return "JPY";
  if (/CA\$/i.test(text)) return "CAD";
  if (/AU\$/i.test(text)) return "AUD";
  if (/SGD/i.test(text)) return "SGD";
  if (/THB|baht/i.test(text)) return "THB";
  if (/MXN/i.test(text)) return "MXN";
  return COUNTRY_CURRENCY[country] ?? "USD";
}

function detectPriceType(text: string): ExtractedPrice["priceType"] {
  const lower = text.toLowerCase();
  for (const [type, keywords] of Object.entries(PRICE_TYPE_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
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
      if (val >= 5 && val <= 500_000) prices.push(val);
    }
  }
  return [...new Set(prices)];
}

function detectProviderType(text: string, url: string): string {
  const lower = (text + " " + url).toLowerCase();
  if (/dental|dentist|orthodon|periodon/.test(lower)) return "dental";
  if (/\blab\b|laboratory|diagnostic|patholog|quest diagnostics|labcorp/.test(lower)) return "lab";
  if (/imaging|radiol|mri\b|ct scan|x.?ray|ultrasound|mammogram/.test(lower)) return "imaging_center";
  if (/urgent care|walk.?in|minute clinic|fastmed|concentra/.test(lower)) return "urgent_care";
  if (/hospital|medical center|health system/.test(lower)) return "hospital";
  if (/telehealth|virtual|telemedicine|online consult/.test(lower)) return "telehealth";
  return "clinic";
}

function scoreSurgicalRelevance(hit: SearchHit, query: string): number {
  let score = 0.4;
  const lowerUrl = hit.url.toLowerCase();
  const lowerSnippet = hit.snippet.toLowerCase();
  const lowerQuery = query.toLowerCase();

  if (/\$\d|\u00a3\d|\u20ac\d|\u20b9\d/.test(hit.snippet)) score += 0.30;
  if (hasPricingPath(hit.url)) score += 0.20;
  if (/self.?pay|cash.?price|posted.?price|fee.?schedule/.test(lowerSnippet)) score += 0.15;
  if (hit.hasPageContent) score += 0.10;

  const queryWords = lowerQuery.split(/\s+/).filter(w => w.length > 3);
  const urlMatches = queryWords.filter(w => lowerUrl.includes(w)).length;
  score += urlMatches * 0.05;

  if (/blog|article|guide|news|learn|about|what-is|how-to/.test(lowerUrl)) score -= 0.20;
  if (/estimate|typical|average|range|about \$|around \$/.test(lowerSnippet)) score -= 0.15;
  if (/insurance|covered|copay|deductible/.test(lowerSnippet)) score -= 0.10;

  return Math.min(Math.max(score, 0.05), 1.0);
}

function extractProviderNameFromDomain(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").split(".")[0];
    return host.charAt(0).toUpperCase() + host.slice(1).replace(/-/g, " ");
  } catch {
    return "Unknown Provider";
  }
}

function extractCityFromText(text: string): string | undefined {
  const m = text.match(/\bin\s+([A-Z][a-z]+(?: [A-Z][a-z]+)?),\s*([A-Z]{2,})/);
  return m ? m[1] : undefined;
}

// ─── Layer 2a: Serper — Google Search with surgical boolean query ─────────────
async function searchSerper(query: string, country: string, location?: string): Promise<SearchHit[]> {
  if (!SERPER_API_KEY) {
    logger.warn("SERPER_API_KEY not set");
    return [];
  }
  const surgicalQuery = buildSurgicalQuery(query, country, location, "google");
  const gl = SERPER_GL[country] ?? "us";

  try {
    const res = await fetchWithTimeout("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: surgicalQuery, num: 10, gl }),
    });
    if (!res.ok) throw new Error(`Serper ${res.status}`);
    const data = await res.json() as { organic?: Array<{ link: string; title: string; snippet: string }> };
    logger.info({ engine: "serper", query: surgicalQuery, count: data.organic?.length }, "Serper results");
    return (data.organic ?? []).map(r => ({ url: r.link, title: r.title, snippet: r.snippet ?? "" }));
  } catch (err) {
    logger.warn({ err }, "Serper failed");
    return [];
  }
}

// ─── Layer 2b: Exa — Neural semantic search with inline content ───────────────
async function searchExa(query: string, country: string, location?: string): Promise<SearchHit[]> {
  if (!EXA_API_KEY) return [];
  const surgicalQuery = buildSurgicalQuery(query, country, location, "neural");

  try {
    const res = await fetchWithTimeout("https://api.exa.ai/search", {
      method: "POST",
      headers: { "x-api-key": EXA_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: surgicalQuery,
        numResults: 10,
        type: "neural",
        useAutoprompt: true,
        contents: {
          text: { maxCharacters: 3000 },
          highlights: { numSentences: 3, highlightsPerUrl: 2, query: `${query} price cost fee` },
        },
      }),
    });
    if (!res.ok) throw new Error(`Exa ${res.status}`);
    const data = await res.json() as {
      results?: Array<{ url: string; title: string; text?: string; highlights?: string[]; score?: number }>;
    };
    logger.info({ engine: "exa", count: data.results?.length }, "Exa results");
    return (data.results ?? []).map(r => {
      const pageContent = r.text ?? r.highlights?.join(" ") ?? "";
      return {
        url: r.url,
        title: r.title ?? "",
        snippet: r.highlights?.[0] ?? r.text?.slice(0, 200) ?? "",
        score: r.score,
        hasPageContent: pageContent.length > 100,
        pageContent,
      };
    });
  } catch (err) {
    logger.warn({ err }, "Exa failed");
    return [];
  }
}

// ─── Layer 3a: Tavily — Full page extraction (JS-rendered) ───────────────────
async function extractWithTavily(urls: string[], query: string): Promise<Array<{ url: string; content: string }>> {
  if (!TAVILY_API_KEY || urls.length === 0) return [];
  try {
    const res = await fetchWithTimeout("https://api.tavily.com/extract", {
      method: "POST",
      headers: { Authorization: `Bearer ${TAVILY_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ urls: urls.slice(0, 6) }),
    }, 20_000);
    if (!res.ok) throw new Error(`Tavily ${res.status}`);
    const data = await res.json() as { results?: Array<{ url: string; raw_content: string }> };
    return (data.results ?? []).map(r => ({ url: r.url, content: r.raw_content ?? "" }));
  } catch (err) {
    logger.warn({ err }, "Tavily extract failed");
    return [];
  }
}

// ─── Layer 3b: Jina Reader — Free fallback extractor ─────────────────────────
async function extractWithJina(url: string): Promise<string> {
  try {
    const headers: Record<string, string> = { "Accept": "text/plain" };
    if (JINA_API_KEY) headers["Authorization"] = `Bearer ${JINA_API_KEY}`;
    const res = await fetchWithTimeout(`https://r.jina.ai/${url}`, { headers }, 15_000);
    if (!res.ok) return "";
    return (await res.text()).slice(0, 8000);
  } catch {
    return "";
  }
}

// ─── Layer 4: LLM Adjudication — strict price extraction ─────────────────────
async function extractWithLLM(
  pageContent: string,
  serviceQuery: string,
  sourceUrl: string,
  country: string
): Promise<Partial<ExtractedPrice> | null> {
  const key = OPENROUTER_KEY ?? GROQ_API_KEY;
  if (!key) return null;

  const endpoint = OPENROUTER_KEY
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://api.groq.com/openai/v1/chat/completions";

  const model = OPENROUTER_KEY
    ? "meta-llama/llama-3.3-70b-instruct"
    : "llama-3.3-70b-versatile";

  const content = pageContent.slice(0, 6000);
  const currency = COUNTRY_CURRENCY[country] ?? "USD";

  const systemPrompt = `You are a medical price extraction specialist. Extract ONLY exact posted self-pay or cash prices from provider websites.

STRICT RULES:
1. ONLY extract if the price is explicitly posted on this specific provider page
2. REJECT: estimates, ranges like "$100-$200", national averages, insurance prices, copays, blog content, aggregator data
3. REJECT if not specifically for the queried service
4. Return valid JSON or the exact string "null" — no other output`;

  const userPrompt = `SERVICE SEARCHED: "${serviceQuery}"
SOURCE URL: ${sourceUrl}
COUNTRY: ${country}

PAGE CONTENT:
${content}

TASK: Find ONE exact posted ${country === "US" ? "self-pay/cash" : "out-of-pocket"} price for "${serviceQuery}" on this specific provider page.

RULES:
- exactPrice must be a single number, not a range
- If page lists multiple services, pick the one MOST relevant to "${serviceQuery}"
- If page shows no exact price, return null
- Never invent or estimate a price

If found, return ONLY this JSON (no extra text):
{"providerName":"exact name","city":"city or null","stateRegion":"2-letter state or null","country":"${country}","phone":"phone or null","normalizedService":"clean service name","billingCode":"CPT code or null","exactPrice":123.00,"currency":"${currency}","priceType":"self_pay","evidenceText":"exact quote from page showing this price","verificationStatus":"verified_exact_posted_price","confidenceScore":0.9}

Otherwise return exactly: null`;

  try {
    const res = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(OPENROUTER_KEY ? { "HTTP-Referer": "https://international-search.onrender.com" } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.0,
        max_tokens: 400,
        response_format: { type: "json_object" },
      }),
    }, 20_000);

    if (!res.ok) return null;
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw || raw === "null") return null;

    const parsed = JSON.parse(raw);
    if (!parsed?.exactPrice || parsed.exactPrice <= 0) return null;

    return {
      providerName: parsed.providerName,
      city: parsed.city,
      stateRegion: parsed.stateRegion,
      country: parsed.country ?? country,
      phone: parsed.phone,
      normalizedService: parsed.normalizedService ?? serviceQuery,
      billingCode: parsed.billingCode,
      exactPrice: Number(parsed.exactPrice),
      currency: parsed.currency ?? currency,
      priceType: parsed.priceType ?? "self_pay",
      evidenceText: parsed.evidenceText,
      verificationStatus: parsed.verificationStatus ?? "likely_exact_price_needs_review",
      confidenceScore: Math.min(Math.max(Number(parsed.confidenceScore ?? 0.7), 0), 1),
    };
  } catch (err) {
    logger.warn({ err, url: sourceUrl }, "LLM extraction failed");
    return null;
  }
}

// ─── Upsert provider + price ──────────────────────────────────────────────────
async function upsertResult(extracted: ExtractedPrice): Promise<void> {
  const websiteKey = extracted.website ?? extracted.sourceUrl;
  const [existing] = await db
    .select({ id: providersTable.id })
    .from(providersTable)
    .where(eq(providersTable.website, websiteKey))
    .limit(1);

  let providerId: number;
  if (existing) {
    providerId = existing.id;
  } else {
    const [prov] = await db.insert(providersTable).values({
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
      website: websiteKey,
    }).returning({ id: providersTable.id });
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
  const { query, country = "US", city } = params;
  const logPrefix = `[surgical] query="${query}" country="${country}"`;
  logger.info(logPrefix + " starting");

  // Layer 2: Parallel multi-engine search
  const [serperHits, exaHits] = await Promise.all([
    searchSerper(query, country, city),
    searchExa(query, country, city),
  ]);

  // Merge + deduplicate
  const allHitsMap = new Map<string, SearchHit>();
  for (const hit of [...serperHits, ...exaHits]) {
    if (!allHitsMap.has(hit.url)) allHitsMap.set(hit.url, hit);
  }

  // Surgical scoring + filter
  const scored = Array.from(allHitsMap.values())
    .filter(h => !shouldSkipDomain(h.url))
    .map(h => ({ hit: h, score: scoreSurgicalRelevance(h, query) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  logger.info({ count: scored.length, topUrls: scored.slice(0, 3).map(s => s.hit.url) }, logPrefix + " scored");

  // Layer 3: Extract content — use inline content from Exa where available
  const withContent: Array<{ url: string; content: string }> = [];
  const needsExtraction: string[] = [];

  for (const { hit } of scored) {
    if (hit.hasPageContent && (hit.pageContent?.length ?? 0) > 200) {
      withContent.push({ url: hit.url, content: hit.pageContent! });
    } else {
      needsExtraction.push(hit.url);
    }
  }

  const tavilyResults = await extractWithTavily(needsExtraction, query);
  const tavilyGot = new Set(tavilyResults.map(r => r.url));

  // Jina fallback for URLs Tavily missed
  const jinaUrls = needsExtraction.filter(url => !tavilyGot.has(url)).slice(0, 3);
  const jinaResults = (
    await Promise.all(jinaUrls.map(async url => {
      const content = await extractWithJina(url);
      return content.length > 100 ? { url, content } : null;
    }))
  ).filter((r): r is { url: string; content: string } => r !== null);

  const allPageContent = [...withContent, ...tavilyResults, ...jinaResults];

  // Layer 4: LLM adjudication
  const results: ExtractedPrice[] = [];
  for (const page of allPageContent) {
    try {
      // Fast pre-filter — no price pattern = skip LLM (saves tokens)
      const quickPrices = extractPricesFromText(page.content.slice(0, 3000));
      if (quickPrices.length === 0 && !hasPricingPath(page.url)) continue;

      const llmResult = await extractWithLLM(page.content, query, page.url, country);
      if (!llmResult?.exactPrice) continue;

      const providerType = detectProviderType(page.content.slice(0, 1000), page.url);
      const { hospitalOnly, clinicOnly, imagingOnly, labOnly, urgentCareOnly, dentalOnly, telehealthOnly, cashPayOnly } = params;

      if (hospitalOnly && providerType !== "hospital") continue;
      if (clinicOnly && providerType !== "clinic") continue;
      if (imagingOnly && providerType !== "imaging_center") continue;
      if (labOnly && providerType !== "lab") continue;
      if (urgentCareOnly && providerType !== "urgent_care") continue;
      if (dentalOnly && providerType !== "dental") continue;
      if (telehealthOnly && providerType !== "telehealth") continue;

      const priceType = llmResult.priceType ?? detectPriceType(page.content);
      if (cashPayOnly && !["self_pay", "cash_pay", "discounted_cash"].includes(priceType)) continue;

      const sourceType = page.url.endsWith(".pdf") ? "pdf_price_sheet"
        : /\.gov/.test(page.url) ? "cms_dataset"
        : "provider_website";

      const hitSnippet = scored.find(s => s.hit.url === page.url)?.hit.snippet ?? "";

      results.push({
        providerName: llmResult.providerName ?? extractProviderNameFromDomain(page.url),
        providerType,
        city: llmResult.city ?? extractCityFromText(hitSnippet),
        stateRegion: llmResult.stateRegion,
        country: llmResult.country ?? country,
        phone: llmResult.phone,
        website: page.url,
        serviceQuery: query,
        normalizedService: llmResult.normalizedService ?? query,
        billingCode: llmResult.billingCode,
        exactPrice: llmResult.exactPrice,
        currency: llmResult.currency ?? detectCurrency(page.content, country),
        priceType,
        evidenceText: llmResult.evidenceText,
        sourceUrl: page.url,
        sourceType,
        verificationStatus: llmResult.verificationStatus ?? "likely_exact_price_needs_review",
        confidenceScore: llmResult.confidenceScore ?? 0.7,
      });

      logger.info({ provider: results[results.length - 1].providerName, price: llmResult.exactPrice }, logPrefix + " extracted");
    } catch (err) {
      logger.warn({ err, url: page.url }, "Extraction error");
    }
  }

  // Layer 5: Persist
  let persisted = 0;
  for (const r of results) {
    try { await upsertResult(r); persisted++; } catch (err) { logger.warn({ err }, "Persist failed"); }
  }

  await db.insert(crawlLogsTable).values({
    connectorName: `surgical:${country}`,
    status: persisted > 0 ? "success" : "no_results",
    recordsIngested: persisted,
  });

  logger.info({ persisted, total: results.length, serper: serperHits.length, exa: exaHits.length }, logPrefix + " done");
}

