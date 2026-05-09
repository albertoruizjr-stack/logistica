// ──────────────────────────────────────────────
// SERVIÇO DE TRANSFERÊNCIAS — Pilar 1: Estoque Comprometido
//
// Integra o StockLedger em cada transição de status:
//   createTransfer       → commitStock() por item
//   → APPROVED           → markInTransit() no destino
//   → IN_TRANSIT         → citelTakesOver() (exige nfCitelNumero)
//   → CANCELLED          → releaseStock() e/ou cancelTransit()
//   → RECEIVED           → reconcileTransfer() + divergências
// ──────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { TransferStatus, TransferPriority } from "@prisma/client";
import type { CreateTransferInput, UpdateTransferStatusInput } from "@/types";
import { fetchStockByProduct } from "./erp.service";
import { transitionDeliveryRequest } from "@/services/state-machine.service";
import {
  preCheckStock,
  commitStock,
  releaseStock,
  citelTakesOver,
  markInTransit,
  cancelTransit,
  reconcileTransfer,
} from "./stock-ledger.service";

// ──────────────────────────────────────────────
// CRIAÇÃO DE TRANSFERÊNCIA
// ──────────────────────────────────────────────

export async function createTransfer(input: CreateTransferInput) {
  // Passo 1: pré-valida estoque de todos os itens antes de persistir qualquer dado
  // Se qualquer item falhar, nenhuma transferência é criada
  const checkErrors: { productCode: string; productName: string; error: string; detail?: string }[] = [];

  for (const item of input.items) {
    const check = await preCheckStock({
      storeId: input.fromStoreId,
      productCode: item.productCode,
      productName: item.productName,
      qty: item.quantity,
    });

    if (!check.ok) {
      const reason =
        check.error === "CITEL_UNAVAILABLE"
          ? "estoque insuficiente (Citel indisponível, usando dados locais)"
          : "estoque insuficiente";

      const detail = check.detail
        ? `disponível: ${check.detail.saldoDisponivelReal}, solicitado: ${check.detail.qtdSolicitada}`
        : undefined;

      checkErrors.push({ productCode: item.productCode, productName: item.productName, error: reason, detail });
    }
  }

  if (checkErrors.length > 0) {
    const lines = checkErrors.map((e) =>
      e.detail ? `${e.productName} (${e.productCode}): ${e.error} — ${e.detail}` : `${e.productName} (${e.productCode}): ${e.error}`
    );
    throw new Error(`Estoque insuficiente para criar a transferência:\n${lines.join("\n")}`);
  }

  // Passo 2: persiste transferência e histórico
  const transfer = await prisma.$transaction(async (tx) => {
    const t = await tx.transfer.create({
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
      include: { fromStore: true, toStore: true, items: true },
    });

    await tx.transferHistory.create({
      data: {
        transferId: t.id,
        toStatus: TransferStatus.PENDING,
        changedById: input.requestedById,
        notes: "Transferência criada",
      },
    });

    if (input.deliveryRequestId) {
      await tx.deliveryRequest.update({
        where: { id: input.deliveryRequestId },
        data: { status: "AWAITING_TRANSFER" },
      });
    }

    return t;
  });

  // Passo 3: trava estoque no ledger (commitStock tem a própria transação)
  // Falha por CONCURRENT_CONFLICT é rara e ainda pode ocorrer aqui (TOCTOU residual)
  const commitErrors: { productCode: string; productName: string; error: string }[] = [];

  for (const item of transfer.items) {
    const result = await commitStock({
      storeId: input.fromStoreId,
      productCode: item.productCode,
      productName: item.productName,
      qty: item.quantity,
      transferId: transfer.id,
      operatorId: input.requestedById,
    });

    if (!result.success) {
      commitErrors.push({
        productCode: item.productCode,
        productName: item.productName,
        error: result.error === "CONCURRENT_CONFLICT"
          ? "conflito de concorrência — tente novamente"
          : "estoque insuficiente",
      });
    }
  }

  // Se o commit falhou (caso raro de concorrência após pré-check), cancela e informa
  if (commitErrors.length > 0) {
    await prisma.transfer.update({
      where: { id: transfer.id },
      data: { status: TransferStatus.CANCELLED, cancelledAt: new Date() },
    });
    await prisma.transferHistory.create({
      data: {
        transferId: transfer.id,
        fromStatus: TransferStatus.PENDING,
        toStatus: TransferStatus.CANCELLED,
        notes: `Cancelado — conflito de concorrência: ${commitErrors.map((e) => e.productCode).join(", ")}`,
      },
    });
    throw new Error(
      `Transferência cancelada por conflito de concorrência — tente novamente`
    );
  }

  return transfer;
}

