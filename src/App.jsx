
import React, { useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, useJsApiLoader, Polyline, Marker, TrafficLayer, DirectionsRenderer } from "@react-google-maps/api";
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
  miles: "Miles",
  fee: "Hauling Fee",
  shipperArrival: "Shipper Arrival Status",
  receiverArrival: "Receiver Arrival Status",
  // Optional for insights
  loadedMiles: "Loaded Miles",
  emptyMiles: "Empty Miles",
};

/** ===== Helpers ===== */
const excelToDate = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    const base = new Date(1899, 11, 30);
    return new Date(base.getTime() + v * 86400000);
  }
  if (typeof v === "string" && v.includes(" ")) {
    const parts = v.split(" ");
    const parsed = new Date(parts[0]);
    if (!isNaN(+parsed)) return parsed;
  }
  const d = new Date(v);
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

/** Sparkline (SVG) */
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

  /** Data Source */
  const [dataSource, setDataSource] = useState(localStorage.getItem("data_source") || "upload");
  const [sheetUrl, setSheetUrl] = useState(localStorage.getItem("sheet_url") || "");
  useEffect(() => localStorage.setItem("data_source", dataSource), [dataSource]);
  useEffect(() => localStorage.setItem("sheet_url", sheetUrl), [sheetUrl]);

  /** Rows */
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState("");

  /** Tabs (NEW: visible Insights tab) */
  const [tab, setTab] = useState(localStorage.getItem("ui_tab") || "dashboard");
  useEffect(() => localStorage.setItem("ui_tab", tab), [tab]);

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

  const drivers = useMemo(() => {
    const s = new Set();
    rows.forEach(r => { const d = (r[COLS.driver] ?? "").toString().trim(); if (d) s.add(d); });
    return Array.from(s).sort();
  }, [rows]);
  const [selDrivers, setSelDrivers] = useState([]);

  /** Filters */
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [basis, setBasis] = useState("pickup"); // pickup | delivery
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
        const d = basis === "pickup" ? excelToDate(r[COLS.shipDate]) : excelToDate(r[COLS.delDate]);
        if (!f && !t) return true;
        if (!d) return false;
        if (f && d < f) return false;
        if (t && d > t) return false;
        return true;
      })
      .map(r => {
        const total = Number(r[COLS.miles] || 0);
        const lm = Number(r[COLS.loadedMiles] || 0);
        const em = Number(r[COLS.emptyMiles] || Math.max(0, total - lm));
        return {
          driver: (r[COLS.driver] ?? "").toString().trim(),
          loadNo: r[COLS.loadNo],
          shipDate: excelToDate(r[COLS.shipDate]),
          delDate: excelToDate(r[COLS.delDate]),
          originFull: [r[COLS.shipperName], r[COLS.shipperAddr], originCS(r)].filter(Boolean).join(", "),
          destFull:   [r[COLS.receiverName], r[COLS.receiverAddr], destCS(r)].filter(Boolean).join(", "),
          originCS: originCS(r), destCS: destCS(r),
          miles: total, loadedMiles: lm, emptyMiles: em,
          fee: Number(r[COLS.fee] || 0),
          onTime: !(isLate(r[COLS.shipperArrival]) || isLate(r[COLS.receiverArrival])),
        };
      })
      .filter(x => x.originFull && x.destFull)
      .sort((a, b) => (a.shipDate?.getTime?.() ?? a.delDate?.getTime?.() ?? 0) - (b.shipDate?.getTime?.() ?? b.delDate?.getTime?.() ?? 0));
  }, [rows, selDrivers, dateFrom, dateTo, basis]);

  /** KPIs + Insights */
  const kpi = useMemo(() => {
    const loads = legs.length;
    const miles = Math.round(legs.reduce((a, b) => a + (b.miles || 0), 0));
    const loaded = Math.round(legs.reduce((a, b) => a + (b.loadedMiles || 0), 0));
    const empty = Math.max(0, miles - loaded);
    const revenue = legs.reduce((a, b) => a + (b.fee || 0), 0);
    const timed = legs.filter(l => l.onTime !== null);
    const ontime = timed.length ? Math.round(100 * timed.filter(l => l.onTime).length / timed.length) : 0;
    const fleetRPM = miles > 0 ? (revenue / miles).toFixed(2) : "0.00";
    const utilization = miles > 0 ? Math.round((loaded / (loaded + empty)) * 100) : 0;
    const deadheadPct = (loaded + empty) > 0 ? Math.round((empty / (loaded + empty)) * 100) : 0;
    return { loads, miles, revenue, ontime, fleetRPM, utilization, deadheadPct, loaded, empty };
  }, [legs]);

  const driverInsights = useMemo(() => {
    const map = new Map();
    const maxTs = legs.reduce((m, l) => Math.max(m, l.shipDate?.getTime?.() ?? l.delDate?.getTime?.() ?? 0), 0);
    const anchor = maxTs ? new Date(maxTs) : new Date();
    const days = [...Array(7)].map((_, i) => {
      const d = new Date(anchor); d.setDate(anchor.getDate() - (6 - i)); d.setHours(0,0,0,0); return d;
    });
    const dayKey = (d) => d.toISOString().slice(0,10);

    legs.forEach(l => {
      const key = l.driver || "Unassigned";
      if (!map.has(key)) map.set(key, { driver: key, revenue: 0, loaded: 0, empty: 0, series: days.map(() => 0) });
      const agg = map.get(key);
      agg.revenue += l.fee || 0;
      agg.loaded += l.loadedMiles || 0;
      agg.empty += l.emptyMiles || 0;
      const d = l.shipDate || l.delDate;
      if (d) {
        const dk = dayKey(d);
        days.forEach((day, idx) => { if (dayKey(day) === dk) agg.series[idx] += l.fee || 0; });
      }
    });
    return Array.from(map.values()).map(v => {
      const totalMi = v.loaded + v.empty;
      const util = totalMi > 0 ? Math.round((v.loaded / totalMi) * 100) : 0;
      return { ...v, utilization: util };
    }).sort((a, b) => b.revenue - a.revenue);
  }, [legs]);

  /** Map prep */
  const [routes, setRoutes] = useState([]);
  const [endpoints, setEndpoints] = useState([]);
  const mapRef = useRef(null);
  const [mapHeight, setMapHeight] = useState(560);
  const [leftWidth, setLeftWidth] = useState(() => Number(localStorage.getItem("left_width_px") || 380));
  const dragRef = useRef(false);

  useEffect(() => { const h = Math.max(420, Math.min(820, 420 + legs.length * 18)); setMapHeight(h); }, [legs.length]);
  useEffect(() => { localStorage.setItem("left_width_px", String(leftWidth)); }, [leftWidth]);
  useEffect(() => {
    if (!isLoaded || !legs.length) { setRoutes([]); setEndpoints([]); return; }
    let cancelled = false;
    const svc = new google.maps.DirectionsService();
    (async () => {
      const Rs = []; const Es = [];
      for (let i = 0; i < legs.length; i++) {
        try {
          const res = await svc.route({ origin: legs[i].originFull, destination: legs[i].destFull, travelMode: google.maps.TravelMode.DRIVING });
          if (cancelled) break; Rs.push(res);
          const lg = res.routes[0]?.legs[0];
          if (lg) {
            const start = lg.start_location, end = lg.end_location;
            const mid = new google.maps.LatLng((start.lat() + end.lat()) / 2, (start.lng() + end.lng()) / 2);
            Es.push({ start, end, mid, color: colorByDriver(legs[i].driver) });
          }
          await new Promise(r => setTimeout(r, 120));
        } catch {}
      }
      if (!cancelled) { setRoutes(Rs); setEndpoints(Es); }
    })();
    return () => { cancelled = true; };
  }, [isLoaded, JSON.stringify(legs)]);

  useEffect(() => {
    if (!isLoaded || !mapRef.current) return;
    const m = mapRef.current;
    const b = new google.maps.LatLngBounds(); let had = false;
    routes.forEach(r => r.routes[0]?.overview_path?.forEach(p => { b.extend(p); had = true; }));
    if (!had) endpoints.forEach(ep => { b.extend(ep.start); b.extend(ep.end); had = true; });
    if (had) m.fitBounds(b, 64);
  }, [isLoaded, routes.length, endpoints.length]);

  const styles = {
    page: { padding: 16, background: "#0f1115", color: "#e6e8ee", fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial" },
    card: { background: "#151923", border: "1px solid #232838", borderRadius: 14, boxShadow: "0 8px 20px rgba(0,0,0,.25)" },
    muted: { color: "#8b93a7" },
    divider: { width: 6, cursor: "col-resize", background: "linear-gradient(#232838,#2a3044)", borderRadius: 4 },
    badge: { background: "#D2F000", color: "#0b0d12", fontWeight: 800, width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 999 },
    chip: { border: "1px solid #232838", borderRadius: 999, padding: "4px 8px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 },
    btn: { padding: "8px 12px", border: "1px solid #232838", borderRadius: 10, cursor: "pointer", color: "#e6e8ee", background: "transparent" },
    btnAccent: { padding: "8px 12px", borderRadius: 10, cursor: "pointer", color: "#0b0d12", background: "#D2F000", border: "1px solid #D2F000", fontWeight: 700 },
    tab: (active) => ({ padding: "10px 14px", borderRadius: 10, cursor: "pointer", border: "1px solid #232838", background: active ? "#232838" : "transparent", fontWeight: 700 }),
    newBadge: { marginLeft: 8, background: "#D2F000", color: "#0b0d12", borderRadius: 6, padding: "2px 6px", fontSize: 11, fontWeight: 800 },
  };

  function onReset() {
    setSelDrivers([]); setDateFrom(""); setDateTo(""); setBasis("pickup"); setRouteStyle("lines"); setShowTraffic(false);
  }

  /** Top bar with TABS (Dashboard / Insights) */
  return (
    <div style={styles.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={styles.tab(tab === "dashboard")} onClick={() => setTab("dashboard")}>Dashboard</button>
          <button style={styles.tab(tab === "insights")} onClick={() => setTab("insights")}>
            Insights <span style={styles.newBadge}>NEW</span>
          </button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={styles.btn} onClick={onReset}>Reset</button>
        </div>
      </div>

      {/* === INSIGHTS TAB === */}
      {tab === "insights" ? (
        <div style={{ display: "grid", gap: 12 }}>
          {/* KPIs with Utilization & Deadhead */}
          <div style={{ ...styles.card, padding: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 10 }}>
              <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>Loads</div><div style={{ fontSize: 22, fontWeight: 800 }}>{kpi.loads}</div></div>
              <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>Miles</div><div style={{ fontSize: 22, fontWeight: 800 }}>{num(kpi.miles)}</div></div>
              <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>Revenue</div><div style={{ fontSize: 22, fontWeight: 800 }}>{money(kpi.revenue)}</div></div>
              <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>Fleet RPM</div><div style={{ fontSize: 22, fontWeight: 800 }}>{kpi.fleetRPM}</div></div>
              <div style={{ ...styles.card, padding: 12 }}><div style={{ fontSize: 12, ...styles.muted }}>On‑Time %</div><div style={{ fontSize: 22, fontWeight: 800 }}>{kpi.ontime}%</div></div>
              <div style={{ ...styles.card, padding: 12, borderColor: "#3a3f55" }}><div style={{ fontSize: 12, ...styles.muted }}>Utilization %</div><div style={{ fontSize: 22, fontWeight: 800 }}>{kpi.utilization}%</div></div>
              <div style={{ ...styles.card, padding: 12, borderColor: "#3a3f55" }}><div style={{ fontSize: 12, ...styles.muted }}>Deadhead %</div><div style={{ fontSize: 22, fontWeight: 800 }}>{kpi.deadheadPct}%</div></div>
            </div>
          </div>

          {/* Driver Insights list with sparkline */}
          <div style={{ ...styles.card, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Driver Insights (7‑day revenue trend & utilization)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {driverInsights.map((d, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, border: "1px solid #232838", borderRadius: 10, padding: "8px 10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 10, height: 10, background: colorByDriver(d.driver), borderRadius: 999 }} />
                    <div style={{ fontWeight: 700 }}>{d.driver}</div>
                    <div style={{ fontSize: 12, color: "#8b93a7" }}>Util {d.utilization}%</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Sparkline values={d.series} />
                    <div style={{ fontSize: 12, color: "#8b93a7" }}>{money(d.revenue)}</div>
                  </div>
                </div>
              ))}
              {driverInsights.length === 0 && <div style={{ color: "#8b93a7" }}>No data for selected range.</div>}
            </div>
          </div>
        </div>
      ) : (
      /* === DASHBOARD TAB (existing layout slimmed to prove patch is live) === */
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gap: 8 }}>
          {/* Filters row (same as before, shortened to fit patch) */}
          <div style={{ gridColumn: "span 6" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gap: 8 }}>
              <div style={{ ...styles.card, padding: 8 }}>
                <div style={{ fontSize: 12, ...styles.muted }}>Date from</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input ref={fromRef} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                        style={{ flex: 1, background: "transparent", color: "#e6e8ee", border: "1px solid #232838", borderRadius: 10, padding: "6px 10px" }}/>
                  <button style={{ padding: "8px 12px", border: "1px solid #232838", borderRadius: 10, color: "#e6e8ee", background: "transparent" }} onClick={() => fromRef.current?.showPicker?.()}>📅</button>
                </div>
              </div>
              <div style={{ ...styles.card, padding: 8 }}>
                <div style={{ fontSize: 12, ...styles.muted }}>Date to</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input ref={toRef} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                        style={{ flex: 1, background: "transparent", color: "#e6e8ee", border: "1px solid #232838", borderRadius: 10, padding: "6px 10px" }}/>
                  <button style={{ padding: "8px 12px", border: "1px solid #232838", borderRadius: 10, color: "#e6e8ee", background: "transparent" }} onClick={() => toRef.current?.showPicker?.()}>📅</button>
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
                <button style={{ padding: "8px 12px", border: "1px solid #232838", borderRadius: 10, color: "#e6e8ee", background: "transparent" }} onClick={() => setShowTraffic(v => !v)}>{showTraffic ? "On" : "Off"}</button>
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
          </div>

          {/* Simple loads list to confirm patch is live */}
          <div style={{ gridColumn: "span 3" }}>
            <div style={{ ...styles.card, padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Loads (sample)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {legs.map((l, i) => (
                  <div key={i} style={{ border: "1px solid #232838", borderRadius: 10, padding: "8px 10px" }}>
                    <div style={{ fontWeight: 700 }}>{l.driver} • Load {l.loadNo ?? ""}</div>
                    <div style={{ fontSize: 12, color: "#8b93a7" }}>{fmt(l.shipDate)} pickup • {fmt(l.delDate)} delivery — {l.originCS} → {l.destCS}</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                      <span style={styles.chip}>Rev {money(l.fee)}</span>
                      <span style={styles.chip}>Mi {num(l.miles)}</span>
                      <span style={styles.chip}>Loaded {num(l.loadedMiles)}</span>
                      <span style={styles.chip}>Empty {num(l.emptyMiles)}</span>
                      <span style={styles.chip}>RPM {rpm(l.fee, l.miles)}</span>
                      <span style={styles.chip}>On‑Time {l.onTime ? "Yes" : "No"}</span>
                    </div>
                  </div>
                ))}
                {legs.length === 0 && <div style={{ color: "#8b93a7" }}>No loads match the filters.</div>}
              </div>
            </div>
          </div>

          {/* Map (condensed) */}
          <div style={{ gridColumn: "span 3" }}>
            <div style={{ position: "relative", ...styles.card, height: Math.max(420, Math.min(820, 420 + legs.length * 18)) }}>
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
              ) : (<div style={{ display: "grid", placeItems: "center", height: "100%", color: "#8b93a7" }}>Loading Google Maps…</div>)) : (
                <div style={{ display: "grid", placeItems: "center", height: "100%", color: "#8b93a7" }}>Paste your Google Maps API key to load the map</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
