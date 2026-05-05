// types/torre.ts
import type {
  AbcClassificationValue,
  AlertType,
  AlertSeverity,
  AlertStatus,
  AlertSlaStatus,
  AlertActionType,
  AlertEscalationLevel,
  AlertResolutionType,
  DataConfidence,
} from "@prisma/client";

// ──────────────────────────────────────────────
// DASHBOARD
// ──────────────────────────────────────────────

export type StoreHealthColor = "GREEN" | "YELLOW" | "RED";

export interface TowerStoreHealth {
  storeId: string;
  storeCode: string;
  storeName: string;
  health: StoreHealthColor;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
}

export interface TowerDashboardStats {
  critical: number;
  warning: number;
  info: number;
  overdueCount: number;
  stores: TowerStoreHealth[];
  lastSyncAt: Date | null;
}

// ──────────────────────────────────────────────
// AUDIT ENGINE — ocorrências (output da função pura)
// ──────────────────────────────────────────────

export type OwnerRole =
  | "COMPRAS"
  | "LOGISTICA"
  | "LIDER_ORIGEM"
  | "LIDER_DESTINO"
  | "ADMIN";

export interface AlertOccurrenceItem {
  productCode: string;
  productName: string;
  abcClassification?: AbcClassificationValue;
  metricValue: number;
  metricUnit: string;
  suggestedSourceStoreId?: string;
  suggestedSourceQty?: number;
  detail?: Record<string, unknown>;
}

export interface AlertOccurrence {
  ruleId: string;
  type: AlertType;
  severity: AlertSeverity;
  storeId: string;
  actionType: AlertActionType;
  slaMinutes: number;
  ownerRole: OwnerRole;
  groupKey: string;
  dataConfidence: DataConfidence;
  items: AlertOccurrenceItem[];
}

// ──────────────────────────────────────────────
// ALERT ENGINE — alertas com timeRemaining calculado
// ──────────────────────────────────────────────

export interface AlertWithTimeRemaining {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  storeId: string;
  storeCode: string;
  storeName: string;
  ownerName: string;
  actionType: AlertActionType;
  slaDeadline: Date;
  slaStatus: AlertSlaStatus;
  timeRemaining: number; // minutos; negativo = vencido
  status: AlertStatus;
  escalationLevel: AlertEscalationLevel | null;
  dataConfidence: DataConfidence;
  itemCount: number;
  items: AlertItemSummary[];
  createdAt: Date;
}

export interface AlertItemSummary {
  productCode: string;
  productName: string;
  abcClassification?: AbcClassificationValue;
  metricValue: number;
  metricUnit: string;
}

// ──────────────────────────────────────────────
// INPUTS DE API
// ──────────────────────────────────────────────

export interface AbcUpsertInput {
  storeId: string;
  productCode: string;
  productName: string;
  classification: AbcClassificationValue;
  minStock?: number;
  maxStock?: number;
  coverageDaysTarget?: number;
  avgDailySales?: number;
  isManualOverride?: boolean;
}

export interface AlertResolveInput {
  status: "RESOLVED" | "CANCELLED" | "IN_PROGRESS" | "SNOOZED";
  resolutionType?: AlertResolutionType;
  resolutionNotes?: string;
  snoozedUntil?: string; // ISO date string
  resolvedById: string;
}

// ──────────────────────────────────────────────
// COBERTURA
// ──────────────────────────────────────────────

export interface CoverageResult {
  storeId: string;
  productCode: string;
  qtdDisponivel: number;
  avgDailySales: number | null;
  coverageDaysActual: number | null;
  coverageDaysTarget: number;
  minStock: number | null;
  aboveMinStock: boolean;
}
