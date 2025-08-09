
import React, { useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, useJsApiLoader, Polyline, Marker, TrafficLayer, DirectionsRenderer } from "@react-google-maps/api";
import * as XLSX from "xlsx";

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
  fee: "Hauling Fee",
  shipperArrival: "Shipper Arrival Status",
  receiverArrival: "Receiver Arrival Status",
};

const excelToDate = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") { const base = new Date(1899,11,30); return new Date(base.getTime() + v*86400000); }
  const d = new Date(v); return isNaN(+d) ? null : d;
};
const isCanceled = (s) => s && /cancel+ed|cancelled|canceled/i.test(String(s));
const isLate = (s) => s && /late/i.test(String(s));
const money = (n) => (isFinite(n)? n.toLocaleString(undefined,{style:"currency",currency:"USD",maximumFractionDigits:0}) : "$0");
const num = (n) => (isFinite(n)? n.toLocaleString() : "0");
const rpm = (rev, mi) => (mi>0 && isFinite(rev/mi)? (rev/mi).toFixed(2) : "0.00");
const colorByDriver = (key) => { let h=2166136261; for(let i=0;i<key.length;i++){ h^=key.charCodeAt(i); h+=(h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24);} const hue=Math.abs(h)%360; return `hsl(${hue} 70% 55%)`; };

