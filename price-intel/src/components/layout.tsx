import { Link, useLocation } from "wouter";
import { Search, Bookmark, History, Shield, Globe, ArrowLeft, LayoutDashboard } from "lucide-react";

const HUB_URL = (import.meta.env.VITE_HUB_URL as string | undefined) ?? "https://price-search-tool.onrender.com";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/",               label: "Search",         icon: Search },
    { href: "/command-center", label: "Command Center", icon: LayoutDashboard },
    { href: "/bookmarks",      label: "Bookmarks",      icon: Bookmark },
    { href: "/history",        label: "History",        icon: History },
    { href: "/admin",          label: "Diagnostics",    icon: Shield },
  ];

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden">
      <header className="flex-none h-16 z-50 glass-panel border-x-0 border-t-0 rounded-none bg-background/60 sticky top-0 px-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
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

          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <span className="font-bold text-sm tracking-tight leading-none block">Global Intelligence</span>
              <span className="text-[10px] text-muted-foreground font-medium leading-none tracking-wider uppercase">Portal 5</span>
            </div>
          </Link>
        </div>

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

      <main className="flex-1 overflow-hidden relative">{children}</main>
    </div>
  );
}
