import { useMemo, useState, type CSSProperties } from "react";
import {
  Activity,
  Building2,
  CircleAlert,
  ExternalLink,
  Globe2,
  MapPin,
  Phone,
  Search,
  SlidersHorizontal,
  Stethoscope,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import occuMedLogoDataUrl from "@/assets/occu-med-logo-data";

type Candidate = {
  id: string;
  providerName: string;
  organizationName?: string;
  providerType?: string;
  specialty?: string;
  city?: string;
  stateRegion?: string;
  country?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  website?: string;
  sourceUrl?: string;
  evidenceText?: string;
  confidenceScore?: number;
};

type SearchResponse = {
  summary: {
    discovered: number;
    excludedExisting: number;
    outsideNetworkCandidates: number;
  };
  candidates: Candidate[];
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
    background: `rgba(30, 42, 58, ${alpha})`,
    border: "1px solid rgba(182, 199, 214, 0.24)",
    backdropFilter: "blur(24px)",
    WebkitBackdropFilter: "blur(24px)",
    boxShadow: "0 10px 34px rgba(14,23,34,0.34), inset 0 1px 0 rgba(255,255,255,0.06)",
  };
}

export function OutsideSearch() {
  const { toast } = useToast();
  const [query, setQuery] = useState("Occupational Health");
  const [providerType, setProviderType] = useState("occupational_health");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [country, setCountry] = useState("United States");
  const [radiusMiles, setRadiusMiles] = useState(25);
  const [servicesText, setServicesText] = useState("");
  const [showOptions, setShowOptions] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResponse | null>(null);

  const services = useMemo(
    () => servicesText.split(/[\n,;|]+/).map((item) => item.trim()).filter(Boolean),
    [servicesText],
  );

  const hasSearched = loading || result !== null;

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
      const response = await fetch("/api/outside-network/search", {
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
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Provider search failed");
      setResult(payload as SearchResponse);
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

  return (
    <div className="h-full w-full flex flex-col">
      <div
        className={`transition-all duration-500 flex flex-col items-center px-5 md:px-7 ${hasSearched ? "py-4 flex-none z-20" : "flex-1 justify-center py-8 overflow-y-auto"}`}
        style={hasSearched ? {
          background: "rgba(30,42,58,0.88)",
          backdropFilter: "blur(28px)",
          WebkitBackdropFilter: "blur(28px)",
          borderBottom: "1px solid rgba(182,199,214,0.18)",
          boxShadow: "0 4px 24px rgba(14,23,34,0.34)",
        } : undefined}
      >
        {!hasSearched && (
          <div className="text-center mb-7 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700">
            <img
              src={occuMedLogoDataUrl}
              alt="Occu-Med"
              className="block h-auto mx-auto mb-2"
              style={{ width: "270px", maxWidth: "56vw", filter: "drop-shadow(0 0 22px rgba(255,255,255,0.20))" }}
            />
            <h1
              className="font-bold tracking-tight leading-tight"
              style={{
                fontSize: "clamp(2.5rem, 6vw, 4.6rem)",
                background: "linear-gradient(115deg, #FFFEFE 0%, #EEF2F6 28%, #B6C7D6 58%, #4B6F93 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Find New Healthcare Providers<br />Worldwide
            </h1>
            <p className="text-base md:text-lg max-w-2xl mx-auto mt-5 leading-relaxed text-white/55">
              Find healthcare providers that are not already in the Occu-Med provider directory.
            </p>
          </div>
        )}

        <div className={`w-full ${hasSearched ? "max-w-[1500px]" : "max-w-5xl"} transition-all duration-500`}>
          <form
            onSubmit={(event) => { event.preventDefault(); void runSearch(); }}
            className={`flex flex-col lg:flex-row items-stretch transition-all duration-300 ${hasSearched ? "p-1.5 gap-1.5 rounded-2xl" : "p-2.5 gap-2.5 rounded-3xl"}`}
            style={glassStyle(hasSearched ? 0.86 : 0.74)}
          >
            <div className="flex items-center gap-2 px-3 min-w-[190px]">
              <Building2 className="w-4 h-4 text-[#B6C7D6] shrink-0" />
              <select value={providerType} onChange={(event) => setProviderType(event.target.value)} className={`${hasSearched ? "h-10" : "h-14"} w-full bg-transparent border-0 outline-none text-sm font-semibold text-white/85 cursor-pointer`}>
                {PROVIDER_TYPES.map((item) => <option key={item.value} value={item.value} className="bg-[#1E2A3A]">{item.label}</option>)}
              </select>
            </div>
            <div className="hidden lg:block w-px bg-white/10 my-2" />
            <div className="flex items-center gap-2 px-3 min-w-[175px]">
              <Globe2 className="w-4 h-4 text-[#B6C7D6] shrink-0" />
              <select value={country} onChange={(event) => setCountry(event.target.value)} className={`${hasSearched ? "h-10" : "h-14"} w-full bg-transparent border-0 outline-none text-sm font-semibold text-white/85 cursor-pointer`}>
                {COUNTRIES.map((item) => <option key={item} value={item} className="bg-[#1E2A3A]">{item}</option>)}
              </select>
            </div>
            <div className="hidden lg:block w-px bg-white/10 my-2" />
            <div className="relative flex-1 flex items-center min-w-[170px]">
              <MapPin className="absolute left-4 w-4 h-4 text-[#B6C7D6]" />
              <input value={city} onChange={(event) => setCity(event.target.value)} placeholder="City or region" className={`${hasSearched ? "h-10" : "h-14"} w-full bg-transparent border-0 outline-none pl-11 pr-3 text-sm text-white/85 placeholder:text-white/30`} />
            </div>
            <div className="hidden lg:block w-px bg-white/10 my-2" />
            <div className="relative flex-[1.35] flex items-center min-w-[220px]">
              <Search className="absolute left-4 w-4 h-4 text-[#B6C7D6]" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Service, exam, or provider type" className={`${hasSearched ? "h-10" : "h-14"} w-full bg-transparent border-0 outline-none pl-11 pr-3 text-sm text-white/85 placeholder:text-white/30`} />
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => setShowOptions((value) => !value)} className={`${hasSearched ? "w-10 h-10" : "w-12 h-14"} rounded-xl border border-white/10 bg-white/[0.04] text-white/55 hover:text-white hover:bg-white/[0.08] transition-all flex items-center justify-center`} title="Search options">
                <SlidersHorizontal className="w-4 h-4" />
              </button>
              <button type="submit" disabled={loading} className={`${hasSearched ? "h-10 px-5 rounded-xl" : "h-14 px-7 rounded-2xl"} bg-[#4B6F93] hover:bg-[#5d81a3] disabled:opacity-50 text-white font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg`}>
                {loading ? <Activity className="w-4 h-4 animate-pulse" /> : <Search className="w-4 h-4" />}
                <span>{loading ? "Searching…" : "Find new providers"}</span>
              </button>
            </div>
          </form>

          {showOptions && (
            <div className="mt-2 rounded-2xl p-4 grid grid-cols-1 lg:grid-cols-12 gap-3 animate-in fade-in slide-in-from-top-2 duration-200" style={glassStyle(0.92)}>
              <label className="lg:col-span-3">
                <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-white/45 block mb-1.5">State / region</span>
                <input value={state} onChange={(event) => setState(event.target.value)} placeholder="MT, ON, QLD…" className="w-full h-10 rounded-xl bg-black/15 border border-white/10 px-3 text-sm text-white/85 outline-none" />
              </label>
              <label className="lg:col-span-6">
                <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-white/45 block mb-1.5">Required services</span>
                <input value={servicesText} onChange={(event) => setServicesText(event.target.value)} placeholder="Physical, audiogram, PFT, EKG, CBC…" className="w-full h-10 rounded-xl bg-black/15 border border-white/10 px-3 text-sm text-white/85 outline-none" />
              </label>
              <label className="lg:col-span-3">
                <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-white/45 block mb-1.5">Search radius</span>
                <div className="h-10 rounded-xl bg-black/15 border border-white/10 px-3 flex items-center gap-2">
                  <input type="range" min={5} max={100} step={5} value={radiusMiles} onChange={(event) => setRadiusMiles(Number(event.target.value))} className="min-w-0 flex-1" />
                  <span className="text-[11px] font-semibold text-[#B6C7D6] w-10 text-right">{radiusMiles} mi</span>
                </div>
              </label>
            </div>
          )}
        </div>

        {!hasSearched && (
          <div className="w-full max-w-4xl mx-auto mt-8 space-y-4 animate-in fade-in slide-in-from-bottom-8 duration-700 pb-8">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#B6C7D6]">
              <Stethoscope className="w-4 h-4" />
              <span>Quick searches</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {QUICK_SEARCHES.map((item) => {
                const Icon = item.icon;
                return (
                  <button key={`${item.query}-${item.city}-${item.country}`} onClick={() => void runSearch(item)} className="p-3.5 text-left transition-all group flex items-start gap-2.5 rounded-xl hover:-translate-y-0.5" style={glassStyle(0.48)}>
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 bg-white/5"><Icon className="w-3.5 h-3.5 text-[#B6C7D6]" /></div>
                    <div className="min-w-0"><span className="font-medium text-sm leading-tight block text-white/80 truncate">{item.query}</span><span className="text-xs text-white/40 truncate block">{item.city}, {item.country}</span></div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {hasSearched && (
        <div className="flex-1 min-h-0 overflow-hidden px-4 md:px-6 py-4">
          <div className="h-full max-w-[1500px] mx-auto rounded-[24px] overflow-hidden flex flex-col" style={glassStyle(0.48)}>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-white/10 bg-black/10">
              <div className="font-semibold text-white/85">Outside-Network Candidates</div>
              {result && <>
                <span className="px-2 py-1 rounded-full bg-white/5 text-[10px] text-white/50">{result.summary.outsideNetworkCandidates} new candidates</span>
                {result.summary.excludedExisting > 0 && <span className="px-2 py-1 rounded-full bg-white/5 text-[10px] text-white/45">{result.summary.excludedExisting} already in Directory — excluded</span>}
              </>}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-3 md:p-4">
              {loading && !result && (
                <div className="h-full flex items-center justify-center text-white/40"><div className="text-center"><Search className="w-8 h-8 mx-auto mb-3 animate-pulse text-[#B6C7D6]" /><div className="font-semibold">Searching for providers outside the network…</div></div></div>
              )}

              {result && result.candidates.length === 0 && (
                <div className="h-full min-h-[320px] flex items-center justify-center text-white/40">
                  <div className="text-center max-w-md"><CircleAlert className="w-8 h-8 mx-auto mb-3 opacity-70" /><div className="font-semibold text-white/70">No new provider candidates found</div><p className="text-sm mt-2">The search did not find providers that could be confirmed as outside the current Directory.</p></div>
                </div>
              )}

              {result && result.candidates.length > 0 && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {result.candidates.map((provider) => (
                    <article key={provider.id} className="rounded-2xl p-4 bg-black/15 border border-white/10 hover:border-[#B6C7D6]/40 hover:-translate-y-0.5 transition-all">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0"><div className="text-base font-bold text-white/90">{provider.providerName}</div>{provider.organizationName && provider.organizationName !== provider.providerName && <div className="text-xs text-white/40 mt-0.5">{provider.organizationName}</div>}</div>
                        <span className="shrink-0 px-2 py-1 rounded-full bg-[#B6C7D6]/15 border border-[#B6C7D6]/25 text-[10px] font-semibold text-[#EEF2F6]">Outside network</span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-white/50">
                        {(provider.city || provider.stateRegion || provider.country) && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{[provider.city, provider.stateRegion, provider.country].filter(Boolean).join(", ")}</span>}
                        {provider.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{provider.phone}</span>}
                      </div>
                      {provider.specialty && <div className="text-xs text-white/45 mt-2">{provider.specialty}</div>}
                      {provider.evidenceText && <p className="text-xs text-white/42 mt-3 leading-relaxed line-clamp-3">{provider.evidenceText}</p>}
                      <div className="mt-4 flex items-center justify-between gap-3">
                        {Number.isFinite(provider.confidenceScore) && <span className="text-[10px] text-white/35">{Math.round(Number(provider.confidenceScore) * 100)}% confidence</span>}
                        {(provider.website || provider.sourceUrl) && <a href={provider.website || provider.sourceUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-[#B6C7D6] hover:text-white"><ExternalLink className="w-3.5 h-3.5" /> Open provider website</a>}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
