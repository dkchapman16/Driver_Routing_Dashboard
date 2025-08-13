export function useDashboardFilters(){
  return {
    basis: 'pickup',
    dateRange: { start: null, end: null },
    selectedDriverIds: [],
    selectedTruckIds: [],
  };
}
