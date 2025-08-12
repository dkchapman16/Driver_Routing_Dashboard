// Utility to convert Excel serial dates or date strings into JavaScript Date objects.
// Exported for reuse and testing.
export function excelToDate(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    // Excel serial dates are based on 1899-12-30; treat them as UTC to avoid
    // local timezone offsets influencing the result.
    const base = Date.UTC(1899, 11, 30);
    return new Date(base + v * 86400000);
  }
  const onlyDate = String(v).split(" ")[0];
  // Parse string dates as local time by appending a time component so they are
  // not interpreted as UTC. This prevents a potential one-day shift.
  const d = new Date(`${onlyDate}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}
