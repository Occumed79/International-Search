import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BadgeCheck,
  Building2,
  Database,
  DollarSign,
  ExternalLink,
  Globe2,
  MapPin,
  Phone,
  Radar,
  Search,
  Stethoscope,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import occuMedLogoDataUrl from "@/assets/occu-med-logo-data";

interface NetworkStats {
  total: number;
  activeAgreements: number;
  pricingRecords: number;
  availabilityLinks: number;
  pricedClinics: number;
  availabilityClinics: number;
}

interface ExistingProvider {
  id: string;
  externalId?: number | null;
  providerName: string;
  organizationName?: string;
  siteName?: string;
  facilityType?: string;
  networkStatus: string;
  country?: string;
  stateRegion?: string;
  city?: string;
  address?: string;
  postalCode?: string;
  phone?: string;
  services: string[];
  lastAppointment?: string;
  pricingCount?: number;
  explicitAvailability?: string[];
  matchedServices: string[];
  missingServices: string[];
  coverageRatio: number;
}

interface ExternalProvider {
  id: string;
  providerName: string;
  organizationName?: string;
  providerType?: string;
  specialty?: string;
  city?: string;
  stateRegion?: string;
  country?: string;
  phone?: string;
  website?: string;
  sourceUrl?: string;
  evidenceText?: string;
  networkStatus?: string;
  confidenceScore?: number;
}

interface ProviderIntelligence {
  pricingCount: number;
  availabilityCount: number;
  pricing: Array<{
    componentName: string;
    numericPrice: number | null;
    sourcePriceText?: string;
    effectiveDate?: string;
    expirationDate?: string;
  }>;
  availability: Array<{
    componentName: string;
    componentType?: string;
  }>;
}

interface SourcingResponse {
  summary: {
    existingMatches: number;
    qualifiedActiveMatches: number;
    searchedOutsideNetwork: boolean;
    externalCandidates: number;
  };
  existing: ExistingProvider[];
  external: ExternalProvider[];
  externalSources: { keenable: number; tinyfish: number; exa: number };
  fallbackUsed: boolean;
}

const EMPTY_STATS: NetworkStats = {
  total: 0,
  activeAgreements: 0,
  pricingRecords: 0,
  availabilityLinks: 0,
  pricedClinics: 0,
  availabilityClinics: 0,
};

const COUNTRIES = [
  "United States", "Canada", "Mexico", "United Kingdom", "Germany", "France", "Spain", "Italy", "Portugal",
  "Poland", "Netherlands", "Ireland", "Turkey", "United Arab Emirates", "Kuwait", "Saudi Arabia", "Qatar",
  "Australia", "New Zealand", "Japan", "South Korea", "Singapore", "Thailand", "Philippines", "Malaysia",
  "India", "South Africa", "Brazil", "Argentina", "Chile", "Colombia",
];

const PROVIDER_TYPES = [
  { value: "occupational_health", label: "Occupational Health" },
  { value: "clinic", label: "Clinic" },
  { value: "hospital", label: "Hospital" },
  { value: "urgent_care", label: "Urgent Care" },
  { value: "imaging_center", label: "Imaging Center" },
  { value: "lab", label: "Laboratory" },
  { value: "dental", label: "Dental" },
  { value: "pharmacy", label: "Pharmacy" },
];

const SERVICE_CHIPS = ["Physical", "Audiogram", "PFT", "EKG", "CBC", "Vision", "Dental", "Drug Screen"];

