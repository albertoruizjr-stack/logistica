// services/analytics/eta-modal.service.ts
// Mede a precisão das previsões de ETA e das recomendações de modal.
// Compara: previsto (no despacho) vs real (completedAt / modal efetivo).

import { prisma }                              from "@/lib/prisma";
import type { ETAAccuracyReport, ModalAccuracyReport } from "@/types";

// ──────────────────────────────────────────────
// PRECISÃO DE ETA
// ──────────────────────────────────────────────

export async function getETAAccuracy(period: {
  from: Date;
  to:   Date;
  storeId?: string;
}): Promise<ETAAccuracyReport> {
  const dispatches = await prisma.dispatch.findMany({
    where: {
      completedAt:         { not: null, gte: period.from, lte: period.to },
      predictedDeliveryAt: { not: null },
      ...(period.storeId ? { storeId: period.storeId } : {}),
    },
    select: {
      completedAt:         true,
      predictedDeliveryAt: true,
    },
  });

  const total = await prisma.dispatch.count({
    where: {
      completedAt: { gte: period.from, lte: period.to },
      ...(period.storeId ? { storeId: period.storeId } : {}),
    },
  });

  const withPrediction = dispatches.length;

  if (withPrediction === 0) {
    return {
      period,
      totalDispatches: total,
      withPrediction:  0,
      avgErrorMin:     0,
      p90ErrorMin:     0,
      lateDeliveries:  0,
      latePercent:     0,
    };
  }

  // Erro = previsto - real (positivo = chegou antes; negativo = atrasou)
  const errors = dispatches.map((d) => {
    const predictedMs = d.predictedDeliveryAt!.getTime();
    const actualMs    = d.completedAt!.getTime();
    return (predictedMs - actualMs) / 60_000; // minutos
  });

  const avgErrorMin = errors.reduce((s, e) => s + e, 0) / errors.length;

  // P90 do erro absoluto
  const absErrors = errors.map(Math.abs).sort((a, b) => a - b);
  const p90Index  = Math.floor(absErrors.length * 0.9);
  const p90ErrorMin = absErrors[p90Index] ?? 0;

  const lateDeliveries = errors.filter((e) => e < 0).length; // chegou depois do previsto
  const latePercent    = (lateDeliveries / withPrediction) * 100;

  return {
    period,
    totalDispatches: total,
    withPrediction,
    avgErrorMin:     Math.round(avgErrorMin * 10) / 10,
    p90ErrorMin:     Math.round(p90ErrorMin * 10) / 10,
    lateDeliveries,
    latePercent:     Math.round(latePercent * 10) / 10,
  };
}

// ──────────────────────────────────────────────
// PRECISÃO DO MODAL RECOMENDADO
// Compara FreightDecisionLog.selectedMode vs Dispatch.modal
// ──────────────────────────────────────────────

export async function getModalAccuracy(period: {
  from: Date;
  to:   Date;
  storeId?: string;
}): Promise<ModalAccuracyReport> {
  // Busca logs de decisão com o despacho real associado
  const logs = await prisma.freightDecisionLog.findMany({
    where: {
      createdAt:        { gte: period.from, lte: period.to },
      deliveryRequestId: { not: null },
      ...(period.storeId ? { storeId: period.storeId } : {}),
    },
    select: {
      selectedMode:     true,
      internalCost:     true,
      lalamoveCost:     true,
      deliveryRequestId: true,
    },
  });

  if (logs.length === 0) {
    return {
      period,
      total:               0,
      matchCount:          0,
      matchPercent:        0,
      breakdown:           { suggested: {}, actual: {}, divergence: [] },
      avgCostErrorPercent: 0,
    };
  }

  // Busca despachos reais para as entregas associadas
  const drIds = logs.map((l) => l.deliveryRequestId!).filter(Boolean);
  const dispatches = await prisma.dispatch.findMany({
    where: { deliveryRequestId: { in: drIds } },
    select: {
      deliveryRequestId: true,
      modal:             true,
      estimatedCost:     true,
      actualCost:        true,
    },
  });

  const dispatchMap = new Map(dispatches.map((d) => [d.deliveryRequestId, d]));

  let matchCount     = 0;
  let costErrorSum   = 0;
  let costErrorCount = 0;

  const suggestedCounts: Record<string, number> = {};
  const actualCounts:    Record<string, number> = {};
  const divergenceCounts: Record<string, number> = {};

  for (const log of logs) {
    const dispatch = log.deliveryRequestId ? dispatchMap.get(log.deliveryRequestId) : null;
    if (!dispatch) continue;

    const suggested = log.selectedMode;
    // Mapeia modal do despacho para "INTERNAL" / "LALAMOVE"
    const actual = dispatch.modal === "INTERNAL_ROUTE" ? "INTERNAL" : "LALAMOVE";

    suggestedCounts[suggested] = (suggestedCounts[suggested] ?? 0) + 1;
    actualCounts[actual]       = (actualCounts[actual]       ?? 0) + 1;

    if (suggested === actual) {
      matchCount++;
    } else {
      const key = `${suggested}→${actual}`;
      divergenceCounts[key] = (divergenceCounts[key] ?? 0) + 1;
    }

    // Desvio de custo
    if (dispatch.estimatedCost && dispatch.actualCost && dispatch.estimatedCost > 0) {
      const errorPct = ((dispatch.actualCost - dispatch.estimatedCost) / dispatch.estimatedCost) * 100;
      costErrorSum  += errorPct;
      costErrorCount++;
    }
  }

  const total        = logs.filter((l) => dispatchMap.has(l.deliveryRequestId!)).length;
  const matchPercent = total > 0 ? (matchCount / total) * 100 : 0;

  const divergence = Object.entries(divergenceCounts).map(([key, count]) => {
    const [suggested, actual] = key.split("→");
    return { suggested, actual, count };
  });

  return {
    period,
    total,
    matchCount,
    matchPercent:        Math.round(matchPercent * 10) / 10,
    breakdown:           { suggested: suggestedCounts, actual: actualCounts, divergence },
    avgCostErrorPercent: costErrorCount > 0
      ? Math.round((costErrorSum / costErrorCount) * 10) / 10
      : 0,
  };
}
