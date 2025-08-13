import { useState } from 'react';
import { useFinance } from '@/selectors/useFinance';

export default function FinancialsTab() {
  const [tg, setTg] = useState<'day' | 'week' | 'month'>('day');
  const { rows, fleet } = useFinance(tg);

  const fmt$ = (n: number | null | undefined) =>
    n == null ? '—' : Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
  const fmt2 = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(2));

  const styles = {
    muted: { color: '#a2a9bb' },
    select: { background: 'transparent', color: '#e6e8ee', border: '1px solid #232838', borderRadius: 10, padding: '6px 10px' },
    kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0,1fr))', gap: 10 },
    tableWrap: { overflow: 'auto', marginTop: 12 },
    table: { width: '100%', borderCollapse: 'collapse' as const },
    th: { textAlign: 'left' as const, padding: '8px 6px', borderBottom: '1px solid #232838' },
    td: { padding: '6px 6px', borderBottom: '1px solid #232838' },
    controls: { display: 'flex', alignItems: 'center', gap: 8 },
    card: { background: '#151923', border: '1px solid #232838', borderRadius: 14, padding: 12 },
  } as const;

  const totalMiles = fleet.miles_total || 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Controls */}
      <div style={styles.controls}>
        <div style={{ fontSize: 12, ...styles.muted }}>Timegrain</div>
        <select value={tg} onChange={(e) => setTg(e.target.value as any)} style={styles.select}>
          <option value="day">Day</option>
          <option value="week">Week (Sun–Sat)</option>
          <option value="month">Month</option>
        </select>
        <div style={{ marginLeft: 'auto', fontSize: 12, ...styles.muted }}>Miles: {Math.round(totalMiles)}</div>
      </div>

      {/* KPI cards */}
      <div style={styles.kpiGrid}>
        <KPI title="Revenue" value={fmt$(fleet.revenue)} />
        <KPI title="Fuel $" value={fmt$(fleet.fuel_cost)} />
        <KPI title="Other $" value={fmt$(fleet.expenses)} />
        <KPI title="Gross Profit" value={fmt$(fleet.gross_profit)} />
        <KPI title="Operating Ratio" value={fleet.operating_ratio == null ? '—' : `${fmt2(fleet.operating_ratio)}%`} />
        <KPI title="RPM" value={fmt2(fleet.rpm)} />
      </div>

      {/* Table */}
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Date</th>
              <th style={styles.th}>Truck</th>
              <th style={styles.th}>Revenue</th>
              <th style={styles.th}>Fuel $</th>
              <th style={styles.th}>Other $</th>
              <th style={styles.th}>Gross Profit</th>
              <th style={styles.th}>OR %</th>
              <th style={styles.th}>RPM</th>
              <th style={styles.th}>Fuel $/mi</th>
              <th style={styles.th}>Miles</th>
              <th style={styles.th}>Loads</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={styles.td}>{new Date(r.keyDate).toLocaleDateString()}</td>
                <td style={styles.td}>{r.truck || '—'}</td>
                <td style={styles.td}>{fmt$(r.revenue)}</td>
                <td style={styles.td}>{fmt$(r.fuel_cost)}</td>
                <td style={styles.td}>{fmt$(r.expenses)}</td>
                <td style={styles.td}>{fmt$(r.gross_profit)}</td>
                <td style={styles.td}>{r.operating_ratio == null ? '—' : `${fmt2(r.operating_ratio)}%`}</td>
                <td style={styles.td}>{fmt2(r.rpm)}</td>
                <td style={styles.td}>{fmt2(r.fuel_cpm)}</td>
                <td style={styles.td}>{Math.round(r.miles_total)}</td>
                <td style={styles.td}>{r.loads}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KPI({ title, value }: { title: string; value: string }) {
  const cardStyle = { background: '#151923', border: '1px solid #232838', borderRadius: 14, padding: 12 };
  const muted = { color: '#a2a9bb' };
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 12, ...muted }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 800 }}>{value}</div>
    </div>
  );
}
