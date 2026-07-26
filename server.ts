import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getFirestore, writeBatch, doc, getDoc, getDocs, collection } from "firebase/firestore";
import fs from "fs";
import zlib from "zlib";

// Read config and zipcodes safely
let dbInstance: any = null;
let authInstance: any = null;

// --- Data pipeline performance helpers -------------------------------------
// Property data changes rarely, so we serve it from a per-instance in-memory
// cache with a long TTL. This turns repeat zip loads from multi-second upstream
// fetches into sub-millisecond responses. Payloads are pre-gzipped once so every
// cache hit avoids re-compressing.
const PROPERTY_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
type CachedPayload = { raw: string; gz: Buffer; expires: number };
const propertyCache = new Map<string, CachedPayload>();

function buildPayload(obj: unknown): { raw: string; gz: Buffer } {
  const raw = JSON.stringify(obj);
  const gz = zlib.gzipSync(raw);
  return { raw, gz };
}

// Send a JSON payload with gzip (when accepted) and CDN/browser cache headers.
function sendJsonPayload(
  req: express.Request,
  res: express.Response,
  payload: { raw: string; gz: Buffer },
  maxAgeSec: number
) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    `public, max-age=${maxAgeSec}, stale-while-revalidate=86400`
  );
  res.setHeader("Vary", "Accept-Encoding");
  const acceptsGzip = (req.headers["accept-encoding"] || "").includes("gzip");
  if (acceptsGzip && payload.gz.length > 0) {
    res.setHeader("Content-Encoding", "gzip");
    return res.end(payload.gz);
  }
  return res.end(payload.raw);
}

function getDb() {
  if (!dbInstance) {
    const firebaseConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf-8'));
    const firebaseApp = initializeApp(firebaseConfig);
    dbInstance = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
  }
  return dbInstance;
}

function getAuthClient() {
  if (!authInstance) {
    const firebaseConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf-8'));
    const firebaseApp = initializeApp(firebaseConfig);
    authInstance = getAuth(firebaseApp);
  }
  return authInstance;
}

function getNycZipCodes(): string[] {
  try {
    const zipcodesData = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'zipcodes.json'), 'utf-8'));
    return zipcodesData.allZips || [];
  } catch (err) {
    console.error("Error reading zipcodes.json:", err);
    return [];
  }
}

// Helper to track daily usage
async function getDailyUsage() {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  const usageRef = doc(db, 'system', `usage_${today}`);
  const snap = await getDoc(usageRef);
  if (snap.exists()) {
    return snap.data().count || 0;
  }
  return 0;
}

