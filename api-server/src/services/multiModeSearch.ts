/**
 * Tier 1 multi-mode provider discovery (non-US only)
 *
 * Modes:
 *   1. OpenStreetMap (Overpass + Nominatim)
 *   2. Wikidata (SPARQL)
 *   3. SearXNG metasearch (optional via SEARXNG_URL)
 *   4. Local DB cache (caller handles)
 *
 * All modes run in parallel; results are filtered, deduped, and ranked.
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

const US_CODES = new Set(["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"]);

const BLOCKED_DOMAINS = [
  "yelp.com", "facebook.com", "twitter.com", "x.com", "instagram.com",
  "healthgrades.com", "vitals.com", "webmd.com", "healthline.com",
  "wikipedia.org", "reddit.com", "quora.com", "youtube.com",
  "linkedin.com", "pinterest.com", "tiktok.com", "tripadvisor.com",
  "yellowpages.com", "bbb.org", "craigslist.org", "indeed.com",
];

/** Map UI provider types → search terms + OSM tags */
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
      "m\u00e9decine du travail",
      "Arbeitsmedizin",
      "sa\u00fade ocupacional",
    ],
    osmHealthcare: ["clinic", "doctor", "centre"],
    osmAmenity: ["clinic", "doctors"],
    wikidataClasses: ["Q1772017", "Q16917", "Q43229"], // occupational medicine, clinic, organization
  },
  clinic: {
    label: "Clinic",
    searchTerms: ["clinic", "cl\u00ednica", "medical clinic", "outpatient clinic"],
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
    searchTerms: ["medical laboratory", "lab", "pathology lab", "laboratorio cl\u00ednico"],
    osmHealthcare: ["laboratory"],
    osmAmenity: ["clinic"],
    wikidataClasses: ["Q1772017"],
  },
  dental: {
    label: "Dental",
    searchTerms: ["dental clinic", "dentist", "odontolog\u00eda", "dental office"],
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

function isUsCountry(country?: string): boolean {
  if (!country) return false;
  return US_CODES.has(country.trim().toUpperCase());
}

function normalizeCountry(country?: string | null): string | undefined {
  if (!country) return undefined;
  const c = country.trim();
  if (!c || c === "_global" || c.toLowerCase() === "global") return undefined;
  return c;
}

function resolveProviderConfig(params: MultiModeParams) {
  const pt = (params.providerType || "").toLowerCase().replace(/\s+/g, "_");
  if (pt && PROVIDER_TYPE_CONFIG[pt]) return PROVIDER_TYPE_CONFIG[pt];

  // Infer from free-text query
  const q = params.query.toLowerCase();
  for (const [key, cfg] of Object.entries(PROVIDER_TYPE_CONFIG)) {
    if (cfg.searchTerms.some((t) => q.includes(t.toLowerCase())) || q.includes(key.replace(/_/g, " "))) {
      return cfg;
    }
  }
  return PROVIDER_TYPE_CONFIG.clinic;
}

function isBlockedUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return BLOCKED_DOMAINS.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return false;
  }
}

function slugId(prefix: string, ...parts: (string | number | undefined)[]): string {
  return `${prefix}-${parts.filter(Boolean).join("-")}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 12_000): Promise<any | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    logger.warn({ err, url: url.slice(0, 120) }, "fetchJson failed");
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ─── Geocode via Nominatim (OSM) ─────────────────────────────────────────────

interface GeoPoint {
  lat: number;
  lon: number;
  displayName?: string;
  countryCode?: string;
}

async function geocodeLocation(city?: string, country?: string, state?: string): Promise<GeoPoint | null> {
  const parts = [city, state, country].filter(Boolean).join(", ");
  if (!parts) return null;

  const params = new URLSearchParams({
    q: parts,
    format: "json",
    limit: "1",
    addressdetails: "1",
  });
  if (country && country.length === 2) params.set("countrycodes", country.toLowerCase());

  const data = await fetchJson(
    `https://nominatim.openstreetmap.org/search?${params}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "InternationalProviderSearch/1.0 (non-commercial; contact@example.com)",
      },
    },
    10_000,
  );

  if (!Array.isArray(data) || data.length === 0) return null;
  const hit = data[0];
  const lat = parseFloat(hit.lat);
  const lon = parseFloat(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  return {
    lat,
    lon,
    displayName: hit.display_name,
    countryCode: hit.address?.country_code?.toUpperCase(),
  };
}

// ─── Mode 1: OpenStreetMap Overpass ──────────────────────────────────────────

