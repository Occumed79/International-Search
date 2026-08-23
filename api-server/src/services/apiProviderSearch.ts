import { logger } from "../lib/logger";
import type { MultiModeParams, ProviderHit } from "./multiModeSearch";

export interface ApiProviderSearchSources {
  keenable: number;
  tinyfish: number;
  exa: number;
}

interface RawSearchHit {
  url: string;
  title: string;
  snippet: string;
  source: "keenable" | "tinyfish" | "exa_fallback";
  content?: string;
}

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESULTS = 40;
const MIN_PRIMARY_RESULTS = 5;

const BLOCKED_DOMAINS = [
  "yelp.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "healthgrades.com",
  "vitals.com",
  "webmd.com",
  "healthline.com",
  "wikipedia.org",
  "reddit.com",
  "quora.com",
  "youtube.com",
  "linkedin.com",
  "pinterest.com",
  "tiktok.com",
  "tripadvisor.com",
  "yellowpages.com",
  "bbb.org",
  "craigslist.org",
  "indeed.com",
  "glassdoor.com",
  "zocdoc.com",
  "ratemds.com",
];

function clean(value: unknown, max = 2_000): string {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalizeUrl(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return null;
    if (BLOCKED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function hashId(prefix: string, value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(16)}`;
}

function providerTypeFromParams(params: MultiModeParams): string {
  const explicit = clean(params.providerType, 40).toLowerCase().replace(/\s+/g, "_");
  if (explicit) return explicit;
  const q = clean(params.query, 120).toLowerCase();
  if (/occupational|workplace|employee health/.test(q)) return "occupational_health";
  if (/hospital/.test(q)) return "hospital";
  if (/urgent care|walk.?in/.test(q)) return "urgent_care";
  if (/imaging|radiology|mri|x.?ray|ultrasound/.test(q)) return "imaging_center";
  if (/\blab\b|laboratory|pathology/.test(q)) return "lab";
  if (/dental|dentist/.test(q)) return "dental";
  if (/pharmacy|chemist/.test(q)) return "pharmacy";
  return "clinic";
}

function buildQuery(params: MultiModeParams): string {
  const providerType = providerTypeFromParams(params).replace(/_/g, " ");
  const location = [params.city, params.state, params.country].filter(Boolean).join(", ");
  const requested = clean(params.query, 120) || providerType;
  return `${requested} ${providerType} ${location} medical provider clinic address`.replace(/\s+/g, " ").trim();
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response (${response.status})`);
  }
}

async function searchKeenable(query: string): Promise<RawSearchHit[]> {
  const key = process.env.KEENABLE_API_KEY?.trim();
  const endpoint = key
    ? "https://api.keenable.ai/v1/search"
    : "https://api.keenable.ai/v1/search/public";

  try {
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Keenable-Title": "Occu-Med International Search",
        ...(key ? { "X-API-Key": key } : {}),
      },
      body: JSON.stringify({
        query,
        max_results: 20,
        snippet_max_length: 1_500,
      }),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(clean(payload?.detail || payload?.message || payload?.error, 240) || `HTTP ${response.status}`);
    }

    const rows = Array.isArray(payload?.results) ? payload.results : [];
    return rows.flatMap((row: any) => {
      const url = normalizeUrl(row?.url || row?.link);
      if (!url) return [];
      return [{
        url,
        title: clean(row?.title || row?.name || new URL(url).hostname, 300),
        snippet: clean(row?.snippet || row?.description || row?.summary, 1_500),
        source: "keenable" as const,
      }];
    });
  } catch (err) {
    logger.warn({ err }, "Keenable provider search failed");
    return [];
  }
}

async function fetchTinyFishContent(urls: string[]): Promise<Map<string, string>> {
  const key = process.env.TINYFISH_API_KEY?.trim();
  if (!key || urls.length === 0) return new Map();

  try {
    const response = await fetchWithTimeout("https://api.fetch.tinyfish.ai", {
      method: "POST",
      headers: {
        "X-API-Key": key,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ urls: urls.slice(0, 8), format: "markdown" }),
    }, 20_000);
    const payload = await readJson(response);
    if (!response.ok) return new Map();

    const output = new Map<string, string>();
    for (const row of Array.isArray(payload?.results) ? payload.results : []) {
      const url = normalizeUrl(row?.url);
      if (!url) continue;
      const text = clean(row?.text || row?.markdown || row?.content, 4_000);
      if (text) output.set(url.replace(/\/$/, "").toLowerCase(), text);
    }
    return output;
  } catch (err) {
    logger.warn({ err }, "TinyFish fetch enrichment failed");
    return new Map();
  }
}

