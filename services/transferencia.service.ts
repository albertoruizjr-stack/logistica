// ──────────────────────────────────────────────
// SERVIÇO DE TRANSFERÊNCIAS
// Transferência é a entidade central do domínio logístico.
// Este serviço centraliza toda a lógica de criação,
// progressão de status e sugestão de lojas.
// ──────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { TransferStatus, TransferPriority } from "@prisma/client";
import type { CreateTransferInput, UpdateTransferStatusInput, TransferWithRelations } from "@/types";
import { fetchStockByProduct } from "./erp.service";

// ──────────────────────────────────────────────
// CRIAÇÃO DE TRANSFERÊNCIA
// ──────────────────────────────────────────────

export async function createTransfer(input: CreateTransferInput) {
  return prisma.$transaction(async (tx) => {
    const transfer = await tx.transfer.create({
      data: {
        deliveryRequestId: input.deliveryRequestId,
        fromStoreId: input.fromStoreId,
        toStoreId: input.toStoreId,
        priority: input.priority,
        requestedById: input.requestedById,
        notes: input.notes,
        items: {
          create: input.items.map((item) => ({
            productCode: item.productCode,
            productName: item.productName,
            quantity: item.quantity,
            unit: item.unit ?? "UN",
          })),
        },
      },
      include: {
        fromStore: true,
        toStore: true,
        items: true,
      },
    });

    // registra no histórico
    await tx.transferHistory.create({
      data: {
        transferId: transfer.id,
        toStatus: TransferStatus.PENDING,
        changedById: input.requestedById,
        notes: "Transferência criada",
      },
    });

    // se vinculada a uma solicitação, atualiza o status dela
    if (input.deliveryRequestId) {
      await tx.deliveryRequest.update({
        where: { id: input.deliveryRequestId },
        data: { status: "AWAITING_TRANSFER" },
      });
    }

    return transfer;
  });
}

// ──────────────────────────────────────────────
// PROGRESSÃO DE STATUS
// ──────────────────────────────────────────────

export async function updateTransferStatus(
  transferId: string,
  input: UpdateTransferStatusInput
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.transfer.findUniqueOrThrow({
      where: { id: transferId },
      include: { items: true, deliveryRequest: true },
    });

    validateStatusTransition(current.status, input.status);

    const now = new Date();
    const statusDates: Record<string, Date | undefined> = {
      [TransferStatus.APPROVED]: input.status === TransferStatus.APPROVED ? now : undefined,
      [TransferStatus.PREPARING]: input.status === TransferStatus.PREPARING ? now : undefined,
      [TransferStatus.IN_TRANSIT]: input.status === TransferStatus.IN_TRANSIT ? now : undefined,
      [TransferStatus.RECEIVED]: input.status === TransferStatus.RECEIVED ? now : undefined,
      [TransferStatus.CANCELLED]: input.status === TransferStatus.CANCELLED ? now : undefined,
    };

    const updated = await tx.transfer.update({
      where: { id: transferId },
      data: {
        status: input.status,
        approvedById: input.status === TransferStatus.APPROVED ? input.changedById : undefined,
        approvedAt: statusDates[TransferStatus.APPROVED],
        preparingAt: statusDates[TransferStatus.PREPARING],
        dispatchedAt: statusDates[TransferStatus.IN_TRANSIT],
        receivedAt: statusDates[TransferStatus.RECEIVED],
        cancelledAt: statusDates[TransferStatus.CANCELLED],
        estimatedArrival: input.estimatedArrival,
        // atualiza quantidades enviadas se fornecidas
        items: input.sentItems
          ? {
              updateMany: input.sentItems.map((si) => ({
                where: { id: si.transferItemId },
                data: { sentQty: si.sentQty },
              })),
            }
          : undefined,
      },
      include: { items: true, deliveryRequest: true },
    });

    // atualiza quantidades recebidas
    if (input.receivedItems) {
      for (const ri of input.receivedItems) {
        await tx.transferItem.update({
          where: { id: ri.transferItemId },
          data: { receivedQty: ri.receivedQty },
        });
      }
    }

    // registra no histórico
    await tx.transferHistory.create({
      data: {
        transferId,
        fromStatus: current.status,
        toStatus: input.status,
        changedById: input.changedById,
        notes: input.notes,
      },
    });

    // quando recebida, verifica se a solicitação vinculada pode avançar para READY
    if (input.status === TransferStatus.RECEIVED && current.deliveryRequestId) {
      await checkAndAdvanceDeliveryRequest(tx, current.deliveryRequestId);
    }

    return updated;
  });
}

