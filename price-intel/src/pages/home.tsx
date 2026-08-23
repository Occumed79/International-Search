import { useEffect, useMemo, useState, type CSSProperties, type ElementType } from "react";
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
  Sparkles,
  Stethoscope,
  X,
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
  "United States",
  "Canada",
  "Mexico",
  "United Kingdom",
  "Germany",
  "France",
  "Spain",
  "Italy",
  "Portugal",
  "Poland",
  "Netherlands",
  "Ireland",
  "Turkey",
  "United Arab Emirates",
  "Kuwait",
  "Saudi Arabia",
  "Qatar",
  "Australia",
  "New Zealand",
  "Japan",
  "South Korea",
  "Singapore",
  "Thailand",
  "Philippines",
  "Malaysia",
  "India",
  "South Africa",
  "Brazil",
  "Argentina",
  "Chile",
  "Colombia",
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

const QUICK_SEARCHES = [
  { query: "Occupational Health", providerType: "occupational_health", country: "United States", city: "Helena", state: "MT", icon: Building2 },
  { query: "Occupational Health", providerType: "occupational_health", country: "Germany", city: "Stuttgart", state: "", icon: Building2 },
  { query: "Audiogram", providerType: "clinic", country: "Germany", city: "Stuttgart", state: "", icon: Activity },
  { query: "Clinic", providerType: "clinic", country: "Mexico", city: "Mexico City", state: "", icon: Stethoscope },
  { query: "Dental", providerType: "dental", country: "Spain", city: "Rota", state: "", icon: Building2 },
  { query: "Laboratory", providerType: "lab", country: "Canada", city: "Toronto", state: "ON", icon: Activity },
  { query: "Hospital", providerType: "hospital", country: "Poland", city: "Słupsk", state: "", icon: Building2 },
  { query: "Urgent Care", providerType: "urgent_care", country: "Australia", city: "Townsville", state: "QLD", icon: Activity },
];

function glassStyle(alpha = 0.58): CSSProperties {
  return {
    background: `rgba(18, 8, 36, ${alpha})`,
    border: "1px solid rgba(180, 100, 255, 0.16)",
    backdropFilter: "blur(24px)",
    WebkitBackdropFilter: "blur(24px)",
    boxShadow: "0 10px 34px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.04)",
  };
}

function StatCard({ icon: Icon, label, value, helper }: { icon: ElementType; label: string; value: string; helper?: string }) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-2xl" style={glassStyle(0.52)}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(160,80,255,0.13)" }}>
        <Icon className="w-4 h-4" style={{ color: "rgba(205,150,255,0.88)" }} />
      </div>
      <div className="min-w-0">
        <div className="text-xl font-bold leading-none text-white/90">{value}</div>
        <div className="text-xs mt-1 text-violet-200/55">{label}</div>
        {helper && <div className="text-[10px] mt-0.5 text-white/25 truncate">{helper}</div>}
      </div>
    </div>
  );
}

