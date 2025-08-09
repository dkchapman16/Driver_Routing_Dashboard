import React, { useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, useJsApiLoader, DirectionsRenderer } from "@react-google-maps/api";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import * as XLSX from "xlsx";
import { motion } from "framer-motion";

// Column mapping (update revenue -> Hauling Fee with fallback)
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
  loadStatus: "Load Status",
  miles: "Miles",
  amount: "Hauling Fee",
  amountAlt: "Load Amount",
  shipperArrival: "Shipper Arrival Status",
  receiverArrival: "Receiver Arrival Status",
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

function laneColor(key) {
  let hash = 5381;
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) + hash) + key.charCodeAt(i);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 70% 45%)`;
}

function isCanceled(status) {
  if (!status) return false;
  return /cancel+ed|canceled|cancelled/i.test(String(status));
}

// Calculate on-time boolean based on shipper/receiver arrival not being "late"
function isOnTime(row) {
  const s = (row[COLS.shipperArrival] || "").toString().toLowerCase();
  const r = (row[COLS.receiverArrival] || "").toString().toLowerCase();
  const hasLate = s.includes("late") || r.includes("late");
  if (!s && !r) return null; // unknown
  return !hasLate;
}

// Tiny numbered badge marker overlay component
function NumberBadge({ n, position }) {
  // Render HTML overlay using a simple div absolutely positioned via CSS transform with Google OverlayView
  // For simplicity we draw numbers inside a circle using CSS; numbers centered.
  return null;
}

export default function App() {
  const envKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
  const [apiKey, setApiKey] = useState(localStorage.getItem("gmaps_api_key") || envKey);

  const { isLoaded } = useJsApiLoader({
    id: "gmaps-script",
    googleMapsApiKey: apiKey || "",
    libraries: ["places"],
  });

  // UI state
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [selectedDrivers, setSelectedDrivers] = useState([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterBasis, setFilterBasis] = useState("pickup"); // 'pickup' | 'delivery'
  const [showTraffic, setShowTraffic] = useState(false);
  const [showMarkers, setShowMarkers] = useState(false); // default off to reduce noise
  const [playback, setPlayback] = useState(false);
  const [playIdx, setPlayIdx] = useState(-1);
  const [speed, setSpeed] = useState(1000); // ms per leg

  // Derive driver list
  useEffect(() => {
    const dset = new Set();
    rawRows.forEach((r) => {
      const d = (r[COLS.driver] ?? "").toString().trim();
      if (d) dset.add(d);
    });
    const list = Array.from(dset).sort();
    setDrivers(list);
    if (!selectedDrivers.length && list.length) setSelectedDrivers([list[0]]);
  }, [rawRows]);

  // Legs builder with strict ordering by Ship Date -> Del Date and cancellation filter
  const legs = useMemo(() => {
    const from = dateFrom ? new Date(dateFrom + "T00:00:00") : null;
    const to = dateTo ? new Date(dateTo + "T23:59:59") : null;

    const mkAddress = (prefix, r) => {
      const name = r[prefix === "shipper" ? COLS.shipperName : COLS.receiverName] || "";
      const addr = r[prefix === "shipper" ? COLS.shipperAddr : COLS.receiverAddr] || "";
      const city = r[prefix === "shipper" ? COLS.shipperCity : COLS.receiverCity] || "";
      const state = r[prefix === "shipper" ? COLS.shipperState : COLS.receiverState] || "";
      return [name, addr, city, state].filter(Boolean).join(", ");
    };

    const rows = rawRows
      .filter((r) => selectedDrivers.includes((r[COLS.driver] ?? "").toString().trim()))
      .filter((r) => !isCanceled(r[COLS.loadStatus]))
      .map((r) => {
        const shipDate = excelToDate(r[COLS.shipDate]);
        const delDate = excelToDate(r[COLS.delDate]);
        const miles = Number(r[COLS.miles] || 0);
        const amount = Number(r[COLS.amount] || r[COLS.amountAlt] || 0);
        return {
          row: r,
          loadNo: r[COLS.loadNo],
          driver: r[COLS.driver],
          origin: mkAddress("shipper", r),
          destination: mkAddress("receiver", r),
          laneKey: `${(r[COLS.shipperCity] || "")}, ${(r[COLS.shipperState] || "")} -> ${(r[COLS.receiverCity] || "")}, ${(r[COLS.receiverState] || "")}`,
          shipDate, delDate, miles, amount,
          rpm: miles ? amount / miles : 0,
          onTime: isOnTime(r),
        };
      })
      .filter((x) => x.origin && x.destination);

    const basisDate = (x) => (filterBasis === "pickup" ? x.shipDate : x.delDate) || x.shipDate || x.delDate;

    const filtered = rows.filter((x) => {
      const d = basisDate(x);
      if (!from && !to) return true;
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });

    filtered.sort((a, b) => {
      const ad = (a.shipDate?.getTime?.() ?? 0) || (a.delDate?.getTime?.() ?? 0);
      const bd = (b.shipDate?.getTime?.() ?? 0) || (b.delDate?.getTime?.() ?? 0);
      return ad - bd;
    });

    return filtered;
  }, [rawRows, selectedDrivers, dateFrom, dateTo, filterBasis]);

  // Directions
  const [routes, setRoutes] = useState([]);
  useEffect(() => {
    if (!isLoaded || !legs.length) { setRoutes([]); return; }
    let cancelled = false;
    const service = new google.maps.DirectionsService();
    (async () => {
      const out = [];
      for (let i = 0; i < legs.length; i++) {
        const { origin, destination } = legs[i];
        try {
          const res = await service.route({
            origin, destination,
            travelMode: google.maps.TravelMode.DRIVING,
          });
          if (!cancelled) out.push(res);
          await new Promise((r) => setTimeout(r, 150));
        } catch (e) {
          console.warn("Directions error", e);
        }
      }
      if (!cancelled) setRoutes(out);
    })();
    return () => { cancelled = true; };
  }, [isLoaded, JSON.stringify(legs)]);

  // Fit to bounds on routes update
  const mapRef = useRef(null);
  useEffect(() => {
    if (!isLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const bounds = new google.maps.LatLngBounds();
    let had = false;
    routes.forEach((r) => r.routes[0]?.overview_path?.forEach((p) => { bounds.extend(p); had = true; }));
    if (had) map.fitBounds(bounds, 64);
  }, [isLoaded, routes.length]);

  // Playback with speed
  useEffect(() => {
    if (!playback) { setPlayIdx(-1); return; }
    if (!routes.length) return;
    let i = 0;
    setPlayIdx(0);
    const timer = setInterval(() => {
      i++;
      if (i >= routes.length) { clearInterval(timer); setPlayback(false); setPlayIdx(-1); }
      else { setPlayIdx(i); }
    }, speed);
    return () => clearInterval(timer);
  }, [playback, routes.length, speed]);

  // KPI
  const totals = useMemo(() => {
    const loads = legs.length;
    const miles = Math.round(legs.reduce((a, b) => a + (b.miles || 0), 0));
    const revenue = legs.reduce((a, b) => a + (b.amount || 0), 0);
    const rpm = miles ? revenue / miles : 0;
    // on-time: any row whose shipper/receiver status not "late"
    const known = legs.filter(l => l.onTime !== null);
    const ontimePct = known.length ? Math.round(100 * known.filter(l => l.onTime).length / known.length) : null;
    return { loads, miles, revenue, rpm, ontimePct };
  }, [legs]);

  // Layout sizing: left panel narrow, map wider, timeline full-width below with room
  const [panelWidth, setPanelWidth] = useState(360);

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
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <style>{`
        .panel { background: #0b0b0e; border: 1px solid #222; border-radius: 16px; }
        .card { background: #0f1014; border: 1px solid #222; border-radius: 16px; }
        .muted { color: #9aa0aa; }
        .accent { color: #D2F000; }
        .btn { padding: 6px 10px; border-radius: 10px; font-size: 13px; border: 1px solid #2a2a2e; background:#15161a; }
        .btn-primary { background: #D2F000; color:#0b0b0e; border-color:#C6E600; }
        .chip { background:#0b0b0e; border:1px solid #2a2a2e; padding:6px 10px; border-radius:999px; font-size:12px; }
        .kpi { font-size: 22px; font-weight: 800; }
        .badge { display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:999px; background:#D2F000; color:#0b0b0e; font-weight:700; }
      `}</style>

      <div className="max-w-[1600px] mx-auto p-4 space-y-6">
        <div className="flex gap-4">
          {/* Left Panel */}
          <div className="panel p-4" style={{ width: panelWidth, minWidth: 300 }}>
            <div className="text-xs tracking-widest uppercase muted mb-2">Fueled by Community.</div>
            <h1 className="text-xl font-bold">Hitched Logistics • Driver Routing Dashboard</h1>

            <div className="mt-4">
              <label className="text-sm">Google Maps API Key</label>
              <input className="w-full mt-1 bg-black/30 border border-zinc-700 rounded-md px-3 py-2 text-sm" type="password"
                placeholder="Paste key (stored locally)" value={apiKey} onChange={(e)=>setApiKey(e.target.value)} />
            </div>

            <div className="mt-3">
              <label className="text-sm">Upload Excel/CSV</label>
              <input className="w-full mt-1 text-sm" type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
              {fileName && <div className="text-xs muted mt-1">Loaded: {fileName}</div>}
            </div>

            <div className="mt-4">
              <label className="text-sm">Drivers</label>
              <div className="mt-2 max-h-48 overflow-auto rounded border border-zinc-700">
                {drivers.map((d) => {
                  const checked = selectedDrivers.includes(d);
                  return (
                    <label key={d} className="flex items-center gap-2 text-sm px-3 py-2 border-b border-zinc-800 last:border-b-0">
                      <input type="checkbox" checked={checked} onChange={(e)=>{
                        setSelectedDrivers(prev => e.target.checked ? [...new Set([...prev, d])] : prev.filter(x=>x!==d));
                      }} />
                      <span>{d}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2">
              <label className="text-sm">Date range</label>
              <div className="flex items-center gap-2">
                <input className="flex-1 bg-black/30 border border-zinc-700 rounded-md px-2 py-1 text-sm" type="date" value={dateFrom} onChange={(e)=>setDateFrom(e.target.value)} />
                <span className="muted text-sm">to</span>
                <input className="flex-1 bg-black/30 border border-zinc-700 rounded-md px-2 py-1 text-sm" type="date" value={dateTo} onChange={(e)=>setDateTo(e.target.value)} />
              </div>
              <div className="flex gap-2 items-center">
                <span className="text-sm">Filter by</span>
                <div className="chip cursor-pointer" onClick={()=>setFilterBasis("pickup")} style={{background: filterBasis==="pickup"?"#D2F000":"#0b0b0e", color: filterBasis==="pickup"?"#0b0b0e":"#e5e7eb"}}>Pickup</div>
                <div className="chip cursor-pointer" onClick={()=>setFilterBasis("delivery")} style={{background: filterBasis==="delivery"?"#D2F000":"#0b0b0e", color: filterBasis==="delivery"?"#0b0b0e":"#e5e7eb"}}>Delivery</div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button className="btn" onClick={()=>setShowTraffic(v=>!v)}>Traffic: {showTraffic?"On":"Off"}</button>
              <button className="btn" onClick={()=>setShowMarkers(v=>!v)}>Markers: {showMarkers?"On":"Off"}</button>
              <button className="btn-primary" onClick={()=>setPlayback(true)} disabled={!routes.length || playback}>Playback</button>
              <select className="bg-black/30 border border-zinc-700 rounded-md px-2" value={speed} onChange={(e)=>setSpeed(Number(e.target.value))}>
                <option value={1500}>Slow</option>
                <option value={1000}>Normal</option>
                <option value={500}>Fast</option>
              </select>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 card p-3">
              <div>
                <div className="muted text-xs">Loads</div>
                <div className="kpi">{totals.loads}</div>
              </div>
              <div>
                <div className="muted text-xs">Miles</div>
                <div className="kpi">{totals.miles.toLocaleString()}</div>
              </div>
              <div>
                <div className="muted text-xs">Revenue</div>
                <div className="kpi">${totals.revenue.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
              </div>
              <div>
                <div className="muted text-xs">RPM</div>
                <div className="kpi">${(totals.rpm||0).toFixed(2)}</div>
              </div>
              <div className="col-span-2">
                <div className="muted text-xs">On‑Time %</div>
                <div className="kpi">{totals.ontimePct===null?"—":`${totals.ontimePct}%`}</div>
              </div>
            </div>

            <div className="mt-2 text-xs muted">
              Legs after filters: {legs.length}. Revenue uses “{COLS.amount}” with fallback to “{COLS.amountAlt}”. Canceled loads excluded via “{COLS.loadStatus}”.
            </div>
          </div>

          {/* Map */}
          <div className="flex-1 card overflow-hidden">
            <div style={{ height: '72vh', width: '100%' }}>
              {apiKey ? (
                isLoaded ? (
                  <GoogleMap
                    onLoad={(m)=> (mapRef.current = m)}
                    mapContainerStyle={{ width: "100%", height: "100%" }}
                    center={{ lat: 36.5, lng: -96.5 }}
                    zoom={5}
                    options={{ streetViewControl: false, mapTypeControl: true, fullscreenControl: true }}
                  >
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
                            suppressMarkers: true, // hide A/B labels to reduce confusion
                            polylineOptions: { strokeOpacity: visible ? 0.95 : 0, strokeWeight: 4, strokeColor: color },
                          }}
                        />
                      );
                    })}
                  </GoogleMap>
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-sm muted">Loading Google Maps…</div>
                )
              ) : (
                <div className="h-full w-full flex items-center justify-center text-sm muted">Enter your API key to initialize the map</div>
              )}
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-lg">Timeline (ordered by {filterBasis === "pickup" ? "Ship Date" : "Del. Date"})</h2>
          </div>
          <div className="grid lg:grid-cols-2 gap-3 mt-3">
            {legs.map((l, i) => (
              <div key={i} className="p-3 rounded-xl border border-zinc-800 flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="badge">{i+1}</span>
                  <div className="text-sm">
                    <div className="font-semibold">{l.driver}</div>
                    <div className="muted">{(l.shipDate?new Date(l.shipDate).toLocaleDateString(): "—")} • Load {l.loadNo || "—"}</div>
                  </div>
                </div>
                <div className="text-sm mt-1">{l.laneKey}</div>
                <div className="flex gap-4 text-sm mt-2">
                  <div className="chip">Revenue ${ (l.amount||0).toLocaleString(undefined,{maximumFractionDigits:0}) }</div>
                  <div className="chip">Miles { (l.miles||0).toLocaleString() }</div>
                  <div className="chip">RPM ${ (l.rpm||0).toFixed(2) }</div>
                  <div className="chip">On‑Time { l.onTime === null ? "—" : (l.onTime ? "Yes" : "No") }</div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
