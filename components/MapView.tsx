
import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents, Polygon, Polyline } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import { House, VisitStatus } from '../types';
import { ExternalLink } from 'lucide-react';

interface MapViewProps {
  houses: House[];
  selectedHouse: House | null;
  onSelectHouse: (house: House) => void;
  onBoundsChange: (bounds: L.LatLngBounds) => void;
  onOpenDetails: (house: House) => void;
  isSidebarOpen: boolean;
  isSelectionMode: boolean;
  activePolygon: L.LatLng[] | null;
  onFinishDrawing: (polygon: L.LatLng[]) => void;
}

// Simple debounce utility to avoid external dependency for just one function
function useDebounce<T extends (...args: any[]) => void>(func: T, wait: number) {
  const timeoutRef = useRef<number | null>(null);

  const debouncedFunc = useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(() => {
      func(...args);
    }, wait);
  }, [func, wait]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  return debouncedFunc;
}

const BoundsHandler: React.FC<{ onBoundsChange: (bounds: L.LatLngBounds) => void }> = ({ onBoundsChange }) => {
  const debouncedChange = useDebounce(onBoundsChange, 200);

  const map = useMapEvents({
    moveend: () => debouncedChange(map.getBounds()),
    zoomend: () => debouncedChange(map.getBounds())
  });

  // Initial load
  useEffect(() => {
    onBoundsChange(map.getBounds());
  }, []);

  return null;
};

const LassoHandler: React.FC<{ 
  isActive: boolean, 
  onFinish: (polygon: L.LatLng[]) => void 
}> = ({ isActive, onFinish }) => {
  const [points, setPoints] = useState<L.LatLng[]>([]);
  const isDrawingRef = useRef(false);
  const pointsRef = useRef<L.LatLng[]>([]);
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();

    if (isActive) {
      map.dragging.disable();
      map.touchZoom.disable();
      map.doubleClickZoom.disable();
      map.scrollWheelZoom.disable();
      map.boxZoom.disable();
      map.keyboard.disable();
      if ((map as any).tap) (map as any).tap.disable();
      
      // Force the container to not handle any default touch gestures
      container.style.touchAction = 'none';
    } else {
      map.dragging.enable();
      map.touchZoom.enable();
      map.doubleClickZoom.enable();
      map.scrollWheelZoom.enable();
      map.boxZoom.enable();
      map.keyboard.enable();
      if ((map as any).tap) (map as any).tap.enable();
      
      container.style.touchAction = 'auto';
      setPoints([]);
      pointsRef.current = [];
      isDrawingRef.current = false;
    }

    const getLatLng = (e: MouseEvent | Touch) => {
      // Direct projection from screen pixels to map coordinates
      return map.mouseEventToLatLng(e as any);
    };

    const handleStart = (e: MouseEvent | TouchEvent) => {
      if (!isActive) return;
      L.DomEvent.stop(e);
      
      isDrawingRef.current = true;
      const pos = 'touches' in e ? e.touches[0] : e;
      const latlng = getLatLng(pos);
      
      pointsRef.current = [latlng];
      setPoints([latlng]);
    };

    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!isActive || !isDrawingRef.current) return;
      L.DomEvent.stop(e);
      
      const pos = 'touches' in e ? e.touches[0] : e;
      const latlng = getLatLng(pos);
      
      pointsRef.current.push(latlng);
      setPoints([...pointsRef.current]);
    };

    const handleEnd = (e: MouseEvent | TouchEvent) => {
      if (!isActive || !isDrawingRef.current) return;
      // Note: touchend might not have touches[0], but we're just closing the path
      L.DomEvent.stop(e);
      
      const finalPoints = [...pointsRef.current];
      isDrawingRef.current = false;
      pointsRef.current = [];
      setPoints([]);

      if (finalPoints.length > 5) {
        onFinish(finalPoints);
      }
    };

    // Attach listeners directly to the map container for maximum reliability on mobile
    container.addEventListener('mousedown', handleStart as any);
    container.addEventListener('mousemove', handleMove as any);
    window.addEventListener('mouseup', handleEnd as any);

    container.addEventListener('touchstart', handleStart as any, { passive: false });
    container.addEventListener('touchmove', handleMove as any, { passive: false });
    container.addEventListener('touchend', handleEnd as any, { passive: false });

    return () => {
      container.removeEventListener('mousedown', handleStart as any);
      container.removeEventListener('mousemove', handleMove as any);
      window.removeEventListener('mouseup', handleEnd as any);
      
      container.removeEventListener('touchstart', handleStart as any);
      container.removeEventListener('touchmove', handleMove as any);
      container.removeEventListener('touchend', handleEnd as any);
    };
  }, [isActive, map, onFinish]);

  if (points.length < 2) return null;

  return (
    <Polyline 
      positions={points} 
      pathOptions={{ color: '#10b981', weight: 4, opacity: 0.8, dashArray: '8, 8' }} 
    />
  );
};

