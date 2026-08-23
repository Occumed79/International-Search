import { useEffect, useMemo, useState, type ElementType } from "react";
import {
  Activity,
  BadgeCheck,
  Building2,
  CheckCircle2,
  CircleAlert,
  Database,
  DollarSign,
  ExternalLink,
  Globe2,
  MapPin,
  Phone,
  Radar,
  Search,
  SlidersHorizontal,
  Stethoscope,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface NetworkStats {
  total: number;
  activeAgreements: number;
  serviceTagged: number;
  gpsReady: number;
  pricingAvailable: number;
  pricingRecords: number;
  availabilityLinks: number;
  pricedClinics: number;
  availabilityClinics: number;
  importedAt: string | null;
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
  latitude?: number;
  longitude?: number;
  phone?: string;
  services: string[];
  lastAppointment?: string;
  pricingAvailable?: boolean;
  pricingCount?: number;
  explicitAvailability?: string[];
  activity2026?: string;
  matchedServices: string[];
  missingServices: string[];
  coverageRatio: number;
  source: "existing_network";
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
  sourceType?: string;
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
    lineItemCreated?: string;
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
  serviceTagged: 0,
  gpsReady: 0,
  pricingAvailable: 0,
  pricingRecords: 0,
  availabilityLinks: 0,
  pricedClinics: 0,
  availabilityClinics: 0,
  importedAt: null,
};

const COUNTRIES = [
  "United States", "Canada", "Mexico", "United Kingdom", "Germany", "France", "Spain", "Italy",
  "Portugal", "Poland", "Netherlands", "Ireland", "Turkey", "United Arab Emirates", "Kuwait",
  "Saudi Arabia", "Qatar", "Australia", "New Zealand", "Japan", "South Korea", "Singapore",
  "Thailand", "Philippines", "Malaysia", "India", "South Africa", "Brazil", "Argentina", "Chile", "Colombia",
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

const SERVICE_CHIPS = ["Physical", "Audiogram", "PFT", "EKG", "CBC", "Dental", "Laboratory", "Imaging"];

function formatMoney(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusClass(value?: string): string {
  const normalized = (value || "").toLowerCase();
  if (normalized.includes("active")) return "cc-tag cc-tag-green";
  if (normalized.includes("new") || normalized.includes("2026")) return "cc-tag cc-tag-blue";
  if (normalized.includes("expired")) return "cc-tag cc-tag-red";
  return "cc-tag cc-tag-amber";
}

function MiniKpi({ icon: Icon, value, label }: { icon: ElementType; value: string; label: string }) {
  return (
    <div className="cc-kpi">
      <Icon className="cc-kpi-icon" />
      <div>
        <b>{value}</b>
        <span>{label}</span>
      </div>
    </div>
  );
}

export function CommandCenter() {
  const { toast } = useToast();
  const [stats, setStats] = useState<NetworkStats>(EMPTY_STATS);
  const [query, setQuery] = useState("Occupational Health");
  const [providerType, setProviderType] = useState("occupational_health");
  const [country, setCountry] = useState("United States");
  const [city, setCity] = useState("");
  const [stateRegion, setStateRegion] = useState("");
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

  const services = useMemo(
    () => servicesText.split(/[\n,;|]+/).map((item) => item.trim()).filter(Boolean),
    [servicesText],
  );

  useEffect(() => {
    void (async () => {
      try {
        const [networkResponse, intelligenceResponse] = await Promise.all([
          fetch("/api/network/stats"),
          fetch("/api/network/intelligence-stats"),
        ]);
        const network = networkResponse.ok ? await networkResponse.json() : {};
        const intel = intelligenceResponse.ok ? await intelligenceResponse.json() : {};
        setStats({ ...EMPTY_STATS, ...network, ...intel, importedAt: network.importedAt || intel.importedAt || null });
      } catch {
        // The workspace remains usable while a database connection is being restored.
      }
    })();
  }, []);

  const toggleService = (service: string) => {
    const current = servicesText.split(/[\n,;|]+/).map((item) => item.trim()).filter(Boolean);
    const exists = current.some((item) => item.toLowerCase() === service.toLowerCase());
    setServicesText(exists ? current.filter((item) => item.toLowerCase() !== service.toLowerCase()).join(", ") : [...current, service].join(", "));
  };

  const loadIntelligence = async (provider: ExistingProvider) => {
    setIntelligence(null);
    if (!provider.externalId) return;
    setIntelLoading(true);
    try {
      const response = await fetch(`/api/network/intelligence/${provider.externalId}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Provider intelligence lookup failed");
      setIntelligence(payload as ProviderIntelligence);
    } catch (error) {
      toast({
        title: "Could not load provider intelligence",
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
      if (!response.ok) throw new Error(payload.error || "Provider sourcing search failed");
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
        description: error instanceof Error ? error.message : "Provider sourcing search failed.",
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
        .cc-page{--cc-bg:#eef3f7;--cc-bg2:#f9fbfd;--cc-glass:rgba(255,255,255,.66);--cc-glass2:rgba(255,255,255,.86);--cc-line:rgba(255,255,255,.94);--cc-line2:#d7e0e8;--cc-ink:#182433;--cc-muted:#6c7988;--cc-blue:#397ec1;--cc-blue2:#75aee0;--cc-red:#b6545f;--cc-amber:#b98335;--cc-green:#4c8d7b;--cc-shadow:0 18px 55px rgba(48,65,88,.13),0 3px 12px rgba(48,65,88,.07);height:100%;min-height:0;color:var(--cc-ink);background:radial-gradient(circle at 8% 2%,rgba(151,199,234,.34),transparent 28%),radial-gradient(circle at 92% 3%,rgba(237,244,249,.94),transparent 25%),radial-gradient(circle at 75% 95%,rgba(183,214,235,.23),transparent 28%),linear-gradient(180deg,#fbfcfd,#edf2f6 45%,#dfe7ed);overflow:hidden;font-family:Inter,-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif}
        .cc-page *{box-sizing:border-box}.cc-glass{background:var(--cc-glass);border:1px solid var(--cc-line);box-shadow:var(--cc-shadow);backdrop-filter:blur(24px) saturate(1.18);-webkit-backdrop-filter:blur(24px) saturate(1.18)}
        .cc-app{height:100%;padding:12px;display:grid;grid-template-columns:310px minmax(0,1fr);gap:12px;overflow:hidden}.cc-sidebar{border-radius:30px;padding:15px;min-height:0;overflow:auto}.cc-brand{padding:16px;border-radius:22px;background:linear-gradient(180deg,rgba(255,255,255,.88),rgba(255,255,255,.54));border:1px solid #fff}.cc-brand-top{display:flex;gap:11px;align-items:center}.cc-mark{width:42px;height:42px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(145deg,#fff,#dbe8f2);color:#315f88;box-shadow:inset 0 1px 0 #fff,0 7px 16px rgba(47,75,103,.12)}.cc-brand h1{margin:0;font-size:16px;letter-spacing:-.025em}.cc-brand p{margin:4px 0 0;color:var(--cc-muted);font-size:10px;line-height:1.4}.cc-section-label{margin:16px 4px 8px;font-size:10px;text-transform:uppercase;letter-spacing:.13em;font-weight:800;color:#728091}.cc-field{margin-top:8px}.cc-field label{display:block;margin:0 0 5px 4px;font-size:10px;color:var(--cc-muted)}.cc-field input,.cc-field select{width:100%;height:40px;border:1px solid #fff;border-radius:13px;background:rgba(255,255,255,.72);padding:0 11px;color:var(--cc-ink);outline:none;box-shadow:inset 0 1px 0 #fff}.cc-field input:focus,.cc-field select:focus{border-color:#a9cce7;box-shadow:0 0 0 3px rgba(57,126,193,.08)}.cc-search-input{position:relative}.cc-search-input svg{position:absolute;right:12px;top:12px;width:15px;height:15px;color:#8290a0}.cc-service-chips{display:flex;flex-wrap:wrap;gap:6px}.cc-service-chip{border:1px solid rgba(255,255,255,.95);background:rgba(255,255,255,.62);border-radius:999px;padding:6px 9px;color:#506072;font-size:10px;cursor:pointer}.cc-service-chip.on{background:#e7f2fa;border-color:#bfd8e9;color:#275d86;box-shadow:0 4px 12px rgba(57,126,193,.10)}.cc-seg{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;padding:5px;border-radius:15px;background:rgba(255,255,255,.48);border:1px solid #fff}.cc-seg button{border:0;border-radius:11px;background:transparent;height:32px;color:var(--cc-muted);font-size:10px;font-weight:700;cursor:pointer}.cc-seg button.on{background:rgba(255,255,255,.96);color:var(--cc-ink);box-shadow:0 4px 12px rgba(56,78,100,.11)}.cc-find{width:100%;height:42px;margin-top:12px;border:0;border-radius:14px;background:linear-gradient(180deg,#4a8bc7,#397ec1);color:white;font-size:11px;font-weight:800;cursor:pointer;box-shadow:0 8px 18px rgba(57,126,193,.22);display:flex;align-items:center;justify-content:center;gap:7px}.cc-find:disabled{opacity:.55}.cc-mini-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.cc-mini{padding:10px;border-radius:15px;background:rgba(255,255,255,.58);border:1px solid #fff}.cc-mini b{display:block;font-size:17px;letter-spacing:-.03em}.cc-mini span{font-size:8.5px;color:var(--cc-muted);text-transform:uppercase;letter-spacing:.07em}
        .cc-main{min-width:0;min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr);gap:12px;overflow:hidden}.cc-top{border-radius:28px;padding:14px 16px;display:flex;gap:15px;align-items:center;justify-content:space-between}.cc-headline h2{margin:0;font-size:23px;letter-spacing:-.04em}.cc-headline p{margin:4px 0 0;color:var(--cc-muted);font-size:10.5px}.cc-kpis{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.cc-kpi{min-width:116px;padding:9px 11px;border-radius:16px;background:rgba(255,255,255,.62);border:1px solid #fff;display:flex;align-items:center;gap:8px}.cc-kpi-icon{width:16px;height:16px;color:#4c80ad}.cc-kpi b{display:block;font-size:16px;letter-spacing:-.03em}.cc-kpi span{display:block;font-size:8px;color:var(--cc-muted);text-transform:uppercase;letter-spacing:.08em;margin-top:1px}
        .cc-workspace{border-radius:28px;overflow:hidden;min-height:0;height:100%;display:grid;grid-template-rows:auto minmax(0,1fr)}.cc-toolbar{min-height:52px;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,.9);display:flex;justify-content:space-between;align-items:center;gap:10px}.cc-tabs{display:flex;gap:5px;padding:5px;border-radius:15px;background:rgba(255,255,255,.48);border:1px solid #fff}.cc-tabs button{border:0;border-radius:11px;background:transparent;height:32px;padding:0 11px;color:var(--cc-muted);font-weight:750;font-size:10px;cursor:pointer}.cc-tabs button.on{background:#fff;color:var(--cc-ink);box-shadow:0 4px 12px rgba(56,78,100,.10)}.cc-summary{font-size:9.5px;color:var(--cc-muted);display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.cc-pill{padding:5px 8px;border-radius:999px;background:rgba(255,255,255,.62);border:1px solid #fff}.cc-dir{min-height:0;height:100%;display:grid;grid-template-columns:minmax(0,1fr) 365px;overflow:hidden}.cc-results{min-width:0;min-height:0;border-right:1px solid rgba(255,255,255,.9);overflow:auto;padding:10px 12px 26px}.cc-result-group{border-radius:19px;background:rgba(255,255,255,.38);border:1px solid rgba(255,255,255,.86);overflow:hidden}.cc-group-head{position:sticky;top:0;z-index:2;padding:10px 12px;background:rgba(248,251,253,.92);backdrop-filter:blur(18px);border-bottom:1px solid rgba(255,255,255,.92);display:flex;justify-content:space-between;align-items:center}.cc-group-head b{font-size:12px}.cc-group-head span{font-size:9px;color:var(--cc-muted)}.cc-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(235px,1fr));gap:8px;padding:9px}.cc-card{padding:11px;border-radius:16px;background:linear-gradient(180deg,rgba(255,255,255,.88),rgba(255,255,255,.60));border:1px solid #fff;box-shadow:0 5px 14px rgba(48,66,88,.06);cursor:pointer;transition:.13s;text-align:left;color:var(--cc-ink)}.cc-card:hover{transform:translateY(-1px);box-shadow:0 8px 18px rgba(48,66,88,.10)}.cc-card.active{outline:2px solid rgba(57,126,193,.33)}.cc-card-title{font-size:12px;font-weight:850;line-height:1.3}.cc-card-sub{font-size:9.5px;color:var(--cc-muted);margin-top:3px}.cc-loc{margin-top:5px;color:#536173;font-size:9.5px;line-height:1.35;display:flex;gap:4px;align-items:center}.cc-tag-row{display:flex;gap:4px;flex-wrap:wrap;margin-top:7px}.cc-tag{font-size:8.2px;border-radius:999px;padding:3px 6px;border:1px solid}.cc-tag-green{background:#e8f4f0;color:#397362;border-color:#cfe5dd}.cc-tag-blue{background:#edf5fa;color:#32658b;border-color:#d2e5f1}.cc-tag-red{background:#f8ecee;color:#8b414a;border-color:#edd5d8}.cc-tag-amber{background:#faf2e5;color:#8b652f;border-color:#ebdcc2}.cc-card-foot{display:flex;justify-content:space-between;gap:6px;margin-top:7px;color:#7b8795;font-size:8.8px}.cc-empty{height:100%;min-height:260px;display:grid;place-items:center;text-align:center;color:var(--cc-muted);padding:40px}.cc-empty svg{width:34px;height:34px;margin:0 auto 10px;color:#7da6c7}.cc-empty b{display:block;color:var(--cc-ink);font-size:14px;margin-bottom:5px}.cc-detail{min-height:0;height:100%;overflow:auto;padding:12px 12px 28px}.cc-detail-hero{padding:14px;border-radius:20px;background:linear-gradient(180deg,rgba(255,255,255,.90),rgba(255,255,255,.60));border:1px solid #fff}.cc-detail-hero h3{margin:0;font-size:18px;letter-spacing:-.035em;line-height:1.25}.cc-detail-hero p{margin:5px 0 0;color:var(--cc-muted);font-size:10px}.cc-detail-card{margin-top:9px;padding:12px;border-radius:17px;background:rgba(255,255,255,.58);border:1px solid #fff}.cc-detail-card h4{margin:0 0 8px;font-size:9px;color:#748293;text-transform:uppercase;letter-spacing:.11em}.cc-kv{display:grid;grid-template-columns:86px 1fr;gap:5px 8px;font-size:10px;line-height:1.4}.cc-kv .k{color:#8190a0}.cc-kv .v{word-break:break-word}.cc-service-list{display:flex;gap:5px;flex-wrap:wrap}.cc-action{margin-top:9px;height:32px;border-radius:10px;border:1px solid #fff;background:rgba(255,255,255,.78);color:#466076;font-size:10px;font-weight:750;padding:0 10px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:5px}.cc-intel-row{padding:8px 0;border-top:1px solid rgba(128,145,162,.16);font-size:9.5px}.cc-intel-row:first-of-type{border-top:0}.cc-price{font-weight:850;color:#2f688f}.cc-radius{display:flex;align-items:center;gap:8px}.cc-radius input{flex:1}.cc-radius span{width:42px;text-align:right;font-size:10px;font-weight:700;color:#51677b}
        @media(max-width:1100px){.cc-app{grid-template-columns:260px minmax(0,1fr)}.cc-dir{grid-template-columns:minmax(0,1fr) 320px}.cc-kpi{min-width:98px}}
        @media(max-width:850px){.cc-app{display:block;overflow:auto}.cc-sidebar{margin-bottom:12px}.cc-main{height:900px}.cc-top{align-items:flex-start;flex-direction:column}.cc-kpis{justify-content:flex-start}.cc-dir{grid-template-columns:1fr}.cc-detail{border-top:1px solid #fff;max-height:420px}.cc-results{border-right:0}.cc-workspace{min-height:780px}}
      `}</style>

      <div className="cc-app">
        <aside className="cc-sidebar cc-glass">
          <div className="cc-brand">
            <div className="cc-brand-top">
              <div className="cc-mark"><Radar className="w-5 h-5" /></div>
              <div>
                <h1>Network Command Center</h1>
                <p>Added to Global Intelligence · Portal 5<br />Occu-Med network + worldwide sourcing</p>
              </div>
            </div>
          </div>

          <div className="cc-section-label">Provider search</div>
          <div className="cc-field cc-search-input">
            <label>Keywords / service</label>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Occupational health, audiogram…" />
            <Search />
          </div>
          <div className="cc-field">
            <label>Provider type</label>
            <select value={providerType} onChange={(event) => setProviderType(event.target.value)}>
              {PROVIDER_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>
          <div className="cc-field">
            <label>Country</label>
            <select value={country} onChange={(event) => setCountry(event.target.value)}>
              {COUNTRIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div className="cc-field">
            <label>City</label>
            <input value={city} onChange={(event) => setCity(event.target.value)} placeholder="City" />
          </div>
          <div className="cc-field">
            <label>State / region</label>
            <input value={stateRegion} onChange={(event) => setStateRegion(event.target.value)} placeholder="MT, ON, QLD…" />
          </div>

          <div className="cc-section-label">Required services</div>
          <div className="cc-service-chips">
            {SERVICE_CHIPS.map((service) => {
              const active = services.some((item) => item.toLowerCase() === service.toLowerCase());
              return <button key={service} className={`cc-service-chip ${active ? "on" : ""}`} onClick={() => toggleService(service)}>{service}</button>;
            })}
          </div>
          <div className="cc-field">
            <input value={servicesText} onChange={(event) => setServicesText(event.target.value)} placeholder="Add specific services…" />
          </div>

          <div className="cc-section-label">Outside network</div>
          <div className="cc-seg">
            {([['off', 'Off'], ['gaps', 'If gaps'], ['always', 'Always']] as const).map(([value, label]) => (
              <button key={value} className={outsideMode === value ? "on" : ""} onClick={() => setOutsideMode(value)}>{label}</button>
            ))}
          </div>
          <div className="cc-field">
            <label>Outside radius</label>
            <div className="cc-radius">
              <input type="range" min={5} max={100} step={5} value={radiusMiles} onChange={(event) => setRadiusMiles(Number(event.target.value))} />
              <span>{radiusMiles} mi</span>
            </div>
          </div>

          <button className="cc-find" disabled={loading} onClick={() => void runSearch()}>
            {loading ? <Activity className="w-4 h-4 animate-pulse" /> : <Search className="w-4 h-4" />}
            {loading ? "Searching…" : "Search network"}
          </button>

          <div className="cc-section-label">Live network</div>
          <div className="cc-mini-grid">
            <div className="cc-mini"><b>{stats.total.toLocaleString()}</b><span>Locations</span></div>
            <div className="cc-mini"><b>{stats.activeAgreements.toLocaleString()}</b><span>Agreements</span></div>
            <div className="cc-mini"><b>{stats.pricedClinics.toLocaleString()}</b><span>Priced clinics</span></div>
            <div className="cc-mini"><b>{stats.availabilityClinics.toLocaleString()}</b><span>Availability</span></div>
          </div>
        </aside>

        <main className="cc-main">
          <section className="cc-top cc-glass">
            <div className="cc-headline">
              <h2>Occu-Med Network Command Center</h2>
              <p>The HTML command-center experience, integrated as an additional workspace inside the existing app.</p>
            </div>
            <div className="cc-kpis">
              <MiniKpi icon={Building2} value={stats.total.toLocaleString()} label="Network" />
              <MiniKpi icon={BadgeCheck} value={stats.activeAgreements.toLocaleString()} label="Active agreements" />
              <MiniKpi icon={DollarSign} value={stats.pricingRecords.toLocaleString()} label="Pricing lines" />
              <MiniKpi icon={Database} value={stats.availabilityLinks.toLocaleString()} label="Availability" />
            </div>
          </section>

          <section className="cc-workspace cc-glass">
            <div className="cc-toolbar">
              <div className="cc-tabs">
                <button className={sourceTab === "existing" ? "on" : ""} onClick={() => setSourceTab("existing")}>Existing Network ({existing.length})</button>
                <button className={sourceTab === "external" ? "on" : ""} onClick={() => setSourceTab("external")}>Outside Network ({external.length})</button>
              </div>
              <div className="cc-summary">
                {result ? (
                  <>
                    <span className="cc-pill">{result.summary.qualifiedActiveMatches} full active matches</span>
                    {result.summary.searchedOutsideNetwork && <span className="cc-pill">Keenable {result.externalSources.keenable} · TinyFish {result.externalSources.tinyfish} · Exa {result.externalSources.exa}</span>}
                    {result.fallbackUsed && <span className="cc-pill">Exa fallback used</span>}
                  </>
                ) : <span className="cc-pill">Search your network first; expand only when needed</span>}
              </div>
            </div>

            <div className="cc-dir">
              <div className="cc-results">
                {!result && !loading && (
                  <div className="cc-empty">
                    <div>
                      <Globe2 />
                      <b>Search the worldwide network</b>
                      <span>Use the filter rail on the left. Existing Occu-Med providers, agreements, documented services, pricing, and availability remain the first source.</span>
                    </div>
                  </div>
                )}
                {loading && !result && (
                  <div className="cc-empty"><div><Activity className="animate-pulse" /><b>Searching the network…</b><span>Checking existing coverage before outside discovery.</span></div></div>
                )}
                {result && sourceTab === "existing" && (
                  <div className="cc-result-group">
                    <div className="cc-group-head"><div><b>Existing Occu-Med Network</b><div><span>Agreement, service and coverage intelligence</span></div></div><span>{existing.length.toLocaleString()} results</span></div>
                    {existing.length === 0 ? <div className="cc-empty"><div><CircleAlert /><b>No existing network matches</b><span>Outside discovery can fill the gap when enabled.</span></div></div> : (
                      <div className="cc-cards">
                        {existing.slice(0, 150).map((provider) => {
                          const active = selectedExisting?.id === provider.id;
                          const pct = Math.round((provider.coverageRatio || 0) * 100);
                          return (
                            <button key={provider.id} className={`cc-card ${active ? "active" : ""}`} onClick={() => selectExisting(provider)}>
                              <div className="cc-card-title">{provider.providerName}</div>
                              {provider.organizationName && provider.organizationName !== provider.providerName && <div className="cc-card-sub">{provider.organizationName}</div>}
                              <div className="cc-loc"><MapPin className="w-3 h-3" />{[provider.city, provider.stateRegion, provider.country].filter(Boolean).join(", ") || "Location not documented"}</div>
                              <div className="cc-tag-row">
                                <span className={statusClass(provider.networkStatus)}>{provider.networkStatus || "Unknown"}</span>
                                {provider.pricingAvailable && <span className="cc-tag cc-tag-blue">Pricing</span>}
                                {(provider.explicitAvailability?.length ?? 0) > 0 && <span className="cc-tag cc-tag-green">Availability</span>}
                              </div>
                              <div className="cc-card-foot"><span>{provider.services?.length ?? 0} services</span>{services.length > 0 && <span>{pct}% requirement match</span>}</div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                {result && sourceTab === "external" && (
                  <div className="cc-result-group">
                    <div className="cc-group-head"><div><b>Outside Network Discovery</b><div><span>Keenable + TinyFish primary · Exa fallback</span></div></div><span>{external.length.toLocaleString()} candidates</span></div>
                    {external.length === 0 ? <div className="cc-empty"><div><CircleAlert /><b>No outside candidates returned</b><span>Try broadening location, radius, or provider type.</span></div></div> : (
                      <div className="cc-cards">
                        {external.slice(0, 150).map((provider) => {
                          const active = selectedExternal?.id === provider.id;
                          return (
                            <button key={provider.id} className={`cc-card ${active ? "active" : ""}`} onClick={() => selectExternal(provider)}>
                              <div className="cc-card-title">{provider.providerName}</div>
                              {provider.organizationName && provider.organizationName !== provider.providerName && <div className="cc-card-sub">{provider.organizationName}</div>}
                              <div className="cc-loc"><MapPin className="w-3 h-3" />{[provider.city, provider.stateRegion, provider.country].filter(Boolean).join(", ") || "Location not documented"}</div>
                              <div className="cc-tag-row"><span className="cc-tag cc-tag-blue">{provider.sourceType || "Outside discovery"}</span>{typeof provider.confidenceScore === "number" && <span className="cc-tag cc-tag-green">{Math.round(provider.confidenceScore * 100)}% confidence</span>}</div>
                              <div className="cc-card-foot"><span>{provider.specialty || provider.providerType || "Provider candidate"}</span><span>Review evidence</span></div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <aside className="cc-detail">
                {!selected && (
                  <div className="cc-empty"><div><Stethoscope /><b>Provider intelligence panel</b><span>Select a provider to inspect documented services, agreement status, pricing and availability.</span></div></div>
                )}
                {selectedExisting && (
                  <>
                    <div className="cc-detail-hero">
                      <h3>{selectedExisting.providerName}</h3>
                      <p>{selectedExisting.organizationName || selectedExisting.facilityType || "Existing Occu-Med network provider"}</p>
                      <div className="cc-tag-row"><span className={statusClass(selectedExisting.networkStatus)}>{selectedExisting.networkStatus || "Unknown"}</span>{selectedExisting.pricingAvailable && <span className="cc-tag cc-tag-blue">Pricing documented</span>}</div>
                    </div>
                    <div className="cc-detail-card">
                      <h4>Provider profile</h4>
                      <div className="cc-kv">
                        <span className="k">Location</span><span className="v">{[selectedExisting.city, selectedExisting.stateRegion, selectedExisting.country].filter(Boolean).join(", ") || "—"}</span>
                        <span className="k">Address</span><span className="v">{[selectedExisting.address, selectedExisting.postalCode].filter(Boolean).join(" ") || "—"}</span>
                        <span className="k">Phone</span><span className="v">{selectedExisting.phone || "—"}</span>
                        <span className="k">Last appt.</span><span className="v">{selectedExisting.lastAppointment || "—"}</span>
                        <span className="k">2026 activity</span><span className="v">{selectedExisting.activity2026 || "—"}</span>
                      </div>
                    </div>
                    <div className="cc-detail-card">
                      <h4>Documented services</h4>
                      <div className="cc-service-list">{selectedExisting.services?.length ? selectedExisting.services.slice(0, 30).map((service) => <span key={service} className="cc-tag cc-tag-blue">{service}</span>) : <span className="cc-card-sub">No structured services documented.</span>}</div>
                    </div>
                    <div className="cc-detail-card">
                      <h4>Pricing & availability intelligence</h4>
                      {intelLoading ? <div className="cc-card-sub"><Activity className="inline w-3 h-3 mr-1 animate-pulse" />Loading provider intelligence…</div> : intelligence ? (
                        <>
                          <div className="cc-kv"><span className="k">Price lines</span><span className="v"><b>{intelligence.pricingCount}</b></span><span className="k">Availability</span><span className="v"><b>{intelligence.availabilityCount}</b></span></div>
                          {intelligence.pricing.slice(0, 8).map((item, index) => <div className="cc-intel-row" key={`${item.componentName}-${index}`}><div><b>{item.componentName}</b></div><div className="cc-price">{formatMoney(item.numericPrice)} {item.sourcePriceText && !item.numericPrice ? `· ${item.sourcePriceText}` : ""}</div></div>)}
                          {intelligence.availability.slice(0, 8).map((item, index) => <div className="cc-intel-row" key={`${item.componentName}-a-${index}`}><CheckCircle2 className="inline w-3 h-3 mr-1" style={{ color: "#4c8d7b" }} />{item.componentName}{item.componentType ? ` · ${item.componentType}` : ""}</div>)}
                        </>
                      ) : <div className="cc-card-sub">No linked pricing or availability records returned for this provider.</div>}
                    </div>
                  </>
                )}
                {selectedExternal && (
                  <>
                    <div className="cc-detail-hero">
                      <h3>{selectedExternal.providerName}</h3>
                      <p>{selectedExternal.organizationName || selectedExternal.specialty || selectedExternal.providerType || "Outside-network candidate"}</p>
                      <div className="cc-tag-row"><span className="cc-tag cc-tag-blue">{selectedExternal.sourceType || "Discovery candidate"}</span></div>
                    </div>
                    <div className="cc-detail-card">
                      <h4>Candidate profile</h4>
                      <div className="cc-kv">
                        <span className="k">Location</span><span className="v">{[selectedExternal.city, selectedExternal.stateRegion, selectedExternal.country].filter(Boolean).join(", ") || "—"}</span>
                        <span className="k">Phone</span><span className="v">{selectedExternal.phone || "—"}</span>
                        <span className="k">Specialty</span><span className="v">{selectedExternal.specialty || selectedExternal.providerType || "—"}</span>
                        <span className="k">Evidence</span><span className="v">{selectedExternal.evidenceText || "—"}</span>
                      </div>
                      {(selectedExternal.website || selectedExternal.sourceUrl) && <a className="cc-action" href={selectedExternal.website || selectedExternal.sourceUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-3 h-3" />Open source</a>}
                    </div>
                    <div className="cc-detail-card">
                      <h4>Network status</h4>
                      <div className="cc-card-sub">This provider came from outside-network discovery and has not been treated as an Occu-Med agreement provider.</div>
                    </div>
                  </>
                )}
              </aside>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
