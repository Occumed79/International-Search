import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, ChevronRight, FileText, CheckCircle2, AlertTriangle, ShieldAlert, Building, MapPin, Scale, ExternalLink, Shield } from "lucide-react";
import type { SearchResponse, PriceResult } from "@workspace/api-client-react";
import { useExportCsv, useGetProvider, useGetProviderPrices, useCreateBookmark } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter, DrawerClose } from "@/components/ui/drawer";
import { format } from "date-fns";

export function ResultsPanel({ response, isLoading }: { response: SearchResponse | undefined, isLoading: boolean }) {
  const exportMutation = useExportCsv();
  const { toast } = useToast();

  const [selectedProviderId, setSelectedProviderId] = useState<number | null>(null);
  const [compareIds, setCompareIds] = useState<Set<number>>(new Set());

  const handleExport = () => {
    if (!response?.searchId) return;
    
    exportMutation.mutate({ data: { searchId: response.searchId, format: 'csv' } }, {
      onSuccess: () => {
        toast({
          title: "Export Initialized",
          description: "Your CSV is being generated and will download shortly.",
        });
      },
      onError: () => {
        toast({
          title: "Export Failed",
          description: "Unable to generate CSV at this time.",
          variant: "destructive"
        });
      }
    });
  };

  const toggleCompare = (id: number) => {
    const next = new Set(compareIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      if (next.size >= 3) {
        toast({ title: "Comparison limit reached", description: "You can compare up to 3 providers at once." });
        return;
      }
      next.add(id);
    }
    setCompareIds(next);
  };

  if (isLoading) {
    return (
      <div className="glass-panel h-full w-full flex flex-col overflow-hidden border border-border/40 shadow-xl">
        <div className="p-4 border-b border-border/40 shrink-0">
          <div className="h-6 w-32 bg-muted rounded-md animate-pulse"></div>
        </div>
        <div className="flex-1 p-4 space-y-4">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="h-36 rounded-2xl bg-muted/30 animate-pulse border border-border/20"></div>
          ))}
        </div>
      </div>
    );
  }

  if (!response || (response.results.length === 0 && response.nopriceProviders.length === 0)) {
    return (
      <div className="glass-panel h-full w-full flex flex-col items-center justify-center text-center p-8 border border-border/40 shadow-xl">
        <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
          <SearchIcon />
        </div>
        <h3 className="text-lg font-semibold mb-2">No Intelligence Found</h3>
        <p className="text-muted-foreground text-sm max-w-[250px]">
          We couldn't locate posted prices for this query matching your filters.
        </p>
      </div>
    );
  }

  const comparingResults = response.results.filter(r => compareIds.has(r.id));

  return (
    <>
      <div className="glass-panel h-full w-full flex flex-col overflow-hidden border border-border/40 shadow-xl bg-white/40 dark:bg-black/40">
        
        {/* Header */}
        <div className="p-4 border-b border-border/40 bg-white/40 dark:bg-black/40 backdrop-blur-xl shrink-0 flex justify-between items-center z-10">
          <div>
            <div className="font-semibold text-lg flex items-center gap-2">
              {response.total} Results
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono font-normal">
                QID-{response.searchId}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground truncate max-w-[200px] mt-0.5">
              "{response.queryNormalized}"
            </div>
          </div>
          
          <Button 
            variant="outline" 
            size="sm" 
            className="h-8 text-xs font-medium glass-button gap-1.5"
            onClick={handleExport}
            disabled={exportMutation.isPending}
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </Button>
        </div>
        
        {/* Scrollable Results */}
        <ScrollArea className="flex-1 p-3">
          <div className="space-y-3 pb-6">
            
            {/* Compare Drawer Trigger if comparing */}
            {compareIds.size > 0 && (
              <div className="bg-primary/10 border border-primary/20 rounded-xl p-3 flex items-center justify-between animate-in slide-in-from-top-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <Scale className="w-4 h-4" />
                  {compareIds.size} selected for comparison
                </div>
                <Button size="sm" variant="secondary" onClick={() => {/* Simple alert for now, could open a modal */ toast({ title: "Comparing", description: comparingResults.map(r => `${r.providerName}: $${r.exactPrice}`).join(' vs ') })}}>
                  Compare
                </Button>
              </div>
            )}

            {/* Price Results */}
            {response.results.map((result) => (
              <ResultCard 
                key={result.id} 
                result={result} 
                onClick={() => setSelectedProviderId(result.providerId)} 
                onCompare={() => toggleCompare(result.id)}
                isComparing={compareIds.has(result.id)}
              />
            ))}

            {/* No Price Providers (Separated) */}
            {response.nopriceProviders && response.nopriceProviders.length > 0 && (
              <div className="mt-8 pt-6 border-t border-border/40">
                <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 px-2 flex items-center gap-2">
                  <Building className="w-4 h-4" />
                  Providers Found (No Price Posted)
                </h4>
                <div className="space-y-3">
                  {response.nopriceProviders.map((provider, i) => (
                    <div key={i} className="p-4 rounded-xl border border-border/40 bg-muted/10 opacity-70 hover:opacity-100 transition-opacity flex flex-col gap-1 cursor-pointer" onClick={() => setSelectedProviderId(provider.providerId)}>
                      <div className="font-semibold text-sm">{provider.providerName}</div>
                      <div className="text-xs text-muted-foreground">{provider.city}, {provider.stateRegion}</div>
                      <div className="mt-2 text-xs flex items-center gap-1.5 text-amber-600 dark:text-amber-500 bg-amber-500/10 w-fit px-2 py-0.5 rounded-full">
                        <AlertTriangle className="w-3 h-3" />
                        {provider.reason}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </ScrollArea>
      </div>

      <ProviderDetailDrawer 
        providerId={selectedProviderId} 
        onClose={() => setSelectedProviderId(null)} 
      />
    </>
  );
}

function ResultCard({ result, onClick, onCompare, isComparing }: { result: PriceResult, onClick: () => void, onCompare: (e: React.MouseEvent) => void, isComparing: boolean }) {
  // Determine verification styling
  let verifConfig = { icon: CheckCircle2, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' };
  
  if (result.verificationStatus.includes('needs_review') || result.confidenceScore < 80) {
    verifConfig = { icon: AlertTriangle, color: 'text-amber-600 dark:text-amber-500', bg: 'bg-amber-500/10 border-amber-500/20' };
  } else if (result.verificationStatus.includes('rejected')) {
    verifConfig = { icon: ShieldAlert, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10 border-red-500/20' };
  }

  const getSourceBadgeColor = (type: string) => {
    const t = type.toLowerCase();
    if (t.includes('mrf') || t.includes('hospital')) return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
    if (t.includes('pdf')) return 'bg-rose-500/10 text-rose-600 border-rose-500/20';
    if (t.includes('cms')) return 'bg-violet-500/10 text-violet-600 border-violet-500/20';
    return 'bg-slate-500/10 text-slate-600 border-slate-500/20';
  };

  const VerifIcon = verifConfig.icon;

  return (
    <div 
      onClick={onClick}
      className={`bg-card hover:bg-white/60 dark:hover:bg-white/5 border rounded-2xl p-4 transition-all duration-200 cursor-pointer group shadow-sm hover:shadow-md relative overflow-hidden ${isComparing ? 'border-primary ring-1 ring-primary/50' : 'border-border/50'}`}
    >
      <div className={`absolute top-0 right-0 w-32 h-32 blur-3xl opacity-10 rounded-full transition-opacity group-hover:opacity-20 pointer-events-none ${result.confidenceScore >= 90 ? 'bg-emerald-500' : 'bg-primary'}`}></div>

      <div className="flex justify-between items-start mb-3 relative z-10">
        <div className="pr-4">
          <h4 className="font-bold text-[15px] leading-tight text-foreground group-hover:text-primary transition-colors">{result.providerName}</h4>
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            {result.city}, {result.stateRegion}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-black text-foreground tracking-tight">
            {result.currency === 'USD' ? '$' : result.currency}{result.exactPrice.toLocaleString()}
          </div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mt-0.5">
            {result.priceType}
          </div>
        </div>
      </div>
      
      <div className="text-sm font-medium mb-4 text-foreground/80 line-clamp-1 relative z-10">
        {result.normalizedService}
        {result.billingCode && (
          <span className="ml-2 font-mono text-xs text-muted-foreground font-normal bg-muted/50 px-1.5 py-0.5 rounded">
            {result.billingCode}
          </span>
        )}
      </div>
      
      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border/40 relative z-10">
        <span className={`text-[10px] px-2 py-0.5 rounded-md border font-semibold flex items-center gap-1 ${getSourceBadgeColor(result.sourceType)}`}>
          <FileText className="w-3 h-3" />
          {result.sourceType}
        </span>
        
        <span className={`text-[10px] px-2 py-0.5 rounded-md border font-semibold flex items-center gap-1 ${verifConfig.bg} ${verifConfig.color}`}>
          <VerifIcon className="w-3 h-3" />
          {result.confidenceScore}% Conf
        </span>

        <div className="ml-auto flex items-center gap-2">
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-6 px-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              onCompare(e);
            }}
          >
            <Scale className="w-3 h-3 mr-1" />
            {isComparing ? 'Remove' : 'Compare'}
          </Button>
          <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </div>
  );
}

function ProviderDetailDrawer({ providerId, onClose }: { providerId: number | null, onClose: () => void }) {
  const { data: provider, isLoading: providerLoading } = useGetProvider(
    providerId || 0,
    { query: { enabled: !!providerId, queryKey: ["/api/providers", providerId] } }
  );

  const { data: prices, isLoading: pricesLoading } = useGetProviderPrices(
    providerId || 0,
    { query: { enabled: !!providerId, queryKey: ["/api/providers", providerId, "prices"] } }
  );

  const createBookmarkMutation = useCreateBookmark();
  const { toast } = useToast();

  const handleBookmark = () => {
    if (!providerId) return;
    createBookmarkMutation.mutate({ data: { providerId } }, {
      onSuccess: () => {
        toast({ title: "Bookmark saved" });
      }
    });
  };

  return (
    <Drawer open={!!providerId} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="max-h-[90vh] glass-panel rounded-t-3xl border-t border-border/40">
        <div className="mx-auto w-full max-w-4xl flex flex-col h-full overflow-hidden">
          {providerLoading ? (
            <div className="p-8 space-y-4">
              <div className="h-8 w-1/2 bg-muted/50 rounded animate-pulse"></div>
              <div className="h-4 w-1/4 bg-muted/50 rounded animate-pulse"></div>
            </div>
          ) : provider ? (
            <>
              <DrawerHeader className="border-b border-border/40 shrink-0">
                <div className="flex justify-between items-start">
                  <div>
                    <DrawerTitle className="text-2xl font-bold tracking-tight">{provider.name}</DrawerTitle>
                    <DrawerDescription className="flex items-center gap-2 mt-2">
                      <MapPin className="w-4 h-4" />
                      {provider.address}, {provider.city}, {provider.stateRegion}
                    </DrawerDescription>
                  </div>
                  <div className="flex gap-2">
                    {provider.website && (
                      <Button variant="outline" size="sm" asChild className="glass-button">
                        <a href={provider.website} target="_blank" rel="noreferrer">
                          <ExternalLink className="w-4 h-4 mr-2" />
                          Website
                        </a>
                      </Button>
                    )}
                    <Button variant="secondary" size="sm" onClick={handleBookmark} disabled={createBookmarkMutation.isPending}>
                      Bookmark
                    </Button>
                  </div>
                </div>
              </DrawerHeader>

              <ScrollArea className="flex-1 p-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  
                  {/* Info Column */}
                  <div className="space-y-6">
                    <div className="glass-panel p-4 space-y-4">
                      <div>
                        <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Provider Type</h5>
                        <p className="font-medium">{provider.providerType}</p>
                      </div>
                      {provider.npi && (
                        <div>
                          <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">NPI</h5>
                          <p className="font-mono text-sm">{provider.npi}</p>
                        </div>
                      )}
                      {provider.phone && (
                        <div>
                          <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Phone</h5>
                          <p className="font-medium">{provider.phone}</p>
                        </div>
                      )}
                      <div>
                        <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Sources Verified</h5>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {provider.sources.map(s => (
                            <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Prices Column */}
                  <div className="md:col-span-2 space-y-4">
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                      <Shield className="w-5 h-5 text-primary" />
                      Verified Intelligence Evidence
                    </h3>
                    
                    {pricesLoading ? (
                      <div className="space-y-4">
                        {[1,2].map(i => <div key={i} className="h-32 bg-muted/20 animate-pulse rounded-xl"></div>)}
                      </div>
                    ) : prices && prices.length > 0 ? (
                      <div className="space-y-4">
                        {prices.map((price) => (
                          <div key={price.id} className="glass-panel p-5 border border-border/40">
                            <div className="flex justify-between items-start mb-4">
                              <div>
                                <h4 className="font-bold text-foreground">{price.normalizedService}</h4>
                                <p className="text-sm text-muted-foreground mt-1">Raw Query: {price.serviceQuery}</p>
                              </div>
                              <div className="text-right">
                                <div className="text-xl font-black text-foreground">
                                  {price.currency === 'USD' ? '$' : price.currency}{price.exactPrice.toLocaleString()}
                                </div>
                                <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mt-0.5">
                                  {price.priceType}
                                </div>
                              </div>
                            </div>

                            <div className="bg-muted/30 rounded-lg p-3 space-y-3 border border-border/20">
                              <div>
                                <h5 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Raw Evidence Text</h5>
                                <p className="text-xs font-mono text-foreground/80 break-words line-clamp-3">"{price.evidenceText}"</p>
                              </div>
                              
                              <div className="flex items-center justify-between border-t border-border/20 pt-3">
                                <div className="flex gap-4">
                                  {price.billingCode && (
                                    <div>
                                      <h5 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Code</h5>
                                      <span className="text-xs font-mono">{price.billingCode}</span>
                                    </div>
                                  )}
                                  <div>
                                    <h5 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Timestamp</h5>
                                    <span className="text-xs font-mono">{format(new Date(price.timestampFound), 'MMM d, yyyy HH:mm')}</span>
                                  </div>
                                </div>
                                
                                {price.sourceUrl && (
                                  <a href={price.sourceUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary hover:underline flex items-center gap-1">
                                    Source File <ExternalLink className="w-3 h-3" />
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="glass-panel p-8 text-center text-muted-foreground border border-border/40">
                        No individual prices recorded for this provider.
                      </div>
                    )}
                  </div>
                </div>
              </ScrollArea>
            </>
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// Dummy SearchIcon component for empty state
function SearchIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinelinejoin="round" className="text-muted-foreground"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>;
}
