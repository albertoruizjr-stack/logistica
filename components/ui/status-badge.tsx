import { cn } from "@/lib/utils";
import {
  Zap, Clock, Package, ArrowLeftRight, CheckCircle, Truck,
  Navigation, CheckCircle2, XCircle, ThumbsUp, Package2, PackageCheck,
  HelpCircle, FileText, FileCheck, Link2, Map, Route, AlertTriangle,
  type LucideIcon,
} from "lucide-react";

export type StatusVariant =
  | "PENDING" | "AWAITING_ITEMS" | "AWAITING_TRANSFER"
  | "SEPARADO" | "AGUARDANDO_NF" | "NF_EMITIDA" | "NF_VINCULADA"
  | "PRONTO_ROTEIRIZACAO" | "ROTEIRIZADO" | "OCORRENCIA"
  | "READY" | "DISPATCHED" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED"
  | "URGENT" | "APPROVED" | "PREPARING" | "PREPARED" | "RECEIVED"
  // fluxo de 5 etapas (Transfer)
  | "AWAITING_APPROVAL" | "READY_TO_COLLECT";

interface StatusBadgeProps {
  status: StatusVariant | string;
  size?: "sm" | "md";
  showIcon?: boolean;
  icon?: LucideIcon;
}

const STATUS_MAP: Record<
  StatusVariant,
  { label: string; bg: string; text: string; dot: string; icon: LucideIcon }
> = {
  URGENT:              { label: "Urgente",               bg: "rgba(249,115,22,0.10)", text: "#C2410C", dot: "#F97316",  icon: Zap },
  PENDING:             { label: "Pendente",              bg: "rgba(217,119,6,0.10)",  text: "#92400E", dot: "#D97706",  icon: Clock },
  AWAITING_ITEMS:      { label: "Aguard. Itens",         bg: "rgba(217,119,6,0.10)",  text: "#92400E", dot: "#D97706",  icon: Package },
  AWAITING_TRANSFER:   { label: "Aguard. Transferência", bg: "rgba(217,119,6,0.10)",  text: "#92400E", dot: "#D97706",  icon: ArrowLeftRight },
  SEPARADO:            { label: "Separado",              bg: "rgba(99,102,241,0.10)", text: "#4338CA", dot: "#6366F1",  icon: PackageCheck },
  AGUARDANDO_NF:       { label: "Aguard. NF",            bg: "rgba(217,119,6,0.10)",  text: "#92400E", dot: "#D97706",  icon: FileText },
  NF_EMITIDA:          { label: "NF Emitida",            bg: "rgba(59,130,246,0.10)", text: "#1D4ED8", dot: "#3B82F6",  icon: FileCheck },
  NF_VINCULADA:        { label: "NF Vinculada",          bg: "rgba(59,130,246,0.10)", text: "#1D4ED8", dot: "#3B82F6",  icon: Link2 },
  PRONTO_ROTEIRIZACAO: { label: "Pronto p/ Rota",        bg: "rgba(8,145,178,0.10)",  text: "#0E7490", dot: "#0891B2",  icon: Map },
  ROTEIRIZADO:         { label: "Roteirizado",           bg: "rgba(8,145,178,0.10)",  text: "#0E7490", dot: "#0891B2",  icon: Route },
  OCORRENCIA:          { label: "Ocorrência",            bg: "rgba(220,38,38,0.10)",  text: "#B91C1C", dot: "#DC2626",  icon: AlertTriangle },
  READY:               { label: "Pronto",                bg: "rgba(59,130,246,0.10)", text: "#1D4ED8", dot: "#3B82F6",  icon: CheckCircle },
  DISPATCHED:          { label: "Despachado",            bg: "rgba(124,58,237,0.10)", text: "#6D28D9", dot: "#7C3AED",  icon: Truck },
  IN_TRANSIT:          { label: "Em Trânsito",           bg: "rgba(8,145,178,0.10)",  text: "#0E7490", dot: "#0891B2",  icon: Navigation },
  DELIVERED:           { label: "Entregue",              bg: "rgba(22,163,74,0.10)",  text: "#15803D", dot: "#16A34A",  icon: CheckCircle2 },
  CANCELLED:           { label: "Cancelado",             bg: "rgba(220,38,38,0.10)",  text: "#B91C1C", dot: "#DC2626",  icon: XCircle },
  APPROVED:            { label: "Aprovada",              bg: "rgba(59,130,246,0.10)", text: "#1D4ED8", dot: "#3B82F6",  icon: ThumbsUp },
  PREPARING:           { label: "Em Preparação",         bg: "rgba(124,58,237,0.10)", text: "#6D28D9", dot: "#7C3AED",  icon: Package2 },
  PREPARED:            { label: "Separada",              bg: "rgba(20,184,166,0.10)", text: "#0F766E", dot: "#14B8A6",  icon: PackageCheck },
  RECEIVED:            { label: "Recebida",              bg: "rgba(22,163,74,0.10)",  text: "#15803D", dot: "#16A34A",  icon: PackageCheck },
  // fluxo de 5 etapas (Transfer)
  AWAITING_APPROVAL:   { label: "Aguard. aprovação",     bg: "rgba(217,119,6,0.10)",  text: "#92400E", dot: "#D97706",  icon: FileText },
  READY_TO_COLLECT:    { label: "Pronta p/ coleta",      bg: "rgba(20,184,166,0.10)", text: "#0F766E", dot: "#14B8A6",  icon: PackageCheck },
};

// Fallback defensivo pra status desconhecidos — em vez de quebrar a página inteira,
// renderiza um badge cinza com o nome cru. Ajuda diagnóstico sem travar o dashboard.
const FALLBACK_CONFIG = {
  label: "—",
  bg:    "rgba(115,115,115,0.10)",
  text:  "#525252",
  dot:   "#737373",
  icon:  HelpCircle as LucideIcon,
};

export function StatusBadge({
  status,
  size = "sm",
  showIcon = false,
  icon: CustomIcon,
}: StatusBadgeProps) {
  const config = STATUS_MAP[status as StatusVariant] ?? { ...FALLBACK_CONFIG, label: String(status ?? "—") };
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
