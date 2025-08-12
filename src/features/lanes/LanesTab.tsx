import { useMemo, useState } from 'react';
import { useLaneView } from '@/selectors/useLaneView';
import type { LaneRow } from '@/utils/lanes';

export default function LanesTab() {
  const { rows, fleet_revenue } = useLaneView();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'total_revenue'|'avg_rpm'|'lane'>('total_revenue');
  const [dir, setDir] = useState<'asc'|'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const filtered = useMemo(() => {
    let v = rows;
    if (q) v = v.filter(r => r.lane.toUpperCase().includes(q.trim().toUpperCase()));
    v = [...v].sort((a, b) => {
      const av = (sort === 'lane') ? a.lane : (sort === 'avg_rpm' ? a.avg_rpm : a.total_revenue);
      const bv = (sort === 'lane') ? b.lane : (sort === 'avg_rpm' ? b.avg_rpm : b.total_revenue);
      return dir === 'asc' ? ((av > bv) ? 1 : -1) : ((av < bv) ? 1 : -1);
    });
    return v;
  }, [rows, q, sort, dir]);

  const totalRows = filtered.length;
  const startIdx = (page - 1) * pageSize;
  const pageRows = filtered.slice(startIdx, startIdx + pageSize);

  const fmtUSD = (n:number)=>Intl.NumberFormat(undefined,{style:'currency',currency:'USD'}).format(n);

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <input className="input" placeholder="Search lane…" value={q}
          onChange={e => { setPage(1); setQ(e.target.value); }} />
        <select value={sort} onChange={e => setSort(e.target.value as any)}>
          <option value="total_revenue">Total Revenue</option>
          <option value="avg_rpm">Avg RPM</option>
          <option value="lane">Lane</option>
        </select>
        <select value={dir} onChange={e => setDir(e.target.value as any)}>
          <option value="desc">Desc</option>
          <option value="asc">Asc</option>
        </select>
        <div className="ml-auto text-sm opacity-80">
          Fleet Revenue: {fmtUSD(fleet_revenue || 0)}
        </div>
      </div>

      <table className="w-full text-left">
        <thead>
          <tr>
            <th>Lane</th><th>Loads</th><th>Total Revenue</th>
            <th>Avg Rev/Load</th><th>Avg Total Miles/Load</th>
            <th>Avg RPM</th><th>% of Fleet Rev</th><th>Cum %</th><th>Last Moved</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((r: LaneRow) => (
            <tr key={r.lane}>
              <td>{r.lane}</td>
              <td>{r.loads}</td>
              <td>{fmtUSD(r.total_revenue)}</td>
              <td>{fmtUSD(r.avg_revenue_per_load)}</td>
              <td>{Math.round(r.avg_total_miles_per_load)}</td>
              <td>{r.avg_rpm.toFixed(2)}</td>
              <td>{r.pct_of_fleet_revenue.toFixed(1)}%</td>
              <td>{r.cum_pct_of_fleet_revenue.toFixed(1)}%</td>
              <td>{new Date(r.last_moved).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-center gap-2">
        <button disabled={page===1} onClick={()=>setPage(p=>p-1)}>Prev</button>
        <span>{page}</span>
        <button disabled={startIdx + pageSize >= totalRows} onClick={()=>setPage(p=>p+1)}>Next</button>
        <select value={pageSize} onChange={e => { setPage(1); setPageSize(Number(e.target.value)); }}>
          <option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
        </select>
        <span className="opacity-70 text-sm ml-auto">{totalRows} lanes</span>
      </div>
    </div>
  );
}
