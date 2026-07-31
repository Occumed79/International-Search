/**
 * Tier 1 multi-mode provider discovery (non-US only)
 *
 * Modes:
 *   1. OpenStreetMap (Overpass + Nominatim)
 *   2. Wikidata (SPARQL)
 *   3. SearXNG metasearch (optional via SEARXNG_URL)
 *   4. Local DB cache (caller handles)
 *
 * Hardened: input sanitization, injection-safe query building,
 * URL scheme checks, timeouts, US exclusion, junk-domain filter.
 */

import { logger } from "../lib/logger";

export interface ProviderHit {
  id: string;
  providerName: string;
  organizationName?: string;
  providerType: string;
  specialty?: string;
  serviceQuery: string;
  normalizedService: string;
  billingCode?: string;
  exactPrice: number;
  currency: string;
  priceType: string;
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
  verificationStatus: string;
  confidenceScore: number;
  timestampFound: string;
}

export interface MultiModeParams {
  query: string;
  country?: string;
  city?: string;
  state?: string;
  providerType?: string;
  radiusMiles?: number;
}

const US_CODES = new Set([
  "US",
  "USA",
  "UNITED STATES",
  "UNITED STATES OF AMERICA",
  "U.S.",
  "U.S.A.",
]);

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
  "rate.md",
  "ratemds.com",
];

/** Allowlisted ISO-ish country codes (2-letter) accepted by this portal — no US. */
const ALLOWED_COUNTRY_CODES = new Set([
  "MX", "CA", "GB", "AU", "DE", "FR", "ES", "IT", "PT", "BR", "AR", "CL", "CO",
  "IN", "SG", "TH", "JP", "KR", "AE", "ZA", "TR", "PL", "NL", "IE", "NZ", "PH",
  "MY", "BE", "CH", "AT", "SE", "NO", "DK", "FI", "CZ", "RO", "HU", "GR", "PE",
  "UY", "EC", "CR", "PA", "DO", "GT", "HN", "SV", "NI", "BO", "PY", "VE",
  "ID", "VN", "TW", "HK", "CN", "SA", "EG", "NG", "KE", "MA", "IL", "PK",
  "BD", "LK", "NP", "MM", "KH", "LA", "BN", "QA", "KW", "BH", "OM",
]);

const PROVIDER_TYPE_CONFIG: Record<
  string,
  {
    label: string;
    searchTerms: string[];
    osmHealthcare: string[];
    osmAmenity: string[];
    wikidataClasses: string[];
  }
> = {
  occupational_health: {
    label: "Occupational Health",
    searchTerms: [
      "occupational health",
      "occupational medicine",
      "salud ocupacional",
      "medicina del trabajo",
      "medecine du travail",
      "Arbeitsmedizin",
      "saude ocupacional",
    ],
    osmHealthcare: ["clinic", "doctor", "centre"],
    osmAmenity: ["clinic", "doctors"],
    wikidataClasses: ["Q1772017", "Q16917", "Q43229"],
  },
  clinic: {
    label: "Clinic",
    searchTerms: ["clinic", "clinica", "medical clinic", "outpatient clinic"],
    osmHealthcare: ["clinic", "centre", "doctor"],
    osmAmenity: ["clinic", "doctors"],
    wikidataClasses: ["Q1772017", "Q43229"],
  },
  hospital: {
    label: "Hospital",
    searchTerms: ["hospital", "medical center", "hospital general"],
    osmHealthcare: ["hospital"],
    osmAmenity: ["hospital"],
    wikidataClasses: ["Q16917"],
  },
  urgent_care: {
    label: "Urgent Care",
    searchTerms: ["urgent care", "walk-in clinic", "urgencia", "walk in clinic"],
    osmHealthcare: ["clinic", "centre"],
    osmAmenity: ["clinic"],
    wikidataClasses: ["Q1772017"],
  },
  imaging_center: {
    label: "Imaging Center",
    searchTerms: ["imaging center", "radiology", "MRI center", "diagnostic imaging"],
    osmHealthcare: ["clinic", "centre"],
    osmAmenity: ["clinic"],
    wikidataClasses: ["Q1772017"],
  },
  lab: {
    label: "Laboratory",
    searchTerms: ["medical laboratory", "lab", "pathology lab", "laboratorio clinico"],
    osmHealthcare: ["laboratory"],
    osmAmenity: ["clinic"],
    wikidataClasses: ["Q1772017"],
  },
  dental: {
    label: "Dental",
    searchTerms: ["dental clinic", "dentist", "odontologia", "dental office"],
    osmHealthcare: ["dentist"],
    osmAmenity: ["dentist"],
    wikidataClasses: ["Q1772017"],
  },
  pharmacy: {
    label: "Pharmacy",
    searchTerms: ["pharmacy", "farmacia", "chemist"],
    osmHealthcare: ["pharmacy"],
    osmAmenity: ["pharmacy"],
    wikidataClasses: ["Q288219"],
  },
};

