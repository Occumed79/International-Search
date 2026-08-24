import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { runApiProviderSearch } from "../services/apiProviderSearch";
import { rankProviderCandidates } from "../services/providerCandidateQuality";
import type { ProviderHit } from "../services/multiModeSearch";

const router: IRouter = Router();

function clean(value: unknown, max = 500): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeName(value: unknown): string {
  return clean(value, 240).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeCountry(value: unknown): string {
  const raw = clean(value, 80);
  const upper = raw.toUpperCase();
  if (["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"].includes(upper)) return "United States";
  return raw;
}

function providerTypeLabel(value?: string): string {
  const labels: Record<string, string> = {
    occupational_health: "occupational health clinic",
    clinic: "medical clinic",
    hospital: "hospital",
    urgent_care: "urgent care clinic",
    imaging_center: "diagnostic imaging center",
    lab: "medical laboratory",
    dental: "dental clinic dentist",
    pharmacy: "pharmacy",
  };
  return labels[value || ""] || "healthcare clinic";
}

function sameIdentity(candidate: ProviderHit, row: any): boolean {
  const candidateNames = [candidate.providerName, candidate.organizationName].map(normalizeName).filter(Boolean);
  const networkNames = [row.name, row.organization_name, row.site_name].map(normalizeName).filter(Boolean);
  if (!candidateNames.length || !networkNames.length) return false;

  return candidateNames.some((candidateName) => networkNames.some((networkName) => {
    if (candidateName === networkName) return true;
    const shorter = candidateName.length <= networkName.length ? candidateName : networkName;
    const longer = candidateName.length > networkName.length ? candidateName : networkName;
    return shorter.length >= 8 && longer.includes(shorter);
  }));
}

async function loadNetworkIdentityRows(country: string, state: string, city: string) {
  if (!pool) return [];
  const values: unknown[] = [];
  const where: string[] = [];
  const add = (value: unknown) => { values.push(value); return `$${values.length}`; };

  if (country) where.push(`country ILIKE ${add(country)}`);
  if (state) where.push(`state_region ILIKE ${add(state)}`);
  if (city) where.push(`city ILIKE ${add(`%${city}%`)}`);

  const result = await pool.query(`
    SELECT name, organization_name, site_name, city, state_region, country
    FROM network_provider_snapshot
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
  `, values);
  return result.rows;
}

function mergeSourceCounts(
  first: { keenable: number; tinyfish: number; exa: number },
  second?: { keenable: number; tinyfish: number; exa: number },
) {
  return {
    keenable: first.keenable + (second?.keenable || 0),
    tinyfish: first.tinyfish + (second?.tinyfish || 0),
    exa: first.exa + (second?.exa || 0),
  };
}

router.post("/outside-network/search", async (req, res): Promise<void> => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const query = clean(body.query, 200) || "occupational health";
    const providerType = clean(body.providerType, 80) || undefined;
    const country = normalizeCountry(body.country);
    const state = clean(body.state, 100);
    const city = clean(body.city, 120);
    const radiusMiles = Number(body.radiusMiles || 25);
    const services = Array.isArray(body.services)
      ? body.services.map((item: unknown) => clean(item, 160)).filter(Boolean)
      : clean(body.services, 2000).split(/[|,;\n]+/).map((item) => item.trim()).filter(Boolean);

    const params = {
      query: [query, ...services].filter(Boolean).join(" "),
      providerType,
      country: country || undefined,
      state: state || undefined,
      city: city || undefined,
      radiusMiles,
    };

    const discovery = await runApiProviderSearch(params);
    let rawHits = discovery.results;
    let ranked = rankProviderCandidates(rawHits, params);
    let refinement: Awaited<ReturnType<typeof runApiProviderSearch>> | null = null;

    // When the first web pass is mostly directories/articles, spend one targeted pass on actual entity pages.
    if (ranked.length < 6) {
      refinement = await runApiProviderSearch({
        ...params,
        query: `${query} ${providerTypeLabel(providerType)} official website address phone appointments`,
      });
      rawHits = [...rawHits, ...refinement.results];
      ranked = rankProviderCandidates(rawHits, params);
    }

    const networkRows = await loadNetworkIdentityRows(country, state, city);
    const candidates: ProviderHit[] = [];
    const excludedExisting: ProviderHit[] = [];

    for (const hit of ranked) {
      const normalizedHit: ProviderHit = {
        ...hit,
        specialty: query,
        serviceQuery: query,
      };
      if (networkRows.some((row) => sameIdentity(normalizedHit, row))) excludedExisting.push(normalizedHit);
      else candidates.push(normalizedHit);
    }

    res.json({
      requirement: { query, providerType, country, state, city, radiusMiles, services },
      summary: {
        discovered: rawHits.length,
        rejectedLowQuality: Math.max(0, rawHits.length - ranked.length),
        excludedExisting: excludedExisting.length,
        outsideNetworkCandidates: candidates.length,
      },
      candidates,
      // Backend-only telemetry. Vendor identities are not rendered in the frontend.
      sources: mergeSourceCounts(discovery.sources, refinement?.sources),
      fallbackUsed: discovery.fallbackUsed || Boolean(refinement?.fallbackUsed),
      refinementUsed: Boolean(refinement),
    });
  } catch (error) {
    logger.error({ error }, "Outside-network provider search failed");
    res.status(500).json({ error: error instanceof Error ? error.message : "Outside-network provider search failed." });
  }
});

export default router;
