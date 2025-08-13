import { useMemo } from 'react';
import { normalizeLoads, normalizeFuel, normalizeExpenses, buildFinance, type FinanceRow } from '@/utils/financeJoiner';
import { useDashboardFilters } from '@/state/filters';   // existing (basis, dateRange, selectedDriverIds, selectedTruckIds)
import { useCsvData } from '@/state/csvData';            // existing raw CSV rows per file

export function useFinance(timegrain: 'day'|'week'|'month' = 'day'): {
  rows: FinanceRow[]; fleet: FinanceRow;
} {
  const { basis, dateRange, selectedDriverIds, selectedTruckIds } = useDashboardFilters();
  const loadsRaw = useCsvData(s => s.loadsRows);      // wire to your loads CSV rows
  const fuelRaw  = useCsvData(s => s.fuelRows);       // wire to your fuel CSV rows
  const expRaw   = useCsvData(s => s.expenseRows);    // wire to your expense CSV rows

  return useMemo(()=>{
    const loads = normalizeLoads(loadsRaw || []);
    const fuel  = normalizeFuel(fuelRaw  || []);      // cash advances excluded
    const exps  = normalizeExpenses(expRaw || []);

    const { byTruck, fleetTotals } = buildFinance(loads, fuel, exps, {
      basis,
      rangeStart: dateRange.start,
      rangeEnd: dateRange.end,
      trucks: selectedTruckIds || [],
      drivers: selectedDriverIds || [],
    }, timegrain);

    return { rows: byTruck, fleet: fleetTotals };
  }, [loadsRaw, fuelRaw, expRaw, basis, dateRange.start, dateRange.end, selectedDriverIds?.join('|'), selectedTruckIds?.join('|'), timegrain]);
}
