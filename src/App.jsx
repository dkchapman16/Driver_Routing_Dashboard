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
  loadStatus: "Load Status",
  miles: "Miles",
  amount: "Load Amount",
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
  return `hsl(${hue} 70% 45%)`;
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
  const params = useMemo(() => getParams(), []);
  const envKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
  const [apiKey, setApiKey] = useState(localStorage.getItem("gmaps_api_key") || envKey);

  const [theme, setTheme] = useState(params.theme || localStorage.getItem("ui_theme") || "light");
  const [accent, setAccent] = useState(params.accent || localStorage.getItem("ui_accent") || "#D2F000");
  const [logoUrl, setLogoUrl] = useState(localStorage.getItem("brand_logo") || "");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("ui_theme", theme);
  }, [theme]);
  useEffect(() => {
    document.documentElement.style.setProperty("--accent", accent);
    localStorage.setItem("ui_accent", accent);
  }, [accent]);
  useEffect(() => { if (apiKey) localStorage.setItem("gmaps_api_key", apiKey); }, [apiKey]);

  const { isLoaded } = useJsApiLoader({ id: "gmaps-script", googleMapsApiKey: apiKey || "", libraries: ["places"] });

  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [selectedDrivers, setSelectedDrivers] = useState(params.drivers || []);
  const [dateFrom, setDateFrom] = useState(params.from || "");
  const [dateTo, setDateTo] = useState(params.to || "");
  const [showTraffic, setShowTraffic] = useState(false);
  const [showMarkers, setShowMarkers] = useState(true);
  const [playback, setPlayback] = useState(false);
  const [playIdx, setPlayIdx] = useState(-1);

  useEffect(() => { setParams({ drivers: selectedDrivers, from: dateFrom, to: dateTo, theme, accent }); }, [selectedDrivers, dateFrom, dateTo, theme, accent]);

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

    return rawRows
      .filter((r) => selectedDrivers.includes((r[COLS.driver] ?? "").toString().trim()))
      .filter((r) => !isCanceled(r[COLS.loadStatus]))
      .map((r) => {
        const shipDate = excelToDate(r[COLS.shipDate]);
        const delDate = excelToDate(r[COLS.delDate]);
        return ({
          origin: mkAddress("shipper", r),
          destination: mkAddress("receiver", r),
          laneKey: `${(r[COLS.shipperCity] || "")}, ${(r[COLS.shipperState] || "")} -> ${(r[COLS.receiverCity] || "")}, ${(r[COLS.receiverState] || "")}`,
          loadNo: r[COLS.loadNo],
          driver: r[COLS.driver],
          shipDate,
          delDate,
          miles: Number(r[COLS.miles] || 0),
          amount: Number(r[COLS.amount] || 0),
          onTime: typeof r[COLS.deliveryStatus] === "string" ? /on[-\s]?time/i.test(r[COLS.deliveryStatus]) : null,
        });
      })
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
  }, [rawRows, selectedDrivers, dateFrom, dateTo]);

  const uniqueLanes = useMemo(() => Array.from(new Set(legs.map(l => l.laneKey))).sort(), [legs]);
  const [enabledLanes, setEnabledLanes] = useState(new Set(uniqueLanes));
  useEffect(() => { setEnabledLanes(new Set(uniqueLanes)); }, [uniqueLanes.length]);
  const filteredLegs = useMemo(() => legs.filter(l => enabledLanes.has(l.laneKey)), [legs, enabledLanes]);

  const [routes, setRoutes] = useState([]);
  useEffect(() => {
    if (!isLoaded || !filteredLegs.length) { setRoutes([]); return; }
    let cancelled = false;
    const service = new google.maps.DirectionsService();
    (async () => {
      const out = [];
      for (let i = 0; i < filteredLegs.length; i++) {
        const { origin, destination } = filteredLegs[i];
        try {
          const res = await service.route({ origin, destination, travelMode: google.maps.TravelMode.DRIVING });
          if (!cancelled) out.push(res);
          await new Promise((r) => setTimeout(r, 200));
        } catch (e) { console.warn("Directions error", e); }
      }
      if (!cancelled) setRoutes(out);
    })();
    return () => { cancelled = true; };
  }, [isLoaded, JSON.stringify(filteredLegs)]);

  const mapRef = useRef(null);
  useEffect(() => {
    if (!isLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const bounds = new google.maps.LatLngBounds();
    let had = false;
    routes.forEach((r) => r.routes[0]?.overview_path?.forEach((p) => { bounds.extend(p); had = true; }));
    if (had) map.fitBounds(bounds, 64);
  }, [isLoaded, routes.length]);

  useEffect(() => {
    if (!playback) { setPlayIdx(-1); return; }
    if (!routes.length) return;
    let i = 0;
    setPlayIdx(0);
    const timer = setInterval(() => {
      i++;
      if (i >= routes.length) { clearInterval(timer); setPlayback(false); setPlayIdx(-1); }
      else { setPlayIdx(i); }
    }, 900);
    return () => clearInterval(timer);
  }, [playback, routes.length]);

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

  const totals = useMemo(() => {
    const loads = filteredLegs.length;
    const miles = Math.round(filteredLegs.reduce((a, b) => a + (b.miles || 0), 0));
    const revenue = filteredLegs.reduce((a, b) => a + (b.amount || 0), 0);
    const timed = filteredLegs.filter(l => l.onTime !== null);
    const ontimePct = timed.length ? Math.round(100 * timed.filter(l => l.onTime).length / timed.length) : null;
    return { loads, miles, revenue, ontimePct };
  }, [filteredLegs]);

  function exportCSV() {
    const rows = [
      ["Driver","Load #","Ship Date","Del Date","Lane","Miles","Revenue","On-Time"],
      ...filteredLegs.map(l => [
        l.driver, l.loadNo ?? "", l.shipDate ? new Date(l.shipDate).toISOString().slice(0,10) : "",
        l.delDate ? new Date(l.delDate).toISOString().slice(0,10) : "",
        l.laneKey, l.miles || 0, l.amount || 0, l.onTime === null ? "" : (l.onTime ? "Yes" : "No")
      ]),
      [],
      ["Totals","","","","", totals.miles, totals.revenue, totals.ontimePct === null ? "" : `${totals.ontimePct}%`]
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dashboard");
    XLSX.writeFile(wb, "driver_routing_dashboard.csv");
  }

  function onLogoFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result;
      setLogoUrl(url);
      localStorage.setItem("brand_logo", url);
    };
    reader.readAsDataURL(f);
  }

  const themeBg = theme === "dark" ? "bg-zinc-900 text-zinc-100" : "bg-gray-50";
  const cardBg = theme === "dark" ? "bg-zinc-800 text-zinc-100" : "bg-white";

  return (
    <div className={`min-h-screen ${themeBg}`}>
      <style>{`
        .btn { padding: 0.35rem 0.75rem; border-radius: 0.6rem; font-size: 0.875rem; }
        .btn-accent { background: ${accent}; color: black; }
        .btn-outline { border: 1px solid #cbd5e1; }
        .header { display:flex; align-items:center; justify-content:space-between; gap:1rem; }
        .brand { display:flex; align-items:center; gap:.75rem; }
        .brand h1 { font-weight:800; letter-spacing:.2px; }
      `}</style>

      <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-4">
        <div className={`${cardBg} rounded-2xl shadow p-3 header`}>
          <div className="brand">
            {logoUrl ? <img src={logoUrl} alt="Logo" className="h-8 rounded" /> : <div className="h-8 w-8 rounded" style={{background: accent}} />}
            <div>
              <div className="text-sm opacity-60">FUELED BY COMMUNITY.</div>
              <h1 className="text-xl md:text-2xl">Hitched Logistics • Driver Routing Dashboard</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-outline" onClick={exportCSV}>Export CSV</button>
            <button className={`btn ${playback ? "btn-accent" : "btn-outline"}`} onClick={() => setPlayback(true)} disabled={!routes.length || playback}>Playback</button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className={`col-span-1 ${cardBg} rounded-2xl shadow p-4 space-y-4`}>
            <div>
              <label className="text-sm font-medium">Google Maps API Key</label>
              <input className="mt-1 w-full rounded border px-3 py-2 text-sm" type="password" placeholder="Paste your key (stored locally)"
                value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            </div>

            <div>
              <label className="text-sm font-medium">Upload Excel/CSV</label>
              <input className="mt-1 w-full text-sm" type="file" accept=".xlsx,.xls,.csv" onChange={(e)=>{
                const f = e.target.files?.[0]; if (!f) return;
                setFileName(f.name);
                f.arrayBuffer().then(buf => {
                  const wb = XLSX.read(buf, { type: "array" });
                  const ws = wb.Sheets[wb.SheetNames[0]];
                  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
                  setRawRows(rows);
                });
              }} />
              {fileName && <p className="text-xs opacity-70 mt-1">Loaded: {fileName}</p>}
            </div>

            <div>
              <label className="text-sm font-medium">Brand Logo (optional)</label>
              <input className="mt-1 w-full text-sm" type="file" accept="image/*" onChange={onLogoFile} />
              <p className="text-xs opacity-60 mt-1">PNG/SVG recommended. Stored locally in your browser.</p>
            </div>

            <div>
              <label className="text-sm font-medium">Drivers</label>
              <div className="mt-2 max-h-40 overflow-auto rounded border p-2 grid grid-cols-1 gap-1">
                {drivers.map((d) => {
                  const checked = selectedDrivers.includes(d);
                  return (
                    <label key={d} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={checked}
                        onChange={(e) => setSelectedDrivers(prev => e.target.checked ? [...new Set([...prev, d])] : prev.filter(x => x !== d))} />
                      <span>{d}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Date range</label>
              <div className="flex items-center gap-2">
                <input className="rounded border px-2 py-1 text-sm" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                <span className="text-sm">to</span>
                <input className="rounded border px-2 py-1 text-sm" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Show Traffic</label>
              <button className={`btn ${showTraffic ? "btn-accent" : "btn-outline"}`} onClick={() => setShowTraffic(v => !v)}>{showTraffic ? "On" : "Off"}</button>
            </div>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Markers & Cluster</label>
              <button className={`btn ${showMarkers ? "btn-accent" : "btn-outline"}`} onClick={() => setShowMarkers(v => !v)}>{showMarkers ? "On" : "Off"}</button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-sm font-medium">Theme</label>
                <select className="mt-1 w-full rounded border px-3 py-2 text-sm" value={theme} onChange={(e) => setTheme(e.target.value)}>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Accent (hex)</label>
                <input className="mt-1 w-full rounded border px-3 py-2 text-sm" type="text" value={accent} onChange={(e) => setAccent(e.target.value)} placeholder="#D2F000" />
              </div>
            </div>

            <div className="pt-2 text-xs opacity-70">
              <p>Legs after filters: {filteredLegs.length}</p>
              <p>Excluded canceled loads via “{COLS.loadStatus}”.</p>
            </div>
          </div>

          <div className={`col-span-1 lg:col-span-2 ${theme === "dark" ? "bg-zinc-800 text-zinc-100" : "bg-white"} rounded-2xl shadow overflow-hidden`}>
            <div className="h-[70vh] w-full">
              {apiKey ? (isLoaded ? (
                <GoogleMap onLoad={(m) => (mapRef.current = m)} mapContainerStyle={{ width: "100%", height: "100%" }}
                  center={{ lat: 36.5, lng: -96.5 }} zoom={5}
                  options={{ streetViewControl: false, mapTypeControl: true, fullscreenControl: true }}>
                  {showTraffic && <TrafficLayer autoUpdate />}
                  {routes.map((r, idx) => {
                    const laneKey = filteredLegs[idx]?.laneKey || String(idx);
                    const color = laneColor(laneKey);
                    const visible = playIdx === -1 || idx <= playIdx;
                    return <DirectionsRenderer key={idx} directions={r}
                      options={{ preserveViewport: true, polylineOptions: { strokeOpacity: visible ? 0.95 : 0, strokeWeight: 4, strokeColor: color } }} />;
                  })}
                </GoogleMap>
              ) : <div className="h-full w-full flex items-center justify-center text-sm opacity-70">Loading Google Maps…</div>) :
                <div className="h-full w-full flex items-center justify-center text-sm opacity-70">Enter your API key to initialize the map</div>}
            </div>
          </div>
        </div>

        <div className={`${theme === "dark" ? "bg-zinc-800 text-zinc-100" : "bg-white"} rounded-2xl shadow p-4`}>
          <h2 className="font-semibold mb-2">KPI Summary</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="p-3 rounded border"><div className="opacity-70">Loads</div><div className="text-xl font-bold">{totals.loads}</div></div>
            <div className="p-3 rounded border"><div className="opacity-70">Miles</div><div className="text-xl font-bold">{totals.miles.toLocaleString()}</div></div>
            <div className="p-3 rounded border"><div className="opacity-70">Revenue</div><div className="text-xl font-bold">${totals.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div></div>
            <div className="p-3 rounded border"><div className="opacity-70">On‑Time %</div><div className="text-xl font-bold">{totals.ontimePct === null ? "—" : `${totals.ontimePct}%`}</div></div>
          </div>

          <div className="mt-4">
            <h3 className="font-medium mb-2">Lane Filters</h3>
            <div className="max-h-36 overflow-auto grid grid-cols-1 gap-1 border rounded p-2 text-sm">
              {uniqueLanes.map((lane) => {
                const checked = enabledLanes.has(lane);
                return (
                  <label key={lane} className="flex items-center gap-2">
                    <input type="checkbox" checked={checked} onChange={(e) => {
                      setEnabledLanes(prev => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(lane); else next.delete(lane);
                        return next;
                      });
                    }} />
                    <span className="truncate">{lane}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        <div className="text-xs opacity-60 text-center py-4">
          © {new Date().getFullYear()} Hitched Logistics — www.hitchedlogistics.com — info@hitchedlogistics.com
        </div>
      </div>
    </div>
  );
}
