
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
};

/** ===== Helpers ===== */
const excelToDate = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    const base = new Date(1899, 11, 30);
    return new Date(base.getTime() + v * 86400000);
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

/** ===== Component ===== */
export default function App() {
  /** Theme / key */
  const envKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
  const [apiKey, setApiKey] = useState(localStorage.getItem("gmaps_api_key") || envKey);
  useEffect(() => localStorage.setItem("gmaps_api_key", apiKey || ""), [apiKey]);

  const { isLoaded } = useJsApiLoader({ id: "gmaps-script", googleMapsApiKey: apiKey || "", libraries: ["places"] });

  /** Data Source: Upload | Google Sheets */
  const [dataSource, setDataSource] = useState(localStorage.getItem("data_source") || "upload"); // 'upload' | 'sheets'
  const [sheetUrl, setSheetUrl] = useState(localStorage.getItem("sheet_url") || "");
  useEffect(() => localStorage.setItem("data_source", dataSource), [dataSource]);
  useEffect(() => localStorage.setItem("sheet_url", sheetUrl), [sheetUrl]);

  /** Data rows + file name (upload stays in memory on reset) */
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState("");

  /** Upload handler */
  async function handleFile(e) {
    const f = e.target.files?.[0]; if (!f) return;
    setFileName(f.name);
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
    setRows(json);
  }

  /** Google Sheets CSV loader */
  async function syncFromSheet(link = sheetUrl) {
    if (!link) return;
    try {
      const res = await fetch(link, { cache: "no-store" });
      const csv = await res.text();
      const wb = XLSX.read(csv, { type: "string" });        // parse CSV text
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
      setRows(json);
    } catch (e) {
      console.error("Sheet load error", e);
      alert("Could not load from Google Sheets CSV link. Double-check that the sheet is published to the web as CSV and publicly viewable.");
    }
  }

  /** Drivers */
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
  const [routeStyle, setRouteStyle] = useState("lines"); // lines | driving
  const [showTraffic, setShowTraffic] = useState(false);

  const fromRef = useRef(null);
  const toRef = useRef(null);

  /** Load from sheet on first mount if chosen */
  useEffect(() => {
    if (dataSource === "sheets" && sheetUrl) syncFromSheet(sheetUrl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Build legs (ordered + filtered) */
  const legs = useMemo(() => {
    const from = dateFrom ? new Date(dateFrom + "T00:00:00") : null;
    const to   = dateTo   ? new Date(dateTo   + "T23:59:59") : null;

    const cityState = (city, st) => [city, st].filter(Boolean).join(", ");
    const originCS  = (r) => cityState(r[COLS.shipperCity], r[COLS.shipperState]);
    const destCS    = (r) => cityState(r[COLS.receiverCity], r[COLS.receiverState]);

    const filtered = rows
      .filter(r => selDrivers.length ? selDrivers.includes((r[COLS.driver] ?? "").toString().trim()) : true)
      .filter(r => !isCanceled(r[COLS.status]))
      .filter(r => {
        const d = basis === "pickup" ? excelToDate(r[COLS.shipDate]) : excelToDate(r[COLS.delDate]);
        if (!from && !to) return true;
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      })
      .map(r => ({
        driver: (r[COLS.driver] ?? "").toString().trim(),
        loadNo: r[COLS.loadNo],
        shipDate: excelToDate(r[COLS.shipDate]),
        delDate: excelToDate(r[COLS.delDate]),
        originFull: [r[COLS.shipperName], r[COLS.shipperAddr], originCS(r)].filter(Boolean).join(", "),
        destFull:   [r[COLS.receiverName], r[COLS.receiverAddr], destCS(r)].filter(Boolean).join(", "),
        originCS: originCS(r),
        destCS: destCS(r),
        miles: Number(r[COLS.miles] || 0),
        fee: Number(r[COLS.fee] || 0),
        onTime: !(isLate(r[COLS.shipperArrival]) || isLate(r[COLS.receiverArrival])),
      }))
      .filter(x => x.originFull && x.destFull)
      .sort((a, b) => (a.shipDate?.getTime?.() ?? 0) - (b.shipDate?.getTime?.() ?? 0));

    return filtered;
  }, [rows, selDrivers, dateFrom, dateTo, basis]);

  /** KPIs */
  const kpi = useMemo(() => {
    const loads = legs.length;
    const miles = Math.round(legs.reduce((a, b) => a + (b.miles || 0), 0));
    const revenue = legs.reduce((a, b) => a + (b.fee || 0), 0);
    const timed = legs.filter(l => l.onTime !== null);
    const ontime = timed.length ? Math.round(100 * timed.filter(l => l.onTime).length / timed.length) : 0;
    const fleetRPM = miles > 0 ? (revenue / miles).toFixed(2) : "0.00";
    return { loads, miles, revenue, ontime, fleetRPM };
  }, [legs]);

  /** Directions + endpoints (for straight lines) */
  const [routes, setRoutes] = useState([]); // DirectionsResult[]
  const [endpoints, setEndpoints] = useState([]); // {start, end, color, mid}
  useEffect(() => {
    if (!isLoaded || !legs.length) { setRoutes([]); setEndpoints([]); return; }
    let cancelled = false;
    const svc = new google.maps.DirectionsService();
    (async () => {
      const Rs = [];
      const Es = [];
      for (let i = 0; i < legs.length; i++) {
        try {
          const res = await svc.route({ origin: legs[i].originFull, destination: legs[i].destFull, travelMode: google.maps.TravelMode.DRIVING });
          if (cancelled) break;
          Rs.push(res);
          const lg = res.routes[0]?.legs[0];
          if (lg) {
            const start = lg.start_location, end = lg.end_location;
            const mid = new google.maps.LatLng(
              (start.lat() + end.lat()) / 2,
              (start.lng() + end.lng()) / 2
            );
            Es.push({ start, end, mid, color: colorByDriver(legs[i].driver) });
          }
          await new Promise(r => setTimeout(r, 120));
        } catch (e) {
          console.warn("Directions error", e);
        }
      }
      if (!cancelled) { setRoutes(Rs); setEndpoints(Es); }
    })();
    return () => { cancelled = true; };
  }, [isLoaded, JSON.stringify(legs)]);

  /** Map fit + dynamic height */
  const mapRef = useRef(null);
  const [mapHeight, setMapHeight] = useState(560);
  useEffect(() => {
    // Grow / shrink with number of legs a bit (bounded)
    const h = Math.max(420, Math.min(820, 420 + legs.length * 18));
    setMapHeight(h);
  }, [legs.length]);

  useEffect(() => {
    if (!isLoaded || !mapRef.current) return;
    const m = mapRef.current;
    const b = new google.maps.LatLngBounds(); let had = false;
    if (routeStyle === "driving") {
      routes.forEach(r => r.routes[0]?.overview_path?.forEach(p => { b.extend(p); had = true; }));
    } else {
      endpoints.forEach(ep => { b.extend(ep.start); b.extend(ep.end); had = true; });
    }
    if (had) m.fitBounds(b, 64);
  }, [isLoaded, routes.length, endpoints.length, routeStyle]);

  /** Draggable divider (desktop) */
  const [leftWidth, setLeftWidth] = useState(() => Number(localStorage.getItem("left_width_px") || 380));
  const dragRef = useRef(false);
  useEffect(() => localStorage.setItem("left_width_px", String(leftWidth)), [leftWidth]);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return;
      const x = e.clientX;
      const min = 280, max = 700;
      setLeftWidth(Math.max(min, Math.min(max, x - 16))); // padding offset
    };
    const onUp = () => { dragRef.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  /** Reset (keeps uploaded rows / sheet link) */
  function onReset() {
    setSelDrivers([]);
    setDateFrom("");
    setDateTo("");
    setBasis("pickup");
    setRouteStyle("lines");
    setShowTraffic(false);
    // rows + dataSource + sheetUrl intentionally kept
  }

  /** UI styles (dark theme, no white inputs) */
  const styles = {
    page: { padding: 16, background: "#0f1115", color: "#e6e8ee", fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial" },
    card: { background: "#151923", border: "1px solid #232838", borderRadius: 14, boxShadow: "0 8px 20px rgba(0,0,0,.25)" },
    muted: { color: "#8b93a7" },
    divider: { width: 6, cursor: "col-resize", background: "linear-gradient(#232838,#2a3044)", borderRadius: 4 },
    badge: { background: "#D2F000", color: "#0b0d12", fontWeight: 800, width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 999 },
    chip: { border: "1px solid #232838", borderRadius: 999, padding: "4px 8px", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 },
    btn: { padding: "8px 12px", border: "1px solid #232838", borderRadius: 10, cursor: "pointer", color: "#e6e8ee", background: "transparent" },
    btnAccent: { padding: "8px 12px", borderRadius: 10, cursor: "pointer", color: "#0b0d12", background: "#D2F000", border: "1px solid #D2F000", fontWeight: 700 },
  };

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Driver Routing Dashboard</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={styles.btn} onClick={onReset}>Reset</button>
        </div>
      </div>

      {/* Top filters bar */}
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

      {/* Main grid with draggable divider */}
      <div style={{ display: "grid", gridTemplateColumns: `${leftWidth}px 6px 1fr`, gap: 14, marginTop: 12 }}>
        {/* LEFT PANE */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, width: leftWidth }}>
          {/* Source + Key */}
          <div style={{ ...styles.card, padding: 12 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 12, ...styles.muted }}>Google Maps API Key</div>
                <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                       placeholder="Paste your key"
                       style={{ width: "100%", background: "transparent", color: "#e6e8ee", border: "1px solid #232838", borderRadius: 10, padding: "6px 10px" }}/>
              </div>

              {dataSource === "upload" ? (
                <div style={{ minWidth: 220 }}>
                  <div style={{ fontSize: 12, ...styles.muted }}>Upload Excel/CSV</div>
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile}
                         style={{ width: "100%", background: "transparent", color: "#e6e8ee", border: "1px solid #232838", borderRadius: 10, padding: "6px 10px" }}/>
                  {fileName && <div style={{ fontSize: 11, ...styles.muted, marginTop: 4 }}>Loaded: {fileName}</div>}
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8, flex: 1, minWidth: 300 }}>
                  <input type="url" placeholder="Paste published CSV link (Google Sheets → Publish to web → CSV)"
                         value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)}
                         style={{ flex: 1, background: "transparent", color: "#e6e8ee", border: "1px solid #232838", borderRadius: 10, padding: "6px 10px" }}/>
                  <button style={styles.btnAccent} onClick={() => syncFromSheet()}>Sync</button>
                </div>
              )}
            </div>
          </div>

          {/* KPIs */}
          <div style={{ ...styles.card, padding: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0,1fr))", gap: 10 }}>
              <div style={{ ...styles.card, padding: 12 }}>
                <div style={{ fontSize: 12, ...styles.muted }}>Loads</div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{kpi.loads}</div>
              </div>
              <div style={{ ...styles.card, padding: 12 }}>
                <div style={{ fontSize: 12, ...styles.muted }}>Miles</div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{num(kpi.miles)}</div>
              </div>
              <div style={{ ...styles.card, padding: 12 }}>
                <div style={{ fontSize: 12, ...styles.muted }}>Revenue</div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{money(kpi.revenue)}</div>
              </div>
              <div style={{ ...styles.card, padding: 12 }}>
                <div style={{ fontSize: 12, ...styles.muted }}>Fleet RPM</div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{kpi.fleetRPM}</div>
              </div>
              <div style={{ ...styles.card, padding: 12 }}>
                <div style={{ fontSize: 12, ...styles.muted }}>On‑Time %</div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{kpi.ontime}%</div>
              </div>
            </div>
          </div>

          {/* Driver picker */}
          <div style={{ ...styles.card, padding: 12 }}>
            <div style={{ fontSize: 12, ...styles.muted, marginBottom: 6 }}>Drivers</div>
            <select
              multiple
              size={Math.min(8, Math.max(4, drivers.length || 6))}
              value={selDrivers}
              onChange={(e) => setSelDrivers([...e.target.selectedOptions].map(o => o.value))}
              style={{ width: "100%", background: "transparent", color: "#e6e8ee", border: "1px solid #232838", borderRadius: 10, padding: "6px 10px" }}
            >
              {drivers.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          {/* Load list */}
          <div style={{ ...styles.card, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Loads</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {legs.map((l, i) => {
                const c = colorByDriver(l.driver);
                return (
                  <div key={i} style={{ ...styles.card, padding: 12, borderColor: c }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <span style={{ ...styles.badge, background: c }}>{i + 1}</span>
                        <div>
                          <div style={{ fontWeight: 700 }}>{l.driver} • Load {l.loadNo ?? ""}</div>
                          <div style={{ ...styles.muted, fontSize: 12 }}>
                            {l.shipDate ? l.shipDate.toLocaleDateString() : ""} — {l.originCS} → {l.destCS}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        <span style={styles.chip}>Rev {money(l.fee)}</span>
                        <span style={styles.chip}>Mi {num(l.miles)}</span>
                        <span style={styles.chip}>RPM {rpm(l.fee, l.miles)}</span>
                        <span style={styles.chip}>On‑Time {l.onTime ? "Yes" : "No"}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {legs.length === 0 && <div style={{ color: "#8b93a7" }}>No loads match the filters.</div>}
            </div>
          </div>
        </div>

        {/* DRAG DIVIDER */}
        <div
          style={styles.divider}
          onMouseDown={() => (dragRef.current = true)}
          title="Drag to resize"
        />

        {/* MAP */}
        <div style={{ ...styles.card, position: "relative", height: mapHeight }}>
          {apiKey ? (
            isLoaded ? (
              <GoogleMap
                onLoad={(m) => (mapRef.current = m)}
                mapContainerStyle={{ width: "100%", height: "100%" }}
                center={{ lat: 36.5, lng: -96.5 }}
                zoom={5}
                options={{ streetViewControl: false, mapTypeControl: true, fullscreenControl: true }}
              >
                {showTraffic && <TrafficLayer autoUpdate />}

                {routeStyle === "driving" &&
                  routes.map((r, idx) => (
                    <DirectionsRenderer
                      key={idx}
                      directions={r}
                      options={{
                        preserveViewport: true,
                        polylineOptions: {
                          strokeColor: colorByDriver(legs[idx]?.driver || String(idx)),
                          strokeWeight: 4,
                          strokeOpacity: 0.95,
                        },
                      }}
                    />
                  ))}

                {routeStyle === "lines" &&
                  endpoints.map((ep, idx) => (
                    <React.Fragment key={idx}>
                      {/* Pickup / Delivery dots */}
                      <Marker
                        position={ep.start}
                        icon={{ path: google.maps.SymbolPath.CIRCLE, scale: 5, fillColor: "#22c55e", fillOpacity: 1, strokeColor: "#000", strokeWeight: 1 }}
                      />
                      <Marker
                        position={ep.end}
                        icon={{ path: google.maps.SymbolPath.CIRCLE, scale: 5, fillColor: "#ef4444", fillOpacity: 1, strokeColor: "#000", strokeWeight: 1 }}
                      />
                      {/* Straight line */}
                      <Polyline path={[ep.start, ep.end]} options={{ strokeColor: ep.color, strokeOpacity: 0.9, strokeWeight: 3 }} />
                      {/* Number label near the lane (midpoint) */}
                      <Marker
                        position={ep.mid}
                        label={{ text: String(idx + 1), color: "#0b0d12", fontWeight: "800" }}
                        icon={{ path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: "#D2F000", fillOpacity: 1, strokeColor: "#000", strokeWeight: 1 }}
                      />
                    </React.Fragment>
                  ))}
              </GoogleMap>
            ) : (
              <div style={{ display: "grid", placeItems: "center", height: "100%", color: "#8b93a7" }}>Loading Google Maps…</div>
            )
          ) : (
            <div style={{ display: "grid", placeItems: "center", height: "100%", color: "#8b93a7" }}>
              Paste your Google Maps API key to load the map
            </div>
          )}

          {/* Legend */}
          <div
            style={{
              position: "absolute",
              left: 16,
              bottom: 16,
              padding: "8px 10px",
              background: "rgba(15,17,21,.9)",
              border: "1px solid #232838",
              borderRadius: 10,
              fontSize: 12,
            }}
          >
            Route: {routeStyle === "lines" ? "Straight lines (pickup→delivery)" : "Driving directions"} • Traffic: {showTraffic ? "On" : "Off"}
          </div>
        </div>
      </div>
    </div>
  );
}
