import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, type LucideIcon } from "lucide-react";

interface MetricCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  variant?: "default" | "urgent" | "warning" | "success" | "danger";
  trend?: { value: number; label: string };
}

const variantConfig = {
  default: {
    iconBg:    "#F4F4F4",
    iconColor: "#737373",
    indicator: "#D4D4D4",
  },
  urgent: {
    iconBg:    "rgba(249,115,22,0.10)",
    iconColor: "#EA580C",
    indicator: "#F97316",
  },
  warning: {
    iconBg:    "rgba(217,119,6,0.10)",
    iconColor: "#B45309",
    indicator: "#D97706",
  },
  success: {
    iconBg:    "rgba(22,163,74,0.10)",
    iconColor: "#15803D",
    indicator: "#16A34A",
  },
  danger: {
    iconBg:    "rgba(220,38,38,0.10)",
    iconColor: "#B91C1C",
    indicator: "#DC2626",
  },
} as const;

export function MetricCard({
  label,
  value,
  icon: Icon,
  variant = "default",
  trend,
}: MetricCardProps) {
  const config = variantConfig[variant];

  return (
    <div
      className="bg-white rounded-xl p-5 transition-shadow hover:shadow-md"
      style={{ border: "1px solid var(--color-border)" }}
    >
      <div className="flex items-start justify-between mb-4">
        <p
          className="text-[10px] font-semibold uppercase"
          style={{
            letterSpacing: "0.12em",
            color: "#A3A3A3",
            fontFamily: "var(--font-body)",
          }}
        >
          {label}
        </p>
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: config.iconBg }}
        >
          <Icon className="w-4 h-4" style={{ color: config.iconColor }} />
        </div>
      </div>

      <p
        className="text-[30px] font-bold leading-none tabular-nums"
        style={{
          fontFamily: "var(--font-display)",
          color: "var(--color-body-text)",
        }}
      >
        {value}
      </p>

      {trend ? (
        <p
          className="text-[11px] mt-2.5 flex items-center gap-1"
          style={{ color: "#A3A3A3" }}
        >
          {trend.value > 0 ? (
            <TrendingUp className="w-3 h-3" style={{ color: "#16A34A" }} />
          ) : (
            <TrendingDown className="w-3 h-3" style={{ color: "#DC2626" }} />
          )}
          {Math.abs(trend.value)} {trend.label}
        </p>
      ) : (
        <div
          className="mt-4 h-[3px] w-8 rounded-full"
          style={{ backgroundColor: config.indicator }}
        />
      )}
    </div>
  );
}
