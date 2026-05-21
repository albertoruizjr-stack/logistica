// ──────────────────────────────────────────────
// DESPACHO DE ROTA (Route)
// Despacha uma Route inteira de uma vez: cria N Dispatches (um por DR),
// marca Route como DISPATCHED, motorista indisponível e avança cada
// DeliveryRequest para DISPATCHED via state machine.
// ──────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { DispatchModal, DispatchStatus, type Prisma } from "@prisma/client";
import { transitionDeliveryRequest } from "./state-machine.service";
import { extractDeliveryRequestIds, isManualStop, type RouteSequenceEntry } from "@/lib/route-sequence";
import { pathToInTransit } from "@/lib/delivery-progression";

// ──────────────────────────────────────────────
// AUTO-AVANÇO ATÉ IN_TRANSIT
// O app do motorista expõe a entrega já em ROTEIRIZADO (rota ACTIVE, antes do
// despacho — ver lib/driver-ownership.ts). Se o escritório não despachou, o
// motorista travava ao concluir (concluir exige IN_TRANSIT). Esta função garante
// que a entrega chega a IN_TRANSIT, criando o despacho que faltar e avançando os
// estados pulados. Idempotente: se já está em IN_TRANSIT, não faz nada.
// ──────────────────────────────────────────────

export async function ensureDeliveryInTransit(
  deliveryRequestId: string,
  actorId: string,
  actorRole: string,
): Promise<{ from: string; advanced: string[] }> {
  const dr = await prisma.deliveryRequest.findUnique({
    where:  { id: deliveryRequestId },
    select: { id: true, status: true, storeId: true },
  });
  if (!dr) throw new Error("Entrega não encontrada");

  const path = pathToInTransit(dr.status);
  // null = estado de onde não se auto-avança; [] = já em IN_TRANSIT. Nada a fazer.
  if (!path || path.length === 0) return { from: dr.status, advanced: [] };

  // O gate de DISPATCHED exige um Dispatch. Cria se faltar, herdando
  // motorista/rota da Route ativa que contém esta entrega.
  if (path.includes("DISPATCHED")) {
    const existing = await prisma.dispatch.findUnique({
      where:  { deliveryRequestId },
      select: { id: true },
    });
    if (!existing) {
      const routes = await prisma.$queryRaw<
        { id: string; driverId: string; spokeRouteId: string | null }[]
      >`
        SELECT id, "driverId", "spokeRouteId" FROM routes
        WHERE status IN ('ACTIVE', 'DISPATCHED')
          AND "sequenceJson" @> ${JSON.stringify([{ deliveryRequestId }])}::jsonb
        ORDER BY "createdAt" DESC
        LIMIT 1
      `;
      const route = routes[0];
      await prisma.dispatch.create({
        data: {
          deliveryRequestId,
          storeId:        dr.storeId,
          modal:          DispatchModal.INTERNAL_ROUTE,
          status:         DispatchStatus.IN_TRANSIT,
          driverId:       route?.driverId ?? null,
          routeId:        route?.id ?? null,
          spokeRouteId:   route?.spokeRouteId ?? null,
          dispatchedById: actorId,
          dispatchedAt:   new Date(),
        },
      });
    }
  }

  for (const toStatus of path) {
    await transitionDeliveryRequest({
      requestId: deliveryRequestId,
      actorId,
      actorRole,
      toStatus,
      metadata: { autoAdvance: true, reason: "Auto-avanço ao concluir entrega (rota não despachada)" },
    });
  }
  return { from: dr.status, advanced: path };
}

