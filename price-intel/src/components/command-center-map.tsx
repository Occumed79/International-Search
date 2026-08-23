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

function statusColor(status?: string | null) {
  if (status === "Active Agreement") return "#397ec1";
  if (status === "Expired") return "#b6545f";
  if (status?.includes("2026")) return "#4c8d7b";
  return "#b98335";
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
            "circle-color": ["match", ["get", "status"], "Active Agreement", "#397ec1", "Expired", "#b6545f", "2026 New / Unreconciled", "#4c8d7b", "#b98335"],
            "circle-stroke-width": 0.7,
            "circle-stroke-color": "rgba(255,255,255,.88)",
            "circle-opacity": 0.9,
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
        .cc-map-layout{height:100%;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 330px;background:rgba(255,255,255,.2)}
        .cc-map-pane{position:relative;min-height:0;overflow:hidden}.cc-map-canvas{position:absolute;inset:0}
        .cc-map-tools{position:absolute;z-index:4;top:12px;left:12px;display:flex;gap:6px}.cc-map-tools button{height:34px;border:1px solid rgba(255,255,255,.96);background:rgba(255,255,255,.9);border-radius:11px;padding:0 10px;color:#466076;font-size:10px;font-weight:800;box-shadow:0 6px 16px rgba(48,65,88,.12);display:flex;align-items:center;gap:5px}.cc-map-tools button.on{background:#397ec1;color:white;border-color:#397ec1}.cc-map-tools svg{width:13px;height:13px}
        .cc-map-count{position:absolute;z-index:4;top:12px;right:12px;background:rgba(255,255,255,.92);border:1px solid white;border-radius:999px;padding:7px 10px;font-size:10px;font-weight:800;color:#536173;box-shadow:0 6px 16px rgba(48,65,88,.10)}
        .cc-map-legend{position:absolute;z-index:4;left:12px;bottom:12px;background:rgba(255,255,255,.91);border:1px solid white;border-radius:15px;padding:10px 12px;font-size:9px;color:#536173;box-shadow:0 8px 22px rgba(48,65,88,.12)}.cc-map-legend b{display:block;margin-bottom:6px;font-size:9px;color:#263445}.cc-map-legend-row{display:flex;align-items:center;gap:6px;margin-top:4px}.cc-map-dot{width:8px;height:8px;border-radius:999px}
        .cc-map-side{min-height:0;overflow:auto;border-left:1px solid rgba(255,255,255,.9);padding:14px;background:rgba(248,251,253,.58)}.cc-map-side h3{margin:0;font-size:16px}.cc-map-side p{font-size:10px;line-height:1.45;color:#6c7988}.cc-map-list{display:grid;gap:7px;margin-top:10px}.cc-map-list button{width:100%;text-align:left;border:1px solid white;background:rgba(255,255,255,.7);border-radius:14px;padding:10px;color:#182433}.cc-map-list b{display:block;font-size:10.5px}.cc-map-list span{display:block;margin-top:3px;font-size:8.8px;color:#738193}.cc-map-state{position:absolute;inset:0;z-index:3;display:grid;place-items:center;background:rgba(240,245,249,.75);backdrop-filter:blur(6px);color:#627286;font-size:11px;font-weight:700}.cc-map-state svg{width:24px;height:24px;margin:0 auto 8px;display:block}
        .cc-map-popup{font-family:Inter,system-ui,sans-serif;color:#182433;min-width:210px}.cc-map-popup-title{font-weight:850;font-size:13px;line-height:1.3;padding-right:16px}.cc-map-popup-location{font-size:10px;color:#6c7988;margin-top:4px}.cc-map-popup-status{font-size:10px;font-weight:750;margin-top:6px}.cc-map-popup-button{margin-top:9px;width:100%;height:32px;border:0;border-radius:9px;background:#397ec1;color:white;font-size:10px;font-weight:800;cursor:pointer}.maplibregl-popup-content{border-radius:15px!important;padding:12px!important}
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
          <div className="cc-map-legend-row"><span className="cc-map-dot" style={{ background: "#397ec1" }} />Active Agreement</div>
          <div className="cc-map-legend-row"><span className="cc-map-dot" style={{ background: "#b6545f" }} />Expired</div>
          <div className="cc-map-legend-row"><span className="cc-map-dot" style={{ background: "#b98335" }} />No Agreement / Unmatched</div>
          <div className="cc-map-legend-row"><span className="cc-map-dot" style={{ background: "#4c8d7b" }} />2026 New / Unreconciled</div>
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
