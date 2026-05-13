"use client";

import type { MapFilters, MapStore, MapDriver, ModalRecommendation, DeliveryRisk } from "@/types";

interface Props {
  filters:      MapFilters;
  stores:       MapStore[];
  drivers:      MapDriver[];
  showHeatmap:  boolean;
  onFilters:    (f: MapFilters) => void;
  onHeatmap:    (v: boolean) => void;
}

const MODALS: { value: ModalRecommendation | ""; label: string }[] = [
  { value: "",            label: "Todos modais" },
  { value: "INTERNAL",   label: "Frota própria" },
  { value: "LALAMOVE",   label: "Lalamove" },
  { value: "EXPRESS",    label: "Express" },
  { value: "CONSOLIDATE", label: "Consolidar" },
];

const RISKS: { value: DeliveryRisk | ""; label: string }[] = [
  { value: "",       label: "Todos riscos" },
  { value: "HIGH",   label: "Alto risco" },
  { value: "MEDIUM", label: "Médio risco" },
  { value: "LOW",    label: "Baixo risco" },
];

export function MapFilters({ filters, stores, drivers, showHeatmap, onFilters, onHeatmap }: Props) {
  function set(patch: Partial<MapFilters>) {
    onFilters({ ...filters, ...patch });
  }

  return (
    <div style={{
      display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
      padding: "8px 16px", background: "#0d1117", borderBottom: "1px solid #30363d",
    }}>
      {/* Loja */}
      <Select
        value={filters.storeId ?? ""}
        onChange={(v) => set({ storeId: v || null })}
      >
        <option value="">Todas as lojas</option>
        {stores.map((s) => (
          <option key={s.id} value={s.id}>Loja {s.code} — {s.name}</option>
        ))}
      </Select>

      {/* Modal */}
      <Select
        value={filters.modal ?? ""}
        onChange={(v) => set({ modal: (v as ModalRecommendation) || null })}
      >
        {MODALS.map((m) => (
          <option key={m.value} value={m.value}>{m.label}</option>
        ))}
      </Select>

      {/* Risco */}
      <Select
        value={filters.risk ?? ""}
        onChange={(v) => set({ risk: (v as DeliveryRisk) || null })}
      >
        {RISKS.map((r) => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </Select>

      {/* Motorista */}
      <Select
        value={filters.driverId ?? ""}
        onChange={(v) => set({ driverId: v || null })}
      >
        <option value="">Todos os motoristas</option>
        {drivers.map((d) => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </Select>

      {/* Urgente only */}
      <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#e6edf3", fontSize: 13, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={filters.showUrgentOnly}
          onChange={(e) => set({ showUrgentOnly: e.target.checked })}
          style={{ accentColor: "#ef4444" }}
        />
        Só urgentes
      </label>

      {/* Heatmap */}
      <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#e6edf3", fontSize: 13, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={showHeatmap}
          onChange={(e) => onHeatmap(e.target.checked)}
          style={{ accentColor: "#a855f7" }}
        />
        Heatmap
      </label>

      {/* Reset */}
      <button
        onClick={() => onFilters({ storeId: null, modal: null, risk: null, driverId: null, showUrgentOnly: false })}
        style={{
          marginLeft: "auto", background: "transparent", border: "1px solid #30363d",
          borderRadius: 6, color: "#8b949e", fontSize: 12, padding: "4px 10px", cursor: "pointer",
        }}
      >
        Limpar filtros
      </button>
    </div>
  );
}

function Select({ value, onChange, children }: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: "#161b22", border: "1px solid #30363d", borderRadius: 6,
        color: "#e6edf3", fontSize: 13, padding: "4px 8px", cursor: "pointer",
      }}
    >
      {children}
    </select>
  );
}