export async function dispatchRoute(routeId: string, operatorId: string) {
  const route = await prisma.route.findUnique({
    where: { id: routeId },
    include: { driver: { include: { store: { select: { id: true } } } } },
  });
  if (!route) throw new Error("Rota não encontrada");
  if (route.status === "DISPATCHED") throw new Error("Rota já foi despachada");

  const sequence = (route.sequenceJson as unknown as RouteSequenceEntry[] | null) ?? [];
  if (sequence.length === 0) throw new Error("Rota sem paradas — nada a despachar");

  // Só entregas viram Dispatch; paradas manuais (visita a loja / endereço extra) são pontos
  // de passagem sem solicitação vinculada — entram no roteiro mas não geram despacho.
  const drIds = extractDeliveryRequestIds(sequence);

  // Validar que todas DRs existem
  const drs = await prisma.deliveryRequest.findMany({
    where:  { id: { in: drIds } },
    select: { id: true, status: true, orderNumber: true },
  });
  if (drs.length !== drIds.length) {
    throw new Error("Uma ou mais solicitações da rota não foram encontradas.");
  }
  // Só despacha as paradas em ROTEIRIZADO. Paradas já em OCORRENCIA (motorista
  // registrou problema), DELIVERED ou CANCELLED são puladas — antes o despacho
  // quebrava a rota inteira se qualquer parada não estivesse em ROTEIRIZADO.
  const dispatchableIds = new Set(
    drs.filter((d) => d.status === "ROTEIRIZADO").map((d) => d.id),
  );
  if (dispatchableIds.size === 0) {
    throw new Error("Nenhuma parada em ROTEIRIZADO para despachar nesta rota.");
  }

  const now = new Date();
  const storeId = route.driver.store.id;

  // Cria Dispatches em IN_TRANSIT (despacho = motorista saiu) + atualiza Route + Driver.
  // Tudo em uma transação para garantir atomicidade.
  const dispatchIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const stop of sequence) {
      if (isManualStop(stop)) continue; // parada manual não gera Dispatch
      if (!dispatchableIds.has(stop.deliveryRequestId!)) continue; // pula OCORRENCIA/finalizadas
      const dispatch = await tx.dispatch.create({
        data: {
          deliveryRequestId: stop.deliveryRequestId!,
          storeId,
          modal:          DispatchModal.INTERNAL_ROUTE,
          // Despachar = motorista já saiu, então cria direto em IN_TRANSIT.
          // O estado intermediário PENDING ficaria sem efeito prático aqui.
          status:         DispatchStatus.IN_TRANSIT,
          driverId:       route.driverId,
          routeId:        route.id,
          spokeRouteId:   route.spokeRouteId,
          dispatchedById: operatorId,
          dispatchedAt:   now,
          predictedDeliveryAt: stop.eta ? new Date(stop.eta) : null,
        } satisfies Prisma.DispatchUncheckedCreateInput,
      });
      dispatchIds.push(dispatch.id);
    }

    await tx.route.update({
      where: { id: route.id },
      data:  { status: "DISPATCHED" },
    });

    await tx.driver.update({
      where: { id: route.driverId },
      data:  { available: false },
    });
  });

  // Transiciona cada DR ROTEIRIZADO → DISPATCHED → IN_TRANSIT.
  // A state machine não permite pular DISPATCHED (gate de auditoria), mas pro usuário
  // é uma única ação. Fora da transação porque a state machine cria a própria.
  for (const stop of sequence) {
    if (isManualStop(stop)) continue; // parada manual não tem DR para transicionar
    if (!dispatchableIds.has(stop.deliveryRequestId!)) continue; // pula OCORRENCIA/finalizadas
    try {
      await transitionDeliveryRequest({
        requestId: stop.deliveryRequestId!,
        actorId:   operatorId,
        actorRole: "LOGISTICS_OPERATOR",
        toStatus:  "DISPATCHED",
        metadata:  { routeId: route.id, dispatchedByRoute: true },
      });
      await transitionDeliveryRequest({
        requestId: stop.deliveryRequestId!,
        actorId:   operatorId,
        actorRole: "LOGISTICS_OPERATOR",
        toStatus:  "IN_TRANSIT",
        metadata:  { routeId: route.id, dispatchedByRoute: true, reason: "Despacho de rota — motorista saiu" },
      });
    } catch (err) {
      console.error(`[route-dispatch] falha ao avançar DR ${stop.deliveryRequestId} para IN_TRANSIT`, err);
    }
  }

  return {
    routeId:      route.id,
    dispatchIds,
    dispatchedAt: now,
    stopCount:    sequence.length,
  };
}

// ──────────────────────────────────────────────
// CONCLUSÃO DE ROTA
// Chamada após cada DR ser finalizada (DELIVERED/OCORRENCIA/CANCELLED).
// Se TODAS as DRs da rota estão em status final, fecha a rota e libera o motorista.
// Idempotente: chamadas concorrentes não duplicam efeitos.
// ──────────────────────────────────────────────

