export function normalizeCity(city: string): string {
  return city.trim().toUpperCase();
}

export function normalizeState(state: string): string {
  return state.trim().toUpperCase();
}

export function laneKey(
  originCity: string,
  originState: string,
  destinationCity: string,
  destinationState: string
): string {
  const origin = `${normalizeCity(originCity)},${normalizeState(originState)}`;
  const destination = `${normalizeCity(destinationCity)},${normalizeState(destinationState)}`;
  return `${origin}-${destination}`;
}
