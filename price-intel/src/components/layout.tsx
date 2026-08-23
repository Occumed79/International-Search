import { Link, useLocation } from "wouter";
import {
  ArrowLeft,
  BarChart3,
  Bookmark,
  Building2,
  Globe,
  History,
  Map,
  Search,
  Stethoscope,
  TableProperties,
  TrendingUp,
  WalletCards,
} from "lucide-react";

const HUB_URL = (import.meta.env.VITE_HUB_URL as string | undefined) ?? "https://price-search-tool.onrender.com";

const workspaceTabs = [
  { view: "map", label: "Map", icon: Map },
  { view: "directory", label: "Directory", icon: Stethoscope },
  { view: "coverage", label: "Coverage", icon: TableProperties },
  { view: "organizations", label: "Organizations", icon: Building2 },
  { view: "pricing", label: "Pricing", icon: WalletCards },
  { view: "availability", label: "Service Availability", icon: TableProperties },
  { view: "insights", label: "Insights", icon: TrendingUp },
  { view: "gaps", label: "Coverage Gaps", icon: BarChart3 },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const currentView = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("view") || "map"
    : "map";

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden">
      <header className="flex-none h-16 z-50 glass-panel border-x-0 border-t-0 rounded-none sticky top-0 px-4 flex items-center gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={HUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 h-8 px-2.5 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-white/10 transition-all"
            title="Back to Occu-Med Hub"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">Hub</span>
          </a>
          <div className="w-px h-5 bg-border/40" />
          <Link href="/" className="flex items-center gap-2 group pr-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
              <Globe className="w-5 h-5" />
            </div>
            <span className="font-bold text-sm tracking-tight whitespace-nowrap">Global Intelligence</span>
          </Link>
        </div>

        <nav className="flex-1 min-w-0 flex items-center justify-end gap-0.5 overflow-x-auto no-scrollbar py-1">
          <Link
            href="/"
            className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${
              location === "/" ? "bg-white/12 text-foreground ring-1 ring-white/15" : "text-muted-foreground hover:text-foreground hover:bg-white/8"
            }`}
          >
            <Search className="w-3.5 h-3.5" /> Search
          </Link>

          {workspaceTabs.map(({ view, label, icon: Icon }) => {
            const active = location === "/command-center" && currentView === view;
            return (
              <a
                key={view}
                href={`/command-center?view=${view}`}
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${
                  active ? "bg-white/14 text-foreground ring-1 ring-white/18" : "text-muted-foreground hover:text-foreground hover:bg-white/8"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </a>
            );
          })}

          <Link
            href="/bookmarks"
            className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${
              location === "/bookmarks" ? "bg-white/12 text-foreground ring-1 ring-white/15" : "text-muted-foreground hover:text-foreground hover:bg-white/8"
            }`}
          >
            <Bookmark className="w-3.5 h-3.5" /> Bookmarks
          </Link>
          <Link
            href="/history"
            className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${
              location === "/history" ? "bg-white/12 text-foreground ring-1 ring-white/15" : "text-muted-foreground hover:text-foreground hover:bg-white/8"
            }`}
          >
            <History className="w-3.5 h-3.5" /> History
          </Link>
        </nav>
      </header>

      <main className="flex-1 overflow-hidden relative">{children}</main>
    </div>
  );
}
