"use client";

import { Search, X } from "lucide-react";

export interface FilterConfig {
  type: "search" | "select" | "daterange";
  key: string;
  placeholder?: string;
  options?: { label: string; value: string }[];
}

interface FilterBarProps {
  filters: FilterConfig[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  onReset?: () => void;
}

export function FilterBar({ filters, values, onChange, onReset }: FilterBarProps) {
  const hasActiveFilters = Object.values(values).some(
    (v) => v !== "" && v !== null && v !== undefined
  );

  return (
    <div
      className="flex items-center gap-2.5 px-4 py-2.5 border-b min-h-[46px] flex-wrap"
      style={{
        backgroundColor: "var(--color-background)",
        borderColor: "var(--color-border)",
      }}
    >
      {filters.map((filter) => {
        if (filter.type === "search") {
          return (
            <div key={filter.key} className="relative flex-1 max-w-xs min-w-[160px]">
              <Search
                className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
                style={{ color: "#A3A3A3" }}
              />
              <input
                type="text"
                placeholder={filter.placeholder ?? "Buscar..."}
                value={String(values[filter.key] ?? "")}
                onChange={(e) => onChange(filter.key, e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-[13px] rounded-lg focus:outline-none focus:ring-1"
                style={{
                  backgroundColor: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-body-text)",
                }}
              />
            </div>
          );
        }

        if (filter.type === "select" && filter.options) {
          return (
            <select
              key={filter.key}
              value={String(values[filter.key] ?? "")}
              onChange={(e) => onChange(filter.key, e.target.value)}
              className="py-1.5 px-3 text-[13px] rounded-lg focus:outline-none focus:ring-1"
              style={{
                backgroundColor: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                color: "var(--color-body-text)",
              }}
            >
              {filter.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          );
        }

        return null;
      })}

      {hasActiveFilters && onReset && (
        <button
          onClick={onReset}
          className="ml-auto flex items-center gap-1 text-[12px] transition-colors"
          style={{ color: "#A3A3A3" }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--color-body-text)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#A3A3A3")}
        >
          <X className="w-3.5 h-3.5" />
          Limpar filtros
        </button>
      )}
    </div>
  );
}