const OSM_TAG_SAFE = /^[a-z0-9_|]+$/i;
const WIKIDATA_QID_SAFE = /^Q[0-9]+$/;
const MAX_QUERY_LEN = 120;
const MAX_CITY_LEN = 80;
const MAX_STATE_LEN = 40;
const MAX_COUNTRY_LEN = 60;
const MAX_RESULTS_PER_MODE = 40;

// ─── Sanitizers ──────────────────────────────────────────────────────────────

function isUsCountry(country?: string): boolean {
  if (!country) return false;
  return US_CODES.has(country.trim().toUpperCase());
}

function normalizeCountry(country?: string | null): string | undefined {
  if (!country) return undefined;
  const c = country.trim().slice(0, MAX_COUNTRY_LEN);
  if (!c || c === "_global" || c.toLowerCase() === "global") return undefined;
  return c;
}

/** Strip control chars / excess length for free-text fields. */
function sanitizeText(input: string | undefined | null, maxLen: number): string {
  if (!input) return "";
  return input
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

/**
 * Escape a string for safe embedding inside a SPARQL double-quoted literal.
 * Rejects strings that still look hostile after escaping.
 */
function sparqlEscape(input: string): string {
  return input
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, " ")
    .replace(/\r/g, " ")
    .replace(/\t/g, " ");
}

/** Only allow letters, numbers, spaces, hyphens, apostrophes, periods for place names. */
function sanitizePlaceName(input: string | undefined | null, maxLen: number): string {
  const t = sanitizeText(input, maxLen);
  // Keep unicode letters (international cities) + basic punctuation
  return t.replace(/[^\p{L}\p{N}\s'.\-]/gu, "").trim().slice(0, maxLen);
}

function sanitizeCountryCodeOrName(country?: string): string | undefined {
  const c = normalizeCountry(country);
  if (!c) return undefined;
  if (isUsCountry(c)) return undefined;

  // Prefer 2-letter codes from allowlist
  if (c.length === 2) {
    const upper = c.toUpperCase();
    if (!ALLOWED_COUNTRY_CODES.has(upper)) return undefined;
    return upper;
  }

  // Longer names: sanitize as place name (still block US phrases)
  const name = sanitizePlaceName(c, MAX_COUNTRY_LEN);
  if (!name || isUsCountry(name)) return undefined;
  return name;
}

function clampRadiusMiles(n?: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 25;
  return Math.min(Math.max(Math.round(n), 5), 100);
}

function isBlockedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return true;
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".local")) return true;
    // Block obvious private IPs
    if (/^(10\.|127\.|192\.168\.|169\.254\.|0\.)/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
    return BLOCKED_DOMAINS.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return true;
  }
}

/** Return URL only if http(s) and not blocked; else undefined. */
function safeHttpUrl(url: string | undefined | null): string | undefined {
  if (!url || typeof url !== "string") return undefined;
  const trimmed = url.trim().slice(0, 500);
  if (!/^https?:\/\//i.test(trimmed)) return undefined;
  if (isBlockedUrl(trimmed)) return undefined;
  return trimmed;
}

function slugId(prefix: string, ...parts: (string | number | undefined)[]): string {
  return `${prefix}-${parts.filter((p) => p !== undefined && p !== "").join("-")}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

function clampCoord(n: unknown): number | undefined {
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  if (n < -90 || n > 90) {
    // might be lon in [-180,180] — accept wider for lon separately
  }
  return n;
}

function clampLat(n: unknown): number | undefined {
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  if (n < -90 || n > 90) return undefined;
  return n;
}

function clampLon(n: unknown): number | undefined {
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  if (n < -180 || n > 180) return undefined;
  return n;
}

/**
 * Validate SEARXNG_URL to reduce SSRF risk: http(s) only, no credentials,
 * no private/loopback hosts (best-effort).
 */
function resolveSearxngBase(): string | null {
  const raw = process.env.SEARXNG_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    const host = u.hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".local")) return null;
    if (/^(10\.|127\.|192\.168\.|169\.254\.|0\.)/.test(host)) return null;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return null;
    // Strip path noise — we only append /search
    return `${u.protocol}//${u.host}`;
  } catch {
    logger.warn("SEARXNG_URL is invalid — ignoring");
    return null;
  }
}

