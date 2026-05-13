// services/dispatch-planner.service.ts
// Planeja janelas de despacho: calcula volume, duração estimada e alerta de sobrecarga.
// Puro — sem side effects, fácil de testar.

import { prisma }                     from "@/lib/prisma";
import { DeliveryRequestStatus, DispatchWindow } from "@prisma/client";
import type { DispatchPlanItem, DispatchPlanSummary } from "@/types";

// Horários de saída por janela
const DEPARTURE_HOUR: Record<"FIRST_DISPATCH" | "SECOND_DISPATCH", number> = {
  FIRST_DISPATCH:  8,   // 08:00
  SECOND_DISPATCH: 14,  // 14:00
};

// Capacidades por tipo de veículo (kg / latas) — fallback quando SystemConfig não carregado
const DEFAULT_CAPACITY = {
  maxWeightKg: 150,   // Fiorino como baseline
  maxLatas:    60,
};

// Score de prioridade de cada item no plano (puro)
export function priorityScore(item: {
  isUrgent:  boolean;
  distanceKm: number | null;
  dispatchWindow: string | null;
}): number {
  let score = 0;
  if (item.isUrgent)                               score += 50;
  if ((item.distanceKm ?? 99) < 5)                 score += 20;
  if (item.dispatchWindow === "EXPRESS")            score += 40;
  if (item.dispatchWindow === "SECOND_DISPATCH")    score += 10;
  return score;
}

// Capacidade máxima de um único veículo para o plano
export function buildCapacityWarning(
  totalWeightKg: number,
  totalLatas:    number,
  maxWeightKg:   number,
  maxLatas:      number
): string | null {
  const overWeight = totalWeightKg > maxWeightKg;
  const overLatas  = totalLatas    > maxLatas;

  if (overWeight && overLatas) {
    return `Volume excede a capacidade: ${totalWeightKg.toFixed(0)} kg (max ${maxWeightKg} kg) e ${totalLatas} latas (max ${maxLatas})`;
  }
  if (overWeight) {
    return `Peso total ${totalWeightKg.toFixed(0)} kg excede o limite de ${maxWeightKg} kg para um único veículo`;
  }
  if (overLatas) {
    return `${totalLatas} latas excede o limite de ${maxLatas} para um único veículo`;
  }
  return null;
}

// ──────────────────────────────────────────────
// CONSULTA PRINCIPAL
// ──────────────────────────────────────────────

export async function planDispatch(
  storeId: string,
  window:  "FIRST_DISPATCH" | "SECOND_DISPATCH"
): Promise<DispatchPlanSummary> {
  // Busca configurações de capacidade (usa fallback se não configurado)
  const cfgRows = await prisma.systemConfig.findMany({
    where: { key: { in: ["INTERNAL_FIORINO_MAX_KG", "INTERNAL_FIORINO_MAX_LATAS"] } },
  });
  const cfgMap = Object.fromEntries(cfgRows.map((r) => [r.key, parseFloat(r.value)]));
  const maxWeightKg = cfgMap["INTERNAL_FIORINO_MAX_KG"] ?? DEFAULT_CAPACITY.maxWeightKg;
  const maxLatas    = cfgMap["INTERNAL_FIORINO_MAX_LATAS"] ?? DEFAULT_CAPACITY.maxLatas;

  // Entregas prontas para despacho nesta janela
  const deliveries = await prisma.deliveryRequest.findMany({
    where: {
      storeId,
      status:         DeliveryRequestStatus.PRONTO_ROTEIRIZACAO,
      dispatchWindow: window as DispatchWindow,
    },
    include: {
      freightQuote: {
        select: {
          distanceKm:      true,
          durationMinutes: true,
          suggestedPrice:  true,
          isUrgent:        true,
        },
      },
      items: { select: { quantity: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const items: DispatchPlanItem[] = deliveries.map((d) => {
    const quote = d.freightQuote;
    const pScore = priorityScore({
      isUrgent:       quote?.isUrgent ?? d.deliveryType === "URGENT",
      distanceKm:     quote?.distanceKm ?? null,
      dispatchWindow: d.dispatchWindow,
    });

    // Peso e latas: não temos no DeliveryRequest diretamente, usamos FreightDecisionLog se existir
    // Por ora, estimamos 0 (dados incompletos) — será preenchido quando o motor de decisão rodar
    return {
      deliveryRequestId: d.id,
      customerName:      d.customerName,
      deliveryAddress:   d.deliveryAddress,
      distanceKm:        quote?.distanceKm     ?? null,
      durationMin:       quote?.durationMinutes ?? null,
      totalWeightKg:     null,
      totalLatas:        null,
      isUrgent:          d.deliveryType === "URGENT",
      priorityScore:     pScore,
    };
  });

  // Ordena por prioridade (mais urgente primeiro)
  items.sort((a, b) => b.priorityScore - a.priorityScore);

  const totalDistanceKm  = items.reduce((s, i) => s + (i.distanceKm ?? 0), 0);
  const totalDurationMin = items.reduce((s, i) => s + (i.durationMin ?? 0), 0);
  const totalWeightKg    = items.reduce((s, i) => s + (i.totalWeightKg ?? 0), 0);
  const totalLatas       = items.reduce((s, i) => s + (i.totalLatas ?? 0), 0);

  const capacityWarning  = buildCapacityWarning(totalWeightKg, totalLatas, maxWeightKg, maxLatas);

  // Janela de saída: hoje às 08h ou 14h
  const plannedDepartureAt = departureTime(window);
  const estimatedReturnAt  = new Date(plannedDepartureAt.getTime() + totalDurationMin * 60_000);

  return {
    window,
    plannedDepartureAt,
    estimatedReturnAt,
    items,
    totalDistanceKm,
    totalDurationMin,
    totalWeightKg,
    totalLatas,
    isOverCapacity: capacityWarning !== null,
    capacityWarning,
  };
}

function departureTime(window: "FIRST_DISPATCH" | "SECOND_DISPATCH"): Date {
  const d = new Date();
  d.setHours(DEPARTURE_HOUR[window], 0, 0, 0);
  // Se o horário já passou hoje, projeta para amanhã
  if (d <= new Date()) d.setDate(d.getDate() + 1);
  return d;
}
