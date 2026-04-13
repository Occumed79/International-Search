import { useGetAdminDiagnostics, useGetSourceBreakdown } from "@workspace/api-client-react";
import { Shield, Server, Activity, Database, CheckCircle2, XCircle, AlertTriangle, RefreshCcw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export function Admin() {
  const { data: diag, isLoading: isLoadingDiag } = useGetAdminDiagnostics({ query: { queryKey: ["/api/admin/diagnostics"] } });
  const { data: sources, isLoading: isLoadingSources } = useGetSourceBreakdown({ query: { queryKey: ["/api/stats/sources"] } });

  return (
    <div className="p-8 h-full overflow-auto bg-muted/5">
      <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
        
        <div className="flex items-end justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-500/10 text-slate-600 dark:text-slate-400 text-xs font-semibold mb-2 ring-1 ring-slate-500/20">
              <Shield className="w-3.5 h-3.5" />
              <span>System Operations</span>
            </div>
            <h1 className="text-4xl font-bold tracking-tight">Admin Diagnostics</h1>
            <p className="text-muted-foreground text-lg">Platform health, intelligence gathering metrics, and connector status.</p>
          </div>
          
          {diag?.lastCrawlAt && (
            <div className="text-sm text-muted-foreground flex items-center gap-2 bg-background px-4 py-2 rounded-xl border shadow-sm">
              <RefreshCcw className="w-4 h-4" />
              Last sync: {formatDistanceToNow(new Date(diag.lastCrawlAt), { addSuffix: true })}
            </div>
          )}
        </div>
        
        {(isLoadingDiag || isLoadingSources) ? (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[1,2,3,4].map(i => <div key={i} className="glass-panel h-32 animate-pulse bg-muted/20"></div>)}
            </div>
            <div className="glass-panel h-64 animate-pulse bg-muted/20"></div>
          </div>
        ) : diag && sources ? (
          <div className="space-y-8">
            
            {/* Top Level Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard 
                title="Crawl Success Rate" 
                value={`${((diag.successfulCrawls / diag.totalCrawls) * 100).toFixed(1)}%`} 
                subValue={`${diag.totalCrawls.toLocaleString()} total runs`}
                icon={Activity}
                trend="good"
              />
              <MetricCard 
                title="Extraction Hit Rate" 
                value={`${diag.extractionSuccessRate}%`} 
                subValue="Pricing data found in source"
                icon={Database}
                trend={diag.extractionSuccessRate > 80 ? "good" : "warning"}
              />
              <MetricCard 
                title="Rejected Results" 
                value={diag.rejectedResults.toLocaleString()} 
                subValue="Failed verification"
                icon={XCircle}
                trend={diag.rejectedResults > 1000 ? "bad" : "neutral"}
              />
              <MetricCard 
                title="Stale Data / Broken" 
                value={(diag.staleResults + diag.brokenSources).toLocaleString()} 
                subValue="Requires manual intervention"
                icon={AlertTriangle}
                trend="warning"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              
              {/* Connector Status */}
              <div className="lg:col-span-2 space-y-4">
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <Server className="w-5 h-5 text-muted-foreground" />
                  Data Connectors
                </h3>
                <div className="glass-panel border border-border/40 shadow-md overflow-hidden">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider font-semibold border-b border-border/40">
                      <tr>
                        <th className="px-6 py-4">Connector Name</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4">Last Run</th>
                        <th className="px-6 py-4 text-right">Ingested</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {diag.connectorStatus.map((conn) => (
                        <tr key={conn.name} className="hover:bg-white/40 dark:hover:bg-white/5">
                          <td className="px-6 py-4 font-medium">{conn.name}</td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                              conn.status === 'healthy' ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' :
                              conn.status === 'degraded' ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20' :
                              'bg-red-500/10 text-red-600 border border-red-500/20'
                            }`}>
                              {conn.status === 'healthy' ? <CheckCircle2 className="w-3 h-3" /> : 
                               conn.status === 'degraded' ? <AlertTriangle className="w-3 h-3" /> : 
                               <XCircle className="w-3 h-3" />}
                              {conn.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-muted-foreground">
                            {conn.lastRun ? formatDistanceToNow(new Date(conn.lastRun), { addSuffix: true }) : 'Never'}
                          </td>
                          <td className="px-6 py-4 text-right font-mono font-medium">
                            {conn.recordsIngested.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Source Breakdown */}
              <div className="space-y-4">
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <Database className="w-5 h-5 text-muted-foreground" />
                  Source Distribution
                </h3>
                <div className="glass-panel p-6 border border-border/40 shadow-md space-y-6">
                  {sources.map((source) => (
                    <div key={source.sourceType} className="space-y-2">
                      <div className="flex justify-between items-end text-sm">
                        <span className="font-semibold">{source.sourceType}</span>
                        <span className="text-muted-foreground font-mono">{source.percentage}%</span>
                      </div>
                      <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary rounded-full" 
                          style={{ width: `${source.percentage}%` }}
                        />
                      </div>
                      <div className="text-xs text-muted-foreground text-right">
                        {source.count.toLocaleString()} records
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MetricCard({ title, value, subValue, icon: Icon, trend }: { title: string, value: string, subValue: string, icon: any, trend: 'good' | 'bad' | 'warning' | 'neutral' }) {
  const trendColors = {
    good: 'text-emerald-500',
    bad: 'text-red-500',
    warning: 'text-amber-500',
    neutral: 'text-muted-foreground'
  };

  return (
    <div className="glass-panel p-6 border border-border/40 shadow-md flex flex-col gap-4">
      <div className="flex justify-between items-start">
        <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h4>
        <Icon className={`w-5 h-5 ${trendColors[trend]}`} />
      </div>
      <div>
        <div className="text-3xl font-black tracking-tight text-foreground">{value}</div>
        <div className="text-sm text-muted-foreground mt-1">{subValue}</div>
      </div>
    </div>
  );
}
