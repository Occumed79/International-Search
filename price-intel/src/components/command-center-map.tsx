import { useEffect, useMemo, useRef, useState } from "react";
import * as maptilersdk from "@maptiler/sdk";
import "@maptiler/sdk/dist/maptiler-sdk.css";
import { Layers, MapPin, Satellite } from "lucide-react";

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
  onSelect?: (point: CommandCenterMapPoint) => void;
}

const MAP_COLORS = {
  active: "#4B6F93",
  expired: "#1E2A3A",
  newRecord: "#B6C7D6",
  unmatched: "#EEF2F6",
  stroke: "#FFFEFE",
} as const;

function statusColor(status?: string | null) {
  if (status === "Active Agreement") return MAP_COLORS.active;
  if (status === "Expired") return MAP_COLORS.expired;
  if (status?.includes("2026")) return MAP_COLORS.newRecord;
  return MAP_COLORS.unmatched;
}

function makePopup(point: CommandCenterMapPoint, onSelect?: (point: CommandCenterMapPoint) => void) {
  const root = document.createElement("div");
  root.className = "cc-map-popup";
  const title = document.createElement("div");
  title.className = "cc-map-popup-title";
  title.textContent = point.name;
  const location = document.createElement("div");
  location.className = "cc-map-popup-location";
  location.textContent = [point.city, point.stateRegion, point.country].filter(Boolean).join(", ") || "Location not listed";
  const status = document.createElement("div");
  status.className = "cc-map-popup-status";
  status.textContent = point.networkStatus || "Status not listed";
  status.style.color = statusColor(point.networkStatus);
  root.append(title, location, status);
  if (onSelect) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cc-map-popup-button";
    button.textContent = "View provider details";
    button.addEventListener("click", () => onSelect(point));
    root.appendChild(button);
  }
  return root;
}

