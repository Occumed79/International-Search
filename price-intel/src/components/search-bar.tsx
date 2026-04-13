import { useState, useEffect, useRef } from "react";
import { Search, MapPin, SlidersHorizontal, Building2, Map, Stethoscope, ChevronRight, Activity } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useGetSearchSuggestions } from "@workspace/api-client-react";
import type { SearchRequest } from "@workspace/api-client-react";

export function SearchBar({ 
  onSearch, 
  isCompact, 
  isLoading,
  currentQuery 
}: { 
  onSearch: (q: SearchRequest) => void, 
  isCompact: boolean, 
  isLoading?: boolean,
  currentQuery?: SearchRequest | null
}) {
  const [query, setQuery] = useState(currentQuery?.query || "");
  const [location, setLocation] = useState(currentQuery?.city || "");
  const [showFilters, setShowFilters] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  
  const [filters, setFilters] = useState({
    cashPayOnly: currentQuery?.cashPayOnly || false,
    hospitalOnly: currentQuery?.hospitalOnly || false,
    clinicOnly: currentQuery?.clinicOnly || false,
    imagingOnly: currentQuery?.imagingOnly || false,
    labOnly: currentQuery?.labOnly || false,
    urgentCareOnly: currentQuery?.urgentCareOnly || false,
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
      setFilters({
        cashPayOnly: currentQuery.cashPayOnly || false,
        hospitalOnly: currentQuery.hospitalOnly || false,
        clinicOnly: currentQuery.clinicOnly || false,
        imagingOnly: currentQuery.imagingOnly || false,
        labOnly: currentQuery.labOnly || false,
        urgentCareOnly: currentQuery.urgentCareOnly || false,
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
      ...filters
    });
  };

  const handleSelectSuggestion = (suggestionText: string) => {
    setQuery(suggestionText);
    setShowSuggestions(false);
    onSearch({
      query: suggestionText,
      city: location.trim() || undefined,
      ...filters
    });
  };

  const activeFiltersCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="w-full relative" ref={wrapperRef}>
      <form onSubmit={handleSubmit} className={`glass-panel flex flex-col sm:flex-row items-stretch shadow-2xl shadow-black/5 transition-all duration-300 ring-1 ring-white/20 dark:ring-white/10 ${isCompact ? 'p-1.5 gap-1.5 rounded-2xl bg-white/40 dark:bg-black/40' : 'p-2.5 gap-2.5 rounded-3xl bg-white/60 dark:bg-black/60'}`}>
        
        <div className="relative flex-1 flex items-center group">
          <Search className={`absolute left-4 w-5 h-5 transition-colors ${query ? 'text-primary' : 'text-muted-foreground group-focus-within:text-foreground'}`} />
          <Input 
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            placeholder="Service, code, or specialty (e.g. MRI Brain)"
            className={`pl-12 bg-transparent border-0 ring-0 focus-visible:ring-0 shadow-none text-base h-auto placeholder:text-muted-foreground/70 ${isCompact ? 'py-2.5' : 'py-4 text-lg'}`}
          />
        </div>

        <div className="hidden sm:block w-px bg-border/40 my-2" />

        <div className="relative flex-[0.7] flex items-center group">
          <MapPin className={`absolute left-4 w-5 h-5 transition-colors ${location ? 'text-primary' : 'text-muted-foreground group-focus-within:text-foreground'}`} />
          <Input 
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="City, state, or zip"
            className={`pl-12 bg-transparent border-0 ring-0 focus-visible:ring-0 shadow-none text-base h-auto placeholder:text-muted-foreground/70 ${isCompact ? 'py-2.5' : 'py-4 text-lg'}`}
          />
        </div>

        <div className="hidden sm:block w-px bg-border/40 my-2" />

        <div className="flex items-center gap-1.5 sm:pl-1.5">
          <Popover open={showFilters} onOpenChange={setShowFilters}>
            <PopoverTrigger asChild>
              <Button 
                type="button" 
                variant="ghost" 
                size="icon"
                className={`relative hover:bg-black/5 dark:hover:bg-white/10 ${isCompact ? 'w-10 h-10 rounded-xl' : 'w-12 h-12 rounded-xl'} ${activeFiltersCount > 0 ? 'text-primary' : 'text-muted-foreground'}`}
              >
                <SlidersHorizontal className="w-5 h-5" />
                {activeFiltersCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-primary ring-2 ring-background"></span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-4 glass-panel border-border/40 shadow-2xl" align="end" sideOffset={12}>
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-border/40">
                  <h4 className="font-semibold leading-none tracking-tight">Intelligence Filters</h4>
                  {activeFiltersCount > 0 && (
                    <Button variant="ghost" size="sm" className="h-auto py-1 px-2 text-xs" onClick={() => setFilters({
                      cashPayOnly: false, hospitalOnly: false, clinicOnly: false, imagingOnly: false, labOnly: false, urgentCareOnly: false
                    })}>
                      Reset
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Price Type</h5>
                    <div className="flex items-center space-x-2">
                      <Checkbox id="cashPayOnly" checked={filters.cashPayOnly} onCheckedChange={(c) => setFilters({...filters, cashPayOnly: !!c})} />
                      <Label htmlFor="cashPayOnly" className="text-sm cursor-pointer">Cash-Pay Only</Label>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Facility Type</h5>
                    <div className="flex items-center space-x-2">
                      <Checkbox id="hospitalOnly" checked={filters.hospitalOnly} onCheckedChange={(c) => setFilters({...filters, hospitalOnly: !!c})} />
                      <Label htmlFor="hospitalOnly" className="text-sm cursor-pointer">Hospital</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox id="clinicOnly" checked={filters.clinicOnly} onCheckedChange={(c) => setFilters({...filters, clinicOnly: !!c})} />
                      <Label htmlFor="clinicOnly" className="text-sm cursor-pointer">Clinic</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox id="imagingOnly" checked={filters.imagingOnly} onCheckedChange={(c) => setFilters({...filters, imagingOnly: !!c})} />
                      <Label htmlFor="imagingOnly" className="text-sm cursor-pointer">Imaging Center</Label>
                    </div>
                  </div>
                </div>
                <div className="pt-2">
                  <Button type="button" className="w-full" onClick={() => setShowFilters(false)}>Apply Filters</Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <Button 
            type="submit" 
            disabled={isLoading || !query.trim()}
            className={`bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 transition-all ${isCompact ? 'rounded-xl h-10 px-5' : 'rounded-xl h-12 px-8 text-base font-semibold'}`}
          >
            {isLoading ? (
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
                <span className="hidden sm:inline">Scanning</span>
              </div>
            ) : (
              "Search"
            )}
          </Button>
        </div>
      </form>

      {/* Autocomplete Dropdown */}
      {showSuggestions && suggestions && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 p-2 glass-panel shadow-2xl z-50 max-h-[300px] overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 py-2">
            Intelligence Suggestions
          </div>
          <div className="space-y-1">
            {suggestions.map((suggestion, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSelectSuggestion(suggestion.text)}
                className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-white/40 dark:hover:bg-white/5 transition-colors flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  {suggestion.category === 'service' && <Stethoscope className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />}
                  {suggestion.category === 'provider' && <Building2 className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />}
                  {suggestion.category === 'specialty' && <Activity className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />}
                  <span className="font-medium text-sm group-hover:text-primary transition-colors">{suggestion.text}</span>
                </div>
                {suggestion.cptCode && (
                  <span className="font-mono text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">CPT {suggestion.cptCode}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
