
import React, { useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, useJsApiLoader, Polyline, Marker, TrafficLayer } from "@react-google-maps/api";
import * as XLSX from "xlsx";

/** ===== Column names expected from your data ===== */
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
  milesLoaded: "Miles",            // LOADED miles
  milesEmpty: "Empty Miles",       // DEADHEAD miles
  fee: "Hauling Fee",
  shipperArrival: "Shipper Arrival Status",
  receiverArrival: "Receiver Arrival Status",
};

/** ===== Helpers ===== */
const excelToDate = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    const base = new Date(1899, 11, 30);
    return new Date(base.getTime() + v * 86400000);
  }
  // tolerate "YYYY-MM-DD HH:mm" or "MM/DD/YYYY HH:mm"
  const onlyDate = String(v).split(" ")[0];
  const d = new Date(onlyDate);
  return isNaN(+d) ? null : d;
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

/** Day enumeration helpers (inclusive) */
const toDayKey = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x.toISOString().slice(0,10); };
const daysBetween = (start, end) => {
  const out = [];
  if (!start || !end) return out;
  const s = new Date(start); s.setHours(0,0,0,0);
  const e = new Date(end);   e.setHours(0,0,0,0);
  for (let d = new Date(s); d <= e; d.setDate(d.getDate()+1)) out.push(toDayKey(d));
  return out;
};

/** Sparkline (simple SVG) */
const Sparkline = ({ values=[], width=80, height=24 }) => {
  const max = Math.max(...values, 1);
  const step = width / Math.max(values.length - 1, 1);
  const pts = values.map((v, i) => {
    const x = i * step;
    const y = height - (v / max) * height;
    return `${x},${y}`;
  }).join(" ");
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}><polyline fill="none" stroke="#D2F000" strokeWidth="2" points={pts} /></svg>;
};

