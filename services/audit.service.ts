// services/audit.service.ts
// Governança de frete: lógica de desvio, classificação, gate de despacho e KPIs.
// Funções puras (computeDeviation, classifyDeviation, isJustificationRequired)
// são exportadas separadamente para facilitar testes.

import { prisma } from "@/lib/prisma";
import {
  DeviationClassification,
  RouteSource,
  DispatchModal,
  DeliveryType,
} from "@prisma/client";

const DEFAULT_TOLERANCE_PERCENT = 15;

// ──────────────────────────────────────────────
// FUNÇÕES PURAS — TESTÁVEIS SEM BANCO
// ──────────────────────────────────────────────

export function computeDeviation(
  suggestedFreight: number,
  chargedFreight: number
): { deviationAmount: number; deviationPercent: number } {
  const deviationAmount = chargedFreight - suggestedFreight;
  const deviationPercent =
    suggestedFreight > 0 ? (deviationAmount / suggestedFreight) * 100 : 0;
  return { deviationAmount, deviationPercent };
}

export function classifyDeviation(
  deviationPercent: number,
  tolerancePercent: number
): DeviationClassification {
  if (deviationPercent > tolerancePercent) return DeviationClassification.ABOVE_RULE;
  if (deviationPercent < -tolerancePercent) return DeviationClassification.BELOW_RULE;
  return DeviationClassification.WITHIN_RULE;
}

export function isJustificationRequired(
  classification: DeviationClassification
): boolean {
  return classification === DeviationClassification.ABOVE_RULE;
}

// ──────────────────────────────────────────────
// TOLERÂNCIA POR LOJA
// Busca configuração específica da loja, com fallback para global.
// ──────────────────────────────────────────────

export async function getToleranceForStore(storeId: string): Promise<number> {
  // tenta config da loja específica primeiro, depois global
  const config = await prisma.auditConfig.findFirst({
    where: {
      active: true,
      OR: [{ storeId }, { storeId: null }],
    },
    orderBy: { storeId: "asc" }, // store-specific (não-null) antes de global (null) no PostgreSQL
  });
  return config?.tolerancePercent ?? DEFAULT_TOLERANCE_PERCENT;
}

// ──────────────────────────────────────────────
// CRIAÇÃO E ATUALIZAÇÃO DE AUDIT
// ──────────────────────────────────────────────

export interface CreateAuditParams {
  deliveryRequestId: string;
  storeId: string;
  invoiceNumber: string;
  sellerId: string;
  suggestedFreight?: number;
  chargedFreight?: number;
  distanceKm?: number;
  durationMinutes?: number;
  isApproximate?: boolean;
  totalValue?: number;
}

export async function createOrUpdateInitialAudit(
  params: CreateAuditParams
): Promise<void> {
  const { suggestedFreight, chargedFreight, storeId } = params;

  let deviationAmount: number | undefined;
  let deviationPercent: number | undefined;
  let classification: DeviationClassification | undefined;
  let justificationRequired = false;
  let tolerancePercent: number | undefined;

  if (suggestedFreight !== undefined && chargedFreight !== undefined) {
    const dev = computeDeviation(suggestedFreight, chargedFreight);
    deviationAmount = dev.deviationAmount;
    deviationPercent = dev.deviationPercent;
    tolerancePercent = await getToleranceForStore(storeId);
    classification = classifyDeviation(deviationPercent, tolerancePercent);
    justificationRequired = isJustificationRequired(classification);
  }

  const routeSource: RouteSource | undefined =
    params.isApproximate !== undefined
      ? params.isApproximate
        ? RouteSource.HAVERSINE
        : RouteSource.GOOGLE_MAPS
      : undefined;

  await prisma.freightAudit.upsert({
    where: { deliveryRequestId: params.deliveryRequestId },
    create: {
      deliveryRequestId: params.deliveryRequestId,
      storeId: params.storeId,
      invoiceNumber: params.invoiceNumber,
      sellerId: params.sellerId,
      suggestedFreight,
      chargedFreight,
      distanceKm: params.distanceKm,
      durationMinutes: params.durationMinutes,
      freightDeviation: deviationAmount,
      deviationPercent,
      deviationClassification: classification,
      tolerancePercent,
      justificationRequired,
      routeSource,
      totalValue: params.totalValue,
    },
    update: {
      suggestedFreight,
      chargedFreight,
      freightDeviation: deviationAmount,
      deviationPercent,
      deviationClassification: classification,
      tolerancePercent,
      justificationRequired,
      routeSource,
    },
  });
}

// ──────────────────────────────────────────────
// HARD GATE — bloqueia despacho sem justificativa
// ──────────────────────────────────────────────

