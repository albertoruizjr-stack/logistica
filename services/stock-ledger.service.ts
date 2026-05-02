// ──────────────────────────────────────────────
// STOCK LEDGER SERVICE — Pilar 1: Estoque Comprometido
//
// Cobre o gap PENDING → NF emitida:
// o período em que o sistema_logistica aprovou uma transferência
// mas o Citel ainda não tem documento correspondente.
//
// Fórmula central:
//   saldoDisponivelReal = Citel.saldoDisponivel − ledger.qtdComprometida
//
// Quando a NF é emitida (PREPARING), o Citel passa a ver via
// saldoReservadoPedidoFilial → reduzimos qtdComprometida para evitar dupla contagem.
// ──────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { StockLedgerEntryType, DivergenceStatus } from "@prisma/client";
import {
  getSaldoDisponivel,
  fetchEstoqueCitelBatch,
  getSaldoForEmpresa,
  isCitelConfigured,
} from "./citel.service";
import type {
  StockCommitInput,
  StockCommitResult,
  StockReconcileInput,
  StockReconcileResult,
  StockSnapshot,
  DivergenceResolveInput,
  ErpSyncResult,
} from "@/types/stock";

// ──────────────────────────────────────────────
// HELPERS INTERNOS
// ──────────────────────────────────────────────

async function getOrCreateLedger(
  tx: typeof prisma,
  storeId: string,
  productCode: string,
  productName: string
) {
  return tx.stockLedger.upsert({
    where: { storeId_productCode: { storeId, productCode } },
    create: { storeId, productCode, productName, qtdFisica: 0, qtdComprometida: 0, qtdEmTransito: 0 },
    update: {},
  });
}

// ──────────────────────────────────────────────
// COMMIT — trava estoque ao criar transferência
//
// 1. Consulta Citel para saldoDisponivel atual
// 2. Verifica: saldoDisponivel − qtdComprometida >= qty
// 3. Incrementa qtdComprometida com lock otimista (version)
// 4. Se Citel indisponível: usa qtdFisica do ledger como fallback
// ──────────────────────────────────────────────

export async function commitStock(
  input: StockCommitInput
): Promise<StockCommitResult> {
  // Busca codigoEmpresaCitel da loja
  const store = await prisma.store.findUnique({
    where: { id: input.storeId },
    select: { codigoEmpresaCitel: true },
  });

  const codigoEmpresaCitel = store?.codigoEmpresaCitel ?? null;

  // Consulta Citel se configurado
  let saldoDisponivelCitel: number | null = null;
  if (codigoEmpresaCitel && isCitelConfigured()) {
    const citel = await getSaldoDisponivel(input.productCode, codigoEmpresaCitel);
    saldoDisponivelCitel = citel?.saldoDisponivel ?? null;
  }

  return prisma.$transaction(async (tx) => {
    const ledger = await getOrCreateLedger(
      tx as typeof prisma,
      input.storeId,
      input.productCode,
      input.productName
    );

    // Determina saldo base para validação
    const saldoBase =
      saldoDisponivelCitel !== null
        ? saldoDisponivelCitel          // Citel disponível: usa saldo real
        : ledger.qtdFisica;             // Citel indisponível: fallback ao ledger

    const saldoDisponivelReal = saldoBase - ledger.qtdComprometida;

    if (saldoDisponivelReal < input.qty) {
      return {
        success: false,
        error: saldoDisponivelCitel === null
          ? ("CITEL_UNAVAILABLE" as const)
          : ("INSUFFICIENT_STOCK" as const),
        detail: {
          saldoDisponivelCitel: saldoBase,
          qtdComprometida: ledger.qtdComprometida,
          qtdSolicitada: input.qty,
        },
      };
    }

    // Lock otimista: só atualiza se version não mudou desde a leitura
    const updated = await (tx as typeof prisma).stockLedger.updateMany({
      where: { id: ledger.id, version: ledger.version },
      data: {
        qtdComprometida: { increment: input.qty },
        version: { increment: 1 },
      },
    });

    if (updated.count === 0) {
      return { success: false, error: "CONCURRENT_CONFLICT" as const };
    }

    await (tx as typeof prisma).stockLedgerEntry.create({
      data: {
        ledgerId: ledger.id,
        type: StockLedgerEntryType.COMMIT,
        qty: input.qty,
        field: "qtdComprometida",
        referenceId: input.transferId,
        referenceType: "transfer",
        createdById: input.operatorId,
        notes: saldoDisponivelCitel === null ? "Citel indisponível — fallback ao ledger" : null,
      },
    });

    return {
      success: true,
      saldoDisponivelReal: saldoDisponivelReal - input.qty,
    };
  });
}

