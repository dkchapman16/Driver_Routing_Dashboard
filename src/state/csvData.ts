type CsvState = { rows: any[] };
const state: CsvState = { rows: [] };
export function useCsvData<T>(selector: (s: CsvState) => T): T {
  return selector(state);
}
