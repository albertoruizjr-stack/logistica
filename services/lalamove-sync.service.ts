// ──────────────────────────────────────────────
// SINCRONIZAÇÃO DE STATUS LALAMOVE (POLLING)
//
// O webhook do Lalamove não está configurado (0 eventos recebidos). Enquanto
// isso, sincronizamos o status das corridas ATIVAS chamando a API de status
// (GET, read-only). Espelha a lógica do webhook (app/api/lalamove/webhook):
//   - atualiza lalamoveOrder (status bruto + internalStatus + motorista/placa)
//   - propaga ao dispatch/entrega via updateDispatchStatus
//   - estados terminais de falha revertem a entrega para elegível
//
// É chamada pelo endpoint POST /api/lalamove/sync, que por sua vez é disparado
// pelo polling do client (tela de Rastreamento) a cada 30s.
// ──────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { DispatchStatus } from "@prisma/client";
import { LALAMOVE_STATUS_MAP } from "@/types";
import { getLalamoveOrderStatus } from "@/services/lalamove.service";
import { updateDispatchStatus, revertDispatchToEligible } from "@/services/despacho.service";

const ACTIVE_INTERNAL_STATUSES: DispatchStatus[] = [
  DispatchStatus.PENDING,
  DispatchStatus.ASSIGNED,
  DispatchStatus.IN_TRANSIT,
];

export async function syncActiveLalamoveOrders(): Promise<{ checked: number; updated: number }> {
  const orders = await prisma.lalamoveOrder.findMany({
    where: { internalStatus: { in: ACTIVE_INTERNAL_STATUSES } },
    select: {
      id: true,
      lalamoveOrderId: true,
      dispatchId: true,
      status: true,
      internalStatus: true,
      dispatch: { select: { deliveryRequestId: true } },
    },
  });

  let checked = 0;
  let updated = 0;

  for (const o of orders) {
    checked++;
    try {
      const live = await getLalamoveOrderStatus(o.lalamoveOrderId);

      // Lalamove sem credenciais — não adianta seguir consultando as demais.
      if ("reason" in live) {
        console.info("[lalamove-sync] Lalamove não configurado — abortando sincronização.");
        break;
      }

      const newInternalStatus = LALAMOVE_STATUS_MAP[live.status];

      // 1) Espelha o estado da corrida no banco (status bruto + motorista/placa).
      //    Mantém o valor existente quando a API não traz o campo.
      await prisma.lalamoveOrder.update({
        where: { id: o.id },
        data: {
          status: live.status,
          internalStatus: newInternalStatus,
          ...(live.driverName  !== undefined ? { driverName:  live.driverName }  : {}),
          ...(live.driverPhone !== undefined ? { driverPhone: live.driverPhone } : {}),
          ...(live.driverPlate !== undefined ? { driverPlate: live.driverPlate } : {}),
        },
      });

      const statusChanged = newInternalStatus !== o.internalStatus;

      // 2) Propaga ao dispatch/entrega.
      if (newInternalStatus === DispatchStatus.FAILED) {
        // Estado terminal de falha (CANCELLED/REJECTED/EXPIRED): devolve a entrega
        // para elegível — mesma lógica do cancelamento manual.
        await revertDispatchToEligible({
          lalamoveOrderId: o.id,
          lalamoveStatus: live.status,
          dispatchId: o.dispatchId,
          deliveryRequestId: o.dispatch?.deliveryRequestId ?? null,
          changedById: "SYSTEM",
          failureReason: `Corrida Lalamove ${live.status}`,
          historyReason: `Corrida Lalamove ${live.status} — devolvida para elegível`,
        });
        updated++;
      } else if (
        statusChanged &&
        (newInternalStatus === DispatchStatus.ASSIGNED ||
          newInternalStatus === DispatchStatus.IN_TRANSIT ||
          newInternalStatus === DispatchStatus.COMPLETED)
      ) {
        // updateDispatchStatus já propaga IN_TRANSIT/COMPLETED → DELIVERED na entrega.
        await updateDispatchStatus(o.dispatchId, newInternalStatus, {
          actualCost: live.priceBreakdown ? parseFloat(live.priceBreakdown.total) : undefined,
        });
        updated++;
      } else if (statusChanged) {
        // PENDING ↔ PENDING (ASSIGNING_DRIVER): só o lalamoveOrder mudou (já gravado acima).
        updated++;
      }
    } catch (err) {
      // Isola a falha de uma corrida — as demais continuam sendo sincronizadas.
      console.error(`[lalamove-sync] Falha ao sincronizar corrida ${o.lalamoveOrderId}:`, err);
    }
  }

  return { checked, updated };
}
