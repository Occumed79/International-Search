import { useEffect, useRef, useState } from "react";
import type { PriceResult } from "@workspace/api-client-react";
import { Map as MapIcon, Satellite, Layers, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MapViewProps {
  results: PriceResult[];
  onSelectProvider?: (providerId: number) => void;
}

// Country → center coordinates for initial zoom
const COUNTRY_CENTERS: Record<string, [number, number, number]> = {
  US: [39.5, -98.35, 4],
  GB: [54.0, -2.5, 5],
  CA: [56.0, -96.0, 4],
  AU: [-25.27, 133.77, 4],
  DE: [51.16, 10.45, 5],
  FR: [46.22, 2.21, 5],
  IN: [20.59, 78.96, 4],
  MX: [23.63, -102.55, 5],
  SG: [1.35, 103.82, 11],
  TH: [15.87, 100.99, 5],
  TR: [38.96, 35.24, 5],
  JP: [36.2, 138.25, 5],
  BR: [-14.24, -51.93, 4],
  DEFAULT: [20.0, 0.0, 2],
};

function getPriceColor(priceType: string): string {
  switch (priceType) {
    case "self_pay":
    case "cash_pay":        return "#10b981"; // emerald
    case "discounted_cash": return "#3b82f6"; // blue
    case "bundled":         return "#8b5cf6"; // violet
    case "fee_schedule":    return "#f59e0b"; // amber
    default:                return "#6366f1"; // indigo
  }
}

export function MapView({ results, onSelectProvider }: MapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<unknown>(null);
  const markersRef = useRef<unknown[]>([]);
  const [mapLayer, setMapLayer] = useState<"street" | "satellite">("street");
  const [layerObj, setLayerObj] = useState<unknown>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Dynamically import leaflet (avoids SSR issues)
  useEffect(() => {
    let map: unknown;
    let L: unknown;

    const init = async () => {
      const leaflet = await import("leaflet");
      L = leaflet.default;
      await import("leaflet/dist/leaflet.css");

      // Fix default icon paths
      delete (L as any).Icon.Default.prototype._getIconUrl;
      (L as any).Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      if (!mapRef.current || leafletMap.current) return;

      map = (L as any).map(mapRef.current, { zoomControl: false, attributionControl: false });

      const streetLayer = (L as any).tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        { maxZoom: 19, attribution: "© OpenStreetMap" }
      );
      const satLayer = (L as any).tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, attribution: "© Esri" }
      );

      streetLayer.addTo(map as any);
      setLayerObj({ street: streetLayer, satellite: satLayer });

      (map as any).setView([20, 0], 2);
      leafletMap.current = map;
      setIsLoaded(true);
    };

    init();

    return () => {
      if (leafletMap.current) {
        (leafletMap.current as any).remove();
        leafletMap.current = null;
      }
    };
  }, []);

  // Switch tile layers
  useEffect(() => {
    if (!leafletMap.current || !layerObj) return;
    const { street, satellite } = layerObj as any;
    if (mapLayer === "satellite") {
      (leafletMap.current as any).removeLayer(street);
      satellite.addTo(leafletMap.current as any);
    } else {
      (leafletMap.current as any).removeLayer(satellite);
      street.addTo(leafletMap.current as any);
    }
  }, [mapLayer, layerObj]);

  // Update markers when results change
  useEffect(() => {
    if (!leafletMap.current || !isLoaded) return;

    const init = async () => {
      const leaflet = await import("leaflet");
      const L = leaflet.default;

      // Clear old markers
      markersRef.current.forEach((m) => (leafletMap.current as any).removeLayer(m));
      markersRef.current = [];

      const geoResults = results.filter((r) => r.latitude && r.longitude);

      if (geoResults.length === 0) {
        (leafletMap.current as any).setView([20, 0], 2);
        return;
      }

      // Group by location to avoid stacking
      const markerMap = new Map<string, PriceResult[]>();
      geoResults.forEach((r) => {
        const key = `${(r.latitude ?? 0).toFixed(4)},${(r.longitude ?? 0).toFixed(4)}`;
        if (!markerMap.has(key)) markerMap.set(key, []);
        markerMap.get(key)!.push(r);
      });

      const bounds: [number, number][] = [];

      markerMap.forEach((group, key) => {
        const [lat, lng] = key.split(",").map(Number);
        bounds.push([lat, lng]);
        const primary = group[0];

        const color = getPriceColor(primary.priceType);
        const count = group.length;

        // Custom circle marker
        const icon = (L as any).divIcon({
          className: "",
          html: `
            <div style="
              width: ${count > 1 ? 36 : 28}px;
              height: ${count > 1 ? 36 : 28}px;
              border-radius: 50%;
              background: ${color};
              border: 2.5px solid white;
              box-shadow: 0 2px 8px rgba(0,0,0,0.3);
              display: flex;
              align-items: center;
              justify-content: center;
              color: white;
              font-size: 10px;
              font-weight: 700;
            ">
              ${count > 1 ? count : ""}
            </div>
          `,
          iconSize: [count > 1 ? 36 : 28, count > 1 ? 36 : 28],
          iconAnchor: [count > 1 ? 18 : 14, count > 1 ? 18 : 14],
        });

        const marker = (L as any).marker([lat, lng], { icon });

        const popupHtml = group
          .slice(0, 3)
          .map(
            (r) => `
            <div style="margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid #e5e7eb;">
              <div style="font-weight: 700; font-size: 13px; margin-bottom: 2px;">${r.providerName}</div>
              <div style="font-size: 11px; color: #6b7280; margin-bottom: 3px;">${[r.city, r.stateRegion, r.country].filter(Boolean).join(", ")}</div>
              <div style="font-size: 15px; font-weight: 800; color: ${color};">${new Intl.NumberFormat("en-US", { style: "currency", currency: r.currency ?? "USD", minimumFractionDigits: 0 }).format(r.exactPrice)}</div>
              <div style="font-size: 10px; color: #9ca3af;">${r.normalizedService || r.serviceQuery}</div>
            </div>
          `
          )
          .join("");

        const popup = (L as any).popup({ maxWidth: 260, className: "glass-leaflet-popup" }).setContent(`
          <div style="padding: 4px; font-family: system-ui, sans-serif;">
            ${popupHtml}
            ${group.length > 3 ? `<div style="font-size:11px;color:#6b7280;text-align:center;">+${group.length - 3} more</div>` : ""}
            <button onclick="window.__mapSelectProvider && window.__mapSelectProvider(${primary.providerId})" 
              style="margin-top: 8px; width: 100%; padding: 6px; background: #3b82f6; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 600;">
              View Intelligence →
            </button>
          </div>
        `);

        marker.bindPopup(popup);
        marker.addTo(leafletMap.current as any);
        markersRef.current.push(marker);
      });

      if (bounds.length > 0) {
        if (bounds.length === 1) {
          (leafletMap.current as any).setView(bounds[0], 10);
        } else {
          (leafletMap.current as any).fitBounds(bounds as any, { padding: [48, 48], maxZoom: 12 });
        }
      }

      // Hook for popup button
      (window as any).__mapSelectProvider = onSelectProvider;
    };

    init();
  }, [results, isLoaded, onSelectProvider]);

  const zoomIn = () => (leafletMap.current as any)?.zoomIn();
  const zoomOut = () => (leafletMap.current as any)?.zoomOut();

  return (
    <div className="relative w-full h-full">
      <div ref={mapRef} className="absolute inset-0" style={{ zIndex: 0 }} />

      {/* Controls overlay */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-2">
        {/* Layer toggle */}
        <div className="glass-panel rounded-xl p-1 flex gap-1 border border-border/40 shadow-lg">
          <Button
            size="icon"
            variant={mapLayer === "street" ? "default" : "ghost"}
            className="w-8 h-8 rounded-lg"
            onClick={() => setMapLayer("street")}
            title="Street map"
          >
            <MapIcon className="w-4 h-4" />
          </Button>
          <Button
            size="icon"
            variant={mapLayer === "satellite" ? "default" : "ghost"}
            className="w-8 h-8 rounded-lg"
            onClick={() => setMapLayer("satellite")}
            title="Satellite"
          >
            <Satellite className="w-4 h-4" />
          </Button>
        </div>

        {/* Zoom */}
        <div className="glass-panel rounded-xl p-1 flex flex-col gap-1 border border-border/40 shadow-lg">
          <Button size="icon" variant="ghost" className="w-8 h-8 rounded-lg" onClick={zoomIn}>
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button size="icon" variant="ghost" className="w-8 h-8 rounded-lg" onClick={zoomOut}>
            <ZoomOut className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 z-10 glass-panel rounded-xl p-3 border border-border/40 shadow-lg text-xs space-y-1.5">
        <div className="font-semibold text-xs text-muted-foreground uppercase tracking-wider mb-2">Price Type</div>
        {[
          { label: "Self-Pay / Cash", color: "#10b981" },
          { label: "Discounted Cash", color: "#3b82f6" },
          { label: "Bundled Package", color: "#8b5cf6" },
          { label: "Fee Schedule", color: "#f59e0b" },
        ].map(({ label, color }) => (
          <div key={label} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full border border-white/50 shadow-sm" style={{ background: color }} />
            <span>{label}</span>
          </div>
        ))}
      </div>

      {/* No geo data overlay */}
      {results.length > 0 && results.filter((r) => r.latitude && r.longitude).length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="glass-panel px-5 py-3 rounded-2xl border border-border/40 text-sm text-muted-foreground flex items-center gap-2">
            <Layers className="w-4 h-4" />
            No geo coordinates in results — map unavailable
          </div>
        </div>
      )}
    </div>
  );
}
