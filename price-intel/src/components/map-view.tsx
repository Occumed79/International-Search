import { useEffect, useRef, useState } from "react";
import type { PriceResult } from "@workspace/api-client-react";
import * as maptilersdk from "@maptiler/sdk";
import "@maptiler/sdk/dist/maptiler-sdk.css";
import { Map as MapIcon, Satellite, Layers, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MapViewProps {
  results: PriceResult[];
  onSelectProvider?: (providerId: number) => void;
}

function getPriceColor(priceType: string): string {
  switch (priceType) {
    case "self_pay":
    case "cash_pay":
      return "#10b981";
    case "discounted_cash":
      return "#3b82f6";
    case "bundled":
      return "#8b5cf6";
    case "fee_schedule":
      return "#f59e0b";
    default:
      return "#6366f1";
  }
}

function hasCoordinates(result: PriceResult): boolean {
  return Number.isFinite(result.latitude) && Number.isFinite(result.longitude);
}

function formatPrice(result: PriceResult): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: result.currency ?? "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(result.exactPrice);
  } catch {
    return `${result.exactPrice}`;
  }
}

function makePopupContent(group: PriceResult[], color: string, onSelectProvider?: (providerId: number) => void): HTMLElement {
  const root = document.createElement("div");
  root.className = "occu-map-popup";

  group.slice(0, 3).forEach((result) => {
    const item = document.createElement("div");
    item.className = "occu-map-popup-item";

    const title = document.createElement("div");
    title.className = "occu-map-popup-title";
    title.textContent = result.providerName;

    const location = document.createElement("div");
    location.className = "occu-map-popup-location";
    location.textContent = [result.city, result.stateRegion, result.country].filter(Boolean).join(", ");

    const price = document.createElement("div");
    price.className = "occu-map-popup-price";
    price.style.color = color;
    price.textContent = formatPrice(result);

    const service = document.createElement("div");
    service.className = "occu-map-popup-service";
    service.textContent = result.normalizedService || result.serviceQuery;

    item.append(title, location, price, service);
    root.appendChild(item);
  });

  if (group.length > 3) {
    const more = document.createElement("div");
    more.className = "occu-map-popup-more";
    more.textContent = `+${group.length - 3} more`;
    root.appendChild(more);
  }

  if (onSelectProvider && group[0]?.providerId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "occu-map-popup-button";
    button.textContent = "View Details →";
    button.addEventListener("click", () => onSelectProvider(group[0].providerId));
    root.appendChild(button);
  }

  return root;
}

