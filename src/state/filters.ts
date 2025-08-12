export function useDashboardFilters() {
  return {
    basis: 'pickup' as 'pickup' | 'delivery',
    dateRange: { start: new Date(0), end: new Date(8640000000000000) },
    selectedDriverIds: [] as string[]
  };
}
