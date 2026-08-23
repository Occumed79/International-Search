import { Link, useLocation } from "wouter";
import { Search, Bookmark, History, Shield, Globe, ArrowLeft, ChevronRight, Sparkles } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

// Hub URL — injected at build time via VITE_HUB_URL, falls back to Render URL
const HUB_URL = (import.meta.env.VITE_HUB_URL as string | undefined) ?? "https://price-search-tool.onrender.com";

// All portals in the network
const PORTALS = [
  { id: 1, name: "Network Search",   subtitle: "US Self-Pay Search",     href: `${HUB_URL}/search`,       active: false },
  { id: 2, name: "Network Map",      subtitle: "Geographic Coverage",    href: `${HUB_URL}/network-map`,  active: false },
  { id: 3, name: "Provider Directory",subtitle: "Provider Registry",     href: "#",                        active: false },
  { id: 4, name: "Report Generator", subtitle: "Analytics & Reports",    href: `${HUB_URL}/report`,       active: false },
  { id: 5, name: "Global Intelligence",subtitle: "International Search", href: "/",                        active: true  },
  { id: 6, name: "Pricing Transparency",subtitle: "Transparency DB",     href: "#",                        active: false },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/",          label: "Intelligence", icon: Search  },
    { href: "/bookmarks", label: "Bookmarks",    icon: Bookmark },
    { href: "/history",   label: "History",      icon: History  },
    { href: "/admin",     label: "Diagnostics",  icon: Shield   },
  ];

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden">
      <header className="flex-none h-16 z-50 glass-panel border-x-0 border-t-0 rounded-none bg-background/60 sticky top-0 px-6 flex items-center justify-between">

        {/* Left: back-to-hub + logo + portal switcher */}
        <div className="flex items-center gap-2">

          {/* Back to hub */}
          <a
            href={HUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 h-8 px-3 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-white/40 dark:hover:bg-white/5 transition-all"
            title="Back to Occu-Med Hub"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Hub</span>
          </a>

          <div className="w-px h-5 bg-border/40" />

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <span className="font-bold text-sm tracking-tight leading-none block">Global Intelligence</span>
              <span className="text-[10px] text-muted-foreground font-medium leading-none tracking-wider uppercase">Portal 5</span>
            </div>
          </Link>

          {/* Portal switcher */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="ml-1 h-8 px-2.5 rounded-xl text-xs text-muted-foreground gap-1 hover:text-foreground">
                <Sparkles className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Portals</span>
                <ChevronRight className="w-3 h-3 rotate-90" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64 glass-panel border-border/40 shadow-2xl">
              <DropdownMenuLabel className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                Occu-Med Network
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {PORTALS.map((p) => (
                <DropdownMenuItem key={p.id} asChild className={p.active ? "bg-primary/5 text-primary focus:bg-primary/10" : ""}>
                  <a
                    href={p.href}
                    target={p.active ? undefined : "_blank"}
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 cursor-pointer"
                  >
                    <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                      p.active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    }`}>
                      {p.id}
                    </span>
                    <div className="min-w-0">
                      <div className={`text-sm font-semibold ${p.active ? "text-primary" : ""}`}>{p.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{p.subtitle}</div>
                    </div>
                    {p.active && <span className="ml-auto text-xs text-primary font-semibold">Active</span>}
                  </a>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Right: nav */}
        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const isActive = location === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? "bg-white/60 dark:bg-black/40 text-primary shadow-sm ring-1 ring-black/5 dark:ring-white/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/40 dark:hover:bg-white/5"
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? "text-primary" : "opacity-70"}`} />
                <span className="hidden md:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="flex-1 overflow-hidden relative">
        {children}
      </main>
    </div>
  );
}
