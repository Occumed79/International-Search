import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BadgeCheck,
  BarChart3,
  Building2,
  DollarSign,
  Download,
  MapPin,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Stethoscope,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import occuMedLogoDataUrl from "@/assets/occu-med-logo-data";
import { useToast } from "@/hooks/use-toast";
import { CommandCenterMapV2, type CommandCenterMapPoint } from "@/components/command-center-map-v2";

type View = "map" | "directory" | "coverage" | "organizations" | "pricing" | "availability" | "insights" | "gaps";

type Provider = CommandCenterMapPoint & {
  visible?: boolean | null;
  lastAppointment?: string | null;
  pricingAvailable?: boolean;
  activity2026?: string | null;
  sourceStatus?: string | null;
};

type Intelligence = {
  pricingCount: number;
  availabilityCount: number;
  pricing: Array<{ componentName: string; numericPrice: number | null; sourcePriceText?: string }>;
  availability: Array<{ componentName: string; componentType?: string }>;
};

type InsightPayload = {
  summary: any;
  states: any[];
  services: any[];
  organizations: any[];
  pricingByState: any[];
};

const VIEWS: View[] = ["map", "directory", "coverage", "organizations", "pricing", "availability", "insights", "gaps"];
const STATUS_OPTIONS = ["All Statuses", "Active Agreement", "Expired", "No Agreement Date", "No Agreement / Unmatched", "2026 New / Unreconciled"];
const VISIBILITY_OPTIONS = [
  { value: "all", label: "All Visibility" },
  { value: "visible", label: "Visible Only" },
  { value: "hidden", label: "Hidden Only" },
  { value: "unknown", label: "Unknown Visibility" },
];
const ACTIVITY_OPTIONS = [
  { value: "all", label: "All Records" },
  { value: "new", label: "New in 2026" },
  { value: "updated", label: "Updated in 2026" },
  { value: "any", label: "Any 2026 Activity" },
  { value: "none", label: "No 2026 Activity" },
];
const GROUP_OPTIONS = [
  { value: "org", label: "Organization / Network" },
  { value: "facility", label: "Facility Type" },
  { value: "state", label: "State / Region" },
  { value: "city", label: "City" },
  { value: "country", label: "Country" },
  { value: "status", label: "Network Status" },
];
const SORT_OPTIONS = [
  { value: "name", label: "Clinic Name" },
  { value: "city", label: "City" },
  { value: "state", label: "State / Region" },
  { value: "facility", label: "Facility Type" },
  { value: "lastAppointment", label: "Last Appointment" },
];

const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];
const STATE_NAME_TO_ABBR: Record<string, string> = {
  Alabama:"AL",Alaska:"AK",Arizona:"AZ",Arkansas:"AR",California:"CA",Colorado:"CO",Connecticut:"CT",Delaware:"DE","District of Columbia":"DC",Florida:"FL",Georgia:"GA",Hawaii:"HI",Idaho:"ID",Illinois:"IL",Indiana:"IN",Iowa:"IA",Kansas:"KS",Kentucky:"KY",Louisiana:"LA",Maine:"ME",Maryland:"MD",Massachusetts:"MA",Michigan:"MI",Minnesota:"MN",Mississippi:"MS",Missouri:"MO",Montana:"MT",Nebraska:"NE",Nevada:"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND",Ohio:"OH",Oklahoma:"OK",Oregon:"OR",Pennsylvania:"PA","Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD",Tennessee:"TN",Texas:"TX",Utah:"UT",Vermont:"VT",Virginia:"VA",Washington:"WA","West Virginia":"WV",Wisconsin:"WI",Wyoming:"WY",
};

function currentView(): View {
  if (typeof window === "undefined") return "map";
  const value = new URLSearchParams(window.location.search).get("view") as View | null;
  return value && VIEWS.includes(value) ? value : "map";
}

function money(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(number);
}

