import { useState, useEffect } from "react";
import { useSearchPrices, useGetStatsSummary, useGetTopServices } from "@workspace/api-client-react";
import type { SearchRequest, PriceResult, SearchResponse } from "@workspace/api-client-react";
import { Activity, Building2, Map as MapIcon, Database, Stethoscope, Search } from "lucide-react";
import { SearchBar } from "@/components/search-bar";
import { MapView } from "@/components/map-view";
import { ResultsPanel } from "@/components/results-panel";
import { ScrollArea } from "@/components/ui/scroll-area";

export function Home() {
  const [searchQuery, setSearchQuery] = useState<SearchRequest | null>(null);
  
  const searchMutation = useSearchPrices();
  const { data: stats } = useGetStatsSummary({ query: { queryKey: ["/api/stats/summary"] } });
  const { data: topServices } = useGetTopServices({ limit: 12 }, { query: { queryKey: ["/api/stats/top-services", { limit: 12 }] } });
  
  const handleSearch = (query: SearchRequest) => {
    setSearchQuery(query);
    searchMutation.mutate({ data: query });
  };

  const hasSearched = searchMutation.isSuccess || searchMutation.isPending;

  return (
    <div className="h-full w-full flex flex-col">
      {/* Search Header Area */}
      <div className={`transition-all duration-500 ease-in-out flex flex-col items-center justify-center px-6 ${hasSearched ? "py-4 flex-none border-b border-border/40 bg-background/50 backdrop-blur-md z-10" : "flex-1 py-12 overflow-y-auto"}`}>
        
        {!hasSearched && (
          <div className="text-center mb-8 max-w-3xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-semibold mb-2 ring-1 ring-primary/20">
              <Activity className="w-3.5 h-3.5" />
              <span>Live Price Intelligence Terminal</span>
            </div>
            <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-foreground balance drop-shadow-sm">
              Uncover Real Healthcare Prices
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Search millions of posted out-of-pocket prices from hospitals and clinics globally. Stop guessing, start knowing.
            </p>
          </div>
        )}

        <div className={`w-full ${hasSearched ? "max-w-6xl" : "max-w-3xl"} transition-all duration-500`}>
          <SearchBar onSearch={handleSearch} isCompact={hasSearched} isLoading={searchMutation.isPending} currentQuery={searchQuery} />
        </div>

        {!hasSearched && (
          <div className="w-full max-w-4xl mx-auto mt-12 space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-200 fill-mode-both pb-12">
            
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon={Building2} label="Providers Analyzed" value={stats.totalProviders.toLocaleString()} />
                <StatCard icon={Database} label="Data Points" value={stats.totalPrices.toLocaleString()} />
                <StatCard icon={MapIcon} label="Coverage Regions" value={stats.countriesCovered.toLocaleString()} />
                <StatCard icon={Activity} label="Data Sources" value={stats.totalSources.toLocaleString()} />
              </div>
            )}

            {topServices && topServices.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  <Stethoscope className="w-4 h-4" />
                  <span>Frequently Queried Services</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {topServices.map((svc) => (
                    <button
                      key={svc.service}
                      onClick={() => handleSearch({ query: svc.service })}
                      className="glass-panel p-4 text-left hover:bg-primary/5 hover:border-primary/20 transition-all group flex flex-col justify-between h-24"
                    >
                      <span className="font-medium text-sm line-clamp-2 group-hover:text-primary transition-colors">{svc.service}</span>
                      <div className="flex items-center justify-between text-xs text-muted-foreground mt-2">
                        <span>{svc.searchCount} queries</span>
                        <Search className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Content Area */}
      {hasSearched && (
        <div className="flex-1 flex overflow-hidden p-4 gap-4 animate-in fade-in duration-500 bg-muted/5">
          {/* Results Panel */}
          <div className="w-full max-w-md xl:max-w-lg h-full flex flex-col z-10">
            <ResultsPanel 
              response={searchMutation.data as SearchResponse} 
              isLoading={searchMutation.isPending} 
            />
          </div>

          {/* Map Section */}
          <div className="flex-1 relative rounded-2xl overflow-hidden glass-panel border border-border/40 shadow-inner z-0">
            <MapView 
              results={searchMutation.data?.results || []} 
              isLoading={searchMutation.isPending} 
            />
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: any, label: string, value: string }) {
  return (
    <div className="glass-panel p-5 flex flex-col items-center justify-center text-center gap-3 group hover:bg-white/40 dark:hover:bg-white/5 transition-all border border-border/40">
      <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <div className="text-3xl font-bold tracking-tight text-foreground drop-shadow-sm">{value}</div>
        <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mt-1">{label}</div>
      </div>
    </div>
  );
}
