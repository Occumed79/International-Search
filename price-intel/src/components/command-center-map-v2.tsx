import { useEffect, useMemo, useRef, useState } from "react";
import * as maptilersdk from "@maptiler/sdk";
import "@maptiler/sdk/dist/maptiler-sdk.css";
import { Layers, MapPin, Satellite, SlidersHorizontal } from "lucide-react";

export interface CommandCenterMapPoint {
  id: number;
  externalId?: number | null;
  name: string;
  organizationName?: string | null;
  facilityType?: string | null;
  networkStatus?: string | null;
  country?: string | null;
  stateRegion?: string | null;
  city?: string | null;
  address?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  latitude: number;
  longitude: number;
  services?: string[];
}

interface Props {
  filterQuery: string;
  selectedId?: number | null;
  onSelect?: (point: CommandCenterMapPoint) => void;
}

type ColorMode = "agreement" | "service" | "provider";

// The application shell keeps the approved blue/steel palette. Map markers use vivid analytical colors
// so tens of thousands of provider points remain distinguishable against street and satellite basemaps.
const DATA_PALETTE = ["#22D3EE", "#A78BFA", "#F59E0B", "#34D399", "#FB7185", "#60A5FA", "#F472B6", "#A3E635", "#F97316", "#2DD4BF"];
const SERVICE_GROUPS = ["Medical / Physical", "Drug Testing", "Laboratory", "Dental", "Hearing", "Imaging", "Vaccinations", "Fit Test", "Other"];

function serviceGroup(services: string[] = []) {
  const value = services.join(" ").toLowerCase();
  if (/medical|physical/.test(value)) return "Medical / Physical";
  if (/drug|alcohol/.test(value)) return "Drug Testing";
  if (/lab|blood|cbc/.test(value)) return "Laboratory";
  if (/dental/.test(value)) return "Dental";
  if (/hearing|audio/.test(value)) return "Hearing";
  if (/imag|x-ray|xray|mamm/.test(value)) return "Imaging";
  if (/vacc|immun/.test(value)) return "Vaccinations";
  if (/fit test|respirator/.test(value)) return "Fit Test";
  return "Other";
}

function agreementColor(status?: string | null) {
  if (status === "Active Agreement") return "#22D3EE";
  if (status === "Expired") return "#F59E0B";
  if (status?.includes("2026")) return "#A78BFA";
  return "#FB7185";
}

function indexedColor(value: string, universe: string[]) {
  const index = Math.max(0, universe.indexOf(value));
  return DATA_PALETTE[index % DATA_PALETTE.length];
}

function hasMeaningfulQuery(filterQuery: string) {
  const params = new URLSearchParams(filterQuery);
  params.delete("serviceMode");
  return Array.from(params.entries()).some(([, value]) => Boolean(value));
}