function percent(numerator: unknown, denominator: unknown) {
  const n = Number(numerator || 0);
  const d = Number(denominator || 0);
  return d > 0 ? `${Math.round((n / d) * 100)}%` : "0%";
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportRows(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const csv = [keys.join(","), ...rows.map((row) => keys.map((key) => csvEscape(row[key])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function groupKey(provider: Provider, groupBy: string) {
  if (groupBy === "facility") return provider.facilityType || "Facility type not listed";
  if (groupBy === "state") return provider.stateRegion || "State / region not listed";
  if (groupBy === "city") return provider.city || "City not listed";
  if (groupBy === "country") return provider.country || "Country not listed";
  if (groupBy === "status") return provider.networkStatus || "Status not listed";
  return provider.organizationName || provider.name || "Organization not listed";
}

function normalizedState(value: unknown) {
  const text = String(value || "").trim();
  if (text.length === 2) return text.toUpperCase();
  return STATE_NAME_TO_ABBR[text] || text.toUpperCase();
}

function gapLevel(row: any) {
  const locations = Number(row.locations || 0);
  const active = Number(row.active || 0);
  if (locations === 0) return { rank: 0, label: "No network presence" };
  if (active === 0 || locations < 5) return { rank: 1, label: "Critical" };
  if (locations < 20 || active / locations < 0.25) return { rank: 2, label: "Limited" };
  if (locations < 75) return { rank: 3, label: "Moderate" };
  return { rank: 4, label: "Strong" };
}

function Stat({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div className="cc2-stat">
      <b>{value}</b>
      <span>{label}</span>
      {helper && <small>{helper}</small>}
    </div>
  );
}

export function CommandCenterV2() {
  const { toast } = useToast();
  const view = currentView();
  const [options, setOptions] = useState<any>({ countries: [], states: [], facilities: [], services: [] });

  const [nameSearch, setNameSearch] = useState("");
  const [detailsSearch, setDetailsSearch] = useState("");
  const [status, setStatus] = useState("All Statuses");
  const [visibility, setVisibility] = useState("all");
  const [activity, setActivity] = useState("all");
  const [country, setCountry] = useState("All Countries");
  const [stateRegion, setStateRegion] = useState("All States / Regions");
  const [facility, setFacility] = useState("All Facility Types");
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [serviceMode, setServiceMode] = useState<"any" | "all">("any");
  const [groupBy, setGroupBy] = useState("org");
  const [sortBy, setSortBy] = useState("name");

  const [filterSummary, setFilterSummary] = useState<any>({ total: 0, active: 0, cities: 0, countries: 0, gps_ready: 0 });
  const [directory, setDirectory] = useState<Provider[]>([]);
  const [selected, setSelected] = useState<Provider | null>(null);
  const [intelligence, setIntelligence] = useState<Intelligence | null>(null);
  const [coverageGeo, setCoverageGeo] = useState("state");
  const [coverage, setCoverage] = useState<any>({ rows: [], summary: {} });
  const [orgSearch, setOrgSearch] = useState("");
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [pricing, setPricing] = useState<any>({ rows: [], stats: {}, options: { networks: [], states: [], components: [] } });
  const [pricingSearch, setPricingSearch] = useState("");
  const [pricingNetwork, setPricingNetwork] = useState("");
  const [pricingState, setPricingState] = useState("");
  const [pricingComponent, setPricingComponent] = useState("");
  const [pricingValue, setPricingValue] = useState("");
  const [availability, setAvailability] = useState<any>({ rows: [], stats: {}, options: { networks: [], states: [], types: [], components: [] } });
  const [availabilitySearch, setAvailabilitySearch] = useState("");
  const [availabilityNetwork, setAvailabilityNetwork] = useState("");
  const [availabilityState, setAvailabilityState] = useState("");
  const [availabilityType, setAvailabilityType] = useState("");
  const [availabilityComponent, setAvailabilityComponent] = useState("");
  const [insights, setInsights] = useState<InsightPayload>({ summary: {}, states: [], services: [], organizations: [], pricingByState: [] });
  const [loading, setLoading] = useState(false);
  const [intelLoading, setIntelLoading] = useState(false);

  const commonQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (nameSearch) params.set("name", nameSearch);
    if (detailsSearch) params.set("details", detailsSearch);
    if (status !== "All Statuses") params.set("status", status);
    if (visibility !== "all") params.set("visibility", visibility);
    if (activity !== "all") params.set("activity", activity);
    if (country !== "All Countries") params.set("country", country);
    if (stateRegion !== "All States / Regions") params.set("state", stateRegion);
    if (facility !== "All Facility Types") params.set("facility", facility);
    if (selectedServices.length) params.set("services", selectedServices.join("|"));
    params.set("serviceMode", serviceMode);
    return params.toString();
  }, [nameSearch, detailsSearch, status, visibility, activity, country, stateRegion, facility, selectedServices, serviceMode]);

  useEffect(() => {
    void fetch("/api/command-center/options").then((r) => r.json()).then(setOptions).catch(() => {});
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetch(`/api/command-center/directory?${commonQuery}${commonQuery ? "&" : ""}limit=1`)
        .then((r) => r.json()).then((body) => setFilterSummary(body.snapshot || {})).catch(() => {});
    }, 150);
    return () => window.clearTimeout(timer);
  }, [commonQuery]);

  useEffect(() => {
    if (view !== "directory") return;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void fetch(`/api/command-center/directory?${commonQuery}${commonQuery ? "&" : ""}sort=${encodeURIComponent(sortBy)}&limit=1200`)
        .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); return body; })
        .then((body) => {
          const results = Array.isArray(body.results) ? body.results : [];
          setDirectory(results);
          setSelected((current) => current && results.some((row: Provider) => row.id === current.id) ? current : results[0] || null);
        })
        .catch((error) => toast({ title: "Directory could not be loaded", description: error.message, variant: "destructive" }))
        .finally(() => setLoading(false));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [view, commonQuery, sortBy, toast]);

  useEffect(() => {
    if (!selected?.externalId) { setIntelligence(null); return; }
    setIntelLoading(true);
    void fetch(`/api/network/intelligence/${selected.externalId}`)
      .then((r) => r.json()).then(setIntelligence).catch(() => setIntelligence(null)).finally(() => setIntelLoading(false));
  }, [selected?.externalId]);

  useEffect(() => {
    if (view !== "coverage") return;
    setLoading(true);
    void fetch(`/api/command-center/coverage?${commonQuery}${commonQuery ? "&" : ""}geo=${coverageGeo}`)
      .then((r) => r.json()).then(setCoverage).finally(() => setLoading(false));
  }, [view, commonQuery, coverageGeo]);

  useEffect(() => {
    if (view !== "organizations") return;
    const params = new URLSearchParams(commonQuery);
    if (orgSearch) params.set("orgSearch", orgSearch);
    setLoading(true);
    void fetch(`/api/command-center/organizations?${params.toString()}`)
      .then((r) => r.json()).then((body) => setOrganizations(Array.isArray(body.rows) ? body.rows : [])).finally(() => setLoading(false));
  }, [view, commonQuery, orgSearch]);

  useEffect(() => {
    if (view !== "pricing") return;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(commonQuery);
      if (pricingSearch) params.set("pq", pricingSearch);
      if (pricingNetwork) params.set("pnet", pricingNetwork);
      if (pricingState) params.set("pstate", pricingState);
      if (pricingComponent) params.set("pcomponent", pricingComponent);
      if (pricingValue) params.set("pvalue", pricingValue);
      setLoading(true);
      void fetch(`/api/command-center-v2/pricing?${params.toString()}`).then((r) => r.json()).then(setPricing).finally(() => setLoading(false));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [view, commonQuery, pricingSearch, pricingNetwork, pricingState, pricingComponent, pricingValue]);

  useEffect(() => {
    if (view !== "availability") return;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(commonQuery);
      if (availabilitySearch) params.set("aq", availabilitySearch);
      if (availabilityNetwork) params.set("anet", availabilityNetwork);
      if (availabilityState) params.set("astate", availabilityState);
      if (availabilityType) params.set("atype", availabilityType);
      if (availabilityComponent) params.set("acomponent", availabilityComponent);
      setLoading(true);
      void fetch(`/api/command-center-v2/availability?${params.toString()}`).then((r) => r.json()).then(setAvailability).finally(() => setLoading(false));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [view, commonQuery, availabilitySearch, availabilityNetwork, availabilityState, availabilityType, availabilityComponent]);

  useEffect(() => {
    if (view !== "insights" && view !== "gaps") return;
    setLoading(true);
    void fetch(`/api/command-center-v2/insights?${commonQuery}`).then((r) => r.json()).then(setInsights).finally(() => setLoading(false));
  }, [view, commonQuery]);

  const grouped = useMemo(() => {
    const map = new Map<string, Provider[]>();
    directory.forEach((provider) => {
      const key = groupKey(provider, groupBy);
      const list = map.get(key) || [];
      list.push(provider);
      map.set(key, list);
    });
    return Array.from(map.entries());
  }, [directory, groupBy]);

  const topServices = Array.isArray(options.services) ? options.services.slice(0, 18) : [];

  const clearFilters = () => {
    setNameSearch(""); setDetailsSearch(""); setStatus("All Statuses"); setVisibility("all"); setActivity("all");
    setCountry("All Countries"); setStateRegion("All States / Regions"); setFacility("All Facility Types"); setSelectedServices([]); setServiceMode("any");
  };

  const mapSelect = (point: CommandCenterMapPoint) => setSelected(point as Provider);

  const stateRows = useMemo(() => {
    const map = new Map<string, any>();
    (insights.states || []).forEach((row) => map.set(normalizedState(row.state), row));
    return US_STATES.map((state) => ({ state, locations: 0, active: 0, service_tagged: 0, gps_ready: 0, cities: 0, ...(map.get(state) || {}) }));
  }, [insights.states]);

  const gapRows = useMemo(() => stateRows.map((row) => ({ ...row, gap: gapLevel(row) })).sort((a, b) => a.gap.rank - b.gap.rank || Number(a.locations) - Number(b.locations)), [stateRows]);

  const strongestState = useMemo(() => [...stateRows].sort((a, b) => Number(b.locations) - Number(a.locations))[0], [stateRows]);
  const zeroStates = gapRows.filter((row) => Number(row.locations) === 0).length;
  const limitedStates = gapRows.filter((row) => row.gap.rank <= 2).length;

  return (
    <div className="cc2-page">
      <style>{`
        .cc2-page{height:100%;min-height:0;overflow:hidden;color:#1E2A3A;background:linear-gradient(135deg,#EEF2F6 0%,#B6C7D6 64%,#4B6F93 132%);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.cc2-page *{box-sizing:border-box}.cc2-app{height:100%;display:grid;grid-template-columns:300px minmax(0,1fr);gap:10px;padding:10px;min-height:0}.cc2-side{min-height:0;overflow:auto;border-radius:25px;padding:14px;background:linear-gradient(180deg,rgba(255,254,254,.94),rgba(238,242,246,.90));border:1px solid rgba(255,254,254,.94);box-shadow:0 14px 38px rgba(30,42,58,.15)}.cc2-logo{padding:7px 6px 11px;text-align:center}.cc2-logo img{display:block;width:118px;max-width:70%;height:auto;margin:0 auto;filter:invert(1);opacity:.94}.cc2-logo h2{font-size:15px;margin:9px 0 0}.cc2-logo p{font-size:8.5px;line-height:1.4;color:#4B6F93;margin:4px 0 0}.cc2-label{font-size:8.5px;letter-spacing:.14em;text-transform:uppercase;color:#4B6F93;font-weight:850;margin:13px 4px 6px}.cc2-field{margin-top:6px}.cc2-field label{display:block;font-size:8.5px;color:#4B6F93;margin:0 0 3px 4px}.cc2-field input,.cc2-field select{width:100%;height:38px;border:1px solid rgba(182,199,214,.72);border-radius:12px;background:rgba(255,254,254,.84);padding:0 10px;color:#1E2A3A;outline:none;font-size:10px}.cc2-note{font-size:7.7px;color:#4B6F93;line-height:1.35;margin:5px 4px}.cc2-mode{display:flex;align-items:center;justify-content:space-between;font-size:8px;color:#4B6F93;margin-bottom:6px}.cc2-mode button{border:0;background:transparent;color:#4B6F93;font-size:8px;font-weight:850;cursor:pointer}.cc2-chips{display:flex;gap:4px;flex-wrap:wrap}.cc2-chip{border:1px solid rgba(182,199,214,.70);background:rgba(255,254,254,.84);border-radius:999px;padding:5px 7px;font-size:7.5px;color:#1E2A3A;cursor:pointer}.cc2-chip.on{background:#4B6F93;color:#FFFEFE;border-color:#4B6F93}.cc2-clear{width:100%;height:33px;border:1px solid rgba(182,199,214,.75);border-radius:11px;background:#EEF2F6;color:#1E2A3A;font-size:9px;font-weight:800;cursor:pointer;margin-top:10px}.cc2-mini{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:7px}.cc2-mini div{padding:8px;border:1px solid rgba(182,199,214,.62);border-radius:12px;background:rgba(255,254,254,.72)}.cc2-mini b{display:block;font-size:14px}.cc2-mini span{font-size:6.8px;color:#4B6F93;text-transform:uppercase;letter-spacing:.08em}
        .cc2-main{min-width:0;min-height:0}.cc2-work{height:100%;min-height:0;overflow:hidden;border-radius:25px;background:linear-gradient(145deg,rgba(238,242,246,.92),rgba(182,199,214,.72));border:1px solid rgba(255,254,254,.92);box-shadow:0 14px 42px rgba(30,42,58,.14)}.cc2-scroll{height:100%;overflow:auto;padding:12px}.cc2-section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}.cc2-section-head h1,.cc2-section-head h2{font-size:20px;margin:0;letter-spacing:-.03em}.cc2-section-head p{font-size:8.8px;color:#4B6F93;margin:4px 0 0}.cc2-toolbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.cc2-toolbar input,.cc2-toolbar select,.cc2-toolbar button{height:33px;border:1px solid rgba(182,199,214,.72);border-radius:10px;background:rgba(255,254,254,.88);color:#1E2A3A;padding:0 9px;font-size:8.5px}.cc2-toolbar button{font-weight:800;cursor:pointer;display:flex;align-items:center;gap:5px}.cc2-dir{height:100%;display:grid;grid-template-columns:minmax(0,1fr) 340px;min-height:0}.cc2-dir-main{min-height:0;overflow:auto;padding:11px;border-right:1px solid rgba(75,111,147,.15)}.cc2-groups{display:grid;gap:7px}.cc2-group{border:1px solid rgba(255,254,254,.82);background:rgba(238,242,246,.50);border-radius:16px;overflow:hidden}.cc2-group-head{padding:8px 10px;background:rgba(255,254,254,.70);border-bottom:1px solid rgba(182,199,214,.45)}.cc2-group-head b{font-size:10px}.cc2-group-head span{display:block;font-size:7.5px;color:#4B6F93}.cc2-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:6px;padding:7px}.cc2-card{border:1px solid rgba(182,199,214,.68);background:rgba(255,254,254,.90);border-radius:13px;padding:9px;text-align:left;color:#1E2A3A;cursor:pointer;transition:transform .15s ease,box-shadow .15s ease,border-color .15s ease}.cc2-card:hover{transform:translateY(-2px);box-shadow:0 9px 22px rgba(30,42,58,.14);border-color:#4B6F93}.cc2-card.on{border-color:#4B6F93;box-shadow:0 0 0 2px rgba(75,111,147,.20)}.cc2-card b{display:block;font-size:10.5px;line-height:1.3}.cc2-sub{font-size:8px;color:#4B6F93;margin-top:3px}.cc2-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}.cc2-tag{font-size:7px;border-radius:999px;padding:3px 6px;background:#EEF2F6;border:1px solid #B6C7D6}.cc2-detail{min-height:0;overflow:auto;padding:11px;background:rgba(182,199,214,.22)}.cc2-detail-block{border:1px solid rgba(182,199,214,.70);background:rgba(255,254,254,.88);border-radius:15px;padding:11px;margin-bottom:7px}.cc2-detail-block h3{font-size:15px;margin:0}.cc2-detail-block h4{font-size:7.5px;letter-spacing:.12em;text-transform:uppercase;color:#4B6F93;margin:0 0 7px}.cc2-kv{display:grid;grid-template-columns:82px 1fr;gap:5px 7px;font-size:8.5px;line-height:1.35}.cc2-kv .k{color:#4B6F93}.cc2-line{padding:5px 0;border-top:1px solid rgba(75,111,147,.13);font-size:8px}.cc2-line:first-of-type{border-top:0}.cc2-price{font-weight:850;color:#4B6F93}
        .cc2-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin:8px 0 10px}.cc2-stat{border:1px solid rgba(255,254,254,.88);background:rgba(255,254,254,.72);border-radius:14px;padding:10px}.cc2-stat b{display:block;font-size:18px}.cc2-stat span{display:block;font-size:7px;color:#4B6F93;text-transform:uppercase;letter-spacing:.08em;margin-top:2px}.cc2-stat small{display:block;font-size:7px;color:#4B6F93;margin-top:3px}.cc2-tablebox{border:1px solid rgba(255,254,254,.88);border-radius:14px;overflow:auto;background:rgba(238,242,246,.58)}.cc2-table{width:100%;border-collapse:collapse;font-size:7.8px;min-width:780px}.cc2-table th{position:sticky;top:0;background:rgba(238,242,246,.98);text-align:left;color:#1E2A3A;font-weight:850;z-index:1}.cc2-table th,.cc2-table td{padding:7px 8px;border-bottom:1px solid rgba(75,111,147,.16);vertical-align:top}.cc2-table td:first-child{font-weight:750}.cc2-insight-grid{display:grid;grid-template-columns:1.2fr 1fr;gap:9px}.cc2-panel{border:1px solid rgba(255,254,254,.88);background:rgba(255,254,254,.68);border-radius:16px;padding:11px;min-width:0}.cc2-panel h3{font-size:13px;margin:0 0 8px}.cc2-callouts{display:grid;grid-template-columns:1fr 1fr;gap:7px}.cc2-callout{border-radius:14px;padding:11px;background:linear-gradient(145deg,#1E2A3A,#4B6F93);color:#FFFEFE;min-height:94px}.cc2-callout:nth-child(even){background:linear-gradient(145deg,#4B6F93,#B6C7D6);color:#1E2A3A}.cc2-callout b{font-size:11px;display:block}.cc2-callout span{font-size:8px;line-height:1.4;display:block;margin-top:5px;opacity:.88}.cc2-bars{display:grid;gap:6px}.cc2-bar-row{display:grid;grid-template-columns:100px 1fr 48px;align-items:center;gap:7px;font-size:8px}.cc2-bar-track{height:7px;background:#EEF2F6;border-radius:99px;overflow:hidden}.cc2-bar{height:100%;background:#4B6F93;border-radius:99px}.cc2-gap{display:inline-flex;border-radius:999px;padding:3px 6px;font-size:7px;font-weight:800}.cc2-gap.zero,.cc2-gap.critical{background:#1E2A3A;color:#FFFEFE}.cc2-gap.limited{background:#4B6F93;color:#FFFEFE}.cc2-gap.moderate{background:#B6C7D6;color:#1E2A3A}.cc2-gap.strong{background:#EEF2F6;color:#1E2A3A;border:1px solid #B6C7D6}.cc2-loading{height:100%;display:grid;place-items:center;color:#4B6F93}.cc2-loading div{background:rgba(255,254,254,.76);border:1px solid rgba(182,199,214,.70);padding:10px 14px;border-radius:999px;font-size:9px;font-weight:800;box-shadow:0 9px 24px rgba(30,42,58,.12)}
        @media(max-width:1050px){.cc2-app{grid-template-columns:260px minmax(0,1fr)}.cc2-dir{grid-template-columns:minmax(0,1fr) 300px}.cc2-stats{grid-template-columns:1fr 1fr}.cc2-insight-grid{grid-template-columns:1fr}}@media(max-width:800px){.cc2-app{grid-template-columns:1fr}.cc2-side{display:none}.cc2-dir{grid-template-columns:1fr}.cc2-detail{display:none}}
      `}</style>

      <div className="cc2-app">
        <aside className="cc2-side">
          <div className="cc2-logo">
            <img src={occuMedLogoDataUrl} alt="Occu-Med" />
            <h2>Network Command Center</h2>
            <p>Provider coverage, agreements, services, pricing, availability, and network analytics.</p>
          </div>

          <div className="cc2-label">Clinic / Network Search</div>
          <div className="cc2-field"><input value={nameSearch} onChange={(e) => setNameSearch(e.target.value)} placeholder="Clinic or network name" /></div>
          <div className="cc2-note">Name search takes precedence over other provider filters so a specific network can be inspected directly.</div>

          <div className="cc2-label">Location / Details Search</div>
          <div className="cc2-field"><input value={detailsSearch} onChange={(e) => setDetailsSearch(e.target.value)} placeholder="City, address, ZIP, phone, service…" /></div>
          <div className="cc2-field"><label>Network Status</label><select value={status} onChange={(e) => setStatus(e.target.value)}>{STATUS_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></div>
          <div className="cc2-field"><label>Visibility</label><select value={visibility} onChange={(e) => setVisibility(e.target.value)}>{VISIBILITY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
          <div className="cc2-field"><label>2026 Activity</label><select value={activity} onChange={(e) => setActivity(e.target.value)}>{ACTIVITY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>

          <div className="cc2-label">Documented Services</div>
          <div className="cc2-mode"><span>Match {serviceMode.toUpperCase()} selected services</span><button type="button" onClick={() => setServiceMode(serviceMode === "any" ? "all" : "any")}>Switch to {serviceMode === "any" ? "ALL" : "ANY"}</button></div>
          <div className="cc2-chips">
            {topServices.map((item: any) => {
              const on = selectedServices.includes(item.value);
              return <button key={item.value} type="button" className={`cc2-chip ${on ? "on" : ""}`} onClick={() => setSelectedServices((current) => on ? current.filter((value) => value !== item.value) : [...current, item.value])}>{item.value} {Number(item.count || 0).toLocaleString()}</button>;
            })}
          </div>

          <div className="cc2-label">Geography & Facility</div>
          <div className="cc2-field"><label>Country</label><select value={country} onChange={(e) => setCountry(e.target.value)}><option>All Countries</option>{(options.countries || []).map((item: any) => <option key={item.value} value={item.value}>{item.value} ({Number(item.count || 0).toLocaleString()})</option>)}</select></div>
          <div className="cc2-field"><label>State / Region</label><select value={stateRegion} onChange={(e) => setStateRegion(e.target.value)}><option>All States / Regions</option>{(options.states || []).map((item: any) => <option key={item.value} value={item.value}>{item.value}</option>)}</select></div>
          <div className="cc2-field"><label>Facility Type</label><select value={facility} onChange={(e) => setFacility(e.target.value)}><option>All Facility Types</option>{(options.facilities || []).map((item: any) => <option key={item.value} value={item.value}>{item.value}</option>)}</select></div>

          {view === "directory" && <>
            <div className="cc2-label">Directory Layout</div>
            <div className="cc2-field"><label>Group By</label><select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>{GROUP_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
            <div className="cc2-field"><label>Sort</label><select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>{SORT_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
          </>}

          <button type="button" className="cc2-clear" onClick={clearFilters}><X style={{width:12,height:12,display:"inline",marginRight:5}} />Clear Provider Filters</button>
          <div className="cc2-label">Filtered Network</div>
          <div className="cc2-mini">
            <div><b>{Number(filterSummary.total || 0).toLocaleString()}</b><span>Locations</span></div>
            <div><b>{Number(filterSummary.active || 0).toLocaleString()}</b><span>Active</span></div>
            <div><b>{Number(filterSummary.cities || 0).toLocaleString()}</b><span>Cities</span></div>
            <div><b>{Number(filterSummary.countries || 0).toLocaleString()}</b><span>Countries</span></div>
          </div>
        </aside>

        <main className="cc2-main">
          <section className="cc2-work">
            {view === "map" && (
              <CommandCenterMapV2 filterQuery={commonQuery} selectedId={selected?.id || null} onSelect={mapSelect} />
            )}

            {view === "directory" && (
              <div className="cc2-dir">
                <div className="cc2-dir-main">
                  <div className="cc2-section-head">
                    <div><h1>Provider Directory</h1><p>{Number(filterSummary.total || 0).toLocaleString()} matching physical clinic locations.</p></div>
                    <div className="cc2-toolbar"><button type="button" onClick={() => exportRows("provider-directory.csv", directory as any)}><Download style={{width:11,height:11}} />Export CSV</button></div>
                  </div>
                  {loading ? <div className="cc2-loading"><div>Loading provider directory…</div></div> : (
                    <div className="cc2-groups">
                      {grouped.map(([key, rows]) => (
                        <div className="cc2-group" key={key}>
                          <div className="cc2-group-head"><b>{key}</b><span>{rows.length.toLocaleString()} location{rows.length === 1 ? "" : "s"}</span></div>
                          <div className="cc2-cards">
                            {rows.map((provider) => (
                              <button type="button" key={provider.id} className={`cc2-card ${selected?.id === provider.id ? "on" : ""}`} onClick={() => setSelected(provider)}>
                                <b>{provider.name}</b>
                                <div className="cc2-sub">{[provider.city, provider.stateRegion, provider.country].filter(Boolean).join(", ") || "Location not listed"}</div>
                                <div className="cc2-tags"><span className="cc2-tag">{provider.networkStatus || "Status not listed"}</span>{provider.facilityType && <span className="cc2-tag">{provider.facilityType}</span>}</div>
                                <div className="cc2-sub">{provider.phone || "Phone not listed"}</div>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <aside className="cc2-detail">
                  {!selected ? <div className="cc2-loading"><div>Select a clinic to inspect it.</div></div> : <>
                    <div className="cc2-detail-block">
                      <h3>{selected.name}</h3>
                      <div className="cc2-sub">{[selected.city, selected.stateRegion, selected.country].filter(Boolean).join(", ")}</div>
                      <div className="cc2-tags"><span className="cc2-tag">{selected.networkStatus || "Status not listed"}</span>{selected.facilityType && <span className="cc2-tag">{selected.facilityType}</span>}</div>
                    </div>
                    <div className="cc2-detail-block"><h4>Contact & Location</h4><div className="cc2-kv"><span className="k">Organization</span><span>{selected.organizationName || "—"}</span><span className="k">Address</span><span>{selected.address || "—"}</span><span className="k">Phone</span><span>{selected.phone || "—"}</span><span className="k">Coordinates</span><span>{selected.latitude != null && selected.longitude != null ? `${selected.latitude}, ${selected.longitude}` : "—"}</span></div></div>
                    <div className="cc2-detail-block"><h4>Documented Services</h4><div className="cc2-tags">{selected.services?.length ? selected.services.map((service) => <span className="cc2-tag" key={service}>{service}</span>) : <span className="cc2-sub">No documented services listed.</span>}</div></div>
                    <div className="cc2-detail-block"><h4>Pricing & Availability</h4>{intelLoading ? <div className="cc2-sub">Loading clinic intelligence…</div> : <><div className="cc2-kv"><span className="k">Pricing rows</span><span>{Number(intelligence?.pricingCount || 0).toLocaleString()}</span><span className="k">Availability</span><span>{Number(intelligence?.availabilityCount || 0).toLocaleString()}</span></div>{(intelligence?.pricing || []).slice(0, 8).map((row, index) => <div className="cc2-line" key={`${row.componentName}-${index}`}><span>{row.componentName}</span><span className="cc2-price" style={{float:"right"}}>{row.numericPrice == null ? row.sourcePriceText || "—" : money(row.numericPrice)}</span></div>)}</>}</div>
                  </>}
                </aside>
              </div>
            )}

            {view === "coverage" && (
              <div className="cc2-scroll">
                <div className="cc2-section-head"><div><h1>Service Coverage</h1><p>Documented clinic capabilities by geography for the current provider filters.</p></div><div className="cc2-toolbar"><select value={coverageGeo} onChange={(e) => setCoverageGeo(e.target.value)}><option value="state">State / Region</option><option value="country">Country</option><option value="city">City</option></select></div></div>
                <div className="cc2-stats"><Stat label="Geographies" value={Number(coverage.summary?.geographies || 0).toLocaleString()} /><Stat label="Locations" value={Number(coverage.summary?.locations || 0).toLocaleString()} /><Stat label="Active Agreements" value={Number(coverage.summary?.active || 0).toLocaleString()} /><Stat label="Service Tagged" value={Number(coverage.summary?.service_tagged || 0).toLocaleString()} /></div>
                <div className="cc2-tablebox"><table className="cc2-table"><thead><tr><th>Geography</th><th>Locations</th><th>Active</th><th>Medical</th><th>Drug Testing</th><th>Laboratory</th><th>Dental</th><th>Hearing</th><th>Imaging</th><th>Vaccinations</th><th>Fit Test</th></tr></thead><tbody>{(coverage.rows || []).map((row: any) => <tr key={row.geography}><td>{row.geography}</td><td>{row.locations}</td><td>{row.active}</td><td>{row.medical}</td><td>{row.drug_testing}</td><td>{row.laboratory}</td><td>{row.dental}</td><td>{row.hearing}</td><td>{row.imaging}</td><td>{row.vaccinations}</td><td>{row.fit_test}</td></tr>)}</tbody></table></div>
              </div>
            )}

            {view === "organizations" && (
              <div className="cc2-scroll">
                <div className="cc2-section-head"><div><h1>Organizations</h1><p>Network and provider rollups while every physical clinic remains a separate record.</p></div><div className="cc2-toolbar"><input value={orgSearch} onChange={(e) => setOrgSearch(e.target.value)} placeholder="Search organization…" /></div></div>
                <div className="cc2-tablebox"><table className="cc2-table"><thead><tr><th>Organization / Network</th><th>Locations</th><th>Active</th><th>Countries</th><th>States / Regions</th><th>Cities</th><th>Documented Services</th></tr></thead><tbody>{organizations.map((row) => <tr key={row.organization}><td>{row.organization}</td><td>{row.locations}</td><td>{row.active}</td><td>{row.countries}</td><td>{row.states_regions}</td><td>{row.cities}</td><td>{row.documented_services || "—"}</td></tr>)}</tbody></table></div>
              </div>
            )}

            {view === "pricing" && (
              <div className="cc2-scroll">
                <div className="cc2-section-head"><div><h1>Pricing</h1><p>Clinic-level pricing that stays synchronized with the provider filters in the sidebar.</p></div><div className="cc2-toolbar"><button type="button" onClick={() => exportRows("filtered-pricing.csv", pricing.rows || [])}><Download style={{width:11,height:11}} />Export CSV</button></div></div>
                <div className="cc2-toolbar"><input value={pricingSearch} onChange={(e) => setPricingSearch(e.target.value)} placeholder="Search clinic, network, city, line item…" /><select value={pricingNetwork} onChange={(e) => setPricingNetwork(e.target.value)}><option value="">All networks / providers</option>{(pricing.options?.networks || []).map((item: any) => <option key={item.value} value={item.value}>{item.value}</option>)}</select><select value={pricingState} onChange={(e) => setPricingState(e.target.value)}><option value="">All states</option>{(pricing.options?.states || []).map((item: any) => <option key={item.value} value={item.value}>{item.value}</option>)}</select><select value={pricingComponent} onChange={(e) => setPricingComponent(e.target.value)}><option value="">All line items</option>{(pricing.options?.components || []).map((item: any) => <option key={item.value} value={item.value}>{item.value}</option>)}</select><select value={pricingValue} onChange={(e) => setPricingValue(e.target.value)}><option value="">All price records</option><option value="numeric">Numeric prices</option><option value="text">Text-only prices</option></select></div>
                <div className="cc2-stats"><Stat label="Matching Price Records" value={Number(pricing.stats?.records || 0).toLocaleString()} /><Stat label="Physical Clinics" value={Number(pricing.stats?.clinics || 0).toLocaleString()} /><Stat label="Line Items" value={Number(pricing.stats?.line_items || 0).toLocaleString()} /><Stat label="Average Numeric Price" value={money(pricing.stats?.average_numeric_price)} /></div>
                <div className="cc2-tablebox"><table className="cc2-table"><thead><tr><th>Network / Provider</th><th>Physical Clinic</th><th>Location</th><th>Line Item</th><th>Latest Price</th><th>Effective</th><th>Expires</th><th>Created</th></tr></thead><tbody>{(pricing.rows || []).map((row: any) => <tr key={row.id}><td>{row.network_name || "—"}</td><td>{row.site_name || "—"}</td><td>{[row.city,row.state_region,row.postal_code].filter(Boolean).join(", ")}</td><td>{row.component_name}</td><td className="cc2-price">{row.numeric_price == null ? row.source_price_text || "—" : money(row.numeric_price)}</td><td>{row.effective_date || "—"}</td><td>{row.expiration_date || "—"}</td><td>{row.line_item_created || "—"}</td></tr>)}</tbody></table></div>
              </div>
            )}

            {view === "availability" && (
              <div className="cc2-scroll">
                <div className="cc2-section-head"><div><h1>Service Availability</h1><p>Explicit clinic-level service availability, reported independently from pricing.</p></div><div className="cc2-toolbar"><button type="button" onClick={() => exportRows("filtered-service-availability.csv", availability.rows || [])}><Download style={{width:11,height:11}} />Export CSV</button></div></div>
                <div className="cc2-toolbar"><input value={availabilitySearch} onChange={(e) => setAvailabilitySearch(e.target.value)} placeholder="Search service, clinic, network, city…" /><select value={availabilityNetwork} onChange={(e) => setAvailabilityNetwork(e.target.value)}><option value="">All networks / providers</option>{(availability.options?.networks || []).map((item: any) => <option key={item.value} value={item.value}>{item.value}</option>)}</select><select value={availabilityState} onChange={(e) => setAvailabilityState(e.target.value)}><option value="">All states</option>{(availability.options?.states || []).map((item: any) => <option key={item.value} value={item.value}>{item.value}</option>)}</select><select value={availabilityType} onChange={(e) => setAvailabilityType(e.target.value)}><option value="">All service categories</option>{(availability.options?.types || []).map((item: any) => <option key={item.value} value={item.value}>{item.value}</option>)}</select><select value={availabilityComponent} onChange={(e) => setAvailabilityComponent(e.target.value)}><option value="">All services</option>{(availability.options?.components || []).map((item: any) => <option key={item.value} value={item.value}>{item.value}</option>)}</select></div>
                <div className="cc2-stats"><Stat label="Availability Links" value={Number(availability.stats?.records || 0).toLocaleString()} /><Stat label="Physical Clinics" value={Number(availability.stats?.clinics || 0).toLocaleString()} /><Stat label="Available Services" value={Number(availability.stats?.line_items || 0).toLocaleString()} /><Stat label="Service Categories" value={Number(availability.stats?.component_types || 0).toLocaleString()} /></div>
                <div className="cc2-tablebox"><table className="cc2-table"><thead><tr><th>Service</th><th>Category</th><th>Network / Provider</th><th>Physical Clinic</th><th>Location</th><th>Phone</th></tr></thead><tbody>{(availability.rows || []).map((row: any) => <tr key={row.id}><td>{row.component_name}</td><td>{row.component_type || "—"}</td><td>{row.network_name || "—"}</td><td>{row.site_name || "—"}</td><td>{[row.city,row.state_region,row.postal_code].filter(Boolean).join(", ")}</td><td>{row.phone || "—"}</td></tr>)}</tbody></table></div>
              </div>
            )}

            {view === "insights" && (
              <div className="cc2-scroll">
                <div className="cc2-section-head"><div><h1>Network & Pricing Insights</h1><p>Analytical findings generated from the current provider, agreement, service, availability, and pricing records.</p></div></div>
                <div className="cc2-stats"><Stat label="Locations" value={Number(insights.summary?.locations || 0).toLocaleString()} helper={`${percent(insights.summary?.active, insights.summary?.locations)} active`} /><Stat label="Pricing Coverage" value={percent(insights.summary?.priced_clinics, insights.summary?.locations)} helper={`${Number(insights.summary?.priced_clinics || 0).toLocaleString()} clinics`} /><Stat label="Availability Coverage" value={percent(insights.summary?.availability_clinics, insights.summary?.locations)} helper={`${Number(insights.summary?.availability_clinics || 0).toLocaleString()} clinics`} /><Stat label="Median Numeric Price" value={money(insights.summary?.median_price)} helper={`Average ${money(insights.summary?.average_price)}`} /></div>
                <div className="cc2-insight-grid">
                  <div className="cc2-panel"><h3>What stands out</h3><div className="cc2-callouts">
                    <div className="cc2-callout"><b>Strongest U.S. footprint</b><span>{strongestState && Number(strongestState.locations) > 0 ? `${strongestState.state} has ${Number(strongestState.locations).toLocaleString()} locations and ${Number(strongestState.active).toLocaleString()} active agreements.` : "No U.S. locations match the current filters."}</span></div>
                    <div className="cc2-callout"><b>Network presence gaps</b><span>{zeroStates} states/DC have zero matching provider locations; {limitedStates} are zero, critical, or limited under the current filters.</span></div>
                    <div className="cc2-callout"><b>Service documentation</b><span>{percent(insights.summary?.service_tagged, insights.summary?.locations)} of matching clinics have documented service tags.</span></div>
                    <div className="cc2-callout"><b>Pricing intelligence</b><span>{Number(insights.summary?.pricing_records || 0).toLocaleString()} numeric pricing records contribute to a median of {money(insights.summary?.median_price)}.</span></div>
                  </div></div>
                  <div className="cc2-panel"><h3>Largest U.S. footprints</h3><div className="cc2-bars">{[...stateRows].sort((a,b) => Number(b.locations)-Number(a.locations)).slice(0,12).map((row) => { const max = Math.max(1, Number(strongestState?.locations || 1)); return <div className="cc2-bar-row" key={row.state}><span>{row.state}</span><div className="cc2-bar-track"><div className="cc2-bar" style={{width:`${Math.max(2,(Number(row.locations||0)/max)*100)}%`}} /></div><b>{Number(row.locations || 0).toLocaleString()}</b></div>; })}</div></div>
                  <div className="cc2-panel"><h3>Most documented services</h3><div className="cc2-bars">{(insights.services || []).slice(0,12).map((row:any) => { const max = Math.max(1, Number(insights.services?.[0]?.locations || 1)); return <div className="cc2-bar-row" key={row.service}><span title={row.service}>{row.service}</span><div className="cc2-bar-track"><div className="cc2-bar" style={{width:`${Math.max(2,(Number(row.locations||0)/max)*100)}%`}} /></div><b>{Number(row.locations || 0).toLocaleString()}</b></div>; })}</div></div>
                  <div className="cc2-panel"><h3>Largest provider organizations</h3><div className="cc2-tablebox"><table className="cc2-table" style={{minWidth:0}}><thead><tr><th>Organization</th><th>Locations</th><th>Active</th><th>Countries</th></tr></thead><tbody>{(insights.organizations || []).slice(0,12).map((row:any) => <tr key={row.organization}><td>{row.organization}</td><td>{row.locations}</td><td>{row.active}</td><td>{row.countries}</td></tr>)}</tbody></table></div></div>
                </div>
              </div>
            )}

            {view === "gaps" && (
              <div className="cc2-scroll">
                <div className="cc2-section-head"><div><h1>U.S. Coverage Gaps</h1><p>Network-presence analysis across all 50 states and DC. This measures the Occu-Med network footprint and documented capabilities; it is not population-adjusted market sufficiency.</p></div></div>
                <div className="cc2-stats"><Stat label="Zero-Presence States / DC" value={zeroStates.toLocaleString()} /><Stat label="Critical or Limited" value={limitedStates.toLocaleString()} /><Stat label="Strongest Footprint" value={strongestState?.state || "—"} helper={`${Number(strongestState?.locations || 0).toLocaleString()} locations`} /><Stat label="Filtered Active Rate" value={percent(insights.summary?.active, insights.summary?.locations)} /></div>
                <div className="cc2-tablebox"><table className="cc2-table"><thead><tr><th>State</th><th>Network Presence</th><th>Locations</th><th>Active Agreements</th><th>Active Rate</th><th>Service Tagged</th><th>Cities</th><th>GPS Ready</th></tr></thead><tbody>{gapRows.map((row:any) => <tr key={row.state}><td>{row.state}</td><td><span className={`cc2-gap ${row.gap.rank===0?"zero":row.gap.rank===1?"critical":row.gap.rank===2?"limited":row.gap.rank===3?"moderate":"strong"}`}>{row.gap.label}</span></td><td>{Number(row.locations || 0).toLocaleString()}</td><td>{Number(row.active || 0).toLocaleString()}</td><td>{percent(row.active,row.locations)}</td><td>{Number(row.service_tagged || 0).toLocaleString()}</td><td>{Number(row.cities || 0).toLocaleString()}</td><td>{Number(row.gps_ready || 0).toLocaleString()}</td></tr>)}</tbody></table></div>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
