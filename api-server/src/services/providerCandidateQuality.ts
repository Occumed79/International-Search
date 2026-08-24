import type { MultiModeParams, ProviderHit } from "./multiModeSearch";

const GENERIC_PAGE_PREFIX = /^(?:about(?: us)?|contact(?: us)?|legal notice|privacy(?: policy)?|terms(?: of use| and conditions)?|home|welcome|services?)\s*[-:|]\s*/i;
const LIST_OR_ARTICLE_TITLE = /^(?:list\s+of|top\s+\d+|best\s+|directory\b|guide\b|medical facilities and practitioners\b|healthcare providers in\b|dentists? in\b|dental clinics? in\b|emergency dental services? in\b|dental laboratories? in\b|pediatric dentists? in\b|endodontists? in\b|periodontists? in\b|denture care centers? in\b)/i;
const LOW_VALUE_NAME = /^(?:tricare|spain|home|health services|medical services|naval station|naval station rota|department of defense|department of the navy)$/i;
const PROVIDER_ENTITY_TERMS = /\b(?:clinic|cl[ií]nica|practice|medical center|medical centre|health center|health centre|hospital|urgent care|occupational health|occupational medicine|dental|dentist|odont|laboratory|lab\b|pharmacy|radiology|imaging|diagnostic|healthcare|health care|medicina|m[eé]dica|m[eé]dico)\b/i;
const CONTACT_SIGNALS = /\b(?:address|phone|telephone|tel\.?|appointment|appointments|schedule|hours|opening hours|contact|direcci[oó]n|tel[eé]fono|cita|horario|calle|avenida|av\.|street|road|rd\.|boulevard|blvd\.|suite|plaza)\b/i;
const DIRECTORY_LANGUAGE = /\b(?:there are \d+|review count|rating scores|facebook profile|instagram handle|linkedin twitter whatsapp youtube|single-owner operations|part of larger brands)\b/i;

