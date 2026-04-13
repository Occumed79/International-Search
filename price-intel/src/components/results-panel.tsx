import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Download, ChevronRight, FileText, CheckCircle2, AlertTriangle,
  ShieldAlert, Building, MapPin, Scale, ExternalLink, Shield,
  Database, Globe, Landmark, Microscope, FileSearch, X, SplitSquareHorizontal,
  Star, Info
} from "lucide-react";
import type { SearchResponse, PriceResult } from "@workspace/api-client-react";
import { useExportCsv, useGetProvider, useGetProviderPrices, useCreateBookmark } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle,
  DrawerDescription, DrawerFooter, DrawerClose,
} from "@/components/ui/drawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";

// ─── Source badge config ────────────────────────────────────────────────────
const SOURCE_BADGES: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  hospital_mrf:     { label: "Hospital MRF",      icon: Landmark,    color: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  provider_website: { label: "Provider Website",  icon: Globe,       color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  pdf_price_sheet:  { label: "PDF Price Sheet",   icon: FileText,    color: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  cms_dataset:      { label: "CMS Dataset",       icon: Database,    color: "bg-purple-500/10 text-purple-600 border-purple-500/20" },
  dolthub:          { label: "DoltHub",           icon: Database,    color: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20" },
  public_registry:  { label: "Public Registry",   icon: Shield,      color: "bg-slate-500/10 text-slate-600 border-slate-500/20" },
  json_ld:          { label: "JSON-LD",           icon: FileSearch,  color: "bg-teal-500/10 text-teal-600 border-teal-500/20" },
  lab_menu:         { label: "Lab Menu",          icon: Microscope,  color: "bg-rose-500/10 text-rose-600 border-rose-500/20" },
};

const PRICE_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  self_pay:        { label: "Self-Pay",        color: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" },
  cash_pay:        { label: "Cash Pay",        color: "bg-green-500/10 text-green-700 border-green-500/30" },
  discounted_cash: { label: "Discounted Cash", color: "bg-blue-500/10 text-blue-700 border-blue-500/30" },
  bundled:         { label: "Bundle Package",  color: "bg-violet-500/10 text-violet-700 border-violet-500/30" },
  fee_schedule:    { label: "Fee Schedule",    color: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
};

const VERIFICATION_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  verified_exact_posted_price: { label: "Verified Exact Price",    icon: CheckCircle2, color: "text-emerald-600" },
  likely_exact_price_needs_review: { label: "Likely Exact — Needs Review", icon: AlertTriangle, color: "text-amber-600" },
  provider_found_no_price:     { label: "Provider — No Posted Price", icon: Info, color: "text-blue-500" },
  rejected_non_qualifying_source: { label: "Rejected",             icon: ShieldAlert, color: "text-red-500" },
};

function formatCurrency(amount: number, currency = "USD") {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function SourceBadge({ sourceType }: { sourceType: string }) {
  const cfg = SOURCE_BADGES[sourceType] ?? { label: sourceType, icon: Globe, color: "bg-muted/50 text-muted-foreground border-border/40" };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function PriceTypeBadge({ priceType }: { priceType: string }) {
  const cfg = PRICE_TYPE_CONFIG[priceType] ?? { label: priceType, color: "bg-muted/50 text-muted-foreground border-border/40" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

function ConfidenceBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-muted-foreground w-8 text-right">{pct}%</span>
    </div>
  );
}

// ─── Provider Detail Drawer ─────────────────────────────────────────────────
function ProviderDrawer({ providerId, open, onClose }: { providerId: number | null; open: boolean; onClose: () => void }) {
  const { data: provider } = useGetProvider(
    { id: providerId! },
    { query: { enabled: !!providerId, queryKey: ["/api/providers", providerId] } }
  );
  const { data: prices } = useGetProviderPrices(
    { id: providerId! },
    { query: { enabled: !!providerId, queryKey: ["/api/providers", providerId, "prices"] } }
  );
  const bookmarkMutation = useCreateBookmark();
  const { toast } = useToast();

  const handleBookmark = () => {
    if (!providerId) return;
    bookmarkMutation.mutate(
      { data: { providerId } },
      {
        onSuccess: () => toast({ title: "Provider bookmarked ✓" }),
        onError: () => toast({ title: "Failed to bookmark", variant: "destructive" }),
      }
    );
  };

  return (
    <Drawer open={open} onClose={onClose}>
      <DrawerContent className="glass-panel max-h-[90dvh] border-t border-border/40">
        <DrawerHeader className="border-b border-border/40 pb-4">
          <div className="flex items-start justify-between">
            <div>
              <DrawerTitle className="text-2xl font-bold">{provider?.name ?? "Loading…"}</DrawerTitle>
              <DrawerDescription className="flex items-center gap-2 mt-1">
                {provider && (
                  <>
                    <Badge variant="secondary">{provider.providerType}</Badge>
                    {provider.specialty && <Badge variant="outline">{provider.specialty}</Badge>}
                    <span className="text-muted-foreground flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {[provider.city, provider.stateRegion, provider.country].filter(Boolean).join(", ")}
                    </span>
                  </>
                )}
              </DrawerDescription>
            </div>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon" className="rounded-xl" onClick={onClose}>
                <X className="w-4 h-4" />
              </Button>
            </DrawerClose>
          </div>
        </DrawerHeader>

        <ScrollArea className="flex-1 overflow-auto">
          <div className="p-6 space-y-6">
            {provider && (
              <div className="grid grid-cols-2 gap-4 text-sm">
                {provider.npi && (
                  <div className="glass-panel p-3 rounded-xl">
                    <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-1">NPI</div>
                    <div className="font-mono">{provider.npi}</div>
                  </div>
                )}
                {provider.phone && (
                  <div className="glass-panel p-3 rounded-xl">
                    <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-1">Phone</div>
                    <div>{provider.phone}</div>
                  </div>
                )}
                {provider.website && (
                  <div className="glass-panel p-3 rounded-xl col-span-2">
                    <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-1">Website</div>
                    <a href={provider.website} target="_blank" rel="noopener noreferrer"
                      className="text-primary hover:underline flex items-center gap-1 truncate">
                      {provider.website} <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  </div>
                )}
                <div className="glass-panel p-3 rounded-xl">
                  <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-1">Last Updated</div>
                  <div>{provider.lastUpdated ? format(new Date(provider.lastUpdated), "MMM d, yyyy") : "—"}</div>
                </div>
                <div className="glass-panel p-3 rounded-xl">
                  <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-1">Price Records</div>
                  <div className="font-semibold text-primary">{provider.priceCount}</div>
                </div>
              </div>
            )}

            {prices && prices.length > 0 && (
              <div className="space-y-3">
                <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Posted Prices</h3>
                {prices.map((p: PriceResult) => (
                  <div key={p.id} className="glass-panel p-4 rounded-xl space-y-2 border border-border/40">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">{p.normalizedService || p.serviceQuery}</div>
                        {p.billingCode && <div className="text-xs font-mono text-muted-foreground">CPT: {p.billingCode}</div>}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xl font-bold text-primary">{formatCurrency(p.exactPrice, p.currency)}</div>
                        <PriceTypeBadge priceType={p.priceType} />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <SourceBadge sourceType={p.sourceType} />
                      {p.verificationStatus && (
                        (() => {
                          const cfg = VERIFICATION_CONFIG[p.verificationStatus];
                          const Icon = cfg?.icon ?? CheckCircle2;
                          return (
                            <span className={`inline-flex items-center gap-1 text-xs font-medium ${cfg?.color ?? "text-muted-foreground"}`}>
                              <Icon className="w-3 h-3" />
                              {cfg?.label ?? p.verificationStatus}
                            </span>
                          );
                        })()
                      )}
                    </div>
                    <ConfidenceBar score={p.confidenceScore ?? 0.9} />
                    {p.evidenceText && (
                      <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-2 italic line-clamp-2">
                        "{p.evidenceText}"
                      </div>
                    )}
                    {p.sourceUrl && (
                      <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline flex items-center gap-1">
                        <ExternalLink className="w-3 h-3" />
                        View source
                      </a>
                    )}
                    <div className="text-xs text-muted-foreground">
                      Found: {p.timestampFound ? format(new Date(p.timestampFound), "MMM d, yyyy HH:mm") : "—"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        <DrawerFooter className="border-t border-border/40 pt-4 flex-row gap-2">
          <Button onClick={handleBookmark} disabled={bookmarkMutation.isPending} variant="outline" className="flex-1">
            <Star className="w-4 h-4 mr-2" />
            Bookmark
          </Button>
          {provider?.website && (
            <Button asChild className="flex-1">
              <a href={provider.website} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-4 h-4 mr-2" />
                Visit Provider
              </a>
            </Button>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

// ─── Result Card ────────────────────────────────────────────────────────────
function ResultCard({
  result,
  onSelect,
  isComparing,
  onToggleCompare,
}: {
  result: PriceResult;
  onSelect: () => void;
  isComparing: boolean;
  onToggleCompare: () => void;
}) {
  const verif = VERIFICATION_CONFIG[result.verificationStatus] ?? VERIFICATION_CONFIG["verified_exact_posted_price"];
  const VerifIcon = verif.icon;

  return (
    <div
      className={`glass-panel p-4 border transition-all duration-200 cursor-pointer group relative overflow-hidden ${
        isComparing
          ? "border-primary/40 ring-1 ring-primary/20"
          : "border-border/40 hover:border-primary/20 hover:shadow-lg"
      }`}
      onClick={onSelect}
    >
      <div className="absolute top-0 right-0 w-20 h-20 bg-primary/3 rounded-full blur-2xl group-hover:bg-primary/8 transition-colors pointer-events-none" />

      <div className="relative z-10 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-bold text-sm leading-tight truncate group-hover:text-primary transition-colors">
              {result.providerName}
            </h3>
            <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
              <MapPin className="w-3 h-3 shrink-0" />
              <span className="truncate">
                {[result.city, result.stateRegion, result.country].filter(Boolean).join(", ")}
              </span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-lg font-bold text-primary">
              {formatCurrency(result.exactPrice, result.currency)}
            </div>
            <PriceTypeBadge priceType={result.priceType} />
          </div>
        </div>

        {/* Service */}
        <div className="text-sm font-medium text-foreground/80">
          {result.normalizedService || result.serviceQuery}
          {result.billingCode && (
            <span className="ml-2 text-xs font-mono text-muted-foreground">· {result.billingCode}</span>
          )}
        </div>

        {/* Badges row */}
        <div className="flex flex-wrap items-center gap-1.5">
          <SourceBadge sourceType={result.sourceType} />
          <span className={`inline-flex items-center gap-1 text-xs font-medium ${verif.color}`}>
            <VerifIcon className="w-3 h-3" />
            {verif.label}
          </span>
        </div>

        {/* Confidence + actions */}
        <div className="space-y-2">
          <ConfidenceBar score={result.confidenceScore ?? 0.9} />
          <div className="flex items-center justify-between">
            <button
              type="button"
              className={`text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors ${
                isComparing
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "text-muted-foreground border-border/40 hover:border-primary/30 hover:text-primary"
              }`}
              onClick={(e) => { e.stopPropagation(); onToggleCompare(); }}
            >
              <SplitSquareHorizontal className="w-3 h-3 inline mr-1" />
              {isComparing ? "Remove" : "Compare"}
            </button>
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-primary hover:underline"
              onClick={onSelect}
            >
              Intelligence <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Comparison Panel ───────────────────────────────────────────────────────
function ComparePanel({ ids, results, onClose }: { ids: Set<string>; results: PriceResult[]; onClose: () => void }) {
  const compared = results.filter((r) => ids.has(String(r.id)));
  if (compared.length < 2) return null;

  return (
    <div className="glass-panel border border-primary/20 p-4 rounded-2xl space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <SplitSquareHorizontal className="w-4 h-4 text-primary" />
          Comparing {compared.length} providers
        </h3>
        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg" onClick={onClose}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${compared.length}, 1fr)` }}>
        {compared.map((r) => (
          <div key={r.id} className="space-y-2 text-xs">
            <div className="font-bold text-sm truncate">{r.providerName}</div>
            <div className="text-xl font-bold text-primary">{formatCurrency(r.exactPrice, r.currency)}</div>
            <PriceTypeBadge priceType={r.priceType} />
            <SourceBadge sourceType={r.sourceType} />
            <ConfidenceBar score={r.confidenceScore ?? 0.9} />
            <div className="text-muted-foreground">{[r.city, r.country].filter(Boolean).join(", ")}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── No-Price Provider Row ───────────────────────────────────────────────────
function NoPriceRow({ provider }: { provider: { providerName: string; city?: string; country?: string; website?: string } }) {
  return (
    <div className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-muted/20 border border-border/20 text-sm">
      <div className="min-w-0">
        <div className="font-medium truncate">{provider.providerName}</div>
        <div className="text-xs text-muted-foreground">{[provider.city, provider.country].filter(Boolean).join(", ")}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-muted-foreground italic">No posted price</span>
        {provider.website && (
          <a href={provider.website} target="_blank" rel="noopener noreferrer" className="text-primary">
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Main ResultsPanel ───────────────────────────────────────────────────────
export function ResultsPanel({ response, isLoading }: { response: SearchResponse | undefined; isLoading: boolean }) {
  const exportMutation = useExportCsv();
  const { toast } = useToast();
  const [selectedProviderId, setSelectedProviderId] = useState<number | null>(null);
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());

  const handleExport = () => {
    if (!response?.searchId) return;
    exportMutation.mutate(
      { data: { searchId: response.searchId, format: "csv" } },
      {
        onSuccess: () => toast({ title: "Export ready", description: "CSV is being generated." }),
        onError: () => toast({ title: "Export failed", variant: "destructive" }),
      }
    );
  };

  const toggleCompare = (id: string) => {
    const next = new Set(compareIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      if (next.size >= 3) {
        toast({ title: "Comparison limit", description: "Max 3 providers." });
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
          <div className="h-6 w-48 bg-muted rounded-lg animate-pulse" />
        </div>
        <div className="flex-1 p-4 space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="glass-panel h-36 animate-pulse bg-muted/20" />
          ))}
        </div>
      </div>
    );
  }

  if (!response) return null;

  const results = response.results ?? [];
  const noPrice = response.nopriceProviders ?? [];

  return (
    <>
      <div className="glass-panel h-full w-full flex flex-col overflow-hidden border border-border/40 shadow-xl">
        {/* Header */}
        <div className="p-4 border-b border-border/40 shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold text-base">
                {results.length} Price Intelligence Results
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Query: <span className="font-mono text-primary">{response.queryNormalized}</span>
                {" · "}Page {response.page}/{Math.ceil(response.total / response.pageSize)} of {response.total.toLocaleString()}
              </p>
            </div>
            <Button variant="outline" size="sm" className="gap-2 rounded-xl" onClick={handleExport} disabled={exportMutation.isPending}>
              <Download className="w-4 h-4" />
              CSV
            </Button>
          </div>

          {compareIds.size >= 2 && (
            <ComparePanel
              ids={compareIds}
              results={results}
              onClose={() => setCompareIds(new Set())}
            />
          )}
        </div>

        {/* Results */}
        <ScrollArea className="flex-1">
          <Tabs defaultValue="prices" className="h-full">
            <TabsList className="mx-4 mt-3 mb-0 w-auto bg-muted/40 rounded-xl">
              <TabsTrigger value="prices" className="rounded-lg text-xs">
                Prices ({results.length})
              </TabsTrigger>
              {noPrice.length > 0 && (
                <TabsTrigger value="noprice" className="rounded-lg text-xs">
                  No Price ({noPrice.length})
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="prices" className="mt-0 p-4 space-y-3">
              {results.length === 0 ? (
                <div className="glass-panel p-10 text-center border border-border/40">
                  <FileSearch className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <h3 className="font-semibold mb-1">No prices found</h3>
                  <p className="text-sm text-muted-foreground">Try broadening your search or adjusting filters.</p>
                </div>
              ) : (
                results.map((r) => (
                  <ResultCard
                    key={String(r.id)}
                    result={r}
                    onSelect={() => { const pid = Number(r.providerId); if (pid && pid > 0) setSelectedProviderId(pid); }}
                    isComparing={compareIds.has(String(r.id))}
                    onToggleCompare={() => toggleCompare(String(r.id))}
                  />
                ))
              )}
            </TabsContent>

            {noPrice.length > 0 && (
              <TabsContent value="noprice" className="mt-0 p-4 space-y-2">
                <p className="text-xs text-muted-foreground mb-3">
                  These providers were found but did not have a publicly posted price for this service.
                </p>
                {noPrice.map((p: { providerName: string; city?: string; country?: string; website?: string }, i: number) => (
                  <NoPriceRow key={i} provider={p} />
                ))}
              </TabsContent>
            )}
          </Tabs>
        </ScrollArea>
      </div>

      <ProviderDrawer
        providerId={selectedProviderId}
        open={!!selectedProviderId}
        onClose={() => setSelectedProviderId(null)}
      />
    </>
  );
}

