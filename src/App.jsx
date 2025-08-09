
import React, { useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, useJsApiLoader, DirectionsRenderer, TrafficLayer } from "@react-google-maps/api";
import * as XLSX from "xlsx";
import "./styles/index.css";

/** Column mapping */
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
  shipperArrival: "Shipper Arrival Status",
  receiverArrival: "Receiver Arrival Status",
};

function excelToDate(v){ if(v===null||v===undefined||v==="") return null; if(typeof v==="number"){const e=new Date(1899,11,30); return new Date(e.getTime()+v*86400000);} const d=new Date(v); return isNaN(+d)?null:d; }
const isCanceled = s => s && /cancel+ed|cancelled|canceled/i.test(String(s));
const isLate = s => s && /late/i.test(String(s));
const money = n => isFinite(n)? n.toLocaleString(undefined,{style:"currency",currency:"USD",maximumFractionDigits:0}) : "$0";
const num = n => isFinite(n)? n.toLocaleString() : "0";
const rpm = (rev, mi) => (mi>0 && isFinite(rev/mi) ? (rev/mi).toFixed(2) : "0.00");
const colorByDriver = key => { let h=2166136261; for(let i=0;i<key.length;i++){h^=key.charCodeAt(i); h+=(h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24);} const hue=Math.abs(h)%360; return `hsl(${hue} 70% 50%)`; };

