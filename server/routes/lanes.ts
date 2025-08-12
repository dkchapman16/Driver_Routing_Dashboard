import { Router } from 'express';
import { Pool } from 'pg';

export default function lanesRouter(pool: Pool) {
  const router = Router();

  router.get('/', async (req, res) => {
    const { basis = 'revenue', start, end } = req.query as Record<string, string>;
    const drivers = req.query['drivers[]'] || req.query.drivers;

    if (!start || !end) {
      return res.status(400).json({ error: 'start and end are required' });
    }
    if (basis !== 'revenue' && basis !== 'loads') {
      return res.status(400).json({ error: 'basis must be revenue or loads' });
    }

    const startDate = new Date(start);
    const endDate = new Date(end);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'invalid start or end date' });
    }

    let driverIds: number[] = [];
    if (drivers) {
      const arr = Array.isArray(drivers) ? drivers : [drivers];
      for (const d of arr) {
        const id = Number(d);
        if (Number.isNaN(id)) {
          return res.status(400).json({ error: 'drivers must be numeric' });
        }
        driverIds.push(id);
      }
    }

    const values = [start, end];
    let driverClause = '';
    if (driverIds.length) {
      values.push(driverIds);
      driverClause = `AND driver_id = ANY($${values.length})`;
    }

    const query = `
      WITH filtered AS (
        SELECT origin_city, origin_state, dest_city, dest_state, revenue, driver_id, delivered_date
        FROM loads
        WHERE status = 'completed'
          AND delivered_date BETWEEN $1 AND $2
          ${driverClause}
      ),
      normalized AS (
        SELECT
          CASE WHEN origin_city < dest_city THEN origin_city ELSE dest_city END AS origin_city,
          CASE WHEN origin_state < dest_state THEN origin_state ELSE dest_state END AS origin_state,
          CASE WHEN origin_city < dest_city THEN dest_city ELSE origin_city END AS dest_city,
          CASE WHEN origin_state < dest_state THEN dest_state ELSE origin_state END AS dest_state,
          revenue
        FROM filtered
      ),
      lane_totals AS (
        SELECT origin_city, origin_state, dest_city, dest_state,
               SUM(revenue) AS revenue,
               COUNT(*) AS loads
        FROM normalized
        GROUP BY 1,2,3,4
      ),
      fleet_totals AS (
        SELECT SUM(revenue) AS fleet_revenue, SUM(loads) AS fleet_loads FROM lane_totals
      ),
      ranked AS (
        SELECT lt.*, 
               CASE WHEN '${basis}' = 'revenue' THEN lt.revenue ELSE lt.loads END AS basis_value,
               CASE WHEN '${basis}' = 'revenue'
                    THEN lt.revenue / ft.fleet_revenue
                    ELSE lt.loads::float / ft.fleet_loads
               END AS share,
               CASE WHEN '${basis}' = 'revenue'
                    THEN SUM(lt.revenue) OVER (ORDER BY lt.revenue DESC) / ft.fleet_revenue
                    ELSE SUM(lt.loads) OVER (ORDER BY lt.loads DESC) / ft.fleet_loads
               END AS cumulative_share
        FROM lane_totals lt CROSS JOIN fleet_totals ft
      )
      SELECT origin_city, origin_state, dest_city, dest_state, revenue, loads, share,
             cumulative_share <= 0.8 AS pareto, fleet_revenue
      FROM ranked CROSS JOIN fleet_totals
      ORDER BY basis_value DESC;`;

    try {
      const result = await pool.query(query, values);
      const fleetRevenue = result.rows.length ? result.rows[0].fleet_revenue : 0;
      const rows = result.rows.map(({ fleet_revenue, ...row }) => row);
      res.json({
        filters: { basis, start, end, drivers: driverIds },
        rows,
        fleet_revenue: fleetRevenue,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'internal error' });
    }
  });

  return router;
}
