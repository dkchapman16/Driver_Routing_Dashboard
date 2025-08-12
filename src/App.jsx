// v2.1.6 — Hotfix (complete)
// - Restores route drawing (geocoding), Insights tab, calendar buttons
// - Restores draggable divider to resize list vs map
// - Keeps strict date-basis logic, miles/RPM math, driver checkboxes
import React, { useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, useJsApiLoader, Polyline, Marker, TrafficLayer } from "@react-google-maps/api";
import * as XLSX from "xlsx";

const COLS = {
  driver: "Drivers",
  loadNo: "Load #",
  shipDate: "Ship Date",
  delDate: "Del. Date",
  shipperCity: "1st Shipper City",
  shipperState: "1st Shipper State",
  receiverCity: "Last Receiver City",
  receiverState: "Last Receiver State",
  shipperAddr: "1st Shipper Address",
  shipperName: "Shipper",
  receiverAddr: "Last Receiver Address",
  receiverName: "Receiver",
  status: "Load Status",
  milesLoaded: "Miles",
  milesEmpty: "Empty Miles",
  fee: "Hauling Fee",
  shipperArrival: "Shipper Arrival Status",
  receiverArrival: "Receiver Arrival Status",
};

// Convert Excel serial date or string date into a JavaScript Date object.
// The previous implementation constructed Date objects in the local timezone
// which could yield off‑by‑one results for users outside UTC when the string
// was parsed as UTC. By explicitly using UTC for serial numbers and parsing
// string dates as local midnight, we avoid unintended timezone shifts.
const excelToDate = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    // Excel serial dates are based on 1899‑12‑30; treat them as UTC to avoid
    // local timezone offsets influencing the result.
    const base = Date.UTC(1899, 11, 30);
    return new Date(base + v * 86400000);
  }
  const onlyDate = String(v).split(" ")[0];
  // Parse string dates as local time by appending a time component so they are
  // not interpreted as UTC. This prevents a potential one‑day shift.
  const d = new Date(`${onlyDate}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
};
const isCanceled = (s) => s && /cancel+ed|cancelled|canceled/i.test(String(s));
const isLate = (s) => s && /late/i.test(String(s));
const money = (n) => (isFinite(n) ? n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : "$0");
const num = (n) => (isFinite(n) ? n.toLocaleString() : "0");
const rpm = (rev, mi) => (mi > 0 && isFinite(rev / mi) ? (rev / mi).toFixed(2) : "0.00");
const colorByDriver = (key) => {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) { hash ^= key.charCodeAt(i); hash += (hash<<1)+(hash<<4)+(hash<<7)+(hash<<8)+(hash<<24); }
  const hue = Math.abs(hash) % 360; return `hsl(${hue} 70% 55%)`;
};
const fmt = (d) => (d ? d.toLocaleDateString() : "—");
const toDayKey = (d) => { if (!d) return null; const x = new Date(d); x.setHours(0,0,0,0); return x.toISOString().slice(0,10); };
const inRangeByDayKey = (dayKey, from, to) => {
  if (!from && !to) return !!dayKey;
  if (!dayKey) return false;
  const start = from || "0000-01-01";
  const end   = to   || "9999-12-31";
  return dayKey >= start && dayKey <= end;
};
const daysBetween = (start, end) => {
  const out = [];
  if (!start || !end) return out;
  const s = new Date(start); s.setHours(0,0,0,0);
  const e = new Date(end);   e.setHours(0,0,0,0);
  for (let d = new Date(s); d <= e; d.setDate(d.getDate()+1)) out.push(toDayKey(d));
  return out;
};

/** Driver checkbox picker */
function DriverPicker({ drivers, selDrivers, setSelDrivers }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
       if (!needle) return drivers;
    return drivers.filter(d => d.toLowerCase().includes(needle));
  }, [drivers, q]);

  const allSelected = selDrivers.length && selDrivers.length === drivers.length;
  const someSelected = selDrivers.length > 0 && selDrivers.length < drivers.length;

  function toggle(name) {
    setSelDrivers(prev => prev.includes(name) ? prev.filter(d => d !== name) : [...prev, name]);
  }
  const selectAll = () => setSelDrivers(drivers);
  const clearAll  = () => setSelDrivers([]);

  const styles = {
    card: { background: "#151923", border: "1px solid #232838", borderRadius: 14, padding: 12 },
    muted: { color: "#a2a9bb" },
    input: { width: "100%", background: "transparent", color: "#e6e8ee", border: "1px solid #232838", borderRadius: 10, padding: "6px 10px" },
    btn: { padding: "6px 10px", border: "1px solid #232838", borderRadius: 10, cursor: "pointer", color: "#e6e8ee", background: "transparent" },
    btnAccent: { padding: "6px 10px", borderRadius: 10, cursor: "pointer", color: "#0b0d12", background: "#D2F000", border: "1px solid #D2F000", fontWeight: 700 },
    list: { maxHeight: 260, overflow: "auto", marginTop: 8, border: "1px solid #232838", borderRadius: 10, padding: 8 },
    row: { display: "flex", alignItems: "center", gap: 8, padding: "6px 6px", borderRadius: 8, cursor: "pointer" },
    checkbox: { width: 16, height: 16, accentColor: "#D2F000" },
    counts: { fontSize: 12, color: "#a2a9bb" },
  };

  return (
    <div style={styles.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 12, ...styles.muted }}>Drivers</div>
        <div style={styles.counts}>{selDrivers.length}/{drivers.length} selected</div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 6, marginBottom: 6 }}>
        <input placeholder="Search drivers…" value={q} onChange={(e)=>setQ(e.target.value)} style={styles.input} />
        <button title="Select all" style={styles.btnAccent} onClick={selectAll}>All</button>
        <button title="Clear" style={styles.btn} onClick={clearAll}>Clear</button>
      </div>

      <div style={styles.list}>
        <div style={{ ...styles.row, fontWeight: 700 }} onClick={()=> allSelected ? clearAll() : selectAll()}>
          <input type="checkbox" readOnly checked={allSelected} ref={el=>{ if(el) el.indeterminate = someSelected; }} style={styles.checkbox}/>
          <span>All drivers</span>
        </div>
        {filtered.map(d => (
          <label key={d} style={styles.row}>
            <input type="checkbox" checked={selDrivers.includes(d)} onChange={()=>toggle(d)} style={styles.checkbox} />
            <span>{d}</span>
          </label>
        ))}
        {filtered.length === 0 && <div style={{ ...styles.muted, padding: 6 }}>No matches.</div>}
      </div>
    </div>
  );
}

export default function App() {
  const envKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
  const [apiKey, setApiKey] = useState(localStorage.getItem("gmaps_api_key") || envKey);
  useEffect(() => localStorage.setItem("gmaps_api_key", apiKey || ""), [apiKey]);
  const { isLoaded } = useJsApiLoader({ id: "gmaps-script", googleMapsApiKey: apiKey || "", libraries: ["places"] });

  const [dataSource, setDataSource] = useState(localStorage.getItem("data_source") || "upload");
  const [sheetUrl, setSheetUrl] = useState(localStorage.getItem("sheet_url") || "");
  useEffect(() => localStorage.setItem("data_source", dataSource), [dataSource]);
  useEffect(() => localStorage.setItem("sheet_url", sheetUrl), [sheetUrl]);

  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState("");

  async function handleFile(e) {
    const f = e.target.files?.[0]; if (!f) return;
    setFileName(f.name);
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
    setRows(json);
  }
  async function syncFromSheet(link = sheetUrl) {
    if (!link) return;
    try {
      const res = await fetch(link, { cache: "no-store" });
      const csv = await res.text();
      const wb = XLSX.read(csv, { type: "string" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
      setRows(json);
    } catch (e) { alert("Could not load from Google Sheets CSV link. Ensure it's published to the web as CSV and public."); }
  }

  const [tab, setTab] = useState("dashboard");
  const drivers = useMemo(() => {
    const s = new Set();
    rows.forEach(r => { const d = (r[COLS.driver] ?? "").toString().trim(); if (d) s.add(d); });
    return Array.from(s).sort();
  }, [rows]);
  const [selDrivers, setSelDrivers] = useState([]);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [basis, setBasis] = useState("pickup");
  const [routeStyle, setRouteStyle] = useState("lines");
  const [showTraffic, setShowTraffic] = useState(false);
  const fromRef = useRef(null), toRef = useRef(null);

  useEffect(() => { if (dataSource === "sheets" && sheetUrl) syncFromSheet(sheetUrl); }, []);

  const legs = useMemo(() => {
    let f = dateFrom ? new Date(dateFrom + "T00:00:00") : null;
    let t = dateTo   ? new Date(dateTo   + "T23:59:59") : null;
    if (f && t && f > t) { const tmp = f; f = t; t = tmp; }

    const cityState = (c, s) => [c, s].filter(Boolean).join(", ");
    const originCS  = (r) => cityState(r[COLS.shipperCity], r[COLS.shipperState]);
    const destCS    = (r) => cityState(r[COLS.receiverCity], r[COLS.receiverState]);

    return rows
      .filter(r => selDrivers.length ? selDrivers.includes((r[COLS.driver] ?? "").toString().trim()) : true)
      .filter(r => !isCanceled(r[COLS.status]))
      .filter(r => {
        const shipDK = toDayKey(excelToDate(r[COLS.shipDate]));
        const delDK  = toDayKey(excelToDate(r[COLS.delDate]));
        const baseDK = basis === "pickup" ? shipDK : delDK;
        return inRangeByDayKey(baseDK, dateFrom, dateTo);
      })
      .map(r => {
        const loaded = Number(r[COLS.milesLoaded] || 0);
        const empty  = Number(r[COLS.milesEmpty] || 0);
        const total  = loaded + empty;
        return {
          driver: (r[COLS.driver] ?? "").toString().trim(),
          loadNo: r[COLS.loadNo],
          shipDate: excelToDate(r[COLS.shipDate]),
          delDate: excelToDate(r[COLS.delDate]),
          originFull: [r[COLS.shipperName], r[COLS.shipperAddr], originCS(r)].filter(Boolean).join(", "),
          destFull:   [r[COLS.receiverName], r[COLS.receiverAddr], destCS(r)].filter(Boolean).join(", "),
          originCS: originCS(r), destCS: destCS(r),
          loadedMiles: loaded, emptyMiles: empty, miles: total,
          fee: Number(r[COLS.fee] || 0),
          onTime: ((r[COLS.shipperArrival] ?? "").toString().trim() || (r[COLS.receiverArrival] ?? "").toString().trim())
            ? !(isLate(r[COLS.shipperArrival]) || isLate(r[COLS.receiverArrival]))
            : null,
        };
      })
      .sort((a, b) => {
        const aBase = (basis === "pickup" ? a.shipDate : a.delDate)?.getTime?.() ?? 0;
        const bBase = (basis === "pickup" ? b.shipDate : b.delDate)?.getTime?.() ?? 0;
        if (aBase !== bBase) return aBase - bBase;
        const aOther = (basis === "pickup" ? a.delDate : a.shipDate)?.getTime?.() ?? 0;
        const bOther = (basis === "pickup" ? b.delDate : b.shipDate)?.getTime?.() ?? 0;
        return aOther - bOther;
      });
  }, [rows, selDrivers, dateFrom, dateTo, basis]);

  // KPIs + Insights
  const kpi = useMemo(() => {
    const miles = Math.round(legs.reduce((a,b)=>a+(b.miles||0),0));
    const revenue = legs.reduce((a,b)=>a+(b.fee||0),0);
    const fleetRPM = miles>0 ? (revenue/miles).toFixed(2) : "0.00";
    const onBase = legs.filter(l => l.onTime !== null);
    const onTime = onBase.length ? Math.round(100*onBase.filter(l=>l.onTime).length/onBase.length) : 0;
    const empty = Math.round(legs.reduce((a,b)=>a+(b.emptyMiles||0),0));
    const deadheadPct = (miles>0) ? Math.round((empty/miles)*100) : 0;

    let utilization = 0;
    if (dateFrom && dateTo) {
      const allDays = daysBetween(dateFrom, dateTo);
      const m = new Map();
      legs.forEach(l => {
        const key = l.driver || "Unassigned";
        if (!m.has(key)) m.set(key, new Set());
        if (l.shipDate && l.delDate) {
          const overlapStart = new Date(Math.max(new Date(dateFrom), new Date(l.shipDate)));
          const overlapEnd   = new Date(Math.min(new Date(dateTo),   new Date(l.delDate)));
          if (overlapStart <= overlapEnd) daysBetween(overlapStart, overlapEnd).forEach(dk => m.get(key).add(dk));
        }
      });
      const utils = Array.from(m.values()).map(set => Math.round((set.size/Math.max(allDays.length,1))*100));
      utilization = utils.length ? Math.round(utils.reduce((a,b)=>a+b,0)/utils.length) : 0;
    }
    return { loads: legs.length, miles, revenue, fleetRPM, onTime, deadheadPct, utilization };
  }, [legs, dateFrom, dateTo]);

  const driverInsights = useMemo(() => {
    const out = [];
    if (!legs.length) return out;
    const ds = Array.from(new Set(legs.map(l => l.driver)));
    ds.forEach(d => {
      const my = legs.filter(l => l.driver === d);
      const rev = my.reduce((a,b)=>a+(b.fee||0),0);
      const mi  = my.reduce((a,b)=>a+(b.miles||0),0);
      out.push({ driver: d, revenue: rev, miles: mi, rpm: mi>0 ? (rev/mi).toFixed(2) : "0.00" });
    });
    return out.sort((a,b)=>b.revenue - a.revenue);
  }, [legs]);

  // Geocode endpoints and draw routes
  const [endpoints, setEndpoints] = useState([]);
  const mapRef = useRef(null);
  const [mapHeight, setMapHeight] = useState(560);
  useEffect(()=>setMapHeight(Math.max(420, Math.min(820, 420 + legs.length*18))),[legs.length]);
  useEffect(() => {
    if (!isLoaded) return;
    const geocoder = new google.maps.Geocoder();
    (async () => {
      const out = [];
      for (const l of legs) {
        if (!l.originFull || !l.destFull) continue;
        try {
          const [o, d] = await Promise.all([
            geocoder.geocode({ address: l.originFull }).then(r=>r.results?.[0]?.geometry?.location),
            geocoder.geocode({ address: l.destFull   }).then(r=>r.results?.[0]?.geometry?.location),
          ]);
          if (o && d) {
            const mid = new google.maps.LatLng((o.lat()+d.lat())/2, (o.lng()+d.lng())/2);
            out.push({ start:o, end:d, mid, color: colorByDriver(l.driver) });
          }
        } catch {}
        await new Promise(r=>setTimeout(r,80));
      }
      setEndpoints(out);
    })();
  }, [isLoaded, JSON.stringify(legs.map(l=>[l.originFull,l.destFull,l.driver]))]);

  useEffect(() => {
    if (!isLoaded || !mapRef.current || !endpoints.length) return;
    const b = new google.maps.LatLngBounds();
    endpoints.forEach(ep=>{ b.extend(ep.start); b.extend(ep.end); });
    mapRef.current.fitBounds(b, 64);
  }, [isLoaded, endpoints.length]);

  // Draggable divider (resizable sidebar)
  const [sidebarW, setSidebarW] = useState(Number(localStorage.getItem("sidebar_w") || 380));
  const dragging = useRef(false);
  const onDragStart = (e) => { dragging.current = true; e.preventDefault(); };
  const onDragMove = (e) => {
    if (!dragging.current) return;
    const x = e.clientX || (e.touches && e.touches[0]?.clientX);
    if (!x) return;
    const rectLeft = 24; // padding approx
    const w = Math.max(280, Math.min(640, x - rectLeft));
    setSidebarW(w);
  };
  const onDragEnd = () => { if (dragging.current){ dragging.current=false; localStorage.setItem("sidebar_w", String(sidebarW)); } };
  useEffect(()=>{
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);
    window.addEventListener("touchmove", onDragMove);
    window.addEventListener("touchend", onDragEnd);
    return () => {
      window.removeEventListener("mousemove", onDragMove);
      window.removeEventListener("mouseup", onDragEnd);
      window.removeEventListener("touchmove", onDragMove);
      window.removeEventListener("touchend", onDragEnd);
    };
  }, [sidebarW]);

  const styles = {
    page: { padding: 16, background: "#0f1115", color: "#e6e8ee", fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial" },
    card: { background: "#151923", border: "1px solid #232838", borderRadius: 14 },
    muted: { color: "#a2a9bb" },
    chip: { border: "1px solid #232838", borderRadius: 999, padding: "4px 8px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 },
    btn: { padding: "8px 12px", border: "1px solid #232838", borderRadius: 10, cursor: "pointer", color: "#e6e8ee", background: "transparent" },
    btnAccent: { padding: "8px 12px", borderRadius: 10, cursor: "pointer", color: "#0b0d12", background: "#D2F000", border: "1px solid #D2F000", fontWeight: 700 },
    tab: (active) => ({ padding: "10px 14px", borderRadius: 10, cursor: "pointer", border: "1px solid #232838", background: active ? "#232838" : "transparent", color: "#e6e8ee", fontWeight: 700 }),
    badgeNew: { marginLeft: 8, background: "#D2F000", color: "#0b0d12", borderRadius: 6, padding: "2px 6px", fontSize: 11, fontWeight: 800 },
    divider: { width: 6, cursor: "col-resize", background: "#0b0d12", border: "1px solid #232838", borderRadius: 6 },
  };

  const onReset = () => { setSelDrivers([]); setDateFrom(""); setDateTo(""); setBasis("pickup"); setRouteStyle("lines"); setShowTraffic(false); };

  return (
    <div style={styles.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={styles.tab(tab === "dashboard")} onClick={()=>setTab("dashboard")}>Dashboard</button>
          <button style={styles.tab(tab === "insights")} onClick={()=>setTab("insights")}>
            Insights <span style={styles.badgeNew}>NEW</span>
          </button>
        </div>
        <button style={styles.btn} onClick={onReset}>Reset</button>
      </div>

      {/* Filters (dashboard only) */}
      {tab === "dashboard" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gap: 8 }}>
          <div style={{ ...styles.card, padding: 8 }}>
            <div style={{ fontSize: 12, ...styles.muted }}>Date from</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input ref={fromRef} type="date" value={dateFrom} onChange={(e)=>setDateFrom(e.target.value)}
                     style={{ flex: 1, background: "transparent", color: "#e6e8ee", border: "1px solid #232838", borderRadius: 10, padding: "6px 10px" }}/>
              <button title="Open calendar" style={styles.btn} onClick={()=>fromRef.current?.showPicker?.()}>📅</button>
            </div>
          </div>
          <div style={{ ...styles.card, padding: 8 }}>
            <div style={{ fontSize: 12, ...styles.muted }}>Date to</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input ref={toRef} type="date" value={dateTo} onChange={(e)=>setDateTo(e.target.value)}
                     style={{ flex: 1, background: "transparent", color: "#e6e8ee", border: "1px solid #232838", borderRadius: 10, padding: "6px 10px" }}/>
              <button title="Open calendar" style={styles.btn} onClick={()=>toRef.current?.showPicker?.()}>📅</button>
            </div>
          </div>
          <div style={{ ...styles.card, padding: 8 }}>
            <div style={{ fontSize: 12, ...styles.muted }}>Date basis</div>
            <select value={basis} onChange={(e)=>setBasis(e.target.value)}
                    style={{ width: "100%", background: "transparent", color: "#e6e8ee", border: "1px solid #232838", borderRadius: 10, padding: "6px 10px" }}>
              <option value="pickup">Pickup (Ship Date)</option>
              <option value="delivery">Delivery (Del. Date)</option>
            </select>
          </div>
          <div style={{ ...styles.card, padding: 8 }}>
            <div style={{ fontSize: 12, ...styles.muted }}>Route style</div>
            <select value={routeStyle} onChange={(e)=>setRouteStyle(e.target.value)}
                    style={{ width: "100%", background: "transparent", color: "#e6e8ee", border: "1px solid #232838", borderRadius: 10, padding: "6px 10px" }}>
              <option value="lines">Straight Lines</option>
              <option value="driving">Driving Directions</option>
            </select>
          </div>
          <div style={{ ...styles.card, padding: 8 }}>
            <div style={{ fontSize: 12, ...styles.muted }}>Traffic</div>
            <button style={styles.btn} onClick={()=>setShowTraffic(v=>!v)}>{showTraffic? "On":"Off"}</button>
          </div>
          <div style={{ ...styles.card, padding: 8 }}>
            <div style={{ fontSize: 12, ...styles.muted }}>Data Source</div>
            <select value={dataSource} onChange={(e)=>setDataSource(e.target.value)}
                    style={{ width: "100%", background: "transparent", color: "#e6e8ee", border: "1px solid #232838", borderRadius: 10, padding: "6px 10px" }}>
              <option value="upload">Upload</option>
              <option value="sheets">Google Sheets</option>
            </select>
          </div>
        </div>
      )}

      {/* API + source (dashboard only) */}
      {tab === "dashboard" && (
        <div style={{ ...styles.card, padding: 12, marginTop: 10 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 12, ...styles.muted }}>Google Maps API Key</div>
              <input type="password" value={apiKey} onChange={(e)=>setApiKey(e.target.value)}
                     style={{ width: "100%", background: "transparent", color: "#e6e8ee", border: "1px solid #232838", borderRadius: 10, padding: "6px 10px" }}/>
            </div>

            {dataSource === "upload" ? (
              <div style={{ minWidth: 260 }}>
                <div style={{ fontSize: 12, ...styles.muted }}>Upload Excel/CSV</div>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile}
                       style={{ width: "100%", background: "transparent", color: "#e6e8ee", border: "1px solid #232838", borderRadius: 10, padding: "6px 10px" }}/>
                {fileName && <div style={{ fontSize: 11, ...styles.muted, marginTop: 4 }}>Loaded: {fileName}</div>}
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, flex: 1, minWidth: 420 }}>
                <input type="url" placeholder="Paste published CSV link"
                       value={sheetUrl} onChange={(e)=>setSheetUrl(e.target.value)}
                       style={{ flex: 1, background: "transparent", color: "#e6e8ee", border: "1px solid #232838", borderRadius: 10, padding: "6px 10px" }}/>
                <button style={styles.btnAccent} onClick={()=>syncFromSheet()}>Sync</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* KPIs */}
      <div style={{ ...styles.card, padding: 12, marginTop: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 10 }}>
          <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>Loads</div><div style={{ fontSize: 22, fontWeight: 800 }}>{kpi.loads}</div></div>
          <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>Miles</div><div style={{ fontSize: 22, fontWeight: 800 }}>{num(kpi.miles)}</div></div>
          <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>Revenue</div><div style={{ fontSize: 22, fontWeight: 800 }}>{money(kpi.revenue)}</div></div>
          <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>Fleet RPM</div><div style={{ fontSize: 22, fontWeight: 800 }}>{kpi.fleetRPM}</div></div>
          <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>On‑Time %</div><div style={{ fontSize: 22, fontWeight: 800 }}>{kpi.onTime}%</div></div>
          <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>Utilization %</div><div style={{ fontSize: 22, fontWeight: 800 }}>{kpi.utilization}%</div></div>
          <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>Deadhead %</div><div style={{ fontSize: 22, fontWeight: 800 }}>{kpi.deadheadPct}%</div></div>
        </div>
      </div>

      {/* Dashboard body with draggable divider */}
      {tab === "dashboard" && (
        <div style={{ display: "grid", gridTemplateColumns: `${sidebarW}px 6px 1fr`, gap: 14, marginTop: 12, alignItems: "stretch" }}>
          {/* Sidebar */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <DriverPicker drivers={drivers} selDrivers={selDrivers} setSelDrivers={setSelDrivers} />

            <div style={{ ...styles.card, padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Loads</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {legs.map((l, i) => {
                  const c = colorByDriver(l.driver);
                  const deadPct = (l.miles>0) ? Math.round((l.emptyMiles||0) / l.miles * 100) : 0;
                  return (
                    <div key={i} style={{ ...styles.card, padding: 12, borderColor: c }}>
                      <div style={{ fontWeight: 700 }}>{l.driver} • Load {l.loadNo ?? ""}</div>
                      <div style={{ color: "#a2a9bb", fontSize: 12 }}>{fmt(l.shipDate)} pickup • {fmt(l.delDate)} delivery — {l.originCS || "—"} → {l.destCS || "—"}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                        <span style={styles.chip}>Rev {money(l.fee)}</span>
                        <span style={styles.chip}>Mi {num(l.miles)}</span>
                        <span style={styles.chip}>Loaded {num(l.loadedMiles)}</span>
                        <span style={styles.chip}>Empty {num(l.emptyMiles)}</span>
                        <span style={styles.chip}>RPM {rpm(l.fee, l.miles)}</span>
                        <span style={styles.chip}>On‑Time {l.onTime ? "Yes" : "No"}</span>
                        {deadPct > 20 && <span style={{ ...styles.chip, borderColor: "#ef4444", color: "#ef4444" }}>High Deadhead {deadPct}%</span>}
                      </div>
                    </div>
                  );
                })}
                {legs.length === 0 && <div style={{ color: "#a2a9bb" }}>No loads match the filters.</div>}
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={styles.divider} onMouseDown={onDragStart} onTouchStart={onDragStart} />

          {/* Map */}
          <div style={{ ...styles.card, position: "relative", height: mapHeight }}>
            {apiKey ? (isLoaded ? (
              <GoogleMap onLoad={(m)=> (mapRef.current = m)} mapContainerStyle={{ width: "100%", height: "100%" }}
                center={{ lat: 36.5, lng: -96.5 }} zoom={5} options={{ streetViewControl: false, mapTypeControl: true, fullscreenControl: true }}>
                {showTraffic && <TrafficLayer autoUpdate />}
                {endpoints.map((ep, idx) => (
                  <React.Fragment key={idx}>
                    <Marker position={ep.start} icon={{ path: google.maps.SymbolPath.CIRCLE, scale: 5, fillColor: "#22c55e", fillOpacity: 1, strokeColor: "#000", strokeWeight: 1 }}/>
                    <Marker position={ep.end} icon={{ path: google.maps.SymbolPath.CIRCLE, scale: 5, fillColor: "#ef4444", fillOpacity: 1, strokeColor: "#000", strokeWeight: 1 }}/>
                    <Polyline path={[ep.start, ep.end]} options={{ strokeColor: ep.color, strokeOpacity: 0.9, strokeWeight: 3 }} />
                    <Marker position={ep.mid} label={{ text: String(idx + 1), color: "#0b0d12", fontWeight: "800" }}
                      icon={{ path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: "#D2F000", fillOpacity: 1, strokeColor: "#000", strokeWeight: 1 }}/>
                  </React.Fragment>
                ))}
              </GoogleMap>
            ) : (<div style={{ display: "grid", placeItems: "center", height: "100%", color: "#a2a9bb" }}>Loading Google Maps…</div>))
            : (<div style={{ display: "grid", placeItems: "center", height: "100%", color: "#a2a9bb" }}>Paste your Google Maps API key to load the map</div>)}
          </div>
        </div>
      )}

      {/* Insights tab */}
      {tab === "insights" && (
        <div style={{ ...styles.card, padding: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 10 }}>Driver Insights (current filters)</div>
          {driverInsights.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
              {driverInsights.map((d, i) => (
                <div key={i} style={{ ...styles.card, padding: 12 }}>
                  <div style={{ fontWeight: 700 }}>{d.driver}</div>
                  <div style={{ color: "#a2a9bb", fontSize: 12 }}>Revenue</div>
                  <div style={{ fontWeight: 800 }}>{money(d.revenue)}</div>
                  <div style={{ color: "#a2a9bb", fontSize: 12, marginTop: 6 }}>Miles</div>
                  <div style={{ fontWeight: 800 }}>{num(d.miles)}</div>
                  <div style={{ color: "#a2a9bb", fontSize: 12, marginTop: 6 }}>RPM</div>
                  <div style={{ fontWeight: 800 }}>{d.rpm}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: "#a2a9bb" }}>No data for selected range.</div>
          )}
        </div>
      )}
    </div>
  );
}

