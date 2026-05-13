import type { StageMetric } from "@/services/analytics.service";

interface StageTimingChartProps {
  stages: StageMetric[];
}

function formatMin(min: number): string {
  if (min < 60)  return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function StageTimingChart({ stages }: StageTimingChartProps) {
  const maxAvg = Math.max(...stages.map((s) => s.avgDurationMin), 1);

  return (
    <div className="space-y-1.5">
      {stages.filter((s) => s.count > 0).map((s) => {
        const barWidth    = Math.min((s.avgDurationMin / maxAvg) * 100, 100);
        const p90Width    = Math.min((s.p90DurationMin / maxAvg) * 100, 100);
        const isBottleneck = s.isBottleneck;

        return (
          <div key={s.status} className="group">
            <div className="flex items-center justify-between mb-0.5">
              <div className="flex items-center gap-2">
                <span
                  className="text-[10px] font-semibold"
                  style={{ color: isBottleneck ? "#F87171" : "#9CA3AF" }}
                >
                  {s.label}
                </span>
                {isBottleneck && (
                  <span
                    className="text-[8px] font-bold px-1 py-0.5 rounded uppercase tracking-wide"
                    style={{ backgroundColor: "#EF444422", color: "#F87171", border: "1px solid #EF444433" }}
                  >
                    gargalo
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-[10px]">
                <span style={{ color: "#6B7280" }}>n={s.count}</span>
                <span style={{ color: isBottleneck ? "#F87171" : "#E5E7EB" }}>
                  {formatMin(s.avgDurationMin)} avg
                </span>
                <span style={{ color: "#4B5563" }}>
                  p90 {formatMin(s.p90DurationMin)}
                </span>
              </div>
            </div>

            {/* Bar */}
            <div className="relative h-4 rounded overflow-hidden" style={{ backgroundColor: "#1E2530" }}>
              {/* Threshold line */}
              <div
                className="absolute top-0 bottom-0 w-px z-10"
                style={{
                  left:            `${Math.min((s.thresholdMin / maxAvg) * 100, 100)}%`,
                  backgroundColor: "#374151",
                }}
              />
              {/* P90 bar */}
              <div
                className="absolute top-0 left-0 bottom-0 rounded opacity-30"
                style={{
                  width:           `${p90Width}%`,
                  backgroundColor: isBottleneck ? "#EF4444" : "#6B7280",
                }}
              />
              {/* AVG bar */}
              <div
                className="absolute top-1 left-0 bottom-1 rounded transition-all"
                style={{
                  width:           `${barWidth}%`,
                  backgroundColor: isBottleneck ? "#EF4444" : "#10B981",
                }}
              />
            </div>
          </div>
        );
      })}

      <p className="text-[9px] mt-2" style={{ color: "#374151" }}>
        Linha vertical = threshold operacional · Barra escura = p90 · Barra colorida = média
      </p>
    </div>
  );
}