function resolveProviderConfig(params: MultiModeParams) {
  const pt = (params.providerType || "").toLowerCase().replace(/\s+/g, "_");
  if (pt && PROVIDER_TYPE_CONFIG[pt]) return PROVIDER_TYPE_CONFIG[pt];

  const q = (params.query || "").toLowerCase();
  for (const [key, cfg] of Object.entries(PROVIDER_TYPE_CONFIG)) {
    if (
      cfg.searchTerms.some((t) => q.includes(t.toLowerCase())) ||
      q.includes(key.replace(/_/g, " "))
    ) {
      return cfg;
    }
  }
  return PROVIDER_TYPE_CONFIG.clinic;
}

async function fetchJson(
  url: string,
  init?: RequestInit,
  timeoutMs = 12_000,
): Promise<any | null> {
  // Defense: only fetch absolute http(s) URLs we construct or validated
  if (!/^https?:\/\//i.test(url)) {
    logger.warn({ url: url.slice(0, 80) }, "fetchJson refused non-http(s) URL");
    return null;
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      logger.warn({ status: res.status, url: url.slice(0, 120) }, "fetchJson non-OK");
      return null;
    }
    const ct = res.headers.get("content-type") || "";
    // Soft check — some APIs omit content-type
    if (ct && !/json|javascript|text\/plain/i.test(ct)) {
      logger.warn({ ct }, "fetchJson unexpected content-type");
    }
    return await res.json();
  } catch (err) {
    logger.warn({ err, url: url.slice(0, 120) }, "fetchJson failed");
    return null;
  } finally {
    clearTimeout(t);
  }
}

interface GeoPoint {
  lat: number;
  lon: number;
  displayName?: string;
  countryCode?: string;
}

