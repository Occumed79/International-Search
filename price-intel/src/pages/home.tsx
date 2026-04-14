import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useSearchPrices, useGetStatsSummary, useGetTopServices } from "@workspace/api-client-react";
import type { SearchRequest, PriceResult, SearchResponse } from "@workspace/api-client-react";
import {
  Activity, Building2, Map as MapIcon, Database, Stethoscope,
  Search, Globe, Microscope, HeartPulse, Pill, Zap, Teeth
} from "lucide-react";
import { SearchBar } from "@/components/search-bar";
import { MapView } from "@/components/map-view";
import { ResultsPanel } from "@/components/results-panel";
import { ScrollArea } from "@/components/ui/scroll-area";

// Quick-launch categories
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
    <div className="glass-panel p-4 flex items-center gap-3 border border-border/40 shadow-sm">
      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="w-4.5 h-4.5 text-primary" />
      </div>
      <div>
        <div className="text-xl font-bold leading-none">{value}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
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
      {/* Search header */}
      <div
        className={`transition-all duration-500 ease-in-out flex flex-col items-center justify-center px-6 ${
          hasSearched
            ? "py-4 flex-none border-b border-border/40 bg-background/50 backdrop-blur-md z-10"
            : "flex-1 py-12 overflow-y-auto"
        }`}
      >
        {!hasSearched && (
          <div className="text-center mb-10 max-w-3xl mx-auto space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-semibold mb-2 ring-1 ring-primary/20">
              <Activity className="w-3.5 h-3.5" />
              <span>Portal 5 · Global Price Intelligence Terminal</span>
            </div>
            <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-foreground balance drop-shadow-sm">
              Uncover Real Healthcare<br />Prices Worldwide
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Search publicly posted out-of-pocket prices from clinics, hospitals, labs,
              and specialists across the US and internationally.
              <span className="block mt-1 text-base text-muted-foreground/70">
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
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
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
                      className="glass-panel p-3.5 text-left hover:bg-primary/5 hover:border-primary/20 transition-all group flex items-start gap-2.5 border border-border/40"
                    >
                      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors mt-0.5">
                        <Icon className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <span className="font-medium text-sm leading-tight group-hover:text-primary transition-colors line-clamp-2">
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
                <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  <Search className="w-4 h-4" />
                  <span>Frequently Queried</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {topServices.slice(0, 8).map((svc) => (
                    <button
                      key={svc.service}
                      onClick={() => handleSearch({ query: svc.service })}
                      className="glass-panel p-4 text-left hover:bg-primary/5 hover:border-primary/20 transition-all group flex flex-col justify-between h-20 border border-border/40"
                    >
                      <span className="font-medium text-sm line-clamp-2 group-hover:text-primary transition-colors">
                        {svc.service}
                      </span>
                      <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
                        <span>{svc.searchCount} queries</span>
                        <Search className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Source trust signals */}
            <div className="glass-panel p-5 border border-border/40 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Intelligence Sources</div>
              <div className="flex flex-wrap gap-2">
                {[
                  "Hospital MRF (CMS)", "Provider Websites", "PDF Fee Schedules",
                  "NPPES / NPI Registry", "DoltHub Transparency", "JSON-LD Extraction",
                  "CMS Care Compare", "International Clinic Pages", "Lab & Imaging Menus",
                ].map((s) => (
                  <span key={s} className="px-2.5 py-1 rounded-full bg-muted/40 text-xs font-medium border border-border/40">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Results + Map */}
      {hasSearched && (
        <div className="flex-1 flex overflow-hidden p-4 gap-4 animate-in fade-in duration-500 bg-muted/5">
          <div className="w-full max-w-md xl:max-w-lg h-full flex flex-col z-10">
            <ResultsPanel
              response={searchMutation.data as SearchResponse}
              isLoading={searchMutation.isPending}
            />
          </div>
          <div className="flex-1 relative rounded-2xl overflow-hidden glass-panel border border-border/40 shadow-inner z-0">
            <MapView results={results} />
          </div>
        </div>
      )}
    </div>
  );
}