async function incrementDailyUsage(count: number) {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  const usageRef = doc(db, 'system', `usage_${today}`);
  const current = await getDailyUsage();
  await writeBatch(db).set(usageRef, { count: current + count, lastUpdated: Date.now() }, { merge: true }).commit();
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", version: "1.2.0" });
  });

  // Unified Properties Endpoint (NYC & Suffolk County / NYS)
  app.get("/api/properties", async (req, res) => {
    const zip = req.query.zip as string;
    const areaName = (req.query.area as string) || "";
    if (!zip) return res.status(400).json({ status: "error", message: "Zip parameter is required" });

    // Serve from cache instantly when fresh (snappy repeat loads).
    const cacheKey = `${zip}|${areaName}`;
    const cached = propertyCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      const remainingSec = Math.max(60, Math.floor((cached.expires - Date.now()) / 1000));
      return sendJsonPayload(req, res, cached, remainingSec);
    }

    try {
      // Determine if NYC zip code (100xx, 103xx, 104xx, 110xx, 111xx, 112xx, 113xx, 114xx, 116xx)
      const isNycZip = /^(100|101|102|103|104|110|111|112|113|114|116)/.test(zip);

      if (isNycZip) {
        // Fetch only the columns we render and skip the server-side $order sort:
        // both shrink the upstream query time and the payload size significantly.
        const select = "bbl,address,ownername,latitude,longitude,zipcode";
        const url = `https://data.cityofnewyork.us/resource/64uk-42ks.json?zipcode=${zip}&$select=${select}&$limit=15000`;
        console.log(`Fetching NYC Open Data for zip ${zip}...`);
        const dataRes = await fetch(url);
        if (!dataRes.ok) throw new Error(`NYC Open Data status ${dataRes.status}`);
        const socrataRecords = await dataRes.json();

        const houses = [];
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
              zip: record.zipcode || zip,
              status: 'TODO',
              notes: [],
              lastUpdated: Date.now()
            });
          }
        }
        const payload = buildPayload({ status: "success", source: "NYC_OPEN_DATA", count: houses.length, houses });
        propertyCache.set(cacheKey, { ...payload, expires: Date.now() + PROPERTY_TTL_MS });
        return sendJsonPayload(req, res, payload, Math.floor(PROPERTY_TTL_MS / 1000));
      } else {
        // Suffolk County / NYS GIS Tax Parcel Centroid Points
        let effectiveZip = zip;
        if (zip === '11734') effectiveZip = '11743'; // Map transposed typo 11734 -> 11743 (Huntington, NY)

        let effectiveArea = areaName;
        if (!effectiveArea || effectiveArea.trim() === '' || zip === '11734') {
          effectiveArea = 'Huntington (Suffolk)';
        }

        console.log(`Fetching NYS GIS Tax Parcels for Suffolk zip ${effectiveZip} (${effectiveArea})...`);
        const cleanArea = effectiveArea.replace(/\s*\(Suffolk\)/i, '').replace(/\/.*/, '').replace(/\s*Station\b/i, '').trim();

        // 1. Primary physical query by LOC_ZIP or exact citytown match
        const wherePhysical = `COUNTY_NAME='Suffolk' AND (LOC_ZIP='${effectiveZip}' OR CITYTOWN_NAME='${cleanArea}' OR MUNI_NAME='${cleanArea}')`;
        // 2. Secondary mailing query
        const whereMail = `COUNTY_NAME='Suffolk' AND MAIL_ZIP LIKE '${effectiveZip}%'`;

        const fields = 'OBJECTID,COUNTY_NAME,MUNI_NAME,LOC_ZIP,PARCEL_ADDR,LOC_ST_NBR,LOC_STREET,CITYTOWN_NAME,PROP_CLASS,PRINT_KEY,SBL,PRIMARY_OWNER,FULL_MARKET_VAL,ACRES,MAIL_ZIP';

        const fetchGISPage = async (whereStr: string, offset: number = 0) => {
          const gisUrl = `https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Tax_Parcel_Centroid_Points/FeatureServer/0/query?where=${encodeURIComponent(whereStr)}&outFields=${fields}&f=json&resultRecordCount=1000&resultOffset=${offset}&returnGeometry=true&outSR=4326`;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 20000);
          try {
            const res = await fetch(gisUrl, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!res.ok) return [];
            const data = await res.json();
            return data.features || [];
          } catch (e) {
            clearTimeout(timeoutId);
            return [];
          }
        };

        try {
          // Fetch up to 10 pages of mail zip results and 3 pages of physical results in parallel
          const mailOffsets = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000];
          const physOffsets = [0, 1000, 2000];

          const pagePromises = [
            ...mailOffsets.map(off => fetchGISPage(whereMail, off)),
            ...physOffsets.map(off => fetchGISPage(wherePhysical, off))
          ];

          const pageResults = await Promise.all(pagePromises);

          const rawFeaturesMap = new Map();
          pageResults.flat().forEach((f: any) => {
            const id = f.attributes?.OBJECTID || f.attributes?.PRINT_KEY;
            if (id && !rawFeaturesMap.has(id)) {
              rawFeaturesMap.set(id, f);
            }
          });

          const rawFeatures = Array.from(rawFeaturesMap.values());

          // 1. Calculate centroid: Prefer physical match (LOC_ZIP or MUNI_NAME/CITYTOWN_NAME match)
          let targetLat = 0;
          let targetLng = 0;
          let locMatchCount = 0;

          const exactPhysicals = rawFeatures.filter((f: any) => {
            const locZip = (f.attributes?.LOC_ZIP || '').trim();
            const ct = (f.attributes?.CITYTOWN_NAME || '').toLowerCase();
            const mu = (f.attributes?.MUNI_NAME || '').toLowerCase();
            return locZip === effectiveZip || (cleanArea && (ct.includes(cleanArea.toLowerCase()) || mu.includes(cleanArea.toLowerCase())));
          });

          if (exactPhysicals.length >= 10) {
            for (const f of exactPhysicals) {
              const y = parseFloat(f.geometry?.y || 0);
              const x = parseFloat(f.geometry?.x || 0);
              if (y && x) { targetLat += y; targetLng += x; locMatchCount++; }
            }
            if (locMatchCount > 0) {
              targetLat /= locMatchCount;
              targetLng /= locMatchCount;
            }
          }

          // Fallback if no exact physical matches (common in Suffolk GIS where LOC_ZIP is NULL): compute spatial MEDIAN
          if (targetLat === 0 || targetLng === 0) {
            const validLats = rawFeatures.map((f: any) => parseFloat(f.geometry?.y || 0)).filter(y => y > 0).sort((a, b) => a - b);
            const validLngs = rawFeatures.map((f: any) => parseFloat(f.geometry?.x || 0)).filter(x => x < 0).sort((a, b) => a - b);

            if (validLats.length > 0 && validLngs.length > 0) {
              targetLat = validLats[Math.floor(validLats.length / 2)];
              targetLng = validLngs[Math.floor(validLngs.length / 2)];
            }
          }

          // Dynamic max distance threshold (in km)
          // Wide geographic zips (e.g. Huntington 11743, Riverhead 11901) get up to 7.5km; standard town zips get 3.8km - 4.2km
          let maxKm = 4.2;
          if (['11743', '11734', '11768', '11901', '11968', '11937', '11772'].includes(effectiveZip)) {
            maxKm = 7.5;
          } else {
            maxKm = 3.8;
          }

          const houses = [];
          for (const f of rawFeatures) {
            const attr = f.attributes || {};
            const geom = f.geometry || {};
            const lat = parseFloat(geom.y);
            const lng = parseFloat(geom.x);

            if (!isNaN(lat) && !isNaN(lng)) {
              const locZip = (attr.LOC_ZIP || '').trim();

              // Distance filter from town centroid
              if (targetLat !== 0 && targetLng !== 0) {
                const dLat = (lat - targetLat) * 111;
                const dLng = (lng - targetLng) * 111 * Math.cos(lat * Math.PI / 180);
                const distKm = Math.sqrt(dLat * dLat + dLng * dLng);

                // Strictly filter out distant properties outside the town radius
                if (distKm > maxKm) continue;
              }

              const rawAddr = attr.PARCEL_ADDR || `${attr.LOC_ST_NBR || ''} ${attr.LOC_STREET || ''}`.trim();
              if (!rawAddr || rawAddr.includes('UNDERWATER') || rawAddr.includes('L I SOUND')) continue;

              const id = `SUFFOLK_${attr.OBJECTID || attr.PRINT_KEY || `${lat}_${lng}`}`;
              houses.push({
                id,
                address: rawAddr,
                street: attr.LOC_STREET || '',
                owner: attr.PRIMARY_OWNER ? attr.PRIMARY_OWNER.trim() : 'Unknown',
                lat,
                lng,
                zip: attr.LOC_ZIP || zip,
                status: 'TODO',
                notes: [],
                lastUpdated: Date.now()
              });
            }
          }
          const payload = buildPayload({ status: "success", source: "NYS_GIS_SUFFOLK", count: houses.length, houses });
          propertyCache.set(cacheKey, { ...payload, expires: Date.now() + PROPERTY_TTL_MS });
          return sendJsonPayload(req, res, payload, Math.floor(PROPERTY_TTL_MS / 1000));
        } catch (fetchErr: any) {
          throw fetchErr;
        }
      }
    } catch (err: any) {
      console.error("Properties fetch error:", err);
      res.status(500).json({ status: "error", message: err.message });
    }
  });

  // Adhoc Sync Endpoint
  app.get("/api/adhoc-sync", async (req, res) => {
    const zip = req.query.zip as string;
    if (!zip) return res.status(400).json({ status: "error", message: "Zip parameter is required" });

    console.log(`Adhoc sync requested for zip: ${zip}`);
    try {
      const db = getDb();
      const auth = getAuthClient();
      await signInAnonymously(auth);

      // 1. Check Usage
      const DAILY_MAX = 19000;
      const currentUsage = await getDailyUsage();
      const remainingQuota = Math.max(0, DAILY_MAX - currentUsage);

      if (remainingQuota <= 0) {
        return res.json({ 
          status: "skipped", 
          message: "Daily quota of 19,000 writes already reached. Try again tomorrow." 
        });
      }

      // 2. Check NYC Total for this zip
      const countUrl = `https://data.cityofnewyork.us/resource/64uk-42ks.json?zipcode=${zip}&$select=count(*)`;
      const countRes = await fetch(countUrl);
      const countData = await countRes.json();
      const totalInNYC = parseInt(countData[0].count);

      // 3. Determine how many we can fetch
      const fetchLimit = Math.min(totalInNYC, remainingQuota);
      
      console.log(`Zip ${zip} has ${totalInNYC} total records. Remaining quota: ${remainingQuota}. Fetching ${fetchLimit}...`);

      // 4. Fetch and Process
      const apiUrl = `https://data.cityofnewyork.us/resource/64uk-42ks.json?zipcode=${zip}&$limit=${fetchLimit}&$order=bbl`;
      const dataRes = await fetch(apiUrl);
      const records = await dataRes.json();

      const houses = [];
      for (const record of records) {
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
            zip: record.zipcode || zip,
            status: 'TODO',
            notes: [],
            lastUpdated: Date.now()
          });
        }
      }

      // 5. Batch Write
      const BATCH_SIZE = 500;
      for (let i = 0; i < houses.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = houses.slice(i, i + BATCH_SIZE);
        for (const house of chunk) {
          batch.set(doc(db, 'houses', house.id), house, { merge: true });
        }
        await batch.commit();
      }

      // 6. Update Usage and Active Zips
      await incrementDailyUsage(houses.length);

      const activeZipsRef = doc(db, 'system', 'active_zips');
      const activeZipsSnap = await getDoc(activeZipsRef);
      let activeZips = new Set<string>();
      if (activeZipsSnap.exists() && activeZipsSnap.data().zips) {
        activeZipsSnap.data().zips.forEach((z: string) => activeZips.add(z));
      }
      if (!activeZips.has(zip)) {
        activeZips.add(zip);
        const sortedZips = Array.from(activeZips).sort();
        await writeBatch(db).set(activeZipsRef, { zips: sortedZips, lastUpdated: Date.now() }, { merge: true }).commit();
      }

      res.json({
        status: "success",
        zipCode: zip,
        totalInNYC,
        dailyQuotaRemaining: remainingQuota - houses.length,
        recordsAdded: houses.length,
        message: houses.length < totalInNYC 
          ? `Partial sync complete. Added ${houses.length} of ${totalInNYC} records. Quota reached.`
          : `Full sync complete! Added all ${totalInNYC} records for zip ${zip}.`
      });

    } catch (error: any) {
      console.error("Adhoc sync failed:", error);
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  app.get("/api/cron-task", async (req, res) => {
    console.log("Cron task started at:", new Date().toISOString());
    try {
      const db = getDb();
      const auth = getAuthClient();
      const nycZipCodes = getNycZipCodes();
      await signInAnonymously(auth);
      
      // 1. Check Usage
      const DAILY_MAX = 19000;
      const currentUsage = await getDailyUsage();
      const remainingQuota = Math.max(0, DAILY_MAX - currentUsage);

      if (remainingQuota <= 0) {
        return res.json({ 
          status: "skipped", 
          message: "Daily quota of 19,000 writes already reached. Try again tomorrow." 
        });
      }

      // 2. Read Global Sync State from Firestore
      const syncStateRef = doc(db, 'system', 'cron_state');
      const stateSnap = await getDoc(syncStateRef);
      
      let state = {
        zipIndex: 0,
        offset: 0,
        lastRun: 0
      };

      if (stateSnap.exists()) {
        state = stateSnap.data() as typeof state;
      }

      // Safety check: Prevent running more than once every 20 hours to avoid quota exhaustion
      // Allow override with ?force=true for manual testing
      const HOURS_20 = 20 * 60 * 60 * 1000;
      if (!req.query.force && Date.now() - state.lastRun < HOURS_20) {
        return res.json({ 
          status: "skipped", 
          message: "Cron already ran today. Use ?force=true to override and run anyway." 
        });
      }

      let totalRecordsFetched = 0;
      let totalHousesWritten = 0;
      const processedZips = new Set<string>();
      let nextMessage = "";

      // Loop to process multiple zips if we haven't hit the remainingQuota limit
      while (totalRecordsFetched < remainingQuota && nycZipCodes.length > 0) {
        // If we finished all zip codes, loop back to the beginning to update existing records
        if (state.zipIndex >= nycZipCodes.length) {
          state.zipIndex = 0;
          state.offset = 0;
        }

        const currentZip = nycZipCodes[state.zipIndex];
        const fetchLimit = remainingQuota - totalRecordsFetched;
        
        console.log(`Fetching NYC Open Data for zip: ${currentZip}, offset: ${state.offset}, limit: ${fetchLimit}`);
        
        // 2. Fetch Data from NYC Open Data
        const apiUrl = `https://data.cityofnewyork.us/resource/64uk-42ks.json?zipcode=${currentZip}&$limit=${fetchLimit}&$offset=${state.offset}&$order=bbl`;
        
        const dataRes = await fetch(apiUrl);
        if (!dataRes.ok) throw new Error(`NYC API Error: ${dataRes.statusText}`);
        
        const records = await dataRes.json();
        totalRecordsFetched += records.length;
        processedZips.add(currentZip);
        
        const houses = [];
        for (const record of records) {
          const lat = parseFloat(record.latitude);
          const lng = parseFloat(record.longitude);

          if (!isNaN(lat) && !isNaN(lng)) {
            const addr = record.address ? record.address.trim() : 'Unknown';
            const bbl = record.bbl ? record.bbl.trim() : `${lat}_${lng}`;
            
            houses.push({
              id: bbl,
              address: addr,
              street: '', 
              owner: record.ownername ? record.ownername.trim() : 'Unknown',
              lat,
              lng,
              zip: record.zipcode || currentZip,
              status: 'TODO',
              notes: [],
              lastUpdated: Date.now()
            });
          }
        }
        
        console.log(`Parsed ${houses.length} valid houses for ${currentZip}. Writing to Firestore...`);
        totalHousesWritten += houses.length;
        
        // 3. Batch write to Firestore
        const BATCH_SIZE = 500;
        for (let i = 0; i < houses.length; i += BATCH_SIZE) {
          const batch = writeBatch(db);
          const chunk = houses.slice(i, i + BATCH_SIZE);
          
          for (const house of chunk) {
            const docRef = doc(db, 'houses', house.id);
            batch.set(docRef, house, { merge: true });
          }
          
          await batch.commit();
        }

        // 4. Calculate Next State
        if (records.length < fetchLimit) {
          // We fetched fewer records than requested, meaning we reached the end of this zip code!
          state.zipIndex++;
          state.offset = 0;
          nextMessage = `Finished zip ${currentZip}.`;
        } else {
          // We hit the fetch limit, meaning there are more records in this zip code.
          state.offset += fetchLimit;
          nextMessage = `Zip ${currentZip} has more records. Next run will continue at offset ${state.offset}.`;
          break; // Exit the loop since we hit our total limit
        }
      }
      
      state.lastRun = Date.now();

      // 5. Save State and Usage
      await incrementDailyUsage(totalHousesWritten);
      const stateBatch = writeBatch(db);
      stateBatch.set(syncStateRef, state, { merge: true });
      
      // Also update the active_zips document so the UI knows which zips are available
      const activeZipsRef = doc(db, 'system', 'active_zips');
      const activeZipsSnap = await getDoc(activeZipsRef);
      let activeZips = new Set<string>();
      if (activeZipsSnap.exists() && activeZipsSnap.data().zips) {
        activeZipsSnap.data().zips.forEach((z: string) => activeZips.add(z));
      }
      
      let zipsChanged = false;
      processedZips.forEach(z => {
        if (!activeZips.has(z)) {
          activeZips.add(z);
          zipsChanged = true;
        }
      });

      if (zipsChanged) {
        const sortedZips = Array.from(activeZips).sort();
        stateBatch.set(activeZipsRef, { zips: sortedZips, lastUpdated: Date.now() }, { merge: true });
      }

      await stateBatch.commit();

      res.json({ 
        status: "success", 
        message: `Cron task executed successfully. Loaded ${totalHousesWritten} records across zips: ${Array.from(processedZips).join(', ')}. ${nextMessage}` 
      });
    } catch (error: any) {
      console.error("Cron task failed:", error);
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, {
      // Vite emits content-hashed filenames under /assets, so they can be
      // cached aggressively and immutably for instant repeat loads.
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }));
    app.get('*all', (req, res) => {
      // The HTML shell must always revalidate so new deploys are picked up.
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
