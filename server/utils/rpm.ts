export interface Load {
  miles: number;
  revenue: number;
}

export function avgRpm(loads: Load[]): number {
  let miles = 0;
  let revenue = 0;

  for (const load of loads) {
    if (load.miles > 0) {
      miles += load.miles;
      revenue += load.revenue;
    }
  }

  return miles > 0 ? revenue / miles : 0;
}