async function searchTinyFish(query: string): Promise<RawSearchHit[]> {
  const key = process.env.TINYFISH_API_KEY?.trim();
  if (!key) {
    logger.warn("TINYFISH_API_KEY not set — TinyFish primary search skipped");
    return [];
  }

  try {
    const url = new URL("https://api.search.tinyfish.ai");
    url.searchParams.set("query", query);
    const response = await fetchWithTimeout(url.toString(), {
      headers: { "X-API-Key": key, Accept: "application/json" },
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(clean(payload?.message || payload?.error || payload?.detail, 240) || `HTTP ${response.status}`);
    }

    const rows = (Array.isArray(payload?.results) ? payload.results : []).slice(0, 20);
    const base = rows.flatMap((row: any) => {
      const resultUrl = normalizeUrl(row?.url || row?.link);
      if (!resultUrl) return [];
      return [{
        url: resultUrl,
        title: clean(row?.title || row?.site_name || new URL(resultUrl).hostname, 300),
        snippet: clean(row?.snippet || row?.description, 1_500),
        source: "tinyfish" as const,
      }];
    });

    const fetched = await fetchTinyFishContent(base.map((item) => item.url));
    return base.map((item) => ({
      ...item,
      content: fetched.get(item.url.replace(/\/$/, "").toLowerCase()),
    }));
  } catch (err) {
    logger.warn({ err }, "TinyFish provider search failed");
    return [];
  }
}

async function searchExaFallback(query: string): Promise<RawSearchHit[]> {
  const key = process.env.EXA_API_KEY?.trim();
  if (!key) return [];

  try {
    const response = await fetchWithTimeout("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query,
        numResults: 12,
        type: "auto",
        contents: { text: { maxCharacters: 1_800 } },
      }),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(clean(payload?.message || payload?.error, 240) || `HTTP ${response.status}`);
    }

    return (Array.isArray(payload?.results) ? payload.results : []).flatMap((row: any) => {
      const url = normalizeUrl(row?.url);
      if (!url) return [];
      const content = clean(row?.text || row?.highlights?.join(" "), 4_000);
      return [{
        url,
        title: clean(row?.title || new URL(url).hostname, 300),
        snippet: clean(row?.highlights?.[0] || row?.text || row?.description, 1_500),
        content: content || undefined,
        source: "exa_fallback" as const,
      }];
    });
  } catch (err) {
    logger.warn({ err }, "Exa fallback provider search failed");
    return [];
  }
}

function providerNameFromTitle(title: string, url: string): string {
  const cleaned = clean(title, 180)
    .replace(/\s+[|·]\s+.*$/, "")
    .replace(/\s+[–—]\s+.*$/, "")
    .trim();
  if (cleaned && cleaned.length >= 2) return cleaned;
  return new URL(url).hostname.replace(/^www\./, "").split(".")[0].replace(/[-_]+/g, " ");
}

function extractPhone(text: string): string | undefined {
  const match = text.match(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]\d{3,4}/);
  return match ? clean(match[0], 40) : undefined;
}

function toProviderHit(hit: RawSearchHit, params: MultiModeParams): ProviderHit {
  const providerName = providerNameFromTitle(hit.title, hit.url);
  const content = hit.content || hit.snippet;
  const sourceConfidence = hit.source === "tinyfish" ? 0.88 : hit.source === "keenable" ? 0.86 : 0.72;
  const providerType = providerTypeFromParams(params);
  return {
    id: hashId(hit.source, hit.url),
    providerName,
    organizationName: providerName,
    providerType,
    specialty: clean(params.query || providerType.replace(/_/g, " "), 100),
    serviceQuery: clean(params.query || providerType, 120),
    normalizedService: providerType.replace(/_/g, " "),
    exactPrice: 0,
    currency: "",
    priceType: "fee_schedule",
    evidenceText: clean(content, 600) || undefined,
    sourceUrl: hit.url,
    sourceType: hit.source,
    country: clean(params.country, 60),
    stateRegion: clean(params.state, 60) || undefined,
    city: clean(params.city, 80) || undefined,
    phone: extractPhone(content),
    website: hit.url,
    verificationStatus: "provider_found_no_price",
    confidenceScore: sourceConfidence,
    timestampFound: new Date().toISOString(),
  };
}

function dedupeRaw(hits: RawSearchHit[]): RawSearchHit[] {
  const seen = new Set<string>();
  const result: RawSearchHit[] = [];
  for (const hit of hits) {
    const key = hit.url.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(hit);
  }
  return result;
}

export async function runApiProviderSearch(params: MultiModeParams): Promise<{
  results: ProviderHit[];
  sources: ApiProviderSearchSources;
  fallbackUsed: boolean;
}> {
  const query = buildQuery(params);
  const [keenable, tinyfish] = await Promise.all([
    searchKeenable(query),
    searchTinyFish(query),
  ]);

  const primary = dedupeRaw([...tinyfish, ...keenable]);
  let exa: RawSearchHit[] = [];
  let fallbackUsed = false;

  if (primary.length < MIN_PRIMARY_RESULTS) {
    fallbackUsed = true;
    logger.info({ primary: primary.length }, "Primary API coverage low — invoking Exa fallback");
    exa = await searchExaFallback(query);
  }

  const merged = dedupeRaw([...primary, ...exa])
    .slice(0, MAX_RESULTS)
    .map((hit) => toProviderHit(hit, params));

  logger.info({
    keenable: keenable.length,
    tinyfish: tinyfish.length,
    exa: exa.length,
    fallbackUsed,
    merged: merged.length,
  }, "API provider search complete");

  return {
    results: merged,
    sources: {
      keenable: keenable.length,
      tinyfish: tinyfish.length,
      exa: exa.length,
    },
    fallbackUsed,
  };
}
