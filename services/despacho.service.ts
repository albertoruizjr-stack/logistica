// ──────────────────────────────────────────────
// SERVIÇO DE DESPACHO
// A engine de decisão de modal é o coração desta camada:
// ela aplica as regras de negócio e decide automaticamente
// se um pedido vai para rota interna, Lalamove ou exceção.
// ──────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { DispatchModal, DispatchStatus, DeliveryType } from "@prisma/client";
import type { CreateDispatchInput } from "@/types";
import { isBeforeRouteCutoff } from "@/lib/utils";
import { dispatchViaLalamove } from "@/lib/lalamove-dispatch";

// ──────────────────────────────────────────────
// ENGINE DE DECISÃO DE MODAL
// O vendedor solicita, o sistema decide.
// ──────────────────────────────────────────────

export interface ModalDecision {
  modal: DispatchModal;
  reason: string;
  requiresManualApproval: boolean;
  estimatedCost?: number;
  estimatedDurationMin?: number; // duração estimada da rota (para exibição e score)
}

export async function decideModal(params: {
  deliveryType: DeliveryType;
  distanceKm: number;
  durationMinutes?: number;  // duração real ou estimada de rota (Google Maps ou Haversine)
  isUrgent: boolean;
  requestedAt?: Date;
}): Promise<ModalDecision> {
  const { deliveryType, distanceKm, durationMinutes, isUrgent } = params;

  // busca configurações do banco
  const configs = await prisma.systemConfig.findMany({
    where: {
      key: { in: ["MAX_STANDARD_DELIVERY_KM", "INTERNAL_ROUTE_CUTOFF_HOUR", "MAX_INTERNAL_DURATION_MIN"] },
    },
  });

  const configMap = Object.fromEntries(configs.map((c) => [c.key, c.value]));
  const maxStandardKm = parseFloat(configMap["MAX_STANDARD_DELIVERY_KM"] ?? "20");
  const cutoffHour = parseInt(configMap["INTERNAL_ROUTE_CUTOFF_HOUR"] ?? "16");
  const maxInternalDurationMin = parseFloat(configMap["MAX_INTERNAL_DURATION_MIN"] ?? "45");

  // Regra 1: acima do limite de km — exceção operacional (restrição mais dura)
  if (distanceKm > maxStandardKm) {
    return {
      modal: DispatchModal.EXCEPTION,
      reason: `Distância de ${distanceKm.toFixed(1)}km excede o limite de ${maxStandardKm}km para rotas automáticas`,
      requiresManualApproval: true,
      estimatedDurationMin: durationMinutes,
    };
  }

  // Regra 2: urgente → Lalamove
  if (isUrgent || deliveryType === DeliveryType.URGENT) {
    return {
      modal: DispatchModal.LALAMOVE,
      reason: "Pedido urgente — enviado via Lalamove para entrega no mesmo dia",
      requiresManualApproval: false,
      estimatedDurationMin: durationMinutes,
    };
  }

  // Regra 3: tempo de rota acima do limite → Lalamove mesmo dentro do limite de km
  // Caso real: 8km em hora de pico pode ter 50 min — rota interna chegaria fora do prazo.
  if (durationMinutes !== undefined && durationMinutes > maxInternalDurationMin) {
    return {
      modal: DispatchModal.LALAMOVE,
      reason: `Rota estimada em ${Math.round(durationMinutes)} min — acima do limite de ${maxInternalDurationMin} min para rota interna`,
      requiresManualApproval: false,
      estimatedDurationMin: durationMinutes,
    };
  }

  // Regra 4: padrão dentro dos limites → rota interna
  // (se já passou do horário de corte, entra na rota do dia seguinte)
  const beforeCutoff = isBeforeRouteCutoff(cutoffHour);
  return {
    modal: DispatchModal.INTERNAL_ROUTE,
    reason: beforeCutoff
      ? "Pedido padrão — incluído na rota do dia"
      : `Pedido padrão — criado após ${cutoffHour}h, incluído na rota de amanhã`,
    requiresManualApproval: false,
    estimatedDurationMin: durationMinutes,
  };
}

