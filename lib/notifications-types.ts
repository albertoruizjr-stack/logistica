// ──────────────────────────────────────────────
// TIPOS DE NOTIFICAÇÃO — mapa central
// Define ícone, cor e descrição padrão pra cada tipo.
// Usado pelo service e pela UI (sininho).
// ──────────────────────────────────────────────

export type NotificationType =
  // Transferência (fluxo de itens entre lojas)
  | "TRANSFER_CREATED"           // 1
  | "TRANSFER_CONFIRMED"         // 2
  | "TRANSFER_READY_DISPATCH"    // 3
  | "TRANSFER_DISPATCHED"        // 4
  | "TRANSFER_RECEIVED"          // 6
  // Rota / motorista
  | "ROUTE_STOP_ADDED"           // 5
  // Solicitação (pedido do cliente final)
  | "ORDER_SEPARATED"            // 7
  | "ORDER_DISPATCHED"           // 8
  | "ORDER_DELIVERED"            // 9
  // Sugestões adicionais (#10–14)
  | "DELIVERY_OCCURRENCE"        // 10 ocorrência na entrega (avaria, ausente, etc.)
  | "SLA_BREACH"                 // 11 SLA estourado
  | "ERP_ALERT"                  // 12 alerta do watcher (PD alterado/cancelado)
  | "REQUEST_CANCELLED"          // 13 solicitação cancelada
  | "EXCEPTION_APPROVAL_NEEDED"  // 14 vendedor pediu exceção operacional
  | "TRANSFER_CANCELLED";        // 15 loja origem cancelou a transferência (crítico — refazer)

interface NotificationTypeMeta {
  /** Ícone (nome de lucide-react) */
  icon:     string;
  /** Cor hexa para o badge / acento */
  color:    string;
  /** Background suave para o card */
  bg:       string;
  /** Severidade pra ordenação visual e priorização */
  severity: "info" | "success" | "warn" | "critical";
}

export const NOTIFICATION_META: Record<NotificationType, NotificationTypeMeta> = {
  // Transferências
  TRANSFER_CREATED:        { icon: "ArrowLeftRight",  color: "#D97706", bg: "rgba(217,119,6,0.10)",  severity: "warn"     },
  TRANSFER_CONFIRMED:      { icon: "CheckCircle2",    color: "#2563EB", bg: "rgba(37,99,235,0.10)",  severity: "info"     },
  TRANSFER_READY_DISPATCH: { icon: "Truck",           color: "#2563EB", bg: "rgba(37,99,235,0.10)",  severity: "info"     },
  TRANSFER_DISPATCHED:     { icon: "Truck",           color: "#0891B2", bg: "rgba(8,145,178,0.10)",  severity: "info"     },
  TRANSFER_RECEIVED:       { icon: "PackageCheck",    color: "#16A34A", bg: "rgba(22,163,74,0.10)",  severity: "success"  },
  // Rota / motorista
  ROUTE_STOP_ADDED:        { icon: "MapPin",          color: "#0891B2", bg: "rgba(8,145,178,0.10)",  severity: "info"     },
  // Solicitação
  ORDER_SEPARATED:         { icon: "Package",         color: "#2563EB", bg: "rgba(37,99,235,0.10)",  severity: "info"     },
  ORDER_DISPATCHED:        { icon: "Truck",           color: "#0891B2", bg: "rgba(8,145,178,0.10)",  severity: "info"     },
  ORDER_DELIVERED:         { icon: "CheckCircle2",    color: "#16A34A", bg: "rgba(22,163,74,0.10)",  severity: "success"  },
  // Extras
  DELIVERY_OCCURRENCE:     { icon: "AlertTriangle",   color: "#DC2626", bg: "rgba(220,38,38,0.10)",  severity: "critical" },
  SLA_BREACH:              { icon: "Clock",           color: "#DC2626", bg: "rgba(220,38,38,0.10)",  severity: "critical" },
  ERP_ALERT:               { icon: "AlertTriangle",   color: "#D97706", bg: "rgba(217,119,6,0.10)",  severity: "warn"     },
  REQUEST_CANCELLED:       { icon: "XCircle",         color: "#737373", bg: "rgba(115,115,115,0.10)", severity: "info"    },
  EXCEPTION_APPROVAL_NEEDED:{ icon: "AlertTriangle",  color: "#D97706", bg: "rgba(217,119,6,0.10)",  severity: "warn"     },
  TRANSFER_CANCELLED:      { icon: "XCircle",         color: "#DC2626", bg: "rgba(220,38,38,0.10)",  severity: "critical" },
};
