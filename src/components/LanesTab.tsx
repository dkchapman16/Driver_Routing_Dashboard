import React, { useState, useMemo } from "react";
import { useDashboardFilters } from "../hooks/useDashboardFilters";

export interface LaneRow {
  lane: string;
  loads: number;
  totalRevenue: number;
  avgRevenuePerLoad: number;
  avgMilesPerLoad: number;
  avgRPM: number;
  fleetRevenuePct: number;
  cumulativePct: number;
  lastMoved: string;
}

interface Column<T> {
  key: keyof T;
  label: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  sortKey: keyof T;
  sortAsc: boolean;
  onSort: (key: keyof T) => void;
}

function DataTable<T extends Record<string, any>>({
  columns,
  data,
  sortKey,
  sortAsc,
  onSort,
}: DataTableProps<T>) {
  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal < bVal) return sortAsc ? -1 : 1;
      if (aVal > bVal) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [data, sortKey, sortAsc]);

  return (
    <table className="min-w-full text-left text-sm">
      <thead className="border-b dark:border-gray-700">
        <tr>
          {columns.map((col) => (
            <th
              key={String(col.key)}
              onClick={() => onSort(col.key)}
              className="cursor-pointer px-3 py-2 font-medium text-gray-900 dark:text-white"
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sortedData.map((row, idx) => (
          <tr key={idx} className="border-b last:border-none dark:border-gray-700">
            {columns.map((col) => (
              <td
                key={String(col.key)}
                className="px-3 py-2 text-gray-900 dark:text-white"
              >
                {row[col.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const columns: Column<LaneRow>[] = [
  { key: "lane", label: "Lane" },
  { key: "loads", label: "Loads" },
  { key: "totalRevenue", label: "Total Revenue" },
  { key: "avgRevenuePerLoad", label: "Avg Rev/Load" },
  { key: "avgMilesPerLoad", label: "Avg Total Miles/Load" },
  { key: "avgRPM", label: "Avg RPM" },
  { key: "fleetRevenuePct", label: "% of Fleet Rev" },
  { key: "cumulativePct", label: "Cum %" },
  { key: "lastMoved", label: "Last Moved" },
];

export const LanesTab: React.FC<{ data: LaneRow[] }> = ({ data }) => {
  const { searchTerm = "", setSearchTerm = () => {}, toggles = {} } =
    useDashboardFilters?.() ?? {};
  const [sortKey, setSortKey] = useState<keyof LaneRow>("lane");
  const [sortAsc, setSortAsc] = useState(true);

  const handleSort = (key: keyof LaneRow) => {
    if (key === sortKey) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const filteredData = useMemo(() => {
    let rows = data;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      rows = rows.filter((r) => r.lane.toLowerCase().includes(term));
    }
    // Placeholder for toggle-based filtering logic
    Object.entries(toggles).forEach(([key, value]) => {
      if (value === false) {
        rows = rows.filter((r) => (r as any)[key]);
      }
    });
    return rows;
  }, [data, searchTerm, toggles]);

  return (
    <div className="space-y-4 text-gray-900 dark:text-white">
      <input
        type="text"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder="Search lanes..."
        className="w-full rounded border border-gray-300 bg-white p-2 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
      />
      <DataTable
        columns={columns}
        data={filteredData}
        sortKey={sortKey}
        sortAsc={sortAsc}
        onSort={handleSort}
      />
    </div>
  );
};

export default LanesTab;