// ──────────────────────────────────────────────
// CRIAÇÃO DE DESPACHO
// ──────────────────────────────────────────────

export async function createDispatch(input: CreateDispatchInput) {
  // ── FASE 1: transaction atômica — cria dispatch + atualiza status + cria audit ──
  const dispatch = await prisma.$transaction(async (tx) => {
    const dispatch = await tx.dispatch.create({
      data: {
        deliveryRequestId: input.deliveryRequestId,
        transferId: input.transferId,
        storeId: input.storeId,
        modal: input.modal,
        status: DispatchStatus.PENDING,
        driverId: input.driverId,
        routeId: input.routeId,
        estimatedCost: input.estimatedCost,
        dispatchedById: input.dispatchedById,
        notes: input.notes,
        dispatchedAt: new Date(),
      },
      include: {
        deliveryRequest: true,
        transfer: { include: { fromStore: true, toStore: true } },
        store: true,
        driver: true,
      },
    });

    // atualiza a solicitação de entrega para DISPATCHED
    if (input.deliveryRequestId) {
      await tx.deliveryRequest.update({
        where: { id: input.deliveryRequestId },
        data: { status: "DISPATCHED" },
      });
    }

    // cria registro de auditoria de frete
    if (input.deliveryRequestId) {
      const deliveryRequest = await tx.deliveryRequest.findUnique({
        where: { id: input.deliveryRequestId },
        include: { freightQuote: true },
      });

      if (deliveryRequest) {
        await tx.freightAudit.upsert({
          where: { deliveryRequestId: input.deliveryRequestId },
          update: {
            dispatchId: dispatch.id,
            estimatedCost: input.estimatedCost,
            modal: input.modal,
          },
          create: {
            deliveryRequestId: input.deliveryRequestId,
            dispatchId: dispatch.id,
            invoiceNumber: deliveryRequest.invoiceNumber,
            storeId: deliveryRequest.storeId,
            suggestedFreight: deliveryRequest.freightQuote?.suggestedPrice,
            chargedFreight: deliveryRequest.chargedFreight,
            estimatedCost: input.estimatedCost,
            modal: input.modal,
            deliveryType: deliveryRequest.deliveryType,
            distanceKm: deliveryRequest.freightQuote?.distanceKm,
            freightDeviation: deliveryRequest.chargedFreight != null && deliveryRequest.freightQuote != null
              ? deliveryRequest.chargedFreight - deliveryRequest.freightQuote.suggestedPrice
              : null,
          },
        });
      }
    }

    return dispatch;
  });

  // ── FASE 2: chamar API Lalamove FORA da transaction ──
  // Se falhar, o dispatch já está no banco — operador pode retentar.
  if (dispatch.modal === DispatchModal.LALAMOVE && input.deliveryRequestId) {
    try {
      const [store, deliveryRequest] = await Promise.all([
        prisma.store.findUnique({
          where: { id: input.storeId },
          select: { lat: true, lng: true, address: true, phone: true },
        }),
        prisma.deliveryRequest.findUnique({
          where: { id: input.deliveryRequestId },
          select: {
            deliveryLat: true,
            deliveryLng: true,
            deliveryAddress: true,
            customerName: true,
            customerPhone: true,
          },
        }),
      ]);

      if (!store || !deliveryRequest) {
        console.warn("[Lalamove] Store ou DeliveryRequest não encontrada — dispatch sem pedido Lalamove.");
      } else {
        const result = await dispatchViaLalamove(store, deliveryRequest);

        if (!result) {
          console.warn("[Lalamove] Coordenadas ausentes na solicitação — dispatch sem pedido Lalamove.");
        } else {
          // salva LalamoveOrder vinculada ao dispatch
          await prisma.lalamoveOrder.create({
            data: {
              dispatchId: dispatch.id,
              lalamoveOrderId: result.lalamoveOrderId,
              quotationId: result.quotationId,
              status: "ASSIGNING_DRIVER",
              internalStatus: DispatchStatus.PENDING,
              estimatedPrice: result.estimatedPrice,
              shareLink: result.shareLink,
              currency: "BRL",
            },
          });

          // atualiza dispatch com ID externo e custo estimado
          await prisma.dispatch.update({
            where: { id: dispatch.id },
            data: {
              lalamoveOrderId: result.lalamoveOrderId,
              estimatedCost: result.estimatedPrice,
            },
          });

          console.info(`[Lalamove] Pedido criado: ${result.lalamoveOrderId} — dispatch ${dispatch.id}`);
        }
      }
    } catch (error) {
      // log mas não propaga: dispatch válido, Lalamove pode ser retentado
      console.error("[Lalamove] Falha ao criar pedido — dispatch criado sem vinculação:", error);
    }
  }

  return dispatch;
}

