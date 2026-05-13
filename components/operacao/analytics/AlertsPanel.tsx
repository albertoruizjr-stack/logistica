import { AlertTriangle, Clock, Lock, TrendingUp } from "lucide-react";
import type { AnalyticsSummary } from "@/services/analytics.service";

interface AlertsPanelProps {
  currentStuck: AnalyticsSummary["currentStuck"];
}

export function AlertsPanel({ currentStuck }: AlertsPanelProps) {
  if (currentStuck.length === 0) {
    return (
      <div
        className="rounded-lg px-4 py-3 flex items-center gap-2 text-[11px]"
        style={{ backgroundColor: "#10B98122", border: "1px solid #10B98133", color: "#6EE7B7" }}
      >
        <span>✓</span>
        Nenhum card parado além do threshold no momento
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {currentStuck.map((item) => (
        <div
          key={item.status}
          className="rounded-lg px-3 py-2.5 flex items-center gap-2"
          style={{
            backgroundColor: item.count > 3 ? "#EF444418" : "#F59E0B18",
            border:          item.count > 3 ? "1px solid #EF444430" : "1px solid #F59E0B30",
          }}
        >
          <AlertTriangle
            className="w-4 h-4 flex-shrink-0"
            style={{ color: item.count > 3 ? "#F87171" : "#FCD34D" }}
          />
          <div>
            <p
              className="text-[11px] font-bold"
              style={{ color: item.count > 3 ? "#F87171" : "#FCD34D" }}
            >
              {item.count} card{item.count !== 1 ? "s" : ""}
            </p>
            <p className="text-[10px]" style={{ color: "#6B7280" }}>
              {item.label}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
