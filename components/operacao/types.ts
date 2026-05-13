import type { DeliveryRequestStatus, DeliveryType, DispatchWindow } from "@prisma/client";

// ── Enums de prioridade visual ───────────────────────────────────────────────

export type PriorityLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

// ── Estrutura de um card no workqueue ────────────────────────────────────────

export interface OperationalCard {
  id: string;
  // Identificação
  orderNumber: string | null;
  invoiceNumber: string | null;
  customerName: string;
  deliveryAddress: string | null;
  // Status e tipo
  status: DeliveryRequestStatus;
  deliveryType: DeliveryType;
  slaType: string;
  dispatchWindow: DispatchWindow | null;
  // Loja e vendedor
  storeCode: string;
  storeName: string;
  sellerName: string;
  // Separação
  separatedBy: string | null;
  separatedAt: string | null; // ISO string
  occurrenceType: string | null;
  // Transferências
  pendingTransfers: number;
  // Timestamps
  createdAt: string;
  updatedAt: string;
  // Calculados pelo serviço
  priorityScore: number;
  priority: PriorityLevel;
  minutesInStatus: number;
  // Alertas
  isStuck:         boolean;
  stuckMinutes:    number; // minutos além do threshold (0 se não stuck)
  slaBreached:     boolean;
  // Lock operacional
  lockedBy:       string | null;
  lockedByName:   string | null;
  lockedAt:       string | null; // ISO string
  lockExpiresAt:  string | null; // ISO string
  lockReason:     string | null;
  lockMinutesLeft: number | null;
}

// ── Coluna do workqueue ──────────────────────────────────────────────────────

export interface OperationalColumn {
  id: string;
  label: string;
  statuses: DeliveryRequestStatus[];
  cards: OperationalCard[];
  count: number;
}

// ── Métricas da fila ─────────────────────────────────────────────────────────

export interface QueueMetrics {
  total: number;
  urgent: number;
  express: number;
  ocorrencias: number;
  pendingTransfers: number;
  readyForDispatch: number;
  stuckCards: number;
  slaBreaches: number;
  alerts: OperationalAlert[];
}

// ── Payload da API ───────────────────────────────────────────────────────────

export interface OperationalQueuePayload {
  columns: OperationalColumn[];
  metrics: QueueMetrics;
  fetchedAt: string;
}

// ── Ação operacional ─────────────────────────────────────────────────────────

export interface OperationalAction {
  requestId: string;
  toStatus: DeliveryRequestStatus;
  // Gates opcionais
  separatedBy?: string;
  routeId?: string;
  occurrenceType?: string;
  occurrenceNotes?: string;
  forceCancel?: boolean;
  cancellationReason?: string;
  reason?: string;
}

// ── Definição de ação por status ─────────────────────────────────────────────

export interface ActionDefinition {
  toStatus: DeliveryRequestStatus;
  label: string;
  variant: "primary" | "danger" | "warning" | "ghost";
  requiresConfirm?: boolean;
  fields?: ActionField[];
}

// ── Alerta operacional ───────────────────────────────────────────────────────

export type AlertType = "STUCK" | "SLA_BREACH" | "CLAIM_EXPIRING" | "QUEUE_OVERLOAD";
export type AlertSeverity = "CRITICAL" | "WARNING" | "INFO";

export interface OperationalAlert {
  key:       string;           // unique (requestId + type)
  type:      AlertType;
  severity:  AlertSeverity;
  requestId?: string;
  message:   string;
  minutesOverdue?: number;
}

// ── Filtros da workqueue ─────────────────────────────────────────────────────

export type FilterMode = "all" | "mine" | "free" | "locked";

export interface ActionField {
  key: keyof OperationalAction;
  label: string;
  type: "text" | "select" | "textarea";
  required?: boolean;
  options?: { value: string; label: string }[];
  minLength?: number;
  placeholder?: string;
}