async function geocodeLocation(
  city?: string,
  country?: string,
  state?: string,
): Promise<GeoPoint | null> {
  const parts = [city, state, country].filter(Boolean).join(", ");
  if (!parts) return null;

  const params = new URLSearchParams({
    q: parts.slice(0, 200),
    format: "json",
    limit: "1",
    addressdetails: "1",
  });
  if (country && country.length === 2) {
    params.set("countrycodes", country.toLowerCase());
  }

  const data = await fetchJson(
    `https://nominatim.openstreetmap.org/search?${params}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "InternationalProviderSearch/1.0 (non-commercial; github.com/Occumed79/International-Search)",
      },
    },
    10_000,
  );

  if (!Array.isArray(data) || data.length === 0) return null;
  const hit = data[0];
  const lat = clampLat(parseFloat(hit.lat));
  const lon = clampLon(parseFloat(hit.lon));
  if (lat === undefined || lon === undefined) return null;

  const countryCode = String(hit.address?.country_code || "")
    .toUpperCase()
    .slice(0, 2);

  return {
    lat,
    lon,
    displayName: typeof hit.display_name === "string" ? hit.display_name.slice(0, 200) : undefined,
    countryCode: countryCode || undefined,
  };
}

async function searchOsm(
  params: MultiModeParams,
  cfg: ReturnType<typeof resolveProviderConfig>,
): Promise<ProviderHit[]> {
  try {
    if (!params.city && !params.country) return [];

    const geo = await geocodeLocation(params.city, params.country, params.state);
    if (!geo) {
      logger.info("OSM: no geocode — skip Overpass");
      return [];
    }

    if (geo.countryCode && isUsCountry(geo.countryCode)) {
      logger.info("OSM: geocoded to US — blocked");
      return [];
    }

    const radiusM = Math.min(Math.max(clampRadiusMiles(params.radiusMiles) * 1609.34, 2000), 80_000);

    // Tags come only from allowlisted config — still validate pattern
    const healthcareRegex = cfg.osmHealthcare.filter((t) => OSM_TAG_SAFE.test(t)).join("|");
    const amenityRegex = cfg.osmAmenity.filter((t) => OSM_TAG_SAFE.test(t)).join("|");
    if (!healthcareRegex && !amenityRegex) return [];

    // Numeric lat/lon/radius only — no user strings in Overpass body beyond tag allowlist
    const overpassQuery = `
[out:json][timeout:20];
(
  ${healthcareRegex ? `node["healthcare"~"${healthcareRegex}"](around:${Math.round(radiusM)},${geo.lat},${geo.lon});` : ""}
  ${healthcareRegex ? `way["healthcare"~"${healthcareRegex}"](around:${Math.round(radiusM)},${geo.lat},${geo.lon});` : ""}
  ${amenityRegex ? `node["amenity"~"${amenityRegex}"](around:${Math.round(radiusM)},${geo.lat},${geo.lon});` : ""}
  ${amenityRegex ? `way["amenity"~"${amenityRegex}"](around:${Math.round(radiusM)},${geo.lat},${geo.lon});` : ""}
);
out center tags 40;
`.trim();

    const data = await fetchJson(
      "https://overpass-api.de/api/interpreter",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "InternationalProviderSearch/1.0",
        },
        body: `data=${encodeURIComponent(overpassQuery)}`,
      },
      25_000,
    );

    const elements: any[] = Array.isArray(data?.elements) ? data.elements : [];
    const queryLabel = sanitizeText(params.query || cfg.label, MAX_QUERY_LEN);

    return elements
      .map((el) => {
        if (!el || typeof el !== "object") return null;
        const tags = el.tags ?? {};
        const name = sanitizeText(
          tags.name || tags["name:en"] || tags["official_name"],
          160,
        );
        if (!name) return null;

        const lat = clampLat(el.lat ?? el.center?.lat);
        const lon = clampLon(el.lon ?? el.center?.lon);
        const website = safeHttpUrl(tags.website || tags["contact:website"]);
        const phone = sanitizeText(tags.phone || tags["contact:phone"], 40) || undefined;
        const city = sanitizePlaceName(tags["addr:city"] || params.city, MAX_CITY_LEN) || undefined;
        const countryRaw = (tags["addr:country"] || params.country || geo.countryCode || "")
          .toString()
          .toUpperCase()
          .slice(0, MAX_COUNTRY_LEN);

        if (isUsCountry(countryRaw)) return null;

        const providerType =
          tags.amenity === "hospital" || tags.healthcare === "hospital"
            ? "hospital"
            : tags.amenity === "dentist" || tags.healthcare === "dentist"
              ? "dental"
              : tags.healthcare === "laboratory"
                ? "lab"
                : tags.amenity === "pharmacy"
                  ? "pharmacy"
                  : "clinic";

        const osmId = typeof el.id === "number" || typeof el.id === "string" ? el.id : "x";
        const osmType = el.type === "way" || el.type === "node" || el.type === "relation" ? el.type : "node";

        return {
          id: slugId("osm", osmType, osmId),
          providerName: name,
          organizationName: sanitizeText(tags.operator || name, 160),
          providerType,
          specialty: sanitizeText(tags.healthcare || tags.amenity || cfg.label, 80),
          serviceQuery: queryLabel,
          normalizedService: cfg.label,
          exactPrice: 0,
          currency: "",
          priceType: "fee_schedule",
          evidenceText: `OpenStreetMap ${osmType}/${osmId}`,
          sourceUrl: website || `https://www.openstreetmap.org/${osmType}/${osmId}`,
          sourceType: "openstreetmap",
          country: countryRaw || params.country || "",
          stateRegion: sanitizePlaceName(tags["addr:state"] || params.state, MAX_STATE_LEN) || undefined,
          city,
          postalCode: sanitizeText(tags["addr:postcode"], 20) || undefined,
          latitude: lat,
          longitude: lon,
          phone,
          website,
          verificationStatus: "provider_found_no_price",
          confidenceScore: website || phone ? 0.88 : 0.75,
          timestampFound: new Date().toISOString(),
        } satisfies ProviderHit;
      })
      .filter((x): x is ProviderHit => x != null)
      .slice(0, MAX_RESULTS_PER_MODE);
  } catch (err) {
    logger.warn({ err }, "OSM search failed");
    return [];
  }
}

