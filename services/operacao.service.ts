// ──────────────────────────────────────────────
// SERVIÇO DE OPERAÇÃO — Workqueue Logístico
//
// Agrega todas as solicitações ativas em colunas
// operacionais com score de prioridade calculado.
// ──────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { DeliveryRequestStatus, Prisma } from "@prisma/client";
import { STUCK_THRESHOLD_MIN } from "./analytics.service";
import type {
  OperationalCard,
  OperationalColumn,
  OperationalQueuePayload,
  OperationalAlert,
  PriorityLevel,
  QueueMetrics,
} from "@/components/operacao/types";

const SLA_SECONDS: Record<string, number> = {
  STANDARD:  36 * 3600,
  URGENT:     8 * 3600,
  EXPRESS:    4 * 3600,
  SCHEDULED: 48 * 3600,
};

// ── Definição das colunas ────────────────────────────────────────────────────

/**
 * Mapa de quais columns cada role deve enxergar na Fila Operacional.
 * Roles ausentes do mapa = veem TODAS as colunas (fallback admin).
 *
 * - STOCK_OPERATOR (Jhow): só estoque/separação no fluxo dele.
 * - LOGISTICS_OPERATOR (Jane): supervisora — vê o pipeline INTEIRO.
 * - ADMIN, OPERATOR (legado): tudo.
 */
export const COLUMNS_BY_ROLE: Record<string, string[]> = {
  STOCK_OPERATOR: ["pendente", "transferencia", "separacao"],
  STORE_LEADER:   ["pendente", "transferencia", "separacao", "fiscal"],
};

const COLUMNS: { id: string; label: string; statuses: DeliveryRequestStatus[] }[] = [
  {
    id:       "pendente",
    label:    "Pendente",
    statuses: [DeliveryRequestStatus.PENDING, DeliveryRequestStatus.AWAITING_ITEMS],
  },
  {
    id:       "transferencia",
    label:    "Transferência",
    statuses: [DeliveryRequestStatus.AWAITING_TRANSFER],
  },
  {
    id:       "separacao",
    label:    "Separação",
    statuses: [DeliveryRequestStatus.SEPARADO],
  },
  {
    id:       "fiscal",
    label:    "Fiscal / NF",
    statuses: [
      DeliveryRequestStatus.AGUARDANDO_NF,
DeliveryRequestStatus.NF_VINCULADA,
    ],
  },
  {
    id:       "roteirizacao",
    label:    "Roteirização",
    statuses: [
      DeliveryRequestStatus.PRONTO_ROTEIRIZACAO,
      DeliveryRequestStatus.ROTEIRIZADO,
    ],
  },
  {
    id:       "despacho",
    label:    "Despacho",
    statuses: [DeliveryRequestStatus.DISPATCHED],
  },
  {
    id:       "transito",
    label:    "Em Trânsito",
    statuses: [DeliveryRequestStatus.IN_TRANSIT],
  },
  {
    id:       "entregue",
    label:    "Entregue",
    statuses: [DeliveryRequestStatus.DELIVERED],
  },
  {
    id:       "ocorrencia",
    label:    "Ocorrências",
    statuses: [DeliveryRequestStatus.OCORRENCIA],
  },
  {
    id:       "cancelados",
    label:    "Cancelados",
    statuses: [DeliveryRequestStatus.CANCELLED],
  },
];

// Janela de recência da coluna "Cancelados": só mostra cancelamentos recentes
// para não carregar todo o histórico de cancelados na fila operacional.
const CANCELLED_RECENCY_DAYS = 7;

// ── Score de prioridade ──────────────────────────────────────────────────────

function calcPriorityScore(card: {
  deliveryType: string;
  slaType: string;
  status: string;
  minutesInStatus: number;
  pendingTransfers: number;
}): { score: number; level: PriorityLevel } {
  let score = 0;

  if (card.status === "OCORRENCIA")          score += 100;
  if (card.deliveryType === "URGENT")        score += 50;
  if (card.slaType === "EXPRESS")            score += 40;
  if (card.status === "IN_TRANSIT")          score += 30;
  if (card.status === "DISPATCHED")          score += 25;
  if (card.pendingTransfers > 0)             score += 15;

  // Tempo em status penaliza (mais velho = mais urgente)
  score += Math.min(card.minutesInStatus / 10, 40);

  const level: PriorityLevel =
    score >= 100 ? "CRITICAL" :
    score >= 60  ? "HIGH"     :
    score >= 30  ? "MEDIUM"   :
                   "LOW";

  return { score, level };
}