export async function checkAuditGate(deliveryRequestId: string): Promise<{
  blocked: boolean;
  reason?: string;
  auditId?: string;
}> {
  const audit = await prisma.freightAudit.findUnique({
    where: { deliveryRequestId },
    select: { id: true, justificationRequired: true, justification: true },
  });

  if (!audit) return { blocked: false };

  if (audit.justificationRequired && !audit.justification) {
    return {
      blocked: true,
      auditId: audit.id,
      reason:
        "Desvio de frete acima da tolerância exige justificativa antes do despacho. " +
        "Acesse a tela de auditoria para justificar.",
    };
  }

  return { blocked: false };
}

// ──────────────────────────────────────────────
// JUSTIFICATIVA
// ──────────────────────────────────────────────

export async function addJustification(
  auditId: string,
  justification: string,
  justifiedById: string
): Promise<void> {
  if (!justification.trim()) {
    throw new Error("Justificativa não pode ser vazia.");
  }

  await prisma.freightAudit.update({
    where: { id: auditId },
    data: {
      justification: justification.trim(),
      justifiedById,
      justifiedAt: new Date(),
    },
  });
}

// ──────────────────────────────────────────────
// EXCEÇÃO SAME-DAY
// Registra que um vendedor solicitou entrega no mesmo dia após o corte das 12h.
// Chamado quando sameDayRequested = true na criação da solicitação.
// ──────────────────────────────────────────────

export interface SameDayExceptionParams {
  deliveryRequestId: string;
  sellerId: string;
  approvalReason: string;
  requestedAt: Date;
}

export async function recordSameDayException(params: SameDayExceptionParams): Promise<void> {
  await prisma.deliveryRequest.update({
    where: { id: params.deliveryRequestId },
    data: {
      sameDayRequested: true,
      sameDayApprovalReason: params.approvalReason,
      sameDayRequestedAt: params.requestedAt,
    },
  });
}

// ──────────────────────────────────────────────
// LISTA DE AUDITORIAS (filtrada e paginada)
// ──────────────────────────────────────────────

export interface AuditListFilters {
  storeId?: string;
  sellerId?: string;
  classification?: DeviationClassification;
  from?: Date;
  to?: Date;
  onlyPendingJustification?: boolean;
  page?: number;
  pageSize?: number;
}

