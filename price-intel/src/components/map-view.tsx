import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import type { PriceResult } from "@workspace/api-client-react";

// Fix for default marker icon in react-leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Component to handle map center changes
function MapController({ results }: { results: PriceResult[] }) {
  const map = useMap();

  useEffect(() => {
    if (results && results.length > 0) {
      const validResults = results.filter(r => r.latitude && r.longitude);
      
      if (validResults.length > 0) {
        const bounds = L.latLngBounds(validResults.map(r => [r.latitude!, r.longitude!]));
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
      }
    }
  }, [results, map]);

  return null;
}

export function MapView({ results, isLoading }: { results: PriceResult[], isLoading: boolean }) {
  const validResults = results?.filter(r => r.latitude && r.longitude) || [];
  
  // Default center (US approx) if no valid results
  const defaultCenter: [number, number] = [39.8283, -98.5795];
  const defaultZoom = 4;

  return (
    <div className="w-full h-full relative z-0">
      <MapContainer 
        center={defaultCenter} 
        zoom={defaultZoom} 
        style={{ height: '100%', width: '100%', zIndex: 0 }}
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          className="map-tiles"
        />
        
        <MapController results={validResults} />
        
        {validResults.map((result) => (
          <Marker 
            key={result.id} 
            position={[result.latitude!, result.longitude!]}
          >
            <Popup className="glass-popup">
              <div className="p-1 space-y-2 min-w-[200px]">
                <h3 className="font-semibold text-sm leading-tight">{result.providerName}</h3>
                <div className="text-xs text-muted-foreground">{result.city}, {result.stateRegion}</div>
                <div className="pt-2 border-t border-border">
                  <div className="text-lg font-bold text-foreground">
                    {result.currency === 'USD' ? '$' : result.currency}{result.exactPrice.toLocaleString()}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    {result.priceType}
                  </div>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {/* Map Overlay Styles via inline CSS to avoid cluttering global CSS */}
      <style>{`
        .map-tiles {
          filter: contrast(0.9) saturate(1.2) brightness(0.9) hue-rotate(10deg);
        }
        .dark .map-tiles {
          filter: invert(1) hue-rotate(180deg) brightness(0.6) contrast(1.2);
        }
        .leaflet-container {
          background-color: var(--color-muted) !important;
          font-family: inherit !important;
        }
        .leaflet-popup-content-wrapper {
          background: rgba(255, 255, 255, 0.8) !important;
          backdrop-filter: blur(12px) !important;
          border: 1px solid rgba(0, 0, 0, 0.1) !important;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1) !important;
          border-radius: 12px !important;
          color: inherit !important;
        }
        .dark .leaflet-popup-content-wrapper {
          background: rgba(20, 20, 20, 0.8) !important;
          border: 1px solid rgba(255, 255, 255, 0.1) !important;
        }
        .leaflet-popup-tip {
          background: rgba(255, 255, 255, 0.8) !important;
        }
        .dark .leaflet-popup-tip {
          background: rgba(20, 20, 20, 0.8) !important;
        }
      `}</style>

      {isLoading && (
        <div className="absolute inset-0 z-[1000] bg-background/20 backdrop-blur-sm flex items-center justify-center">
          <div className="glass-panel px-6 py-4 flex items-center gap-3 animate-in fade-in zoom-in duration-300">
            <span className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>
            <span className="font-semibold tracking-tight">Acquiring geospatial coordinates...</span>
          </div>
        </div>
      )}
    </div>
  );
}
