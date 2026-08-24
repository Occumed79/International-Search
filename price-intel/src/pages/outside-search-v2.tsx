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
    rejectedLowQuality?: number;
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
    border: "1px solid rgba(182, 199, 214, 0.26)",
    backdropFilter: "blur(24px) saturate(125%)",
    WebkitBackdropFilter: "blur(24px) saturate(125%)",
    boxShadow: "0 12px 36px rgba(14,23,34,0.30), inset 0 1px 0 rgba(255,255,255,0.07)",
  };
}

function locationText(candidate: Candidate) {
  return [candidate.city, candidate.stateRegion, candidate.country].filter(Boolean).join(", ");
}

export function OutsideSearchV2() {
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
    setResult(null);
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

  const searchBar = (
    <form
      onSubmit={(event) => { event.preventDefault(); void runSearch(); }}
      className={`w-full flex flex-col xl:flex-row xl:items-stretch transition-all duration-300 ${hasSearched ? "p-1.5 gap-1.5 rounded-2xl" : "p-2.5 gap-2 rounded-3xl"}`}
      style={glassStyle(hasSearched ? 0.88 : 0.74)}
    >
      <div className="flex items-center gap-2 px-3 xl:min-w-[176px]">
        <Building2 className="w-4 h-4 text-[#B6C7D6] shrink-0" />
        <select value={providerType} onChange={(event) => setProviderType(event.target.value)} className={`${hasSearched ? "h-10" : "h-14"} min-w-0 w-full bg-transparent border-0 outline-none text-sm font-semibold text-white/90 cursor-pointer`}>
          {PROVIDER_TYPES.map((item) => <option key={item.value} value={item.value} className="bg-[#1E2A3A]">{item.label}</option>)}
        </select>
      </div>
      <div className="hidden xl:block w-px bg-white/10 my-2" />
      <div className="flex items-center gap-2 px-3 xl:min-w-[160px]">
        <Globe2 className="w-4 h-4 text-[#B6C7D6] shrink-0" />
        <select value={country} onChange={(event) => setCountry(event.target.value)} className={`${hasSearched ? "h-10" : "h-14"} min-w-0 w-full bg-transparent border-0 outline-none text-sm font-semibold text-white/90 cursor-pointer`}>
          {COUNTRIES.map((item) => <option key={item} value={item} className="bg-[#1E2A3A]">{item}</option>)}
        </select>
      </div>
      <div className="hidden xl:block w-px bg-white/10 my-2" />
      <div className="relative flex-1 flex items-center xl:min-w-[155px]">
        <MapPin className="absolute left-4 w-4 h-4 text-[#B6C7D6]" />
        <input value={city} onChange={(event) => setCity(event.target.value)} placeholder="City or region" className={`${hasSearched ? "h-10" : "h-14"} w-full bg-transparent border-0 outline-none pl-11 pr-3 text-sm text-white/90 placeholder:text-white/32`} />
      </div>
      <div className="hidden xl:block w-px bg-white/10 my-2" />
      <div className="relative flex-[1.2] flex items-center xl:min-w-[180px]">
        <Search className="absolute left-4 w-4 h-4 text-[#B6C7D6]" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Service, exam, or provider type" className={`${hasSearched ? "h-10" : "h-14"} w-full bg-transparent border-0 outline-none pl-11 pr-3 text-sm text-white/90 placeholder:text-white/32`} />
      </div>
      <div className="flex items-stretch gap-1.5 shrink-0">
        <button type="button" onClick={() => setShowOptions((value) => !value)} className={`${hasSearched ? "w-10 h-10" : "w-12 h-14"} rounded-xl border border-white/12 bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.09] transition-all flex items-center justify-center shrink-0`} title="Search options">
          <SlidersHorizontal className="w-4 h-4" />
        </button>
        <button type="submit" disabled={loading} className={`${hasSearched ? "h-10 px-5 rounded-xl" : "h-14 px-6 rounded-2xl"} min-w-[184px] whitespace-nowrap bg-[#4B6F93] hover:bg-[#5d81a3] disabled:opacity-50 text-white font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg shrink-0`}>
          {loading ? <Activity className="w-4 h-4 animate-pulse" /> : <Search className="w-4 h-4" />}
          <span>{loading ? "Searching…" : "Find new providers"}</span>
        </button>
      </div>
    </form>
  );

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <div
        className={`w-full transition-all duration-500 flex flex-col items-center px-5 md:px-8 ${hasSearched ? "py-4 flex-none z-20" : "flex-1 justify-center py-8 overflow-y-auto"}`}
        style={hasSearched ? {
          background: "rgba(30,42,58,0.90)",
          backdropFilter: "blur(28px)",
          WebkitBackdropFilter: "blur(28px)",
          borderBottom: "1px solid rgba(182,199,214,0.18)",
          boxShadow: "0 4px 24px rgba(14,23,34,0.34)",
        } : undefined}
      >
        {!hasSearched && (
          <section className="w-full max-w-[1320px] mx-auto flex flex-col items-center text-center mb-7 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <img
              src={occuMedLogoDataUrl}
              alt="Occu-Med"
              className="search-hero-logo block h-auto mx-auto mb-5"
              style={{
                width: "360px",
                maxWidth: "68vw",
                filter: "drop-shadow(0 0 25px rgba(255,255,255,0.24)) drop-shadow(0 10px 34px rgba(30,42,58,0.25))",
              }}
            />
            <h1
              className="w-full font-bold tracking-tight leading-[0.98] text-center"
              style={{
                fontSize: "clamp(2.7rem, 5.1vw, 5.2rem)",
                background: "linear-gradient(110deg, #FFFEFE 0%, #EEF2F6 46%, #D7E1E9 70%, #B6C7D6 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                filter: "drop-shadow(0 8px 26px rgba(30,42,58,.18))",
              }}
            >
              <span className="block">Find New Healthcare</span>
              <span className="block md:whitespace-nowrap">Providers Worldwide</span>
            </h1>
            <p className="text-base md:text-lg max-w-2xl mx-auto mt-6 leading-relaxed text-white/70">
              Find healthcare providers that are not already in the Occu-Med provider directory.
            </p>
          </section>
        )}

        <div className={`w-full ${hasSearched ? "max-w-[1500px]" : "max-w-[1180px]"} mx-auto transition-all duration-500`}>
          {searchBar}

          {showOptions && (
            <div className="mt-2 rounded-2xl p-4 grid grid-cols-1 lg:grid-cols-12 gap-3 animate-in fade-in slide-in-from-top-2 duration-200" style={glassStyle(0.94)}>
              <label className="lg:col-span-3">
                <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-white/48 block mb-1.5">State / region</span>
                <input value={state} onChange={(event) => setState(event.target.value)} placeholder="MT, ON, QLD…" className="w-full h-10 rounded-xl bg-black/15 border border-white/12 px-3 text-sm text-white/90 outline-none" />
              </label>
              <label className="lg:col-span-6">
                <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-white/48 block mb-1.5">Required services</span>
                <input value={servicesText} onChange={(event) => setServicesText(event.target.value)} placeholder="Physical, audiogram, PFT, EKG, CBC…" className="w-full h-10 rounded-xl bg-black/15 border border-white/12 px-3 text-sm text-white/90 outline-none" />
              </label>
              <label className="lg:col-span-3">
                <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-white/48 block mb-1.5">Search radius</span>
                <div className="h-10 rounded-xl bg-black/15 border border-white/12 px-3 flex items-center gap-2">
                  <input type="range" min={5} max={100} step={5} value={radiusMiles} onChange={(event) => setRadiusMiles(Number(event.target.value))} className="min-w-0 flex-1" />
                  <span className="text-[11px] font-semibold text-[#B6C7D6] w-11 text-right">{radiusMiles} mi</span>
                </div>
              </label>
            </div>
          )}
        </div>

        {!hasSearched && (
          <div className="w-full max-w-4xl mx-auto mt-8 space-y-4 animate-in fade-in slide-in-from-bottom-8 duration-700 pb-8">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#D7E1E9]">
              <Stethoscope className="w-4 h-4" />
              <span>Quick searches</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {QUICK_SEARCHES.map((item) => {
                const Icon = item.icon;
                return (
                  <button key={`${item.query}-${item.city}-${item.country}`} onClick={() => void runSearch(item)} className="p-3.5 text-left transition-all group flex items-start gap-2.5 rounded-xl hover:-translate-y-0.5" style={glassStyle(0.50)}>
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 bg-white/8">
                      <Icon className="w-3.5 h-3.5 text-[#D7E1E9]" />
                    </div>
                    <div className="min-w-0">
                      <span className="font-medium text-sm leading-tight block text-white/88 truncate">{item.query}</span>
                      <span className="text-xs text-white/48 truncate block">{item.city}, {item.country}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {hasSearched && (
        <div className="flex-1 min-h-0 overflow-hidden px-4 md:px-6 py-4">
          <section className="h-full max-w-[1500px] mx-auto rounded-[24px] overflow-hidden flex flex-col" style={glassStyle(0.48)}>
            <header className="flex flex-col md:flex-row md:items-center gap-2 px-4 py-3 border-b border-white/10 bg-black/10">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-white/92">Outside-Network Candidates</h2>
                {result && <span className="px-2 py-1 rounded-full bg-white/7 text-[10px] text-white/62">{result.summary.outsideNetworkCandidates} strong candidates</span>}
              </div>
              {result && (
                <div className="md:ml-auto flex flex-wrap gap-2 text-[10px] text-white/52">
                  {Boolean(result.summary.rejectedLowQuality) && <span>{result.summary.rejectedLowQuality} weak pages filtered out</span>}
                  {result.summary.excludedExisting > 0 && <span>{result.summary.excludedExisting} already in Directory</span>}
                </div>
              )}
            </header>

            <div className="flex-1 min-h-0 overflow-y-auto p-3 md:p-4">
              {loading && (
                <div className="h-full flex items-center justify-center text-white/48">
                  <div className="text-center"><Search className="w-8 h-8 mx-auto mb-3 animate-pulse text-[#B6C7D6]" /><div className="font-semibold">Finding new providers…</div><div className="text-xs mt-1 text-white/35">Filtering out directories, articles, and duplicate pages.</div></div>
                </div>
              )}

              {!loading && result && result.candidates.length === 0 && (
                <div className="h-full min-h-[300px] flex items-center justify-center text-white/48">
                  <div className="text-center max-w-lg"><CircleAlert className="w-8 h-8 mx-auto mb-3 opacity-70" /><div className="font-semibold text-white/72">No strong outside-network provider candidates were verified.</div><div className="text-xs mt-2 leading-relaxed">The search rejected low-quality pages instead of presenting directories or articles as clinics. Try a nearby city, larger radius, or a broader provider type.</div></div>
                </div>
              )}

              {!loading && result && result.candidates.length > 0 && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {result.candidates.map((candidate) => (
                    <article key={candidate.id} className="rounded-2xl p-4 border border-white/11 bg-[#1E2A3A]/72 hover:bg-[#26384d]/82 hover:border-[#B6C7D6]/35 hover:-translate-y-0.5 transition-all shadow-[0_8px_24px_rgba(8,15,24,.16)]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-base font-bold text-white/94 leading-snug">{candidate.providerName}</h3>
                          {candidate.organizationName && candidate.organizationName !== candidate.providerName && <div className="text-xs text-white/44 mt-0.5">{candidate.organizationName}</div>}
                        </div>
                        {candidate.confidenceScore != null && <span className="shrink-0 px-2 py-1 rounded-full bg-[#4B6F93]/38 border border-[#B6C7D6]/22 text-[10px] font-semibold text-[#EEF2F6]">{Math.round(candidate.confidenceScore * 100)}% match</span>}
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-white/58">
                        {locationText(candidate) && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{locationText(candidate)}</span>}
                        {candidate.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{candidate.phone}</span>}
                      </div>
                      {candidate.specialty && <div className="text-[11px] text-[#B6C7D6] mt-2">{candidate.specialty}</div>}

                      {candidate.evidenceText && <p className="text-xs text-white/46 mt-3 leading-relaxed line-clamp-2">{candidate.evidenceText}</p>}

                      {(candidate.website || candidate.sourceUrl) && (
                        <div className="mt-4 flex justify-end">
                          <a href={candidate.website || candidate.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#D7E1E9] hover:text-white transition-colors">
                            <ExternalLink className="w-3.5 h-3.5" /> Open provider website
                          </a>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