export default function App(){
  const envKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
  const [apiKey,setApiKey]=useState(localStorage.getItem("gmaps_api_key")||envKey);
  useEffect(()=>localStorage.setItem("gmaps_api_key", apiKey||""),[apiKey]);
  const { isLoaded } = useJsApiLoader({ id:"gmaps-script", googleMapsApiKey: apiKey||"", libraries:["places"] });

  const [rows,setRows]=useState([]); const [fileName,setFileName]=useState("");
  const [drivers,setDrivers]=useState([]); const [selDrivers,setSelDrivers]=useState([]);
  const [dateFrom,setDateFrom]=useState(""); const [dateTo,setDateTo]=useState(""); const [basis,setBasis]=useState("pickup");
  const [routeStyle,setRouteStyle]=useState("lines"); const [showTraffic,setShowTraffic]=useState(false);

  const legs = useMemo(()=>{
    const dset=new Set(); rows.forEach(r=>{const d=(r[COLS.driver]??"" ).toString().trim(); if(d) dset.add(d)});
    const list=Array.from(dset).sort(); setDrivers(list); if(!selDrivers.length && list.length) setSelDrivers([list[0]]);
    const from=dateFrom? new Date(dateFrom+"T00:00:00"):null; const to=dateTo? new Date(dateTo+"T23:59:59"):null;
    const addr=(p,r)=>{ const name=r[p==="ship"?COLS.shipperName:COLS.receiverName]||""; const a=r[p==="ship"?COLS.shipperAddr:COLS.receiverAddr]||""; const c=r[p==="ship"?COLS.shipperCity:COLS.receiverCity]||""; const s=r[p==="ship"?COLS.shipperState:COLS.receiverState]||""; return [name,a,c,s].filter(Boolean).join(", "); };
    return rows
      .filter(r=> selDrivers.includes((r[COLS.driver]??"" ).toString().trim()))
      .filter(r=> !isCanceled(r[COLS.loadStatus]))
      .filter(r=> { const d=basis==="pickup"? excelToDate(r[COLS.shipDate]) : excelToDate(r[COLS.delDate]); if(!from&&!to) return true; if(!d) return false; if(from&&d<from) return false; if(to&&d>to) return false; return true; })
      .map(r=>({ driver:(r[COLS.driver]??"" ).toString().trim(), loadNo:r[COLS.loadNo],
        shipDate: excelToDate(r[COLS.shipDate]), delDate: excelToDate(r[COLS.delDate]),
        origin: addr("ship",r), destination: addr("recv",r),
        miles: Number(r[COLS.miles]||0), fee: Number(r[COLS.fee]||0),
        onTime: !(isLate(r[COLS.shipperArrival]) || isLate(r[COLS.receiverArrival])),
      }))
      .filter(x=>x.origin && x.destination)
      .sort((a,b)=> (a.shipDate?.getTime?.()??0) - (b.shipDate?.getTime?.()??0));
  },[rows,selDrivers,dateFrom,dateTo,basis]);

  const kpi = useMemo(()=>{
    const loads=legs.length; const miles=Math.round(legs.reduce((a,b)=>a+(b.miles||0),0)); const revenue=legs.reduce((a,b)=>a+(b.fee||0),0);
    const timed=legs.filter(l=>l.onTime!==null); const ontime=timed.length? Math.round(100*timed.filter(l=>l.onTime).length/timed.length):0;
    const fleetRPM=miles>0? (revenue/miles).toFixed(2):"0.00"; return {loads,miles,revenue,ontime,fleetRPM};
  },[legs]);

  const [routes,setRoutes]=useState([]); const [endpoints,setEndpoints]=useState([]);
  useEffect(()=>{
    if(!isLoaded || !legs.length){ setRoutes([]); setEndpoints([]); return; }
    let cancelled=false; const svc=new google.maps.DirectionsService();
    (async()=>{
      const R=[], E=[];
      for(let i=0;i<legs.length;i++){
        try{
          const res=await svc.route({origin:legs[i].origin, destination:legs[i].destination, travelMode:google.maps.TravelMode.DRIVING});
          if(cancelled) break; R.push(res);
          const lg=res.routes[0]?.legs[0]; if(lg){ E.push({ start: lg.start_location, end: lg.end_location, color: colorByDriver(legs[i].driver) }); }
          await new Promise(r=>setTimeout(r,150));
        }catch(e){ console.warn("Directions error",e); }
      }
      if(!cancelled){ setRoutes(R); setEndpoints(E); }
    })();
    return ()=>{ cancelled=true; };
  },[isLoaded, JSON.stringify(legs)]);

  const mapRef=useRef(null);
  useEffect(()=>{
    if(!isLoaded || !mapRef.current) return;
    const m=mapRef.current; const b=new google.maps.LatLngBounds(); let had=false;
    if(routeStyle==="driving"){ routes.forEach(r=> r.routes[0]?.overview_path?.forEach(p=>{ b.extend(p); had=true; })); }
    else { endpoints.forEach(ep=>{ b.extend(ep.start); b.extend(ep.end); had=true; }); }
    if(had) m.fitBounds(b,64);
  },[isLoaded, routes.length, endpoints.length, routeStyle]);

  async function handleFile(e){ const f=e.target.files?.[0]; if(!f) return; setFileName(f.name);
    const buf=await f.arrayBuffer(); const wb=XLSX.read(buf,{type:"array"}); const ws=wb.Sheets[wb.SheetNames[0]]; const json=XLSX.utils.sheet_to_json(ws,{defval:""}); setRows(json); }

  return (
    <div style={{ padding: 16 }}>
      <div className="header">
        <h1>Driver Routing Dashboard</h1>
        <div className="right"><button className="btn btn-accent" onClick={()=>window.location.reload()}>Refresh</button></div>
      </div>

      <div className="topbar">
        <div className="card" style={{padding:8}}><div style={{fontSize:12,color:"var(--muted)"}}>Date from</div><input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} /></div>
        <div className="card" style={{padding:8}}><div style={{fontSize:12,color:"var(--muted)"}}>Date to</div><input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} /></div>
        <div className="card" style={{padding:8}}><div style={{fontSize:12,color:"var(--muted)"}}>Date basis</div><select value={basis} onChange={e=>setBasis(e.target.value)}><option value="pickup">Pickup (Ship Date)</option><option value="delivery">Delivery (Del. Date)</option></select></div>
        <div className="card" style={{padding:8}}><div style={{fontSize:12,color:"var(--muted)"}}>Route style</div><select value={routeStyle} onChange={e=>setRouteStyle(e.target.value)}><option value="lines">Straight Lines</option><option value="driving">Driving Directions</option></select></div>
        <div className="card" style={{padding:8}}><div style={{fontSize:12,color:"var(--muted)"}}>Traffic</div><button className="btn" onClick={()=>setShowTraffic(v=>!v)}>{showTraffic?"On":"Off"}</button></div>
      </div>

      <hr className="sep"/>

      <div className="grid">
        <div className="col">
          <div className="card" style={{ padding: 12 }}>
            <div className="row">
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Google Maps API Key</div>
                <input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="Paste your key" />
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Data</div>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
                {fileName && <div style={{ fontSize: 11, color: "var(--muted)" }}>Loaded: {fileName}</div>}
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div className="row">
              <div className="kpi card" style={{ flex: 1 }}><div className="label">Loads</div><div className="value">{kpi.loads}</div></div>
              <div className="kpi card" style={{ flex: 1 }}><div className="label">Miles</div><div className="value">{num(kpi.miles)}</div></div>
              <div className="kpi card" style={{ flex: 1 }}><div className="label">Revenue</div><div className="value">{money(kpi.revenue)}</div></div>
              <div className="kpi card" style={{ flex: 1 }}><div className="label">Fleet RPM</div><div className="value">{kpi.fleetRPM}</div></div>
              <div className="kpi card" style={{ flex: 1 }}><div className="label">On‑Time %</div><div className="value">{kpi.ontime}%</div></div>
            </div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Drivers</div>
            <select multiple size={Math.min(8, Math.max(4, drivers.length))} value={selDrivers} onChange={e=>setSelDrivers([...e.target.selectedOptions].map(o=>o.value))} style={{ width: "100%" }}>
              {drivers.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Loads</div>
            <div className="list">
              {legs.map((l,i)=>{
                const c=colorByDriver(l.driver);
                return (
                  <div key={i} className="card load-card" style={{ borderColor: c }}>
                    <div className="row" style={{ justifyContent:"space-between" }}>
                      <div className="row">
                        <span className="badge" style={{ background: c }}>{i+1}</span>
                        <div className="col">
                          <div className="load-title">{l.driver} • Load {l.loadNo ?? ""}</div>
                          <div className="load-sub">{l.shipDate ? l.shipDate.toLocaleDateString() : ""} — {l.origin} → {l.destination}</div>
                        </div>
                      </div>
                      <div className="chips">
                        <span className="chip">Rev {money(l.fee)}</span>
                        <span className="chip">Mi {num(l.miles)}</span>
                        <span className="chip">RPM {rpm(l.fee,l.miles)}</span>
                        <span className="chip">On‑Time {l.onTime?"Yes":"No"}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {legs.length===0 && <div style={{ color: "var(--muted)" }}>No loads match the filters.</div>}
            </div>
          </div>
        </div>

        <div className="card map-shell">
          {apiKey ? isLoaded ? (
            <GoogleMap onLoad={m=>mapRef.current=m} mapContainerStyle={{width:"100%",height:"100%"}} center={{lat:36.5,lng:-96.5}} zoom={5} options={{ streetViewControl:false, mapTypeControl:true, fullscreenControl:true }}>
              {showTraffic && <TrafficLayer autoUpdate />}
              {routeStyle==="driving" && routes.map((r,idx)=>(
                <DirectionsRenderer key={idx} directions={r} options={{ preserveViewport:true, polylineOptions:{ strokeColor: colorByDriver(legs[idx]?.driver||String(idx)), strokeWeight:4, strokeOpacity:.95 } }} />
              ))}
              {routeStyle==="lines" && endpoints.map((ep,idx)=>(
                <React.Fragment key={idx}>
                  <Marker position={ep.start} icon={{ path: google.maps.SymbolPath.CIRCLE, scale: 5, fillColor: "#22c55e", fillOpacity: 1, strokeColor: "#000", strokeWeight: 1 }} />
                  <Marker position={ep.end} icon={{ path: google.maps.SymbolPath.CIRCLE, scale: 5, fillColor: "#ef4444", fillOpacity: 1, strokeColor: "#000", strokeWeight: 1 }} />
                  <Polyline path={[ep.start, ep.end]} options={{ strokeColor: ep.color, strokeOpacity: .9, strokeWeight: 3 }} />
                </React.Fragment>
              ))}
            </GoogleMap>
          ) : <div style={{display:"grid",placeItems:"center",height:"100%",color:"var(--muted)"}}>Loading Google Maps…</div>
            : <div style={{display:"grid",placeItems:"center",height:"100%",color:"var(--muted)"}}>Paste your API key to load the map</div>}
          <div className="legend">Route style: {routeStyle==="lines"?"Straight lines (pickup→delivery)":"Driving directions"} • Traffic: {showTraffic?"On":"Off"}</div>
        </div>
      </div>
    </div>
  );
}