const MapController: React.FC<{ 
  houses: House[], 
  isSidebarOpen: boolean,
  activePolygon: L.LatLng[] | null
}> = ({ houses, isSidebarOpen, activePolygon }) => {
  const map = useMap();
  const lastHousesRef = useRef<string>("");
  
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 350); 
    return () => clearTimeout(timer);
  }, [isSidebarOpen, map]);

  useEffect(() => {
    if (houses.length > 0) {
      const currentBatchKey = houses.length + "_" + (houses[0]?.id || "");
      if (currentBatchKey !== lastHousesRef.current) {
        const bounds = L.latLngBounds(houses.map(h => [h.lat, h.lng]));
        if (bounds.isValid()) {
          // Skip the fly-to animation for large datasets so we don't animate and
          // mount thousands of markers at the same time (which stalls the UI).
          map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16, animate: houses.length < 1500 });
          lastHousesRef.current = currentBatchKey;
        }
      }
    }
  }, [houses, map]); 

  useEffect(() => {
    if (activePolygon && activePolygon.length > 2) {
      const bounds = L.latLngBounds(activePolygon);
      map.fitBounds(bounds, { animate: true, duration: 1, padding: [20, 20] });
    }
  }, [activePolygon, map]);

  return null;
};

const createIcon = (status: VisitStatus) => {
  let color = '#64748b'; 
  if (status === VisitStatus.VISITED) color = '#10b981';
  if (status === VisitStatus.REVISIT) color = '#f59e0b';
  if (status === VisitStatus.NOT_INTERESTED) color = '#ef4444';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" stroke="white" stroke-width="1.5">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>`;
  
  return L.divIcon({
    className: 'custom-pin',
    html: `<div style="width: 32px; height: 32px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2))">${svg}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
  });
};

const MapView: React.FC<MapViewProps> = ({ 
  houses, selectedHouse, onSelectHouse, onBoundsChange, onOpenDetails, isSidebarOpen,
  isSelectionMode, activePolygon, onFinishDrawing
}) => {
  const markerRefs = useRef<{ [key: string]: L.Marker | null }>({});
  const clusterRef = useRef<any>(null);
  const [mapBounds, setMapBounds] = useState<L.LatLngBounds | null>(null);
  
  const icons = useMemo(() => ({
    [VisitStatus.TODO]: createIcon(VisitStatus.TODO),
    [VisitStatus.VISITED]: createIcon(VisitStatus.VISITED),
    [VisitStatus.REVISIT]: createIcon(VisitStatus.REVISIT),
    [VisitStatus.NOT_INTERESTED]: createIcon(VisitStatus.NOT_INTERESTED),
  }), []);

  const handleInternalBoundsChange = (bounds: L.LatLngBounds) => {
    setMapBounds(bounds);
    onBoundsChange(bounds);
  };

  // Cap how many markers we mount at once. Mounting thousands of React markers
  // in a single commit freezes the main thread (~2s for ~5k houses), which reads
  // as "the app isn't loading". When zoomed out these individual pins are
  // clustered and indistinguishable anyway; as the user zooms in, the viewport
  // filter naturally drops the in-view count below the cap so all local pins show.
  const MAX_MARKERS = 2000;
  const visibleHouses = useMemo(() => {
    const inView = mapBounds
      ? houses.filter(h => mapBounds.pad(0.1).contains([h.lat, h.lng]))
      : houses;
    return inView.length > MAX_MARKERS ? inView.slice(0, MAX_MARKERS) : inView;
  }, [houses, mapBounds]);

  useEffect(() => {
    if (selectedHouse && markerRefs.current[selectedHouse.id] && clusterRef.current) {
      const marker = markerRefs.current[selectedHouse.id];
      if (marker) {
        clusterRef.current.zoomToShowLayer(marker, () => {
          marker.openPopup();
        });
      }
    }
  }, [selectedHouse]);

  return (
    <div className={`h-full w-full z-0 relative bg-[#f8fafc] ${isSelectionMode ? 'cursor-crosshair selection-mode' : ''}`}>
      <MapContainer
        center={[40.78, -73.4]}
        zoom={9}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
        attributionControl={false}
        maxZoom={22}
        preferCanvas={true}
      >
        <TileLayer
          attribution=''
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={22}
          maxNativeZoom={19}
        />
        <BoundsHandler onBoundsChange={handleInternalBoundsChange} />
        <LassoHandler isActive={isSelectionMode} onFinish={onFinishDrawing} />
        <MapController 
          houses={houses} 
          isSidebarOpen={isSidebarOpen} 
          activePolygon={activePolygon} 
        />
        
        {activePolygon && (
          <Polygon 
            positions={activePolygon}
            pathOptions={{ 
              color: '#10b981', 
              fillColor: '#10b981', 
              fillOpacity: 0.1,
              weight: 2,
              dashArray: '5, 5'
            }}
          />
        )}

        <MarkerClusterGroup
          ref={clusterRef}
          chunkedLoading
          maxClusterRadius={80} // Increased radius for better mobile performance
          showCoverageOnHover={false}
          spiderfyOnMaxZoom={true}
          disableClusteringAtZoom={19}
        >
          {visibleHouses.map(house => (
            <Marker 
              key={house.id} 
              position={[house.lat, house.lng]}
              icon={icons[house.status]}
              ref={(ref) => { markerRefs.current[house.id] = ref; }}
              eventHandlers={{ click: () => onSelectHouse(house) }}
            >
              <Popup className="custom-leaflet-popup">
                <div className="p-1 min-w-[180px]">
                  <h3 className="font-bold text-gray-900 m-0 leading-tight mb-1 text-sm">{house.owner || 'Resident'}</h3>
                  <p className="text-gray-500 text-[11px] m-0 mb-3 leading-snug">{house.address}</p>
                  <button 
                    onClick={(e) => { e.stopPropagation(); onOpenDetails(house); }}
                    className="w-full bg-emerald-600 text-white py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-emerald-700 active:scale-95 transition-all shadow-md"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Update Status
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      </MapContainer>
    </div>
  );
};

export default MapView;
