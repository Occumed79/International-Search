import { Link, useLocation } from "wouter";
import { Search, Bookmark, History, Shield, Globe } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Intelligence", icon: Search },
    { href: "/bookmarks", label: "Bookmarks", icon: Bookmark },
    { href: "/history", label: "History", icon: History },
    { href: "/admin", label: "Diagnostics", icon: Shield },
  ];

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden">
      <header className="flex-none h-16 z-50 glass-panel border-x-0 border-t-0 rounded-none bg-background/60 sticky top-0 px-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
            <Globe className="w-5 h-5" />
          </div>
          <span className="font-semibold text-lg tracking-tight">Global Self-Pay</span>
        </Link>

        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const isActive = location === item.href;
            const Icon = item.icon;
            
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                  isActive 
                    ? "bg-white/60 dark:bg-black/40 text-primary shadow-sm ring-1 ring-black/5 dark:ring-white/10" 
                    : "text-muted-foreground hover:text-foreground hover:bg-white/40 dark:hover:bg-white/5"
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? "text-primary" : "opacity-70"}`} />
                {item.label}
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
