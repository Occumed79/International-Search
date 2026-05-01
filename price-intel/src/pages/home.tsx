import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useSearchPrices, useGetStatsSummary, useGetTopServices } from "@workspace/api-client-react";
import type { SearchRequest, PriceResult, SearchResponse } from "@workspace/api-client-react";
import {
  Activity, Building2, Database, Stethoscope,
  Search, Globe, Microscope, HeartPulse, Pill, Zap,
} from "lucide-react";
import { SearchBar } from "@/components/search-bar";
import { MapView } from "@/components/map-view";
import { ResultsPanel } from "@/components/results-panel";

const QUICK_SERVICES = [
  { query: "MRI brain without contrast",    icon: Microscope,  country: "" },
  { query: "treadmill stress test",          icon: HeartPulse,  country: "" },
  { query: "chest X-ray 2-view",            icon: Activity,    country: "" },
  { query: "colonoscopy self-pay",           icon: Stethoscope, country: "" },
  { query: "QuantiFERON blood test",         icon: Microscope,  country: "" },
  { query: "DOT physical exam",              icon: Building2,   country: "US" },
  { query: "FAA medical exam",               icon: Building2,   country: "US" },
  { query: "dental exam with bitewings",     icon: Building2,   country: "" },
  { query: "mammogram screening",            icon: HeartPulse,  country: "" },
  { query: "CBC lab panel",                  icon: Microscope,  country: "" },
  { query: "echocardiogram",                 icon: HeartPulse,  country: "" },
  { query: "urgent care visit",              icon: Zap,         country: "" },
  { query: "travel vaccines",                icon: Globe,       country: "" },
  { query: "gallbladder ultrasound",         icon: Activity,    country: "" },
  { query: "drug screen 5-panel",            icon: Pill,        country: "" },
  { query: "hip replacement self-pay",       icon: Building2,   country: "" },
];

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div
      className="flex items-center gap-3 p-4 rounded-2xl"
      style={{
        background: "rgba(25, 10, 45, 0.65)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(180, 100, 255, 0.18)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: "rgba(160,80,255,0.15)" }}
      >
        <Icon className="w-4 h-4" style={{ color: "rgba(200,140,255,0.90)" }} />
      </div>
      <div>
        <div className="text-xl font-bold leading-none" style={{ color: "rgba(255,255,255,0.92)" }}>{value}</div>
        <div className="text-xs mt-0.5" style={{ color: "rgba(200,140,255,0.55)" }}>{label}</div>
      </div>
    </div>
  );
}