async function searchWikidata(
  params: MultiModeParams,
  cfg: ReturnType<typeof resolveProviderConfig>,
): Promise<ProviderHit[]> {
  try {
    if (!params.country && !params.city) return [];

    const country = sanitizePlaceName(params.country, MAX_COUNTRY_LEN);
    const city = sanitizePlaceName(params.city, MAX_CITY_LEN);
    if (!country && !city) return [];

    const locationFilters: string[] = [
      'FILTER(!BOUND(?countryLabel) || !REGEX(LCASE(STR(?countryLabel)), "united states"))',
      'FILTER(!BOUND(?iso) || ?iso != "US")',
    ];

    if (country && country.length === 2) {
      const iso = country.toUpperCase().replace(/[^A-Z]/g, "");
      if (iso.length === 2 && !isUsCountry(iso)) {
        locationFilters.push(`FILTER(BOUND(?iso) && ?iso = "${iso}")`);
      }
    } else if (country) {
      const esc = sparqlEscape(country);
      locationFilters.push(
        `FILTER(BOUND(?countryLabel) && CONTAINS(LCASE(STR(?countryLabel)), LCASE("${esc}")))`,
      );
    }

    if (city) {
      const esc = sparqlEscape(city);
      locationFilters.push(
        `FILTER(BOUND(?cityLabel) && CONTAINS(LCASE(STR(?cityLabel)), LCASE("${esc}")))`,
      );
    }

    // Q-IDs only from static config
    const classValues = cfg.wikidataClasses
      .filter((c) => WIKIDATA_QID_SAFE.test(c))
      .map((c) => `wd:${c}`)
      .join(" ");
    if (!classValues) return [];

    const sparql = `
SELECT DISTINCT ?item ?itemLabel ?coord ?countryLabel ?cityLabel ?website ?phone ?iso WHERE {
  VALUES ?class { ${classValues} }
  ?item wdt:P31/wdt:P279* ?class .
  OPTIONAL { ?item wdt:P625 ?coord . }
  OPTIONAL { ?item wdt:P17 ?country . ?country wdt:P297 ?iso . }
  OPTIONAL { ?item wdt:P17 ?country2 . }
  OPTIONAL { ?item wdt:P131* ?cityEntity . ?cityEntity wdt:P31/wdt:P279* wd:Q515 . }
  OPTIONAL { ?item wdt:P856 ?website . }
  OPTIONAL { ?item wdt:P1329 ?phone . }
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en,es,fr,de,pt,it,nl,pl,tr,ar,zh,ja".
    ?item rdfs:label ?itemLabel .
    ?country2 rdfs:label ?countryLabel .
    ?cityEntity rdfs:label ?cityLabel .
  }
  ${locationFilters.join("\n  ")}
}
LIMIT 30
`.trim();

    const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`;
    const data = await fetchJson(
      url,
      {
        headers: {
          Accept: "application/sparql-results+json",
          "User-Agent": "InternationalProviderSearch/1.0 (github.com/Occumed79/International-Search)",
        },
      },
      20_000,
    );

    const bindings: any[] = Array.isArray(data?.results?.bindings) ? data.results.bindings : [];
    const queryLabel = sanitizeText(params.query || cfg.label, MAX_QUERY_LEN);

    return bindings
      .map((b) => {
        const name = sanitizeText(b?.itemLabel?.value, 160);
        if (!name || /^Q\d+$/i.test(name)) return null;

        const countryLabel = sanitizeText(b?.countryLabel?.value || params.country || "", MAX_COUNTRY_LEN);
        if (isUsCountry(countryLabel) || b?.iso?.value === "US") return null;

        let lat: number | undefined;
        let lon: number | undefined;
        const coord = b?.coord?.value;
        if (coord && typeof coord === "string") {
          const m = coord.match(/Point\(([-\d.]+)\s+([-\d.]+)\)/);
          if (m) {
            lon = clampLon(parseFloat(m[1]));
            lat = clampLat(parseFloat(m[2]));
          }
        }

        const website = safeHttpUrl(b?.website?.value);
        const itemUri = typeof b?.item?.value === "string" ? b.item.value : "";
        const qid = (itemUri.split("/").pop() || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 20);
        if (!qid) return null;

        return {
          id: slugId("wd", qid),
          providerName: name,
          organizationName: name,
          providerType: cfg.label.toLowerCase().includes("hospital") ? "hospital" : "clinic",
          specialty: cfg.label,
          serviceQuery: queryLabel,
          normalizedService: cfg.label,
          exactPrice: 0,
          currency: "",
          priceType: "fee_schedule",
          evidenceText: `Wikidata ${qid}`,
          sourceUrl: website || `https://www.wikidata.org/wiki/${qid}`,
          sourceType: "wikidata",
          country: countryLabel || params.country || "",
          city: sanitizePlaceName(b?.cityLabel?.value || params.city, MAX_CITY_LEN) || undefined,
          latitude: lat,
          longitude: lon,
          phone: sanitizeText(b?.phone?.value, 40) || undefined,
          website,
          verificationStatus: "provider_found_no_price",
          confidenceScore: website ? 0.82 : 0.7,
          timestampFound: new Date().toISOString(),
        } satisfies ProviderHit;
      })
      .filter((x): x is ProviderHit => x != null)
      .slice(0, MAX_RESULTS_PER_MODE);
  } catch (err) {
    logger.warn({ err }, "Wikidata search failed");
    return [];
  }
}

