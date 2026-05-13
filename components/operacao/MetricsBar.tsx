"use client";

import { AlertTriangle, BarChart2 } from "lucide-react";
import Link from "next/link";
import type { QueueMetrics } from "./types";

interface MetricsBarProps {
  metrics: QueueMetrics;
  loading: boolean;
}

interface Metric {
  label: string;
  value: number;
  color: string;
  pulse?: boolean;
}

export function MetricsBar({ metrics, loading }: MetricsBarProps) {
  const items: Metric[] = [
    { label: "Ativos",          value: metrics.total,            color: "#9CA3AF" },
    { label: "Urgente",         value: metrics.urgent,           color: "#EF4444", pulse: metrics.urgent > 0 },
    { label: "Express",         value: metrics.express,          color: "#A78BFA", pulse: metrics.express > 0 },
    { label: "Ocorrências",     value: metrics.ocorrencias,      color: "#F59E0B", pulse: metrics.ocorrencias > 0 },
    { label: "Transferências",  value: metrics.pendingTransfers, color: "#60A5FA" },
    { label: "Prontos desp.",   value: metrics.readyForDispatch, color: "#34D399", pulse: metrics.readyForDispatch > 0 },
  ];

  const criticalAlerts = metrics.alerts.filter((a) => a.severity === "CRITICAL").length;
  const totalAlerts    = metrics.alerts.length;

  return (
    <div
      className="flex items-center gap-6 px-5 py-2.5 border-b"
      style={{ backgroundColor: "#0D1117", borderColor: "#1E2530" }}
    >
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <div className="relative flex items-center justify-center">
            {item.pulse && item.value > 0 && (
              <span
                className="absolute inline-flex h-full w-full rounded-full opacity-50 animate-ping"
                style={{ backgroundColor: item.color }}
              />
            )}
            <span
              className="relative text-lg font-bold tabular-nums"
              style={{ color: item.color, fontFamily: "var(--font-mono, monospace)" }}
            >
              {item.value}
            </span>
          </div>
          <span className="text-[11px] font-medium" style={{ color: "#4B5563" }}>
            {item.label}
          </span>
        </div>
      ))}

      {/* Stuck + SLA breaches */}
      {(metrics.stuckCards > 0 || metrics.slaBreaches > 0) && (
        <>
          <span style={{ color: "#1E2530" }}>|</span>
          {metrics.stuckCards > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="relative">
                <span className="absolute inline-flex h-full w-full rounded-full opacity-40 animate-ping" style={{ backgroundColor: "#F59E0B" }} />
                <span className="relative text-sm font-bold tabular-nums" style={{ color: "#F59E0B" }}>
                  {metrics.stuckCards}
                </span>
              </span>
              <span className="text-[11px]" style={{ color: "#4B5563" }}>parados</span>
            </div>
          )}
          {metrics.slaBreaches > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="relative">
                <span className="absolute inline-flex h-full w-full rounded-full opacity-40 animate-ping" style={{ backgroundColor: "#EF4444" }} />
                <span className="relative text-sm font-bold tabular-nums" style={{ color: "#EF4444" }}>
                  {metrics.slaBreaches}
                </span>
              </span>
              <span className="text-[11px]" style={{ color: "#4B5563" }}>SLA</span>
            </div>
          )}
        </>
      )}

      <div className="flex-1" />

      {/* Link para analytics */}
      <Link
        href="/operacao/analytics"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors"
        style={{ backgroundColor: "#1E2530", color: "#6B7280" }}
      >
        <BarChart2 className="w-3 h-3" />
        Analytics
      </Link>

      {/* Badge de alertas */}
      {totalAlerts > 0 && (
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold"
          style={{
            backgroundColor: criticalAlerts > 0 ? "#EF444422" : "#F59E0B22",
            color:           criticalAlerts > 0 ? "#F87171"   : "#FCD34D",
            border:          criticalAlerts > 0 ? "1px solid #EF444433" : "1px solid #F59E0B33",
          }}
        >
          <AlertTriangle className="w-3 h-3" />
          {totalAlerts} alerta{totalAlerts !== 1 ? "s" : ""}
          {criticalAlerts > 0 && ` (${criticalAlerts} crítico${criticalAlerts !== 1 ? "s" : ""})`}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
          <span className="text-[10px]" style={{ color: "#4B5563" }}>atualizando</span>
        </div>
      )}
    </div>
  );
}