export function MapView({ results, onSelectProvider }: MapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maptilersdk.Map | null>(null);
  const markersRef = useRef<maptilersdk.Marker[]>([]);
  const [mapLayer, setMapLayer] = useState<"street" | "satellite">("street");
  const [isLoaded, setIsLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;

    const init = async () => {
      try {
        const configResponse = await fetch("/api/config/map");
        const configPayload = await configResponse.json().catch(() => ({}));
        if (!configResponse.ok || !configPayload.apiKey) {
          throw new Error(configPayload.error || "Map service is unavailable.");
        }

        if (disposed || !mapContainerRef.current || mapRef.current) return;

        maptilersdk.config.apiKey = configPayload.apiKey;

        const map = new maptilersdk.Map({
          container: mapContainerRef.current,
          style: maptilersdk.MapStyle.STREETS,
          center: [0, 20],
          zoom: 1.6,
          minZoom: 1,
          maxZoom: 18,
        });

        mapRef.current = map;
        map.once("load", () => {
          if (!disposed) setIsLoaded(true);
        });
        map.on("error", (event) => {
          if (!disposed && event?.error) console.error("Map rendering error", event.error);
        });
      } catch (error) {
        if (!disposed) {
          setMapError(error instanceof Error ? error.message : "Map service is unavailable.");
        }
      }
    };

    void init();

    return () => {
      disposed = true;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded) return;

    map.setStyle(mapLayer === "satellite" ? maptilersdk.MapStyle.SATELLITE : maptilersdk.MapStyle.STREETS);
  }, [mapLayer, isLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    const geoResults = results.filter(hasCoordinates);

    if (geoResults.length === 0) {
      map.easeTo({ center: [0, 20], zoom: 1.6, duration: 500 });
      return;
    }

    const markerGroups = new Map<string, PriceResult[]>();
    geoResults.forEach((result) => {
      const latitude = Number(result.latitude);
      const longitude = Number(result.longitude);
      const key = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
      const group = markerGroups.get(key) ?? [];
      group.push(result);
      markerGroups.set(key, group);
    });

    const bounds = new maptilersdk.LngLatBounds();

    markerGroups.forEach((group, key) => {
      const [latitude, longitude] = key.split(",").map(Number);
      const primary = group[0];
      const color = getPriceColor(primary.priceType);
      const count = group.length;
      const size = count > 1 ? 38 : 30;

      bounds.extend([longitude, latitude]);

      const markerElement = document.createElement("button");
      markerElement.type = "button";
      markerElement.className = "occu-map-marker";
      markerElement.style.width = `${size}px`;
      markerElement.style.height = `${size}px`;
      markerElement.style.background = color;
      markerElement.setAttribute("aria-label", count > 1 ? `${count} providers at this location` : primary.providerName);
      if (count > 1) markerElement.textContent = String(count);

      const popup = new maptilersdk.Popup({ offset: 20, maxWidth: "290px" }).setDOMContent(
        makePopupContent(group, color, onSelectProvider),
      );

      const marker = new maptilersdk.Marker({ element: markerElement, anchor: "center" })
        .setLngLat([longitude, latitude])
        .setPopup(popup)
        .addTo(map);

      markersRef.current.push(marker);
    });

    if (markerGroups.size === 1) {
      const first = geoResults[0];
      map.easeTo({ center: [Number(first.longitude), Number(first.latitude)], zoom: 10, duration: 700 });
    } else {
      map.fitBounds(bounds, { padding: 56, maxZoom: 12, duration: 700 });
    }
  }, [results, isLoaded, onSelectProvider]);

  const zoomIn = () => mapRef.current?.zoomIn({ duration: 250 });
  const zoomOut = () => mapRef.current?.zoomOut({ duration: 250 });
  const geoResultCount = results.filter(hasCoordinates).length;

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#0b1220]">
      <style>{`
        .occu-map-marker {
          border-radius: 999px;
          border: 2.5px solid rgba(255,255,255,.98);
          box-shadow: 0 4px 14px rgba(2,8,23,.38), 0 0 0 1px rgba(15,23,42,.12);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 10px;
          font-weight: 800;
          cursor: pointer;
          transition: transform .16s ease, box-shadow .16s ease;
        }
        .occu-map-marker:hover { transform: scale(1.08); box-shadow: 0 7px 20px rgba(2,8,23,.48), 0 0 0 3px rgba(255,255,255,.16); }
        .maplibregl-popup-content { border-radius: 16px !important; padding: 10px !important; box-shadow: 0 18px 50px rgba(15,23,42,.24) !important; }
        .maplibregl-popup-close-button { width: 28px; height: 28px; font-size: 18px; color: #64748b; }
        .occu-map-popup { min-width: 210px; color: #182433; font-family: Inter, system-ui, sans-serif; }
        .occu-map-popup-item { margin-bottom: 8px; padding: 2px 2px 8px; border-bottom: 1px solid #e5e7eb; }
        .occu-map-popup-item:last-of-type { margin-bottom: 0; }
        .occu-map-popup-title { font-size: 13px; font-weight: 800; line-height: 1.25; padding-right: 18px; }
        .occu-map-popup-location { margin-top: 2px; font-size: 11px; color: #64748b; }
        .occu-map-popup-price { margin-top: 4px; font-size: 15px; font-weight: 850; }
        .occu-map-popup-service { margin-top: 1px; font-size: 10px; color: #94a3b8; }
        .occu-map-popup-more { padding: 4px 0 2px; text-align: center; font-size: 10px; color: #64748b; }
        .occu-map-popup-button { margin-top: 8px; width: 100%; min-height: 34px; border: 0; border-radius: 9px; background: #397ec1; color: white; cursor: pointer; font-size: 11px; font-weight: 750; }
        .maplibregl-ctrl-attrib { font-size: 9px !important; opacity: .8; }
      `}</style>

      <div ref={mapContainerRef} className="absolute inset-0" />

      <div className="absolute top-3 right-3 z-10 flex flex-col gap-2">
        <div className="glass-panel rounded-xl p-1 flex gap-1 border border-border/40 shadow-lg">
          <Button size="icon" variant={mapLayer === "street" ? "default" : "ghost"} className="w-8 h-8 rounded-lg" onClick={() => setMapLayer("street")} title="Street map">
            <MapIcon className="w-4 h-4" />
          </Button>
          <Button size="icon" variant={mapLayer === "satellite" ? "default" : "ghost"} className="w-8 h-8 rounded-lg" onClick={() => setMapLayer("satellite")} title="Satellite">
            <Satellite className="w-4 h-4" />
          </Button>
        </div>

        <div className="glass-panel rounded-xl p-1 flex flex-col gap-1 border border-border/40 shadow-lg">
          <Button size="icon" variant="ghost" className="w-8 h-8 rounded-lg" onClick={zoomIn} title="Zoom in">
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button size="icon" variant="ghost" className="w-8 h-8 rounded-lg" onClick={zoomOut} title="Zoom out">
            <ZoomOut className="w-4 h-4" />
          </Button>
        </div>
      </div>

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

      {mapError && (
        <div className="absolute inset-0 flex items-center justify-center z-20 bg-background/70 backdrop-blur-sm">
          <div className="glass-panel px-5 py-3 rounded-2xl border border-border/40 text-sm text-muted-foreground flex items-center gap-2">
            <Layers className="w-4 h-4" />
            {mapError}
          </div>
        </div>
      )}

      {!mapError && results.length > 0 && geoResultCount === 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <div className="glass-panel px-5 py-3 rounded-2xl border border-border/40 text-sm text-muted-foreground flex items-center gap-2">
            <Layers className="w-4 h-4" />
            No mapped coordinates are available for these results.
          </div>
        </div>
      )}
    </div>
  );
}
