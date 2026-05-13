"use client";

import dynamic               from "next/dynamic";
import { useState }          from "react";
import { useOperationalMap } from "@/hooks/useOperationalMap";
import { MapSummaryBar }     from "./MapSummaryBar";
import { MapFilters }        from "./MapFilters";
import { MapLegend }         from "./MapLegend";
import type { MapViewData, MapFilters as Filters } from "@/types";

// Leaflet precisa do browser — carrega só no client sem SSR
const MapCanvas = dynamic(() => import("./MapCanvas"), {
  ssr: false,
  loading: () => (
    <div style={{
      flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      background: "#0d1117", color: "#8b949e", fontSize: 14,
    }}>
      Carregando mapa…
    </div>
  ),
});

const DEFAULT_FILTERS: Filters = {
  storeId:        null,
  modal:          null,
  risk:           null,
  driverId:       null,
  showUrgentOnly: false,
};

interface Props {
  initial: MapViewData;
}

export function OperationalMapClient({ initial }: Props) {
  const [filters, setFilters]       = useState<Filters>(DEFAULT_FILTERS);
  const [showHeatmap, setShowHeatmap] = useState(false);

  const { data, loading, error, refetch } = useOperationalMap(initial, filters);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0d1117", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
        background: "#161b22", borderBottom: "1px solid #30363d",
      }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: "#e6edf3" }}>
          Visão Espacial
        </span>
        <span style={{ color: "#8b949e", fontSize: 13 }}>Operação logística em tempo real</span>
        <button
          onClick={refetch}
          disabled={loading}
          style={{
            marginLeft: "auto", background: "#21262d", border: "1px solid #30363d",
            borderRadius: 6, color: "#e6edf3", fontSize: 12, padding: "5px 12px", cursor: "pointer",
          }}
        >
          {loading ? "Atualizando…" : "↻ Atualizar"}
        </button>
      </div>

      {/* Barra de resumo */}
      <MapSummaryBar
        summary={data.summary}
        loading={loading}
        updatedAt={data.updatedAt}
      />

      {/* Filtros */}
      <MapFilters
        filters={filters}
        stores={data.stores}
        drivers={data.drivers}
        showHeatmap={showHeatmap}
        onFilters={setFilters}
        onHeatmap={setShowHeatmap}
      />

      {/* Erro */}
      {error && (
        <div style={{
          background: "#2d1b1b", border: "1px solid #6f2b2b", color: "#fca5a5",
          padding: "8px 16px", fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {/* Mapa — ocupa o espaço restante */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <MapCanvas data={data} filters={filters} showHeatmap={showHeatmap} />
        <MapLegend />
      </div>
    </div>
  );
}
