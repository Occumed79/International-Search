import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

type Candidate = {
  name?: string;
  country?: string;
  city?: string;
  address?: string;
  website?: string;
  phone?: string;
};

type StoredProvider = {
  id: number;
  name: string;
  organization_name?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  website?: string | null;
};

function clean(value: unknown, max = 500): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalized(value: unknown): string {
  return clean(value, 500)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedName(value: unknown): string {
  return normalized(value).replace(/\b(ltd|limited|llc|inc|corp|corporation|pllc|pty|gmbh|sa|sarl)\b/g, " ").replace(/\s+/g, " ").trim();
}

function phoneDigits(value: unknown): string {
  return clean(value, 80).replace(/\D/g, "");
}

function domain(value: unknown): string {
  const raw = clean(value, 400);
  if (!raw) return "";
  try {
    const prepared = raw.includes("://") ? raw : `https://${raw}`;
    return new URL(prepared).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function scoreOutreachMatch(candidate: Candidate, row: StoredProvider): number {
  const candidateName = normalizedName(candidate.name);
  const storedNames = [row.name, row.organization_name].map(normalizedName).filter(Boolean);
  const nameExact = Boolean(candidateName && storedNames.some((name) => name === candidateName));
  const nameClose = Boolean(candidateName && storedNames.some((name) => {
    const shorter = candidateName.length <= name.length ? candidateName : name;
    const longer = candidateName.length > name.length ? candidateName : name;
    return shorter.length >= 8 && longer.includes(shorter);
  }));

  const candidateDomain = domain(candidate.website);
  const storedDomain = domain(row.website);
  const domainExact = Boolean(candidateDomain && storedDomain && candidateDomain === storedDomain);

  const candidatePhone = phoneDigits(candidate.phone);
  const storedPhone = phoneDigits(row.phone);
  const phoneExact = Boolean(
    candidatePhone.length >= 7
      && storedPhone.length >= 7
      && candidatePhone.slice(-10) === storedPhone.slice(-10)
  );

  const addressExact = Boolean(
    candidate.address
      && row.address
      && normalized(candidate.address) === normalized(row.address)
  );
  const cityExact = Boolean(candidate.city && row.city && normalized(candidate.city) === normalized(row.city));
  const countryExact = Boolean(candidate.country && row.country && normalized(candidate.country) === normalized(row.country));

  if (nameExact && addressExact) return 1;
  if (nameExact && phoneExact) return 0.99;
  if (domainExact && addressExact) return 0.99;
  if (domainExact && nameExact && cityExact) return 0.98;
  if (nameExact && cityExact && countryExact) return 0.96;
  if (phoneExact && cityExact && countryExact) return 0.95;
  if (domainExact && nameClose && cityExact && countryExact) return 0.94;
  if (nameClose && addressExact) return 0.94;
  return 0;
}

router.post("/outreach-match", async (req, res): Promise<void> => {
  if (!pool) {
    res.status(503).json({
      error: "International Search database is not configured.",
      available: false
    });
    return;
  }

  try {
    const body = req.body && typeof req.body === "object" ? req.body as Candidate : {};
    const name = clean(body.name, 240);
    const country = clean(body.country, 80);
    const city = clean(body.city, 120);

    if (!name || !country) {
      res.status(400).json({ error: "name and country are required" });
      return;
    }

    const values: unknown[] = [];
    const where: string[] = [];
    const add = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };

    where.push(`country ILIKE ${add(country)}`);
    if (city) where.push(`city ILIKE ${add(`%${city}%`)}`);

    const namePattern = `%${name}%`;
    const nameParam = add(namePattern);
    where.push(`(name ILIKE ${nameParam} OR organization_name ILIKE ${nameParam})`);

    values.push(100);
    const result = await pool.query(
      `
        SELECT id, name, organization_name, address, city, country, phone, website
        FROM providers
        WHERE ${where.join(" AND ")}
        ORDER BY last_updated DESC
        LIMIT $${values.length}
      `,
      values
    );

    const ranked = result.rows
      .map((row: StoredProvider) => ({ row, score: scoreOutreachMatch(body, row) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (!best || best.score < 0.94) {
      res.json({
        available: true,
        found: false,
        checked: result.rows.length
      });
      return;
    }

    res.json({
      available: true,
      found: true,
      recordId: `provider-${best.row.id}`,
      label: best.row.name,
      confidence: best.score,
      match: best.row
    });
  } catch (error) {
    logger.error({ error }, "Outreach match lookup failed");
    res.status(500).json({
      error: error instanceof Error ? error.message : "Outreach match lookup failed.",
      available: false
    });
  }
});

export default router;
