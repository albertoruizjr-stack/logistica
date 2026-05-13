import type { HourlyBucket } from "@/services/analytics.service";

interface HourlyHeatmapProps {
  data: HourlyBucket[];
}

const DOW_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DOWS  = [1, 2, 3, 4, 5, 6, 0]; // Seg→Dom, Dom por último

function lerp(a: string, b: string, t: number): string {
  // Interpola entre duas cores hex
  const ah = parseInt(a.slice(1), 16);
  const bh = parseInt(b.slice(1), 16);
  const ar = (ah >> 16) & 0xff, ag = (ah >> 8) & 0xff, ab = ah & 0xff;
  const br = (bh >> 16) & 0xff, bg = (bh >> 8) & 0xff, bb = bh & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bv = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${bv})`;
}

export function HourlyHeatmap({ data }: HourlyHeatmapProps) {
  // Build lookup: dow×hour → count
  const lookup = new Map<string, number>();
  let maxCount = 0;
  for (const b of data) {
    const key = `${b.dow}-${b.hour}`;
    lookup.set(key, b.count);
    if (b.count > maxCount) maxCount = b.count;
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <div style={{ minWidth: "680px" }}>
          {/* Hour labels */}
          <div className="flex mb-0.5" style={{ paddingLeft: "36px" }}>
            {HOURS.map((h) => (
              <div
                key={h}
                className="flex-1 text-center text-[8px] tabular-nums"
                style={{ color: h % 6 === 0 ? "#6B7280" : "#2D3748" }}
              >
                {h % 6 === 0 ? `${h}h` : ""}
              </div>
            ))}
          </div>

          {/* Grid rows */}
          {DOWS.map((dow) => (
            <div key={dow} className="flex items-center mb-0.5">
              {/* Day label */}
              <div
                className="w-9 text-right pr-2 text-[9px] flex-shrink-0"
                style={{ color: "#4B5563" }}
              >
                {DOW_LABELS[dow]}
              </div>

              {/* Cells */}
              {HOURS.map((h) => {
                const count = lookup.get(`${dow}-${h}`) ?? 0;
                const t     = maxCount > 0 ? count / maxCount : 0;
                const bg    = t === 0
                  ? "#0F1318"
                  : lerp("#1E3A2F", "#10B981", t);

                return (
                  <div
                    key={h}
                    className="flex-1 mx-px"
                    style={{ backgroundColor: bg, height: "18px", borderRadius: "2px" }}
                    title={`${DOW_LABELS[dow]} ${h}h: ${count} transições`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 mt-2 justify-end">
        <span className="text-[9px]" style={{ color: "#374151" }}>Baixo</span>
        <div
          className="h-2 w-20 rounded"
          style={{ background: "linear-gradient(to right, #1E3A2F, #10B981)" }}
        />
        <span className="text-[9px]" style={{ color: "#374151" }}>Alto</span>
      </div>
    </div>
  );
}
