import { cn } from "@/lib/utils";
import {
  Info,
  AlertTriangle,
  AlertCircle,
  Zap,
  X,
  type LucideIcon,
} from "lucide-react";

interface AlertBannerProps {
  variant: "info" | "warning" | "danger" | "urgent";
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
}

const variantConfig: Record<
  string,
  { bg: string; border: string; text: string; icon: LucideIcon }
> = {
  info:    { bg: "bg-slate-50",  border: "border-slate-200",  text: "text-slate-700",  icon: Info },
  warning: { bg: "bg-amber-50",  border: "border-amber-200",  text: "text-amber-800",  icon: AlertTriangle },
  danger:  { bg: "bg-red-50",    border: "border-red-200",    text: "text-red-800",    icon: AlertCircle },
  urgent:  { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-800", icon: Zap },
};

export function AlertBanner({
  variant,
  title,
  description,
  action,
  onDismiss,
}: AlertBannerProps) {
  const { bg, border, text, icon: Icon } = variantConfig[variant];

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 mb-4",
        bg,
        border
      )}
    >
      <Icon className={cn("w-4 h-4 mt-0.5 flex-shrink-0", text)} />
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm font-medium", text)}>{title}</p>
        {description && (
          <p className={cn("text-xs mt-0.5 opacity-80", text)}>{description}</p>
        )}
      </div>
      {(action || onDismiss) && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {action && (
            <button
              onClick={action.onClick}
              className={cn("text-xs font-medium underline underline-offset-2", text)}
            >
              {action.label}
            </button>
          )}
          {onDismiss && (
            <button
              onClick={onDismiss}
              className={cn("hover:opacity-70 transition-opacity", text)}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
