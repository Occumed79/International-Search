import { useState, useEffect, useRef } from "react";
import { Search, MapPin, SlidersHorizontal, Globe, Activity, X, Building2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useGetSearchSuggestions } from "@workspace/api-client-react";
import type { SearchRequest } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";

/** Non-US countries only */
const COUNTRIES = [
  { code: "MX", label: "Mexico" },
  { code: "CA", label: "Canada" },
  { code: "GB", label: "United Kingdom" },
  { code: "AU", label: "Australia" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "ES", label: "Spain" },
  { code: "IT", label: "Italy" },
  { code: "PT", label: "Portugal" },
  { code: "BR", label: "Brazil" },
  { code: "AR", label: "Argentina" },
  { code: "CL", label: "Chile" },
  { code: "CO", label: "Colombia" },
  { code: "IN", label: "India" },
  { code: "SG", label: "Singapore" },
  { code: "TH", label: "Thailand" },
  { code: "JP", label: "Japan" },
  { code: "KR", label: "South Korea" },
  { code: "AE", label: "UAE" },
  { code: "ZA", label: "South Africa" },
  { code: "TR", label: "Turkey" },
  { code: "PL", label: "Poland" },
  { code: "NL", label: "Netherlands" },
  { code: "IE", label: "Ireland" },
  { code: "NZ", label: "New Zealand" },
  { code: "PH", label: "Philippines" },
  { code: "MY", label: "Malaysia" },
];

const PROVIDER_TYPES = [
  { code: "occupational_health", label: "Occupational Health" },
  { code: "clinic", label: "Clinic" },
  { code: "hospital", label: "Hospital" },
  { code: "urgent_care", label: "Urgent Care" },
  { code: "imaging_center", label: "Imaging Center" },
  { code: "lab", label: "Laboratory" },
  { code: "dental", label: "Dental" },
  { code: "pharmacy", label: "Pharmacy" },
];

