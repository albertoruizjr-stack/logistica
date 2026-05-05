// __tests__/e2e/pilar1-staging.e2e.test.ts
//
// Teste E2E full-flow do Pilar 1 contra o banco real de staging.
// NÃO roda no CI padrão — requer E2E_STAGING=true.
//
// Uso:
//   E2E_STAGING=true \
//   E2E_STORE_A_ID=<id> E2E_STORE_B_ID=<id> E2E_OPERATOR_ID=<id> \
//   npx vitest run __tests__/e2e/pilar1-staging.e2e.test.ts

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, TransferPriority, ResolutionType } from "@prisma/client";
import {
  commitStock,
  citelTakesOver,
  markInTransit,
  reconcileTransfer,
  resolveDivergence,
} from "../../services/stock-ledger.service";

const SKIP = !process.env.E2E_STAGING;

const prisma = new PrismaClient();

// Preencher via variáveis de ambiente (obter IDs reais com: SELECT id, code FROM stores)
const STORE_A_ID    = process.env.E2E_STORE_A_ID   ?? "";
const STORE_B_ID    = process.env.E2E_STORE_B_ID   ?? "";
const OPERATOR_ID   = process.env.E2E_OPERATOR_ID  ?? "";
const PRODUCT_CODE  = process.env.E2E_PRODUCT_CODE ?? "TINT-E2E-001";
const PRODUCT_NAME  = process.env.E2E_PRODUCT_NAME ?? "Produto E2E Pilar1";

// Rastreia o que foi criado para limpeza no afterAll
const cleanup: { transfers: string[]; ledgers: string[]; divergences: string[] } = {
  transfers: [],
  ledgers:   [],
  divergences: [],
};

beforeAll(async () => {
  if (SKIP) return;
  if (!STORE_A_ID || !STORE_B_ID || !OPERATOR_ID) {
    throw new Error(
      "Defina E2E_STORE_A_ID, E2E_STORE_B_ID e E2E_OPERATOR_ID no ambiente antes de rodar o E2E."
    );
  }
});

afterAll(async () => {
  if (SKIP) return;
  for (const divId of cleanup.divergences) {
    await prisma.transferDivergence.deleteMany({ where: { id: divId } });
  }
  for (const transferId of cleanup.transfers) {
    await prisma.transferDivergence.deleteMany({ where: { transferId } });
    await prisma.transferHistory.deleteMany({ where: { transferId } });
    await prisma.transferItem.deleteMany({ where: { transferId } });
    await prisma.transfer.deleteMany({ where: { id: transferId } });
  }
  for (const ledgerId of cleanup.ledgers) {
    await prisma.stockLedgerEntry.deleteMany({ where: { ledgerId } });
    await prisma.stockLedger.deleteMany({ where: { id: ledgerId } });
  }
  await prisma.$disconnect();
});

// Helper: cria uma transferência mínima e rastreia para limpeza
async function createTransfer(qty: number) {
  const t = await prisma.transfer.create({
    data: {
      fromStoreId: STORE_A_ID,
      toStoreId:   STORE_B_ID,
      priority:    TransferPriority.ANTICIPATED,
      items: { create: [{ productCode: PRODUCT_CODE, productName: PRODUCT_NAME, quantity: qty, sentQty: qty }] },
    },
    include: { items: true },
  });
  cleanup.transfers.push(t.id);
  return t;
}

// Helper: garante ledger de destino e rastreia para limpeza
async function ensureDestLedger() {
  const ledger = await prisma.stockLedger.upsert({
    where:  { storeId_productCode: { storeId: STORE_B_ID, productCode: PRODUCT_CODE } },
    create: { storeId: STORE_B_ID, productCode: PRODUCT_CODE, productName: PRODUCT_NAME, qtdFisica: 10, qtdComprometida: 0, qtdEmTransito: 0 },
    update: {},
  });
  if (!cleanup.ledgers.includes(ledger.id)) cleanup.ledgers.push(ledger.id);
  return ledger;
}

