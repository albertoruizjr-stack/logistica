"use client";

interface LegendItem { color: string; label: string }

const DELIVERY_LEGEND: LegendItem[] = [
  { color: "#ef4444", label: "Entrega urgente" },
  { color: "#f97316", label: "Alto risco / atraso" },
  { color: "#3b82f6", label: "Risco médio" },
  { color: "#22c55e", label: "No prazo" },
];

const DRIVER_LEGEND: LegendItem[] = [
  { color: "#22c55e", label: "Motorista disponível" },
  { color: "#f97316", label: "Ocupado (< 30 min)" },
  { color: "#ef4444", label: "Ocupado (> 30 min)" },
  { color: "#6b7280", label: "Sem localização" },
];

const STORE_LEGEND: LegendItem[] = [
  { color: "#f59e0b", label: "Loja Mestre" },
];

export function MapLegend() {
  return (
    <div style={{
      position: "absolute", bottom: 32, right: 12, zIndex: 1000,
      background: "rgba(13,17,23,0.92)", border: "1px solid #30363d",
      borderRadius: 8, padding: "12px 16px", fontSize: 12, minWidth: 180,
      backdropFilter: "blur(4px)",
    }}>
      <Section title="Lojas"      items={STORE_LEGEND} />
      <Section title="Motoristas" items={DRIVER_LEGEND} />
      <Section title="Entregas"   items={DELIVERY_LEGEND} />
    </div>
  );
}

function Section({ title, items }: { title: string; items: LegendItem[] }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ color: "#8b949e", fontWeight: 600, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1, fontSize: 10 }}>
        {title}
      </div>
      {items.map((item) => (
        <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: item.color, flexShrink: 0 }} />
          <span style={{ color: "#c9d1d9" }}>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
