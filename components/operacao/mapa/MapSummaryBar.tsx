"use client";

import type { MapSummary } from "@/types";

interface Props {
  summary:   MapSummary;
  loading:   boolean;
  updatedAt: Date;
}

export function MapSummaryBar({ summary, loading, updatedAt }: Props) {
  const time = new Date(updatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div style={{
      display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
      padding: "8px 16px", background: "#161b22", borderBottom: "1px solid #30363d",
      fontSize: 13,
    }}>
      <Stat label="Entregas" value={summary.totalDeliveries} color="#e6edf3" />
      <Sep />
      <Stat label="Urgentes"    value={summary.urgentCount}    color="#ef4444" />
      <Stat label="Alto risco"  value={summary.highRiskCount}  color="#f97316" />
      <Stat label="Em trânsito" value={summary.inTransitCount} color="#3b82f6" />
      <Stat label="Pendentes"   value={summary.pendingCount}   color="#6b7280" />
      <Sep />
      <Stat label="Motoristas"  value={summary.activeDrivers}    color="#e6edf3" />
      <Stat label="Disponíveis" value={summary.availableDrivers} color="#22c55e" />
      <div style={{ marginLeft: "auto", color: "#6b7280", fontSize: 12 }}>
        {loading ? "Atualizando…" : `Atualizado às ${time}`}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
      <span style={{ color, fontWeight: 700, fontSize: 16 }}>{value}</span>
      <span style={{ color: "#8b949e" }}>{label}</span>
    </div>
  );
}

function Sep() {
  return <div style={{ width: 1, height: 20, background: "#30363d" }} />;
}