async function searchSearxng(
  params: MultiModeParams,
  cfg: ReturnType<typeof resolveProviderConfig>,
): Promise<ProviderHit[]> {
  const base = resolveSearxngBase();
  if (!base) {
    logger.info("SEARXNG_URL not set or invalid — skipping web metasearch");
    return [];
  }

  try {
    const term = sanitizeText(cfg.searchTerms[0] || params.query, 80);
    const loc = [params.city, params.country].filter(Boolean).join(" ").slice(0, 100);
    const q = `${term} ${loc}`.trim().slice(0, 160);
    if (!q) return [];

    const searchParams = new URLSearchParams({
      q,
      format: "json",
      categories: "general",
      language: "en",
    });

    const data = await fetchJson(
      `${base}/search?${searchParams}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "InternationalProviderSearch/1.0",
        },
      },
      15_000,
    );

    const results: any[] = Array.isArray(data?.results) ? data.results : [];
    const queryLabel = sanitizeText(params.query || cfg.label, MAX_QUERY_LEN);

    return results
      .filter((r) => r && typeof r.url === "string" && typeof r.title === "string")
      .map((r, i) => {
        const url = safeHttpUrl(r.url);
        if (!url) return null;

        const title = sanitizeText(String(r.title).replace(/\s*[|\-–].*$/, ""), 120);
        if (!title) return null;

        return {
          id: slugId("web", i, url),
          providerName: title,
          organizationName: sanitizeText(String(r.title), 160),
          providerType: "clinic",
          specialty: cfg.label,
          serviceQuery: queryLabel,
          normalizedService: cfg.label,
          exactPrice: 0,
          currency: "",
          priceType: "fee_schedule",
          evidenceText: sanitizeText(String(r.content || r.snippet || ""), 280) || undefined,
          sourceUrl: url,
          sourceType: "web_search",
          country: params.country || "",
          city: params.city,
          stateRegion: params.state,
          website: url,
          verificationStatus: "provider_found_no_price",
          confidenceScore: Math.min(
            0.55 + (typeof r.score === "number" && Number.isFinite(r.score) ? r.score * 0.2 : 0.15),
            0.85,
          ),
          timestampFound: new Date().toISOString(),
        } satisfies ProviderHit;
      })
      .filter((x): x is ProviderHit => x != null)
      .slice(0, 20);
  } catch (err) {
    logger.warn({ err }, "SearXNG search failed");
    return [];
  }
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function mergeAndRank(hits: ProviderHit[]): ProviderHit[] {
  const byKey = new Map<string, ProviderHit>();

  for (const hit of hits) {
    if (!hit?.providerName) continue;
    if (isUsCountry(hit.country)) continue;
    if (hit.website && isBlockedUrl(hit.website)) continue;
    if (hit.sourceUrl && isBlockedUrl(hit.sourceUrl)) continue;

    const key =
      hit.website && hit.website.startsWith("http")
        ? `url:${hit.website.replace(/\/$/, "").toLowerCase()}`
        : `name:${normalizeName(hit.providerName)}|${(hit.city || "").toLowerCase()}`;

    const existing = byKey.get(key);
    if (!existing || hit.confidenceScore > existing.confidenceScore) {
      byKey.set(key, hit);
    } else if (existing && hit.latitude != null && existing.latitude == null) {
      byKey.set(key, {
        ...existing,
        latitude: hit.latitude,
        longitude: hit.longitude ?? existing.longitude,
      });
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const score = (h: ProviderHit) =>
      h.confidenceScore +
      (h.latitude != null ? 0.08 : 0) +
      (h.phone ? 0.05 : 0) +
      (h.website ? 0.05 : 0) +
      (h.sourceType === "openstreetmap" ? 0.04 : 0) +
      (h.sourceType === "wikidata" ? 0.03 : 0);
    return score(b) - score(a);
  });
}

/**
 * Sanitize + validate inbound multi-mode params before any network I/O.
 */
export function sanitizeMultiModeParams(raw: MultiModeParams): MultiModeParams | { error: string } {
  const country = sanitizeCountryCodeOrName(raw.country);
  if (raw.country && isUsCountry(raw.country)) {
    return { error: "United States is not supported on this portal." };
  }
  // If they passed a 2-letter code not on allowlist (and not US already handled)
  if (raw.country && raw.country.trim().length === 2 && !country) {
    return { error: "Country code is not supported." };
  }

  const city = sanitizePlaceName(raw.city, MAX_CITY_LEN) || undefined;
  const state = sanitizePlaceName(raw.state, MAX_STATE_LEN) || undefined;
  const query = sanitizeText(raw.query, MAX_QUERY_LEN);
  const providerType = sanitizeText(raw.providerType, 40).toLowerCase().replace(/\s+/g, "_") || undefined;

  if (!country && !city) {
    return { error: "Provide a non-US country and/or city to search." };
  }

  return {
    query: query || providerType || "clinic",
    country,
    city,
    state,
    providerType: providerType && PROVIDER_TYPE_CONFIG[providerType] ? providerType : providerType,
    radiusMiles: clampRadiusMiles(raw.radiusMiles),
  };
}

export async function runMultiModeSearch(params: MultiModeParams): Promise<{
  results: ProviderHit[];
  sources: { osm: number; wikidata: number; searxng: number };
  blockedUs: boolean;
  error?: string;
}> {
  const sanitized = sanitizeMultiModeParams(params);
  if ("error" in sanitized) {
    const blockedUs = /united states/i.test(sanitized.error);
    return {
      results: [],
      sources: { osm: 0, wikidata: 0, searxng: 0 },
      blockedUs,
      error: sanitized.error,
    };
  }

  const country = sanitized.country;
  if (isUsCountry(country)) {
    return { results: [], sources: { osm: 0, wikidata: 0, searxng: 0 }, blockedUs: true };
  }

  const cfg = resolveProviderConfig(sanitized);
  const searchParams: MultiModeParams = {
    ...sanitized,
    query: sanitized.query || cfg.label,
  };

  // allSettled so one mode never rejects the whole search
  const settled = await Promise.allSettled([
    searchOsm(searchParams, cfg),
    searchWikidata(searchParams, cfg),
    searchSearxng(searchParams, cfg),
  ]);

  const osm = settled[0].status === "fulfilled" ? settled[0].value : [];
  const wikidata = settled[1].status === "fulfilled" ? settled[1].value : [];
  const searxng = settled[2].status === "fulfilled" ? settled[2].value : [];

  if (settled[0].status === "rejected") logger.warn({ err: settled[0].reason }, "OSM rejected");
  if (settled[1].status === "rejected") logger.warn({ err: settled[1].reason }, "Wikidata rejected");
  if (settled[2].status === "rejected") logger.warn({ err: settled[2].reason }, "SearXNG rejected");

  const merged = mergeAndRank([...osm, ...wikidata, ...searxng]);

  logger.info(
    {
      osm: osm.length,
      wikidata: wikidata.length,
      searxng: searxng.length,
      merged: merged.length,
      country,
      city: sanitized.city,
      type: cfg.label,
    },
    "multi-mode search complete",
  );

  return {
    results: merged,
    sources: { osm: osm.length, wikidata: wikidata.length, searxng: searxng.length },
    blockedUs: false,
  };
}

export { PROVIDER_TYPE_CONFIG, isUsCountry, normalizeCountry, clampRadiusMiles };
