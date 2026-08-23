import { useEffect, useMemo, useRef, useState, type CSSProperties, type ElementType } from "react";
import {
  Activity,
  BadgeCheck,
  Building2,
  CheckCircle2,
  CircleAlert,
  Database,
  DollarSign,
  Globe2,
  MapPin,
  Phone,
  Radar,
  Search,
  Sparkles,
  Upload,
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
  requirement: {
    query: string;
    country: string;
    state: string;
    city: string;
    services: string[];
  };
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

function glassStyle(alpha = 0.58): CSSProperties {
  return {
    background: `rgba(18, 10, 32, ${alpha})`,
    border: "1px solid rgba(194, 145, 255, 0.15)",
    backdropFilter: "blur(24px)",
    boxShadow: "0 12px 34px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.04)",
  };
}

function StatCard({ icon: Icon, label, value, helper }: { icon: ElementType; label: string; value: string; helper?: string }) {
  return (
    <div className="rounded-2xl p-4" style={glassStyle(0.5)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-2xl font-bold text-white/90">{value}</div>
          <div className="text-xs font-semibold text-violet-200/65 mt-1">{label}</div>
          {helper && <div className="text-[10px] text-white/30 mt-1">{helper}</div>}
        </div>
        <div className="w-9 h-9 rounded-xl bg-violet-400/10 border border-violet-300/10 flex items-center justify-center">
          <Icon className="w-4 h-4 text-violet-200/80" />
        </div>
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [stats, setStats] = useState<NetworkStats>(EMPTY_STATS);
  const [query, setQuery] = useState("occupational health");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [country, setCountry] = useState("United States");
  const [servicesText, setServicesText] = useState("");
  const [outsideMode, setOutsideMode] = useState<"off" | "gaps" | "always">("gaps");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
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
      setStats({
        ...EMPTY_STATS,
        ...network,
        ...intel,
        importedAt: network.importedAt || intel.importedAt || null,
      });
    } catch {
      // API may be booting; the page remains usable for external sourcing.
    }
  };

  useEffect(() => {
    void refreshStats();
  }, []);

  const importSnapshot = async (file: File) => {
    setImporting(true);
    try {
      const contentType = file.type || "application/octet-stream";
      const networkResponse = await fetch("/api/network/import", {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: file,
      });
      const networkPayload = await networkResponse.json().catch(() => ({}));
      if (!networkResponse.ok) throw new Error(networkPayload.error || "Network snapshot import failed");

      const intelligenceResponse = await fetch("/api/network/import-intelligence", {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: file,
      });
      const intelligencePayload = await intelligenceResponse.json().catch(() => ({}));
      if (!intelligenceResponse.ok) throw new Error(intelligencePayload.error || "Pricing / availability intelligence import failed");

      toast({
        title: "Command Center integrated",
        description: `${Number(networkPayload.imported || 0).toLocaleString()} locations · ${Number(intelligencePayload.imported?.pricing || 0).toLocaleString()} pricing lines · ${Number(intelligencePayload.imported?.availability || 0).toLocaleString()} availability links.`,
      });
      await refreshStats();
    } catch (error) {
      toast({ title: "Import failed", description: error instanceof Error ? error.message : "Could not import the Command Center snapshot.", variant: "destructive" });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const runSearch = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/sourcing/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          city,
          state,
          country,
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
      toast({ title: "Search failed", description: error instanceof Error ? error.message : "Provider sourcing search failed.", variant: "destructive" });
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
      toast({ title: "Could not load provider intelligence", description: error instanceof Error ? error.message : "Lookup failed.", variant: "destructive" });
      setIntelProvider(null);
    } finally {
      setIntelLoading(false);
    }
  };

  const topExisting = result?.existing.slice(0, 100) ?? [];
  const external = result?.external ?? [];

  return (
    <div className="h-full overflow-y-auto px-5 py-5 md:px-7 md:py-6">
      <div className="max-w-[1500px] mx-auto space-y-5 pb-10">
        <section className="rounded-[28px] p-6 md:p-7" style={glassStyle(0.56)}>
          <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-5">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-400/10 border border-violet-300/15 text-violet-200/85 text-xs font-semibold">
                <Radar className="w-3.5 h-3.5" />
                Provider Sourcing & Network Intelligence
              </div>
              <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-white/95 mt-4">Search our network first. Fill the gaps second.</h1>
              <p className="mt-3 text-sm md:text-base text-white/50 leading-relaxed max-w-2xl">
                Match a real service requirement against Occu-Med's existing providers, agreement status, documented capabilities, pricing and explicit line-item availability. When coverage is weak, search outside the network with Keenable + TinyFish and use Exa only as fallback.
              </p>
            </div>

            <div className="min-w-[300px] rounded-2xl p-4 bg-black/20 border border-white/10">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.16em] font-semibold text-white/35">Existing Network Snapshot</div>
                  <div className="text-2xl font-bold text-white/90 mt-1">{stats.total.toLocaleString()}</div>
                  <div className="text-[11px] text-white/35 mt-1">
                    {stats.importedAt ? `Last import ${new Date(stats.importedAt).toLocaleString()}` : "Import the Command Center HTML once to populate the network layer."}
                  </div>
                </div>
                <Database className="w-8 h-8 text-violet-200/45" />
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".html,.htm,.json,.gz,application/gzip,text/html"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importSnapshot(file);
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={importing}
                className="mt-4 w-full h-10 rounded-xl bg-violet-500/15 border border-violet-300/20 text-violet-100 text-sm font-semibold hover:bg-violet-500/25 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
              >
                <Upload className="w-4 h-4" />
                {importing ? "Importing full Command Center…" : stats.total ? "Refresh Command Center Snapshot" : "Import Command Center Snapshot"}
              </button>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <StatCard icon={Building2} label="Network Locations" value={stats.total.toLocaleString()} />
          <StatCard icon={BadgeCheck} label="Active Agreements" value={stats.activeAgreements.toLocaleString()} />
          <StatCard icon={Activity} label="Service Tagged" value={stats.serviceTagged.toLocaleString()} />
          <StatCard icon={MapPin} label="GPS Ready" value={stats.gpsReady.toLocaleString()} />
          <StatCard icon={DollarSign} label="Pricing Line Items" value={stats.pricingRecords.toLocaleString()} helper={`${stats.pricedClinics.toLocaleString()} linked clinics`} />
          <StatCard icon={Database} label="Availability Links" value={stats.availabilityLinks.toLocaleString()} helper={`${stats.availabilityClinics.toLocaleString()} linked clinics`} />
        </section>

        <section className="rounded-[26px] p-5 md:p-6" style={glassStyle(0.52)}>
          <div className="flex items-center gap-2 mb-4">
            <Search className="w-5 h-5 text-violet-200/80" />
            <div>
              <h2 className="text-lg font-bold text-white/90">Provider Requirement</h2>
              <p className="text-xs text-white/35">Describe the requirement; the existing network is always checked first.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
            <label className="lg:col-span-4">
              <span className="text-[11px] font-semibold text-white/40 block mb-1.5">Need / provider type</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Occupational health, audiogram, stress test…" className="w-full h-11 rounded-xl bg-black/20 border border-white/10 px-3 text-sm text-white/85 outline-none focus:border-violet-300/30" />
            </label>
            <label className="lg:col-span-2">
              <span className="text-[11px] font-semibold text-white/40 block mb-1.5">City</span>
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Helena" className="w-full h-11 rounded-xl bg-black/20 border border-white/10 px-3 text-sm text-white/85 outline-none focus:border-violet-300/30" />
            </label>
            <label className="lg:col-span-2">
              <span className="text-[11px] font-semibold text-white/40 block mb-1.5">State / region</span>
              <input value={state} onChange={(e) => setState(e.target.value)} placeholder="MT" className="w-full h-11 rounded-xl bg-black/20 border border-white/10 px-3 text-sm text-white/85 outline-none focus:border-violet-300/30" />
            </label>
            <label className="lg:col-span-2">
              <span className="text-[11px] font-semibold text-white/40 block mb-1.5">Country</span>
              <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="United States" className="w-full h-11 rounded-xl bg-black/20 border border-white/10 px-3 text-sm text-white/85 outline-none focus:border-violet-300/30" />
            </label>
            <div className="lg:col-span-2 flex items-end">
              <button onClick={() => void runSearch()} disabled={loading} className="w-full h-11 rounded-xl bg-violet-500 text-white font-bold text-sm hover:bg-violet-400 disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-lg shadow-violet-950/30">
                <Search className="w-4 h-4" />
                {loading ? "Searching…" : "Search"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-3">
            <label className="lg:col-span-2">
              <span className="text-[11px] font-semibold text-white/40 block mb-1.5">Required services — comma or line separated</span>
              <textarea value={servicesText} onChange={(e) => setServicesText(e.target.value)} placeholder="Medical / Physical Exam, Audiology / Hearing, PFT / Spirometry, EKG, Laboratory" className="w-full min-h-[86px] rounded-xl bg-black/20 border border-white/10 px-3 py-2.5 text-sm text-white/85 outline-none focus:border-violet-300/30 resize-y" />
              {services.length > 0 && <div className="flex flex-wrap gap-1.5 mt-2">{services.map((service) => <span key={service} className="px-2 py-1 rounded-full bg-violet-400/10 border border-violet-300/15 text-[10px] text-violet-100/75">{service}</span>)}</div>}
            </label>

            <div>
              <span className="text-[11px] font-semibold text-white/40 block mb-1.5">Outside-network search</span>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-black/20 border border-white/10">
                {([
                  ["off", "Off"],
                  ["gaps", "If gaps"],
                  ["always", "Always"],
                ] as const).map(([value, label]) => (
                  <button key={value} type="button" onClick={() => setOutsideMode(value)} className={`h-9 rounded-lg text-xs font-semibold transition-all ${outsideMode === value ? "bg-violet-500/25 text-violet-100 border border-violet-300/20" : "text-white/35 hover:text-white/60"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-white/30 mt-2 leading-relaxed">
                “If gaps” only spends external search calls when fewer than three active-agreement providers fully match the documented requirement. “Always” forces new-provider discovery.
              </p>
            </div>
          </div>
        </section>

        {result && (
          <section className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard icon={Database} label="Existing Matches" value={result.summary.existingMatches.toLocaleString()} />
              <StatCard icon={CheckCircle2} label="Full Active Matches" value={result.summary.qualifiedActiveMatches.toLocaleString()} />
              <StatCard icon={Sparkles} label="New Candidates" value={result.summary.externalCandidates.toLocaleString()} helper={result.summary.searchedOutsideNetwork ? "External discovery ran" : "Network coverage was sufficient / search disabled"} />
              <StatCard icon={Radar} label="API Results" value={(result.externalSources.keenable + result.externalSources.tinyfish + result.externalSources.exa).toLocaleString()} helper={`K ${result.externalSources.keenable} · T ${result.externalSources.tinyfish} · E ${result.externalSources.exa}`} />
            </div>

            <div className="rounded-[26px] overflow-hidden" style={glassStyle(0.5)}>
              <div className="flex items-center gap-2 p-2 border-b border-white/10">
                <button onClick={() => setTab("existing")} className={`px-4 h-10 rounded-xl text-sm font-semibold transition-all ${tab === "existing" ? "bg-white/10 text-white" : "text-white/35 hover:text-white/60"}`}>
                  Existing Network ({result.existing.length})
                </button>
                <button onClick={() => setTab("external")} className={`px-4 h-10 rounded-xl text-sm font-semibold transition-all ${tab === "external" ? "bg-white/10 text-white" : "text-white/35 hover:text-white/60"}`}>
                  Outside Network ({external.length})
                </button>
                {result.fallbackUsed && <span className="ml-auto mr-2 text-[10px] px-2 py-1 rounded-full bg-amber-400/10 border border-amber-300/15 text-amber-100/70">Exa fallback used</span>}
              </div>

              {tab === "existing" ? (
                <div className="p-3 grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {topExisting.length === 0 && (
                    <div className="xl:col-span-2 py-14 text-center text-white/35">
                      <CircleAlert className="w-7 h-7 mx-auto mb-2 opacity-60" />
                      No existing network matches were found for this requirement.
                    </div>
                  )}
                  {topExisting.map((provider) => {
                    const pct = Math.round(provider.coverageRatio * 100);
                    return (
                      <article key={provider.id} className="rounded-2xl p-4 bg-black/20 border border-white/10 hover:border-violet-300/15 transition-all">
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
                        {provider.address && <div className="text-[11px] text-white/30 mt-1">{provider.address} {provider.postalCode || ""}</div>}

                        <div className="mt-4 flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-white/55">Documented requirement match</span>
                          <span className={`font-bold ${pct === 100 ? "text-emerald-200" : pct >= 50 ? "text-amber-100" : "text-rose-200"}`}>{pct}%</span>
                        </div>
                        <div className="mt-1.5"><CoverageBar ratio={provider.coverageRatio} /></div>

                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {provider.matchedServices.slice(0, 8).map((service) => <span key={`yes-${service}`} className="px-2 py-1 rounded-full bg-emerald-400/10 border border-emerald-300/15 text-[9px] text-emerald-100/70">✓ {service}</span>)}
                          {provider.missingServices.slice(0, 8).map((service) => <span key={`no-${service}`} className="px-2 py-1 rounded-full bg-rose-400/10 border border-rose-300/15 text-[9px] text-rose-100/65">Missing {service}</span>)}
                          {!services.length && provider.services.slice(0, 8).map((service) => <span key={service} className="px-2 py-1 rounded-full bg-violet-400/10 border border-violet-300/15 text-[9px] text-violet-100/65">{service}</span>)}
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-white/35">
                          {provider.pricingAvailable && <span className="px-2 py-1 rounded-lg bg-white/5">Pricing data flagged</span>}
                          {provider.lastAppointment && <span className="px-2 py-1 rounded-lg bg-white/5">Last appointment: {provider.lastAppointment}</span>}
                          {provider.activity2026 && <span className="px-2 py-1 rounded-lg bg-white/5">{provider.activity2026}</span>}
                        </div>

                        {provider.externalId ? (
                          <button onClick={() => void loadIntelligence(provider)} className="mt-3 h-8 px-3 rounded-lg bg-violet-400/10 border border-violet-300/15 text-violet-100/75 text-xs font-semibold hover:bg-violet-400/15 transition-all flex items-center gap-1.5">
                            <DollarSign className="w-3.5 h-3.5" />
                            View pricing & line-item availability
                          </button>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="p-3 grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {external.length === 0 && (
                    <div className="xl:col-span-2 py-14 text-center text-white/35">
                      <Radar className="w-7 h-7 mx-auto mb-2 opacity-60" />
                      No outside-network search ran, or no new candidates were returned.
                    </div>
                  )}
                  {external.map((provider) => (
                    <article key={provider.id} className="rounded-2xl p-4 bg-black/20 border border-cyan-300/10 hover:border-cyan-300/20 transition-all">
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

                      {provider.evidenceText && <p className="mt-3 text-xs leading-relaxed text-white/40 line-clamp-4">{provider.evidenceText}</p>}

                      <div className="mt-4 flex items-center justify-between gap-3">
                        <div className="text-[10px] text-white/30">Source: {provider.sourceType || "web discovery"}</div>
                        {(provider.website || provider.sourceUrl) && (
                          <a href={provider.website || provider.sourceUrl} target="_blank" rel="noopener noreferrer" className="h-8 px-3 rounded-lg border border-cyan-300/15 bg-cyan-400/10 text-cyan-100/75 text-xs font-semibold flex items-center gap-1.5 hover:bg-cyan-400/15">
                            Open source
                          </a>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {intelProvider && (
        <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm p-4 md:p-8 flex items-center justify-center" onMouseDown={(event) => { if (event.currentTarget === event.target) setIntelProvider(null); }}>
          <div className="w-full max-w-6xl max-h-[88vh] rounded-[26px] overflow-hidden flex flex-col" style={glassStyle(0.9)}>
            <div className="flex items-start justify-between gap-4 p-5 border-b border-white/10">
              <div>
                <div className="text-lg font-bold text-white/90">{intelProvider.providerName}</div>
                <div className="text-xs text-white/40 mt-1">{[intelProvider.city, intelProvider.stateRegion, intelProvider.country].filter(Boolean).join(", ")} · Command Center line-item intelligence</div>
              </div>
              <button onClick={() => setIntelProvider(null)} className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10">
                <X className="w-4 h-4" />
              </button>
            </div>

            {intelLoading ? (
              <div className="p-16 text-center text-white/40">Loading provider pricing and availability…</div>
            ) : intelligence ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
                <section className="rounded-2xl border border-white/10 bg-black/20 overflow-hidden">
                  <div className="p-4 border-b border-white/10 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-white/85">Pricing</div>
                      <div className="text-[11px] text-white/35">Latest known clinic × line-item records</div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-violet-400/10 border border-violet-300/15 text-violet-100/70 text-xs font-semibold">{intelligence.pricingCount.toLocaleString()}</span>
                  </div>
                  <div className="max-h-[58vh] overflow-y-auto divide-y divide-white/5">
                    {intelligence.pricing.length === 0 && <div className="p-8 text-center text-white/30 text-sm">No canonical pricing line items linked to this clinic.</div>}
                    {intelligence.pricing.map((row, index) => (
                      <div key={`${row.componentName}-${index}`} className="p-3.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-xs font-semibold text-white/75 leading-relaxed">{row.componentName}</div>
                          <div className="text-sm font-bold text-violet-100 shrink-0">{formatMoney(row.numericPrice)}</div>
                        </div>
                        {row.sourcePriceText && row.numericPrice == null && <div className="text-[11px] text-white/38 mt-1">{row.sourcePriceText}</div>}
                        <div className="flex flex-wrap gap-2 mt-1.5 text-[9px] text-white/25">
                          {row.effectiveDate && <span>Effective {row.effectiveDate}</span>}
                          {row.expirationDate && <span>Expires {row.expirationDate}</span>}
                          {row.lineItemCreated && <span>Created {row.lineItemCreated}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-2xl border border-white/10 bg-black/20 overflow-hidden">
                  <div className="p-4 border-b border-white/10 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-white/85">Explicit Service Availability</div>
                      <div className="text-[11px] text-white/35">Not inferred from whether a price exists</div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-cyan-400/10 border border-cyan-300/15 text-cyan-100/70 text-xs font-semibold">{intelligence.availabilityCount.toLocaleString()}</span>
                  </div>
                  <div className="max-h-[58vh] overflow-y-auto divide-y divide-white/5">
                    {intelligence.availability.length === 0 && <div className="p-8 text-center text-white/30 text-sm">No explicit line-item availability links are attached to this canonical clinic.</div>}
                    {intelligence.availability.map((row, index) => (
                      <div key={`${row.componentName}-${index}`} className="p-3.5 flex items-start justify-between gap-3">
                        <div className="text-xs font-semibold text-white/75 leading-relaxed">{row.componentName}</div>
                        {row.componentType && <span className="px-2 py-1 rounded-full bg-white/5 border border-white/10 text-[9px] text-white/38 shrink-0">{row.componentType}</span>}
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            ) : (
              <div className="p-16 text-center text-white/35">No intelligence data loaded.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