function CoverageBar({ ratio }: { ratio: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  return (
    <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
      <div className="h-full rounded-full bg-violet-400/80" style={{ width: `${pct}%` }} />
    </div>
  );
}

function StatusBadge({ value }: { value: string }) {
  const active = value === "Active Agreement";
  const fresh = value.includes("NEW") || value.includes("2026 New");
  const expired = value === "Expired";
  const cls = active
    ? "bg-emerald-400/10 border-emerald-300/20 text-emerald-200"
    : fresh
      ? "bg-cyan-400/10 border-cyan-300/20 text-cyan-200"
      : expired
        ? "bg-rose-400/10 border-rose-300/20 text-rose-200"
        : "bg-amber-400/10 border-amber-300/20 text-amber-100";
  return <span className={`inline-flex px-2 py-1 rounded-full border text-[10px] font-semibold ${cls}`}>{value}</span>;
}

function formatMoney(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function Home() {
  const { toast } = useToast();
  const [stats, setStats] = useState<NetworkStats>(EMPTY_STATS);
  const [query, setQuery] = useState("Occupational Health");
  const [providerType, setProviderType] = useState("occupational_health");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [country, setCountry] = useState("United States");
  const [radiusMiles, setRadiusMiles] = useState(25);
  const [servicesText, setServicesText] = useState("");
  const [outsideMode, setOutsideMode] = useState<"off" | "gaps" | "always">("gaps");
  const [showOptions, setShowOptions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SourcingResponse | null>(null);
  const [tab, setTab] = useState<"existing" | "external">("existing");
  const [intelProvider, setIntelProvider] = useState<ExistingProvider | null>(null);
  const [intelligence, setIntelligence] = useState<ProviderIntelligence | null>(null);
  const [intelLoading, setIntelLoading] = useState(false);

  const services = useMemo(
    () => servicesText.split(/[\n,;|]+/).map((item) => item.trim()).filter(Boolean),
    [servicesText],
  );

  const refreshStats = async () => {
    try {
      const [networkResponse, intelligenceResponse] = await Promise.all([
        fetch("/api/network/stats"),
        fetch("/api/network/intelligence-stats"),
      ]);
      const network = networkResponse.ok ? await networkResponse.json() : {};
      const intel = intelligenceResponse.ok ? await intelligenceResponse.json() : {};
      setStats({ ...EMPTY_STATS, ...network, ...intel, importedAt: network.importedAt || intel.importedAt || null });
    } catch {
      // Keep the interface usable if stats are temporarily unavailable.
    }
  };

  useEffect(() => {
    void refreshStats();
  }, []);

  const runSearch = async (override?: Partial<{ query: string; providerType: string; city: string; state: string; country: string }>) => {
    const nextQuery = override?.query ?? query;
    const nextProviderType = override?.providerType ?? providerType;
    const nextCity = override?.city ?? city;
    const nextState = override?.state ?? state;
    const nextCountry = override?.country ?? country;
    const providerLabel = PROVIDER_TYPES.find((item) => item.value === nextProviderType)?.label || "Clinic";
    const effectiveQuery = nextQuery.trim() || providerLabel;

    if (override) {
      setQuery(effectiveQuery);
      setProviderType(nextProviderType);
      setCity(nextCity);
      setState(nextState);
      setCountry(nextCountry);
    }

    setLoading(true);
    try {
      const response = await fetch("/api/sourcing/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: effectiveQuery,
          providerType: nextProviderType,
          city: nextCity,
          state: nextState,
          country: nextCountry,
          radiusMiles,
          services,
          includeExternal: outsideMode !== "off",
          forceExternal: outsideMode === "always",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Provider sourcing search failed");
      setResult(payload as SourcingResponse);
      setTab("existing");
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

  const loadIntelligence = async (provider: ExistingProvider) => {
    if (!provider.externalId) return;
    setIntelProvider(provider);
    setIntelligence(null);
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
      setIntelProvider(null);
    } finally {
      setIntelLoading(false);
    }
  };

  const topExisting = result?.existing.slice(0, 100) ?? [];
  const external = result?.external ?? [];
  const hasSearched = loading || result !== null;

  const searchBar = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void runSearch();
      }}
      className={`flex flex-col lg:flex-row items-stretch transition-all duration-300 ${hasSearched ? "p-1.5 gap-1.5 rounded-2xl" : "p-2.5 gap-2.5 rounded-3xl"}`}
      style={{
        background: hasSearched ? "rgba(18, 6, 36, 0.84)" : "rgba(22, 8, 42, 0.76)",
        backdropFilter: "blur(28px) saturate(160%)",
        WebkitBackdropFilter: "blur(28px) saturate(160%)",
        border: "1px solid rgba(160, 80, 255, 0.22)",
        boxShadow: "0 8px 40px rgba(0,0,0,0.50), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}
    >
      <div className="flex items-center gap-2 px-3 min-w-[190px]">
        <Building2 className="w-4 h-4 text-violet-200/45 shrink-0" />
        <select
          value={providerType}
          onChange={(event) => setProviderType(event.target.value)}
          className={`${hasSearched ? "h-10" : "h-14"} w-full bg-transparent border-0 outline-none text-sm font-semibold text-white/80 cursor-pointer`}
        >
          {PROVIDER_TYPES.map((item) => <option key={item.value} value={item.value} className="bg-[#16082a]">{item.label}</option>)}
        </select>
      </div>

      <div className="hidden lg:block w-px bg-white/10 my-2" />

      <div className="flex items-center gap-2 px-3 min-w-[175px]">
        <Globe2 className="w-4 h-4 text-violet-200/45 shrink-0" />
        <select
          value={country}
          onChange={(event) => setCountry(event.target.value)}
          className={`${hasSearched ? "h-10" : "h-14"} w-full bg-transparent border-0 outline-none text-sm font-semibold text-white/80 cursor-pointer`}
        >
          {COUNTRIES.map((item) => <option key={item} value={item} className="bg-[#16082a]">{item}</option>)}
        </select>
      </div>

      <div className="hidden lg:block w-px bg-white/10 my-2" />

      <div className="relative flex-1 flex items-center min-w-[170px]">
        <MapPin className="absolute left-4 w-4 h-4 text-violet-200/45" />
        <input
          value={city}
          onChange={(event) => setCity(event.target.value)}
          placeholder="City or region"
          className={`${hasSearched ? "h-10" : "h-14"} w-full bg-transparent border-0 outline-none pl-11 pr-3 text-sm text-white/85 placeholder:text-white/28`}
        />
      </div>

      <div className="hidden lg:block w-px bg-white/10 my-2" />

      <div className="relative flex-[1.35] flex items-center min-w-[220px]">
        <Search className="absolute left-4 w-4 h-4 text-violet-200/45" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Service, exam, or provider keywords"
          className={`${hasSearched ? "h-10" : "h-14"} w-full bg-transparent border-0 outline-none pl-11 pr-3 text-sm text-white/85 placeholder:text-white/28`}
        />
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setShowOptions((value) => !value)}
          className={`${hasSearched ? "w-10 h-10" : "w-12 h-14"} rounded-xl border border-white/8 bg-white/[0.035] text-white/45 hover:text-white/75 hover:bg-white/[0.07] transition-all flex items-center justify-center`}
          title="Requirement options"
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>
        <button
          type="submit"
          disabled={loading}
          className={`${hasSearched ? "h-10 px-5 rounded-xl" : "h-14 px-7 rounded-2xl"} bg-violet-500 hover:bg-violet-400 disabled:opacity-50 text-white font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-violet-950/30`}
        >
          {loading ? <Activity className="w-4 h-4 animate-pulse" /> : <Search className="w-4 h-4" />}
          <span>{loading ? "Searching…" : "Find providers"}</span>
        </button>
      </div>
    </form>
  );

  return (
    <div className="h-full w-full flex flex-col">
      <div
        className={`transition-all duration-500 flex flex-col items-center px-5 md:px-7 ${hasSearched ? "py-4 flex-none z-20" : "flex-1 justify-center py-10 overflow-y-auto"}`}
        style={hasSearched ? {
          background: "rgba(14,4,28,0.82)",
          backdropFilter: "blur(28px)",
          WebkitBackdropFilter: "blur(28px)",
          borderBottom: "1px solid rgba(160,80,255,0.14)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.40)",
        } : undefined}
      >
        {!hasSearched && (
          <div className="text-center mb-9 max-w-4xl mx-auto space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold"
              style={{
                background: "rgba(160,80,255,0.12)",
                color: "rgba(210,160,255,0.92)",
                border: "1px solid rgba(160,80,255,0.24)",
              }}
            >
              <Radar className="w-3.5 h-3.5" />
              <span>Occu-Med Network First · Outside Discovery Only When Needed</span>
            </div>

            <h1
              className="font-bold tracking-tight leading-tight"
              style={{
                fontSize: "clamp(2.5rem, 6vw, 4.6rem)",
                background: "linear-gradient(135deg, #fff 0%, rgba(205,145,255,0.92) 52%, rgba(255,165,85,0.82) 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Find Healthcare Providers<br />Worldwide
            </h1>

            <p className="text-base md:text-lg max-w-2xl mx-auto leading-relaxed text-white/50">
              Search the existing Occu-Med network, agreements, documented services and pricing first.
              When coverage is missing, Keenable and TinyFish find new candidates; Exa stays fallback-only.
            </p>
          </div>
        )}

        <div className={`w-full ${hasSearched ? "max-w-[1500px]" : "max-w-5xl"} transition-all duration-500`}>
          {searchBar}

          {showOptions && (
            <div className="mt-2 rounded-2xl p-4 grid grid-cols-1 lg:grid-cols-12 gap-3 animate-in fade-in slide-in-from-top-2 duration-200" style={glassStyle(0.94)}>
              <label className="lg:col-span-2">
                <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-white/35 block mb-1.5">State / region</span>
                <input value={state} onChange={(event) => setState(event.target.value)} placeholder="MT, ON, QLD…" className="w-full h-10 rounded-xl bg-black/20 border border-white/10 px-3 text-sm text-white/80 outline-none focus:border-violet-300/30" />
              </label>
              <label className="lg:col-span-5">
                <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-white/35 block mb-1.5">Required services</span>
                <input value={servicesText} onChange={(event) => setServicesText(event.target.value)} placeholder="Physical, audiogram, PFT, EKG, CBC…" className="w-full h-10 rounded-xl bg-black/20 border border-white/10 px-3 text-sm text-white/80 outline-none focus:border-violet-300/30" />
              </label>
              <div className="lg:col-span-3">
                <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-white/35 block mb-1.5">Outside-network search</span>
                <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-black/20 border border-white/10">
                  {([['off', 'Off'], ['gaps', 'If gaps'], ['always', 'Always']] as const).map(([value, label]) => (
                    <button key={value} type="button" onClick={() => setOutsideMode(value)} className={`h-8 rounded-lg text-[11px] font-semibold transition-all ${outsideMode === value ? "bg-violet-500/25 text-violet-100 border border-violet-300/20" : "text-white/35 hover:text-white/60"}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="lg:col-span-2">
                <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-white/35 block mb-1.5">Outside radius</span>
                <div className="h-10 rounded-xl bg-black/20 border border-white/10 px-3 flex items-center gap-2">
                  <input type="range" min={5} max={100} step={5} value={radiusMiles} onChange={(event) => setRadiusMiles(Number(event.target.value))} className="min-w-0 flex-1" />
                  <span className="text-[11px] font-semibold text-violet-100/65 w-10 text-right">{radiusMiles} mi</span>
                </div>
              </label>
            </div>
          )}
        </div>

        {!hasSearched && (
          <div className="w-full max-w-4xl mx-auto mt-10 space-y-9 animate-in fade-in slide-in-from-bottom-8 duration-700 pb-10">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard icon={Building2} label="Network Locations" value={stats.total.toLocaleString()} />
              <StatCard icon={BadgeCheck} label="Active Agreements" value={stats.activeAgreements.toLocaleString()} />
              <StatCard icon={DollarSign} label="Pricing Line Items" value={stats.pricingRecords.toLocaleString()} helper={`${stats.pricedClinics.toLocaleString()} linked clinics`} />
              <StatCard icon={Database} label="Availability Links" value={stats.availabilityLinks.toLocaleString()} helper={`${stats.availabilityClinics.toLocaleString()} linked clinics`} />
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-violet-200/45">
                <Stethoscope className="w-4 h-4" />
                <span>Quick searches</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {QUICK_SEARCHES.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={`${item.query}-${item.city}-${item.country}`}
                      onClick={() => void runSearch(item)}
                      className="p-3.5 text-left transition-all group flex items-start gap-2.5 rounded-xl hover:-translate-y-0.5"
                      style={{
                        background: "rgba(25,10,45,0.55)",
                        border: "1px solid rgba(160,80,255,0.14)",
                        backdropFilter: "blur(16px)",
                      }}
                    >
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 bg-violet-400/10">
                        <Icon className="w-3.5 h-3.5 text-violet-200/75" />
                      </div>
                      <div className="min-w-0">
                        <span className="font-medium text-sm leading-tight block text-white/75 truncate">{item.query}</span>
                        <span className="text-xs text-violet-200/40 truncate block">{item.city}, {item.country}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-5 rounded-2xl" style={glassStyle(0.48)}>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-200/45 mb-3">Search order</div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-white/50">
                <span className="px-2.5 py-1 rounded-full bg-violet-400/10 border border-violet-300/15">Occu-Med network</span>
                <span className="text-white/20">→</span>
                <span className="px-2.5 py-1 rounded-full bg-violet-400/10 border border-violet-300/15">Keenable + TinyFish</span>
                <span className="text-white/20">→</span>
                <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10">Exa fallback</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {hasSearched && (
        <div className="flex-1 min-h-0 overflow-hidden px-4 md:px-6 py-4">
          <div className="h-full max-w-[1500px] mx-auto rounded-[24px] overflow-hidden flex flex-col" style={glassStyle(0.48)}>
            <div className="flex flex-col md:flex-row md:items-center gap-2 px-3 py-2.5 border-b border-white/10 bg-black/10">
              <div className="flex items-center gap-1.5">
                <button onClick={() => setTab("existing")} className={`px-4 h-9 rounded-xl text-sm font-semibold transition-all ${tab === "existing" ? "bg-white/10 text-white" : "text-white/35 hover:text-white/60"}`}>
                  Existing Network ({result?.existing.length ?? 0})
                </button>
                <button onClick={() => setTab("external")} className={`px-4 h-9 rounded-xl text-sm font-semibold transition-all ${tab === "external" ? "bg-white/10 text-white" : "text-white/35 hover:text-white/60"}`}>
                  Outside Network ({external.length})
                </button>
              </div>
              {result && (
                <div className="md:ml-auto flex flex-wrap items-center gap-2 text-[10px] text-white/35 px-1">
                  <span className="px-2 py-1 rounded-full bg-white/5">{result.summary.qualifiedActiveMatches} full active matches</span>
                  {result.summary.searchedOutsideNetwork && <span className="px-2 py-1 rounded-full bg-cyan-400/8 border border-cyan-300/10">K {result.externalSources.keenable} · T {result.externalSources.tinyfish} · E {result.externalSources.exa}</span>}
                  {result.fallbackUsed && <span className="px-2 py-1 rounded-full bg-amber-400/10 border border-amber-300/15 text-amber-100/65">Exa fallback used</span>}
                </div>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-3 md:p-4">
              {loading && !result && (
                <div className="h-full flex items-center justify-center text-white/35">
                  <div className="text-center"><Radar className="w-8 h-8 mx-auto mb-3 animate-pulse text-violet-200/50" /><div className="font-semibold">Searching the network…</div></div>
                </div>
              )}

              {result && tab === "existing" && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {topExisting.length === 0 && (
                    <div className="xl:col-span-2 py-16 text-center text-white/35">
                      <CircleAlert className="w-7 h-7 mx-auto mb-2 opacity-60" />
                      No existing network matches were found for this requirement.
                    </div>
                  )}
                  {topExisting.map((provider) => {
                    const pct = Math.round(provider.coverageRatio * 100);
                    return (
                      <article key={provider.id} className="rounded-2xl p-4 bg-black/16 border border-white/10 hover:border-violet-300/20 hover:bg-black/20 transition-all">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-base font-bold text-white/88 truncate">{provider.providerName}</div>
                            {provider.organizationName && provider.organizationName !== provider.providerName && <div className="text-xs text-white/35 truncate mt-0.5">{provider.organizationName}</div>}
                          </div>
                          <StatusBadge value={provider.networkStatus || "Unknown"} />
                        </div>

                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-white/42">
                          {(provider.city || provider.stateRegion || provider.country) && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{[provider.city, provider.stateRegion, provider.country].filter(Boolean).join(", ")}</span>}
                          {provider.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{provider.phone}</span>}
                        </div>
                        {provider.address && <div className="text-[11px] text-white/28 mt-1">{provider.address} {provider.postalCode || ""}</div>}

                        {services.length > 0 && (
                          <>
                            <div className="mt-4 flex items-center justify-between text-[11px]"><span className="font-semibold text-white/55">Documented requirement match</span><span className={`font-bold ${pct === 100 ? "text-emerald-200" : pct >= 50 ? "text-amber-100" : "text-rose-200"}`}>{pct}%</span></div>
                            <div className="mt-1.5"><CoverageBar ratio={provider.coverageRatio} /></div>
                          </>
                        )}

                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {provider.matchedServices.slice(0, 8).map((service) => <span key={`yes-${service}`} className="px-2 py-1 rounded-full bg-emerald-400/8 border border-emerald-300/12 text-[9px] text-emerald-100/65">✓ {service}</span>)}
                          {provider.missingServices.slice(0, 8).map((service) => <span key={`no-${service}`} className="px-2 py-1 rounded-full bg-rose-400/8 border border-rose-300/12 text-[9px] text-rose-100/60">Missing {service}</span>)}
                          {!services.length && provider.services.slice(0, 8).map((service) => <span key={service} className="px-2 py-1 rounded-full bg-violet-400/8 border border-violet-300/12 text-[9px] text-violet-100/60">{service}</span>)}
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-white/35">
                          {provider.pricingAvailable && <span className="px-2 py-1 rounded-lg bg-white/5">{provider.pricingCount ? `${provider.pricingCount} pricing lines` : "Pricing available"}</span>}
                          {provider.explicitAvailability?.length ? <span className="px-2 py-1 rounded-lg bg-white/5">{provider.explicitAvailability.length} explicit services</span> : null}
                          {provider.lastAppointment && <span className="px-2 py-1 rounded-lg bg-white/5">Last appointment: {provider.lastAppointment}</span>}
                          {provider.externalId ? (
                            <button onClick={() => void loadIntelligence(provider)} className="ml-auto px-3 py-1.5 rounded-lg bg-violet-400/10 border border-violet-300/15 text-violet-100/70 font-semibold hover:bg-violet-400/15 transition-all">
                              Pricing & services
                            </button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}

              {result && tab === "external" && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {external.length === 0 && (
                    <div className="xl:col-span-2 py-16 text-center text-white/35">
                      <Radar className="w-7 h-7 mx-auto mb-2 opacity-60" />
                      {result.summary.searchedOutsideNetwork ? "No outside-network candidates were returned." : "Outside-network search was not needed for this requirement."}
                    </div>
                  )}
                  {external.map((provider) => (
                    <article key={provider.id} className="rounded-2xl p-4 bg-black/16 border border-cyan-300/10 hover:border-cyan-300/20 hover:bg-black/20 transition-all">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-base font-bold text-white/88 truncate">{provider.providerName}</div>
                          <div className="text-xs text-white/35 mt-0.5">{provider.providerType || provider.specialty || "Provider candidate"}</div>
                        </div>
                        <StatusBadge value={provider.networkStatus || "NEW — outside network"} />
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-white/42">
                        {(provider.city || provider.stateRegion || provider.country) && <span className="flex items-center gap-1"><Globe2 className="w-3.5 h-3.5" />{[provider.city, provider.stateRegion, provider.country].filter(Boolean).join(", ")}</span>}
                        {provider.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{provider.phone}</span>}
                      </div>
                      {provider.evidenceText && <p className="mt-3 text-xs leading-relaxed text-white/38 line-clamp-4">{provider.evidenceText}</p>}
                      <div className="mt-4 flex items-center justify-between gap-3">
                        <div className="text-[10px] text-white/30">Source: {provider.sourceType || "web discovery"}</div>
                        {(provider.website || provider.sourceUrl) && (
                          <a href={provider.website || provider.sourceUrl} target="_blank" rel="noopener noreferrer" className="h-8 px-3 rounded-lg border border-cyan-300/15 bg-cyan-400/8 text-cyan-100/75 text-xs font-semibold flex items-center gap-1.5 hover:bg-cyan-400/12 transition-all">
                            Open source <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {intelProvider && (
        <div className="fixed inset-0 z-[100] bg-black/65 backdrop-blur-sm flex justify-end" onClick={() => setIntelProvider(null)}>
          <aside className="h-full w-full max-w-2xl overflow-y-auto p-5 md:p-6 bg-[#120a20] border-l border-white/10 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.15em] text-violet-200/50 font-semibold">Existing Provider Intelligence</div>
                <h2 className="text-2xl font-bold text-white/90 mt-1">{intelProvider.providerName}</h2>
                <div className="text-xs text-white/35 mt-1">{[intelProvider.city, intelProvider.stateRegion, intelProvider.country].filter(Boolean).join(", ")}</div>
              </div>
              <button onClick={() => setIntelProvider(null)} className="w-9 h-9 rounded-xl border border-white/10 bg-white/5 flex items-center justify-center text-white/50 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {intelLoading ? (
              <div className="py-16 text-center text-white/40">Loading pricing and availability…</div>
            ) : intelligence ? (
              <div className="mt-6 space-y-6">
                <div className="grid grid-cols-2 gap-3">
                  <StatCard icon={DollarSign} label="Pricing Lines" value={intelligence.pricingCount.toLocaleString()} />
                  <StatCard icon={CheckCircle2} label="Explicit Services" value={intelligence.availabilityCount.toLocaleString()} />
                </div>

                <section>
                  <h3 className="text-sm font-bold text-white/75 mb-2">Explicit service availability</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {intelligence.availability.slice(0, 300).map((item, index) => (
                      <span key={`${item.componentName}-${index}`} className="px-2 py-1 rounded-lg bg-violet-400/8 border border-violet-300/12 text-[10px] text-violet-100/65">
                        {item.componentName}{item.componentType ? ` · ${item.componentType}` : ""}
                      </span>
                    ))}
                    {!intelligence.availability.length && <span className="text-xs text-white/30">No explicit availability rows linked.</span>}
                  </div>
                </section>

                <section>
                  <h3 className="text-sm font-bold text-white/75 mb-2">Known pricing</h3>
                  <div className="space-y-2">
                    {intelligence.pricing.slice(0, 300).map((item, index) => (
                      <div key={`${item.componentName}-${index}`} className="rounded-xl bg-black/20 border border-white/8 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-xs font-semibold text-white/72">{item.componentName}</div>
                          <div className="text-sm font-bold text-emerald-200/80">{formatMoney(item.numericPrice)}</div>
                        </div>
                        {item.sourcePriceText && <div className="text-[10px] text-white/32 mt-1">{item.sourcePriceText}</div>}
                        <div className="flex flex-wrap gap-2 mt-2 text-[9px] text-white/25">
                          {item.effectiveDate && <span>Effective {item.effectiveDate}</span>}
                          {item.expirationDate && <span>Expires {item.expirationDate}</span>}
                        </div>
                      </div>
                    ))}
                    {!intelligence.pricing.length && <div className="text-xs text-white/30">No pricing rows linked.</div>}
                  </div>
                </section>
              </div>
            ) : null}
          </aside>
        </div>
      )}
    </div>
  );
}