// ──────────────────────────────────────────────
// PROGRESSÃO DE STATUS
// ──────────────────────────────────────────────

export async function updateTransferStatus(
  transferId: string,
  input: UpdateTransferStatusInput
) {
  // Validação antecipada: IN_TRANSIT exige nfCitelNumero
  if (input.status === TransferStatus.IN_TRANSIT && !input.nfCitelNumero) {
    throw new Error(
      "Informe o número da NF emitida no Citel para colocar a transferência em trânsito."
    );
  }

  const current = await prisma.transfer.findUniqueOrThrow({
    where: { id: transferId },
    include: { items: true, deliveryRequest: true },
  });

  validateStatusTransition(current.status, input.status);

  const now = new Date();
  const isNewNf =
    input.status === TransferStatus.IN_TRANSIT &&
    !!input.nfCitelNumero &&
    !current.nfCitelNumero;

  // Atualiza status e campos relacionados na mesma transação
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.transfer.update({
      where: { id: transferId },
      data: {
        status: input.status,
        approvedById:   input.status === TransferStatus.APPROVED   ? input.changedById : undefined,
        approvedAt:     input.status === TransferStatus.APPROVED   ? now : undefined,
        preparingAt:    input.status === TransferStatus.PREPARING  ? now : undefined,
        dispatchedAt:   input.status === TransferStatus.IN_TRANSIT ? now : undefined,
        receivedAt:     input.status === TransferStatus.RECEIVED   ? now : undefined,
        cancelledAt:    input.status === TransferStatus.CANCELLED  ? now : undefined,
        estimatedArrival: input.estimatedArrival,
        nfCitelNumero:    input.nfCitelNumero ?? undefined,
        nfCitelEmitidaAt: isNewNf ? now : undefined,
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

    if (input.receivedItems) {
      for (const ri of input.receivedItems) {
        await tx.transferItem.update({
          where: { id: ri.transferItemId },
          data: { receivedQty: ri.receivedQty },
        });
      }
    }

    await tx.transferHistory.create({
      data: {
        transferId,
        fromStatus: current.status,
        toStatus: input.status,
        changedById: input.changedById,
        notes: input.notes,
      },
    });

    return result;
  });

  // ── Operações de ledger pós-commit ─────────────────────────────────────

  // APPROVED → registra qtdEmTransito na loja destino
  if (input.status === TransferStatus.APPROVED) {
    for (const item of current.items) {
      await markInTransit({
        toStoreId: current.toStoreId,
        productCode: item.productCode,
        productName: item.productName,
        qty: item.quantity,
        transferId,
      });
    }
  }

  // IN_TRANSIT com nova NF → Citel passa a controlar; libera qtdComprometida
  if (isNewNf) {
    for (const item of current.items) {
      await citelTakesOver({
        storeId: current.fromStoreId,
        productCode: item.productCode,
        qty: item.quantity,
        transferId,
        operatorId: input.changedById,
      });
    }
  }

  // CANCELLED → libera estoque e/ou cancela trânsito conforme o estado anterior
  if (input.status === TransferStatus.CANCELLED) {
    const hadNf = !!current.nfCitelNumero;

    // Citel ainda não controla → qtdComprometida está no ledger → libera
    if (!hadNf) {
      for (const item of current.items) {
        await releaseStock({
          storeId: current.fromStoreId,
          productCode: item.productCode,
          qty: item.quantity,
          transferId,
          operatorId: input.changedById,
        });
      }
    }

    // markInTransit foi chamado em APPROVED → precisa cancelar qtdEmTransito no destino
    const hadTransit = (
      [TransferStatus.APPROVED, TransferStatus.PREPARING, TransferStatus.IN_TRANSIT] as TransferStatus[]
    ).includes(current.status);

    if (hadTransit) {
      for (const item of current.items) {
        await cancelTransit({
          toStoreId: current.toStoreId,
          productCode: item.productCode,
          qty: item.quantity,
          transferId,
          operatorId: input.changedById,
        });
      }
    }
  }

  // RECEIVED → reconcilia itens e detecta divergências
  if (input.status === TransferStatus.RECEIVED && input.receivedItems) {
    const itemMap = new Map(current.items.map((i) => [i.id, i]));

    const reconcileItems = input.receivedItems
      .flatMap((ri) => {
        const item = itemMap.get(ri.transferItemId);
        if (!item) return [];
        return [{
          transferItemId: ri.transferItemId,
          productCode: item.productCode,
          productName: item.productName,
          sentQty: item.sentQty ?? item.quantity,
          receivedQty: ri.receivedQty,
        }];
      });

    if (reconcileItems.length > 0) {
      const { hasDivergence, divergences } = await reconcileTransfer({
        transferId,
        sendingStoreId:   current.fromStoreId,
        receivingStoreId: current.toStoreId,
        operatorId: input.changedById,
        items: reconcileItems,
      });

      if (hasDivergence) {
        await prisma.transfer.update({
          where: { id: transferId },
          data: { hasDivergence: true, divergenceCount: divergences.length },
        });
      }
    }
  }

  // Verifica se a solicitação vinculada pode avançar para READY
  if (input.status === TransferStatus.RECEIVED && current.deliveryRequestId) {
    await checkAndAdvanceDeliveryRequest(current.deliveryRequestId);
  }

  return updated;
}

// ──────────────────────────────────────────────
// HELPERS INTERNOS
// ──────────────────────────────────────────────

// Avança para SEPARADO somente se todas as transferências foram recebidas sem divergências.
// Usa state machine para garantir auditoria e validação de gates.
async function checkAndAdvanceDeliveryRequest(deliveryRequestId: string) {
  const transfers = await prisma.transfer.findMany({
    where: { deliveryRequestId },
  });

  const allClear = transfers.every(
    (t) => t.status === TransferStatus.RECEIVED && !t.hasDivergence
  );

  if (!allClear) return;

  try {
    await transitionDeliveryRequest({
      requestId: deliveryRequestId,
      actorId: "SYSTEM",
      actorRole: "SYSTEM",
      toStatus: "SEPARADO",
      metadata: {
        reason: "Todas as transferências recebidas sem divergências",
        separatedBy: "SYSTEM",
      },
    });
  } catch {
    // Se gate falhar (ex: itens ainda indisponíveis), avança para READY (fluxo legado)
    // e deixa o operador gerenciar manualmente
    await prisma.deliveryRequest.update({
      where: { id: deliveryRequestId },
      data: { status: "READY", isComplete: true },
    });
  }
}

// ──────────────────────────────────────────────
// SUGESTÃO DE LOJA PARA TRANSFERÊNCIA
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
    .flatMap((a) => {
      const store = storeMap.get(a.storeCode);
      if (!store) return [];

      // distância em linha reta como proxy de desvio logístico
      const distanceKm =
        Math.sqrt(
          Math.pow(store.lat - toStoreLat, 2) +
          Math.pow(store.lng - toStoreLng, 2)
        ) * 111;

      return [{
        storeId: store.id,
        storeCode: store.code,
        storeName: store.name,
        availableQty: a.qty,
        distanceKm,
        score: a.qty / (distanceKm + 0.1),
      }];
    });

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
    ...(filters.priority         ? { priority: filters.priority }                 : {}),
    ...(filters.fromStoreId      ? { fromStoreId: filters.fromStoreId }           : {}),
    ...(filters.toStoreId        ? { toStoreId: filters.toStoreId }               : {}),
    ...(filters.deliveryRequestId ? { deliveryRequestId: filters.deliveryRequestId } : {}),
  };

  const [transfers, total] = await Promise.all([
    prisma.transfer.findMany({
      where,
      include: {
        fromStore: true,
        toStore: true,
        requestedBy: { select: { id: true, name: true } },
        approvedBy:  { select: { id: true, name: true } },
        items: true,
        deliveryRequest: { select: { id: true, invoiceNumber: true, customerName: true } },
        dispatch: true,
        history: { orderBy: { createdAt: "asc" } },
      },
      orderBy: [
        { priority: "asc" },    // URGENT primeiro
        { requestedAt: "desc" },
      ],
      take: filters.limit  ?? 50,
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
  PENDING:    [TransferStatus.APPROVED,   TransferStatus.CANCELLED],
  APPROVED:   [TransferStatus.PREPARING,  TransferStatus.CANCELLED],
  PREPARING:  [TransferStatus.IN_TRANSIT, TransferStatus.CANCELLED],
  IN_TRANSIT: [TransferStatus.RECEIVED,   TransferStatus.CANCELLED],
  RECEIVED:   [],
  CANCELLED:  [],
};

function validateStatusTransition(from: TransferStatus, to: TransferStatus): void {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new Error(
      `Transição inválida: ${from} → ${to}. Permitidas: ${allowed.join(", ") || "nenhuma"}`
    );
  }
}
