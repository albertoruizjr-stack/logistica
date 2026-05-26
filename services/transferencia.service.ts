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
import { notifyOrderSeparated } from "@/services/notifications.service";
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
// indicateOrigin — etapa 1 → 2 (PENDING → AWAITING_APPROVAL)
//
// Loja destino indica qual loja vai fornecer o material. Pré-valida estoque
// na origem indicada, atualiza a Transfer e commita o estoque na origem.
// ──────────────────────────────────────────────

export async function indicateOrigin(
  transferId: string,
  fromStoreId: string,
  indicatedById: string,
) {
  const current = await prisma.transfer.findUniqueOrThrow({
    where: { id: transferId },
    include: { items: true },
  });

  if (current.status !== TransferStatus.PENDING) {
    throw new Error(
      `Só é possível indicar origem em status PENDING (atual: ${current.status})`,
    );
  }
  if (fromStoreId === current.toStoreId) {
    throw new Error("Loja origem não pode ser igual à loja destino");
  }

  // Pré-check de estoque para todos os itens antes de qualquer escrita
  for (const item of current.items) {
    const check = await preCheckStock({
      storeId:     fromStoreId,
      productCode: item.productCode,
      productName: item.productName,
      qty:         item.quantity,
    });
    if (!check.ok) {
      const detail = check.detail
        ? ` — disponível: ${check.detail.saldoDisponivelReal}, solicitado: ${check.detail.qtdSolicitada}`
        : "";
      throw new Error(
        `Estoque insuficiente em ${fromStoreId} para ${item.productName} (${item.productCode})${detail}`,
      );
    }
  }

  // Atualiza Transfer + histórico na mesma transação
  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.transfer.update({
      where: { id: transferId },
      data: {
        fromStoreId,
        status:              TransferStatus.AWAITING_APPROVAL,
        originIndicatedAt:   new Date(),
        originIndicatedById: indicatedById,
      },
      include: { items: true, fromStore: true, toStore: true },
    });
    await tx.transferHistory.create({
      data: {
        transferId,
        fromStatus:  TransferStatus.PENDING,
        toStatus:    TransferStatus.AWAITING_APPROVAL,
        changedById: indicatedById,
        notes:       `Origem indicada: ${(t as any).fromStore?.code ?? fromStoreId}`,
      },
    });
    return t;
  });

  // Commita estoque na origem (cada commitStock tem a própria transação)
  for (const item of current.items) {
    const result = await commitStock({
      storeId:     fromStoreId,
      productCode: item.productCode,
      productName: item.productName,
      qty:         item.quantity,
      transferId,
      operatorId:  indicatedById,
    });
    if (!result.success) {
      throw new Error(
        `commitStock falhou para ${item.productCode}: ${result.error ?? "erro desconhecido"}`,
      );
    }
  }

  return updated;
}

// ──────────────────────────────────────────────
// approveTransfer — etapa 2 → 3 (AWAITING_APPROVAL → READY_TO_COLLECT)
//
// Líder da loja origem aprova informando TE (não fiscal) OU NF (fiscal).
// markInTransit no destino sempre. Se NF, citelTakesOver na origem libera
// qtdComprometida (Citel passa a controlar). TE/NF persistem no item único.
// ──────────────────────────────────────────────

export async function approveTransfer(
  transferId: string,
  input: { teNumber?: string; nfCitelNumero?: string },
  approverId: string,
) {
  const hasTE = !!input.teNumber;
  const hasNF = !!input.nfCitelNumero;
  if (hasTE === hasNF) {
    throw new Error("Informe exatamente um documento: TE ou NF");
  }

  const current = await prisma.transfer.findUniqueOrThrow({
    where: { id: transferId },
    include: { items: true },
  });
  if (current.status !== TransferStatus.AWAITING_APPROVAL) {
    throw new Error(
      `Aprovação só é válida em AWAITING_APPROVAL (atual: ${current.status})`,
    );
  }
  if (!current.fromStoreId) {
    throw new Error("Transfer sem fromStoreId — estado inconsistente");
  }
  if (current.items.length !== 1) {
    throw new Error(`Transfer deve ter 1 item (encontrados ${current.items.length})`);
  }
  const item = current.items[0];

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    await tx.transferItem.update({
      where: { id: item.id },
      data: {
        teNumber:         hasTE ? input.teNumber : null,
        nfCitelNumero:    hasNF ? input.nfCitelNumero : null,
        nfCitelEmitidaAt: hasNF ? now : null,
      },
    });
    const t = await tx.transfer.update({
      where: { id: transferId },
      data: {
        status:           TransferStatus.READY_TO_COLLECT,
        approvedAt:       now,
        approvedById:     approverId,
        // Duplicado na Transfer pra compat com telas legadas
        teNumber:         hasTE ? input.teNumber : undefined,
        nfCitelNumero:    hasNF ? input.nfCitelNumero : undefined,
        nfCitelEmitidaAt: hasNF ? now : undefined,
      },
      include: { items: true, fromStore: true, toStore: true },
    });
    await tx.transferHistory.create({
      data: {
        transferId,
        fromStatus:  TransferStatus.AWAITING_APPROVAL,
        toStatus:    TransferStatus.READY_TO_COLLECT,
        changedById: approverId,
        notes:       hasTE
          ? `Aprovada com TE ${input.teNumber}`
          : `Aprovada com NF ${input.nfCitelNumero}`,
      },
    });
    return t;
  });

  // markInTransit no destino (qtdEmTransito ++) — sempre
  await markInTransit({
    toStoreId:   current.toStoreId,
    productCode: item.productCode,
    productName: item.productName,
    qty:         item.quantity,
    transferId,
  });

  // Se NF, citelTakesOver (libera qtdComprometida na origem)
  if (hasNF) {
    await citelTakesOver({
      storeId:     current.fromStoreId,
      productCode: item.productCode,
      qty:         item.quantity,
      transferId,
      operatorId:  approverId,
    });
  }

  return updated;
}