export function CommandCenterMap({ filterQuery, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maptilersdk.Map | null>(null);
  const [points, setPoints] = useState<CommandCenterMapPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [styleMode, setStyleMode] = useState<"street" | "satellite">("street");
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  const pointById = useMemo(() => new Map(points.map((point) => [String(point.id), point])), [points]);
  const pointByIdRef = useRef(pointById);
  pointByIdRef.current = pointById;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/command-center/map?${filterQuery}${filterQuery ? "&" : ""}limit=40000`);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Provider map could not be loaded.");
        if (!cancelled) setPoints(Array.isArray(payload.points) ? payload.points : []);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Provider map could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filterQuery]);

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
          center: [-98.35, 39.5],
          zoom: 3.25,
          minZoom: 1,
          maxZoom: 18,
        });
        mapRef.current = map;

        const clickHandler = (event: any) => {
          const feature = event.features?.[0];
          const point = pointByIdRef.current.get(String(feature?.properties?.id ?? ""));
          if (!point) return;
          new maptilersdk.Popup({ offset: 10, maxWidth: "310px" })
            .setLngLat([point.longitude, point.latitude])
            .setDOMContent(makePopup(point, selectRef.current))
            .addTo(map);
        };

        map.once("load", () => {
          if (disposed) return;
          setMapReady(true);
          map.on("click", "command-center-providers", clickHandler);
          map.on("mouseenter", "command-center-providers", () => { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", "command-center-providers", () => { map.getCanvas().style.cursor = ""; });
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
    const target = styleMode === "satellite" ? maptilersdk.MapStyle.SATELLITE : maptilersdk.MapStyle.STREETS;
    map.setStyle(target);
  }, [styleMode, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const apply = () => {
      const data = {
        type: "FeatureCollection" as const,
        features: points.map((point) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [point.longitude, point.latitude] },
          properties: { id: String(point.id), status: point.networkStatus || "Unknown" },
        })),
      };
      const source = map.getSource("command-center-providers") as any;
      if (source) source.setData(data);
      else {
        map.addSource("command-center-providers", { type: "geojson", data, cluster: false } as any);
        map.addLayer({
          id: "command-center-providers",
          type: "circle",
          source: "command-center-providers",
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 2.3, 6, 3.2, 10, 5.2],
            "circle-color": ["match", ["get", "status"], "Active Agreement", MAP_COLORS.active, "Expired", MAP_COLORS.expired, "2026 New / Unreconciled", MAP_COLORS.newRecord, MAP_COLORS.unmatched],
            "circle-stroke-width": 0.85,
            "circle-stroke-color": MAP_COLORS.stroke,
            "circle-opacity": 0.92,
          },
        } as any);
      }
      if (points.length === 1) map.easeTo({ center: [points[0].longitude, points[0].latitude], zoom: 11, duration: 600 });
      else if (points.length > 1) {
        const bounds = new maptilersdk.LngLatBounds();
        for (const point of points) bounds.extend([point.longitude, point.latitude]);
        map.fitBounds(bounds, { padding: 42, maxZoom: 11, duration: 650 });
      }
    };

    if ((map as any).isStyleLoaded?.()) apply();
    else map.once("style.load", apply);
  }, [points, mapReady, styleMode]);

  return (
    <div className="cc-map-layout">
      <style>{`
        .cc-map-layout{height:100%;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 330px;background:rgba(238,242,246,.58)}
        .cc-map-pane{position:relative;min-height:0;overflow:hidden}.cc-map-canvas{position:absolute;inset:0}
        .cc-map-tools{position:absolute;z-index:4;top:12px;left:12px;display:flex;gap:6px}.cc-map-tools button{height:34px;border:1px solid rgba(182,199,214,.55);background:rgba(255,254,254,.92);border-radius:11px;padding:0 10px;color:#1E2A3A;font-size:10px;font-weight:800;box-shadow:0 6px 16px rgba(30,42,58,.14);display:flex;align-items:center;gap:5px}.cc-map-tools button.on{background:#4B6F93;color:#FFFEFE;border-color:#4B6F93}.cc-map-tools svg{width:13px;height:13px}
        .cc-map-count{position:absolute;z-index:4;top:12px;right:12px;background:rgba(255,254,254,.94);border:1px solid #B6C7D6;border-radius:999px;padding:7px 10px;font-size:10px;font-weight:800;color:#1E2A3A;box-shadow:0 6px 16px rgba(30,42,58,.12)}
        .cc-map-legend{position:absolute;z-index:4;left:12px;bottom:12px;background:rgba(255,254,254,.93);border:1px solid #B6C7D6;border-radius:15px;padding:10px 12px;font-size:9px;color:#4B6F93;box-shadow:0 8px 22px rgba(30,42,58,.14)}.cc-map-legend b{display:block;margin-bottom:6px;font-size:9px;color:#1E2A3A}.cc-map-legend-row{display:flex;align-items:center;gap:6px;margin-top:4px}.cc-map-dot{width:8px;height:8px;border-radius:999px;border:1px solid rgba(30,42,58,.10)}
        .cc-map-side{min-height:0;overflow:auto;border-left:1px solid rgba(75,111,147,.18);padding:14px;background:rgba(238,242,246,.88)}.cc-map-side h3{margin:0;font-size:16px;color:#1E2A3A}.cc-map-side p{font-size:10px;line-height:1.45;color:#4B6F93}.cc-map-list{display:grid;gap:7px;margin-top:10px}.cc-map-list button{width:100%;text-align:left;border:1px solid #B6C7D6;background:rgba(255,254,254,.82);border-radius:14px;padding:10px;color:#1E2A3A}.cc-map-list b{display:block;font-size:10.5px}.cc-map-list span{display:block;margin-top:3px;font-size:8.8px;color:#4B6F93}.cc-map-state{position:absolute;inset:0;z-index:3;display:grid;place-items:center;background:rgba(238,242,246,.82);backdrop-filter:blur(6px);color:#1E2A3A;font-size:11px;font-weight:700}.cc-map-state svg{width:24px;height:24px;margin:0 auto 8px;display:block}
        .cc-map-popup{font-family:Inter,system-ui,sans-serif;color:#1E2A3A;min-width:210px}.cc-map-popup-title{font-weight:850;font-size:13px;line-height:1.3;padding-right:16px}.cc-map-popup-location{font-size:10px;color:#4B6F93;margin-top:4px}.cc-map-popup-status{font-size:10px;font-weight:750;margin-top:6px}.cc-map-popup-button{margin-top:9px;width:100%;height:32px;border:0;border-radius:9px;background:#4B6F93;color:#FFFEFE;font-size:10px;font-weight:800;cursor:pointer}.maplibregl-popup-content{border-radius:15px!important;padding:12px!important;background:#FFFEFE!important;color:#1E2A3A!important}
        @media(max-width:950px){.cc-map-layout{grid-template-columns:1fr}.cc-map-side{display:none}}
      `}</style>
      <div className="cc-map-pane">
        <div ref={containerRef} className="cc-map-canvas" />
        <div className="cc-map-tools">
          <button type="button" className={styleMode === "street" ? "on" : ""} onClick={() => setStyleMode("street")}><Layers />Street</button>
          <button type="button" className={styleMode === "satellite" ? "on" : ""} onClick={() => setStyleMode("satellite")}><Satellite />Satellite</button>
        </div>
        <div className="cc-map-count">{points.length.toLocaleString()} individual clinic dots</div>
        <div className="cc-map-legend">
          <b>NO CLUSTERS · 1 DOT = 1 CLINIC</b>
          <div className="cc-map-legend-row"><span className="cc-map-dot" style={{ background: MAP_COLORS.active }} />Active Agreement</div>
          <div className="cc-map-legend-row"><span className="cc-map-dot" style={{ background: MAP_COLORS.expired }} />Expired</div>
          <div className="cc-map-legend-row"><span className="cc-map-dot" style={{ background: MAP_COLORS.unmatched }} />No Agreement / Unmatched</div>
          <div className="cc-map-legend-row"><span className="cc-map-dot" style={{ background: MAP_COLORS.newRecord }} />2026 New / Unreconciled</div>
        </div>
        {loading && <div className="cc-map-state"><div><MapPin />Loading provider locations…</div></div>}
        {error && <div className="cc-map-state"><div><MapPin />{error}</div></div>}
      </div>
      <aside className="cc-map-side">
        <h3>Individual Clinic Locations</h3>
        <p>Every dot is one physical clinic site. No clustering or entity collapsing. Select a dot or a location below to inspect that exact clinic.</p>
        <div className="cc-map-list">
          {points.slice(0, 120).map((point) => <button key={point.id} type="button" onClick={() => onSelect?.(point)}><b>{point.name}</b><span>{[point.city, point.stateRegion, point.country].filter(Boolean).join(", ")} · {point.networkStatus || "Status not listed"}</span></button>)}
        </div>
      </aside>
    </div>
  );
}