export default function App(){
  const envKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
  const [apiKey,setApiKey] = useState(localStorage.getItem("gmaps_api_key")||envKey);
  const [theme,setTheme] = useState(localStorage.getItem("ui_theme")||"dark");
  const [accent,setAccent] = useState(localStorage.getItem("ui_accent")||"#D2F000");
  useEffect(()=>{document.documentElement.classList.toggle("dark", theme==="dark");},[theme]);
  useEffect(()=>localStorage.setItem("gmaps_api_key", apiKey||""),[apiKey]);
  useEffect(()=>localStorage.setItem("ui_theme", theme),[theme]);
  useEffect(()=>localStorage.setItem("ui_accent", accent),[accent]);

  const { isLoaded } = useJsApiLoader({ id:"gmaps", googleMapsApiKey: apiKey||"", libraries:["places"] });

  const [rows,setRows] = useState([]);
  const [fileName,setFileName] = useState("");

  const drivers = useMemo(()=>{
    const s=new Set(); rows.forEach(r=>{const d=(r[COLS.driver]??"").toString().trim(); if(d) s.add(d)}); return Array.from(s).sort();
  },[rows]);
  const [selectedDrivers,setSelectedDrivers] = useState([]);

  const [basis,setBasis] = useState("pickup"); // pickup | delivery
  const [dateFrom,setDateFrom] = useState("");
  const [dateTo,setDateTo] = useState("");

  const [showTraffic,setShowTraffic] = useState(false);
  const [playing,setPlaying] = useState(false);
  const [playIdx,setPlayIdx] = useState(-1);
  const [speed,setSpeed] = useState("normal");

  const legs = useMemo(()=>{
    const from = dateFrom ? new Date(dateFrom+"T00:00:00") : null;
    const to   = dateTo   ? new Date(dateTo+"T23:59:59")   : null;
    const within = (r)=>{
      const d = basis==="pickup" ? excelToDate(r[COLS.shipDate]) : excelToDate(r[COLS.delDate]);
      if(!from && !to) return true;
      if(!d) return false;
      if(from && d<from) return false;
      if(to && d>to) return false;
      return true;
    };
    return rows
      .filter(r=> selectedDrivers.includes((r[COLS.driver]??"").toString().trim()))
      .filter(r=> !isCanceled(r[COLS.loadStatus]))
      .filter(within)
      .map(r=>{
        const ship = excelToDate(r[COLS.shipDate]);
        const del = excelToDate(r[COLS.delDate]);
        const miles = Number(String(r[COLS.miles]).replace(/[^0-9.-]/g,""))||0;
        const amount = Number(String(r[COLS.amount]).replace(/[^0-9.-]/g,""))||0;
        const onTime = !(isLate(r[COLS.shipperArrival]) || isLate(r[COLS.receiverArrival]));
        const mk = (p)=>[ r[p==="s" ? COLS.shipperName : COLS.receiverName]||"", r[p==="s" ? COLS.shipperAddr : COLS.receiverAddr]||"", r[p==="s" ? COLS.shipperCity : COLS.receiverCity]||"", r[p==="s" ? COLS.shipperState : COLS.receiverState]||"" ].filter(Boolean).join(", ");
        return { driver:(r[COLS.driver]??"").toString().trim(), loadNo:r[COLS.loadNo], shipDate:ship, delDate:del, origin:mk("s"), destination:mk("r"), miles, amount, onTime };
      })
      .filter(x=>x.origin && x.destination)
      .sort((a,b)=> (a.shipDate?.getTime?.()??0)-(b.shipDate?.getTime?.()??0));
  },[rows,selectedDrivers,basis,dateFrom,dateTo]);

  const kpi = useMemo(()=>{
    const loads = legs.length;
    const miles = Math.round(legs.reduce((a,b)=>a+(b.miles||0),0));
    const revenue = legs.reduce((a,b)=>a+(b.amount||0),0);
    const timed = legs.filter(l=>l.onTime!==null);
    const ontimePct = timed.length? Math.round(100*timed.filter(l=>l.onTime).length/timed.length) : 0;
    const fleetRPM = miles>0? (revenue/miles).toFixed(2) : "0.00";
    return { loads, miles, revenue, ontimePct, fleetRPM };
  },[legs]);

  const [routes,setRoutes] = useState([]);
  useEffect(()=>{
    if(!isLoaded || !legs.length){ setRoutes([]); return; }
    let cancelled=false;
    const svc = new google.maps.DirectionsService();
    (async()=>{
      const out=[];
      for(let i=0;i<legs.length;i++){
        try{
          const res = await svc.route({ origin:legs[i].origin, destination:legs[i].destination, travelMode:google.maps.TravelMode.DRIVING });
          if(!cancelled) out.push(res);
          await new Promise(r=>setTimeout(r,200));
        }catch(e){ console.warn(e); }
      }
      if(!cancelled) setRoutes(out);
    })();
    return ()=>{cancelled=true};
  },[isLoaded, JSON.stringify(legs)]);

  useEffect(()=>{
    if(!playing){ setPlayIdx(-1); return; }
    if(!routes.length) return;
    let i=0; setPlayIdx(0);
    const delay = speed==="slow"?2000 : speed==="fast"?500 : 1000;
    const t=setInterval(()=>{ i++; if(i>=routes.length){ clearInterval(t); setPlaying(false); setPlayIdx(-1);} else setPlayIdx(i); }, delay);
    return ()=>clearInterval(t);
  },[playing,routes.length,speed]);

  const mapRef = useRef(null);
  useEffect(()=>{
    if(!isLoaded || !mapRef.current) return;
    const b=new google.maps.LatLngBounds(); let had=false;
    routes.forEach(r=> r.routes[0]?.overview_path?.forEach(p=>{b.extend(p); had=true;}));
    if(had) mapRef.current.fitBounds(b,48);
  },[isLoaded,routes.length]);

  async function onFile(e){
    const f=e.target.files?.[0]; if(!f) return;
    setFileName(f.name);
    const wb=XLSX.read(await f.arrayBuffer(),{type:"array"});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const json=XLSX.utils.sheet_to_json(ws,{defval:""});
    setRows(json);
    setSelectedDrivers([]);
  }

  const dark = theme==="dark";

  return (
    <div className={`min-h-screen ${dark?"bg-[#0f1115] text-zinc-100":"bg-gray-50"}`}>
      <style>{`:root{--accent:${accent}}`}</style>
      <div className="max-w-[1400px] mx-auto p-4 md:p-6 space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl md:text-3xl font-bold">Hitched Logistics • Driver Routing Dashboard</h1>
          <div className="flex gap-2">
            <button className="btn btn-outline" onClick={()=>setTheme(dark?"light":"dark")}>{dark?"Light":"Dark"} mode</button>
          </div>
        </header>

        <div className="grid grid-cols-12 gap-4">
          {/* Narrow left panel */}
          <aside className={`col-span-12 md:col-span-3 card rounded-2xl border p-4 space-y-4`}>
            <div>
              <div className="text-xs opacity-80 mb-1">Google Maps API Key</div>
              <input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} className="w-full rounded-md px-3 py-2 border" />
            </div>
            <div>
              <div className="text-xs opacity-80 mb-1">Upload Excel/CSV</div>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="text-sm" />
              {fileName && <div className="text-xs opacity-70 mt-1">Loaded: {fileName}</div>}
            </div>
            <div>
              <div className="text-xs opacity-80 mb-1">Drivers</div>
              <select multiple size={8} value={selectedDrivers} onChange={e=>setSelectedDrivers([...e.target.selectedOptions].map(o=>o.value))} className="w-full rounded-md px-3 py-2 border bg-transparent" >
                {drivers.map(d=><option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs opacity-80 mb-1">Date from</div>
                <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} className="w-full rounded-md px-3 py-2 border bg-transparent" />
              </div>
              <div>
                <div className="text-xs opacity-80 mb-1">Date to</div>
                <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} className="w-full rounded-md px-3 py-2 border bg-transparent" />
              </div>
            </div>
            <div>
              <div className="text-xs opacity-80 mb-1">Date filter basis</div>
              <select value={basis} onChange={e=>setBasis(e.target.value)} className="w-full rounded-md px-3 py-2 border bg-transparent">
                <option value="pickup">Pickup (Ship Date)</option>
                <option value="delivery">Delivery (Del. Date)</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-xs opacity-80 mb-1">Playback speed</div>
                <select value={speed} onChange={e=>setSpeed(e.target.value)} className="w-full rounded-md px-3 py-2 border bg-transparent">
                  <option value="slow">Slow</option>
                  <option value="normal">Normal</option>
                  <option value="fast">Fast</option>
                </select>
              </div>
              <div className="flex items-end">
                <button className="btn btn-accent w-full" onClick={()=>setPlaying(true)} disabled={!routes.length||playing}>Playback</button>
              </div>
            </div>
            <div className="text-xs opacity-70">Legs: {legs.length}. Revenue uses <b>Hauling Fee</b>. Canceled loads excluded.</div>
          </aside>

          {/* Map + KPI + Timeline */}
          <main className="col-span-12 md:col-span-9 space-y-4">
            <section className="card rounded-2xl border overflow-hidden">
              <div className="h-[70vh] w-full">
                {apiKey ? (isLoaded ? (
                  <GoogleMap onLoad={m=>mapRef.current=m} mapContainerStyle={{width:"100%",height:"100%"}} center={{lat:36.5,lng:-96.5}} zoom={5} options={{streetViewControl:false,mapTypeControl:true,fullscreenControl:true}}>
                    {showTraffic && <TrafficLayer autoUpdate />}
                    {routes.map((r,idx)=>{
                      const color=colorByDriver(legs[idx]?.driver||String(idx));
                      const visible=playIdx===-1 || idx<=playIdx;
                      return <DirectionsRenderer key={idx} directions={r} options={{preserveViewport:true, polylineOptions:{strokeOpacity:visible?0.95:0, strokeWeight:4, strokeColor:color}}}/>;
                    })}
                  </GoogleMap>
                ) : (<div className="h-full w-full flex items-center justify-center text-sm opacity-70">Loading Google Maps…</div>)
                ) : (<div className="h-full w-full flex items-center justify-center text-sm opacity-70">Enter your API key to initialize the map</div>)}
              </div>
            </section>

            <section className="card rounded-2xl border p-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                <div className="p-3 rounded border"><div className="opacity-70">Loads</div><div className="text-xl font-bold">{kpi.loads}</div></div>
                <div className="p-3 rounded border"><div className="opacity-70">Miles</div><div className="text-xl font-bold">{num(kpi.miles)}</div></div>
                <div className="p-3 rounded border"><div className="opacity-70">Revenue</div><div className="text-xl font-bold">{money(kpi.revenue)}</div></div>
                <div className="p-3 rounded border"><div className="opacity-70">Fleet RPM</div><div className="text-xl font-bold">{kpi.fleetRPM}</div></div>
                <div className="p-3 rounded border"><div className="opacity-70">On‑Time %</div><div className="text-xl font-bold">{kpi.ontimePct}%</div></div>
              </div>
            </section>

            <section className="card rounded-2xl border p-4">
              <h2 className="font-semibold mb-2">Timeline (ordered by Ship Date)</h2>
              {legs.length===0? <div className="text-sm opacity-70">No legs match filters.</div> : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {legs.map((l,i)=>{
                    const color=colorByDriver(l.driver);
                    return (
                      <div key={i} className="rounded-xl border p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div style={{background:color}} className="w-7 h-7 rounded-full text-black font-bold flex items-center justify-center">{i+1}</div>
                            <div className="text-sm opacity-80">{l.shipDate? l.shipDate.toLocaleDateString() : ""}</div>
                          </div>
                          <div className="chip">Load {l.loadNo||""}</div>
                        </div>
                        <div className="mt-1 text-sm">
                          <div className="font-semibold">{l.driver}</div>
                          <div className="opacity-80">{l.origin} → {l.destination}</div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <div className="chip">Revenue: {money(l.amount)}</div>
                          <div className="chip">Miles: {num(l.miles)}</div>
                          <div className="chip">RPM: {rpm(l.amount,l.miles)}</div>
                          <div className="chip">On‑Time: {l.onTime? "Yes":"No"}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}