export async function getAuditList(filters: AuditListFilters) {
  const {
    storeId,
    sellerId,
    classification,
    from,
    to,
    onlyPendingJustification,
    page = 1,
    pageSize = 50,
  } = filters;

  const where = {
    ...(storeId ? { storeId } : {}),
    ...(sellerId ? { sellerId } : {}),
    ...(classification ? { deviationClassification: classification } : {}),
    ...(from || to
      ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {}),
    ...(onlyPendingJustification
      ? { justificationRequired: true, justification: null }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.freightAudit.count({ where }),
    prisma.freightAudit.findMany({
      where,
      include: {
        deliveryRequest: {
          select: { invoiceNumber: true, customerName: true, deliveryAddress: true },
        },
        seller: { select: { id: true, name: true } },
        justifiedBy: { select: { id: true, name: true } },
      },
      orderBy: [{ deviationPercent: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

// ──────────────────────────────────────────────
// KPIs FINANCEIROS E OPERACIONAIS
// ──────────────────────────────────────────────

export interface FreightKPIs {
  period: { from: string; to: string };
  financial: {
    totalFreightCharged: number;
    totalLogisticsCost: number;
    netSubsidy: number;
    freightAsPercentOfRevenue: number | null;
    avgCostPerDelivery: number;
  };
  operational: {
    totalDeliveries: number;
    urgentPercent: number;
    lalamovePercent: number;
    avgDurationMin: number | null;
    haversinePercent: number | null;
  };
  audit: {
    avgDeviationPercent: number | null;
    pendingJustifications: number;
    withinRulePercent: number | null;
    aboveRulePercent: number | null;
    belowRulePercent: number | null;
  };
  sellerRanking: {
    sellerId: string;
    sellerName: string;
    avgDeviationPercent: number;
    deliveryCount: number;
  }[];
}

export async function getKPIs(params: {
  storeId?: string;
  from: Date;
  to: Date;
}): Promise<FreightKPIs> {
  const { storeId, from, to } = params;
  const periodFilter = { gte: from, lte: to };
  const storeFilter = storeId ? { storeId } : {};

  const [
    auditAgg,
    classGroups,
    haversineCount,
    totalAudits,
    totalDeliveries,
    urgentCount,
    lalamoveCount,
    durationAgg,
    pendingJustifications,
    sellerGroups,
  ] = await Promise.all([
    // financeiro: totais de frete e custo
    prisma.freightAudit.aggregate({
      _sum: { chargedFreight: true, estimatedCost: true, totalValue: true },
      _avg: { deviationPercent: true },
      where: { createdAt: periodFilter, ...storeFilter },
    }),
    // classificação de desvio
    prisma.freightAudit.groupBy({
      by: ["deviationClassification"],
      _count: { id: true },
      where: {
        createdAt: periodFilter,
        ...storeFilter,
        deviationClassification: { not: null },
      },
    }),
    // fallback Haversine
    prisma.freightAudit.count({
      where: { createdAt: periodFilter, ...storeFilter, routeSource: RouteSource.HAVERSINE },
    }),
    // total de registros de auditoria (base para percentuais)
    prisma.freightAudit.count({
      where: { createdAt: periodFilter, ...storeFilter },
    }),
    // total entregas
    prisma.deliveryRequest.count({
      where: { createdAt: periodFilter, ...storeFilter },
    }),
    // entregas urgentes
    prisma.deliveryRequest.count({
      where: { createdAt: periodFilter, ...storeFilter, deliveryType: DeliveryType.URGENT },
    }),
    // despachos via Lalamove
    prisma.dispatch.count({
      where: {
        createdAt: periodFilter,
        modal: DispatchModal.LALAMOVE,
        ...(storeId ? { storeId } : {}),
      },
    }),
    // duração média de rota
    prisma.freightAudit.aggregate({
      _avg: { durationMinutes: true },
      where: {
        createdAt: periodFilter,
        ...storeFilter,
        durationMinutes: { not: null },
      },
    }),
    // justificativas pendentes
    prisma.freightAudit.count({
      where: {
        createdAt: periodFilter,
        ...storeFilter,
        justificationRequired: true,
        justification: null,
      },
    }),
    // ranking por vendedor
    prisma.freightAudit.groupBy({
      by: ["sellerId"],
      _avg: { deviationPercent: true },
      _count: { id: true },
      where: {
        createdAt: periodFilter,
        ...storeFilter,
        sellerId: { not: null },
        deviationPercent: { not: null },
      },
      orderBy: { _avg: { deviationPercent: "desc" } },
      take: 10,
    }),
  ]);

  // classificações como mapa
  const classMap: Record<string, number> = {};
  for (const g of classGroups) {
    if (g.deviationClassification) {
      classMap[g.deviationClassification] = g._count.id;
    }
  }
  const totalWithClass = Object.values(classMap).reduce((a, b) => a + b, 0);

  // buscar nomes dos vendedores
  const sellerIds = sellerGroups
    .map((g) => g.sellerId)
    .filter((id): id is string => id !== null);
  const sellers = await prisma.user.findMany({
    where: { id: { in: sellerIds } },
    select: { id: true, name: true },
  });
  const sellerNameMap = Object.fromEntries(sellers.map((s) => [s.id, s.name]));

  const charged = auditAgg._sum.chargedFreight ?? 0;
  const cost = auditAgg._sum.estimatedCost ?? 0;
  const revenue = auditAgg._sum.totalValue ?? 0;

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    financial: {
      totalFreightCharged: charged,
      totalLogisticsCost: cost,
      netSubsidy: cost - charged,
      freightAsPercentOfRevenue: revenue > 0 ? (charged / revenue) * 100 : null,
      avgCostPerDelivery: totalDeliveries > 0 ? cost / totalDeliveries : 0,
    },
    operational: {
      totalDeliveries,
      urgentPercent: totalDeliveries > 0 ? (urgentCount / totalDeliveries) * 100 : 0,
      lalamovePercent: totalDeliveries > 0 ? (lalamoveCount / totalDeliveries) * 100 : 0,
      avgDurationMin: durationAgg._avg.durationMinutes ?? null,
      haversinePercent:
        totalAudits > 0 ? (haversineCount / totalAudits) * 100 : null,
    },
    audit: {
      avgDeviationPercent: auditAgg._avg.deviationPercent ?? null,
      pendingJustifications,
      withinRulePercent:
        totalWithClass > 0
          ? ((classMap["WITHIN_RULE"] ?? 0) / totalWithClass) * 100
          : null,
      aboveRulePercent:
        totalWithClass > 0
          ? ((classMap["ABOVE_RULE"] ?? 0) / totalWithClass) * 100
          : null,
      belowRulePercent:
        totalWithClass > 0
          ? ((classMap["BELOW_RULE"] ?? 0) / totalWithClass) * 100
          : null,
    },
    sellerRanking: sellerGroups
      .filter((g) => g.sellerId !== null)
      .map((g) => ({
        sellerId: g.sellerId!,
        sellerName: sellerNameMap[g.sellerId!] ?? "Desconhecido",
        avgDeviationPercent: g._avg.deviationPercent ?? 0,
        deliveryCount: g._count.id,
      })),
  };
}
