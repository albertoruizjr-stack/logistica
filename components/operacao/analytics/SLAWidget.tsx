import type { SLAMetrics } from "@/services/analytics.service";

const SLA_TYPE_LABEL: Record<string, string> = {
  STANDARD:  "D+1",
  URGENT:    "Urgente D+0",
  EXPRESS:   "Express",
  SCHEDULED: "Agendado",
};

const SLA_THRESHOLD_LABEL: Record<string, string> = {
  STANDARD:  "36h",
  URGENT:    "8h",
  EXPRESS:   "4h",
  SCHEDULED: "48h",
};

interface SLAWidgetProps {
  sla: SLAMetrics;
}

export function SLAWidget({ sla }: SLAWidgetProps) {
  const pct = sla.compliancePct;
  const color = pct >= 90 ? "#10B981" : pct >= 70 ? "#F59E0B" : "#EF4444";

  // SVG donut arc
  const r = 32, cx = 40, cy = 40;
  const circumference = 2 * Math.PI * r;
  const dash = (pct / 100) * circumference;

  return (
    <div className="space-y-4">
      {/* Gauge circular */}
      <div className="flex items-center gap-6">
        <svg width={80} height={80} className="flex-shrink-0">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1E2530" strokeWidth={8} />
          <circle
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={color}
            strokeWidth={8}
            strokeDasharray={`${dash} ${circumference}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`}
          />
          <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
            style={{ fill: color, fontSize: 13, fontWeight: "bold", fontFamily: "monospace" }}>
            {pct}%
          </text>
        </svg>

        <div>
          <p className="text-[13px] font-bold" style={{ color: "#E5E7EB" }}>
            Compliance SLA
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: "#6B7280" }}>
            {sla.withinSLA} de {sla.total} dentro do prazo
          </p>
          {sla.outsideSLA > 0 && (
            <p className="text-[11px] mt-0.5" style={{ color: "#F87171" }}>
              {sla.outsideSLA} entrega{sla.outsideSLA !== 1 ? "s" : ""} fora do SLA
            </p>
          )}
        </div>
      </div>

      {/* Breakdown por tipo */}
      <div className="space-y-2">
        {sla.byType.map((t) => {
          const tPct   = t.compliancePct;
          const tColor = tPct >= 90 ? "#10B981" : tPct >= 70 ? "#F59E0B" : "#EF4444";
          return (
            <div key={t.slaType}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px]" style={{ color: "#9CA3AF" }}>
                  {SLA_TYPE_LABEL[t.slaType] ?? t.slaType}
                  <span style={{ color: "#4B5563" }}> ({SLA_THRESHOLD_LABEL[t.slaType]})</span>
                </span>
                <div className="flex items-center gap-2 text-[10px]">
                  <span style={{ color: "#6B7280" }}>n={t.total}</span>
                  <span style={{ color: tColor, fontWeight: "bold" }}>{tPct}%</span>
                </div>
              </div>
              <div className="h-1.5 rounded overflow-hidden" style={{ backgroundColor: "#1E2530" }}>
                <div
                  className="h-full rounded transition-all"
                  style={{ width: `${tPct}%`, backgroundColor: tColor }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {sla.total === 0 && (
        <p className="text-[11px] text-center py-4" style={{ color: "#374151" }}>
          Sem entregas concluídas no período
        </p>
      )}
    </div>
  );
}
