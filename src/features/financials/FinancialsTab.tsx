import { useState } from 'react';
import { useFinance } from '@/selectors/useFinance';

export default function FinancialsTab(){
  const [tg, setTg] = useState<'day'|'week'|'month'>('day');
  const { rows, fleet } = useFinance(tg);

  const fmt$ = (n:number|null|undefined)=> n==null? '—' : Intl.NumberFormat(undefined,{style:'currency',currency:'USD'}).format(n);
  const fmt2 = (n:number|null|undefined)=> n==null? '—' : n.toFixed(2);

  const totalMiles = fleet.miles_total || 0;

  return (
    <div className="p-4 space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-2">
        <label className="opacity-80 text-sm">Timegrain</label>
        <select value={tg} onChange={e=>setTg(e.target.value as any)}>
          <option value="day">Day</option>
          <option value="week">Week (Sun–Sat)</option>
          <option value="month">Month</option>
        </select>
        <div className="ml-auto text-sm opacity-80">Miles: {Math.round(totalMiles)}</div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPI title="Revenue" value={fmt$(fleet.revenue)} />
        <KPI title="Fuel $" value={fmt$(fleet.fuel_cost)} />
        <KPI title="Other $" value={fmt$(fleet.expenses)} />
        <KPI title="Gross Profit" value={fmt$(fleet.gross_profit)} />
        <KPI title="Operating Ratio" value={fleet.operating_ratio==null?'—': `${fmt2(fleet.operating_ratio)}%`} />
        <KPI title="RPM" value={fmt2(fleet.rpm)} />
      </div>

      {/* Table */}
      <div className="overflow-auto">
        <table className="w-full text-left">
          <thead>
            <tr>
              <th className="py-2">Date</th>
              <th>Truck</th>
              <th>Revenue</th>
              <th>Fuel $</th>
              <th>Other $</th>
              <th>Gross Profit</th>
              <th>OR %</th>
              <th>RPM</th>
              <th>Fuel $/mi</th>
              <th>Miles</th>
              <th>Loads</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i)=>(
              <tr key={i}>
                <td>{new Date(r.keyDate).toLocaleDateString()}</td>
                <td>{r.truck || '—'}</td>
                <td>{fmt$(r.revenue)}</td>
                <td>{fmt$(r.fuel_cost)}</td>
                <td>{fmt$(r.expenses)}</td>
                <td>{fmt$(r.gross_profit)}</td>
                <td>{r.operating_ratio==null?'—': `${fmt2(r.operating_ratio)}%`}</td>
                <td>{fmt2(r.rpm)}</td>
                <td>{fmt2(r.fuel_cpm)}</td>
                <td>{Math.round(r.miles_total)}</td>
                <td>{r.loads}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KPI({title, value}:{title:string; value:string}){
  return (
    <div className="rounded-2xl p-3 shadow-sm bg-black/40 text-white">
      <div className="text-xs opacity-70">{title}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