export function SearchBar({
  onSearch,
  isCompact,
  isLoading,
  currentQuery,
}: {
  onSearch: (q: SearchRequest) => void;
  isCompact: boolean;
  isLoading?: boolean;
  currentQuery?: SearchRequest | null;
}) {
  const [providerType, setProviderType] = useState(
    (currentQuery as any)?.providerType || "occupational_health",
  );
  const [location, setLocation] = useState(currentQuery?.city || "");
  const [country, setCountry] = useState(currentQuery?.country || "MX");
  const [radius, setRadius] = useState(currentQuery?.radiusMiles ?? 25);
  const [showFilters, setShowFilters] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [query, setQuery] = useState(currentQuery?.query || "");

  const typeLabel =
    PROVIDER_TYPES.find((t) => t.code === providerType)?.label || "Clinic";

  const { data: suggestions } = useGetSearchSuggestions(
    { q: query || typeLabel },
    {
      query: {
        enabled: (query || typeLabel).length > 1,
        queryKey: ["/api/search/suggestions", { q: query || typeLabel }],
      },
    },
  );

  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (currentQuery) {
      setQuery(currentQuery.query || "");
      setLocation(currentQuery.city || "");
      if (currentQuery.country && currentQuery.country !== "US") {
        setCountry(currentQuery.country);
      }
      setRadius(currentQuery.radiusMiles ?? 25);
      if ((currentQuery as any).providerType) {
        setProviderType((currentQuery as any).providerType);
      }
    }
  }, [currentQuery]);

  const buildRequest = (): SearchRequest => ({
    query: (query.trim() || typeLabel).trim(),
    city: location.trim() || undefined,
    country: country || undefined,
    radiusMiles: radius,
    providerType,
  } as SearchRequest);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!country) return;
    setShowSuggestions(false);
    onSearch(buildRequest());
  };

  const handleSelectSuggestion = (suggestionText: string) => {
    const match = PROVIDER_TYPES.find(
      (t) => t.label.toLowerCase() === suggestionText.toLowerCase(),
    );
    if (match) setProviderType(match.code);
    setQuery(suggestionText);
    setShowSuggestions(false);
    onSearch({
      ...buildRequest(),
      query: suggestionText,
      providerType: match?.code || providerType,
    } as SearchRequest);
  };

  return (
    <div className="w-full relative" ref={wrapperRef}>
      <form
        onSubmit={handleSubmit}
        className={`flex flex-col sm:flex-row items-stretch transition-all duration-300 ${
          isCompact ? "p-1.5 gap-1.5 rounded-2xl" : "p-2.5 gap-2.5 rounded-3xl"
        }`}
        style={{
          background: isCompact ? "rgba(18, 6, 36, 0.82)" : "rgba(22, 8, 42, 0.75)",
          backdropFilter: "blur(28px) saturate(160%)",
          WebkitBackdropFilter: "blur(28px) saturate(160%)",
          border: "1px solid rgba(160, 80, 255, 0.22)",
          boxShadow: "0 8px 40px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06)",
        }}
      >
        {/* Provider type */}
        <div className="flex items-center gap-1 px-2 min-w-[160px]">
          <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
          <Select value={providerType} onValueChange={setProviderType}>
            <SelectTrigger
              className={`border-0 ring-0 focus:ring-0 shadow-none bg-transparent font-medium text-primary ${
                isCompact ? "h-10 text-sm" : "h-14 text-base"
              }`}
            >
              <SelectValue placeholder="Provider type" />
            </SelectTrigger>
            <SelectContent className="glass-panel border-border/40 shadow-2xl max-h-72">
              {PROVIDER_TYPES.map((t) => (
                <SelectItem key={t.code} value={t.code}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="hidden sm:block w-px bg-border/40 my-2" />

        {/* Country — no US */}
        <div className="flex items-center gap-1 px-2">
          <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
          <Select value={country} onValueChange={setCountry}>
            <SelectTrigger
              className={`border-0 ring-0 focus:ring-0 shadow-none bg-transparent font-medium ${
                isCompact ? "h-10 text-sm w-36" : "h-14 text-base w-40"
              } text-primary`}
            >
              <SelectValue placeholder="Country" />
            </SelectTrigger>
            <SelectContent className="glass-panel border-border/40 shadow-2xl max-h-72">
              {COUNTRIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="hidden sm:block w-px bg-border/40 my-2" />

        {/* City */}
        <div className="relative flex-1 flex items-center group">
          <MapPin
            className={`absolute left-4 w-5 h-5 transition-colors ${
              location ? "text-primary" : "text-muted-foreground group-focus-within:text-foreground"
            }`}
          />
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="City or region (e.g. Guadalajara)"
            className={`pl-12 bg-transparent border-0 ring-0 focus-visible:ring-0 shadow-none text-base h-auto placeholder:text-muted-foreground/70 ${
              isCompact ? "py-2.5" : "py-4 text-lg"
            }`}
          />
        </div>

        <div className="hidden sm:block w-px bg-border/40 my-2" />

        {/* Optional free-text refine */}
        <div className="relative flex-1 flex items-center group max-w-xs">
          <Search
            className={`absolute left-4 w-5 h-5 transition-colors ${
              query ? "text-primary" : "text-muted-foreground group-focus-within:text-foreground"
            }`}
          />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            placeholder="Optional keywords"
            className={`pl-12 bg-transparent border-0 ring-0 focus-visible:ring-0 shadow-none text-base h-auto placeholder:text-muted-foreground/70 ${
              isCompact ? "py-2.5" : "py-4 text-lg"
            }`}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-3 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:pl-1.5">
          <Popover open={showFilters} onOpenChange={setShowFilters}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={`relative hover:bg-black/5 dark:hover:bg-white/10 ${
                  isCompact ? "w-10 h-10 rounded-xl" : "w-12 h-12 rounded-xl"
                } text-muted-foreground`}
              >
                <SlidersHorizontal className="w-5 h-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-80 p-5 shadow-2xl rounded-2xl"
              style={{
                background: "rgba(18,6,36,0.96)",
                backdropFilter: "blur(28px)",
                border: "1px solid rgba(160,80,255,0.22)",
              }}
              align="end"
              sideOffset={12}
            >
              <div className="space-y-5">
                <h4 className="font-semibold leading-none tracking-tight">Search radius</h4>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <Label className="text-xs text-muted-foreground">Around city</Label>
                    <span className="text-xs font-medium text-primary">{radius} mi</span>
                  </div>
                  <Slider
                    min={5}
                    max={100}
                    step={5}
                    value={[radius]}
                    onValueChange={([v]) => setRadius(v)}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Sources: OpenStreetMap, Wikidata, and optional SearXNG web search. United States is
                  excluded.
                </p>
                <Button type="button" className="w-full" onClick={() => setShowFilters(false)}>
                  Done
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          <Button
            type="submit"
            disabled={isLoading || !country}
            className={`font-semibold ${
              isCompact ? "rounded-xl px-5 h-10 text-sm" : "rounded-2xl px-8 h-14 text-base"
            }`}
          >
            {isLoading ? (
              <Activity className="w-4 h-4 animate-pulse" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            <span className={isCompact ? "hidden sm:inline ml-2" : "ml-2"}>Find providers</span>
          </Button>
        </div>
      </form>

      {showSuggestions && suggestions && suggestions.length > 0 && (
        <div
          className="absolute top-full left-0 right-0 mt-2 z-50 rounded-2xl overflow-hidden"
          style={{
            background: "rgba(18,6,36,0.95)",
            backdropFilter: "blur(24px)",
            border: "1px solid rgba(160,80,255,0.22)",
            boxShadow: "0 16px 48px rgba(0,0,0,0.65)",
          }}
        >
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-primary/5 transition-colors border-b border-border/20 last:border-0"
              onClick={() => handleSelectSuggestion(s.text)}
            >
              <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="text-sm font-medium">{s.text}</div>
              <Badge variant="secondary" className="ml-auto text-xs">
                {s.category}
              </Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