async function searchOsm(params: MultiModeParams, cfg: ReturnType<typeof resolveProviderConfig>): Promise<ProviderHit[]> {
  try {
    const geo = await geocodeLocation(params.city, params.country, params.state);
    if (!geo) {
      logger.info("OSM: no geocode — skip Overpass");
      return [];
    }

    // Hard block US coordinates/results
    if (geo.countryCode && isUsCountry(geo.countryCode)) {
      logger.info("OSM: geocoded to US — blocked");
      return [];
    }

    const radiusM = Math.min(Math.max((params.radiusMiles ?? 25) * 1609.34, 2000), 80_000);
    const healthcareRegex = cfg.osmHealthcare.join("|");
    const amenityRegex = cfg.osmAmenity.join("|");

    const overpassQuery = `
[out:json][timeout:25];
(
  node["healthcare"~"${healthcareRegex}"](around:${radiusM},${geo.lat},${geo.lon});
  way["healthcare"~"${healthcareRegex}"](around:${radiusM},${geo.lat},${geo.lon});
  node["amenity"~"${amenityRegex}"](around:${radiusM},${geo.lat},${geo.lon});
  way["amenity"~"${amenityRegex}"](around:${radiusM},${geo.lat},${geo.lon});
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
      28_000,
    );

    const elements: any[] = data?.elements ?? [];
    const queryLabel = params.query || cfg.label;

    return elements
      .map((el) => {
        const tags = el.tags ?? {};
        const name = tags.name || tags["name:en"] || tags["official_name"];
        if (!name) return null;

        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        const website = tags.website || tags["contact:website"] || undefined;
        const phone = tags.phone || tags["contact:phone"] || undefined;
        const city = tags["addr:city"] || params.city;
        const country = (tags["addr:country"] || params.country || geo.countryCode || "").toUpperCase();

        if (isUsCountry(country)) return null;
        if (website && isBlockedUrl(website)) return null;

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

        return {
          id: slugId("osm", el.type, el.id),
          providerName: name,
          organizationName: tags.operator || name,
          providerType,
          specialty: tags.healthcare || tags.amenity || cfg.label,
          serviceQuery: queryLabel,
          normalizedService: cfg.label,
          exactPrice: 0,
          currency: "",
          priceType: "fee_schedule",
          evidenceText: `OpenStreetMap ${el.type}/${el.id}`,
          sourceUrl: website || `https://www.openstreetmap.org/${el.type}/${el.id}`,
          sourceType: "openstreetmap",
          country: country || params.country || "",
          stateRegion: tags["addr:state"] || params.state,
          city,
          postalCode: tags["addr:postcode"],
          latitude: typeof lat === "number" ? lat : undefined,
          longitude: typeof lon === "number" ? lon : undefined,
          phone,
          website,
          verificationStatus: "provider_found_no_price",
          confidenceScore: website || phone ? 0.88 : 0.75,
          timestampFound: new Date().toISOString(),
        } satisfies ProviderHit;
      })
      .filter((x): x is ProviderHit => x != null)
      .slice(0, 40);
  } catch (err) {
    logger.warn({ err }, "OSM search failed");
    return [];
  }
}

// ─── Mode 2: Wikidata SPARQL ─────────────────────────────────────────────────

async function searchWikidata(params: MultiModeParams, cfg: ReturnType<typeof resolveProviderConfig>): Promise<ProviderHit[]> {
  try {
    if (!params.country && !params.city) return [];

    const country = params.country?.replace(/'/g, "\\'");
    const city = params.city?.replace(/'/g, "\\'");

    // Global SPARQL — filter by country label and optional city; exclude US
    const locationFilters: string[] = [
      "FILTER(!BOUND(?countryLabel) || !REGEX(LCASE(STR(?countryLabel)), \"united states\"))",
      "FILTER(!BOUND(?iso) || ?iso != \"US\")",
    ];
    if (country && country.length > 2) {
      locationFilters.push(
        `FILTER(BOUND(?countryLabel) && CONTAINS(LCASE(STR(?countryLabel)), LCASE("${country}")))`,
      );
    } else if (country && country.length === 2) {
      locationFilters.push(`FILTER(BOUND(?iso) && ?iso = "${country.toUpperCase()}")`);
    }
    if (city) {
      locationFilters.push(
        `FILTER(BOUND(?cityLabel) && CONTAINS(LCASE(STR(?cityLabel)), LCASE("${city}")))`,
      );
    }

    const classValues = cfg.wikidataClasses.map((c) => `wd:${c}`).join(" ");

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
          "User-Agent": "InternationalProviderSearch/1.0",
        },
      },
      20_000,
    );

    const bindings: any[] = data?.results?.bindings ?? [];
    const queryLabel = params.query || cfg.label;

    return bindings
      .map((b) => {
        const name = b.itemLabel?.value;
        if (!name || name.startsWith("Q")) return null;

        const countryLabel = b.countryLabel?.value || params.country || "";
        if (isUsCountry(countryLabel) || b.iso?.value === "US") return null;

        let lat: number | undefined;
        let lon: number | undefined;
        const coord = b.coord?.value;
        if (coord && typeof coord === "string") {
          // Point(lon lat)
          const m = coord.match(/Point\(([-\d.]+)\s+([-\d.]+)\)/);
          if (m) {
            lon = parseFloat(m[1]);
            lat = parseFloat(m[2]);
          }
        }

        const website = b.website?.value;
        if (website && isBlockedUrl(website)) return null;

        const qid = (b.item?.value || "").split("/").pop() || name;

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
          sourceUrl: website || b.item?.value || `https://www.wikidata.org/wiki/${qid}`,
          sourceType: "wikidata",
          country: countryLabel || params.country || "",
          city: b.cityLabel?.value || params.city,
          latitude: lat,
          longitude: lon,
          phone: b.phone?.value,
          website,
          verificationStatus: "provider_found_no_price",
          confidenceScore: website ? 0.82 : 0.7,
          timestampFound: new Date().toISOString(),
        } satisfies ProviderHit;
      })
      .filter((x): x is ProviderHit => x != null);
  } catch (err) {
    logger.warn({ err }, "Wikidata search failed");
    return [];
  }
}

