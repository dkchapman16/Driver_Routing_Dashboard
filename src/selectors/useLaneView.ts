import { useMemo } from 'react';
import { buildLaneRows, type LaneRow } from '@/utils/lanes';
import { useDashboardFilters } from '@/state/filters';
import { useCsvData } from '@/state/csvData';

export function useLaneView(): { rows: LaneRow[]; fleet_revenue: number } {
  const { basis, dateRange, selectedDriverIds } = useDashboardFilters();
  const rows = useCsvData(s => s.rows);
  return useMemo(
    () => buildLaneRows(rows, {
      start: dateRange.start,
      end: dateRange.end,
      basis,
      driverIds: selectedDriverIds
    }),
    [rows, basis, dateRange.start, dateRange.end, selectedDriverIds]
  );
}