export default function App() {
  const envKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
  const [apiKey, setApiKey] = useState(localStorage.getItem("gmaps_api_key") || envKey);
  useEffect(() => localStorage.setItem("gmaps_api_key", apiKey || ""), [apiKey]);
  const { isLoaded } = useJsApiLoader({ id: "gmaps-script", googleMapsApiKey: apiKey || "", libraries: ["places"] });

  /** Tabs */
  const [tab, setTab] = useState("dashboard");

  /** Data Source */
  const [dataSource, setDataSource] = useState(localStorage.getItem("data_source") || "upload");
  const [sheetUrl, setSheetUrl] = useState(localStorage.getItem("sheet_url") || "");
  useEffect(() => localStorage.setItem("data_source", dataSource), [dataSource]);
  useEffect(() => localStorage.setItem("sheet_url", sheetUrl), [sheetUrl]);

  /** Rows */
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

  /** Drivers + filters */
  const drivers = useMemo(() => {
    const s = new Set();
    rows.forEach(r => { const d = (r[COLS.driver] ?? "").toString().trim(); if (d) s.add(d); });
    return Array.from(s).sort();
  }, [rows]);
  const [selDrivers, setSelDrivers] = useState([]);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [basis, setBasis] = useState("pickup"); // pickup | delivery
  const [routeStyle, setRouteStyle] = useState("lines");
  const [showTraffic, setShowTraffic] = useState(false);
  const fromRef = useRef(null), toRef = useRef(null);

  useEffect(() => { if (dataSource === "sheets" && sheetUrl) syncFromSheet(sheetUrl); }, []);

  /** Build filtered legs with corrected miles logic */
  const legs = useMemo(() => {
    // normalize range and swap if needed
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
        // STRICT basis logic: only compare the chosen date column to the range; the other date is ignored.
        const baseD = basis === "pickup" ? excelToDate(r[COLS.shipDate]) : excelToDate(r[COLS.delDate]);
        if (!f && !t) return true;
        if (!baseD) return false;
        if (f && baseD < f) return false;
        if (t && baseD > t) return false;
        return true;
      })
      .map(r => {
        const driver = (r[COLS.driver] ?? "").toString().trim();
        const loadedMiles = Number(r[COLS.milesLoaded] || 0);      // from Miles column
        const emptyMiles  = Number(r[COLS.milesEmpty] || 0);       // from Empty Miles column
        const totalMiles  = loadedMiles + emptyMiles;               // total per your rule
        return {
          driver,
          loadNo: r[COLS.loadNo],
          shipDate: excelToDate(r[COLS.shipDate]),
          delDate: excelToDate(r[COLS.delDate]),
          originFull: [r[COLS.shipperName], r[COLS.shipperAddr], originCS(r)].filter(Boolean).join(", "),
          destFull:   [r[COLS.receiverName], r[COLS.receiverAddr], destCS(r)].filter(Boolean).join(", "),
          originCS: originCS(r), destCS: destCS(r),
          miles: totalMiles,
          loadedMiles,
          emptyMiles,
          fee: Number(r[COLS.fee] || 0),
          onTime: !(isLate(r[COLS.shipperArrival]) || isLate(r[COLS.receiverArrival])),
        };
      })
      .filter(x => x.originFull && x.destFull)
      .sort((a, b) => {
        const aKey = a.shipDate?.getTime?.() ?? a.delDate?.getTime?.() ?? 0;
        const bKey = b.shipDate?.getTime?.() ?? b.delDate?.getTime?.() ?? 0;
        return aKey - bKey;
      });
  }, [rows, selDrivers, dateFrom, dateTo, basis]);

  /** KPI calculations with corrected RPM + Utilization(day-based) */
  const kpi = useMemo(() => {
    const loads = legs.length;
    const totalMiles = Math.round(legs.reduce((a, b) => a + (b.miles || 0), 0));
    const revenue = legs.reduce((a, b) => a + (b.fee || 0), 0);
    const ontimeBase = legs.filter(l => l.onTime !== null);
    const ontime = ontimeBase.length ? Math.round(100 * ontimeBase.filter(l => l.onTime).length / ontimeBase.length) : 0;
    const fleetRPM = totalMiles > 0 ? (revenue / totalMiles).toFixed(2) : "0.00";
    const empty = Math.round(legs.reduce((a, b) => a + (b.emptyMiles || 0), 0));
    const loaded = Math.max(0, totalMiles - empty);
    const deadheadPct = (loaded + empty) > 0 ? Math.round((empty / (loaded + empty)) * 100) : 0;

    // Day-based utilization across drivers: average of per-driver utilization within selected date range
    let utilization = 0;
    if (dateFrom && dateTo) {
      const allDays = daysBetween(dateFrom, dateTo);
      const byDriver = new Map();
      legs.forEach(l => {
        const key = l.driver || "Unassigned";
        if (!byDriver.has(key)) byDriver.set(key, new Set());
        // overlap days between the load window and selected window
        const start = l.shipDate || l.delDate;
        const end   = l.delDate || l.shipDate;
        if (start && end) {
          const overlapStart = new Date(Math.max(new Date(dateFrom), new Date(start)));
          const overlapEnd   = new Date(Math.min(new Date(dateTo),   new Date(end)));
          if (overlapStart <= overlapEnd) {
            daysBetween(overlapStart, overlapEnd).forEach(dk => byDriver.get(key).add(dk));
          }
        }
      });
      const utils = Array.from(byDriver.values()).map(set => Math.round((set.size / Math.max(allDays.length,1)) * 100));
      utilization = utils.length ? Math.round(utils.reduce((a, b) => a + b, 0) / utils.length) : 0;
    }

    return { loads, miles: totalMiles, revenue, ontime, fleetRPM, deadheadPct, utilization };
  }, [legs, dateFrom, dateTo]);

  /** Driver Insights (with day-based utilization & 7‑day revenue sparkline) */
  const driverInsights = useMemo(() => {
    const out = [];
    if (!legs.length) return out;
    const drivers = Array.from(new Set(legs.map(l => l.driver)));
    drivers.forEach(d => {
      const my = legs.filter(l => l.driver === d);
      // utilization days for this driver
      let util = 0;
      if (dateFrom && dateTo) {
        const allDays = daysBetween(dateFrom, dateTo);
        const set = new Set();
        my.forEach(l => {
          const start = l.shipDate || l.delDate;
          const end   = l.delDate || l.shipDate;
          if (start && end) {
            const overlapStart = new Date(Math.max(new Date(dateFrom), new Date(start)));
            const overlapEnd   = new Date(Math.min(new Date(dateTo),   new Date(end)));
            if (overlapStart <= overlapEnd) {
              daysBetween(overlapStart, overlapEnd).forEach(dk => set.add(dk));
            }
          }
        });
        util = Math.round((set.size / Math.max(allDays.length,1)) * 100);
      }
      // 7-day series ending at max date in legs
      const maxTs = my.reduce((m, l) => Math.max(m, l.shipDate?.getTime?.() ?? l.delDate?.getTime?.() ?? 0), 0);
      const anchor = maxTs ? new Date(maxTs) : new Date();
      const days = [...Array(7)].map((_, i) => { const dd = new Date(anchor); dd.setDate(anchor.getDate() - (6 - i)); dd.setHours(0,0,0,0); return dd; });
      const key = (d) => d.toISOString().slice(0,10);
      const series = days.map(() => 0);
      my.forEach(l => {
        const dkey = key(l.shipDate || l.delDate || new Date());
        const idx = days.map(key).indexOf(dkey);
        if (idx >= 0) series[idx] += l.fee || 0;
      });
      out.push({ driver: d, revenue: my.reduce((a,b)=>a+(b.fee||0),0), utilization: util, series });
    });
    return out.sort((a,b)=>b.revenue-a.revenue);
  }, [legs, dateFrom, dateTo]);

  /** Map endpoints (straight lines with numbered labels) */
  const [endpoints, setEndpoints] = useState([]);
  const mapRef = useRef(null);
  const [mapHeight, setMapHeight] = useState(560);
  useEffect(() => {
    const h = Math.max(420, Math.min(820, 420 + legs.length * 18));
    setMapHeight(h);
    if (!isLoaded || !legs.length) { setEndpoints([]); return; }
    const geocoder = new google.maps.Geocoder();
    (async () => {
      const ps = [];
      for (const l of legs) {
        const [g1, g2] = await Promise.all([
          geocoder.geocode({ address: l.originFull }).then(r=>r.results?.[0]?.geometry?.location).catch(()=>null),
          geocoder.geocode({ address: l.destFull   }).then(r=>r.results?.[0]?.geometry?.location).catch(()=>null),
        ]);
        if (g1 && g2) {
          const mid = new google.maps.LatLng((g1.lat()+g2.lat())/2, (g1.lng()+g2.lng())/2);
          ps.push({ start:g1, end:g2, mid, color: colorByDriver(l.driver) });
        }
        await new Promise(r => setTimeout(r, 80));
      }
      setEndpoints(ps);
    })();
  }, [isLoaded, JSON.stringify(legs)]);

  useEffect(() => {
    if (!isLoaded || !mapRef.current || !endpoints.length) return;
    const m = mapRef.current;
    const b = new google.maps.LatLngBounds();
    endpoints.forEach(ep => { b.extend(ep.start); b.extend(ep.end); });
    m.fitBounds(b, 64);
  }, [isLoaded, endpoints.length]);

  /** Styles (increase contrast for tab text) */
  const styles = {
    page: { padding: 16, background: "#0f1115", color: "#e6e8ee", fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial" },
    card: { background: "#151923", border: "1px solid #232838", borderRadius: 14, boxShadow: "0 8px 20px rgba(0,0,0,.25)" },
    muted: { color: "#a2a9bb" },
    chip: { border: "1px solid #232838", borderRadius: 999, padding: "4px 8px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 },
    btn: { padding: "8px 12px", border: "1px solid #232838", borderRadius: 10, cursor: "pointer", color: "#e6e8ee", background: "transparent" },
    btnAccent: { padding: "8px 12px", borderRadius: 10, cursor: "pointer", color: "#0b0d12", background: "#D2F000", border: "1px solid #D2F000", fontWeight: 700 },
    tab: (active) => ({ padding: "10px 14px", borderRadius: 10, cursor: "pointer", border: "1px solid #232838", background: active ? "#232838" : "transparent", color: "#e6e8ee", fontWeight: 700 }),
    badgeNew: { marginLeft: 8, background: "#D2F000", color: "#0b0d12", borderRadius: 6, padding: "2px 6px", fontSize: 11, fontWeight: 800 },
  };

  function onReset() {
    setSelDrivers([]); setDateFrom(""); setDateTo(""); setBasis("pickup"); setRouteStyle("lines"); setShowTraffic(false);
  }

  /** UI */
  return (
    <div style={styles.page}>
      {/* Tabs + Reset */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={styles.tab(tab === "dashboard")} onClick={() => setTab("dashboard")}>Dashboard</button>
          <button style={styles.tab(tab === "insights")} onClick={() => setTab("insights")}>
            Insights <span style={styles.badgeNew}>NEW</span>
          </button>
        </div>
        <button style={styles.btn} onClick={onReset}>Reset</button>
      </div>

      {/* DASHBOARD */}
      {tab === "dashboard" && (
        <>
          {/* Filters top row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gap: 8 }}>
            <div style={{ ...styles.card, padding: 8 }}>
              <div style={{ fontSize: 12, ...styles.muted }}>Date from</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input ref={fromRef} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                      style={{ flex: 1, background: "transparent", color: "#e6e8ee", border: "1px solid #232838", borderRadius: 10, padding: "6px 10px" }}/>
                <button style={styles.btn} onClick={() => fromRef.current?.showPicker?.()}>📅</button>
              </div>
            </div>
            <div style={{ ...styles.card, padding: 8 }}>
              <div style={{ fontSize: 12, ...styles.muted }}>Date to</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input ref={toRef} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                      style={{ flex: 1, background: "transparent", color: "#e6e8ee", border: "1px solid #232838", borderRadius: 10, padding: "6px 10px" }}/>
                <button style={styles.btn} onClick={() => toRef.current?.showPicker?.()}>📅</button>
              </div>
            </div>
            <div style={{ ...styles.card, padding: 8 }}>
              <div style={{ fontSize: 12, ...styles.muted }}>Date basis</div>
              <select value={basis} onChange={(e) => setBasis(e.target.value)}
                      style={{ width: "100%", background: "transparent", color: "#e6e8ee", border: "1px solid #232838", borderRadius: 10, padding: "6px 10px" }}>
                <option value="pickup">Pickup (Ship Date)</option>
                <option value="delivery">Delivery (Del. Date)</option>
              </select>
            </div>
            <div style={{ ...styles.card, padding: 8 }}>
              <div style={{ fontSize: 12, ...styles.muted }}>Route style</div>
              <select value={routeStyle} onChange={(e) => setRouteStyle(e.target.value)}
                      style={{ width: "100%", background: "transparent", color: "#e6e8ee", border: "1px solid #232838", borderRadius: 10, padding: "6px 10px" }}>
                <option value="lines">Straight Lines</option>
                <option value="driving">Driving Directions</option>
              </select>
            </div>
            <div style={{ ...styles.card, padding: 8 }}>
              <div style={{ fontSize: 12, ...styles.muted }}>Traffic</div>
              <button style={styles.btn} onClick={() => setShowTraffic(v => !v)}>{showTraffic ? "On" : "Off"}</button>
            </div>
            <div style={{ ...styles.card, padding: 8 }}>
              <div style={{ fontSize: 12, ...styles.muted }}>Data Source</div>
              <select value={dataSource} onChange={(e) => setDataSource(e.target.value)}
                      style={{ width: "100%", background: "transparent", color: "#e6e8ee", border: "1px solid #232838", borderRadius: 10, padding: "6px 10px" }}>
                <option value="upload">Upload</option>
                <option value="sheets">Google Sheets</option>
              </select>
            </div>
          </div>

          {/* API + Source */}
          <div style={{ ...styles.card, padding: 12, marginTop: 10 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 12, ...styles.muted }}>Google Maps API Key</div>
                <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                       placeholder="Paste your key"
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
                  <input type="url" placeholder="Paste published CSV link (Google Sheets → File > Share > Publish to web → CSV)"
                         value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)}
                         style={{ flex: 1, background: "transparent", color: "#e6e8ee", border: "1px solid #232838", borderRadius: 10, padding: "6px 10px" }}/>
                  <button style={styles.btnAccent} onClick={() => syncFromSheet()}>Sync</button>
                </div>
              )}
            </div>
          </div>

          {/* KPI row */}
          <div style={{ ...styles.card, padding: 12, marginTop: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 10 }}>
              <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>Loads</div><div style={{ fontSize: 22, fontWeight: 800 }}>{kpi.loads}</div></div>
              <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>Miles</div><div style={{ fontSize: 22, fontWeight: 800 }}>{num(kpi.miles)}</div></div>
              <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>Revenue</div><div style={{ fontSize: 22, fontWeight: 800 }}>{money(kpi.revenue)}</div></div>
              <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>Fleet RPM</div><div style={{ fontSize: 22, fontWeight: 800 }}>{kpi.fleetRPM}</div></div>
              <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>On‑Time %</div><div style={{ fontSize: 22, fontWeight: 800 }}>{kpi.ontime}%</div></div>
              <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>Utilization %</div><div style={{ fontSize: 22, fontWeight: 800 }}>{kpi.utilization}%</div></div>
              <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>Deadhead %</div><div style={{ fontSize: 22, fontWeight: 800 }}>{kpi.deadheadPct}%</div></div>
            </div>
          </div>

          {/* Drivers / Loads / Map */}
          <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 14, marginTop: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ ...styles.card, padding: 12 }}>
                <div style={{ fontSize: 12, ...styles.muted, marginBottom: 6 }}>Drivers</div>
                <select multiple size={Math.min(8, Math.max(4, drivers.length || 6))}
                        value={selDrivers} onChange={(e) => setSelDrivers([...e.target.selectedOptions].map(o => o.value))}
                        style={{ width: "100%", background: "transparent", color: "#e6e8ee", border: "1px solid #232838", borderRadius: 10, padding: "6px 10px" }}>
                  {drivers.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              <div style={{ ...styles.card, padding: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Loads</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {legs.map((l, i) => {
                    const c = colorByDriver(l.driver);
                    const total = l.miles || 0;
                    const deadPct = total > 0 ? Math.round((l.emptyMiles || 0) / total * 100) : 0;
                    return (
                      <div key={i} style={{ ...styles.card, padding: 12, borderColor: c }}>
                        <div style={{ fontWeight: 700 }}>{l.driver} • Load {l.loadNo ?? ""}</div>
                        <div style={{ ...styles.muted, fontSize: 12 }}>{fmt(l.shipDate)} pickup • {fmt(l.delDate)} delivery — {l.originCS} → {l.destCS}</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                          <span style={styles.chip}>Rev {money(l.fee)}</span>
                          <span style={styles.chip}>Mi {num(total)}</span>
                          <span style={styles.chip}>Loaded {num(l.loadedMiles)}</span>
                          <span style={styles.chip}>Empty {num(l.emptyMiles)}</span>
                          <span style={styles.chip}>RPM {rpm(l.fee, total)}</span>
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

            <div style={{ ...styles.card, position: "relative", height: mapHeight }}>
              {apiKey ? (isLoaded ? (
                <GoogleMap onLoad={(m) => (mapRef.current = m)} mapContainerStyle={{ width: "100%", height: "100%" }}
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
              ) : (<div style={{ display: "grid", placeItems: "center", height: "100%", color: "#a2a9bb" }}>Loading Google Maps…</div>)
              ) : (<div style={{ display: "grid", placeItems: "center", height: "100%", color: "#a2a9bb" }}>Paste your Google Maps API key to load the map</div>)}
            </div>
          </div>
        </>
      )}

      {/* INSIGHTS */}
      {tab === "insights" && (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ ...styles.card, padding: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 10 }}>
              <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>Loads</div><div style={{ fontSize: 22, fontWeight: 800 }}>{kpi.loads}</div></div>
              <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>Miles</div><div style={{ fontSize: 22, fontWeight: 800 }}>{num(kpi.miles)}</div></div>
              <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>Revenue</div><div style={{ fontSize: 22, fontWeight: 800 }}>{money(kpi.revenue)}</div></div>
              <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>Fleet RPM</div><div style={{ fontSize: 22, fontWeight: 800 }}>{kpi.fleetRPM}</div></div>
              <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>On‑Time %</div><div style={{ fontSize: 22, fontWeight: 800 }}>{kpi.ontime}%</div></div>
              <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>Utilization %</div><div style={{ fontSize: 22, fontWeight: 800 }}>{kpi.utilization}%</div></div>
              <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>Deadhead %</div><div style={{ fontSize: 22, fontWeight: 800 }}>{kpi.deadheadPct}%</div></div>
            </div>
          </div>

          <div style={{ ...styles.card, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Driver Insights (7‑day revenue trend & day‑based utilization)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {driverInsights.map((d, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, border: "1px solid #232838", borderRadius: 10, padding: "8px 10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 10, height: 10, background: colorByDriver(d.driver), borderRadius: 999 }} />
                    <div style={{ fontWeight: 700 }}>{d.driver}</div>
                    <div style={{ fontSize: 12, color: "#a2a9bb" }}>Util {d.utilization}%</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Sparkline values={d.series} />
                    <div style={{ fontSize: 12, color: "#a2a9bb" }}>{money(d.revenue)}</div>
                  </div>
                </div>
              ))}
              {driverInsights.length === 0 && <div style={{ color: "#a2a9bb" }}>No data for selected range.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
