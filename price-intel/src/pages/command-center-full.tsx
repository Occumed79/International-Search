import { useEffect, useMemo, useState } from "react";
import {
  Activity, BadgeCheck, Building2, Database, DollarSign, Download, FileCheck2, MapPin,
  Search, ShieldCheck, SlidersHorizontal, Stethoscope, X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import occuMedLogoDataUrl from "@/assets/occu-med-logo-data";
import { CommandCenterMap, type CommandCenterMapPoint } from "@/components/command-center-map";

type View = "directory" | "map" | "coverage" | "organizations" | "pricing" | "availability" | "quality" | "sourceAudit";

type Provider = {
  id: number; externalId?: number | null; name: string; organizationName?: string | null; siteName?: string | null;
  facilityType?: string | null; networkStatus?: string | null; visible?: boolean | null; country?: string | null;
  stateRegion?: string | null; city?: string | null; address?: string | null; postalCode?: string | null;
  latitude?: number | null; longitude?: number | null; phone?: string | null; services?: string[];
  lastAppointment?: string | null; pricingAvailable?: boolean; activity2026?: string | null; sourceStatus?: string | null;
};

type Intelligence = {
  pricingCount: number; availabilityCount: number;
  pricing: Array<{ componentName: string; numericPrice: number | null; sourcePriceText?: string; effectiveDate?: string; expirationDate?: string }>;
  availability: Array<{ componentName: string; componentType?: string }>;
};

type Stats = {
  total: number; activeAgreements: number; serviceTagged: number; gpsReady: number;
  pricingRecords: number; availabilityLinks: number; pricedClinics: number; availabilityClinics: number;
};

const EMPTY_STATS: Stats = { total: 0, activeAgreements: 0, serviceTagged: 0, gpsReady: 0, pricingRecords: 0, availabilityLinks: 0, pricedClinics: 0, availabilityClinics: 0 };

const VIEW_META: Record<View, { label: string; title: string; subtitle: string }> = {
  directory: { label: "Directory", title: "All Clinics", subtitle: "Every physical clinic site remains its own record." },
  map: { label: "Map", title: "All Clinics", subtitle: "Individual provider locations with no entity collapsing." },
  coverage: { label: "Coverage", title: "All Clinics", subtitle: "Service coverage by geography across the filtered network." },
  organizations: { label: "Organizations", title: "All Clinics", subtitle: "Analytical organization rollups while preserving each physical clinic." },
  pricing: { label: "Pricing", title: "Pricing", subtitle: "Latest known clinic-level pricing line items." },
  availability: { label: "Line Item Availability", title: "Line Item Service Availability", subtitle: "Explicit clinic-level service availability; not inferred from pricing." },
  quality: { label: "Data Quality", title: "Data Quality", subtitle: "Completeness and reconciliation checks across the provider network." },
  sourceAudit: { label: "Source Audit", title: "Source Audit", subtitle: "Live dataset counts, load state, and source reconciliation." },
};

const STATUS_OPTIONS = ["All Statuses", "Active Agreement", "Expired", "No Agreement Date", "No Agreement / Unmatched", "2026 New / Unreconciled"];
const VISIBILITY_OPTIONS = [
  { value: "all", label: "All Visibility" }, { value: "visible", label: "Visible Only" },
  { value: "hidden", label: "Hidden Only" }, { value: "unknown", label: "Unknown Visibility" },
];
const ACTIVITY_OPTIONS = [
  { value: "all", label: "All Records" }, { value: "new", label: "New in 2026" },
  { value: "updated", label: "Updated in 2026" }, { value: "any", label: "Any 2026 Activity" },
  { value: "none", label: "No 2026 Activity" },
];
const GROUP_OPTIONS = [
  { value: "org", label: "Organization / Network" }, { value: "facility", label: "Facility Type" },
  { value: "state", label: "State / Region" }, { value: "city", label: "City" },
  { value: "country", label: "Country" }, { value: "name", label: "Organization / Network Name" },
  { value: "status", label: "Network Status" },
];
const SORT_OPTIONS = [
  { value: "name", label: "Clinic Name" }, { value: "city", label: "City" }, { value: "state", label: "State / Region" },
  { value: "facility", label: "Facility Type" }, { value: "lastAppointment", label: "Last Appointment" },
];

function money(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(number);
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
  anchor.href = url; anchor.download = filename; anchor.click();
  URL.revokeObjectURL(url);
}

function groupKey(provider: Provider, groupBy: string) {
  if (groupBy === "facility") return provider.facilityType || "Facility type not listed";
  if (groupBy === "state") return provider.stateRegion || "State / region not listed";
  if (groupBy === "city") return provider.city || "City not listed";
  if (groupBy === "country") return provider.country || "Country not listed";
  if (groupBy === "name") return provider.organizationName || provider.name || "Name not listed";
  if (groupBy === "status") return provider.networkStatus || "Status not listed";
  return provider.organizationName || provider.name || "Organization not listed";
}

function providerStatusClass(status?: string | null) {
  if (status === "Active Agreement") return "ccf-tag-active";
  if (status === "Expired") return "ccf-tag-expired";
  if (status?.includes("2026")) return "ccf-tag-new";
  return "ccf-tag-unmatched";
}

export function CommandCenterFull() {
  const { toast } = useToast();
  const [view, setView] = useState<View>("directory");
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
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

  const [directory, setDirectory] = useState<Provider[]>([]);
  const [snapshot, setSnapshot] = useState<any>({});
  const [selected, setSelected] = useState<Provider | null>(null);
  const [intelligence, setIntelligence] = useState<Intelligence | null>(null);
  const [loading, setLoading] = useState(false);
  const [intelLoading, setIntelLoading] = useState(false);

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

  const [quality, setQuality] = useState<any>({ summary: {}, statuses: [] });
  const [sourceAudit, setSourceAudit] = useState<any>({ datasetState: [], live: {} });

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
    void (async () => {
      try {
        const [networkRes, intelligenceRes, optionsRes] = await Promise.all([
          fetch("/api/network/stats"), fetch("/api/network/intelligence-stats"), fetch("/api/command-center/options"),
        ]);
        const network = networkRes.ok ? await networkRes.json() : {};
        const intel = intelligenceRes.ok ? await intelligenceRes.json() : {};
        const nextOptions = optionsRes.ok ? await optionsRes.json() : {};
        setStats({ ...EMPTY_STATS, ...network, ...intel });
        setOptions((current: any) => ({ ...current, ...nextOptions }));
      } catch {
        // Individual views surface their own errors if the database is temporarily unavailable.
      }
    })();
  }, []);

  useEffect(() => {
    if (view !== "directory") return;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void fetch(`/api/command-center/directory?${commonQuery}${commonQuery ? "&" : ""}sort=${encodeURIComponent(sortBy)}&limit=1200`)
        .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); return body; })
        .then((body) => {
          setDirectory(Array.isArray(body.results) ? body.results : []);
          setSnapshot(body.snapshot || {});
          setSelected((current) => current && body.results?.some((row: Provider) => row.id === current.id) ? current : body.results?.[0] || null);
        })
        .catch((error) => toast({ title: "Directory could not be loaded", description: error.message, variant: "destructive" }))
        .finally(() => setLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [view, commonQuery, sortBy, toast]);

  useEffect(() => {
    if (!selected?.externalId) { setIntelligence(null); return; }
    setIntelLoading(true);
    void fetch(`/api/network/intelligence/${selected.externalId}`)
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); return body; })
      .then(setIntelligence)
      .catch(() => setIntelligence(null))
      .finally(() => setIntelLoading(false));
  }, [selected?.externalId]);

  useEffect(() => {
    if (view !== "coverage") return;
    setLoading(true);
    void fetch(`/api/command-center/coverage?${commonQuery}${commonQuery ? "&" : ""}geo=${coverageGeo}`)
      .then((r) => r.json()).then(setCoverage).finally(() => setLoading(false));
  }, [view, commonQuery, coverageGeo]);

  useEffect(() => {
    if (view !== "organizations") return;
    const params = new URLSearchParams(commonQuery); if (orgSearch) params.set("orgSearch", orgSearch);
    setLoading(true);
    void fetch(`/api/command-center/organizations?${params.toString()}`)
      .then((r) => r.json()).then((body) => setOrganizations(Array.isArray(body.rows) ? body.rows : [])).finally(() => setLoading(false));
  }, [view, commonQuery, orgSearch]);

  useEffect(() => {
    if (view !== "pricing") return;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (pricingSearch) params.set("q", pricingSearch); if (pricingNetwork) params.set("network", pricingNetwork);
      if (pricingState) params.set("state", pricingState); if (pricingComponent) params.set("component", pricingComponent);
      if (pricingValue) params.set("valueMode", pricingValue);
      setLoading(true);
      void fetch(`/api/command-center/pricing?${params.toString()}`).then((r) => r.json()).then(setPricing).finally(() => setLoading(false));
    }, 160);
    return () => window.clearTimeout(timer);
  }, [view, pricingSearch, pricingNetwork, pricingState, pricingComponent, pricingValue]);

  useEffect(() => {
    if (view !== "availability") return;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (availabilitySearch) params.set("q", availabilitySearch); if (availabilityNetwork) params.set("network", availabilityNetwork);
      if (availabilityState) params.set("state", availabilityState); if (availabilityType) params.set("type", availabilityType);
      if (availabilityComponent) params.set("component", availabilityComponent);
      setLoading(true);
      void fetch(`/api/command-center/availability?${params.toString()}`).then((r) => r.json()).then(setAvailability).finally(() => setLoading(false));
    }, 160);
    return () => window.clearTimeout(timer);
  }, [view, availabilitySearch, availabilityNetwork, availabilityState, availabilityType, availabilityComponent]);

  useEffect(() => {
    if (view === "quality") void fetch("/api/command-center/quality").then((r) => r.json()).then(setQuality);
    if (view === "sourceAudit") void fetch("/api/command-center/source-audit").then((r) => r.json()).then(setSourceAudit);
  }, [view]);

  const grouped = useMemo(() => {
    const map = new Map<string, Provider[]>();
    for (const provider of directory) {
      const key = groupKey(provider, groupBy);
      const list = map.get(key) || []; list.push(provider); map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [directory, groupBy]);

  const toggleService = (service: string) => setSelectedServices((current) => current.includes(service) ? current.filter((item) => item !== service) : [...current, service]);
  const clearFilters = () => {
    setNameSearch(""); setDetailsSearch(""); setStatus("All Statuses"); setVisibility("all"); setActivity("all");
    setCountry("All Countries"); setStateRegion("All States / Regions"); setFacility("All Facility Types"); setSelectedServices([]);
  };

  const selectMapPoint = (point: CommandCenterMapPoint) => {
    setSelected({ ...point, services: point.services || [] });
    setView("directory");
    setNameSearch(point.name);
  };

  const meta = VIEW_META[view];
  const topServices = Array.isArray(options.services) ? options.services.slice(0, 18) : [];

  return (
    <div className="ccf-page">
      <style>{`
        .ccf-page{--ink:#152233;--muted:#6b7b8d;--blue:#397ec1;--line:rgba(255,255,255,.96);--glass:rgba(255,255,255,.69);height:100%;min-height:0;overflow:hidden;color:var(--ink);background:radial-gradient(circle at 8% 0%,rgba(163,207,237,.34),transparent 26%),linear-gradient(180deg,#f9fbfd,#e4ecf2);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.ccf-page *{box-sizing:border-box}.ccf-glass{background:var(--glass);border:1px solid var(--line);box-shadow:0 16px 45px rgba(48,65,88,.12),0 3px 12px rgba(48,65,88,.06);backdrop-filter:blur(24px) saturate(1.15)}
        .ccf-app{height:100%;padding:12px;display:grid;grid-template-columns:310px minmax(0,1fr);gap:12px;overflow:hidden}.ccf-side{border-radius:28px;padding:15px;overflow:auto;min-height:0}.ccf-brand{padding:13px;border:1px solid white;border-radius:21px;background:rgba(255,255,255,.68);text-align:center}.ccf-brand img{width:132px;max-width:72%;filter:invert(1);opacity:.9}.ccf-brand h2{font-size:16px;margin:6px 0 0}.ccf-brand p{font-size:9.5px;line-height:1.45;color:var(--muted);margin:4px 0 0}.ccf-label{font-size:9px;letter-spacing:.15em;text-transform:uppercase;color:#728196;font-weight:850;margin:15px 4px 7px}.ccf-field{margin-top:7px}.ccf-field label{display:block;font-size:9.5px;color:var(--muted);margin:0 0 4px 4px}.ccf-field input,.ccf-field select,.ccf-search{width:100%;height:39px;border:1px solid white;border-radius:12px;background:rgba(255,255,255,.76);padding:0 11px;color:var(--ink);outline:none;font-size:11px}.ccf-note{font-size:8.5px;color:#748397;line-height:1.35;margin:6px 5px}.ccf-services{display:flex;gap:5px;flex-wrap:wrap}.ccf-chip{border:1px solid white;background:rgba(255,255,255,.68);border-radius:999px;padding:6px 8px;font-size:8.5px;color:#566779;cursor:pointer}.ccf-chip.on{background:#e6f2fb;color:#265e89;border-color:#bdd9ec}.ccf-mode{display:flex;align-items:center;justify-content:space-between;font-size:9px;color:var(--muted);margin-bottom:7px}.ccf-mode button{border:0;background:transparent;color:#397ec1;font-size:9px;font-weight:800;cursor:pointer}.ccf-clear{width:100%;height:34px;border:1px solid white;border-radius:11px;background:rgba(255,255,255,.58);color:#607185;font-size:9.5px;font-weight:750;cursor:pointer;margin-top:10px}.ccf-mini{display:grid;grid-template-columns:1fr 1fr;gap:6px}.ccf-mini div{padding:9px;border:1px solid white;border-radius:13px;background:rgba(255,255,255,.56)}.ccf-mini b{display:block;font-size:15px}.ccf-mini span{font-size:7.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
        .ccf-main{min-width:0;min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr);gap:11px}.ccf-top{border-radius:27px;padding:14px 16px;display:grid;grid-template-columns:minmax(200px,1fr) auto;gap:12px;align-items:center}.ccf-heading{display:flex;align-items:center;gap:22px}.ccf-heading h1{font-size:23px;line-height:1.03;margin:0;letter-spacing:-.045em}.ccf-heading p{font-size:9.5px;color:var(--muted);margin:5px 0 0;max-width:390px}.ccf-kpis{display:grid;grid-template-columns:repeat(2,minmax(100px,1fr));gap:6px;min-width:250px}.ccf-kpi{padding:8px 10px;border:1px solid white;border-radius:14px;background:rgba(255,255,255,.58)}.ccf-kpi b{display:block;font-size:16px}.ccf-kpi span{font-size:7.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.ccf-tabs{grid-column:1/-1;display:flex;justify-content:flex-end;gap:4px;overflow-x:auto;padding-top:2px}.ccf-tabs button{border:0;background:transparent;border-radius:12px;min-height:33px;padding:0 11px;font-size:9.5px;color:#617184;font-weight:800;white-space:nowrap;cursor:pointer}.ccf-tabs button.on{background:rgba(255,255,255,.94);color:#152233;box-shadow:0 4px 12px rgba(48,65,88,.08)}
        .ccf-work{border-radius:27px;overflow:hidden;min-height:0;height:100%;background:rgba(255,255,255,.48);border:1px solid white;box-shadow:0 14px 42px rgba(48,65,88,.10)}.ccf-scroll{height:100%;overflow:auto;padding:12px}.ccf-dir{height:100%;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 350px}.ccf-dir-main{min-width:0;min-height:0;overflow:auto;border-right:1px solid white;padding:11px}.ccf-toolbar{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:9px}.ccf-soft{display:inline-flex;align-items:center;gap:5px;padding:6px 9px;border:1px solid white;border-radius:999px;background:rgba(255,255,255,.66);font-size:8.8px;color:#607185}.ccf-export{border:1px solid white;background:rgba(255,255,255,.76);border-radius:10px;height:31px;padding:0 9px;font-size:8.8px;font-weight:800;color:#53677c;cursor:pointer}.ccf-group{border:1px solid rgba(255,255,255,.9);background:rgba(255,255,255,.34);border-radius:17px;margin-bottom:8px;overflow:hidden}.ccf-group-head{padding:9px 11px;border-bottom:1px solid white;background:rgba(255,255,255,.58)}.ccf-group-head b{font-size:11px}.ccf-group-head span{display:block;font-size:8px;color:var(--muted);margin-top:2px}.ccf-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:7px;padding:8px}.ccf-card{border:1px solid white;background:rgba(255,255,255,.78);border-radius:14px;padding:10px;text-align:left;color:var(--ink);cursor:pointer;box-shadow:0 4px 12px rgba(48,65,88,.05);transition:transform .14s ease,box-shadow .14s ease}.ccf-card:hover{transform:translateY(-2px);box-shadow:0 9px 20px rgba(48,65,88,.10)}.ccf-card.on{outline:2px solid rgba(57,126,193,.28)}.ccf-card b{display:block;font-size:11px;line-height:1.3}.ccf-sub{font-size:8.7px;color:var(--muted);margin-top:3px}.ccf-tagrow{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}.ccf-tag{font-size:7.7px;border-radius:999px;padding:3px 6px;border:1px solid}.ccf-tag-active{color:#306a5c;background:#e6f3ef;border-color:#cce5dc}.ccf-tag-expired{color:#8b424c;background:#f7ebed;border-color:#ecd4d8}.ccf-tag-new{color:#2d678f;background:#e9f3fa;border-color:#cee2f0}.ccf-tag-unmatched{color:#87612c;background:#f9f0df;border-color:#ead9b9}.ccf-detail{min-height:0;overflow:auto;padding:12px}.ccf-detail-hero,.ccf-detail-card{border:1px solid white;background:rgba(255,255,255,.68);border-radius:17px;padding:12px;margin-bottom:8px}.ccf-detail-hero h3{font-size:17px;line-height:1.25;margin:0}.ccf-detail-hero p{font-size:9.5px;color:var(--muted);margin:5px 0 0}.ccf-detail-card h4{font-size:8px;letter-spacing:.13em;text-transform:uppercase;color:#748397;margin:0 0 8px}.ccf-kv{display:grid;grid-template-columns:82px 1fr;gap:5px 8px;font-size:9px;line-height:1.35}.ccf-kv .k{color:#8090a1}.ccf-line{padding:6px 0;border-top:1px solid rgba(128,145,162,.15);font-size:8.8px}.ccf-line:first-of-type{border-top:0}.ccf-price{font-weight:850;color:#2f688f}.ccf-empty{height:100%;display:grid;place-items:center;text-align:center;color:#6d7d90}.ccf-empty svg{width:32px;height:32px;margin:0 auto 10px}.ccf-empty b{display:block;color:#405166;font-size:13px;margin-bottom:4px}
        .ccf-analysis{height:100%;overflow:auto;padding:12px}.ccf-analysis-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:9px}.ccf-analysis-head h3{font-size:15px;margin:0}.ccf-analysis-head p{font-size:8.8px;color:var(--muted);margin:3px 0 0}.ccf-analysis-head input,.ccf-analysis-head select{height:33px;border:1px solid white;border-radius:10px;background:rgba(255,255,255,.72);padding:0 10px;font-size:9px;color:var(--ink)}.ccf-panel-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin:9px 0}.ccf-panel{border:1px solid white;background:rgba(255,255,255,.65);border-radius:14px;padding:11px}.ccf-panel b{display:block;font-size:18px}.ccf-panel span{font-size:7.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.ccf-filters{display:grid;grid-template-columns:minmax(180px,1.3fr) repeat(4,minmax(120px,1fr));gap:6px;margin:8px 0}.ccf-filters input,.ccf-filters select{height:34px;border:1px solid white;border-radius:10px;background:rgba(255,255,255,.72);padding:0 9px;font-size:8.8px;color:var(--ink);min-width:0}.ccf-tablebox{border:1px solid white;border-radius:15px;overflow:auto;background:rgba(255,255,255,.45)}.ccf-table{width:100%;border-collapse:collapse;font-size:8.4px;min-width:800px}.ccf-table th{position:sticky;top:0;z-index:1;background:rgba(246,249,252,.96);text-align:left;color:#607185;font-weight:850}.ccf-table th,.ccf-table td{padding:7px 8px;border-bottom:1px solid #d9e2e9;vertical-align:top}.ccf-table td:first-child{font-weight:750}.ccf-source{padding:8px 10px;border:1px solid #d6e6f0;background:#edf6fb;border-radius:11px;font-size:8.4px;color:#567084;margin:8px 0}.ccf-quality-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.ccf-loader{display:flex;align-items:center;gap:6px;font-size:9px;color:#6b7b8d}
        @media(max-width:1100px){.ccf-app{grid-template-columns:265px minmax(0,1fr)}.ccf-dir{grid-template-columns:minmax(0,1fr) 310px}.ccf-filters{grid-template-columns:1fr 1fr}.ccf-panel-grid,.ccf-quality-grid{grid-template-columns:1fr 1fr}}
        @media(max-width:850px){.ccf-app{display:block;overflow:auto}.ccf-side{margin-bottom:10px;max-height:none}.ccf-main{height:950px}.ccf-top{grid-template-columns:1fr}.ccf-tabs{justify-content:flex-start}.ccf-dir{grid-template-columns:1fr}.ccf-detail{display:none}}
      `}</style>

      <div className="ccf-app">
        <aside className="ccf-side ccf-glass">
          <div className="ccf-brand">
            <img src={occuMedLogoDataUrl} alt="Occu-Med" />
            <h2>Network Command Center</h2>
            <p>All clinics · 2026 additions · service/pricing intelligence · GPS coverage</p>
          </div>

          <div className="ccf-label">Clinic / Network Search</div>
          <div className="ccf-field"><input value={nameSearch} onChange={(e) => setNameSearch(e.target.value)} placeholder="Clinic or network name — GoHealth, Concentra…" /></div>
          <div className="ccf-note"><b>Name search shows the entire network.</b> It overrides status, service, and geography filters.</div>

          <div className="ccf-label">Location / Details Search</div>
          <div className="ccf-field"><input value={detailsSearch} onChange={(e) => setDetailsSearch(e.target.value)} placeholder="City, address, ZIP, phone, service…" /></div>
          <div className="ccf-field"><label>Network Status</label><select value={status} onChange={(e) => setStatus(e.target.value)}>{STATUS_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></div>
          <div className="ccf-field"><label>Visibility</label><select value={visibility} onChange={(e) => setVisibility(e.target.value)}>{VISIBILITY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
          <div className="ccf-field"><label>2026 Activity</label><select value={activity} onChange={(e) => setActivity(e.target.value)}>{ACTIVITY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>

          <div className="ccf-label">Documented Services</div>
          <div className="ccf-mode"><span>Match {serviceMode.toUpperCase()} selected service{selectedServices.length === 1 ? "" : "s"}</span><button type="button" onClick={() => setServiceMode((current) => current === "any" ? "all" : "any")}>Switch to {serviceMode === "any" ? "ALL" : "ANY"}</button></div>
          <div className="ccf-services">{topServices.map((item: any) => <button key={item.value} type="button" className={`ccf-chip ${selectedServices.includes(item.value) ? "on" : ""}`} onClick={() => toggleService(item.value)}>{item.value} {Number(item.count || 0).toLocaleString()}</button>)}</div>

          <div className="ccf-label">Geography & Facility</div>
          <div className="ccf-field"><label>Country</label><select value={country} onChange={(e) => { setCountry(e.target.value); setStateRegion("All States / Regions"); }}><option>All Countries</option>{options.countries?.map((item: any) => <option key={item.value}>{item.value}</option>)}</select></div>
          <div className="ccf-field"><label>State / Region</label><select value={stateRegion} onChange={(e) => setStateRegion(e.target.value)}><option>All States / Regions</option>{options.states?.map((item: any) => <option key={item.value}>{item.value}</option>)}</select></div>
          <div className="ccf-field"><label>Facility Type</label><select value={facility} onChange={(e) => setFacility(e.target.value)}><option>All Facility Types</option>{options.facilities?.map((item: any) => <option key={item.value}>{item.value}</option>)}</select></div>

          <div className="ccf-label">Organize Directory</div>
          <div className="ccf-field"><label>Group By</label><select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>{GROUP_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
          <div className="ccf-field"><label>Sort By</label><select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>{SORT_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
          <button type="button" className="ccf-clear" onClick={clearFilters}><X className="inline w-3 h-3 mr-1" />Clear All Filters</button>

          <div className="ccf-label">Filtered Snapshot</div>
          <div className="ccf-mini">
            <div><b>{Number(snapshot.total ?? stats.total).toLocaleString()}</b><span>Locations</span></div>
            <div><b>{Number(snapshot.cities ?? 0).toLocaleString()}</b><span>Cities</span></div>
            <div><b>{Number(snapshot.countries ?? 0).toLocaleString()}</b><span>Countries</span></div>
            <div><b>{Number(snapshot.gps_ready ?? stats.gpsReady).toLocaleString()}</b><span>GPS Ready</span></div>
          </div>
        </aside>

        <main className="ccf-main">
          <header className="ccf-top ccf-glass">
            <div className="ccf-heading">
              <div><h1>{meta.title}</h1><p>{meta.subtitle}</p></div>
              <div className="ccf-kpis">
                <div className="ccf-kpi"><b>{stats.total.toLocaleString()}</b><span>Visible Results</span></div>
                <div className="ccf-kpi"><b>{stats.activeAgreements.toLocaleString()}</b><span>Active Agreements</span></div>
                <div className="ccf-kpi"><b>{stats.serviceTagged.toLocaleString()}</b><span>Service-Tagged</span></div>
                <div className="ccf-kpi"><b>{stats.gpsReady.toLocaleString()}</b><span>GPS Coordinates</span></div>
              </div>
            </div>
            <div className="ccf-tabs">
              {(Object.keys(VIEW_META) as View[]).map((key) => <button key={key} type="button" className={view === key ? "on" : ""} onClick={() => setView(key)}>{VIEW_META[key].label}</button>)}
            </div>
          </header>

          <section className="ccf-work">
            {view === "directory" && (
              <div className="ccf-dir">
                <div className="ccf-dir-main">
                  <div className="ccf-toolbar">
                    <div><span className="ccf-soft">{Number(snapshot.total ?? directory.length).toLocaleString()} locations</span> <span className="ccf-soft">Grouped by {GROUP_OPTIONS.find((item) => item.value === groupBy)?.label}</span></div>
                    <button type="button" className="ccf-export" onClick={() => exportRows("filtered-provider-directory.csv", directory as unknown as Array<Record<string, unknown>>)}><Download className="inline w-3 h-3 mr-1" />Export Filtered CSV</button>
                  </div>
                  {loading ? <div className="ccf-empty"><div><Activity className="animate-pulse" /><b>Loading provider directory…</b></div></div> : grouped.length === 0 ? <div className="ccf-empty"><div><Search /><b>No matching clinics</b><span>Change the filters or clear them to see the network.</span></div></div> : grouped.map(([group, providers]) => (
                    <div className="ccf-group" key={group}>
                      <div className="ccf-group-head"><b>{group}</b><span>{providers.length.toLocaleString()} location{providers.length === 1 ? "" : "s"}</span></div>
                      <div className="ccf-cards">{providers.map((provider) => (
                        <button key={provider.id} type="button" className={`ccf-card ${selected?.id === provider.id ? "on" : ""}`} onClick={() => setSelected(provider)}>
                          <b>{provider.name}</b>
                          <div className="ccf-sub">{[provider.city, provider.stateRegion, provider.country].filter(Boolean).join(", ") || "Location not listed"}</div>
                          <div className="ccf-tagrow"><span className={`ccf-tag ${providerStatusClass(provider.networkStatus)}`}>{provider.networkStatus || "Status not listed"}</span>{provider.facilityType && <span className="ccf-tag ccf-tag-new">{provider.facilityType}</span>}</div>
                          <div className="ccf-sub">{provider.phone || "No phone listed"}</div>
                        </button>
                      ))}</div>
                    </div>
                  ))}
                </div>
                <ProviderDetail provider={selected} intelligence={intelligence} loading={intelLoading} />
              </div>
            )}

            {view === "map" && <CommandCenterMap filterQuery={commonQuery} onSelect={selectMapPoint} />}

            {view === "coverage" && (
              <div className="ccf-analysis">
                <div className="ccf-analysis-head"><div><h3>Service Coverage Matrix</h3><p>Counts are physical clinic locations with documented capabilities. A zero means no documented match in this data.</p></div><select value={coverageGeo} onChange={(e) => setCoverageGeo(e.target.value)}><option value="state">State / Region</option><option value="country">Country</option><option value="city">City</option></select></div>
                <div className="ccf-panel-grid"><Panel value={coverage.summary?.geographies} label="Geographies" /><Panel value={coverage.summary?.locations} label="Locations" /><Panel value={coverage.summary?.active} label="Active Agreements" /><Panel value={coverage.summary?.service_tagged} label="Service Tagged" /></div>
                <div className="ccf-tablebox"><table className="ccf-table"><thead><tr><th>Geography</th><th>Locations</th><th>Active</th><th>Medical</th><th>Drug Testing</th><th>Laboratory</th><th>Dental</th><th>Hearing</th><th>Imaging</th><th>Vaccinations</th><th>Fit Test</th></tr></thead><tbody>{coverage.rows?.map((row: any) => <tr key={row.geography}><td>{row.geography}</td><td>{row.locations}</td><td>{row.active}</td><td>{row.medical}</td><td>{row.drug_testing}</td><td>{row.laboratory}</td><td>{row.dental}</td><td>{row.hearing}</td><td>{row.imaging}</td><td>{row.vaccinations}</td><td>{row.fit_test}</td></tr>)}</tbody></table></div>
              </div>
            )}

            {view === "organizations" && (
              <div className="ccf-analysis">
                <div className="ccf-analysis-head"><div><h3>Organization Rollup</h3><p>Analytical rollup only. Every underlying physical location remains separate elsewhere in the Command Center.</p></div><input value={orgSearch} onChange={(e) => setOrgSearch(e.target.value)} placeholder="Search organization…" /></div>
                <div className="ccf-tablebox"><table className="ccf-table"><thead><tr><th>Organization / Network</th><th>Locations</th><th>Active</th><th>Countries</th><th>States/Regions</th><th>Cities</th><th>Documented Services</th></tr></thead><tbody>{organizations.map((row) => <tr key={row.organization}><td>{row.organization}</td><td>{row.locations}</td><td>{row.active}</td><td>{row.countries}</td><td>{row.states_regions}</td><td>{row.cities}</td><td>{row.documented_services || "—"}</td></tr>)}</tbody></table></div>
              </div>
            )}

            {view === "pricing" && (
              <div className="ccf-analysis">
                <div className="ccf-analysis-head"><div><h3>Pricing</h3><p>Latest known pricing line item per physical clinic and component; original price text is preserved.</p></div><button type="button" className="ccf-export" onClick={() => exportRows("filtered-pricing.csv", pricing.rows || [])}><Download className="inline w-3 h-3 mr-1" />Export Filtered Pricing CSV</button></div>
                <div className="ccf-filters"><input value={pricingSearch} onChange={(e) => setPricingSearch(e.target.value)} placeholder="Search clinic, network, city, component…" /><select value={pricingNetwork} onChange={(e) => setPricingNetwork(e.target.value)}><option value="">All networks / providers</option>{pricing.options?.networks?.map((item: any) => <option key={item.value}>{item.value}</option>)}</select><select value={pricingState} onChange={(e) => setPricingState(e.target.value)}><option value="">All states</option>{pricing.options?.states?.map((item: any) => <option key={item.value}>{item.value}</option>)}</select><select value={pricingComponent} onChange={(e) => setPricingComponent(e.target.value)}><option value="">All line items</option>{pricing.options?.components?.map((item: any) => <option key={item.value}>{item.value}</option>)}</select><select value={pricingValue} onChange={(e) => setPricingValue(e.target.value)}><option value="">All price records</option><option value="numeric">Numeric prices only</option><option value="text">Non-numeric / text prices</option></select></div>
                <div className="ccf-panel-grid"><Panel value={pricing.stats?.records} label="Matching Price Records" /><Panel value={pricing.stats?.clinics} label="Physical Clinics" /><Panel value={pricing.stats?.line_items} label="Line Items" /><Panel value={money(pricing.stats?.average_numeric_price)} label="Average Numeric Price" /></div>
                <div className="ccf-source">Pricing is clinic + line-item intelligence. Service availability remains a separate explicit dataset.</div>
                <div className="ccf-tablebox"><table className="ccf-table"><thead><tr><th>Network / Provider</th><th>Physical Clinic</th><th>Location</th><th>Line Item</th><th>Latest Price</th><th>Effective</th><th>Expires</th><th>Line Item Created</th></tr></thead><tbody>{pricing.rows?.map((row: any) => <tr key={row.id}><td>{row.network_name || "—"}</td><td>{row.site_name || "—"}</td><td>{[row.city, row.state_region, row.postal_code].filter(Boolean).join(", ")}</td><td>{row.component_name}</td><td className="ccf-price">{row.numeric_price == null ? row.source_price_text || "—" : money(row.numeric_price)}</td><td>{row.effective_date || "—"}</td><td>{row.expiration_date || "—"}</td><td>{row.line_item_created || "—"}</td></tr>)}</tbody></table></div>
              </div>
            )}

            {view === "availability" && (
              <div className="ccf-analysis">
                <div className="ccf-analysis-head"><div><h3>Line Item Service Availability</h3><p>Explicit clinic-component availability. Availability is not inferred from whether a price exists.</p></div><button type="button" className="ccf-export" onClick={() => exportRows("filtered-availability.csv", availability.rows || [])}><Download className="inline w-3 h-3 mr-1" />Export Filtered Availability CSV</button></div>
                <div className="ccf-filters"><input value={availabilitySearch} onChange={(e) => setAvailabilitySearch(e.target.value)} placeholder="Search service, clinic, network, city…" /><select value={availabilityNetwork} onChange={(e) => setAvailabilityNetwork(e.target.value)}><option value="">All networks / providers</option>{availability.options?.networks?.map((item: any) => <option key={item.value}>{item.value}</option>)}</select><select value={availabilityState} onChange={(e) => setAvailabilityState(e.target.value)}><option value="">All states</option>{availability.options?.states?.map((item: any) => <option key={item.value}>{item.value}</option>)}</select><select value={availabilityType} onChange={(e) => setAvailabilityType(e.target.value)}><option value="">All component types</option>{availability.options?.types?.map((item: any) => <option key={item.value}>{item.value}</option>)}</select><select value={availabilityComponent} onChange={(e) => setAvailabilityComponent(e.target.value)}><option value="">All line items</option>{availability.options?.components?.map((item: any) => <option key={item.value}>{item.value}</option>)}</select></div>
                <div className="ccf-panel-grid"><Panel value={availability.stats?.records} label="Availability Links" /><Panel value={availability.stats?.clinics} label="Physical Clinics" /><Panel value={availability.stats?.line_items} label="Available Line Items" /><Panel value={availability.stats?.component_types} label="Component Types" /></div>
                <div className="ccf-source">Explicit service availability is reported independently from pricing records.</div>
                <div className="ccf-tablebox"><table className="ccf-table"><thead><tr><th>Line Item / Service</th><th>Component Type</th><th>Network / Provider</th><th>Physical Clinic</th><th>Location</th><th>Phone</th></tr></thead><tbody>{availability.rows?.map((row: any) => <tr key={row.id}><td>{row.component_name}</td><td>{row.component_type || "—"}</td><td>{row.network_name || "—"}</td><td>{row.site_name || "—"}</td><td>{[row.city, row.state_region, row.postal_code].filter(Boolean).join(", ")}</td><td>{row.phone || "—"}</td></tr>)}</tbody></table></div>
              </div>
            )}

            {view === "quality" && (
              <div className="ccf-analysis">
                <div className="ccf-analysis-head"><div><h3>Data Quality</h3><p>Completeness checks against the live provider snapshot.</p></div><ShieldCheck className="w-5 h-5 text-slate-500" /></div>
                <div className="ccf-quality-grid"><Panel value={quality.summary?.total} label="Total Locations" /><Panel value={quality.summary?.missing_coordinates} label="Missing Coordinates" /><Panel value={quality.summary?.missing_address} label="Missing Address" /><Panel value={quality.summary?.missing_phone} label="Missing Phone" /><Panel value={quality.summary?.missing_services} label="No Documented Services" /><Panel value={quality.summary?.hidden} label="Hidden Locations" /><Panel value={quality.summary?.unknown_visibility} label="Unknown Visibility" /><Panel value={quality.summary?.missing_organization} label="Missing Organization" /></div>
                <div className="ccf-tablebox" style={{ marginTop: 10 }}><table className="ccf-table"><thead><tr><th>Network Status</th><th>Locations</th></tr></thead><tbody>{quality.statuses?.map((row: any) => <tr key={row.label}><td>{row.label}</td><td>{Number(row.count).toLocaleString()}</td></tr>)}</tbody></table></div>
              </div>
            )}

            {view === "sourceAudit" && (
              <div className="ccf-analysis">
                <div className="ccf-analysis-head"><div><h3>Source Audit</h3><p>Reconcile the published dataset state with the live database tables.</p></div><FileCheck2 className="w-5 h-5 text-slate-500" /></div>
                <div className="ccf-panel-grid"><Panel value={sourceAudit.live?.providers?.count} label="Live Providers" /><Panel value={sourceAudit.live?.pricing?.count} label="Live Pricing Rows" /><Panel value={sourceAudit.live?.availability?.count} label="Live Availability Rows" /><Panel value={sourceAudit.datasetState?.[0]?.loaded_at ? new Date(sourceAudit.datasetState[0].loaded_at).toLocaleDateString() : "—"} label="Dataset Loaded" /></div>
                <div className="ccf-tablebox"><table className="ccf-table"><thead><tr><th>Dataset</th><th>Source Hash</th><th>Providers</th><th>Pricing</th><th>Availability</th><th>Loaded At</th></tr></thead><tbody>{sourceAudit.datasetState?.map((row: any) => <tr key={`${row.dataset_key}-${row.loaded_at}`}><td>{row.dataset_key}</td><td>{String(row.source_sha256 || "").slice(0, 18)}…</td><td>{Number(row.provider_count || 0).toLocaleString()}</td><td>{Number(row.pricing_count || 0).toLocaleString()}</td><td>{Number(row.availability_count || 0).toLocaleString()}</td><td>{row.loaded_at ? new Date(row.loaded_at).toLocaleString() : "—"}</td></tr>)}</tbody></table></div>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

function Panel({ value, label }: { value: unknown; label: string }) {
  const shown = typeof value === "number" ? value.toLocaleString() : value == null || value === "" ? "—" : String(value);
  return <div className="ccf-panel"><b>{shown}</b><span>{label}</span></div>;
}

function ProviderDetail({ provider, intelligence, loading }: { provider: Provider | null; intelligence: Intelligence | null; loading: boolean }) {
  if (!provider) return <aside className="ccf-detail"><div className="ccf-empty"><div><Stethoscope /><b>Provider details</b><span>Select a clinic to inspect its documented information.</span></div></div></aside>;
  return (
    <aside className="ccf-detail">
      <div className="ccf-detail-hero"><h3>{provider.name}</h3><p>{[provider.city, provider.stateRegion, provider.country].filter(Boolean).join(", ") || "Location not listed"}</p><div className="ccf-tagrow"><span className={`ccf-tag ${providerStatusClass(provider.networkStatus)}`}>{provider.networkStatus || "Status not listed"}</span>{provider.facilityType && <span className="ccf-tag ccf-tag-new">{provider.facilityType}</span>}</div></div>
      <div className="ccf-detail-card"><h4>Contact & Location</h4><div className="ccf-kv"><span className="k">Organization</span><span>{provider.organizationName || "—"}</span><span className="k">Address</span><span>{[provider.address, provider.postalCode].filter(Boolean).join(" ") || "—"}</span><span className="k">Phone</span><span>{provider.phone || "—"}</span><span className="k">Coordinates</span><span>{provider.latitude != null && provider.longitude != null ? `${provider.latitude}, ${provider.longitude}` : "Not available"}</span></div></div>
      <div className="ccf-detail-card"><h4>Documented Capabilities</h4><div className="ccf-tagrow">{provider.services?.length ? provider.services.slice(0, 40).map((service) => <span key={service} className="ccf-tag ccf-tag-new">{service}</span>) : <span className="ccf-sub">No documented services listed.</span>}</div></div>
      <div className="ccf-detail-card"><h4>Network / Agreement</h4><div className="ccf-kv"><span className="k">Status</span><span>{provider.networkStatus || "—"}</span><span className="k">Visibility</span><span>{provider.visible == null ? "Unknown" : provider.visible ? "Visible" : "Hidden"}</span><span className="k">2026 Activity</span><span>{provider.activity2026 || "—"}</span><span className="k">Last Appt.</span><span>{provider.lastAppointment || "—"}</span></div></div>
      <div className="ccf-detail-card"><h4>Pricing & Availability</h4>{loading ? <div className="ccf-loader"><Activity className="w-3 h-3 animate-pulse" />Loading documented line items…</div> : intelligence ? <><div className="ccf-kv"><span className="k">Pricing rows</span><span>{intelligence.pricingCount.toLocaleString()}</span><span className="k">Availability</span><span>{intelligence.availabilityCount.toLocaleString()}</span></div>{intelligence.pricing.slice(0, 12).map((row, index) => <div className="ccf-line" key={`${row.componentName}-${index}`}><b>{row.componentName}</b><br /><span className="ccf-price">{row.numericPrice == null ? row.sourcePriceText || "Price text only" : money(row.numericPrice)}</span></div>)}{intelligence.availability.slice(0, 16).map((row, index) => <div className="ccf-line" key={`${row.componentName}-a-${index}`}>{row.componentName}{row.componentType ? ` · ${row.componentType}` : ""}</div>)}</> : <div className="ccf-sub">No linked pricing or availability rows.</div>}</div>
    </aside>
  );
}
