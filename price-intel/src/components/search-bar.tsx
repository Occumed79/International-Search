import { useState, useEffect, useRef } from "react";
import { Search, MapPin, SlidersHorizontal, Globe, ChevronDown, Activity, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useGetSearchSuggestions } from "@workspace/api-client-react";
import type { SearchRequest } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";

const COUNTRIES = [
  { code: "", label: "Global" },
  { code: "US", label: "United States" },
  { code: "GB", label: "United Kingdom" },
  { code: "CA", label: "Canada" },
  { code: "AU", label: "Australia" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "IN", label: "India" },
  { code: "MX", label: "Mexico" },
  { code: "SG", label: "Singapore" },
  { code: "TH", label: "Thailand" },
  { code: "TR", label: "Turkey" },
  { code: "ES", label: "Spain" },
  { code: "IT", label: "Italy" },
  { code: "JP", label: "Japan" },
  { code: "BR", label: "Brazil" },
  { code: "ZA", label: "South Africa" },
  { code: "AE", label: "UAE" },
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
  const [query, setQuery] = useState(currentQuery?.query || "");
  const [location, setLocation] = useState(currentQuery?.city || "");
  const [country, setCountry] = useState(currentQuery?.country || "");
  const [radius, setRadius] = useState(currentQuery?.radiusMiles ?? 50);
  const [showFilters, setShowFilters] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const [filters, setFilters] = useState({
    cashPayOnly: currentQuery?.cashPayOnly || false,
    hospitalOnly: currentQuery?.hospitalOnly || false,
    clinicOnly: currentQuery?.clinicOnly || false,
    imagingOnly: currentQuery?.imagingOnly || false,
    labOnly: currentQuery?.labOnly || false,
    urgentCareOnly: currentQuery?.urgentCareOnly || false,
    dentalOnly: currentQuery?.dentalOnly || false,
    telehealthOnly: currentQuery?.telehealthOnly || false,
  });

  const { data: suggestions } = useGetSearchSuggestions(
    { q: query },
    { query: { enabled: query.length > 2, queryKey: ["/api/search/suggestions", { q: query }] } }
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
      setQuery(currentQuery.query);
      setLocation(currentQuery.city || "");
      setCountry(currentQuery.country || "");
      setRadius(currentQuery.radiusMiles ?? 50);
      setFilters({
        cashPayOnly: currentQuery.cashPayOnly || false,
        hospitalOnly: currentQuery.hospitalOnly || false,
        clinicOnly: currentQuery.clinicOnly || false,
        imagingOnly: currentQuery.imagingOnly || false,
        labOnly: currentQuery.labOnly || false,
        urgentCareOnly: currentQuery.urgentCareOnly || false,
        dentalOnly: currentQuery.dentalOnly || false,
        telehealthOnly: currentQuery.telehealthOnly || false,
      });
    }
  }, [currentQuery]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setShowSuggestions(false);
    onSearch({
      query: query.trim(),
      city: location.trim() || undefined,
      country: country || undefined,
      radiusMiles: radius,
      ...filters,
    });
  };

  const handleSelectSuggestion = (suggestionText: string) => {
    setQuery(suggestionText);
    setShowSuggestions(false);
    onSearch({
      query: suggestionText,
      city: location.trim() || undefined,
      country: country || undefined,
      radiusMiles: radius,
      ...filters,
    });
  };

  const activeFiltersCount = Object.values(filters).filter(Boolean).length + (country ? 1 : 0);

  const resetFilters = () => {
    setFilters({
      cashPayOnly: false, hospitalOnly: false, clinicOnly: false,
      imagingOnly: false, labOnly: false, urgentCareOnly: false,
      dentalOnly: false, telehealthOnly: false,
    });
    setCountry("");
    setRadius(50);
  };

  return (
    <div className="w-full relative" ref={wrapperRef}>
      <form
        onSubmit={handleSubmit}
        className={`glass-panel flex flex-col sm:flex-row items-stretch shadow-2xl shadow-black/5 transition-all duration-300 ring-1 ring-white/20 dark:ring-white/10 ${
          isCompact
            ? "p-1.5 gap-1.5 rounded-2xl bg-white/40 dark:bg-black/40"
            : "p-2.5 gap-2.5 rounded-3xl bg-white/60 dark:bg-black/60"
        }`}
      >
        {/* Service query input */}
        <div className="relative flex-[1.5] flex items-center group">
          <Search
            className={`absolute left-4 w-5 h-5 transition-colors ${
              query ? "text-primary" : "text-muted-foreground group-focus-within:text-foreground"
            }`}
          />
          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            placeholder="Service, CPT code, or specialty (e.g. MRI Brain, 70553)"
            className={`pl-12 bg-transparent border-0 ring-0 focus-visible:ring-0 shadow-none text-base h-auto placeholder:text-muted-foreground/70 ${
              isCompact ? "py-2.5" : "py-4 text-lg"
            }`}
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="absolute right-3 text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="hidden sm:block w-px bg-border/40 my-2" />

        {/* Country selector */}
        <div className="flex items-center gap-1 px-2">
          <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
          <Select value={country} onValueChange={setCountry}>
            <SelectTrigger
              className={`border-0 ring-0 focus:ring-0 shadow-none bg-transparent font-medium ${
                isCompact ? "h-10 text-sm w-36" : "h-14 text-base w-40"
              } ${country ? "text-primary" : "text-muted-foreground"}`}
            >
              <SelectValue placeholder="Global" />
            </SelectTrigger>
            <SelectContent className="glass-panel border-border/40 shadow-2xl max-h-72">
              {COUNTRIES.map((c) => (
                <SelectItem key={c.code} value={c.code || "_global"}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="hidden sm:block w-px bg-border/40 my-2" />

        {/* City/region input */}
        <div className="relative flex-1 flex items-center group">
          <MapPin
            className={`absolute left-4 w-5 h-5 transition-colors ${
              location ? "text-primary" : "text-muted-foreground group-focus-within:text-foreground"
            }`}
          />
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="City or region"
            className={`pl-12 bg-transparent border-0 ring-0 focus-visible:ring-0 shadow-none text-base h-auto placeholder:text-muted-foreground/70 ${
              isCompact ? "py-2.5" : "py-4 text-lg"
            }`}
          />
        </div>

        <div className="hidden sm:block w-px bg-border/40 my-2" />

        {/* Filters + Search */}
        <div className="flex items-center gap-1.5 sm:pl-1.5">
          <Popover open={showFilters} onOpenChange={setShowFilters}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={`relative hover:bg-black/5 dark:hover:bg-white/10 ${
                  isCompact ? "w-10 h-10 rounded-xl" : "w-12 h-12 rounded-xl"
                } ${activeFiltersCount > 0 ? "text-primary" : "text-muted-foreground"}`}
              >
                <SlidersHorizontal className="w-5 h-5" />
                {activeFiltersCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-primary ring-2 ring-background" />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-96 p-5 glass-panel border-border/40 shadow-2xl"
              align="end"
              sideOffset={12}
            >
              <div className="space-y-5">
                <div className="flex items-center justify-between pb-2 border-b border-border/40">
                  <h4 className="font-semibold leading-none tracking-tight">Intelligence Filters</h4>
                  {activeFiltersCount > 0 && (
                    <Button variant="ghost" size="sm" className="h-auto py-1 px-2 text-xs" onClick={resetFilters}>
                      Reset all
                    </Button>
                  )}
                </div>

                {/* Radius */}
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Radius</h5>
                    <span className="text-xs font-medium text-primary">{radius} mi</span>
                  </div>
                  <Slider
                    min={10} max={500} step={10}
                    value={[radius]}
                    onValueChange={([v]) => setRadius(v)}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>10 mi</span><span>500 mi</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-5">
                  {/* Price Type */}
                  <div className="space-y-3">
                    <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Price Type</h5>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="cashPayOnly"
                        checked={filters.cashPayOnly}
                        onCheckedChange={(c) => setFilters({ ...filters, cashPayOnly: !!c })}
                      />
                      <Label htmlFor="cashPayOnly" className="text-sm cursor-pointer">Cash-Pay Only</Label>
                    </div>
                  </div>

                  {/* Facility Type */}
                  <div className="space-y-3">
                    <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Facility</h5>
                    {[
                      { id: "hospitalOnly", label: "Hospital" },
                      { id: "clinicOnly", label: "Clinic" },
                      { id: "imagingOnly", label: "Imaging" },
                      { id: "labOnly", label: "Lab" },
                      { id: "urgentCareOnly", label: "Urgent Care" },
                      { id: "dentalOnly", label: "Dental" },
                      { id: "telehealthOnly", label: "Telehealth" },
                    ].map(({ id, label }) => (
                      <div key={id} className="flex items-center space-x-2">
                        <Checkbox
                          id={id}
                          checked={filters[id as keyof typeof filters]}
                          onCheckedChange={(c) => setFilters({ ...filters, [id]: !!c })}
                        />
                        <Label htmlFor={id} className="text-sm cursor-pointer">{label}</Label>
                      </div>
                    ))}
                  </div>
                </div>

                <Button type="button" className="w-full" onClick={() => setShowFilters(false)}>
                  Apply Filters
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          <Button
            type="submit"
            disabled={isLoading || !query.trim()}
            className={`font-semibold ${
              isCompact
                ? "rounded-xl px-5 h-10 text-sm"
                : "rounded-2xl px-8 h-14 text-base"
            }`}
          >
            {isLoading ? (
              <Activity className="w-4 h-4 animate-pulse" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            <span className={isCompact ? "hidden sm:inline ml-2" : "ml-2"}>Search</span>
          </Button>
        </div>
      </form>

      {/* Suggestions Dropdown */}
      {showSuggestions && suggestions && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50 glass-panel border border-border/40 shadow-2xl rounded-2xl overflow-hidden">
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-primary/5 transition-colors border-b border-border/20 last:border-0"
              onClick={() => handleSelectSuggestion(s.text)}
            >
              <Search className="w-4 h-4 text-muted-foreground shrink-0" />
              <div>
                <div className="text-sm font-medium">{s.text}</div>
                {s.billingCode && (
                  <div className="text-xs text-muted-foreground font-mono">CPT: {s.billingCode}</div>
                )}
              </div>
              <Badge variant="secondary" className="ml-auto text-xs">{s.category}</Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
