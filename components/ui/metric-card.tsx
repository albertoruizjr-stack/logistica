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
  default: { border: "border-l-slate-300",  iconColor: "text-slate-400"  },
  urgent:  { border: "border-l-orange-600", iconColor: "text-orange-600" },
  warning: { border: "border-l-amber-500",  iconColor: "text-amber-500"  },
  success: { border: "border-l-green-500",  iconColor: "text-green-500"  },
  danger:  { border: "border-l-red-500",    iconColor: "text-red-500"    },
} as const;

export function MetricCard({
  label,
  value,
  icon: Icon,
  variant = "default",
  trend,
}: MetricCardProps) {
  const { border, iconColor } = variantConfig[variant];

  return (
    <div
      className={cn(
        "bg-white rounded-lg border border-slate-200 shadow-sm border-l-4 p-4",
        border
      )}
    >
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
          {label}
        </p>
        <Icon className={cn("w-4 h-4 flex-shrink-0", iconColor)} />
      </div>
      <p className="text-2xl font-bold text-slate-900 mt-2">{value}</p>
      {trend && (
        <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
          {trend.value > 0 ? (
            <TrendingUp className="w-3 h-3 text-green-500" />
          ) : (
            <TrendingDown className="w-3 h-3 text-red-500" />
          )}
          {Math.abs(trend.value)} {trend.label}
        </p>
      )}
    </div>
  );
}
