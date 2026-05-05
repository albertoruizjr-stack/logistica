// services/torre/alert-engine.service.ts
import { prisma } from "@/lib/prisma";
import type { AlertOccurrence, OwnerRole } from "@/types/torre";
import { Prisma, type AlertType, type AlertSeverity } from "@prisma/client";

// Mapa de ruleId para AlertType do Prisma (para auto-resolução)
const RULE_TO_ALERT_TYPE: Partial<Record<string, AlertType>> = {
  R03: "ABAIXO_MINIMO",
  R10: "DIVERGENCIA_TRANSFERENCIA",
};

// Ajuste 4: Calcula slaStatus de forma centralizada
function computeSlaStatus(slaDeadline: Date, slaMinutes: number): "ON_TRACK" | "AT_RISK" | "OVERDUE" {
  const remaining = slaDeadline.getTime() - Date.now();
  if (remaining <= 0) return "OVERDUE";
  // AT_RISK quando restou menos de 50% do SLA original
  if (remaining < slaMinutes * 60 * 1000 * 0.5) return "AT_RISK";
  return "ON_TRACK";
}

// Ajuste 3: Owner fallback usa SystemConfig.TORRE_ADMIN_OWNER_ID
async function resolveAdminOwner(): Promise<string> {
  // 1. Verificar SystemConfig para owner principal configurado
  const config = await prisma.systemConfig.findUnique({
    where: { key: "TORRE_ADMIN_OWNER_ID" },
    select: { value: true },
  });

  if (config?.value) {
    // Verificar se o usuário configurado ainda existe e está ativo
    const configured = await prisma.user.findFirst({
      where: { id: config.value, active: true },
      select: { id: true },
    });
    if (configured) return configured.id;
  }

  // 2. Fallback: primeiro ADMIN ativo
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", active: true },
    select: { id: true },
  });
  if (!admin) throw new Error("Nenhum usuário ADMIN encontrado para fallback de owner");
  return admin.id;
}

// Resolve o userId a partir do papel esperado
async function resolveOwner(storeId: string, role: OwnerRole): Promise<string> {
  let user: { id: string } | null = null;

  if (role === "COMPRAS" || role === "LOGISTICA") {
    user = await prisma.user.findFirst({
      where: { role: "OPERATOR", active: true },
      select: { id: true },
    });
  } else if (role === "LIDER_ORIGEM" || role === "LIDER_DESTINO") {
    user = await prisma.user.findFirst({
      where: { role: "OPERATOR", storeId, active: true },
      select: { id: true },
    });
  } else if (role === "ADMIN") {
    user = await prisma.user.findFirst({
      where: { role: "ADMIN", active: true },
      select: { id: true },
    });
  }

  if (user) return user.id;

  // Fallback: usar resolveAdminOwner com suporte a SystemConfig
  return resolveAdminOwner();
}

async function createAlert(occurrence: AlertOccurrence): Promise<void> {
  const ownerId = await resolveOwner(occurrence.storeId, occurrence.ownerRole);
  const slaDeadline = new Date(Date.now() + occurrence.slaMinutes * 60 * 1000);

  await prisma.controlTowerAlert.create({
    data: {
      type: occurrence.type,
      severity: occurrence.severity,
      storeId: occurrence.storeId,
      ownerId,
      notifiedUserIds: [],
      actionType: occurrence.actionType,
      slaDeadline,
      // Ajuste 4: usar computeSlaStatus (na criação sempre será ON_TRACK)
      slaStatus: computeSlaStatus(slaDeadline, occurrence.slaMinutes),
      status: "PENDING",
      groupKey: occurrence.groupKey,
      dataConfidence: occurrence.dataConfidence,
      items: {
        create: occurrence.items.map((item) => ({
          productCode: item.productCode,
          productName: item.productName,
          abcClassification: item.abcClassification,
          metricValue: item.metricValue,
          metricUnit: item.metricUnit,
          suggestedSourceStoreId: item.suggestedSourceStoreId,
          suggestedSourceQty: item.suggestedSourceQty,
          detail: (item.detail ?? {}) as Prisma.InputJsonValue,
        })),
      },
    },
  });
}

// Ajuste 5: Atualizar alerta existente em vez de ignorar
async function updateAlert(
  alertId: string,
  existing: { slaDeadline: Date; severity: AlertSeverity },
  occurrence: AlertOccurrence
): Promise<void> {
  const severityOrder = { CRITICAL: 3, WARNING: 2, INFO: 1 };
  const currentOrder = severityOrder[existing.severity as keyof typeof severityOrder] ?? 1;
  const newOrder = severityOrder[occurrence.severity as keyof typeof severityOrder] ?? 1;

  await prisma.controlTowerAlert.update({
    where: { id: alertId },
    data: {
      // Só escalona severity, nunca deescalona
      severity: newOrder > currentOrder ? occurrence.severity : existing.severity,
      slaStatus: computeSlaStatus(existing.slaDeadline, occurrence.slaMinutes),
      // Items: deletar antigos e recriar
      items: {
        deleteMany: {},
        create: occurrence.items.map((item) => ({
          productCode: item.productCode,
          productName: item.productName,
          abcClassification: item.abcClassification,
          metricValue: item.metricValue,
          metricUnit: item.metricUnit,
          suggestedSourceStoreId: item.suggestedSourceStoreId,
          suggestedSourceQty: item.suggestedSourceQty,
          detail: (item.detail ?? {}) as Prisma.InputJsonValue,
        })),
      },
    },
  });
}

