export function useCsvData(selector: any){
  const data = {
    loadsRows: [],
    fuelRows: [],
    expenseRows: [],
  };
  return selector ? selector(data) : data;
}
