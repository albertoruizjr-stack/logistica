import { cn } from "@/lib/utils";
import {
  Zap, Clock, Package, ArrowLeftRight, CheckCircle, Truck,
  Navigation, CheckCircle2, XCircle, ThumbsUp, Package2, PackageCheck,
  type LucideIcon,
} from "lucide-react";

export type StatusVariant =
  | "PENDING" | "AWAITING_ITEMS" | "AWAITING_TRANSFER"
  | "READY" | "DISPATCHED" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED"
  | "URGENT" | "APPROVED" | "PREPARING" | "RECEIVED";

interface StatusBadgeProps {
  status: StatusVariant;
  size?: "sm" | "md";
  showIcon?: boolean;
  icon?: LucideIcon;
}

const STATUS_MAP: Record<
  StatusVariant,
  { label: string; bg: string; text: string; dot: string; icon: LucideIcon }
> = {
  URGENT:            { label: "Urgente",               bg: "rgba(249,115,22,0.10)", text: "#C2410C", dot: "#F97316",  icon: Zap },
  PENDING:           { label: "Pendente",              bg: "rgba(217,119,6,0.10)",  text: "#92400E", dot: "#D97706",  icon: Clock },
  AWAITING_ITEMS:    { label: "Aguard. Itens",         bg: "rgba(217,119,6,0.10)",  text: "#92400E", dot: "#D97706",  icon: Package },
  AWAITING_TRANSFER: { label: "Aguard. Transferência", bg: "rgba(217,119,6,0.10)",  text: "#92400E", dot: "#D97706",  icon: ArrowLeftRight },
  READY:             { label: "Pronto",                bg: "rgba(59,130,246,0.10)", text: "#1D4ED8", dot: "#3B82F6",  icon: CheckCircle },
  DISPATCHED:        { label: "Despachado",            bg: "rgba(124,58,237,0.10)", text: "#6D28D9", dot: "#7C3AED",  icon: Truck },
  IN_TRANSIT:        { label: "Em Trânsito",           bg: "rgba(8,145,178,0.10)",  text: "#0E7490", dot: "#0891B2",  icon: Navigation },
  DELIVERED:         { label: "Entregue",              bg: "rgba(22,163,74,0.10)",  text: "#15803D", dot: "#16A34A",  icon: CheckCircle2 },
  CANCELLED:         { label: "Cancelado",             bg: "rgba(220,38,38,0.10)",  text: "#B91C1C", dot: "#DC2626",  icon: XCircle },
  APPROVED:          { label: "Aprovada",              bg: "rgba(59,130,246,0.10)", text: "#1D4ED8", dot: "#3B82F6",  icon: ThumbsUp },
  PREPARING:         { label: "Em Preparação",         bg: "rgba(124,58,237,0.10)", text: "#6D28D9", dot: "#7C3AED",  icon: Package2 },
  RECEIVED:          { label: "Recebida",              bg: "rgba(22,163,74,0.10)",  text: "#15803D", dot: "#16A34A",  icon: PackageCheck },
};

export function StatusBadge({
  status,
  size = "sm",
  showIcon = false,
  icon: CustomIcon,
}: StatusBadgeProps) {
  const config = STATUS_MAP[status];
  const Icon = CustomIcon ?? config.icon;
  const sizeClasses = size === "sm" ? "text-[11px] px-2 py-0.5" : "text-[12px] px-2.5 py-1";

  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full font-semibold", sizeClasses)}
      style={{ backgroundColor: config.bg, color: config.text }}
    >
      {(showIcon || CustomIcon) ? (
        <Icon className="w-3 h-3 flex-shrink-0" />
      ) : (
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: config.dot }}
        />
      )}
      {config.label}
    </span>
  );
}
