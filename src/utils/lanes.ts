export function normalizeCity(s = '') { return s.trim().toUpperCase(); }
export function laneKey(oCity: string, oState: string, dCity: string, dState: string) {
  return `${normalizeCity(oCity)}, ${oState} → ${normalizeCity(dCity)}, ${dState}`;
}

export type LoadRow = {
  pickup_city: string; pickup_state: string;
  delivery_city: string; delivery_state: string;
  picked_up_at: Date; delivered_at: Date;
  driver_id: string; status: string;
  hauling_fee: number; miles_loaded: number; miles_empty: number;
};

export type LaneRow = {
  lane: string; loads: number; total_revenue: number;
  avg_revenue_per_load: number; avg_total_miles_per_load: number;
  avg_rpm: number; pct_of_fleet_revenue: number; cum_pct_of_fleet_revenue: number;
  last_moved: Date;
};

export function buildLaneRows(
  rows: LoadRow[],
  opts: { start: Date; end: Date; basis: 'pickup' | 'delivery'; driverIds: string[] }
): { rows: LaneRow[]; fleet_revenue: number } {
  const inRange = (r: LoadRow) => {
    const dt = opts.basis === 'pickup' ? r.picked_up_at : r.delivered_at;
    return r.status === 'Completed'
      && dt >= opts.start && dt <= opts.end
      && (opts.driverIds.length === 0 || opts.driverIds.includes(r.driver_id));
  };

  const map = new Map<string, any>();
  for (const r of rows) {
    if (!inRange(r)) continue;
    const miles_total = (r.miles_loaded || 0) + (r.miles_empty || 0);
    const key = laneKey(r.pickup_city, r.pickup_state, r.delivery_city, r.delivery_state);
    const L = map.get(key) || { lane: key, loads: 0, total_revenue: 0, milesSum: 0, rpmSum: 0, rpmCount: 0, last_moved: null as Date | null };
    L.loads += 1;
    L.total_revenue += Number(r.hauling_fee || 0);
    L.milesSum += miles_total;
    if (miles_total > 0) { L.rpmSum += (Number(r.hauling_fee || 0) / miles_total); L.rpmCount += 1; }
    if (!L.last_moved || r.delivered_at > L.last_moved) L.last_moved = r.delivered_at;
    map.set(key, L);
  }

  const arr = Array.from(map.values());
  const fleet_revenue = arr.reduce((s, a) => s + a.total_revenue, 0);
  arr.sort((a, b) => b.total_revenue - a.total_revenue);

  let cum = 0;
  const out: LaneRow[] = arr.map(a => {
    const avg_revenue_per_load = a.loads ? a.total_revenue / a.loads : 0;
    const avg_total_miles_per_load = a.loads ? a.milesSum / a.loads : 0;
    const avg_rpm = a.rpmCount ? a.rpmSum / a.rpmCount : 0;
    const pct = fleet_revenue ? (a.total_revenue / fleet_revenue) * 100 : 0;
    cum += pct;
    return {
      lane: a.lane,
      loads: a.loads,
      total_revenue: a.total_revenue,
      avg_revenue_per_load,
      avg_total_miles_per_load,
      avg_rpm,
      pct_of_fleet_revenue: pct,
      cum_pct_of_fleet_revenue: cum,
      last_moved: a.last_moved!,
    };
  });

  return { rows: out, fleet_revenue };
}
