import { useSyncExternalStore } from 'react';

export type DashboardFilters = {
  basis: 'pickup' | 'delivery';
  dateRange: { start: Date | null; end: Date | null };
  selectedDriverIds: string[];
  selectedTruckIds: string[];
  filterMode: 'driver' | 'truck';
};

let filters: DashboardFilters = {
  basis: 'pickup',
  dateRange: { start: null, end: null },
  selectedDriverIds: [],
  selectedTruckIds: [],
  filterMode: 'driver',
};

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setDashboardFilters(partial: Partial<DashboardFilters>) {
  filters = { ...filters, ...partial };
  listeners.forEach((l) => l());
}

export function useDashboardFilters(): DashboardFilters {
  return useSyncExternalStore(subscribe, () => filters, () => filters);
}