export function Home() {
  const [searchQuery, setSearchQuery] = useState<SearchRequest | null>(null);
  const searchMutation = useSearchPrices();
  const { data: stats } = useGetStatsSummary({ query: { queryKey: ["/api/stats/summary"] } });
  const { data: topServices } = useGetTopServices(
    { limit: 12 },
    { query: { queryKey: ["/api/stats/top-services", { limit: 12 }] } }
  );
  const { toast } = useToast();

  const handleSearch = (query: SearchRequest) => {
    setSearchQuery(query);
    searchMutation.mutate(
      { data: query },
      {
        onError: (err: unknown) => {
          const message = err instanceof Error ? err.message : "Search failed — please try again";
          toast({ title: "Search error", description: message, variant: "destructive" });
        },
      }
    );
  };

  const hasSearched = searchMutation.isSuccess || searchMutation.isPending || searchMutation.isError;
  const results = (searchMutation.data as SearchResponse | undefined)?.results ?? [];

  return (
    <div className="h-full w-full flex flex-col">
      {/* ── Search header ── */}
      <div
        className={`transition-all duration-500 ease-in-out flex flex-col items-center justify-center px-6 ${
          hasSearched
            ? "py-4 flex-none z-10"
            : "flex-1 py-12 overflow-y-auto"
        }`}
        style={hasSearched ? {
          background: "rgba(14,4,28,0.80)",
          backdropFilter: "blur(28px)",
          borderBottom: "1px solid rgba(160,80,255,0.14)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.40)",
        } : undefined}
      >
        {!hasSearched && (
          <div className="text-center mb-10 max-w-3xl mx-auto space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Portal badge */}
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-2"
              style={{
                background: "rgba(160,80,255,0.12)",
                color: "rgba(200,140,255,0.95)",
                border: "1px solid rgba(160,80,255,0.25)",
              }}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Portal 5 · Global Price Intelligence Terminal</span>
            </div>

            {/* Hero title */}
            <h1
              className="font-bold tracking-tight leading-tight"
              style={{
                fontSize: "clamp(2.4rem, 6vw, 4.5rem)",
                background: "linear-gradient(135deg, #fff 0%, rgba(200,140,255,0.90) 50%, rgba(255,160,80,0.80) 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Uncover Real Healthcare<br />Prices Worldwide
            </h1>

            <p className="text-lg max-w-2xl mx-auto leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
              Search publicly posted out-of-pocket prices from clinics, hospitals, labs,
              and specialists across the US and internationally.
              <span className="block mt-1 text-sm" style={{ color: "rgba(255,255,255,0.32)" }}>
                Only exact posted prices — no estimates, no fabrications.
              </span>
            </p>
          </div>
        )}

        <div className={`w-full ${hasSearched ? "max-w-6xl" : "max-w-4xl"} transition-all duration-500`}>
          <SearchBar
            onSearch={handleSearch}
            isCompact={hasSearched}
            isLoading={searchMutation.isPending}
            currentQuery={searchQuery}
          />
        </div>

        {!hasSearched && (
          <div className="w-full max-w-4xl mx-auto mt-12 space-y-10 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-200 fill-mode-both pb-12">
            {/* Stats */}
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon={Building2} label="Providers Analyzed"  value={stats.totalProviders.toLocaleString()} />
                <StatCard icon={Database}  label="Price Records"       value={stats.totalPrices.toLocaleString()} />
                <StatCard icon={Globe}     label="Countries Covered"   value={stats.countriesCovered.toLocaleString()} />
                <StatCard icon={Activity}  label="Data Sources"        value={stats.totalSources.toLocaleString()} />
              </div>
            )}

            {/* Quick services */}
            <div className="space-y-4">
              <div
                className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em]"
                style={{ color: "rgba(200,140,255,0.55)" }}
              >
                <Stethoscope className="w-4 h-4" />
                <span>Quick Search — Common Services</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {QUICK_SERVICES.map((svc) => {
                  const Icon = svc.icon;
                  return (
                    <button
                      key={svc.query}
                      onClick={() => handleSearch({ query: svc.query, country: svc.country || undefined })}
                      className="p-3.5 text-left transition-all group flex items-start gap-2.5 rounded-xl"
                      style={{
                        background: "rgba(25,10,45,0.55)",
                        border: "1px solid rgba(160,80,255,0.14)",
                        backdropFilter: "blur(16px)",
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.background = "rgba(40,15,70,0.70)";
                        (e.currentTarget as HTMLElement).style.borderColor = "rgba(180,100,255,0.30)";
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.background = "rgba(25,10,45,0.55)";
                        (e.currentTarget as HTMLElement).style.borderColor = "rgba(160,80,255,0.14)";
                      }}
                    >
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                        style={{ background: "rgba(160,80,255,0.12)" }}
                      >
                        <Icon className="w-3.5 h-3.5" style={{ color: "rgba(200,140,255,0.80)" }} />
                      </div>
                      <span className="font-medium text-sm leading-tight line-clamp-2" style={{ color: "rgba(255,255,255,0.78)" }}>
                        {svc.query}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Top services from DB */}
            {topServices && topServices.length > 0 && (
              <div className="space-y-4">
                <div
                  className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em]"
                  style={{ color: "rgba(200,140,255,0.55)" }}
                >
                  <Search className="w-4 h-4" />
                  <span>Frequently Queried</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {topServices.slice(0, 8).map((svc) => (
                    <button
                      key={svc.service}
                      onClick={() => handleSearch({ query: svc.service })}
                      className="p-4 text-left transition-all group flex flex-col justify-between h-20 rounded-xl"
                      style={{
                        background: "rgba(25,10,45,0.55)",
                        border: "1px solid rgba(160,80,255,0.14)",
                        backdropFilter: "blur(16px)",
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.background = "rgba(40,15,70,0.70)";
                        (e.currentTarget as HTMLElement).style.borderColor = "rgba(180,100,255,0.30)";
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.background = "rgba(25,10,45,0.55)";
                        (e.currentTarget as HTMLElement).style.borderColor = "rgba(160,80,255,0.14)";
                      }}
                    >
                      <span className="font-medium text-sm line-clamp-2" style={{ color: "rgba(255,255,255,0.78)" }}>
                        {svc.service}
                      </span>
                      <div className="flex items-center justify-between text-xs mt-1" style={{ color: "rgba(200,140,255,0.45)" }}>
                        <span>{svc.searchCount} queries</span>
                        <Search className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Source trust signals */}
            <div
              className="p-5 rounded-2xl space-y-3"
              style={{
                background: "rgba(20,8,38,0.60)",
                border: "1px solid rgba(160,80,255,0.12)",
                backdropFilter: "blur(20px)",
              }}
            >
              <div className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "rgba(200,140,255,0.50)" }}>
                Intelligence Sources
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  "Hospital MRF (CMS)", "Provider Websites", "PDF Fee Schedules",
                  "NPPES / NPI Registry", "DoltHub Transparency", "JSON-LD Extraction",
                  "CMS Care Compare", "International Clinic Pages", "Lab & Imaging Menus",
                ].map((s) => (
                  <span
                    key={s}
                    className="px-2.5 py-1 rounded-full text-xs font-medium"
                    style={{
                      background: "rgba(160,80,255,0.08)",
                      border: "1px solid rgba(160,80,255,0.18)",
                      color: "rgba(255,255,255,0.60)",
                    }}
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Results / Map ── */}
      {hasSearched && (
        <div className="flex-1 overflow-hidden flex">
          <div className="flex-1 overflow-hidden">
            <ResultsPanel
              results={results}
              isLoading={searchMutation.isPending}
              error={searchMutation.isError ? (searchMutation.error as Error)?.message || "Search failed" : null}
              query={searchQuery?.query || ""}
            />
          </div>
          <div className="hidden xl:block w-[420px] border-l flex-none" style={{ borderColor: "rgba(160,80,255,0.14)" }}>
            <MapView results={results} />
          </div>
        </div>
      )}
    </div>
  );
}
