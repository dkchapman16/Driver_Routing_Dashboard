export interface LoadRow {
  truck: string;
  revenue?: number;
  status: string;
}

const STATUS_COLUMNS = [
  'Load Status',
  'Status',
  'Receiver Arrival Status'
];

/**
 * Convert raw spreadsheet rows into normalized LoadRow objects.
 * Rows without a truck or with a cancelled status are removed.
 */
export function normalizeLoads(rows: Record<string, any>[]): LoadRow[] {
  return rows
    .map((row) => {
      const statusEntry =
        STATUS_COLUMNS.map((col) => row[col]).find((v) => v != null && v !== '') ?? '';

      return {
        truck: row['Truck'] || row['Truck #'] || row['Truck Number'] || '',
        revenue: Number(
          row['Revenue'] ?? row['Carrier Revenue'] ?? row['Carrier Line Haul'] ?? 0
        ),
        status: String(statusEntry)
      };
    })
    .filter(({ truck, status }) => !!truck && !/cancel/i.test(status));
}

/**
 * Aggregate revenue for a list of loads, skipping cancelled loads.
 */
export function buildFinance(loads: LoadRow[]): number {
  return loads.reduce((total, load) => {
    if (/cancel/i.test(load.status)) {
      return total;
    }
    return total + (load.revenue ?? 0);
  }, 0);
}