// verifica se todas as transferências de uma solicitação foram recebidas
// e se sim, marca a solicitação como READY
async function checkAndAdvanceDeliveryRequest(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  deliveryRequestId: string
) {
  const transfers = await tx.transfer.findMany({
    where: { deliveryRequestId },
  });

  const allReceived = transfers.every((t) => t.status === TransferStatus.RECEIVED);

  if (allReceived) {
    await tx.deliveryRequest.update({
      where: { id: deliveryRequestId },
      data: { status: "READY", isComplete: true },
    });
  }
}

// ──────────────────────────────────────────────
// SUGESTÃO DE LOJA PARA TRANSFERÊNCIA
// Analisa estoque via ERP e recomenda a loja com
// maior disponibilidade e menor desvio logístico
// ──────────────────────────────────────────────

export async function suggestTransferSource(
  productCode: string,
  requestedQty: number,
  toStoreId: string,
  toStoreLat: number,
  toStoreLng: number
): Promise<{
  storeId: string;
  storeCode: string;
  storeName: string;
  availableQty: number;
  distanceKm: number;
  score: number;
} | null> {
  const stock = await fetchStockByProduct(productCode);
  if (!stock) return null;

  const stores = await prisma.store.findMany({
    where: { active: true, id: { not: toStoreId } },
  });

  const storeMap = new Map(stores.map((s) => [s.code, s]));

  const candidates = stock.availability
    .filter((a) => a.available && a.qty >= requestedQty)
    .map((a) => {
      const store = storeMap.get(a.storeCode);
      if (!store) return null;

      // distância em linha reta como proxy de desvio logístico
      const distanceKm = Math.sqrt(
        Math.pow(store.lat - toStoreLat, 2) + Math.pow(store.lng - toStoreLng, 2)
      ) * 111; // aprox km por grau

      // score = estoque disponível / distância (maior é melhor)
      const score = a.qty / (distanceKm + 0.1);

      return {
        storeId: store.id,
        storeCode: store.code,
        storeName: store.name,
        availableQty: a.qty,
        distanceKm,
        score,
      };
    })
    .filter(Boolean) as NonNullable<ReturnType<typeof suggestTransferSource> extends Promise<infer T> ? T : never>[];

  // retorna o candidato com maior score
  return candidates.sort((a, b) => b.score - a.score)[0] ?? null;
}

// ──────────────────────────────────────────────
// LISTAGEM COM FILTROS
// ──────────────────────────────────────────────

export async function listTransfers(filters: {
  status?: TransferStatus | TransferStatus[];
  priority?: TransferPriority;
  fromStoreId?: string;
  toStoreId?: string;
  deliveryRequestId?: string;
  limit?: number;
  offset?: number;
}) {
  const where = {
    ...(filters.status
      ? Array.isArray(filters.status)
        ? { status: { in: filters.status } }
        : { status: filters.status }
      : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.fromStoreId ? { fromStoreId: filters.fromStoreId } : {}),
    ...(filters.toStoreId ? { toStoreId: filters.toStoreId } : {}),
    ...(filters.deliveryRequestId ? { deliveryRequestId: filters.deliveryRequestId } : {}),
  };

  const [transfers, total] = await Promise.all([
    prisma.transfer.findMany({
      where,
      include: {
        fromStore: true,
        toStore: true,
        requestedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        items: true,
        deliveryRequest: {
          select: { id: true, invoiceNumber: true, customerName: true },
        },
        dispatch: true,
        history: { orderBy: { createdAt: "asc" } },
      },
      orderBy: [
        { priority: "asc" },   // URGENT primeiro
        { requestedAt: "desc" },
      ],
      take: filters.limit ?? 50,
      skip: filters.offset ?? 0,
    }),
    prisma.transfer.count({ where }),
  ]);

  return { transfers, total };
}

// ──────────────────────────────────────────────
// VALIDAÇÃO DE TRANSIÇÕES DE STATUS
// ──────────────────────────────────────────────

const VALID_TRANSITIONS: Record<TransferStatus, TransferStatus[]> = {
  PENDING: [TransferStatus.APPROVED, TransferStatus.CANCELLED],
  APPROVED: [TransferStatus.PREPARING, TransferStatus.CANCELLED],
  PREPARING: [TransferStatus.IN_TRANSIT, TransferStatus.CANCELLED],
  IN_TRANSIT: [TransferStatus.RECEIVED, TransferStatus.CANCELLED],
  RECEIVED: [],  // estado final
  CANCELLED: [], // estado final
};

function validateStatusTransition(from: TransferStatus, to: TransferStatus): void {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new Error(
      `Transição inválida: ${from} → ${to}. Permitidas: ${allowed.join(", ") || "nenhuma"}`
    );
  }
}