describe.skipIf(SKIP)("E2E — Pilar 1: Estoque Comprometido (staging)", () => {

  it("1. commitStock trava qtdComprometida na loja de origem", async () => {
    const transfer = await createTransfer(2);

    const result = await commitStock({
      storeId:     STORE_A_ID,
      productCode: PRODUCT_CODE,
      productName: PRODUCT_NAME,
      qty:         2,
      transferId:  transfer.id,
      operatorId:  OPERATOR_ID,
    });

    expect(result.success).toBe(true);

    const ledger = await prisma.stockLedger.findUnique({
      where: { storeId_productCode: { storeId: STORE_A_ID, productCode: PRODUCT_CODE } },
    });
    expect(ledger).not.toBeNull();
    expect(ledger!.qtdComprometida).toBeGreaterThanOrEqual(2);
    if (ledger && !cleanup.ledgers.includes(ledger.id)) cleanup.ledgers.push(ledger.id);
  });

  it("2. markInTransit registra qtdEmTransito na loja destino", async () => {
    const transfer = await createTransfer(3);

    await markInTransit({
      toStoreId:   STORE_B_ID,
      productCode: PRODUCT_CODE,
      productName: PRODUCT_NAME,
      qty:         3,
      transferId:  transfer.id,
    });

    const ledger = await prisma.stockLedger.findUnique({
      where: { storeId_productCode: { storeId: STORE_B_ID, productCode: PRODUCT_CODE } },
    });
    expect(ledger).not.toBeNull();
    expect(ledger!.qtdEmTransito).toBeGreaterThanOrEqual(3);
    if (ledger && !cleanup.ledgers.includes(ledger.id)) cleanup.ledgers.push(ledger.id);
  });

  it("3. citelTakesOver libera qtdComprometida quando NF é informada", async () => {
    const transfer = await createTransfer(4);
    await commitStock({ storeId: STORE_A_ID, productCode: PRODUCT_CODE, productName: PRODUCT_NAME, qty: 4, transferId: transfer.id });

    const before = await prisma.stockLedger.findUniqueOrThrow({
      where: { storeId_productCode: { storeId: STORE_A_ID, productCode: PRODUCT_CODE } },
    });
    if (!cleanup.ledgers.includes(before.id)) cleanup.ledgers.push(before.id);

    await citelTakesOver({ storeId: STORE_A_ID, productCode: PRODUCT_CODE, qty: 4, transferId: transfer.id, operatorId: OPERATOR_ID });

    const after = await prisma.stockLedger.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.qtdComprometida).toBe(Math.max(0, before.qtdComprometida - 4));
  });

  it("4. reconcileTransfer sem divergência não cria TransferDivergence", async () => {
    const transfer = await createTransfer(5);
    await ensureDestLedger();
    await markInTransit({ toStoreId: STORE_B_ID, productCode: PRODUCT_CODE, productName: PRODUCT_NAME, qty: 5, transferId: transfer.id });

    const result = await reconcileTransfer({
      transferId:       transfer.id,
      sendingStoreId:   STORE_A_ID,
      receivingStoreId: STORE_B_ID,
      operatorId:       OPERATOR_ID,
      items: [{ transferItemId: transfer.items[0].id, productCode: PRODUCT_CODE, productName: PRODUCT_NAME, sentQty: 5, receivedQty: 5 }],
    });

    expect(result.hasDivergence).toBe(false);
    const divCount = await prisma.transferDivergence.count({ where: { transferId: transfer.id } });
    expect(divCount).toBe(0);
  });

  it("5. reconcileTransfer com divergência cria TransferDivergence e seta hasDivergence", async () => {
    const transfer = await createTransfer(6);
    await ensureDestLedger();
    await markInTransit({ toStoreId: STORE_B_ID, productCode: PRODUCT_CODE, productName: PRODUCT_NAME, qty: 6, transferId: transfer.id });

    const result = await reconcileTransfer({
      transferId:       transfer.id,
      sendingStoreId:   STORE_A_ID,
      receivingStoreId: STORE_B_ID,
      operatorId:       OPERATOR_ID,
      items: [{ transferItemId: transfer.items[0].id, productCode: PRODUCT_CODE, productName: PRODUCT_NAME, sentQty: 6, receivedQty: 4 }],
    });

    expect(result.hasDivergence).toBe(true);
    expect(result.divergences[0].divergenceQty).toBe(2);

    const div = await prisma.transferDivergence.findFirst({ where: { transferId: transfer.id } });
    expect(div).not.toBeNull();
    cleanup.divergences.push(div!.id);
  });

  it("6. resolveDivergence MISSING_PRODUCT ajusta qtdFisica e fecha divergência", async () => {
    const transfer = await createTransfer(3);
    const destLedger = await ensureDestLedger();
    await markInTransit({ toStoreId: STORE_B_ID, productCode: PRODUCT_CODE, productName: PRODUCT_NAME, qty: 3, transferId: transfer.id });

    const div = await prisma.transferDivergence.create({
      data: {
        transferId:        transfer.id,
        transferItemId:    transfer.items[0].id,
        ledgerId:          destLedger.id,
        productCode:       PRODUCT_CODE,
        productName:       PRODUCT_NAME,
        sentQty:           3,
        receivedQty:       2,
        divergenceQty:     1,   // positivo = faltou — MISSING_PRODUCT válido
        responsibleStoreId: STORE_B_ID,
        deadline:          new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    const ledgerAntes = await prisma.stockLedger.findUniqueOrThrow({ where: { id: destLedger.id } });

    await resolveDivergence({
      divergenceId:   div.id,
      resolutionType: ResolutionType.MISSING_PRODUCT,
      resolution:     "Produto não localizado no recebimento — E2E",
      resolvedById:   OPERATOR_ID,
    });

    const ledgerDepois = await prisma.stockLedger.findUniqueOrThrow({ where: { id: destLedger.id } });
    expect(ledgerDepois.qtdFisica).toBe(ledgerAntes.qtdFisica - 1);

    const divDepois = await prisma.transferDivergence.findUniqueOrThrow({ where: { id: div.id } });
    expect(divDepois.status).toBe("RESOLVED");
  });

  it("7. resolveDivergence MISSING_PRODUCT com divergenceQty negativo lança erro sem alterar ledger", async () => {
    const transfer = await createTransfer(2);
    const destLedger = await ensureDestLedger();

    const div = await prisma.transferDivergence.create({
      data: {
        transferId:        transfer.id,
        transferItemId:    transfer.items[0].id,
        ledgerId:          destLedger.id,
        productCode:       PRODUCT_CODE,
        productName:       PRODUCT_NAME,
        sentQty:           2,
        receivedQty:       3,
        divergenceQty:     -1,  // negativo = sobrou — MISSING_PRODUCT inválido
        responsibleStoreId: STORE_B_ID,
        deadline:          new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    cleanup.divergences.push(div.id);

    const ledgerAntes = await prisma.stockLedger.findUniqueOrThrow({ where: { id: destLedger.id } });

    await expect(
      resolveDivergence({
        divergenceId:   div.id,
        resolutionType: ResolutionType.MISSING_PRODUCT,
        resolution:     "teste de validação E2E",
        resolvedById:   OPERATOR_ID,
      })
    ).rejects.toThrow("Esta divergência indica que chegou produto a mais");

    // Ledger permanece inalterado após erro
    const ledgerDepois = await prisma.stockLedger.findUniqueOrThrow({ where: { id: destLedger.id } });
    expect(ledgerDepois.qtdFisica).toBe(ledgerAntes.qtdFisica);
    expect(ledgerDepois.version).toBe(ledgerAntes.version);
  });
});
