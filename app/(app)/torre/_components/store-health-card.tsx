"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle } from "lucide-react";
import type { StoreHealthColor } from "@/types/torre";

interface StoreHealthCardProps {
  storeId: string;
  storeCode: string;
  storeName: string;
  health: StoreHealthColor;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  itemCount: number;
  oldestAlertAt: string | null; // ISO string (serializado do Server Component)
}

const healthConfig: Record<StoreHealthColor, {
  dot: string;
  bg: string;
  border: string;
  label: string;
  labelBg: string;
  labelColor: string;
}> = {
  RED: {
    dot: "#DC2626",
    bg: "rgba(220,38,38,0.04)",
    border: "rgba(220,38,38,0.20)",
    label: "Crítico",
    labelBg: "#FEF2F2",
    labelColor: "#B91C1C",
  },
  YELLOW: {
    dot: "#D97706",
    bg: "rgba(217,119,6,0.04)",
    border: "rgba(217,119,6,0.20)",
    label: "Atenção",
    labelBg: "#FFFBEB",
    labelColor: "#92400E",
  },
  GREEN: {
    dot: "#16A34A",
    bg: "transparent",
    border: "var(--color-border)",
    label: "Normal",
    labelBg: "#F0FDF4",
    labelColor: "#15803D",
  },
};

function formatAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function StoreHealthCard({
  storeId,
  storeCode,
  storeName,
  health,
  criticalCount,
  warningCount,
  infoCount,
  itemCount,
  oldestAlertAt,
}: StoreHealthCardProps) {
  const router = useRouter();
  const cfg = healthConfig[health];
  const totalAlerts = criticalCount + warningCount + infoCount;
  const hasAlerts = totalAlerts > 0;

  const displayName = storeName
    .replace(/^Loja\s+/i, "")
    .replace(/\s*\(\d+\)$/, "");

  return (
    <button
      onClick={() => router.push(`/torre/ruptura?storeId=${storeId}`)}
      className="w-full text-left bg-white rounded-xl px-4 py-3.5 transition-all duration-150 hover:shadow-md active:scale-[0.99] group"
      style={{
        border: `1px solid ${cfg.border}`,
        backgroundColor: cfg.bg || "white",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        {/* Indicador + loja */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative flex-shrink-0">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cfg.dot }} />
            {health !== "GREEN" && (
              <div
                className="absolute inset-0 rounded-full animate-ping opacity-40"
                style={{ backgroundColor: cfg.dot }}
              />
            )}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="text-[13px] font-bold"
                style={{ color: "var(--color-body-text)", fontFamily: "var(--font-display)" }}
              >
                {storeCode}
              </span>
              <span className="text-[12px]" style={{ color: "var(--color-muted-text)" }}>
                {displayName}
              </span>
            </div>

            {hasAlerts ? (
              <div className="flex items-center gap-2.5 mt-0.5 flex-wrap">
                {criticalCount > 0 && (
                  <span className="text-[11px] font-semibold" style={{ color: "#DC2626" }}>
                    {criticalCount} crítico{criticalCount > 1 ? "s" : ""}
                  </span>
                )}
                {warningCount > 0 && (
                  <span className="text-[11px] font-semibold" style={{ color: "#D97706" }}>
                    {warningCount} aviso{warningCount > 1 ? "s" : ""}
                  </span>
                )}
                {itemCount > 0 && (
                  <>
                    <span style={{ color: "#D4D4D4" }}>·</span>
                    <span className="text-[11px]" style={{ color: "#737373" }}>
                      {itemCount} SKU{itemCount > 1 ? "s" : ""} afetado{itemCount > 1 ? "s" : ""}
                    </span>
                  </>
                )}
                {oldestAlertAt && (
                  <>
                    <span style={{ color: "#D4D4D4" }}>·</span>
                    <span className="text-[11px]" style={{ color: "#A3A3A3" }}>
                      há {formatAge(oldestAlertAt)}
                    </span>
                  </>
                )}
              </div>
            ) : (
              <span className="text-[11px] mt-0.5 block" style={{ color: "#A3A3A3" }}>
                sem alertas abertos
              </span>
            )}
          </div>
        </div>

        {/* Badge + ícone */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: cfg.labelBg, color: cfg.labelColor }}
          >
            {cfg.label}
          </span>
          {hasAlerts ? (
            <AlertTriangle
              className="w-4 h-4 flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity"
              style={{ color: health === "RED" ? "#DC2626" : "#D97706" }}
            />
          ) : (
            <CheckCircle
              className="w-4 h-4 flex-shrink-0 opacity-30 group-hover:opacity-60 transition-opacity"
              style={{ color: "#16A34A" }}
            />
          )}
        </div>
      </div>
    </button>
  );
}
