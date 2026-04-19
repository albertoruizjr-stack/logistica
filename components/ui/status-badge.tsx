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
  { label: string; bg: string; text: string; icon: LucideIcon }
> = {
  URGENT:            { label: "Urgente",               bg: "bg-orange-100", text: "text-orange-700", icon: Zap },
  PENDING:           { label: "Pendente",              bg: "bg-amber-100",  text: "text-amber-700",  icon: Clock },
  AWAITING_ITEMS:    { label: "Aguard. Itens",         bg: "bg-amber-100",  text: "text-amber-700",  icon: Package },
  AWAITING_TRANSFER: { label: "Aguard. Transferência", bg: "bg-amber-100",  text: "text-amber-700",  icon: ArrowLeftRight },
  READY:             { label: "Pronto",                bg: "bg-blue-100",   text: "text-blue-700",   icon: CheckCircle },
  DISPATCHED:        { label: "Despachado",            bg: "bg-purple-100", text: "text-purple-700", icon: Truck },
  IN_TRANSIT:        { label: "Em Trânsito",           bg: "bg-cyan-100",   text: "text-cyan-700",   icon: Navigation },
  DELIVERED:         { label: "Entregue",              bg: "bg-green-100",  text: "text-green-700",  icon: CheckCircle2 },
  CANCELLED:         { label: "Cancelado",             bg: "bg-red-100",    text: "text-red-700",    icon: XCircle },
  APPROVED:          { label: "Aprovada",              bg: "bg-blue-100",   text: "text-blue-700",   icon: ThumbsUp },
  PREPARING:         { label: "Em Preparação",         bg: "bg-purple-100", text: "text-purple-700", icon: Package2 },
  RECEIVED:          { label: "Recebida",              bg: "bg-green-100",  text: "text-green-700",  icon: PackageCheck },
};

export function StatusBadge({
  status,
  size = "sm",
  showIcon = false,
  icon: CustomIcon,
}: StatusBadgeProps) {
  const config = STATUS_MAP[status];
  const Icon = CustomIcon ?? config.icon;
  const sizeClasses =
    size === "sm" ? "text-xs px-2 py-0.5" : "text-xs px-2.5 py-1";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium",
        config.bg,
        config.text,
        sizeClasses
      )}
    >
      {(showIcon || CustomIcon) && <Icon className="w-3 h-3" />}
      {config.label}
    </span>
  );
}
