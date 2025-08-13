export type Basis = 'pickup' | 'delivery';
type Raw = Record<string, any>;

const normStr = (v:any)=> (v==null?'':String(v).trim());
const normNum = (v:any)=>{ if(v==null||v==='')return 0; const n=Number(String(v).replace(/\$|,/g,'')); return Number.isFinite(n)?n:0; };
// Accept Excel serial numbers, numeric strings, or regular date strings.
const toDate = (v:any)=>{
  if(v==null || v==='') return null;
  if(typeof v === 'number'){
    const base = Date.UTC(1899,11,30); // Excel epoch
    return new Date(base + v*86400000);
  }
  if(typeof v === 'string'){
    const trimmed = v.trim();
    if(trimmed === '') return null;
    if(/^\d+(\.\d+)?$/.test(trimmed)) return toDate(Number(trimmed));
    const onlyDate = trimmed.split(' ')[0];
    const d = new Date(`${onlyDate}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};
const sod = (d:Date)=> new Date(d.getFullYear(), d.getMonth(), d.getDate());
const weekStart = (d:Date)=>{ const out=new Date(d); out.setDate(d.getDate()-d.getDay()); out.setHours(0,0,0,0); return out; };
const monthStart = (d:Date)=> new Date(d.getFullYear(), d.getMonth(), 1);

export type LoadRow = {
  truck:string; driver:string; pickup_date:Date|null; delivery_date:Date|null;
  miles_loaded:number; miles_empty:number; revenue:number;
  shipper?:string; receiver?:string; receiver_arrival_time?:Date|null; receiver_arrival_status?:string;
};

export function normalizeLoads(rows:Raw[]):LoadRow[] {
  return rows.map(r=>{
    const del = toDate(r['Del. Date']) ?? toDate(r['Last Del. Date']);
    return {
      truck: normStr(r['Truck']),
      driver: normStr(r['Drivers'] ?? r['Driver']),
      pickup_date: toDate(r['Ship Date']),
      delivery_date: del,
      miles_loaded: normNum(r['Miles']),
      miles_empty: normNum(r['Empty Miles']),
      revenue: normNum(r['Load Amount']),
      shipper: normStr(r['Shipper']),
      receiver: normStr(r['Receiver']),
      receiver_arrival_time: toDate(r['Receiver Arrival Time']),
      receiver_arrival_status: normStr(r['Receiver Arrival Status']),
    };
  }).filter(l=>l.truck!=='');
}

export type FuelRow = { date:Date|null; truck:string; driver:string; item:string; gallons:number; amount:number; };

export function normalizeFuel(rows:Raw[]):FuelRow[] {
  return rows.map(r=>{
    const item = normStr(r['Item']).toUpperCase();
    return {
      date: toDate(r['Tran Date']),
      truck: normStr(r['Unit']),
      driver: normStr(r['Driver Name']),
      item,
      gallons: normNum(r['Qty']),
      amount: normNum(r['Amt']),
    };
  })
  // EXCLUDE ONLY CASH ADVANCE (keep DEF and everything else)
  .filter(fr => !/CADV|CASH\s*ADV/i.test(fr.item));
}

export type ExpenseRow = { date:Date|null; amount:number; category:string; vendor:string; driver:string; truck:string; notes?:string; };

export function normalizeExpenses(rows:Raw[]):ExpenseRow[] {
  return rows.map(r=>({
    date: toDate(r['Date']),
    amount: normNum(r['Amount']),
    category: normStr(r['Category']),
    vendor: normStr(r['Vendor']),
    driver: normStr(r['Driver']),
    truck: normStr(r['Truck']),
    notes: normStr(r['Notes']),
  }));
}

export type Timegrain = 'day'|'week'|'month';
export type FinanceFilters = { basis:Basis; rangeStart?:Date|null; rangeEnd?:Date|null; trucks?:string[]; drivers?:string[]; };

export type FinanceRow = {
  keyDate:Date; timegrain:Timegrain; truck:string; driver?:string;
  revenue:number; miles_loaded:number; miles_empty:number; miles_total:number; loads:number;
  fuel_gallons:number; fuel_cost:number; expenses:number;
  rpm:number|null; fuel_cpm:number|null; gross_profit:number; operating_ratio:number|null;
};

function inRange(d:Date|null, s?:Date|null, e?:Date|null){
  if(!d) return false; const t=sod(d).getTime(), S=s?sod(s).getTime():-Infinity, E=e?sod(e).getTime():Infinity; return t>=S && t<=E;
}
function keyDate(d:Date,g:Timegrain){ return g==='day'?sod(d):g==='week'?weekStart(d):monthStart(d); }

export function buildFinance(loads:LoadRow[], fuel:FuelRow[], exp:ExpenseRow[], f:FinanceFilters, g:Timegrain='day'){
  const { basis, rangeStart, rangeEnd, trucks=[], drivers=[] } = f;
  const map = new Map<string, FinanceRow>();
  const add = (r:FinanceRow)=>{ const k = `${r.keyDate.getTime()}|${r.truck}`; const cur = map.get(k); if(cur){ 
      cur.revenue+=r.revenue; cur.miles_loaded+=r.miles_loaded; cur.miles_empty+=r.miles_empty; cur.miles_total+=r.miles_total; cur.loads+=r.loads;
      cur.fuel_gallons+=r.fuel_gallons; cur.fuel_cost+=r.fuel_cost; cur.expenses+=r.expenses;
    } else { map.set(k,{...r}); } };

  // Loads
  for(const L of loads){
    const d = basis==='pickup'?L.pickup_date:L.delivery_date; if(!d) continue;
    if(!inRange(d,rangeStart,rangeEnd)) continue;
    if(trucks.length && !trucks.includes(L.truck)) continue;
    if(drivers.length && L.driver && !drivers.includes(L.driver)) continue;
    const kd = keyDate(d,g);
    add({ keyDate:kd, timegrain:g, truck:L.truck, driver:L.driver||'',
      revenue:L.revenue, miles_loaded:L.miles_loaded, miles_empty:L.miles_empty, miles_total:L.miles_loaded+L.miles_empty, loads:1,
      fuel_gallons:0, fuel_cost:0, expenses:0, rpm:null, fuel_cpm:null, gross_profit:0, operating_ratio:null });
  }

  // Fuel
  for(const F of fuel){
    if(!F.date) continue; if(!inRange(F.date,rangeStart,rangeEnd)) continue;
    if(trucks.length && !trucks.includes(F.truck)) continue;
    if(drivers.length && F.driver && !drivers.includes(F.driver)) continue;
    const kd = keyDate(F.date,g);
    add({ keyDate:kd, timegrain:g, truck:F.truck, driver:F.driver||'',
      revenue:0, miles_loaded:0, miles_empty:0, miles_total:0, loads:0,
      fuel_gallons:F.gallons, fuel_cost:F.amount, expenses:0, rpm:null, fuel_cpm:null, gross_profit:0, operating_ratio:null });
  }

  // Expenses
  for(const E of exp){
    if(!E.date) continue; if(!inRange(E.date,rangeStart,rangeEnd)) continue;
    if(trucks.length && !trucks.includes(E.truck)) continue;
    if(drivers.length && E.driver && !drivers.includes(E.driver)) continue;
    const kd = keyDate(E.date,g);
    add({ keyDate:kd, timegrain:g, truck:E.truck||'', driver:E.driver||'',
      revenue:0, miles_loaded:0, miles_empty:0, miles_total:0, loads:0,
      fuel_gallons:0, fuel_cost:0, expenses:E.amount, rpm:null, fuel_cpm:null, gross_profit:0, operating_ratio:null });
  }

  const byTruck = Array.from(map.values()).map(r=>{
    const rpm = r.miles_total>0 ? r.revenue/r.miles_total : null;
    const fuel_cpm = r.miles_total>0 ? r.fuel_cost/r.miles_total : null;
    const gross_profit = r.revenue - r.fuel_cost - r.expenses;
    const operating_ratio = r.revenue>0 ? ((r.fuel_cost+r.expenses)/r.revenue)*100 : null;
    return { ...r, rpm, fuel_cpm, gross_profit, operating_ratio };
  }).sort((a,b)=> a.keyDate.getTime()-b.keyDate.getTime() || a.truck.localeCompare(b.truck));

  // Fleet totals over filtered window
  const fleet = byTruck.reduce((acc,r,i)=>{ if(i===0) acc.keyDate=r.keyDate;
    acc.revenue+=r.revenue; acc.miles_loaded+=r.miles_loaded; acc.miles_empty+=r.miles_empty; acc.miles_total+=r.miles_total; acc.loads+=r.loads;
    acc.fuel_gallons+=r.fuel_gallons; acc.fuel_cost+=r.fuel_cost; acc.expenses+=r.expenses; return acc;
  }, { keyDate: (f.rangeStart? sod(f.rangeStart): new Date()), timegrain:g, truck:'FLEET', driver:'',
       revenue:0,miles_loaded:0,miles_empty:0,miles_total:0,loads:0,fuel_gallons:0,fuel_cost:0,expenses:0,rpm:null,fuel_cpm:null,gross_profit:0,operating_ratio:null } as FinanceRow);
  fleet.rpm = fleet.miles_total>0 ? fleet.revenue/fleet.miles_total : null;
  fleet.fuel_cpm = fleet.miles_total>0 ? fleet.fuel_cost/fleet.miles_total : null;
  fleet.gross_profit = fleet.revenue - fleet.fuel_cost - fleet.expenses;
  fleet.operating_ratio = fleet.revenue>0 ? ((fleet.fuel_cost+fleet.expenses)/fleet.revenue)*100 : null;

  return { byTruck, fleetTotals: fleet };
}