async function autoResolveStale(
  storeId: string,
  activeGroupKeys: string[],
  ruleIds: string[]
): Promise<void> {
  const alertTypes = ruleIds
    .map((id) => RULE_TO_ALERT_TYPE[id])
    .filter((t): t is AlertType => t != null);

  if (alertTypes.length === 0) return;

  await prisma.controlTowerAlert.updateMany({
    where: {
      storeId,
      status: { in: ["PENDING", "IN_PROGRESS"] },
      type: { in: alertTypes },
      groupKey: { notIn: activeGroupKeys },
    },
    data: {
      status: "RESOLVED",
      // Ajuste 2: usar AUTO_RESOLVED em vez de MANUAL_FIX
      resolutionType: "AUTO_RESOLVED",
      resolutionNotes: `Condição normalizada automaticamente. Regra ${ruleIds.join("/")} não disparou no último sync. Nenhuma ação manual necessária.`,
      resolvedAt: new Date(),
    },
  });
}

export async function processOccurrences(
  occurrences: AlertOccurrence[],
  autoResolveContext?: { storeId: string; ruleIds: string[] }
): Promise<void> {
  // 1. Criar ou atualizar alertas
  for (const occ of occurrences) {
    // Ajuste 5: buscar também severity e slaDeadline para atualização
    const existing = await prisma.controlTowerAlert.findFirst({
      where: {
        groupKey: occ.groupKey,
        status: { in: ["PENDING", "IN_PROGRESS", "NEEDS_MANUAL_CONFIRMATION"] },
      },
      select: { id: true, severity: true, slaDeadline: true },
    });

    if (!existing) {
      await createAlert(occ);
    } else {
      await updateAlert(existing.id, { slaDeadline: existing.slaDeadline, severity: existing.severity }, occ);
    }
  }

  // 2. Auto-resolver alertas cuja condição desapareceu
  if (autoResolveContext) {
    const activeGroupKeys = occurrences
      .filter((o) => o.storeId === autoResolveContext.storeId)
      .map((o) => o.groupKey);

    await autoResolveStale(
      autoResolveContext.storeId,
      activeGroupKeys,
      autoResolveContext.ruleIds
    );
  }
}

// ──────────────────────────────────────────────
// ALERTAS DE VÍNCULO NF
// ──────────────────────────────────────────────

type NfLinkErrorType = "PARTIAL_BILLING" | "MULTIPLE_NF" | "PD_CANCELLED_IN_CITEL" | "PD_NOT_FOUND";

const NF_LINK_ACTIONS: Record<NfLinkErrorType, string> = {
  PARTIAL_BILLING:        "Verificar no Autcom se todos os itens do PD foram faturados. Sistema tentará novamente a cada 30 minutos.",
  MULTIPLE_NF:            "PD gerou mais de uma NF. Acessar Solicitações > Vincular NF para resolução manual.",
  PD_CANCELLED_IN_CITEL:  "PD cancelado no Autcom. Verificar com a loja/vendedor se houve novo pedido ou cancelamento legítimo.",
  PD_NOT_FOUND:           "PD não encontrado no Autcom após múltiplas tentativas. Confirmar número do pedido com o vendedor ou aguardar sincronização do ERP.",
};

export async function upsertNfLinkAlert(params: {
  requestId:    string;
  storeId:      string;
  orderNumber:  string;
  storeCode:    string;
  errorType:    NfLinkErrorType;
  deliveryType: string;
  scheduledFor: Date | null;
  attemptCount: number;
}): Promise<void> {
  const isUrgentOrToday =
    params.deliveryType === "URGENT" ||
    (params.scheduledFor != null &&
      params.scheduledFor.toDateString() === new Date().toDateString());

  const severity: AlertSeverity =
    params.errorType === "MULTIPLE_NF" || params.errorType === "PD_CANCELLED_IN_CITEL"
      ? "CRITICAL"
      : (params.errorType === "PARTIAL_BILLING" || params.errorType === "PD_NOT_FOUND") && isUrgentOrToday
      ? "CRITICAL"
      : "WARNING";

  const slaMinutes = severity === "CRITICAL" ? 60 : 240;

  await processOccurrences([{
    ruleId:         `NF_LINK_${params.errorType}`,
    type:           "ITEM_CRITICO_SEM_FATURAR",
    severity,
    storeId:        params.storeId,
    actionType:     "RESOLVE_DIVERGENCE",
    slaMinutes,
    ownerRole:      "LIDER_DESTINO",
    groupKey:       `NF_LINK_${params.requestId}`,
    dataConfidence: "HIGH",
    items: [{
      productCode:  params.orderNumber,
      productName:  `PD ${params.orderNumber} · Loja ${params.storeCode}`,
      metricValue:  params.attemptCount,
      metricUnit:   "tentativas",
      detail: {
        errorType:   params.errorType,
        orderNumber: params.orderNumber,
        storeCode:   params.storeCode,
        action:      NF_LINK_ACTIONS[params.errorType],
        autoRetry:   params.errorType === "PARTIAL_BILLING",
      },
    }],
  }]);
}

export async function resolveNfLinkAlert(requestId: string): Promise<void> {
  await prisma.controlTowerAlert.updateMany({
    where: {
      groupKey: `NF_LINK_${requestId}`,
      status:   { in: ["PENDING", "IN_PROGRESS"] },
    },
    data: {
      status:          "RESOLVED",
      resolutionType:  "AUTO_RESOLVED",
      resolutionNotes: "NF vinculada automaticamente pelo sistema.",
      resolvedAt:      new Date(),
    },
  });
}
