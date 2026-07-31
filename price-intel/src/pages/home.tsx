import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useSearchPrices, useGetStatsSummary } from "@workspace/api-client-react";
import type { SearchRequest, SearchResponse } from "@workspace/api-client-react";
import {
  Activity, Building2, Database, Stethoscope,
  Globe, HeartPulse, Microscope, Zap, Pill,
} from "lucide-react";
import { SearchBar } from "@/components/search-bar";
import { MapView } from "@/components/map-view";
import { ResultsPanel } from "@/components/results-panel";

const QUICK_PROVIDERS = [
  { query: "Occupational Health", providerType: "occupational_health", country: "MX", city: "Guadalajara", icon: Building2 },
  { query: "Occupational Health", providerType: "occupational_health", country: "MX", city: "Mexico City", icon: Building2 },
  { query: "Hospital", providerType: "hospital", country: "GB", city: "London", icon: HeartPulse },
  { query: "Clinic", providerType: "clinic", country: "CA", city: "Toronto", icon: Stethoscope },
  { query: "Dental", providerType: "dental", country: "ES", city: "Madrid", icon: Building2 },
  { query: "Laboratory", providerType: "lab", country: "DE", city: "Berlin", icon: Microscope },
  { query: "Urgent Care", providerType: "urgent_care", country: "AU", city: "Sydney", icon: Zap },
  { query: "Imaging Center", providerType: "imaging_center", country: "FR", city: "Paris", icon: Activity },
  { query: "Pharmacy", providerType: "pharmacy", country: "BR", city: "S\u00e3o Paulo", icon: Pill },
  { query: "Clinic", providerType: "clinic", country: "TH", city: "Bangkok", icon: Globe },
  { query: "Hospital", providerType: "hospital", country: "IN", city: "Mumbai", icon: HeartPulse },
  { query: "Occupational Health", providerType: "occupational_health", country: "CA", city: "Vancouver", icon: Building2 },
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
  const { toast } = useToast();

  const handleSearch = (query: SearchRequest) => {
    if (query.country === "US" || query.country === "USA") {
      toast({
        title: "US not supported",
        description: "This portal is international only. Pick a non-US country.",
        variant: "destructive",
      });
      return;
    }
    setSearchQuery(query);
    searchMutation.mutate(
      { data: query },
      {
        onError: (err: unknown) => {
          const message = err instanceof Error ? err.message : "Search failed — please try again";
          toast({ title: "Search error", description: message, variant: "destructive" });
        },
      },
    );
  };

  const hasSearched = searchMutation.isSuccess || searchMutation.isPending || searchMutation.isError;
  const results = (searchMutation.data as SearchResponse | undefined)?.results ?? [];

  return (
    <div className="h-full w-full flex flex-col">
      <div
        className={`transition-all duration-500 ease-in-out flex flex-col items-center justify-center px-6 ${
          hasSearched ? "py-4 flex-none z-10" : "flex-1 py-12 overflow-y-auto"
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
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-2"
              style={{
                background: "rgba(160,80,255,0.12)",
                color: "rgba(200,140,255,0.95)",
                border: "1px solid rgba(160,80,255,0.25)",
              }}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>International Provider Finder · Non-US only</span>
            </div>

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
              Find Healthcare Providers<br />Worldwide
            </h1>

            <p className="text-lg max-w-2xl mx-auto leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
              Choose a country, city, and provider type — we search OpenStreetMap, Wikidata,
              and optional web metasearch in parallel, then filter noise before you see results.
              <span className="block mt-1 text-sm" style={{ color: "rgba(255,255,255,0.32)" }}>
                United States is excluded from this portal.
              </span>
            </p>
          </div>
        )}

        <div className={`w-full ${hasSearched ? "max-w-6xl" : "max-w-5xl"} transition-all duration-500`}>
          <SearchBar
            onSearch={handleSearch}
            isCompact={hasSearched}
            isLoading={searchMutation.isPending}
            currentQuery={searchQuery}
          />
        </div>

        {!hasSearched && (
          <div className="w-full max-w-4xl mx-auto mt-12 space-y-10 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-200 fill-mode-both pb-12">
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon={Building2} label="Providers Indexed" value={stats.totalProviders.toLocaleString()} />
                <StatCard icon={Database} label="Records" value={stats.totalPrices.toLocaleString()} />
                <StatCard icon={Globe} label="Countries" value={stats.countriesCovered.toLocaleString()} />
                <StatCard icon={Activity} label="Sources" value={String(stats.totalSources ?? 3)} />
              </div>
            )}

            <div className="space-y-4">
              <div
                className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em]"
                style={{ color: "rgba(200,140,255,0.55)" }}
              >
                <Stethoscope className="w-4 h-4" />
                <span>Quick search — provider type + city</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {QUICK_PROVIDERS.map((svc) => {
                  const Icon = svc.icon;
                  return (
                    <button
                      key={`${svc.providerType}-${svc.city}`}
                      onClick={() =>
                        handleSearch({
                          query: svc.query,
                          country: svc.country,
                          city: svc.city,
                          providerType: svc.providerType,
                        } as SearchRequest)
                      }
                      className="p-3.5 text-left transition-all group flex items-start gap-2.5 rounded-xl"
                      style={{
                        background: "rgba(25,10,45,0.55)",
                        border: "1px solid rgba(160,80,255,0.14)",
                        backdropFilter: "blur(16px)",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "rgba(40,15,70,0.70)";
                        (e.currentTarget as HTMLElement).style.borderColor = "rgba(180,100,255,0.30)";
                      }}
                      onMouseLeave={(e) => {
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
                      <div>
                        <span className="font-medium text-sm leading-tight block" style={{ color: "rgba(255,255,255,0.78)" }}>
                          {svc.query}
                        </span>
                        <span className="text-xs" style={{ color: "rgba(200,140,255,0.45)" }}>
                          {svc.city}, {svc.country}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              className="p-5 rounded-2xl space-y-3"
              style={{
                background: "rgba(20,8,38,0.60)",
                border: "1px solid rgba(160,80,255,0.12)",
                backdropFilter: "blur(20px)",
              }}
            >
              <div className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "rgba(200,140,255,0.50)" }}>
                Multi-mode sources
              </div>
              <div className="flex flex-wrap gap-2">
                {["OpenStreetMap", "Wikidata", "SearXNG (optional)", "Local cache", "Domain filters"].map((s) => (
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