function money(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusClass(status: string) {
  if (status === "Active Agreement") return "cc-tag-green";
  if (status === "Expired") return "cc-tag-red";
  if (status.includes("NEW") || status.includes("2026")) return "cc-tag-blue";
  return "cc-tag-amber";
}

export function CommandCenter() {
  const { toast } = useToast();
  const [stats, setStats] = useState(EMPTY_STATS);
  const [query, setQuery] = useState("Occupational Health");
  const [providerType, setProviderType] = useState("occupational_health");
  const [country, setCountry] = useState("United States");
  const [stateRegion, setStateRegion] = useState("");
  const [city, setCity] = useState("");
  const [servicesText, setServicesText] = useState("");
  const [radiusMiles, setRadiusMiles] = useState(25);
  const [outsideMode, setOutsideMode] = useState<"off" | "gaps" | "always">("gaps");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SourcingResponse | null>(null);
  const [sourceTab, setSourceTab] = useState<"existing" | "external">("existing");
  const [selectedExisting, setSelectedExisting] = useState<ExistingProvider | null>(null);
  const [selectedExternal, setSelectedExternal] = useState<ExternalProvider | null>(null);
  const [intelligence, setIntelligence] = useState<ProviderIntelligence | null>(null);
  const [intelLoading, setIntelLoading] = useState(false);

  const services = useMemo(() => servicesText.split(/[\n,;|]+/).map((item) => item.trim()).filter(Boolean), [servicesText]);

  useEffect(() => {
    void (async () => {
      try {
        const [networkResponse, intelligenceResponse] = await Promise.all([
          fetch("/api/network/stats"),
          fetch("/api/network/intelligence-stats"),
        ]);
        const network = networkResponse.ok ? await networkResponse.json() : {};
        const intel = intelligenceResponse.ok ? await intelligenceResponse.json() : {};
        setStats({ ...EMPTY_STATS, ...network, ...intel });
      } catch {
        // The workspace remains usable if summary counts are temporarily unavailable.
      }
    })();
  }, []);

  const toggleService = (service: string) => {
    const current = services;
    const next = current.includes(service) ? current.filter((item) => item !== service) : [...current, service];
    setServicesText(next.join(", "));
  };

  const loadIntelligence = async (provider: ExistingProvider) => {
    setIntelligence(null);
    if (!provider.externalId) return;
    setIntelLoading(true);
    try {
      const response = await fetch(`/api/network/intelligence/${provider.externalId}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Provider details could not be loaded");
      setIntelligence(payload as ProviderIntelligence);
    } catch (error) {
      toast({
        title: "Could not load provider details",
        description: error instanceof Error ? error.message : "Lookup failed.",
        variant: "destructive",
      });
    } finally {
      setIntelLoading(false);
    }
  };

  const runSearch = async () => {
    setLoading(true);
    setSelectedExisting(null);
    setSelectedExternal(null);
    setIntelligence(null);
    try {
      const response = await fetch("/api/sourcing/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query.trim() || PROVIDER_TYPES.find((item) => item.value === providerType)?.label || "Clinic",
          providerType,
          city,
          state: stateRegion,
          country,
          radiusMiles,
          services,
          includeExternal: outsideMode !== "off",
          forceExternal: outsideMode === "always",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Provider search failed");
      const next = payload as SourcingResponse;
      setResult(next);
      setSourceTab(next.existing.length > 0 ? "existing" : "external");
      if (next.existing[0]) {
        setSelectedExisting(next.existing[0]);
        void loadIntelligence(next.existing[0]);
      } else if (next.external[0]) {
        setSelectedExternal(next.external[0]);
      }
    } catch (error) {
      toast({
        title: "Search failed",
        description: error instanceof Error ? error.message : "Provider search failed.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const selectExisting = (provider: ExistingProvider) => {
    setSelectedExternal(null);
    setSelectedExisting(provider);
    void loadIntelligence(provider);
  };

  const selectExternal = (provider: ExternalProvider) => {
    setSelectedExisting(null);
    setSelectedExternal(provider);
    setIntelligence(null);
  };

  const selected = selectedExisting || selectedExternal;
  const existing = result?.existing ?? [];
  const external = result?.external ?? [];

  return (
    <div className="cc-page">
      <style>{`
        .cc-page{--cc-glass:rgba(255,255,255,.66);--cc-line:rgba(255,255,255,.94);--cc-ink:#182433;--cc-muted:#6c7988;--cc-blue:#397ec1;--cc-shadow:0 18px 55px rgba(48,65,88,.13),0 3px 12px rgba(48,65,88,.07);height:100%;min-height:0;color:var(--cc-ink);background:radial-gradient(circle at 8% 2%,rgba(151,199,234,.34),transparent 28%),radial-gradient(circle at 92% 3%,rgba(237,244,249,.94),transparent 25%),radial-gradient(circle at 75% 95%,rgba(183,214,235,.23),transparent 28%),linear-gradient(180deg,#fbfcfd,#edf2f6 45%,#dfe7ed);overflow:hidden;font-family:Inter,-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif}
        .cc-page *{box-sizing:border-box}.cc-glass{background:var(--cc-glass);border:1px solid var(--cc-line);box-shadow:var(--cc-shadow);backdrop-filter:blur(24px) saturate(1.18);-webkit-backdrop-filter:blur(24px) saturate(1.18)}
        .cc-app{height:100%;padding:12px;display:grid;grid-template-columns:310px minmax(0,1fr);gap:12px;overflow:hidden}.cc-sidebar{border-radius:30px;padding:15px;min-height:0;overflow:auto}.cc-brand{padding:14px;border-radius:22px;background:linear-gradient(180deg,rgba(255,255,255,.88),rgba(255,255,255,.54));border:1px solid #fff;text-align:center}.cc-brand img{width:145px;max-width:80%;height:auto;filter:invert(1);opacity:.9}.cc-brand h1{margin:4px 0 0;font-size:16px;letter-spacing:-.025em}.cc-brand p{margin:4px 0 0;color:var(--cc-muted);font-size:10px}.cc-section-label{margin:16px 4px 8px;font-size:10px;text-transform:uppercase;letter-spacing:.13em;font-weight:800;color:#728091}.cc-field{margin-top:8px}.cc-field label{display:block;margin:0 0 5px 4px;font-size:10px;color:var(--cc-muted)}.cc-field input,.cc-field select{width:100%;height:40px;border:1px solid #fff;border-radius:13px;background:rgba(255,255,255,.72);padding:0 11px;color:var(--cc-ink);outline:none;box-shadow:inset 0 1px 0 #fff}.cc-service-chips{display:flex;flex-wrap:wrap;gap:6px}.cc-service-chip{border:1px solid rgba(255,255,255,.95);background:rgba(255,255,255,.62);border-radius:999px;padding:6px 9px;color:#506072;font-size:10px;cursor:pointer}.cc-service-chip.on{background:#e7f2fa;border-color:#bfd8e9;color:#275d86}.cc-seg{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;padding:5px;border-radius:15px;background:rgba(255,255,255,.48);border:1px solid #fff}.cc-seg button{border:0;border-radius:11px;background:transparent;height:32px;color:var(--cc-muted);font-size:10px;font-weight:700;cursor:pointer}.cc-seg button.on{background:rgba(255,255,255,.96);color:var(--cc-ink);box-shadow:0 4px 12px rgba(56,78,100,.11)}.cc-find{width:100%;height:42px;margin-top:12px;border:0;border-radius:14px;background:linear-gradient(180deg,#4a8bc7,#397ec1);color:white;font-size:11px;font-weight:800;cursor:pointer;box-shadow:0 8px 18px rgba(57,126,193,.22);display:flex;align-items:center;justify-content:center;gap:7px}.cc-mini-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.cc-mini{padding:10px;border-radius:15px;background:rgba(255,255,255,.58);border:1px solid #fff}.cc-mini b{display:block;font-size:17px}.cc-mini span{font-size:8.5px;color:var(--cc-muted);text-transform:uppercase;letter-spacing:.07em}
        .cc-main{min-width:0;min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr);gap:12px;overflow:hidden}.cc-top{border-radius:28px;padding:14px 16px;display:flex;gap:15px;align-items:center;justify-content:space-between}.cc-headline h2{margin:0;font-size:23px;letter-spacing:-.04em}.cc-headline p{margin:4px 0 0;color:var(--cc-muted);font-size:10.5px}.cc-kpis{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.cc-kpi{min-width:116px;padding:9px 11px;border-radius:16px;background:rgba(255,255,255,.62);border:1px solid #fff;display:flex;align-items:center;gap:8px}.cc-kpi svg{width:16px;height:16px;color:#4c80ad}.cc-kpi b{display:block;font-size:16px}.cc-kpi span{display:block;font-size:8px;color:var(--cc-muted);text-transform:uppercase;letter-spacing:.08em}
        .cc-workspace{border-radius:28px;overflow:hidden;min-height:0;height:100%;display:grid;grid-template-rows:auto minmax(0,1fr)}.cc-toolbar{min-height:52px;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,.9);display:flex;justify-content:space-between;align-items:center;gap:10px}.cc-tabs{display:flex;gap:5px;padding:5px;border-radius:15px;background:rgba(255,255,255,.48);border:1px solid #fff}.cc-tabs button{border:0;border-radius:11px;background:transparent;height:32px;padding:0 11px;color:var(--cc-muted);font-weight:750;font-size:10px;cursor:pointer}.cc-tabs button.on{background:#fff;color:var(--cc-ink);box-shadow:0 4px 12px rgba(56,78,100,.10)}.cc-summary{font-size:9.5px;color:var(--cc-muted);display:flex;gap:6px;flex-wrap:wrap}.cc-pill{padding:5px 8px;border-radius:999px;background:rgba(255,255,255,.62);border:1px solid #fff}.cc-dir{min-height:0;height:100%;display:grid;grid-template-columns:minmax(0,1fr) 365px;overflow:hidden}.cc-results{min-width:0;min-height:0;border-right:1px solid rgba(255,255,255,.9);overflow:auto;padding:10px 12px 26px}.cc-group{border-radius:19px;background:rgba(255,255,255,.38);border:1px solid rgba(255,255,255,.86);overflow:hidden}.cc-group-head{position:sticky;top:0;z-index:2;padding:10px 12px;background:rgba(248,251,253,.92);backdrop-filter:blur(18px);border-bottom:1px solid rgba(255,255,255,.92);display:flex;justify-content:space-between}.cc-group-head b{font-size:12px}.cc-group-head span{font-size:9px;color:var(--cc-muted)}.cc-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(235px,1fr));gap:8px;padding:9px}.cc-card{padding:11px;border-radius:16px;background:linear-gradient(180deg,rgba(255,255,255,.88),rgba(255,255,255,.60));border:1px solid #fff;box-shadow:0 5px 14px rgba(48,66,88,.06);cursor:pointer;transition:.13s;text-align:left;color:var(--cc-ink)}.cc-card:hover{transform:translateY(-1px)}.cc-card.active{outline:2px solid rgba(57,126,193,.33)}.cc-card-title{font-size:12px;font-weight:850}.cc-card-sub{font-size:9.5px;color:var(--cc-muted);margin-top:3px}.cc-loc{margin-top:5px;color:#536173;font-size:9.5px;display:flex;gap:4px;align-items:center}.cc-tag-row{display:flex;gap:4px;flex-wrap:wrap;margin-top:7px}.cc-tag{font-size:8.2px;border-radius:999px;padding:3px 6px;border:1px solid}.cc-tag-green{background:#e8f4f0;color:#397362;border-color:#cfe5dd}.cc-tag-blue{background:#edf5fa;color:#32658b;border-color:#d2e5f1}.cc-tag-red{background:#f8ecee;color:#8b414a;border-color:#edd5d8}.cc-tag-amber{background:#faf2e5;color:#8b652f;border-color:#ebdcc2}.cc-card-foot{display:flex;justify-content:space-between;gap:6px;margin-top:7px;color:#7b8795;font-size:8.8px}.cc-empty{height:100%;min-height:260px;display:grid;place-items:center;text-align:center;color:var(--cc-muted);padding:40px}.cc-detail{min-height:0;height:100%;overflow:auto;padding:12px 12px 28px}.cc-detail-hero{padding:14px;border-radius:20px;background:linear-gradient(180deg,rgba(255,255,255,.90),rgba(255,255,255,.60));border:1px solid #fff}.cc-detail-hero h3{margin:0;font-size:18px}.cc-detail-hero p{margin:5px 0 0;color:var(--cc-muted);font-size:10px}.cc-detail-card{margin-top:9px;padding:12px;border-radius:17px;background:rgba(255,255,255,.58);border:1px solid #fff}.cc-detail-card h4{margin:0 0 8px;font-size:9px;color:#748293;text-transform:uppercase;letter-spacing:.11em}.cc-kv{display:grid;grid-template-columns:86px 1fr;gap:5px 8px;font-size:10px;line-height:1.4}.cc-kv .k{color:#8190a0}.cc-service-list{display:flex;gap:5px;flex-wrap:wrap}.cc-action{margin-top:9px;height:32px;border-radius:10px;border:1px solid #fff;background:rgba(255,255,255,.78);color:#466076;font-size:10px;font-weight:750;padding:0 10px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:5px}.cc-intel-row{padding:8px 0;border-top:1px solid rgba(128,145,162,.16);font-size:9.5px}.cc-price{font-weight:850;color:#2f688f}.cc-radius{display:flex;align-items:center;gap:8px}.cc-radius input{flex:1}.cc-radius span{width:42px;text-align:right;font-size:10px;font-weight:700;color:#51677b}
        @media(max-width:1100px){.cc-app{grid-template-columns:260px minmax(0,1fr)}.cc-dir{grid-template-columns:minmax(0,1fr) 320px}.cc-kpi{min-width:98px}}
        @media(max-width:850px){.cc-app{display:block;overflow:auto}.cc-sidebar{margin-bottom:12px}.cc-main{height:900px}.cc-top{align-items:flex-start;flex-direction:column}.cc-kpis{justify-content:flex-start}.cc-dir{grid-template-columns:1fr}.cc-detail{border-top:1px solid #fff;max-height:420px}.cc-results{border-right:0}.cc-workspace{min-height:780px}}
      `}</style>

      <div className="cc-app">
        <aside className="cc-sidebar cc-glass">
          <div className="cc-brand">
            <img src={occuMedLogoDataUrl} alt="Occu-Med" />
            <h1>Network Command Center</h1>
            <p>Provider coverage, agreements, services, pricing, and availability</p>
          </div>

          <div className="cc-section-label">Provider Search</div>
          <div className="cc-field"><label>Provider type</label><select value={providerType} onChange={(e) => setProviderType(e.target.value)}>{PROVIDER_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
          <div className="cc-field"><label>Country</label><select value={country} onChange={(e) => setCountry(e.target.value)}>{COUNTRIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
          <div className="cc-field"><label>State / region</label><input value={stateRegion} onChange={(e) => setStateRegion(e.target.value)} placeholder="MT, ON, QLD…" /></div>
          <div className="cc-field"><label>City</label><input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" /></div>
          <div className="cc-field"><label>Service or exam</label><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Audiogram, physical, lab…" /></div>

          <div className="cc-section-label">Required Services</div>
          <div className="cc-service-chips">{SERVICE_CHIPS.map((service) => <button key={service} type="button" className={`cc-service-chip ${services.includes(service) ? "on" : ""}`} onClick={() => toggleService(service)}>{service}</button>)}</div>
          <div className="cc-field"><input value={servicesText} onChange={(e) => setServicesText(e.target.value)} placeholder="Add other services…" /></div>

          <div className="cc-section-label">Search Scope</div>
          <div className="cc-seg">
            {([['off', 'Occu-Med'], ['gaps', 'If needed'], ['always', 'Expanded']] as const).map(([value, label]) => <button key={value} type="button" className={outsideMode === value ? "on" : ""} onClick={() => setOutsideMode(value)}>{label}</button>)}
          </div>
          <div className="cc-field"><label>Radius</label><div className="cc-radius"><input type="range" min={5} max={100} step={5} value={radiusMiles} onChange={(e) => setRadiusMiles(Number(e.target.value))} /><span>{radiusMiles} mi</span></div></div>

          <button className="cc-find" type="button" onClick={() => void runSearch()} disabled={loading}>{loading ? <Activity className="w-4 h-4 animate-pulse" /> : <Search className="w-4 h-4" />}{loading ? "Searching…" : "Find providers"}</button>

          <div className="cc-section-label">Network Snapshot</div>
          <div className="cc-mini-grid">
            <div className="cc-mini"><b>{stats.total.toLocaleString()}</b><span>Locations</span></div>
            <div className="cc-mini"><b>{stats.activeAgreements.toLocaleString()}</b><span>Agreements</span></div>
            <div className="cc-mini"><b>{stats.pricingRecords.toLocaleString()}</b><span>Prices</span></div>
            <div className="cc-mini"><b>{stats.availabilityLinks.toLocaleString()}</b><span>Services</span></div>
          </div>
        </aside>

        <section className="cc-main">
          <header className="cc-top cc-glass">
            <div className="cc-headline">
              <h2>Provider Network Command Center</h2>
              <p>Search, compare, and inspect provider coverage without leaving Global Intelligence.</p>
            </div>
            <div className="cc-kpis">
              <div className="cc-kpi"><Building2 /><div><b>{stats.total.toLocaleString()}</b><span>Network Locations</span></div></div>
              <div className="cc-kpi"><BadgeCheck /><div><b>{stats.activeAgreements.toLocaleString()}</b><span>Active Agreements</span></div></div>
              <div className="cc-kpi"><DollarSign /><div><b>{stats.pricingRecords.toLocaleString()}</b><span>Pricing Records</span></div></div>
              <div className="cc-kpi"><Database /><div><b>{stats.availabilityLinks.toLocaleString()}</b><span>Service Links</span></div></div>
            </div>
          </header>

          <div className="cc-workspace cc-glass">
            <div className="cc-toolbar">
              <div className="cc-tabs">
                <button className={sourceTab === "existing" ? "on" : ""} onClick={() => setSourceTab("existing")}>Occu-Med Network ({existing.length})</button>
                <button className={sourceTab === "external" ? "on" : ""} onClick={() => setSourceTab("external")}>Additional Providers ({external.length})</button>
              </div>
              <div className="cc-summary">
                {result && <><span className="cc-pill">{result.summary.qualifiedActiveMatches} full active matches</span><span className="cc-pill">{result.summary.existingMatches + result.summary.externalCandidates} total results</span></>}
              </div>
            </div>

            <div className="cc-dir">
              <div className="cc-results">
                {!result && !loading && <div className="cc-empty"><div><Radar className="w-9 h-9 mx-auto mb-3" /><b>Search the provider network</b><div>Choose a location, provider type, and any required services.</div></div></div>}
                {loading && !result && <div className="cc-empty"><div><Search className="w-9 h-9 mx-auto mb-3 animate-pulse" /><b>Searching providers…</b></div></div>}

                {result && sourceTab === "existing" && (
                  <div className="cc-group">
                    <div className="cc-group-head"><div><b>Occu-Med Network</b><div><span>Existing provider relationships and documented capabilities</span></div></div><span>{existing.length} results</span></div>
                    {existing.length === 0 ? <div className="cc-empty"><div>No matching Occu-Med providers were found.</div></div> : (
                      <div className="cc-cards">
                        {existing.map((provider) => (
                          <button key={provider.id} className={`cc-card ${selectedExisting?.id === provider.id ? "active" : ""}`} onClick={() => selectExisting(provider)}>
                            <div className="cc-card-title">{provider.providerName}</div>
                            {provider.organizationName && provider.organizationName !== provider.providerName && <div className="cc-card-sub">{provider.organizationName}</div>}
                            <div className="cc-loc"><MapPin className="w-3 h-3" />{[provider.city, provider.stateRegion, provider.country].filter(Boolean).join(", ") || "Location not listed"}</div>
                            <div className="cc-tag-row"><span className={`cc-tag ${statusClass(provider.networkStatus)}`}>{provider.networkStatus || "Unknown"}</span>{provider.pricingCount ? <span className="cc-tag cc-tag-blue">{provider.pricingCount} prices</span> : null}{provider.explicitAvailability?.length ? <span className="cc-tag cc-tag-green">{provider.explicitAvailability.length} services</span> : null}</div>
                            <div className="cc-card-foot"><span>{provider.matchedServices.length} matched services</span><span>{Math.round(provider.coverageRatio * 100)}% match</span></div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {result && sourceTab === "external" && (
                  <div className="cc-group">
                    <div className="cc-group-head"><div><b>Additional Providers</b><div><span>Potential providers located beyond the current network</span></div></div><span>{external.length} results</span></div>
                    {external.length === 0 ? <div className="cc-empty"><div>No additional providers were found.</div></div> : (
                      <div className="cc-cards">
                        {external.map((provider) => (
                          <button key={provider.id} className={`cc-card ${selectedExternal?.id === provider.id ? "active" : ""}`} onClick={() => selectExternal(provider)}>
                            <div className="cc-card-title">{provider.providerName}</div>
                            {provider.organizationName && provider.organizationName !== provider.providerName && <div className="cc-card-sub">{provider.organizationName}</div>}
                            <div className="cc-loc"><MapPin className="w-3 h-3" />{[provider.city, provider.stateRegion, provider.country].filter(Boolean).join(", ") || "Location not listed"}</div>
                            <div className="cc-tag-row"><span className="cc-tag cc-tag-blue">Potential Provider</span>{provider.specialty && <span className="cc-tag cc-tag-green">{provider.specialty}</span>}</div>
                            <div className="cc-card-foot"><span>{provider.phone || "Contact not listed"}</span><span>{provider.confidenceScore != null ? `${Math.round(provider.confidenceScore * 100)}% confidence` : ""}</span></div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <aside className="cc-detail">
                {!selected && <div className="cc-empty"><div><Stethoscope className="w-9 h-9 mx-auto mb-3" /><b>Provider details</b><div>Select a provider to inspect its documented information.</div></div></div>}
                {selected && (
                  <>
                    <div className="cc-detail-hero">
                      <h3>{selected.providerName}</h3>
                      <p>{[selected.city, selected.stateRegion, selected.country].filter(Boolean).join(", ")}</p>
                      {'networkStatus' in selected && <div className="cc-tag-row"><span className={`cc-tag ${statusClass(selected.networkStatus || "")}`}>{selected.networkStatus || "Potential Provider"}</span></div>}
                    </div>

                    <div className="cc-detail-card">
                      <h4>Contact & Location</h4>
                      <div className="cc-kv">
                        <div className="k">Organization</div><div>{selected.organizationName || "—"}</div>
                        <div className="k">Phone</div><div>{selected.phone || "—"}</div>
                        {'address' in selected && <><div className="k">Address</div><div>{selected.address || "—"} {selected.postalCode || ""}</div></>}
                        {'facilityType' in selected && <><div className="k">Facility type</div><div>{selected.facilityType || "—"}</div></>}
                      </div>
                      {'website' in selected && (selected.website || selected.sourceUrl) && <a className="cc-action" href={selected.website || selected.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink className="w-3 h-3" />Open provider website</a>}
                    </div>

                    {selectedExisting && (
                      <>
                        <div className="cc-detail-card"><h4>Documented Services</h4><div className="cc-service-list">{selectedExisting.services.length ? selectedExisting.services.slice(0, 40).map((service) => <span className="cc-tag cc-tag-blue" key={service}>{service}</span>) : <span className="cc-card-sub">No services are documented.</span>}</div></div>
                        <div className="cc-detail-card">
                          <h4>Pricing & Availability</h4>
                          {intelLoading && <div className="cc-card-sub">Loading provider details…</div>}
                          {!intelLoading && intelligence && (
                            <>
                              <div className="cc-card-sub">{intelligence.pricingCount} pricing records · {intelligence.availabilityCount} documented services</div>
                              {intelligence.pricing.slice(0, 12).map((item, index) => <div className="cc-intel-row" key={`${item.componentName}-${index}`}><div>{item.componentName}</div><div className="cc-price">{money(item.numericPrice)}</div></div>)}
                              {intelligence.availability.length > 0 && <div className="cc-service-list" style={{ marginTop: 8 }}>{intelligence.availability.slice(0, 30).map((item, index) => <span className="cc-tag cc-tag-green" key={`${item.componentName}-${index}`}>{item.componentName}</span>)}</div>}
                            </>
                          )}
                        </div>
                      </>
                    )}

                    {selectedExternal && (
                      <div className="cc-detail-card"><h4>Provider Information</h4><div className="cc-kv"><div className="k">Type</div><div>{selectedExternal.providerType || "—"}</div><div className="k">Specialty</div><div>{selectedExternal.specialty || "—"}</div></div>{selectedExternal.evidenceText && <p className="cc-card-sub" style={{ marginTop: 10, lineHeight: 1.5 }}>{selectedExternal.evidenceText}</p>}</div>
                    )}
                  </>
                )}
              </aside>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
