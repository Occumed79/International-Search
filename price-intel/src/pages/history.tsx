import { useGetSearchHistory } from "@workspace/api-client-react";
import { History as HistoryIcon, Search, Clock, ArrowRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Link } from "wouter";

export function History() {
  const { data: history, isLoading } = useGetSearchHistory({ limit: 50 }, { query: { queryKey: ["/api/search/history", { limit: 50 }] } });

  return (
    <div className="p-8 h-full overflow-auto bg-muted/5">
      <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
        
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold mb-2 ring-1 ring-primary/20">
            <HistoryIcon className="w-3.5 h-3.5" />
            <span>Activity Log</span>
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Search History</h1>
          <p className="text-muted-foreground text-lg">Timeline of your recent price intelligence queries.</p>
        </div>
        
        {isLoading ? (
          <div className="space-y-4">
            {[1,2,3,4].map(i => (
              <div key={i} className="glass-panel h-20 animate-pulse bg-muted/20"></div>
            ))}
          </div>
        ) : !history || history.length === 0 ? (
          <div className="glass-panel p-16 text-center flex flex-col items-center justify-center border border-border/40 shadow-xl">
            <div className="w-20 h-20 rounded-full bg-muted/50 flex items-center justify-center mb-6">
              <Clock className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-bold text-foreground mb-2">No history yet</h3>
            <p className="text-muted-foreground max-w-md">
              Your recent searches will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="glass-panel border border-border/40 shadow-xl overflow-hidden relative">
            <div className="absolute left-[39px] top-0 bottom-0 w-px bg-border/50"></div>
            
            <div className="divide-y divide-border/40">
              {history.map((item) => (
                <div key={item.id} className="p-4 sm:p-6 flex items-center gap-6 hover:bg-white/40 dark:hover:bg-white/5 transition-colors group relative">
                  
                  {/* Timeline Dot */}
                  <div className="w-5 h-5 rounded-full bg-background border-2 border-primary ring-4 ring-background z-10 flex-shrink-0"></div>
                  
                  <div className="flex-1 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Search className="w-4 h-4 text-muted-foreground" />
                        <span className="font-bold text-lg text-foreground tracking-tight">{item.query}</span>
                      </div>
                      <div className="text-sm text-muted-foreground flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {formatDistanceToNow(new Date(item.searchedAt), { addSuffix: true })}
                        </span>
                        <span className="w-1 h-1 rounded-full bg-muted-foreground/50"></span>
                        <span className="font-medium text-foreground/70">{item.resultCount} results found</span>
                      </div>
                    </div>
                    
                    <Link href={`/?q=${encodeURIComponent(item.query)}`} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 text-primary font-semibold text-sm hover:bg-primary hover:text-primary-foreground transition-all">
                      Rerun Query
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  </div>
                  
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