// ──────────────────────────────────────────────
// ATUALIZAÇÃO DE STATUS DO DESPACHO
// ──────────────────────────────────────────────

export async function updateDispatchStatus(
  dispatchId: string,
  status: DispatchStatus,
  params?: {
    actualCost?: number;
    failureReason?: string;
  }
) {
  return prisma.$transaction(async (tx) => {
    const dispatch = await tx.dispatch.update({
      where: { id: dispatchId },
      data: {
        status,
        completedAt: status === DispatchStatus.COMPLETED ? new Date() : undefined,
        failedAt: status === DispatchStatus.FAILED ? new Date() : undefined,
        failureReason: params?.failureReason,
        actualCost: params?.actualCost,
      },
    });

    // atualiza a solicitação de entrega
    if (dispatch.deliveryRequestId) {
      const deliveryStatus =
        status === DispatchStatus.IN_TRANSIT ? "IN_TRANSIT" :
        status === DispatchStatus.COMPLETED ? "DELIVERED" :
        undefined;

      if (deliveryStatus) {
        await tx.deliveryRequest.update({
          where: { id: dispatch.deliveryRequestId },
          data: { status: deliveryStatus },
        });
      }
    }

    // atualiza auditoria com custo real quando concluído
    if (status === DispatchStatus.COMPLETED && params?.actualCost !== undefined) {
      await tx.freightAudit.updateMany({
        where: { dispatchId },
        data: {
          actualCost: params.actualCost,
          costDeviation: params.actualCost - (dispatch.estimatedCost ?? 0),
        },
      });

      // atualiza status da transferência vinculada
      if (dispatch.transferId) {
        await tx.transfer.update({
          where: { id: dispatch.transferId },
          data: { status: "RECEIVED", receivedAt: new Date() },
        });
      }
    }

    return dispatch;
  });
}

// ──────────────────────────────────────────────
// LISTAGEM DE DESPACHOS PENDENTES (painel operacional)
// ──────────────────────────────────────────────

export async function listPendingDispatches(storeId?: string) {
  return prisma.dispatch.findMany({
    where: {
      status: { in: [DispatchStatus.PENDING, DispatchStatus.ASSIGNED, DispatchStatus.IN_TRANSIT] },
      ...(storeId ? { storeId } : {}),
    },
    include: {
      deliveryRequest: {
        select: {
          id: true,
          invoiceNumber: true,
          customerName: true,
          deliveryAddress: true,
          deliveryType: true,
          chargedFreight: true,
        },
      },
      transfer: {
        include: {
          fromStore: { select: { code: true, name: true } },
          toStore: { select: { code: true, name: true } },
        },
      },
      store: { select: { code: true, name: true } },
      driver: true,
      route: true,
      lalamoveOrder: true,
    },
    orderBy: { createdAt: "asc" },
  });
}
