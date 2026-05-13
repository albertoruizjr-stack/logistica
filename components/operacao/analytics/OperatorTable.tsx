import type { OperatorMetric } from "@/services/analytics.service";

interface OperatorTableProps {
  operators: OperatorMetric[];
}

const STATUS_SHORT: Record<string, string> = {
  PENDING:             "Pend",
  AWAITING_ITEMS:      "Sep",
  AWAITING_TRANSFER:   "Transf",
  SEPARADO:            "Separado",
  AGUARDANDO_NF:       "NF",
  NF_EMITIDA:          "NF emit",
  NF_VINCULADA:        "NF vinc",
  PRONTO_ROTEIRIZACAO: "Rotei",
  ROTEIRIZADO:         "Rot",
  DISPATCHED:          "Desp",
  IN_TRANSIT:          "Transit",
  OCORRENCIA:          "Oco",
};

export function OperatorTable({ operators }: OperatorTableProps) {
  if (operators.length === 0) {
    return (
      <p className="text-[11px] text-center py-6" style={{ color: "#374151" }}>
        Sem dados de operadores no período
      </p>
    );
  }

  const maxActions = Math.max(...operators.map((o) => o.totalActions), 1);

  return (
    <div className="space-y-2">
      {operators.map((op) => {
        const barWidth = (op.totalActions / maxActions) * 100;
        return (
          <div
            key={op.operatorId}
            className="rounded-lg px-3 py-2.5"
            style={{ backgroundColor: "#0F1318", border: "1px solid #1E2530" }}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[12px] font-semibold" style={{ color: "#E5E7EB" }}>
                {op.operatorName}
              </span>
              <div className="flex items-center gap-3 text-[10px]">
                <span style={{ color: "#6B7280" }}>
                  {op.totalActions} ações
                </span>
                <span style={{ color: "#9CA3AF" }}>
                  {op.avgDurationMin}min avg
                </span>
              </div>
            </div>

            {/* Activity bar */}
            <div className="h-1 rounded overflow-hidden mb-1.5" style={{ backgroundColor: "#1E2530" }}>
              <div
                className="h-full rounded"
                style={{ width: `${barWidth}%`, backgroundColor: "#3B82F6" }}
              />
            </div>

            {/* Status breakdown */}
            <div className="flex flex-wrap gap-1">
              {op.statusBreakdown
                .sort((a, b) => b.count - a.count)
                .slice(0, 5)
                .map((sb) => (
                  <span
                    key={sb.status}
                    className="text-[9px] px-1.5 py-0.5 rounded tabular-nums"
                    style={{ backgroundColor: "#1E2530", color: "#6B7280" }}
                  >
                    {STATUS_SHORT[sb.status] ?? sb.status} ×{sb.count}
                  </span>
                ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