// ──────────────────────────────────────────────
// RELEASE — libera estoque ao cancelar transferência
// ──────────────────────────────────────────────

export async function releaseStock(input: {
  storeId: string;
  productCode: string;
  qty: number;
  transferId: string;
  operatorId?: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const ledger = await (tx as typeof prisma).stockLedger.findUnique({
      where: { storeId_productCode: { storeId: input.storeId, productCode: input.productCode } },
    });

    if (!ledger || ledger.qtdComprometida <= 0) return;

    const releaseQty = Math.min(input.qty, ledger.qtdComprometida);

    await (tx as typeof prisma).stockLedger.update({
      where: { id: ledger.id },
      data: {
        qtdComprometida: { decrement: releaseQty },
        version: { increment: 1 },
      },
    });

    await (tx as typeof prisma).stockLedgerEntry.create({
      data: {
        ledgerId: ledger.id,
        type: StockLedgerEntryType.RELEASE,
        qty: releaseQty,
        field: "qtdComprometida",
        referenceId: input.transferId,
        referenceType: "transfer",
        createdById: input.operatorId,
      },
    });
  });
}

// ──────────────────────────────────────────────
// CITEL TAKES OVER — chamado quando NF é emitida (PREPARING)
//
// A partir deste ponto, o Citel enxerga a reserva via
// saldoReservadoPedidoFilial. Removemos qtdComprometida
// para evitar dupla contagem.
// ──────────────────────────────────────────────

export async function citelTakesOver(input: {
  storeId: string;
  productCode: string;
  qty: number;
  transferId: string;
  operatorId?: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const ledger = await (tx as typeof prisma).stockLedger.findUnique({
      where: { storeId_productCode: { storeId: input.storeId, productCode: input.productCode } },
    });

    if (!ledger || ledger.qtdComprometida <= 0) return;

    const releaseQty = Math.min(input.qty, ledger.qtdComprometida);

    await (tx as typeof prisma).stockLedger.update({
      where: { id: ledger.id },
      data: {
        qtdComprometida: { decrement: releaseQty },
        version: { increment: 1 },
      },
    });

    await (tx as typeof prisma).stockLedgerEntry.create({
      data: {
        ledgerId: ledger.id,
        type: StockLedgerEntryType.RELEASE,
        qty: releaseQty,
        field: "qtdComprometida",
        referenceId: input.transferId,
        referenceType: "transfer",
        createdById: input.operatorId,
        notes: "NF emitida — Citel passa a controlar via saldoReservadoPedidoFilial",
      },
    });
  });
}

// ──────────────────────────────────────────────
// MARK IN TRANSIT — registra qtdEmTransito na loja destino
// Chamado ao aprovar a transferência
// ──────────────────────────────────────────────

export async function markInTransit(input: {
  toStoreId: string;
  productCode: string;
  productName: string;
  qty: number;
  transferId: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const ledger = await getOrCreateLedger(
      tx as typeof prisma,
      input.toStoreId,
      input.productCode,
      input.productName
    );

    await (tx as typeof prisma).stockLedger.update({
      where: { id: ledger.id },
      data: {
        qtdEmTransito: { increment: input.qty },
        version: { increment: 1 },
      },
    });

    await (tx as typeof prisma).stockLedgerEntry.create({
      data: {
        ledgerId: ledger.id,
        type: StockLedgerEntryType.TRANSIT_IN,
        qty: input.qty,
        field: "qtdEmTransito",
        referenceId: input.transferId,
        referenceType: "transfer",
      },
    });
  });
}