// ──────────────────────────────────────────────
// PROGRESSÃO DE STATUS
// ──────────────────────────────────────────────

export async function updateTransferStatus(
  transferId: string,
  input: UpdateTransferStatusInput
) {
  const current = await prisma.transfer.findUniqueOrThrow({
    where: { id: transferId },
    include: { items: true, deliveryRequest: true },
  });

  // Documento (TE/NF) é exigido na AUTORIZAÇÃO (transferências novas). A coleta
  // (IN_TRANSIT) NÃO trava por falta dele: transferências legadas (aprovadas no
  // fluxo antigo, que capturava a NF só no despacho) não têm documento e ainda
  // precisam poder ser coletadas. A prova da coleta é a foto. citelTakesOver()
  // só roda quando há nfCitelNumero (TE/sem-doc não libera qtdComprometida até o
  // recebimento) — comportamento aceitável.

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
        preparedAt:     input.status === TransferStatus.PREPARED   ? now : undefined,
        dispatchedAt:   input.status === TransferStatus.IN_TRANSIT ? now : undefined,
        receivedAt:     input.status === TransferStatus.RECEIVED   ? now : undefined,
        cancelledAt:    input.status === TransferStatus.CANCELLED  ? now : undefined,
        estimatedArrival: input.estimatedArrival,
        nfCitelNumero:    input.nfCitelNumero ?? undefined,
        nfCitelEmitidaAt: isNewNf ? now : undefined,
        // Documento da aprovação (PENDING → APPROVED): TE vai para teNumber.
        // NF reaproveita nfCitelNumero acima. Só persiste teNumber ao aprovar.
        teNumber:         input.status === TransferStatus.APPROVED && input.teNumber
                            ? input.teNumber
                            : undefined,
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

  // IN_TRANSIT com nova NF → Citel passa a controlar; libera qtdComprometida.
  // Atrelado a nfCitelNumero (fiscal). Uma transferência por TE (não fiscal) NÃO
  // dispara citelTakesOver — o estoque permanece como qtdComprometida no ledger até
  // o recebimento (reconcileTransfer). Comportamento aceitável: TE não é documento fiscal.
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
      [TransferStatus.APPROVED, TransferStatus.PREPARING, TransferStatus.PREPARED, TransferStatus.IN_TRANSIT] as TransferStatus[]
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

  // Atualiza a solicitação vinculada — parcial ou completa
  if (input.status === TransferStatus.RECEIVED && current.deliveryRequestId) {
    await handleTransferReceivedOnRequest(transferId, current.deliveryRequestId);
  }

  return updated;
}

// ──────────────────────────────────────────────
// HELPERS INTERNOS
// ──────────────────────────────────────────────