// ─── Mode 3: SearXNG metasearch ──────────────────────────────────────────────

async function searchSearxng(params: MultiModeParams, cfg: ReturnType<typeof resolveProviderConfig>): Promise<ProviderHit[]> {
  const base = process.env.SEARXNG_URL?.replace(/\/$/, "");
  if (!base) {
    logger.info("SEARXNG_URL not set — skipping web metasearch");
    return [];
  }

  try {
    const term = cfg.searchTerms[0] || params.query;
    const loc = [params.city, params.country].filter(Boolean).join(" ");
    const q = `${term} ${loc}`.trim();

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

    const results: any[] = data?.results ?? [];
    const queryLabel = params.query || cfg.label;

    return results
      .filter((r) => r.url && r.title && !isBlockedUrl(r.url))
      .slice(0, 20)
      .map((r, i) => {
        // Soft US exclusion from title/url/content
        const blob = `${r.title} ${r.url} ${r.content || ""}`.toLowerCase();
        if (\b(united states|\busa\b|\bu\.s\.\b)\b/.test(blob) && params.country && isUsCountry(params.country)) {
          return null;
        }
        // If country is explicitly non-US, still drop obvious US-only chains sometimes — keep permissive

        return {
          id: slugId("web", i, r.url),
          providerName: r.title.replace(/\s*[|\-–].*$/, "").trim().slice(0, 120),
          organizationName: r.title,
          providerType: "clinic",
          specialty: cfg.label,
          serviceQuery: queryLabel,
          normalizedService: cfg.label,
          exactPrice: 0,
          currency: "",
          priceType: "fee_schedule",
          evidenceText: (r.content || r.snippet || "").slice(0, 280),
          sourceUrl: r.url,
          sourceType: "web_search",
          country: params.country || "",
          city: params.city,
          stateRegion: params.state,
          website: r.url,
          verificationStatus: "provider_found_no_price",
          confidenceScore: Math.min(0.55 + (r.score ? Number(r.score) * 0.2 : 0.15), 0.85),
          timestampFound: new Date().toISOString(),
        } satisfies ProviderHit;
      })
      .filter((x): x is ProviderHit => x != null);
  } catch (err) {
    logger.warn({ err }, "SearXNG search failed");
    return [];
  }
}

// ─── Merge / dedupe / rank ───────────────────────────────────────────────────

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
    } else if (existing && hit.latitude && !existing.latitude) {
      byKey.set(key, { ...existing, latitude: hit.latitude, longitude: hit.longitude });
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const score = (h: ProviderHit) =>
      h.confidenceScore +
      (h.latitude ? 0.08 : 0) +
      (h.phone ? 0.05 : 0) +
      (h.website ? 0.05 : 0) +
      (h.sourceType === "openstreetmap" ? 0.04 : 0) +
      (h.sourceType === "wikidata" ? 0.03 : 0);
    return score(b) - score(a);
  });
}

/**
 * Run all Tier-1 modes in parallel. Returns empty if country is US.
 */
export async function runMultiModeSearch(params: MultiModeParams): Promise<{
  results: ProviderHit[];
  sources: { osm: number; wikidata: number; searxng: number };
  blockedUs: boolean;
}> {
  const country = normalizeCountry(params.country);

  if (isUsCountry(country)) {
    return { results: [], sources: { osm: 0, wikidata: 0, searxng: 0 }, blockedUs: true };
  }

  const cfg = resolveProviderConfig({ ...params, country });
  const searchParams: MultiModeParams = {
    ...params,
    country,
    query: params.query || cfg.label,
  };

  const [osm, wikidata, searxng] = await Promise.all([
    searchOsm(searchParams, cfg),
    searchWikidata(searchParams, cfg),
    searchSearxng(searchParams, cfg),
  ]);

  const merged = mergeAndRank([...osm, ...wikidata, ...searxng]);

  logger.info(
    {
      osm: osm.length,
      wikidata: wikidata.length,
      searxng: searxng.length,
      merged: merged.length,
      country,
      city: params.city,
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

export { PROVIDER_TYPE_CONFIG, isUsCountry, normalizeCountry };
