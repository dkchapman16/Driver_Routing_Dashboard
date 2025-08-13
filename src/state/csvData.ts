import { useSyncExternalStore } from 'react';

export type CsvDataStore = {
  loadsRows: any[];
  fuelRows: any[];
  expenseRows: any[];
};

let store: CsvDataStore = { loadsRows: [], fuelRows: [], expenseRows: [] };
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setCsvData(partial: Partial<CsvDataStore>) {
  store = { ...store, ...partial };
  listeners.forEach((l) => l());
}

export function useCsvData<T>(selector: (s: CsvDataStore) => T): T {
  return useSyncExternalStore(subscribe, () => selector(store), () => selector(store));
}