// ── Query principal ──────────────────────────────────────────────────────────

export async function getOperationalQueue(role?: string): Promise<OperationalQueuePayload> {
  const allowedColumnIds = role && COLUMNS_BY_ROLE[role] ? COLUMNS_BY_ROLE[role] : null;
  const visibleColumns = allowedColumnIds
    ? COLUMNS.filter(c => allowedColumnIds.includes(c.id))
    : COLUMNS;
  const activeStatuses: DeliveryRequestStatus[] = visibleColumns.flatMap((c) => c.statuses);

  // CANCELLED é terminal e pode acumular muito histórico — limitamos a coluna
  // "Cancelados" aos cancelamentos recentes (últimos CANCELLED_RECENCY_DAYS dias).
  // Os demais status entram sem filtro de data.
  const includesCancelled = activeStatuses.includes(DeliveryRequestStatus.CANCELLED);
  const nonCancelledStatuses = activeStatuses.filter(
    (s) => s !== DeliveryRequestStatus.CANCELLED
  );
  const cancelledCutoff = new Date(
    Date.now() - CANCELLED_RECENCY_DAYS * 24 * 60 * 60 * 1000
  );

  const statusWhere: Prisma.DeliveryRequestWhereInput = includesCancelled
    ? {
        OR: [
          { status: { in: nonCancelledStatuses } },
          {
            status:    DeliveryRequestStatus.CANCELLED,
            updatedAt: { gte: cancelledCutoff },
          },
        ],
      }
    : { status: { in: activeStatuses } };

  const requests = await prisma.deliveryRequest.findMany({
    where: statusWhere,
    include: {
      store:  { select: { code: true, name: true } },
      seller: { select: { name: true } },
      transfers: {
        where: {
          status: { notIn: ["RECEIVED", "CANCELLED"] },
        },
        select: { id: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // r.createdAt is needed for SLA — already included via prisma include model fields

  const now = new Date();

  // Limpa locks expirados passivamente (background, sem await — best-effort)
  // Em produção, o cron /api/operacao/cleanup é mais confiável
  prisma.deliveryRequest.updateMany({
    where: {
      lockedBy:      { not: null },
      lockExpiresAt: { lte: now },
    },
    data: {
      lockedBy: null, lockedByName: null,
      lockedAt: null, lockExpiresAt: null, lockReason: null,
    },
  }).catch(() => { /* silencioso */ });

  // Mapeia para OperationalCard com scores calculados
  const cards: OperationalCard[] = requests.map((r) => {
    const minutesInStatus = Math.floor(
      (now.getTime() - r.updatedAt.getTime()) / 60_000
    );

    const partial = {
      deliveryType:    r.deliveryType as string,
      slaType:         r.slaType as string,
      status:          r.status as string,
      minutesInStatus,
      pendingTransfers: r.transfers.length,
    };

    const { score, level } = calcPriorityScore(partial);

    return {
      id:               r.id,
      orderNumber:      r.orderNumber,
      invoiceNumber:    r.invoiceNumber,
      customerName:     r.customerName,
      deliveryAddress:  r.deliveryAddress,
      status:           r.status,
      deliveryType:     r.deliveryType,
      slaType:          r.slaType as string,
      dispatchWindow:   r.dispatchWindow,
      storeCode:        r.store.code,
      storeName:        r.store.name,
      sellerName:       r.seller.name,
      sellerId:         r.sellerId,
      separatedBy:      r.separatedBy,
      separatedAt:      r.separatedAt?.toISOString() ?? null,
      occurrenceType:   r.occurrenceType,
      pendingTransfers: r.transfers.length,
      createdAt:        r.createdAt.toISOString(),
      updatedAt:        r.updatedAt.toISOString(),
      priorityScore:    score,
      priority:         level,
      minutesInStatus,
      // Alertas
      isStuck:          (() => {
        const th = STUCK_THRESHOLD_MIN[r.status as DeliveryRequestStatus];
        return th !== undefined && minutesInStatus > th;
      })(),
      stuckMinutes:     (() => {
        const th = STUCK_THRESHOLD_MIN[r.status as DeliveryRequestStatus];
        return th !== undefined ? Math.max(0, minutesInStatus - th) : 0;
      })(),
      slaBreached:      (() => {
        const th = SLA_SECONDS[r.slaType as string];
        if (!th) return false;
        const ageSeconds = (now.getTime() - r.createdAt.getTime()) / 1000;
        return ageSeconds > th;
      })(),
      // Lock
      lockedBy:         r.lockedBy,
      lockedByName:     r.lockedByName,
      lockedAt:         r.lockedAt?.toISOString() ?? null,
      lockExpiresAt:    r.lockExpiresAt?.toISOString() ?? null,
      lockReason:       r.lockReason,
      lockMinutesLeft:  r.lockExpiresAt && r.lockExpiresAt > now
                          ? Math.floor((r.lockExpiresAt.getTime() - now.getTime()) / 60_000)
                          : null,
    };
  });

  // Distribui nas colunas (já filtradas por role) e ordena por score desc dentro de cada coluna
  const columns: OperationalColumn[] = visibleColumns.map((col) => {
    const colCards = cards
      .filter((c) => col.statuses.includes(c.status))
      .sort((a, b) => b.priorityScore - a.priorityScore);

    return {
      id:       col.id,
      label:    col.label,
      statuses: col.statuses,
      cards:    colCards,
      count:    colCards.length,
    };
  });

  // ── Alertas automáticos ──────────────────────────────────────────────────
  const alerts: OperationalAlert[] = [];

  for (const card of cards) {
    // Card stuck
    if (card.isStuck) {
      alerts.push({
        key:           `stuck-${card.id}`,
        type:          "STUCK",
        severity:      card.stuckMinutes > 60 ? "CRITICAL" : "WARNING",
        requestId:     card.id,
        message:       `${card.orderNumber ?? card.id.slice(-6)} parado em ${card.status} há ${card.minutesInStatus}min`,
        minutesOverdue: card.stuckMinutes,
      });
    }
    // SLA breach
    if (card.slaBreached) {
      alerts.push({
        key:       `sla-${card.id}`,
        type:      "SLA_BREACH",
        severity:  "CRITICAL",
        requestId: card.id,
        message:   `SLA ${card.slaType} violado — ${card.orderNumber ?? card.id.slice(-6)}`,
      });
    }
    // Claim expiring
    if (card.lockMinutesLeft !== null && card.lockMinutesLeft <= 2 && card.lockMinutesLeft > 0) {
      alerts.push({
        key:       `claim-expiring-${card.id}`,
        type:      "CLAIM_EXPIRING",
        severity:  "INFO",
        requestId: card.id,
        message:   `Claim de ${card.lockedByName} expira em ${card.lockMinutesLeft}min`,
      });
    }
  }

  // Overload por coluna
  for (const col of columns) {
    if (col.count > 15) {
      alerts.push({
        key:      `overload-${col.id}`,
        type:     "QUEUE_OVERLOAD",
        severity: "WARNING",
        message:  `Coluna "${col.label}" com ${col.count} cards acumulados`,
      });
    }
  }

  const stuckCards  = cards.filter((c) => c.isStuck).length;
  const slaBreaches = cards.filter((c) => c.slaBreached).length;

  // Métricas globais
  const metrics: QueueMetrics = {
    total:            cards.length,
    urgent:           cards.filter((c) => c.deliveryType === "URGENT").length,
    express:          cards.filter((c) => c.slaType === "EXPRESS").length,
    ocorrencias:      cards.filter((c) => c.status === "OCORRENCIA").length,
    pendingTransfers: cards.filter((c) => c.pendingTransfers > 0).length,
    readyForDispatch: cards.filter((c) => c.status === "PRONTO_ROTEIRIZACAO").length,
    stuckCards,
    slaBreaches,
    alerts,
  };

  return { columns, metrics, fetchedAt: now.toISOString() };
}
