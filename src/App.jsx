import React, { useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, useJsApiLoader, Marker, DirectionsRenderer, TrafficLayer } from "@react-google-maps/api";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import * as XLSX from "xlsx";
import { motion } from "framer-motion";

const COLS = {
  driver: "Drivers",
  loadNo: "Load #",
  shipDate: "Ship Date",
  delDate: "Del. Date",
  shipperName: "Shipper",
  shipperAddr: "1st Shipper Address",
  shipperCity: "1st Shipper City",
  shipperState: "1st Shipper State",
  receiverName: "Receiver",
  receiverAddr: "Last Receiver Address",
  receiverCity: "Last Receiver City",
  receiverState: "Last Receiver State",
};

function excelToDate(v) {
  if (!v && v !== 0) return null;
  if (typeof v === "number") {
    const excelEpoch = new Date(1899, 11, 30);
    return new Date(excelEpoch.getTime() + v * 86400000);
  }
  const d = new Date(v);
  return isNaN(+d) ? null : d;
}

// Simple deterministic color per lane
function laneColor(key) {
  // djb2 hash
  let hash = 5381;
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) + hash) + key.charCodeAt(i);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 70% 45%)`;
}

export default function App() {
  const envKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
  const [apiKey, setApiKey] = useState(localStorage.getItem("gmaps_api_key") || envKey);
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [driver, setDriver] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showTraffic, setShowTraffic] = useState(false);
  const [showMarkers, setShowMarkers] = useState(true);
  const [playback, setPlayback] = useState(false);
  const [playIdx, setPlayIdx] = useState(-1);

  useEffect(() => {
    if (apiKey) localStorage.setItem("gmaps_api_key", apiKey);
  }, [apiKey]);

  const { isLoaded } = useJsApiLoader({
    id: "gmaps-script",
    googleMapsApiKey: apiKey || "",
    libraries: ["places"],
  });

  useEffect(() => {
    const dset = new Set();
    rawRows.forEach((r) => {
      const d = (r[COLS.driver] ?? "").toString().trim();
      if (d) dset.add(d);
    });
    const list = Array.from(dset).sort();
    setDrivers(list);
    if (!driver && list.length) setDriver(list[0]);
  }, [rawRows]);

  const legs = useMemo(() => {
    if (!driver) return [];

    const from = dateFrom ? new Date(dateFrom + "T00:00:00") : null;
    const to = dateTo ? new Date(dateTo + "T23:59:59") : null;

    const mkAddress = (prefix, r) => {
      const name = r[prefix === "shipper" ? COLS.shipperName : COLS.receiverName] || "";
      const addr = r[prefix === "shipper" ? COLS.shipperAddr : COLS.receiverAddr] || "";
      const city = r[prefix === "shipper" ? COLS.shipperCity : COLS.receiverCity] || "";
      const state = r[prefix === "shipper" ? COLS.shipperState : COLS.receiverState] || "";
      return [name, addr, city, state].filter(Boolean).join(", ");
    };

    return rawRows
      .filter((r) => (r[COLS.driver] ?? "").toString().trim() === driver)
      .map((r) => ({
        origin: mkAddress("shipper", r),
        destination: mkAddress("receiver", r),
        laneKey: `${(r[COLS.shipperCity] || "")}, ${(r[COLS.shipperState] || "")} -> ${(r[COLS.receiverCity] || "")}, ${(r[COLS.receiverState] || "")}`,
        loadNo: r[COLS.loadNo],
        shipDate: excelToDate(r[COLS.shipDate]),
        delDate: excelToDate(r[COLS.delDate]),
      }))
      .filter((x) => x.origin && x.destination)
      .filter((x) => {
        if (!from && !to) return true;
        const d = x.shipDate || x.delDate;
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      })
      .sort((a, b) => {
        const ad = a.shipDate?.getTime?.() ?? a.delDate?.getTime?.() ?? 0;
        const bd = b.shipDate?.getTime?.() ?? b.delDate?.getTime?.() ?? 0;
        return ad - bd;
      });
  }, [driver, rawRows, dateFrom, dateTo]);

  // Directions
  const [routes, setRoutes] = useState([]);
  const [polylines, setPolylines] = useState([]);

  useEffect(() => {
    if (!isLoaded || !legs.length) {
      setRoutes([]);
      setPolylines([]);
      return;
    }
    let cancelled = false;
    const service = new google.maps.DirectionsService();

    (async () => {
      const out = [];
      for (let i = 0; i < legs.length; i++) {
        const { origin, destination } = legs[i];
        try {
          const res = await service.route({
            origin,
            destination,
            travelMode: google.maps.TravelMode.DRIVING,
          });
          if (!cancelled) out.push(res);
          await new Promise((r) => setTimeout(r, 200));
        } catch (e) {
          console.warn("Directions error", e);
        }
      }
      if (!cancelled) setRoutes(out);
    })();

    return () => { cancelled = true; };
  }, [isLoaded, JSON.stringify(legs)]);

  // Map reference & fit bounds
  const mapRef = useRef(null);
  useEffect(() => {
    if (!isLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const bounds = new google.maps.LatLngBounds();
    let had = false;
    routes.forEach((r) => {
      r.routes[0]?.overview_path?.forEach((p) => { bounds.extend(p); had = true; });
    });
    if (had) map.fitBounds(bounds, 64);
  }, [isLoaded, routes.length]);

  // Playback controls
  useEffect(() => {
    if (!playback) {
      setPlayIdx(-1);
      return;
    }
    if (!routes.length) return;
    let i = 0;
    setPlayIdx(0);
    const timer = setInterval(() => {
      i++;
      if (i >= routes.length) {
        clearInterval(timer);
        setPlayback(false);
        setPlayIdx(-1);
      } else {
        setPlayIdx(i);
      }
    }, 1000); // 1 leg per second, tweak as needed
    return () => clearInterval(timer);
  }, [playback, routes.length]);

  // Origins/destinations markers for clustering
  const [clusterer, setClusterer] = useState(null);
  const markerLayerRef = useRef([]);
  useEffect(() => {
    // Clear previous markers
    markerLayerRef.current.forEach((m) => m.setMap(null));
    markerLayerRef.current = [];
    if (!isLoaded || !mapRef.current) return;

    if (!showMarkers || !routes.length) {
      if (clusterer) clusterer.clearMarkers();
      return;
    }
    const map = mapRef.current;
    const markers = [];
    routes.forEach((r) => {
      const firstLeg = r.routes[0].legs[0];
      const lastLeg = r.routes[0].legs[r.routes[0].legs.length - 1];
      markers.push(new google.maps.Marker({ position: firstLeg.start_location }));
      markers.push(new google.maps.Marker({ position: lastLeg.end_location }));
    });
    markerLayerRef.current = markers;
    const mc = new MarkerClusterer({ markers, map });
    setClusterer(mc);
  }, [isLoaded, showMarkers, routes.length]);

  const center = useMemo(() => ({ lat: 36.5, lng: -96.5 }), []);

  // File upload
  async function handleFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const wsname = wb.SheetNames[0];
    const ws = wb.Sheets[wsname];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
    setRawRows(rows);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
        <motion.h1
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="text-2xl md:text-3xl font-bold tracking-tight"
        >
          Driver Route Map
        </motion.h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="col-span-1 bg-white rounded-2xl shadow p-4 space-y-4">
            <div>
              <label className="text-sm font-medium">Google Maps API Key</label>
              <input
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
                type="password"
                placeholder="Paste your key (stored locally)"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">Reads from <code>VITE_GOOGLE_MAPS_API_KEY</code> if set, otherwise local storage.</p>
            </div>

            <div>
              <label className="text-sm font-medium">Upload Excel/CSV</label>
              <input className="mt-1 w-full text-sm" type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
              {fileName && <p className="text-xs text-gray-500 mt-1">Loaded: {fileName}</p>}
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="text-sm font-medium">Driver</label>
                <select
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                  value={driver}
                  onChange={(e) => setDriver(e.target.value)}
                >
                  <option value="" disabled>Select driver</option>
                  {drivers.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              <div>
                <label className="text-sm font-medium">Date range (optional)</label>
                <div className="flex items-center gap-2">
                  <input className="rounded border px-2 py-1 text-sm" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                  <span className="text-sm">to</span>
                  <input className="rounded border px-2 py-1 text-sm" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Show Traffic</label>
                <button className={`px-3 py-1 rounded text-sm ${showTraffic ? "bg-black text-white" : "border"}`} onClick={() => setShowTraffic(v => !v)}>
                  {showTraffic ? "On" : "Off"}
                </button>
              </div>

              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Show Markers & Cluster</label>
                <button className={`px-3 py-1 rounded text-sm ${showMarkers ? "bg-black text-white" : "border"}`} onClick={() => setShowMarkers(v => !v)}>
                  {showMarkers ? "On" : "Off"}
                </button>
              </div>

              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Playback (1 leg/sec)</label>
                <button className={`px-3 py-1 rounded text-sm ${playback ? "bg-black text-white" : "border"}`} onClick={() => setPlayback(true)} disabled={!routes.length || playback}>
                  Play
                </button>
              </div>
            </div>

            <div className="pt-2 text-xs text-gray-500">
              <p>Legs: {legs.length}</p>
              <p>Columns expected: <code>{Object.values(COLS).join(", ")}</code></p>
            </div>
          </div>

          <div className="col-span-1 lg:col-span-2 bg-white rounded-2xl shadow overflow-hidden">
            <div className="h-[70vh] w-full">
              {apiKey ? (
                isLoaded ? (
                  <GoogleMap
                    onLoad={(m) => (mapRef.current = m)}
                    mapContainerStyle={{ width: "100%", height: "100%" }}
                    center={center}
                    zoom={5}
                    options={{ streetViewControl: false, mapTypeControl: true, fullscreenControl: true }}
                  >
                    {showTraffic && <TrafficLayer autoUpdate />}
                    {routes.map((r, idx) => {
                      const laneKey = legs[idx]?.laneKey || String(idx);
                      const color = laneColor(laneKey);
                      const visible = playIdx === -1 || idx <= playIdx;
                      return (
                        <DirectionsRenderer
                          key={idx}
                          directions={r}
                          options={{
                            preserveViewport: true,
                            polylineOptions: { strokeOpacity: visible ? 0.9 : 0, strokeWeight: 4, strokeColor: color },
                          }}
                        />
                      );
                    })}
                  </GoogleMap>
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-sm text-gray-500">Loading Google Maps…</div>
                )
              ) : (
                <div className="h-full w-full flex items-center justify-center text-sm text-gray-500">
                  Enter your API key to initialize the map
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow p-4">
          <h2 className="font-semibold mb-2">How to deploy</h2>
          <ol className="list-decimal ml-5 text-sm space-y-1 text-gray-700">
            <li>Run <code>npm i</code></li>
            <li>Optionally create a <code>.env</code> with <code>VITE_GOOGLE_MAPS_API_KEY=YOUR_KEY</code> (or paste in the UI)</li>
            <li>Run <code>npm run dev</code> to test locally</li>
            <li>Deploy to Vercel/Netlify: build command <code>npm run build</code>, output <code>dist</code></li>
          </ol>
        </div>
      </div>
    </div>
  );
}