function clean(value: unknown, max = 1000): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalized(value: unknown): string {
  return clean(value, 260)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hostOf(value: unknown): string {
  try {
    return new URL(String(value || "")).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function canonicalName(value: unknown, sourceUrl?: string): string {
  let title = clean(value, 220);
  if (!title) return hostOf(sourceUrl).split(".")[0].replace(/[-_]+/g, " ");

  if (title.includes(">")) title = title.split(/\s*>\s*/)[0] || title;
  title = title.replace(GENERIC_PAGE_PREFIX, "").trim();

  const segments = title.split(/\s+[|–—]\s+/).map((part) => part.trim()).filter(Boolean);
  if (segments.length > 1) title = segments[0];

  const genericDash = title.match(/^(?:about(?: us)?|contact(?: us)?|legal notice|privacy(?: policy)?|home)\s*-\s*(.+)$/i);
  if (genericDash?.[1]) title = genericDash[1].trim();

  return clean(title, 160);
}

function providerTypeRegex(providerType?: string): RegExp {
  switch ((providerType || "").toLowerCase()) {
    case "dental":
      return /\b(?:dental|dentist|odont|cl[ií]nica dental)\b/i;
    case "occupational_health":
      return /\b(?:occupational health|occupational medicine|workplace health|employee health|medicina del trabajo|salud ocupacional|arbeitsmedizin)\b/i;
    case "hospital":
      return /\b(?:hospital|medical center|medical centre)\b/i;
    case "urgent_care":
      return /\b(?:urgent care|walk[- ]?in|immediate care)\b/i;
    case "imaging_center":
      return /\b(?:imaging|radiology|diagnostic imaging|mri|x[- ]?ray|ultrasound)\b/i;
    case "lab":
      return /\b(?:laboratory|laboratorio|lab\b|pathology)\b/i;
    case "pharmacy":
      return /\b(?:pharmacy|farmacia|chemist)\b/i;
    default:
      return PROVIDER_ENTITY_TERMS;
  }
}

function locationSignal(text: string, value?: string): boolean {
  const needle = normalized(value);
  if (!needle) return false;
  return normalized(text).includes(needle);
}

type QualityResult = {
  score: number;
  name: string;
  hardReject: boolean;
  cityVerified: boolean;
  stateVerified: boolean;
  countryVerified: boolean;
};

function qualityScore(hit: ProviderHit, params: MultiModeParams): QualityResult {
  const originalName = clean(hit.providerName, 220);
  const name = canonicalName(originalName, hit.sourceUrl || hit.website);
  const evidence = clean(hit.evidenceText, 2400);
  const source = clean(hit.sourceUrl || hit.website, 500);
  const combined = `${name} ${originalName} ${evidence} ${source}`;
  let score = 0;
  let hardReject = false;

  if (!name || name.length < 3 || name.length > 130) score -= 4;
  if (LIST_OR_ARTICLE_TITLE.test(originalName)) {
    score -= 10;
    hardReject = true;
  }
  if (DIRECTORY_LANGUAGE.test(combined)) {
    score -= 7;
    if (!PROVIDER_ENTITY_TERMS.test(name)) hardReject = true;
  }
  if (LOW_VALUE_NAME.test(name)) score -= 6;

  const typeRegex = providerTypeRegex(params.providerType);
  if (typeRegex.test(name)) score += 5;
  else if (typeRegex.test(evidence)) score += 2;
  if (PROVIDER_ENTITY_TERMS.test(name)) score += 3;

  if (hit.phone) score += 3;
  if (CONTACT_SIGNALS.test(evidence)) score += 2;

  const cityVerified = locationSignal(combined, params.city);
  const stateVerified = locationSignal(combined, params.state);
  const countryVerified = locationSignal(combined, params.country);
  if (cityVerified) score += 3;
  else if (params.city) score -= 4;
  if (stateVerified) score += 1;
  if (countryVerified) score += 1;

  const host = hostOf(hit.sourceUrl || hit.website);
  if (host && !/(?:blog|news|directory|listing|magazine|tourism|linkedin|facebook|instagram)/i.test(host)) score += 1;

  if (/\b(?:naval station|military onesource|tricare|department of defense|department of the navy)\b/i.test(combined)) {
    if (/(?:hospital|clinic|medical center|dental clinic)/i.test(name)) score += 1;
    else score -= 5;
  }

  return { score, name, hardReject, cityVerified, stateVerified, countryVerified };
}

function usefulEvidence(value: unknown): string | undefined {
  let text = clean(value, 900)
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*{1,2}/g, "")
    .replace(/\b(?:facebook|instagram|linkedin|twitter|whatsapp|youtube)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  text = text.replace(/(?:There are|Of these locations).{0,450}$/i, "").trim();
  if (!text || text.length < 24) return undefined;
  return text.slice(0, 420);
}

function sameProvider(a: ProviderHit, b: ProviderHit): boolean {
  const aName = normalized(a.providerName);
  const bName = normalized(b.providerName);
  if (aName && bName && (aName === bName || (Math.min(aName.length, bName.length) >= 8 && (aName.includes(bName) || bName.includes(aName))))) return true;

  const aHost = hostOf(a.sourceUrl || a.website);
  const bHost = hostOf(b.sourceUrl || b.website);
  if (!aHost || aHost !== bHost) return false;

  const aTokens = new Set(aName.split(" ").filter((token) => token.length > 2));
  const bTokens = new Set(bName.split(" ").filter((token) => token.length > 2));
  const overlap = [...aTokens].filter((token) => bTokens.has(token)).length;
  const denominator = Math.max(1, Math.min(aTokens.size, bTokens.size));
  return overlap / denominator >= 0.6;
}

export function rankProviderCandidates(hits: ProviderHit[], params: MultiModeParams): ProviderHit[] {
  const scored = hits
    .map((hit) => {
      const quality = qualityScore(hit, params);
      const confidence = Math.max(0.55, Math.min(0.97, 0.58 + quality.score * 0.035));
      return {
        hit: {
          ...hit,
          providerName: quality.name,
          organizationName: quality.name,
          // apiProviderSearch stamps the requested geography onto every raw web hit. Only keep
          // those fields when the source itself actually supports that geography.
          city: quality.cityVerified ? params.city : undefined,
          stateRegion: quality.stateVerified ? params.state : undefined,
          country: quality.countryVerified ? params.country : undefined,
          evidenceText: usefulEvidence(hit.evidenceText),
          confidenceScore: confidence,
        } satisfies ProviderHit,
        score: quality.score,
        hardReject: quality.hardReject,
      };
    })
    .filter((item) => !item.hardReject && item.score >= 5)
    .sort((a, b) => b.score - a.score || (b.hit.confidenceScore || 0) - (a.hit.confidenceScore || 0));

  const result: ProviderHit[] = [];
  for (const item of scored) {
    const duplicateIndex = result.findIndex((existing) => sameProvider(existing, item.hit));
    if (duplicateIndex === -1) {
      result.push(item.hit);
      continue;
    }

    const existing = result[duplicateIndex];
    const existingSignals = Number(Boolean(existing.phone)) + Number(Boolean(existing.evidenceText));
    const candidateSignals = Number(Boolean(item.hit.phone)) + Number(Boolean(item.hit.evidenceText));
    if (candidateSignals > existingSignals || (item.hit.confidenceScore || 0) > (existing.confidenceScore || 0)) {
      result[duplicateIndex] = item.hit;
    }
  }

  return result.slice(0, 30);
}