const FINAL_DR_STATUSES = new Set(["DELIVERED", "OCORRENCIA", "CANCELLED"]);

export async function checkAndCompleteRouteFromDeliveryRequest(deliveryRequestId: string) {
  const dr = await prisma.deliveryRequest.findUnique({
    where:   { id: deliveryRequestId },
    select:  { dispatch: { select: { routeId: true } } },
  });
  const routeId = dr?.dispatch?.routeId ?? null;
  if (!routeId) return { skipped: true, reason: "DR sem rota associada" };
  return checkAndCompleteRoute(routeId);
}

export async function checkAndCompleteRoute(routeId: string) {
  const route = await prisma.route.findUnique({
    where:  { id: routeId },
    select: { id: true, status: true, driverId: true, sequenceJson: true },
  });
  if (!route) return { skipped: true, reason: "Rota não encontrada" };
  if (route.status === "COMPLETED" || route.status === "CANCELLED") {
    return { skipped: true, reason: `Rota já em status ${route.status}` };
  }

  const sequence = (route.sequenceJson as unknown as RouteSequenceEntry[] | null) ?? [];
  const drIds = extractDeliveryRequestIds(sequence);
  if (drIds.length === 0) return { skipped: true, reason: "Rota sem paradas" };

  const drs = await prisma.deliveryRequest.findMany({
    where:  { id: { in: drIds } },
    select: { id: true, status: true },
  });

  const allFinal = drs.length === drIds.length && drs.every((d) => FINAL_DR_STATUSES.has(d.status));
  if (!allFinal) {
    const finished = drs.filter((d) => FINAL_DR_STATUSES.has(d.status)).length;
    return { skipped: true, reason: `${finished}/${drIds.length} entregas finalizadas` };
  }

  await prisma.$transaction(async (tx) => {
    // Re-checa status dentro da tx pra evitar race com chamadas paralelas
    const fresh = await tx.route.findUnique({ where: { id: route.id }, select: { status: true } });
    if (fresh?.status === "COMPLETED" || fresh?.status === "CANCELLED") return;

    await tx.route.update({
      where: { id: route.id },
      data:  { status: "COMPLETED" },
    });
    await tx.driver.update({
      where: { id: route.driverId },
      data:  { available: true },
    });
  });

  return { completed: true, routeId: route.id, driverId: route.driverId };
}

// Exclui uma Route ainda não despachada. Reverte DRs vinculadas para PRONTO_ROTEIRIZACAO
// e libera o motorista. Recusa rotas já despachadas — usar fluxo de cancelamento de dispatch.
export async function deleteRoute(routeId: string, operatorId: string) {
  const route = await prisma.route.findUnique({
    where: { id: routeId },
    select: { id: true, status: true, driverId: true, sequenceJson: true },
  });
  if (!route) throw new Error("Rota não encontrada");
  if (route.status !== "ACTIVE") {
    throw new Error(`Rota com status ${route.status} não pode ser excluída — use cancelamento de despacho.`);
  }

  const sequence = (route.sequenceJson as unknown as RouteSequenceEntry[] | null) ?? [];
  const drIds = extractDeliveryRequestIds(sequence);

  // Deleta a Route + libera motorista (transação atômica)
  await prisma.$transaction(async (tx) => {
    await tx.route.delete({ where: { id: route.id } });
    await tx.driver.update({
      where: { id: route.driverId },
      data:  { available: true },
    });
  });

  // Reverte cada DR ROTEIRIZADO → PRONTO_ROTEIRIZACAO via state machine
  for (const drId of drIds) {
    try {
      await transitionDeliveryRequest({
        requestId: drId,
        actorId:   operatorId,
        actorRole: "LOGISTICS_OPERATOR",
        toStatus:  "PRONTO_ROTEIRIZACAO",
        metadata:  { reason: "Rota excluída — reverteu para roteirização" },
      });
    } catch (err) {
      console.error(`[route-delete] falha ao reverter DR ${drId}`, err);
    }
  }

  return { routeId: route.id, revertedDeliveryRequestIds: drIds };
}
