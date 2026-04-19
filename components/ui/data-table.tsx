"use client";

import { cn } from "@/lib/utils";
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

export interface Column<T> {
  key: keyof T | string;
  header: string;
  width?: string;
  sortable?: boolean;
  truncate?: boolean;
  render?: (row: T) => React.ReactNode;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  density?: "default" | "compact";
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => React.ReactNode;
  sortKey?: string;
  sortDirection?: "asc" | "desc";
  onSort?: (key: string, direction: "asc" | "desc") => void;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
  };
  emptyState?: React.ReactNode;
}

function getCellValue<T>(row: T, key: keyof T | string): React.ReactNode {
  return String((row as Record<string, unknown>)[key as string] ?? "—");
}

export function DataTable<T extends { id?: string | number }>({
  columns,
  data,
  loading = false,
  density = "default",
  onRowClick,
  rowActions,
  sortKey,
  sortDirection,
  onSort,
  pagination,
  emptyState,
}: DataTableProps<T>) {
  const cellPadding = density === "compact" ? "px-3 py-1.5" : "px-4 py-3";
  const textSize = density === "compact" ? "text-xs" : "text-sm";
  const totalColumns = columns.length + (rowActions ? 1 : 0);

  function handleSort(key: string) {
    if (!onSort) return;
    onSort(key, sortKey === key && sortDirection === "asc" ? "desc" : "asc");
  }

  const totalPages = pagination
    ? Math.ceil(pagination.total / pagination.pageSize)
    : 1;

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            {columns.map((col) => (
              <th
                key={String(col.key)}
                style={col.width ? { width: col.width } : undefined}
                className={cn(
                  "text-left text-xs font-semibold text-slate-500 uppercase tracking-wide select-none",
                  cellPadding,
                  col.sortable && onSort && "cursor-pointer hover:text-slate-700"
                )}
                onClick={col.sortable ? () => handleSort(String(col.key)) : undefined}
              >
                <span className="flex items-center gap-1">
                  {col.header}
                  {col.sortable && onSort && (
                    <span className="text-slate-400">
                      {sortKey === String(col.key) ? (
                        sortDirection === "asc" ? (
                          <ChevronUp className="w-3 h-3" />
                        ) : (
                          <ChevronDown className="w-3 h-3" />
                        )
                      ) : (
                        <ChevronsUpDown className="w-3 h-3" />
                      )}
                    </span>
                  )}
                </span>
              </th>
            ))}
            {rowActions && <th className="w-[60px]" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                {Array.from({ length: totalColumns }).map((_, j) => (
                  <td key={j} className={cellPadding}>
                    <div
                      className={cn(
                        "bg-slate-100 rounded animate-pulse w-full",
                        density === "compact" ? "h-9" : "h-[52px]"
                      )}
                    />
                  </td>
                ))}
              </tr>
            ))
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={totalColumns} className="py-12">
                {emptyState ?? (
                  <p className="text-center text-sm text-slate-400">
                    Nenhum registro encontrado
                  </p>
                )}
              </td>
            </tr>
          ) : (
            data.map((row, i) => (
              <tr
                key={String(row.id ?? i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "transition-colors",
                  onRowClick && "hover:bg-slate-50 cursor-pointer"
                )}
              >
                {columns.map((col) => (
                  <td
                    key={String(col.key)}
                    className={cn(
                      cellPadding,
                      textSize,
                      "text-slate-700",
                      col.truncate && "max-w-0"
                    )}
                  >
                    {col.render ? (
                      col.render(row)
                    ) : col.truncate ? (
                      <span
                        className="block truncate"
                        title={String(getCellValue(row, col.key))}
                      >
                        {getCellValue(row, col.key)}
                      </span>
                    ) : (
                      getCellValue(row, col.key)
                    )}
                  </td>
                ))}
                {rowActions && (
                  <td
                    className={cn(cellPadding, "text-right")}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {rowActions(row)}
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {pagination && !loading && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-white">
          <p className="text-xs text-slate-500">
            {pagination.total} registro{pagination.total !== 1 ? "s" : ""}
          </p>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">
              Página {pagination.page} de {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={pagination.page <= 1}
                onClick={() => pagination.onPageChange(pagination.page - 1)}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                disabled={pagination.page >= totalPages}
                onClick={() => pagination.onPageChange(pagination.page + 1)}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