// ──────────────────────────────────────────────
// RECONCILE — chamado ao receber transferência (RECEIVED)
//
// - Baixa qtdEmTransito na loja destino
// - Se sentQty != receivedQty → cria TransferDivergence
//   e retorna hasDivergence = true (bloqueia avanço para READY)
//
// Nota: qtdFisica NÃO é alterada aqui porque o Citel
// já atualiza saldoFisico ao dar entrada da NF.
// O próximo sync do ERP corrigirá qtdFisica automaticamente.
// ──────────────────────────────────────────────

export async function reconcileTransfer(
  input: StockReconcileInput
): Promise<StockReconcileResult> {
  const result: StockReconcileResult = { hasDivergence: false, divergences: [] };

  await prisma.$transaction(async (tx) => {
    for (const item of input.items) {
      // Baixa qtdEmTransito na loja destino (o que estava previsto chegar)
      const destLedger = await (tx as typeof prisma).stockLedger.findUnique({
        where: {
          storeId_productCode: {
            storeId: input.receivingStoreId,
            productCode: item.productCode,
          },
        },
      });

      if (destLedger && destLedger.qtdEmTransito > 0) {
        const decrementQty = Math.min(item.sentQty, destLedger.qtdEmTransito);
        await (tx as typeof prisma).stockLedger.update({
          where: { id: destLedger.id },
          data: {
            qtdEmTransito: { decrement: decrementQty },
            version: { increment: 1 },
          },
        });

        await (tx as typeof prisma).stockLedgerEntry.create({
          data: {
            ledgerId: destLedger.id,
            type: StockLedgerEntryType.RECONCILE_RECV,
            qty: item.receivedQty,
            field: "qtdEmTransito",
            referenceId: input.transferId,
            referenceType: "transfer",
            createdById: input.operatorId,
          },
        });
      }

      // Detecta divergência
      const divergenceQty = item.sentQty - item.receivedQty;
      if (Math.abs(divergenceQty) > 0.001) {
        const ledgerId = destLedger?.id;

        if (ledgerId) {
          await (tx as typeof prisma).transferDivergence.create({
            data: {
              transferId: input.transferId,
              transferItemId: item.transferItemId,
              ledgerId,
              productCode: item.productCode,
              productName: item.productName,
              sentQty: item.sentQty,
              receivedQty: item.receivedQty,
              divergenceQty,
              status: DivergenceStatus.PENDING,
            },
          });
        }

        result.hasDivergence = true;
        result.divergences.push({
          transferItemId: item.transferItemId,
          productCode: item.productCode,
          sentQty: item.sentQty,
          receivedQty: item.receivedQty,
          divergenceQty,
        });
      }
    }
  });

  return result;
}

// ──────────────────────────────────────────────
// RESOLVE DIVERGENCE — operador justifica e fecha
// ──────────────────────────────────────────────

export async function resolveDivergence(
  input: DivergenceResolveInput
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const div = await (tx as typeof prisma).transferDivergence.findUniqueOrThrow({
      where: { id: input.divergenceId },
    });

    if (input.adjustLedger && Math.abs(div.divergenceQty) > 0.001) {
      // divergenceQty positivo = faltou produto → reduz qtdFisica no destino
      await (tx as typeof prisma).stockLedger.update({
        where: { id: div.ledgerId },
        data: {
          qtdFisica: { decrement: div.divergenceQty },
          version: { increment: 1 },
        },
      });

      await (tx as typeof prisma).stockLedgerEntry.create({
        data: {
          ledgerId: div.ledgerId,
          type: StockLedgerEntryType.DIVERGENCE_ADJ,
          qty: -div.divergenceQty,
          field: "qtdFisica",
          referenceId: div.transferId,
          referenceType: "transfer",
          notes: input.resolution,
          createdById: input.resolvedById,
        },
      });
    }

    await (tx as typeof prisma).transferDivergence.update({
      where: { id: input.divergenceId },
      data: {
        status: DivergenceStatus.RESOLVED,
        resolution: input.resolution,
        resolvedById: input.resolvedById,
        resolvedAt: new Date(),
      },
    });
  });
}