export function CommandCenterMapV2({ filterQuery, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maptilersdk.Map | null>(null);
  const [points, setPoints] = useState<CommandCenterMapPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [styleMode, setStyleMode] = useState<"street" | "satellite">("street");
  const [colorMode, setColorMode] = useState<ColorMode>("agreement");
  const [statusFilter, setStatusFilter] = useState("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");

  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetch(`/api/command-center/map?${filterQuery}${filterQuery ? "&" : ""}limit=40000`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Provider map could not be loaded.");
        return payload;
      })
      .then((payload) => {
        if (!cancelled) setPoints(Array.isArray(payload.points) ? payload.points : []);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Provider map could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [filterQuery]);

  const providerTypes = useMemo(() => {
    const counts = new Map<string, number>();
    points.forEach((point) => {
      const type = point.facilityType?.trim();
      if (type) counts.set(type, (counts.get(type) || 0) + 1);
    });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([value]) => value);
  }, [points]);

  const visiblePoints = useMemo(() => points.filter((point) => {
    if (statusFilter !== "all") {
      if (statusFilter === "active" && point.networkStatus !== "Active Agreement") return false;
      if (statusFilter === "expired" && point.networkStatus !== "Expired") return false;
      if (statusFilter === "new" && !point.networkStatus?.includes("2026")) return false;
      if (statusFilter === "unmatched" && (point.networkStatus === "Active Agreement" || point.networkStatus === "Expired" || point.networkStatus?.includes("2026"))) return false;
    }
    if (serviceFilter !== "all" && serviceGroup(point.services) !== serviceFilter) return false;
    if (providerFilter !== "all" && point.facilityType !== providerFilter) return false;
    return true;
  }), [points, statusFilter, serviceFilter, providerFilter]);

  const serviceUniverse = SERVICE_GROUPS;
  const providerUniverse = providerTypes.length ? providerTypes : ["Other"];

  const colorFor = (point: CommandCenterMapPoint) => {
    if (colorMode === "service") return indexedColor(serviceGroup(point.services), serviceUniverse);
    if (colorMode === "provider") return indexedColor(point.facilityType || "Other", providerUniverse);
    return agreementColor(point.networkStatus);
  };

  const pointById = useMemo(() => new Map(visiblePoints.map((point) => [String(point.id), point])), [visiblePoints]);
  const pointByIdRef = useRef(pointById);
  pointByIdRef.current = pointById;

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const response = await fetch("/api/config/map");
        const config = await response.json().catch(() => ({}));
        if (!response.ok || !config.apiKey) throw new Error(config.error || "Map service is not configured.");
        if (disposed || !containerRef.current || mapRef.current) return;

        maptilersdk.config.apiKey = config.apiKey;
        const map = new maptilersdk.Map({
          container: containerRef.current,
          style: maptilersdk.MapStyle.STREETS,
          center: [8, 18],
          zoom: 1.35,
          minZoom: 1,
          maxZoom: 18,
        });
        mapRef.current = map;

        map.once("load", () => {
          if (disposed) return;
          setMapReady(true);

          map.on("click", (event: any) => {
            if (!map.getLayer("cc-provider-core")) return;
            const features = map.queryRenderedFeatures(event.point, { layers: ["cc-provider-core"] });
            const feature = features?.[0];
            const point = pointByIdRef.current.get(String(feature?.properties?.id ?? ""));
            if (point) selectRef.current?.(point);
          });

          map.on("mousemove", (event: any) => {
            if (!map.getLayer("cc-provider-core")) {
              map.getCanvas().style.cursor = "";
              return;
            }
            const features = map.queryRenderedFeatures(event.point, { layers: ["cc-provider-core"] });
            map.getCanvas().style.cursor = features.length ? "pointer" : "";
          });
        });
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : "Map service is not configured.");
      }
    })();

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.setStyle(styleMode === "satellite" ? maptilersdk.MapStyle.SATELLITE : maptilersdk.MapStyle.STREETS);
  }, [styleMode, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const apply = () => {
      const data = {
        type: "FeatureCollection" as const,
        features: visiblePoints.map((point) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [point.longitude, point.latitude] },
          properties: {
            id: String(point.id),
            color: colorFor(point),
            selected: point.id === selectedId ? 1 : 0,
          },
        })),
      };

      const source = map.getSource("cc-provider-source") as any;
      if (source) source.setData(data);
      else map.addSource("cc-provider-source", { type: "geojson", data, cluster: false } as any);

      if (!map.getLayer("cc-provider-glow")) {
        map.addLayer({
          id: "cc-provider-glow",
          type: "circle",
          source: "cc-provider-source",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 7, 5, 11, 10, 18],
            "circle-color": ["get", "color"],
            "circle-opacity": 0.72,
            "circle-blur": 0.92,
          },
        } as any);
      }
      if (!map.getLayer("cc-provider-core")) {
        map.addLayer({
          id: "cc-provider-core",
          type: "circle",
          source: "cc-provider-source",
          paint: {
            "circle-radius": ["case", ["==", ["get", "selected"], 1], 7, ["interpolate", ["linear"], ["zoom"], 1, 2.9, 5, 3.8, 10, 5.8]],
            "circle-color": ["get", "color"],
            "circle-stroke-width": ["case", ["==", ["get", "selected"], 1], 3, 1.1],
            "circle-stroke-color": "#FFFFFF",
            "circle-opacity": 0.98,
          },
        } as any);
      }

      if (!hasMeaningfulQuery(filterQuery)) {
        map.easeTo({ center: [8, 18], zoom: 1.35, duration: 500 });
      } else if (visiblePoints.length === 1) {
        map.easeTo({ center: [visiblePoints[0].longitude, visiblePoints[0].latitude], zoom: 10.5, duration: 650 });
      } else if (visiblePoints.length > 1) {
        const bounds = new maptilersdk.LngLatBounds();
        visiblePoints.forEach((point) => bounds.extend([point.longitude, point.latitude]));
        map.fitBounds(bounds, { padding: 56, maxZoom: 10, duration: 700 });
      }
    };

    if ((map as any).isStyleLoaded?.()) apply();
    else map.once("style.load", apply);
  }, [visiblePoints, selectedId, colorMode, mapReady, styleMode, filterQuery]);

  const selected = selectedId ? visiblePoints.find((point) => point.id === selectedId) || null : null;
  const listPoints = selected ? visiblePoints.filter((point) => point.id !== selected.id) : visiblePoints;

  const focusPoint = (point: CommandCenterMapPoint) => {
    onSelect?.(point);
    mapRef.current?.easeTo({ center: [point.longitude, point.latitude], zoom: Math.max(mapRef.current?.getZoom() || 1, 8), duration: 550 });
  };

  const legend = colorMode === "agreement"
    ? [
        ["Active Agreement", "#22D3EE"],
        ["Expired", "#F59E0B"],
        ["No Agreement / Unmatched", "#FB7185"],
        ["2026 New / Unreconciled", "#A78BFA"],
      ]
    : colorMode === "service"
      ? SERVICE_GROUPS.slice(0, 8).map((label) => [label, indexedColor(label, serviceUniverse)])
      : providerTypes.slice(0, 8).map((label) => [label, indexedColor(label, providerUniverse)]);

  return (
    <div className="ccm2-layout">
      <style>{`
        .ccm2-layout{height:100%;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 345px;background:rgba(238,242,246,.56)}
        .ccm2-map{position:relative;min-height:0;overflow:hidden}.ccm2-canvas{position:absolute;inset:0}
        .ccm2-controls{position:absolute;z-index:6;top:12px;left:12px;right:12px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;pointer-events:none}.ccm2-controls>*{pointer-events:auto}
        .ccm2-seg{display:flex;gap:3px;padding:3px;background:rgba(255,254,254,.92);border:1px solid rgba(182,199,214,.72);border-radius:12px;box-shadow:0 8px 22px rgba(30,42,58,.16)}.ccm2-seg button{border:0;background:transparent;border-radius:9px;height:30px;padding:0 9px;color:#4B6F93;font-size:9px;font-weight:850;display:flex;align-items:center;gap:5px;cursor:pointer}.ccm2-seg button.on{background:#4B6F93;color:#FFFEFE}.ccm2-seg svg{width:12px;height:12px}
        .ccm2-select{height:36px;border:1px solid rgba(182,199,214,.72);border-radius:12px;background:rgba(255,254,254,.94);color:#1E2A3A;padding:0 9px;font-size:9px;font-weight:750;box-shadow:0 8px 22px rgba(30,42,58,.14);max-width:190px}
        .ccm2-count{margin-left:auto;background:rgba(255,254,254,.94);border:1px solid rgba(182,199,214,.72);border-radius:999px;padding:8px 11px;font-size:9px;font-weight:850;color:#1E2A3A;box-shadow:0 8px 22px rgba(30,42,58,.14)}
        .ccm2-legend{position:absolute;z-index:5;left:12px;bottom:12px;max-width:245px;background:rgba(255,254,254,.94);border:1px solid rgba(182,199,214,.72);border-radius:15px;padding:10px 12px;box-shadow:0 9px 24px rgba(30,42,58,.16);font-size:8px;color:#1E2A3A}.ccm2-legend strong{font-size:8px;letter-spacing:.08em;text-transform:uppercase}.ccm2-legend-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px 9px;margin-top:7px}.ccm2-legend-row{display:flex;align-items:center;gap:5px;min-width:0}.ccm2-dot{width:8px;height:8px;border-radius:999px;box-shadow:0 0 5px currentColor,0 0 13px currentColor,0 0 20px currentColor;flex:none}.ccm2-legend-row span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .ccm2-loading{position:absolute;z-index:7;left:50%;top:72px;transform:translateX(-50%);background:rgba(30,42,58,.9);color:#FFFEFE;border:1px solid rgba(182,199,214,.35);border-radius:999px;padding:8px 12px;font-size:9px;font-weight:800;box-shadow:0 8px 25px rgba(30,42,58,.28)}
        .ccm2-side{min-height:0;overflow:auto;border-left:1px solid rgba(75,111,147,.18);padding:12px;background:linear-gradient(180deg,rgba(238,242,246,.94),rgba(182,199,214,.58))}.ccm2-side h3{font-size:15px;margin:0}.ccm2-side p{font-size:9px;color:#4B6F93;line-height:1.4}.ccm2-selected{background:#FFFEFE;border:1px solid rgba(75,111,147,.28);border-radius:16px;padding:12px;box-shadow:0 10px 28px rgba(30,42,58,.12);margin-bottom:10px}.ccm2-selected h4{font-size:14px;margin:0;color:#1E2A3A}.ccm2-meta{font-size:9px;color:#4B6F93;margin-top:4px}.ccm2-badges{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}.ccm2-badge{font-size:7.5px;border-radius:999px;padding:4px 6px;background:#EEF2F6;color:#1E2A3A;border:1px solid #B6C7D6}.ccm2-list{display:grid;gap:6px}.ccm2-list button{width:100%;text-align:left;border:1px solid rgba(182,199,214,.66);background:rgba(255,254,254,.86);border-radius:13px;padding:9px;color:#1E2A3A;cursor:pointer}.ccm2-list button:hover{border-color:#4B6F93;box-shadow:0 7px 18px rgba(30,42,58,.10)}.ccm2-list b{display:block;font-size:10px}.ccm2-list span{display:block;margin-top:3px;font-size:8px;color:#4B6F93}
        @media(max-width:1000px){.ccm2-layout{grid-template-columns:1fr}.ccm2-side{display:none}.ccm2-controls{right:8px}.ccm2-count{display:none}}
      `}</style>

      <div className="ccm2-map">
        <div ref={containerRef} className="ccm2-canvas" />
        <div className="ccm2-controls">
          <div className="ccm2-seg">
            <button type="button" className={styleMode === "street" ? "on" : ""} onClick={() => setStyleMode("street")}><Layers />Street</button>
            <button type="button" className={styleMode === "satellite" ? "on" : ""} onClick={() => setStyleMode("satellite")}><Satellite />Satellite</button>
          </div>
          <select className="ccm2-select" value={colorMode} onChange={(event) => setColorMode(event.target.value as ColorMode)} title="Choose how provider dots are colored">
            <option value="agreement">Color by agreement</option>
            <option value="service">Color by service</option>
            <option value="provider">Color by provider type</option>
          </select>
          <select className="ccm2-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All agreement statuses</option>
            <option value="active">Active agreements only</option>
            <option value="expired">Expired only</option>
            <option value="unmatched">No agreement / unmatched</option>
            <option value="new">2026 new / unreconciled</option>
          </select>
          <select className="ccm2-select" value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}>
            <option value="all">All service types</option>
            {SERVICE_GROUPS.map((group) => <option key={group} value={group}>{group}</option>)}
          </select>
          <select className="ccm2-select" value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}>
            <option value="all">All provider types</option>
            {providerTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <div className="ccm2-count">{visiblePoints.length.toLocaleString()} clinic dots</div>
        </div>

        <div className="ccm2-legend">
          <strong><SlidersHorizontal style={{width:10,height:10,display:"inline",marginRight:4}} />{colorMode === "agreement" ? "Agreement" : colorMode === "service" ? "Service" : "Provider type"}</strong>
          <div className="ccm2-legend-grid">
            {legend.map(([label, color]) => (
              <div className="ccm2-legend-row" key={label as string}>
                <span className="ccm2-dot" style={{ background: color as string, color: color as string }} />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {loading && <div className="ccm2-loading">Loading provider locations…</div>}
        {error && <div className="ccm2-loading"><MapPin style={{width:12,height:12,display:"inline",marginRight:5}} />{error}</div>}
      </div>

      <aside className="ccm2-side">
        <h3>{selected ? "Clinic Details" : "Provider Locations"}</h3>
        <p>{selected ? "The selected map point is shown once here; the list below excludes it." : "Select a glowing dot or a clinic below to inspect the exact physical location."}</p>

        {selected && (
          <div className="ccm2-selected">
            <h4>{selected.name}</h4>
            <div className="ccm2-meta">{[selected.address, selected.city, selected.stateRegion, selected.postalCode, selected.country].filter(Boolean).join(", ")}</div>
            <div className="ccm2-meta">{selected.phone || "Phone not listed"}</div>
            <div className="ccm2-badges">
              <span className="ccm2-badge">{selected.networkStatus || "Status not listed"}</span>
              {selected.facilityType && <span className="ccm2-badge">{selected.facilityType}</span>}
              {(selected.services || []).slice(0, 6).map((service, index) => <span className="ccm2-badge" key={`${service}-${index}`}>{service}</span>)}
            </div>
          </div>
        )}

        <div className="ccm2-list">
          {listPoints.slice(0, 160).map((point) => (
            <button key={point.id} type="button" onClick={() => focusPoint(point)}>
              <b>{point.name}</b>
              <span>{[point.city, point.stateRegion, point.country].filter(Boolean).join(", ") || "Location not listed"} · {point.networkStatus || "Status not listed"}</span>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
