import React, { useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, useJsApiLoader, Marker, DirectionsRenderer, TrafficLayer, OverlayView } from "@react-google-maps/api";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import * as XLSX from "xlsx";
import { motion } from "framer-motion";

// Column mapping
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
  // Use Hauling Fee for revenue per request
  amount: "Hauling Fee",
  deliveryStatus: "Driver Delivery Status",
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
  return `hsl(${hue} 75% 46%)`;
}

function getParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    drivers: (p.get("drivers") || "").split(",").filter(Boolean),
    from: p.get("from") || "",
    to: p.get("to") || "",
    theme: p.get("theme") || "",
    accent: p.get("accent") || "",
  };
}
function setParams({ drivers, from, to, theme, accent }) {
  const p = new URLSearchParams();
  if (drivers?.length) p.set("drivers", drivers.join(","));
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  if (theme) p.set("theme", theme);
  if (accent) p.set("accent", accent);
  const url = `${window.location.pathname}?${p.toString()}`;
  window.history.replaceState({}, "", url);
}

export default function App() {
  const initialParams = useMemo(() => getParams(), []);
  const envKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
  const [apiKey, setApiKey] = useState(localStorage.getItem("gmaps_api_key") || envKey);

  // Modern theming
  const [theme, setTheme] = useState(initialParams.theme || (localStorage.getItem("ui_theme") || "light"));
  const [accent, setAccent] = useState(initialParams.accent || (localStorage.getItem("ui_accent") || "#D2F000")); // Hitched lime default
  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); localStorage.setItem("ui_theme", theme); }, [theme]);
  useEffect(() => { document.documentElement.style.setProperty("--accent", accent); localStorage.setItem("ui_accent", accent); }, [accent]);
  useEffect(() => { if (apiKey) localStorage.setItem("gmaps_api_key", apiKey); }, [apiKey]);

  const { isLoaded } = useJsApiLoader({ id: "gmaps-script", googleMapsApiKey: apiKey || "", libraries: ["places"] });

  // Data & filters
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [selectedDrivers, setSelectedDrivers] = useState(initialParams.drivers || []);
  const [dateFrom, setDateFrom] = useState(initialParams.from || "");
  const [dateTo, setDateTo] = useState(initialParams.to || "");
  const [showTraffic, setShowTraffic] = useState(false);
  const [showMarkers, setShowMarkers] = useState(true);
  const [playback, setPlayback] = useState(false);
  const [playIdx, setPlayIdx] = useState(-1);
  const [speed, setSpeed] = useState(900); // ms per leg

  useEffect(() => { setParams({ drivers: selectedDrivers, from: dateFrom, to: dateTo, theme, accent }); }, [selectedDrivers, dateFrom, dateTo, theme, accent]);

  useEffect(() => {
    const dset = new Set();
    rawRows.forEach((r) => { const d = (r[COLS.driver] ?? "").toString().trim(); if (d) dset.add(d); });
    const list = Array.from(dset).sort();
    setDrivers(list);
    if (!selectedDrivers.length && list.length) setSelectedDrivers([list[0]]);
  }, [rawRows]);

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
    const isCanceled = (status) => status && /cancel+ed|canceled|cancelled/i.test(String(status));

    const rows = rawRows
      .filter((r) => selectedDrivers.includes((r[COLS.driver] ?? "").toString().trim()))
      .filter((r) => !isCanceled(r[COLS.loadStatus]))
      .map((r) => ({
        origin: mkAddress("shipper", r),
        destination: mkAddress("receiver", r),
        laneKey: `${(r[COLS.shipperCity] || "")}, ${(r[COLS.shipperState] || "")} -> ${(r[COLS.receiverCity] || "")}, ${(r[COLS.receiverState] || "")}`,
        loadNo: r[COLS.loadNo],
        driver: r[COLS.driver],
        shipDate: excelToDate(r[COLS.shipDate]),
        delDate: excelToDate(r[COLS.delDate]),
        miles: Number(r[COLS.miles] || 0),
        amount: Number(r[COLS.amount] || 0),
        onTime: typeof r[COLS.deliveryStatus] === "string" ? /on[-\s]?time/i.test(r[COLS.deliveryStatus]) : null,
      }))
      .filter((x) => x.origin && x.destination)
      .filter((x) => {
        if (!from && !to) return true;
        const d = x.shipDate || x.delDate;
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });

    // Sort strictly by Ship Date (fallback to Del Date), earliest first
    rows.sort((a, b) => {
      const ad = a.shipDate?.getTime?.() ?? a.delDate?.getTime?.() ?? 0;
      const bd = b.shipDate?.getTime?.() ?? b.delDate?.getTime?.() ?? 0;
      return ad - bd;
    });
    return rows;
  }, [rawRows, selectedDrivers, dateFrom, dateTo]);

  const [routes, setRoutes] = useState([]);
  useEffect(() => {
    if (!isLoaded || !legs.length) { setRoutes([]); return; }
    let cancelled = false;
    const service = new google.maps.DirectionsService();
    (async () => {
      const out = [];
      for (let i = 0; i < legs.length; i++) {
        try {
          const res = await service.route({ origin: legs[i].origin, destination: legs[i].destination, travelMode: google.maps.TravelMode.DRIVING });
          if (!cancelled) out.push(res);
          await new Promise((r) => setTimeout(r, 150));
        } catch (e) { console.warn("Directions error", e); }
      }
      if (!cancelled) setRoutes(out);
    })();
    return () => { cancelled = true; };
  }, [isLoaded, JSON.stringify(legs)]);

  const mapRef = useRef(null);
  useEffect(() => {
    if (!isLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const bounds = new google.maps.LatLngBounds();
    let had = false;
    routes.forEach((r) => r.routes[0]?.overview_path?.forEach((p) => { bounds.extend(p); had = true; }));
    if (had) map.fitBounds(bounds, 64);
  }, [isLoaded, routes.length]);

  // Playback
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

  // Marker clustering
  const [clusterer, setClusterer] = useState(null);
  const markerLayerRef = useRef([]);
  useEffect(() => {
    markerLayerRef.current.forEach((m) => m.setMap(null));
    markerLayerRef.current = [];
    if (!isLoaded || !mapRef.current) return;
    if (!showMarkers || !routes.length) { if (clusterer) clusterer.clearMarkers(); return; }
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

  // KPI
  const totals = useMemo(() => {
    const loads = legs.length;
    const miles = Math.round(legs.reduce((a, b) => a + (b.miles || 0), 0));
    const revenue = legs.reduce((a, b) => a + (b.amount || 0), 0);
    const timed = legs.filter(l => l.onTime !== null);
    const ontimePct = timed.length ? Math.round(100 * timed.filter(l => l.onTime).length / timed.length) : null;
    return { loads, miles, revenue, ontimePct };
  }, [legs]);

  // Timeline entries
  const timeline = useMemo(() => legs.map((l, idx) => ({
    idx: idx + 1,
    date: l.shipDate || l.delDate,
    driver: l.driver,
    loadNo: l.loadNo,
    lane: l.laneKey,
  })), [legs]);

  const accents = ["#D2F000","#22c55e","#6366f1","#f43f5e","#f59e0b","#14b8a6","#0ea5e9","#a855f7","#94a3b8"];
  const surf = theme === "dark" ? "bg-zinc-950 text-zinc-100" : "bg-gray-50 text-gray-900";
  const card = theme === "dark" ? "bg-zinc-900 text-zinc-100 border-zinc-800" : "bg-white text-gray-900 border-gray-200";

  return (
    <div className={`min-h-screen ${surf}`}>
      <style>{`
        :root { --accent:${accent}; }
        .btn { padding: 0.45rem 0.85rem; border-radius: 0.75rem; font-size: 0.9rem; }
        .btn-accent { background: var(--accent); color: #000; font-weight: 700; }
        .btn-outline { border: 1px solid rgba(148,163,184,.5); }
        .input { background: transparent; border: 1px solid rgba(148,163,184,.35); padding: .55rem .7rem; border-radius: .65rem; }
        .kpi { border: 1px dashed rgba(148,163,184,.4); border-radius: .9rem; padding: .75rem; }
        .chip { background: rgba(148,163,184,.15); padding: .25rem .5rem; border-radius: 999px; }
        .timeline-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 3px rgba(210,240,0,.25); }
        .seq { background:#111827; color:#fff; font-size:.7rem; font-weight:700; padding:.2rem .35rem; border-radius:.4rem; border:2px solid #fff; }
        [data-theme='dark'] .input { background: #0b0b0b; border-color: #27272a; }
        [data-theme='dark'] .btn-outline { border-color: #27272a; }
      `}</style>

      <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
        <div className="flex items-center justify-between">
          <motion.h1 initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
            className="text-2xl md:text-3xl font-extrabold tracking-tight">
            <span className="opacity-70 mr-2 text-xs font-semibold">FUELED BY COMMUNITY.</span>
            Hitched Logistics • Driver Routing Dashboard
          </motion.h1>
          <div className="flex items-center gap-2">
            <button className="btn btn-outline" onClick={() => {
              // export CSV of current legs
              const rows = legs.map(l => ({
                Driver: l.driver, "Load #": l.loadNo, "Ship Date": l.shipDate?.toLocaleDateString?.() || "",
                "Del Date": l.delDate?.toLocaleDateString?.() || "", Lane: l.laneKey, Miles: l.miles, Revenue: l.amount, "On-Time": l.onTime===null? "": (l.onTime? "Yes":"No")
              }));
              const csv = [Object.keys(rows[0] || {}).join(","), ...rows.map(r => Object.values(r).join(","))].join("\n");
              const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
              const url = URL.createObjectURL(blob); const a = document.createElement("a");
              a.href = url; a.download = "driver_routing_export.csv"; a.click(); URL.revokeObjectURL(url);
            }}>Export CSV</button>
            <button className="btn btn-accent" onClick={() => setPlayback(true)} disabled={!routes.length}>Playback</button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Controls */}
          <div className={`col-span-1 ${card} rounded-2xl shadow p-4 space-y-4 border`}>
            <div>
              <label className="text-sm font-medium">Google Maps API Key</label>
              <input className="input w-full" type="password" placeholder="Paste your key (stored locally)"
                value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            </div>

            <div>
              <label className="text-sm font-medium">Upload Excel/CSV</label>
              <input className="mt-1 w-full text-sm" type="file" accept=".xlsx,.xls,.csv" onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return; setFileName(f.name);
                const buf = await f.arrayBuffer(); const wb = XLSX.read(buf, { type: "array" });
                const ws = wb.Sheets[wb.SheetNames[0]]; const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
                setRawRows(rows);
              }} />
              {fileName && <p className="text-xs opacity-70 mt-1">Loaded: {fileName}</p>}
            </div>

            <div>
              <label className="text-sm font-medium">Drivers</label>
              <div className="mt-2 max-h-40 overflow-auto rounded border p-2 grid grid-cols-1 gap-1">
                {drivers.map((d) => {
                  const checked = selectedDrivers.includes(d);
                  return (
                    <label key={d} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={checked}
                        onChange={(e) => setSelectedDrivers((prev) => e.target.checked ? [...new Set([...prev, d])] : prev.filter(x => x !== d))} />
                      <span>{d}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Date range</label>
              <div className="flex items-center gap-2">
                <input className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                <span className="text-sm">to</span>
                <input className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Traffic</label>
                <button className={`btn ${showTraffic ? "btn-accent" : "btn-outline"}`} onClick={() => setShowTraffic(v => !v)}>
                  {showTraffic ? "On" : "Off"}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Markers</label>
                <button className={`btn ${showMarkers ? "btn-accent" : "btn-outline"}`} onClick={() => setShowMarkers(v => !v)}>
                  {showMarkers ? "On" : "Off"}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-sm font-medium">Theme</label>
                <select className="input w-full" value={theme} onChange={(e) => setTheme(e.target.value)}>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Accent</label>
                <select className="input w-full" value={accent} onChange={(e) => setAccent(e.target.value)}>
                  {accents.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Playback speed</label>
                <select className="input w-full" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                  <option value={1400}>Slow</option>
                  <option value={900}>Normal</option>
                  <option value={500}>Fast</option>
                </select>
              </div>
            </div>

            <div className="pt-2 text-xs opacity-70">
              <p>Legs after filters: {legs.length}</p>
              <p>Revenue uses “{COLS.amount}”. Canceled loads excluded via “{COLS.loadStatus}”.</p>
            </div>
          </div>

          {/* Map + timeline */}
          <div className="col-span-1 lg:col-span-2 grid grid-rows-[1fr_auto] gap-3">
            <div className={`rounded-2xl shadow border ${card} overflow-hidden`}>
              <div className="h-[60vh] w-full">
                {apiKey ? (isLoaded ? (
                  <GoogleMap onLoad={(m) => (mapRef.current = m)} mapContainerStyle={{ width: "100%", height: "100%" }}
                    center={{ lat: 36.5, lng: -96.5 }} zoom={5}
                    options={{ streetViewControl: false, mapTypeControl: true, fullscreenControl: true }}>
                    {showTraffic && <TrafficLayer autoUpdate />}
                    {routes.map((r, idx) => {
                      const color = laneColor(legs[idx]?.laneKey || String(idx));
                      const visible = playIdx === -1 || idx <= playIdx;
                      return (
                        <React.Fragment key={idx}>
                          <DirectionsRenderer
                            directions={r}
                            options={{ preserveViewport: true, polylineOptions: { strokeOpacity: visible ? 0.95 : 0, strokeWeight: 4, strokeColor: color } }}
                          />
                          {/* Sequence number at start of each leg */}
                          <OverlayView position={r.routes[0].legs[0].start_location} mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}>
                            <div className="seq">{idx + 1}</div>
                          </OverlayView>
                        </React.Fragment>
                      );
                    })}
                  </GoogleMap>
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-sm opacity-70">Loading Google Maps…</div>
                )) : (
                  <div className="h-full w-full flex items-center justify-center text-sm opacity-70">Enter your API key to initialize the map</div>
                )}
              </div>
            </div>

            {/* Timeline */}
            <div className={`rounded-2xl shadow border ${card} p-3`}>
              <h3 className="font-semibold mb-2">Timeline (ordered by Ship Date)</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-48 overflow-auto pr-2">
                {timeline.map((t) => (
                  <div key={t.idx} className="flex items-start gap-2 text-sm">
                    <div className="timeline-dot mt-1"></div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="chip">#{t.idx}</span>
                        <span className="opacity-70">{t.date ? new Date(t.date).toLocaleDateString() : ""}</span>
                        <span className="font-semibold">{t.driver}</span>
                        {t.loadNo ? <span className="chip">Load {t.loadNo}</span> : null}
                      </div>
                      <div className="truncate opacity-80">{t.lane}</div>
                    </div>
                  </div>
                ))}
                {!timeline.length && <div className="opacity-60">No legs to show.</div>}
              </div>
            </div>
          </div>
        </div>

        {/* KPI */}
        <div className={`rounded-2xl shadow border ${card} p-4`}>
          <h2 className="font-semibold mb-2">KPI Summary</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="kpi"><div className="opacity-70">Loads</div><div className="text-2xl font-bold">{totals.loads}</div></div>
            <div className="kpi"><div className="opacity-70">Miles</div><div className="text-2xl font-bold">{totals.miles.toLocaleString()}</div></div>
            <div className="kpi"><div className="opacity-70">Revenue</div><div className="text-2xl font-bold">${totals.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div></div>
            <div className="kpi"><div className="opacity-70">On‑Time %</div><div className="text-2xl font-bold">{totals.ontimePct === null ? "—" : `${totals.ontimePct}%`}</div></div>
          </div>
        </div>
      </div>
    </div>
  );
}