// ──────────────────────────────────────────────
// SYNC DO ERP — atualiza qtdFisica a partir do Citel
//
// Chamado periodicamente (sync_estoque.py via API ou cron).
// Usa o endpoint batch para buscar múltiplos produtos/empresas.
// ──────────────────────────────────────────────

export async function syncFromCitel(
  storeId: string,
  codigoEmpresaCitel: string
): Promise<ErpSyncResult> {
  const result: ErpSyncResult = { synced: 0, created: 0, errors: 0, syncedAt: new Date() };

  // Busca todos os ledgers desta loja para saber quais produtos sincronizar
  const ledgers = await prisma.stockLedger.findMany({
    where: { storeId },
    select: { id: true, productCode: true, productName: true, qtdFisica: true },
  });

  if (ledgers.length === 0) return result;

  const codigosProdutos = ledgers.map((l) => l.productCode);
  const produtos = await fetchEstoqueCitelBatch(codigosProdutos, [codigoEmpresaCitel]);

  if (produtos.length === 0) {
    result.errors = ledgers.length;
    return result;
  }

  const produtoMap = new Map(produtos.map((p) => [p.codigoProduto, p]));

  for (const ledger of ledgers) {
    const produto = produtoMap.get(ledger.productCode);
    if (!produto) { result.errors++; continue; }

    const saldo = getSaldoForEmpresa(produto, codigoEmpresaCitel);
    if (!saldo) { result.errors++; continue; }

    const delta = saldo.saldoFisico - ledger.qtdFisica;

    await prisma.$transaction(async (tx) => {
      await (tx as typeof prisma).stockLedger.update({
        where: { id: ledger.id },
        data: {
          qtdFisica: saldo.saldoFisico,
          syncedAt: new Date(),
          version: { increment: 1 },
        },
      });

      if (Math.abs(delta) > 0.001) {
        await (tx as typeof prisma).stockLedgerEntry.create({
          data: {
            ledgerId: ledger.id,
            type: StockLedgerEntryType.SYNC_ERP,
            qty: delta,
            field: "qtdFisica",
            referenceType: "manual",
            notes: `sync Citel empresa ${codigoEmpresaCitel}`,
          },
        });
      }
    });

    result.synced++;
  }

  return result;
}

// ──────────────────────────────────────────────
// SNAPSHOT — visão atual do estoque para UI e sistema_compras
// ──────────────────────────────────────────────

export async function getStockSnapshot(filters?: {
  storeId?: string;
  productCode?: string;
}): Promise<StockSnapshot[]> {
  const ledgers = await prisma.stockLedger.findMany({
    where: {
      ...(filters?.storeId ? { storeId: filters.storeId } : {}),
      ...(filters?.productCode ? { productCode: filters.productCode } : {}),
    },
    include: {
      store: { select: { code: true, name: true, codigoEmpresaCitel: true } },
    },
  });

  return ledgers.map((l) => ({
    storeId: l.storeId,
    storeCode: l.store.code,
    storeName: l.store.name,
    codigoEmpresaCitel: l.store.codigoEmpresaCitel ?? "",
    productCode: l.productCode,
    productName: l.productName,
    saldoFisico: l.qtdFisica,
    saldoDisponivelCitel: l.qtdFisica,         // melhor estimativa sem chamar Citel
    qtdComprometida: l.qtdComprometida,
    qtdEmTransito: l.qtdEmTransito,
    saldoDisponivelReal: l.qtdFisica - l.qtdComprometida,
    ledgerSyncedAt: l.syncedAt,
  }));
}