// Atualiza a DeliveryRequest quando uma transferência vinculada é recebida.
//
// Comportamento:
// - Recebimento PARCIAL → não muda status, mas registra um marker na
//   DeliveryStatusHistory com progresso (X de Y recebidas) pra auditoria
//   e timeline. Notificação ao vendedor é feita pela API route.
// - Recebimento COMPLETO → avança pra SEPARADO via state machine,
//   independente de divergência. metadata reflete se houve divergência
//   pra revisão posterior. Se gate falhar (ex: itens não disponíveis no
//   estoque), faz fallback pra READY com history manual.
async function handleTransferReceivedOnRequest(
  transferId: string,
  deliveryRequestId: string,
) {
  const transfers = await prisma.transfer.findMany({
    where: { deliveryRequestId },
    select: { id: true, status: true, hasDivergence: true, divergenceCount: true },
  });

  const total = transfers.length;
  const receivedCount = transfers.filter((t) => t.status === TransferStatus.RECEIVED).length;
  const hasDivergences = transfers.some((t) => t.hasDivergence);
  const totalDivergences = transfers.reduce((sum, t) => sum + (t.divergenceCount ?? 0), 0);

  const request = await prisma.deliveryRequest.findUnique({
    where:  { id: deliveryRequestId },
    select: { status: true },
  });
  if (!request) return;

  const currentStatus = request.status;
  const partial = receivedCount < total;

  // Marker informativo: registra cada transfer recebida no histórico da DR,
  // mesmo quando o status não muda. fromStatus = toStatus é a convenção pra
  // marker (a UI sabe filtrar quando exibir a timeline).
  await prisma.deliveryStatusHistory.create({
    data: {
      deliveryRequestId,
      fromStatus: currentStatus,
      toStatus:   currentStatus,
      reason: partial
        ? `Transferência recebida (${receivedCount}/${total})${hasDivergences ? " — com divergência" : ""}`
        : `Todas as ${total} transferência${total > 1 ? "s" : ""} recebida${total > 1 ? "s" : ""}${hasDivergences ? " — com divergência" : ""}`,
      metadata: {
        event: "TRANSFER_RECEIVED",
        transferId,
        receivedCount,
        totalTransfers: total,
        hasDivergences,
        totalDivergences,
        partial,
      },
    },
  });

  // Se ainda há transferências pendentes, para aqui — não avança status.
  if (partial) return;

  // Todas recebidas → tenta avançar pra SEPARADO via state machine.
  // Avança independente de divergência (operador revisa depois).
  const reason = hasDivergences
    ? `Todas as ${total} transferência${total > 1 ? "s" : ""} recebida${total > 1 ? "s" : ""} — com ${totalDivergences} divergência${totalDivergences > 1 ? "s" : ""} (revisão recomendada)`
    : `Todas as ${total} transferência${total > 1 ? "s" : ""} recebida${total > 1 ? "s" : ""} sem divergências`;

  try {
    await transitionDeliveryRequest({
      requestId:  deliveryRequestId,
      actorId:    "SYSTEM",
      actorRole:  "SYSTEM",
      toStatus:   "SEPARADO",
      metadata: {
        reason,
        separatedBy:    "SYSTEM",
        hasDivergences,
        totalDivergences,
      },
    });

    // Notifica vendedor + logística — state machine não dispara notificação automática.
    const dr = await prisma.deliveryRequest.findUnique({
      where:  { id: deliveryRequestId },
      select: { orderNumber: true, orderStore: { select: { code: true } } },
    });
    void notifyOrderSeparated({
      deliveryRequestId,
      orderNumber: dr?.orderNumber ?? null,
      storeCode:   dr?.orderStore?.code,
    });
  } catch (err) {
    // Fallback: gate falhou (ex: itens ainda indisponíveis no estoque).
    // Move pra READY (fluxo legado) e registra history manual já que pulou state machine.
    console.error(
      `[transferencia] gate SEPARADO falhou para ${deliveryRequestId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    await prisma.$transaction(async (tx) => {
      await tx.deliveryRequest.update({
        where: { id: deliveryRequestId },
        data:  { status: "READY", isComplete: true },
      });
      await tx.deliveryStatusHistory.create({
        data: {
          deliveryRequestId,
          fromStatus: currentStatus,
          toStatus:   "READY",
          reason:     `${reason} (fallback READY — gate SEPARADO falhou)`,
          metadata: {
            event: "TRANSFER_RECEIVED_COMPLETE_FALLBACK",
            hasDivergences,
            totalDivergences,
            gateError: err instanceof Error ? err.message : String(err),
          },
        },
      });
    });

    // Notifica mesmo no fallback — vendedor precisa saber que o pedido está pronto.
    const dr = await prisma.deliveryRequest.findUnique({
      where:  { id: deliveryRequestId },
      select: { orderNumber: true, orderStore: { select: { code: true } } },
    });
    void notifyOrderSeparated({
      deliveryRequestId,
      orderNumber: dr?.orderNumber ?? null,
      storeCode:   dr?.orderStore?.code,
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
  // Filtra transferências onde a loja aparece como origem OU destino.
  // Usado para auto-filtrar STORE_LEADER/SELLER pela sua loja.
  relatedToStoreId?: string;
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
    ...(filters.relatedToStoreId
      ? { OR: [{ fromStoreId: filters.relatedToStoreId }, { toStoreId: filters.relatedToStoreId }] }
      : {}),
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

// Fluxo simplificado (2026-05): a coleta passou a ser feita pelo motorista no app,
// não pelo operador. APPROVED já fica disponível para coleta e vai direto a IN_TRANSIT.
// As etapas PREPARING ("iniciar preparação") e PREPARED ("separada") saíram do caminho
// ativo. PREPARING/PREPARED continuam no enum por compatibilidade; PREPARED → IN_TRANSIT
// é mantido apenas para qualquer transferência legada que ainda esteja nesse estado.
const VALID_TRANSITIONS: Record<TransferStatus, TransferStatus[]> = {
  PENDING:    [TransferStatus.APPROVED,   TransferStatus.CANCELLED],
  APPROVED:   [TransferStatus.IN_TRANSIT, TransferStatus.CANCELLED],
  PREPARING:  [TransferStatus.PREPARED,   TransferStatus.CANCELLED],
  PREPARED:   [TransferStatus.IN_TRANSIT, TransferStatus.CANCELLED],
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
