
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { House, VisitStatus, RegistryEntry, ProgressState } from './types';
import MapView from './components/MapView';
import HouseList from './components/HouseList';
import HouseDetailModal from './components/HouseDetailModal';
import ZipSelect from './components/ZipSelect';
import zipcodesData from './data/zipcodes.json';
import { 
  Settings, Loader2, List as ListIcon, Info, Target, XCircle, 
  ChevronDown, RefreshCw, Trash2, ChevronRight,
  TrendingUp, Home, CheckCircle2, MapPinned, Share2, ClipboardCheck,
  FilterX, Database
} from 'lucide-react';
import L from 'leaflet';
import { db, auth } from '@/firebase';
import { collection, query, where, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';

const isPointInPolygon = (point: { lat: number, lng: number }, polygon: L.LatLng[]) => {
  const x = point.lat, y = point.lng;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat, yi = polygon[i].lng;
    const xj = polygon[j].lat, yj = polygon[j].lng;
    const intersect = ((yi > y) !== (yj > y))
        && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

const defaultRegistry: RegistryEntry[] = Object.entries((zipcodesData.zipData || {}) as Record<string, string>).map(([zip, area]) => ({
  zip,
  area,
  link: ''
}));

const App: React.FC = () => {
  const [registry, setRegistry] = useState<RegistryEntry[]>(defaultRegistry);
  const [socrataHouses, setSocrataHouses] = useState<House[]>([]);
  const [modifiedHouses, setModifiedHouses] = useState<House[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedZip, setSelectedZip] = useState<string>(() => {
    const saved = localStorage.getItem('dawah_selected_zip');
    if (saved && (zipcodesData.zipData as Record<string, string>)[saved]) return saved;
    return defaultRegistry[0]?.zip || '10001';
  });
  const [previewHouseId, setPreviewHouseId] = useState<string | null>(null);
  const [detailHouseId, setDetailHouseId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentBounds, setCurrentBounds] = useState<L.LatLngBounds | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [activePolygon, setActivePolygon] = useState<L.LatLng[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [loadElapsed, setLoadElapsed] = useState(0);

  // Suffolk / NYS GIS zips are much slower to load than NYC Open Data zips, so
  // the loading UI tailors its messaging for them.
  const isSuffolkZip = useMemo(
    () => !/^(100|101|102|103|104|110|111|112|113|114|116)/.test(selectedZip),
    [selectedZip]
  );

  // Drive an elapsed-seconds counter while a load is in flight so the loading
  // indicator visibly moves instead of appearing frozen during slow fetches.
  useEffect(() => {
    if (!loading) { setLoadElapsed(0); return; }
    const start = Date.now();
    setLoadElapsed(0);
    const id = window.setInterval(() => {
      setLoadElapsed(Math.floor((Date.now() - start) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [loading]);

  // Keep the latest registry accessible inside effects without making it a
  // dependency. Otherwise the Firestore active_zips snapshot would change the
  // registry identity and re-trigger a full property re-fetch of the same zip.
  const registryRef = useRef(registry);
  useEffect(() => { registryRef.current = registry; }, [registry]);

  // Authenticate anonymously on load
  useEffect(() => {
    signInAnonymously(auth).catch(err => console.error("Auth error:", err));
  }, []);

  useEffect(() => {
    const updateViewport = () => {
      if (window.visualViewport) {
        const vv = window.visualViewport;
        document.documentElement.style.setProperty('--vh', `${vv.height}px`);
      }
    };
    window.visualViewport?.addEventListener('resize', updateViewport);
    window.visualViewport?.addEventListener('scroll', updateViewport);
    updateViewport();
    return () => {
      window.visualViewport?.removeEventListener('resize', updateViewport);
      window.visualViewport?.removeEventListener('scroll', updateViewport);
    };
  }, []);

  // Listen to Firestore for any active/modified properties across the app
  useEffect(() => {
    // Read local cache backup first
    try {
      const cached = localStorage.getItem('dawah_local_modified_houses');
      if (cached) {
        setModifiedHouses(JSON.parse(cached));
      }
    } catch (e) {
      console.warn("LocalStorage cache read error:", e);
    }

    const q = query(collection(db, 'houses'), where('status', '!=', 'TODO'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const active: House[] = [];
      snapshot.forEach((docSnap) => {
        active.push({ id: docSnap.id, ...docSnap.data() } as House);
      });
      setModifiedHouses(active);
      try {
        localStorage.setItem('dawah_local_modified_houses', JSON.stringify(active));
      } catch (e) {}
    }, (err) => {
      console.warn("Firestore houses listener notice (using local cache & NYC Open Data):", err.message);
      // Gracefully handle quota or offline errors without setting blocking error
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const docRef = doc(db, 'system', 'active_zips');
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists() && docSnap.data().zips && docSnap.data().zips.length > 0) {
        const zips: string[] = docSnap.data().zips;
        const activeEntries = zips.map((z: string) => ({ 
          zip: z, 
          area: (zipcodesData.zipData as Record<string, string>)[z] || `New York`, 
          link: '' 
        }));
        const activeSet = new Set(zips);
        const remaining = defaultRegistry.filter(r => !activeSet.has(r.zip));
        setRegistry([...activeEntries, ...remaining]);
      }
    }, (err) => {
      console.warn("Firestore active_zips listener notice (using standard NYC zip directory):", err.message);
      // Fallback to defaultRegistry is already active, do NOT set fetchError!
    });
    return () => unsubscribe();
  }, []);

  // Fetch live properties via backend API (/api/properties) with client fallback
  useEffect(() => {
    if (!selectedZip) return;
    
    let isCancelled = false;
    setLoading(true);
    setFetchError(null);
    setActivePolygon(null);
    setPreviewHouseId(null);
    
    localStorage.setItem('dawah_selected_zip', selectedZip);

    const loadZipData = async () => {
      try {
        const areaName = registryRef.current.find(r => r.zip === selectedZip)?.area || '';
        const apiUrl = `/api/properties?zip=${selectedZip}&area=${encodeURIComponent(areaName)}`;
        console.log(`Fetching properties for zip ${selectedZip} (${areaName})...`);
        const res = await fetch(apiUrl);
        if (res.ok) {
          const result = await res.json();
          if (isCancelled) return;
          if (result.status === "success" && Array.isArray(result.houses)) {
            setSocrataHouses(result.houses);
            setLoading(false);
            return;
          }
        }
        
        // Direct Fallback if API route is unavailable
        const isNycZip = /^(100|101|102|103|104|110|111|112|113|114|116)/.test(selectedZip);
        if (isNycZip) {
          const nycUrl = `https://data.cityofnewyork.us/resource/64uk-42ks.json?zipcode=${selectedZip}&$select=bbl,address,ownername,latitude,longitude,zipcode&$limit=15000`;
          const nycRes = await fetch(nycUrl);
          if (!nycRes.ok) throw new Error(`NYC Open Data API status ${nycRes.status}`);
          const socrataRecords = await nycRes.json();
          if (isCancelled) return;

          const houses: House[] = [];
          for (const record of socrataRecords) {
            const lat = parseFloat(record.latitude);
            const lng = parseFloat(record.longitude);
            if (!isNaN(lat) && !isNaN(lng)) {
              const bbl = record.bbl ? record.bbl.trim() : `${lat}_${lng}`;
              houses.push({
                id: bbl,
                address: record.address ? record.address.trim() : 'Unknown',
                street: '',
                owner: record.ownername ? record.ownername.trim() : 'Unknown',
                lat,
                lng,
                zip: record.zipcode || selectedZip,
                status: VisitStatus.TODO,
                notes: [],
                lastUpdated: Date.now()
              });
            }
          }
          setSocrataHouses(houses);
        } else {
          // Suffolk GIS Fallback
          const whereZip = `COUNTY_NAME='Suffolk' AND (LOC_ZIP='${selectedZip}' OR MAIL_ZIP LIKE '${selectedZip}%')`;
          const gisUrl = `https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcel_Centroid_Points/FeatureServer/0/query?where=${encodeURIComponent(whereZip)}&outFields=OBJECTID,COUNTY_NAME,MUNI_NAME,LOC_ZIP,PARCEL_ADDR,LOC_ST_NBR,LOC_STREET,CITYTOWN_NAME,PROP_CLASS,PRINT_KEY,SBL,PRIMARY_OWNER,FULL_MARKET_VAL,ACRES,MAIL_ZIP&f=json&resultRecordCount=5000&returnGeometry=true&outSR=4326`;
          
          const gisRes = await fetch(gisUrl);
          if (!gisRes.ok) throw new Error(`NYS GIS API status ${gisRes.status}`);
          const gisData = await gisRes.json();
          if (isCancelled) return;

          const houses: House[] = [];
          for (const f of (gisData.features || [])) {
            const attr = f.attributes || {};
            const geom = f.geometry || {};
            const lat = parseFloat(geom.y);
            const lng = parseFloat(geom.x);
            if (!isNaN(lat) && !isNaN(lng)) {
              const addr = attr.PARCEL_ADDR || `${attr.LOC_ST_NBR || ''} ${attr.LOC_STREET || ''}`.trim() || 'Unknown Address';
              const id = `SUFFOLK_${attr.OBJECTID || attr.PRINT_KEY || `${lat}_${lng}`}`;
              houses.push({
                id,
                address: addr,
                street: attr.LOC_STREET || '',
                owner: attr.PRIMARY_OWNER ? attr.PRIMARY_OWNER.trim() : 'Unknown',
                lat,
                lng,
                zip: attr.LOC_ZIP || selectedZip,
                status: VisitStatus.TODO,
                notes: [],
                lastUpdated: Date.now()
              });
            }
          }
          setSocrataHouses(houses);
        }
        setLoading(false);
      } catch (err: any) {
        console.warn("Properties fetch notice:", err);
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    loadZipData();

    return () => {
      isCancelled = true;
    };
  }, [selectedZip]);

  // Derived state that combines static open-data with modified states from Firestore / LocalStorage
  const currentHouses = useMemo(() => {
    const modifiedMap = new Map<string, House>();
    modifiedHouses.forEach(h => {
      modifiedMap.set(h.id, h);
    });

    const merged = socrataHouses.map(sHouse => {
      const userMod = modifiedMap.get(sHouse.id);
      if (userMod) {
        return {
          ...sHouse,            // Latest live property details (owner, address, lat, lng) from NYC Open Data
          status: userMod.status, // Preserve user's visit status
          notes: userMod.notes,   // Preserve user's saved notes/comments
          lastUpdated: userMod.lastUpdated || sHouse.lastUpdated,
          // Always present the latest owner name from live Open Data, falling back to cached if empty
          owner: (sHouse.owner && sHouse.owner !== 'Unknown') ? sHouse.owner : userMod.owner,
          address: (sHouse.address && sHouse.address !== 'Unknown') ? sHouse.address : userMod.address
        };
      }
      return sHouse;
    });

    // Also append modified properties that belong to this zip but not fetched or returned by Socrata
    const socrataIds = new Set(socrataHouses.map(s => s.id));
    modifiedHouses.forEach(mHouse => {
      if (mHouse.zip === selectedZip && !socrataIds.has(mHouse.id)) {
        merged.push(mHouse);
      }
    });

    return merged;
  }, [socrataHouses, modifiedHouses, selectedZip]);

  const updateHouse = async (id: string, updates: Partial<House>) => {
    const origHouse = currentHouses.find(h => h.id === id);
    if (!origHouse) return;

    const updatedHouse: House = {
      ...origHouse,
      ...updates,
      lastUpdated: Date.now()
    };

    // Optimistic local UI updates
    setSocrataHouses(prev => prev.map(h => h.id === id ? updatedHouse : h));
    setModifiedHouses(prev => {
      const nextMods = prev.some(h => h.id === id)
        ? prev.map(h => h.id === id ? updatedHouse : h)
        : [...prev, updatedHouse];
      try {
        localStorage.setItem('dawah_local_modified_houses', JSON.stringify(nextMods));
      } catch (e) {}
      return nextMods;
    });

    // Save/Merge in Firestore
    try {
      const houseRef = doc(db, 'houses', id);
      await setDoc(houseRef, updatedHouse, { merge: true });
    } catch (err: any) {
      console.warn("Firestore save notice (saved locally in browser):", err.message);
      if (err?.message?.includes('Quota exceeded')) {
        alert("Note: Cloud database daily free quota reached. Your edit is safely stored locally in your browser.");
      }
    }
  };

  const clearFilter = () => {
    setActivePolygon(null);
    setIsSelectionMode(false);
  };

  const filteredHouses = useMemo(() => {
    return currentHouses.filter(h => {
      if (activePolygon && activePolygon.length > 2) {
        if (!isPointInPolygon({ lat: h.lat, lng: h.lng }, activePolygon)) return false;
      } 
      else if (listOpen && currentBounds) {
        if (!currentBounds.contains([h.lat, h.lng])) return false;
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (h.address || "").toLowerCase().includes(q) || (h.owner || "").toLowerCase().includes(q);
      }
      return true;
    });
  }, [currentHouses, currentBounds, searchQuery, activePolygon, listOpen]);

  const stats = useMemo(() => {
    const total = filteredHouses.length;
    const visited = filteredHouses.filter(h => h.status !== VisitStatus.TODO).length;
    const followups = filteredHouses.filter(h => h.status === VisitStatus.REVISIT).length;
    return { total, visited, followups, progress: total > 0 ? (visited / total) * 100 : 0 };
  }, [filteredHouses]);

  const currentAreaName = useMemo(() => {
    return registry.find(r => r.zip === selectedZip)?.area || selectedZip;
  }, [registry, selectedZip]);

  const copyReportToClipboard = () => {
    const text = `🕌 *Dawah Impact Report*\n📍 *Area:* ${currentAreaName} (${selectedZip})\n✅ *Coverage:* ${Math.round(stats.progress)}%\n🏠 *Total Visited:* ${stats.visited}\n⏳ *Follow-ups:* ${stats.followups}\n\nGenerated via DAWAHMAP`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading && currentHouses.length === 0 && registry.length === 0) {
    return (
      <div className="h-full w-screen flex flex-col items-center justify-center bg-emerald-50 text-emerald-800">
        <Loader2 className="w-10 h-10 animate-spin mb-4" />
        <p className="font-bold tracking-tight uppercase text-xs tracking-[0.2em]">Initializing DAWAHMAP</p>
      </div>
    );
  }

  return (
    <div 
      className="flex w-full max-w-[1440px] mx-auto bg-slate-900 overflow-hidden relative shadow-2xl font-sans"
      style={{ height: 'var(--vh, 100dvh)' }}
    >
      <HouseList 
        houses={filteredHouses}
        isOpen={listOpen}
        selectedHouseId={previewHouseId}
        onToggle={() => setListOpen(!listOpen)}
        onSelectHouse={(h) => setPreviewHouseId(h.id)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      <div className="absolute top-4 left-4 right-4 z-[30] flex flex-col gap-2 pointer-events-none">
        <div className="bg-white/90 backdrop-blur shadow-lg rounded-2xl p-2 sm:p-3 flex items-center gap-2 sm:gap-4 pointer-events-auto border border-gray-100">
          <button onClick={() => setListOpen(true)} className="p-2 bg-emerald-600 text-white rounded-xl shadow-lg hover:bg-emerald-700 active:scale-95 shrink-0">
            <ListIcon className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0 flex items-center gap-3">
            <div className="hidden sm:block">
              <h1 className="text-xs font-black text-gray-400 uppercase tracking-widest leading-none mb-1">DAWAHMAP</h1>
              <div className="w-24 bg-gray-100 rounded-full h-1 overflow-hidden">
                <div className="bg-emerald-500 h-full transition-all duration-700" style={{ width: `${stats.progress}%` }} />
              </div>
            </div>
            <ZipSelect 
              registry={registry} 
              selectedZip={selectedZip} 
              onChange={setSelectedZip} 
            />
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
             <button 
                onClick={() => { 
                  if (activePolygon) clearFilter();
                  else {
                    setIsSelectionMode(!isSelectionMode); 
                    if (!isSelectionMode) setActivePolygon(null);
                  }
                }} 
                className={`p-2 rounded-lg transition-all ${isSelectionMode || activePolygon ? 'bg-emerald-600 text-white ring-2 ring-emerald-300 shadow-xl scale-110' : 'text-gray-500 hover:bg-gray-100'}`} 
                title={activePolygon ? "Clear Drawn Filter" : "Draw Area Filter"}
              >
                {activePolygon ? <FilterX className="w-5 h-5" /> : <Target className="w-5 h-5" />}
              </button>
             <button onClick={() => setSettingsOpen(true)} className={`p-2 rounded-lg relative ${fetchError ? 'text-rose-500 bg-rose-50' : 'text-gray-500 hover:bg-gray-100'}`} title="DAWAHMAP">
                <Settings className="w-5 h-5" />
                {fetchError && <div className="absolute top-1 right-1 w-2 h-2 bg-rose-500 rounded-full border border-white animate-pulse" />}
              </button>
          </div>
        </div>
      </div>

      <div className="h-full w-full relative">
        <MapView 
          houses={currentHouses} 
          selectedHouse={previewHouseId ? currentHouses.find(h => h.id === previewHouseId) || null : null}
          onSelectHouse={(h) => setPreviewHouseId(h.id)} 
          onOpenDetails={(h) => setDetailHouseId(h.id)}
          onBoundsChange={setCurrentBounds}
          isSidebarOpen={listOpen}
          isSelectionMode={isSelectionMode}
          activePolygon={activePolygon}
          onFinishDrawing={(polygon) => { setActivePolygon(polygon); setIsSelectionMode(false); }}
        />
        
        {/* FLOATING ACTION & STATUS PILLS (CENTERED) */}
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-[40] flex flex-col items-center gap-3 pointer-events-none w-max">
           {loading && (
              <div className="bg-white/95 backdrop-blur-md border border-emerald-100 px-4 py-3 rounded-2xl shadow-lg flex flex-col gap-2 min-w-[230px] max-w-[280px] animate-in fade-in slide-in-from-top-4 duration-300 pointer-events-auto">
                 <div className="flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-emerald-500 animate-spin shrink-0" />
                    <span className="text-emerald-700 font-black text-[10px] uppercase tracking-[0.15em] flex-1">
                       {isSuffolkZip ? 'Loading Parcel Records' : 'Syncing Database'}
                    </span>
                    <span className="text-emerald-400 font-bold text-[10px] tabular-nums">{loadElapsed}s</span>
                 </div>
                 <div className="h-1 w-full bg-emerald-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full animate-indeterminate" />
                 </div>
                 {isSuffolkZip && loadElapsed >= 3 && (
                    <span className="text-[9px] text-slate-400 font-medium leading-snug">
                       First load of a new county area can take up to ~20s. It'll be instant next time.
                    </span>
                 )}
              </div>
           )}

           {activePolygon && (
              <button 
                onClick={clearFilter}
                className="bg-emerald-600 text-white px-5 py-2.5 rounded-full shadow-2xl flex items-center gap-2 font-black text-[10px] uppercase tracking-[0.2em] active:scale-95 transition-all border-2 border-white/20 backdrop-blur-md pointer-events-auto"
              >
                <XCircle className="w-4 h-4" /> Clear Drawn Filter
              </button>
           )}
        </div>

        <div 
          className="absolute left-6 z-[20] flex bg-white/95 backdrop-blur-md rounded-2xl p-3.5 sm:p-4 shadow-[0_8px_30px_rgb(0,0,0,0.15)] border border-gray-100 flex-col gap-1 pointer-events-auto min-w-[140px]"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 32px)' }}
        >
          <div className="text-[10px] font-black text-gray-400 uppercase tracking-[0.15em] flex items-center gap-1.5 mb-0.5">
            <Info className="w-3 h-3 text-emerald-500"/> 
            <span className="truncate max-w-[120px]">
              {activePolygon ? 'Drawn Area' : (listOpen ? 'In View' : 'Total Area')}
            </span>
          </div>
          <div className="text-sm sm:text-base font-black text-slate-800 leading-none mb-0.5">
            {stats.visited} / {stats.total} <span className="text-[10px] uppercase font-bold text-slate-400 ml-1 tracking-wider">Visited</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
             <div className="flex-1 bg-emerald-100 h-1 rounded-full overflow-hidden">
                <div className="bg-emerald-500 h-full transition-all duration-700" style={{ width: `${stats.progress}%` }} />
             </div>
             <div className="text-[11px] font-black text-emerald-600 whitespace-nowrap">
               {Math.round(stats.progress)}%
             </div>
          </div>
        </div>
      </div>

      <HouseDetailModal 
        house={detailHouseId ? currentHouses.find(h => h.id === detailHouseId) || null : null} 
        onClose={() => setDetailHouseId(null)} 
        onUpdate={updateHouse}
      />

      {settingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4" onClick={() => setSettingsOpen(false)}>
          <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl p-6 w-full max-w-md animate-slide-up flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-xl font-black text-gray-800 tracking-tight">DAWAHMAP</h3>
                <p className="text-xs font-bold text-emerald-600 uppercase tracking-widest">Outreach Status</p>
              </div>
              <button onClick={() => setSettingsOpen(false)} className="bg-gray-100 p-2 rounded-full text-gray-400">
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            
            <div className="space-y-6 overflow-y-auto custom-scroll pr-1 pb-6">
              <div className="space-y-4">
                <div className="px-2">
                  <h4 className="text-[10px] font-black uppercase text-gray-400 tracking-[0.2em] flex items-center gap-2">
                    <Database className="w-4 h-4 text-emerald-500" /> DATABASE STATUS
                  </h4>
                  <p className="text-xs text-gray-500 mt-1">
                    Houses are now synced from the cloud database instead of local CSV files.
                  </p>
                </div>
              </div>

              <button 
                onClick={() => { setReportOpen(true); setSettingsOpen(false); }}
                className="w-full bg-slate-900 text-white p-5 rounded-2xl shadow-xl flex items-center justify-between group active:scale-[0.98] transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className="bg-emerald-500 p-3 rounded-xl shadow-lg shadow-emerald-500/20">
                    <TrendingUp className="w-6 h-6" />
                  </div>
                  <div className="text-left">
                    <p className="text-lg font-black leading-none mb-1 tracking-tight">Impact Report</p>
                    <p className="text-xs text-slate-400 font-medium">Generate social shareables</p>
                  </div>
                </div>
                <div className="bg-white/10 p-2 rounded-full group-hover:translate-x-1 transition-transform">
                   <ChevronRight className="w-4 h-4 text-emerald-400" />
                </div>
              </button>

              <button 
                onClick={async () => {
                  if (window.confirm("This will force the server to fetch the next 19,000 properties. This uses your Firebase daily quota. Continue?")) {
                    setSettingsOpen(false);
                    try {
                      const res = await fetch('/api/cron-task?force=true');
                      const data = await res.json();
                      alert(data.message);
                    } catch (err: any) {
                      alert(`Error: ${err.message}`);
                    }
                  }
                }}
                className="w-full bg-amber-50 text-amber-900 border border-amber-200 p-5 rounded-2xl shadow-sm flex items-center justify-between group active:scale-[0.98] transition-all mt-4"
              >
                <div className="flex items-center gap-4">
                  <div className="bg-amber-100 p-3 rounded-xl">
                    <Database className="w-6 h-6 text-amber-600" />
                  </div>
                  <div className="text-left">
                    <p className="text-lg font-black leading-none mb-1 tracking-tight">Force Data Sync</p>
                    <p className="text-xs text-amber-700/70 font-medium">Fetch next 19,000 properties</p>
                  </div>
                </div>
                <div className="bg-amber-200/50 p-2 rounded-full group-hover:translate-x-1 transition-transform">
                   <ChevronRight className="w-4 h-4 text-amber-700" />
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {reportOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-emerald-950/90 backdrop-blur-md p-4" onClick={() => setReportOpen(false)}>
          <div className="w-full max-w-md bg-white rounded-[40px] shadow-2xl overflow-hidden animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="bg-emerald-600 p-8 pb-12 text-white relative overflow-hidden">
               <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16" />
               <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/5 rounded-full -ml-8 -mb-8" />
               
               <div className="relative z-10 flex flex-col items-center">
                  <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-100 mb-6">Dawah Impact Summary</h4>
                  
                  <div className="w-48 h-48 rounded-full border-8 border-white/20 flex flex-col items-center justify-center mb-8 relative">
                    <svg className="absolute inset-0 w-full h-full -rotate-90">
                      <circle 
                        cx="96" cy="96" r="88" 
                        fill="transparent" 
                        stroke="white" 
                        strokeWidth="8" 
                        strokeDasharray={2 * Math.PI * 88} 
                        strokeDashoffset={2 * Math.PI * 88 * (1 - stats.progress/100)} 
                        strokeLinecap="round"
                        className="transition-all duration-1000 ease-out"
                      />
                    </svg>
                    <span className="text-5xl font-black leading-none">{Math.round(stats.progress)}%</span>
                    <span className="text-xs font-bold uppercase tracking-widest text-emerald-100 mt-1">Complete</span>
                  </div>

                  <h3 className="text-3xl font-black text-center mb-1 leading-tight">{currentAreaName}</h3>
                  <p className="text-emerald-100 font-bold opacity-80 uppercase tracking-widest text-xs">Neighborhood Coverage</p>
               </div>
            </div>

            <div className="p-8 -mt-8 bg-white rounded-t-[40px] relative z-20">
              <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="bg-emerald-50 p-4 rounded-3xl border border-emerald-100">
                  <div className="flex items-center gap-2 text-emerald-700 font-bold text-xs uppercase tracking-widest mb-1">
                    <CheckCircle2 className="w-4 h-4" /> Visited
                  </div>
                  <div className="text-3xl font-black text-emerald-900">{stats.visited}</div>
                </div>
                <div className="bg-amber-50 p-4 rounded-3xl border border-amber-100">
                  <div className="flex items-center gap-2 text-amber-700 font-bold text-xs uppercase tracking-widest mb-1">
                    <TrendingUp className="w-4 h-4" /> Follow-ups
                  </div>
                  <div className="text-3xl font-black text-amber-900">{stats.followups}</div>
                </div>
              </div>

              <div className="space-y-3">
                <button 
                  onClick={copyReportToClipboard}
                  className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black flex items-center justify-center gap-3 active:scale-95 transition-all shadow-lg"
                >
                  {copied ? <ClipboardCheck className="w-5 h-5 text-emerald-400" /> : <Share2 className="w-5 h-5" />}
                  {copied ? 'Copied to Clipboard' : 'Copy Text for WhatsApp'}
                </button>
                <button 
                  onClick={() => setReportOpen(false)}
                  className="w-full text-slate-400 py-3 text-xs font-black uppercase tracking-widest"
                >
                  Dismiss
                </button>
              </div>
              
              <p className="text-center text-[10px] text-slate-300 font-bold uppercase tracking-widest mt-6">
                Generated {new Date().toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
