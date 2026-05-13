// app/api/workqueue/route.ts
// Fila de trabalho operacional: entregas prontas + recomendações de modal e ETA.
// Usado pela tela de despacho do operador logístico.

import { NextRequest, NextResponse }        from "next/server";
import { prisma }                           from "@/lib/prisma";
import { getSessionFromRequest }            from "@/lib/auth";
import { apiSuccess, apiError }             from "@/types";
import { DeliveryRequestStatus }            from "@prisma/client";
import { getDriversWithETA }               from "@/services/driver-eta.service";
import { planDispatch }                    from "@/services/dispatch-planner.service";
import type { WorkqueueItem, DeliveryRisk, ModalRecommendation } from "@/types";

// Status que aparecem na fila de trabalho do operador
const WORKQUEUE_STATUSES: DeliveryRequestStatus[] = [
  DeliveryRequestStatus.PRONTO_ROTEIRIZACAO,
  DeliveryRequestStatus.ROTEIRIZADO,
  DeliveryRequestStatus.DISPATCHED,
  DeliveryRequestStatus.IN_TRANSIT,
];

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"].includes(session.role)) {
    return NextResponse.json(apiError("Acesso restrito a operadores"), { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get("storeId") || session.storeId;
  const includeDispatchPlan = searchParams.get("plan") === "true";

  if (!storeId) {
    return NextResponse.json(apiError("storeId obrigatório"), { status: 400 });
  }

  try {
    // 1. Entregas na fila
    const deliveries = await prisma.deliveryRequest.findMany({
      where: { storeId, status: { in: WORKQUEUE_STATUSES } },
      include: {
        store:        { select: { code: true, name: true } },
        seller:       { select: { id: true, name: true } },
        freightQuote: { include: { zone: true } },
        dispatch:     { select: { id: true, status: true, modal: true, driverId: true, dispatchedAt: true, predictedDeliveryAt: true } },
        items:        { select: { id: true } },
      },
      orderBy: [
        { deliveryType: "desc" },   // URGENT primeiro
        { createdAt:    "asc" },
      ],
    });

    // 2. ETA dos motoristas (paralelo com a consulta de entregas)
    const driversETA = await getDriversWithETA(storeId);

    // Índice de motorista por ID para lookup rápido
    const driverMap = new Map(driversETA.map((d) => [d.driverId, d]));
    const topDriver = driversETA.sort((a, b) => b.score - a.score)[0] ?? null;

    const now = new Date();
    const sameDayCutoffHour = new Date();
    sameDayCutoffHour.setHours(12, 0, 0, 0);
    const afterSameDayCutoff = now >= sameDayCutoffHour;

    // 3. Enriquecer cada entrega
    const items: WorkqueueItem[] = deliveries.map((d) => {
      const quote      = d.freightQuote;
      const dispatch   = d.dispatch;
      const isUrgent   = d.deliveryType === "URGENT";
      const distanceKm = quote?.distanceKm     ?? null;
      const durationMin = quote?.durationMinutes ?? null;

      // ETA de entrega: hora prevista no despacho ou estimativa a partir de agora
      let etaAt: Date | null = dispatch?.predictedDeliveryAt ?? null;
      let etaMinutes: number | null = null;

      if (!etaAt && durationMin) {
        const base = dispatch?.dispatchedAt ?? now;
        etaAt = new Date(base.getTime() + durationMin * 60_000);
      }
      if (etaAt) {
        etaMinutes = Math.max(0, (etaAt.getTime() - now.getTime()) / 60_000);
      }

      // Recomendação de modal
      const { recommendation, reason } = recommendModal({
        isUrgent,
        distanceKm,
        durationMin,
        afterSameDayCutoff,
        topDriverFreeMin: topDriver?.minutesUntilFree ?? null,
        dispatchWindow:   d.dispatchWindow,
        status:           d.status,
      });

      // Motorista sugerido: o que está no despacho ou o melhor disponível
      const assignedDriver = dispatch?.driverId ? driverMap.get(dispatch.driverId) ?? null : null;
      const suggestedDriver = assignedDriver ?? topDriver;

      // Risco de atraso
      const { risk, reason: delayReason } = assessDelayRisk({
        isUrgent,
        etaAt,
        dispatchWindow: d.dispatchWindow,
        status: d.status,
        now,
      });

      return {
        deliveryRequestId:    d.id,
        customerName:         d.customerName,
        deliveryAddress:      d.deliveryAddress,
        deliveryType:         d.deliveryType,
        status:               d.status,
        dispatchWindow:       d.dispatchWindow,
        distanceKm,
        durationMin,
        etaMinutes,
        etaAt,
        modalRecommendation:  recommendation,
        suggestedDriverId:    suggestedDriver?.driverId ?? null,
        suggestedDriverName:  suggestedDriver?.driverName ?? null,
        delayRisk:            risk,
        delayReason,
        recommendationReason: reason,
        isUrgent,
        createdAt:            d.createdAt,
      };
    });

    // 4. Plano de despacho (opcional — mais pesado)
    let dispatchPlan = null;
    if (includeDispatchPlan) {
      const window = now.getHours() < 12 ? "FIRST_DISPATCH" : "SECOND_DISPATCH";
      dispatchPlan = await planDispatch(storeId, window as "FIRST_DISPATCH" | "SECOND_DISPATCH");
    }

    return NextResponse.json(
      apiSuccess({ items, driverETAs: driversETA, dispatchPlan })
    );
  } catch (error) {
    console.error("[GET /api/workqueue]", error);
    return NextResponse.json(apiError("Erro ao carregar fila de trabalho"), { status: 500 });
  }
}

// ──────────────────────────────────────────────
// FUNÇÕES AUXILIARES PURAS
// ──────────────────────────────────────────────

function recommendModal(p: {
  isUrgent:          boolean;
  distanceKm:        number | null;
  durationMin:       number | null;
  afterSameDayCutoff: boolean;
  topDriverFreeMin:  number | null;
  dispatchWindow:    string | null;
  status:            DeliveryRequestStatus;
}): { recommendation: ModalRecommendation; reason: string } {
  // Já despachado: não recomendar mudança
  if (p.status === DeliveryRequestStatus.DISPATCHED || p.status === DeliveryRequestStatus.IN_TRANSIT) {
    return { recommendation: "INTERNAL", reason: "Já despachado — sem recomendação de mudança" };
  }

  if (p.isUrgent && p.afterSameDayCutoff) {
    return { recommendation: "EXPRESS", reason: "Same-day após 12h — Lalamove express prioritário" };
  }

  if (p.isUrgent && (p.topDriverFreeMin ?? 99) > 20) {
    return { recommendation: "LALAMOVE", reason: `Urgente e motorista ocupa mais ~${Math.round(p.topDriverFreeMin ?? 0)} min` };
  }

  if (!p.isUrgent && p.dispatchWindow === "FIRST_DISPATCH") {
    return { recommendation: "CONSOLIDATE", reason: "D+1 — consolidar com outras entregas do primeiro despacho" };
  }

  if ((p.distanceKm ?? 0) > 20) {
    return { recommendation: "LALAMOVE", reason: `Distância de ${p.distanceKm?.toFixed(1)} km excede rota interna` };
  }

  return { recommendation: "INTERNAL", reason: "Dentro dos parâmetros de rota interna" };
}

function assessDelayRisk(p: {
  isUrgent:      boolean;
  etaAt:         Date | null;
  dispatchWindow: string | null;
  status:        DeliveryRequestStatus;
  now:           Date;
}): { risk: DeliveryRisk; reason: string | null } {
  const minutesToEta = p.etaAt ? (p.etaAt.getTime() - p.now.getTime()) / 60_000 : null;

  // Urgente sem ETA ou com ETA negativo
  if (p.isUrgent && (minutesToEta === null || minutesToEta < 0)) {
    return { risk: "HIGH", reason: "Urgente sem previsão de entrega definida" };
  }

  // Em trânsito com ETA ultrapassado
  if (p.status === DeliveryRequestStatus.IN_TRANSIT && minutesToEta !== null && minutesToEta < -30) {
    return { risk: "HIGH", reason: `Entrega com ${Math.abs(Math.round(minutesToEta))} min de atraso` };
  }
  if (p.status === DeliveryRequestStatus.IN_TRANSIT && minutesToEta !== null && minutesToEta < 0) {
    return { risk: "MEDIUM", reason: `ETA ultrapassado por ${Math.abs(Math.round(minutesToEta))} min` };
  }

  // Segundo despacho sem previsão
  if (p.dispatchWindow === "SECOND_DISPATCH" && !p.etaAt) {
    return { risk: "MEDIUM", reason: "Segundo despacho sem motorista confirmado" };
  }

  return { risk: "LOW", reason: null };
}
