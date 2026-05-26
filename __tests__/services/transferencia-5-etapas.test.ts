// ─────────────────────────────────────────────────────────────────────────────
// TESTES — Transferência em 5 etapas
//
// Estratégia: mesmo padrão de pilar1-stock-lock.test.ts (Prisma mockado
// in-memory + mock do Citel service). Não toca o banco real — a migration
// SQL da Task 1 só é aplicada na Task 26.
//
// Organização (preenchida ao longo das tasks 4-10):
//   T4. indicateOrigin   (PENDING → AWAITING_APPROVAL)
//   T5. approveTransfer  (AWAITING_APPROVAL → READY_TO_COLLECT)
//   T6. rejectTransferAtOrigin (AWAITING_APPROVAL → PENDING)
//   T7. collectTransfer  (READY_TO_COLLECT → IN_TRANSIT)
//   T8. deliverTransfer  (IN_TRANSIT → DELIVERED)
//   T9. cancelTransfer   (matriz por status)
//   T10. createTransfer auto-split + VALID_TRANSITIONS
// ─────────────────────────────────────────────────────────────────────────────

import { vi, describe, it, expect, beforeEach } from "vitest";
import { TransferStatus, TransferPriority } from "@prisma/client";

const mocks = vi.hoisted(() => {
  type LedgerRow = {
    id: string; storeId: string; productCode: string; productName: string;
    qtdFisica: number; qtdComprometida: number; qtdEmTransito: number;
    version: number; syncedAt: Date | null;
  };
  type TransferItemRow = {
    id: string; transferId: string; productCode: string; productName: string;
    quantity: number; sentQty: number | null; receivedQty: number | null; unit: string;
    teNumber: string | null; nfCitelNumero: string | null; nfCitelEmitidaAt: Date | null;
    collectedAt: Date | null; collectConfirmed: boolean;
  };
  type TransferRow = {
    id: string; status: string;
    fromStoreId: string | null; toStoreId: string;
    priority: string; nfCitelNumero: string | null;
    teNumber: string | null; nfCitelEmitidaAt: Date | null;
    originIndicatedAt: Date | null; originIndicatedById: string | null;
    approvedAt: Date | null; approvedById: string | null;
    collectedAt: Date | null; receivedAt: Date | null; deliveredAt: Date | null;
    cancelledAt: Date | null;
    hasDivergence: boolean; divergenceCount: number;
    deliveryRequestId: string | null; items: TransferItemRow[];
    fromStore: object | null; toStore: object; deliveryRequest: object | null;
    [key: string]: unknown;
  };

  const db = {
    ledgers:          new Map<string, LedgerRow>(),
    transfers:        new Map<string, TransferRow>(),
    histories:        [] as unknown[],
    ledgerEntries:    [] as unknown[],
    divergences:      [] as unknown[],
    deliveryRequests: new Map<string, unknown>(),
    transferIdSeq:    0,
  };

  function resetDb() {
    db.ledgers.clear(); db.transfers.clear();
    db.histories = []; db.ledgerEntries = []; db.divergences = [];
    db.deliveryRequests.clear(); db.transferIdSeq = 0;
  }

  function seedLedger(
    storeId: string, productCode: string,
    overrides: Partial<Omit<LedgerRow, "id" | "storeId" | "productCode">> = {}
  ): LedgerRow {
    const k   = `${storeId}_${productCode}`;
    const row: LedgerRow = {
      id: `ledger_${k}`, storeId, productCode, productName: "Produto Teste",
      qtdFisica: 0, qtdComprometida: 0, qtdEmTransito: 0,
      version: 0, syncedAt: null, ...overrides,
    };
    db.ledgers.set(k, row);
    return row;
  }

  function seedTransfer(
    status: string,
    overrides: Partial<TransferRow> = {}
  ): TransferRow {
    db.transferIdSeq++;
    const id = `transfer_${db.transferIdSeq}`;
    const itemId = `item_${db.transferIdSeq}_1`;
    const t: TransferRow = {
      id, status,
      fromStoreId: null, toStoreId: "store-b",
      priority: "ANTICIPATED",
      nfCitelNumero: null, teNumber: null, nfCitelEmitidaAt: null,
      originIndicatedAt: null, originIndicatedById: null,
      approvedAt: null, approvedById: null,
      collectedAt: null, receivedAt: null, deliveredAt: null, cancelledAt: null,
      hasDivergence: false, divergenceCount: 0,
      deliveryRequestId: null,
      items: [{
        id: itemId, transferId: id,
        productCode: "TINT-001", productName: "Tinta Branca 18L",
        quantity: 3, sentQty: null, receivedQty: null, unit: "UN",
        teNumber: null, nfCitelNumero: null, nfCitelEmitidaAt: null,
        collectedAt: null, collectConfirmed: false,
      }],
      fromStore: null,
      toStore: { id: "store-b", code: "B", name: "Loja B" },
      deliveryRequest: null,
      ...overrides,
    };
    db.transfers.set(id, t);
    return t;
  }

  function applyData(current: Record<string, unknown>, data: Record<string, unknown>) {
    const r: Record<string, unknown> = { ...current };
    for (const [k, v] of Object.entries(data)) {
      if (v !== null && typeof v === "object" && "increment" in v)
        r[k] = ((r[k] as number) ?? 0) + (v as { increment: number }).increment;
      else if (v !== null && typeof v === "object" && "decrement" in v)
        r[k] = ((r[k] as number) ?? 0) - (v as { decrement: number }).decrement;
      else if (k !== "items")
        r[k] = v;
    }
    return r;
  }

  const p: Record<string, unknown> = {};

  p.store = {
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.id === "store-a") return { id: "store-a", codigoEmpresaCitel: "001", lat: -23.5, lng: -46.6, active: true, code: "A", name: "Loja A" };
      if (where.id === "store-b") return { id: "store-b", codigoEmpresaCitel: "002", lat: -23.6, lng: -46.7, active: true, code: "B", name: "Loja B" };
      return null;
    }),
    findMany: vi.fn(async () => []),
  };

  p.stockLedger = {
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.id)
        return [...db.ledgers.values()].find(l => l.id === where.id) ?? null;
      const k = `${where.storeId_productCode.storeId}_${where.storeId_productCode.productCode}`;
      return db.ledgers.get(k) ?? null;
    }),
    upsert: vi.fn(async ({ where, create }: any) => {
      const k = `${where.storeId_productCode.storeId}_${where.storeId_productCode.productCode}`;
      if (!db.ledgers.has(k))
        db.ledgers.set(k, { id: `ledger_${k}`, version: 0, syncedAt: null, qtdFisica: 0, qtdComprometida: 0, qtdEmTransito: 0, ...create });
      return db.ledgers.get(k)!;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const row = [...db.ledgers.values()].find(l => l.id === where.id);
      if (!row) throw new Error(`StockLedger ${where.id} não encontrado`);
      const k = `${row.storeId}_${row.productCode}`;
      const updated = applyData(row as unknown as Record<string, unknown>, data) as unknown as LedgerRow;
      db.ledgers.set(k, updated);
      return updated;
    }),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const row = [...db.ledgers.values()].find(l => l.id === where.id && l.version === where.version);
      if (!row) return { count: 0 };
      const k = `${row.storeId}_${row.productCode}`;
      const updated = applyData(row as unknown as Record<string, unknown>, data) as unknown as LedgerRow;
      db.ledgers.set(k, updated);
      return { count: 1 };
    }),
  };

  p.stockLedgerEntry = {
    create: vi.fn(async ({ data }: any) => {
      const e = { id: `entry_${db.ledgerEntries.length + 1}`, ...data };
      db.ledgerEntries.push(e); return e;
    }),
  };

  p.transfer = {
    create: vi.fn(async ({ data, include }: any) => {
      db.transferIdSeq++;
      const id = `transfer_${db.transferIdSeq}`;
      const itemsInput = (data.items?.create ?? []) as any[];
      const items: TransferItemRow[] = itemsInput.map((item, i) => ({
        id: `item_${db.transferIdSeq}_${i + 1}`, transferId: id,
        productCode: item.productCode, productName: item.productName,
        quantity: item.quantity, sentQty: null, receivedQty: null,
        unit: item.unit ?? "UN",
        teNumber: null, nfCitelNumero: null, nfCitelEmitidaAt: null,
        collectedAt: null, collectConfirmed: false,
      }));
      const t: TransferRow = {
        id, status: data.status ?? "PENDING",
        fromStoreId: data.fromStoreId ?? null,
        toStoreId:   data.toStoreId,
        priority:    data.priority ?? "ANTICIPATED",
        nfCitelNumero: null, teNumber: null, nfCitelEmitidaAt: null,
        originIndicatedAt: null, originIndicatedById: null,
        approvedAt: null, approvedById: null,
        collectedAt: null, receivedAt: null, deliveredAt: null, cancelledAt: null,
        hasDivergence: false, divergenceCount: 0,
        deliveryRequestId: data.deliveryRequestId ?? null,
        items,
        fromStore: data.fromStoreId
          ? { id: data.fromStoreId, code: data.fromStoreId, name: data.fromStoreId }
          : null,
        toStore: { id: data.toStoreId, code: data.toStoreId, name: data.toStoreId },
        deliveryRequest: null,
      };
      db.transfers.set(id, t);
      void include;
      return t;
    }),
    update: vi.fn(async ({ where, data, include }: any) => {
      const t = db.transfers.get(where.id);
      if (!t) throw new Error(`Transfer ${where.id} não encontrado`);
      const updated = { ...t, ...applyData(t as unknown as Record<string, unknown>, data) } as TransferRow;
      // Quando indicateOrigin define fromStoreId, popula fromStore com o stub
      if (updated.fromStoreId && !updated.fromStore) {
        updated.fromStore =
          updated.fromStoreId === "store-a" ? { id: "store-a", code: "A", name: "Loja A" }
          : updated.fromStoreId === "store-b" ? { id: "store-b", code: "B", name: "Loja B" }
          : { id: updated.fromStoreId, code: updated.fromStoreId, name: updated.fromStoreId };
      }
      db.transfers.set(where.id, updated);
      // Honra `include` superficialmente: já temos items/fromStore/toStore embutidos.
      void include;
      return updated;
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: any) => {
      const t = db.transfers.get(where.id);
      if (!t) throw new Error(`Transfer ${where.id} não encontrado`);
      return t;
    }),
    findMany: vi.fn(async ({ where }: any) =>
      [...db.transfers.values()].filter(t =>
        !where?.deliveryRequestId || t.deliveryRequestId === where.deliveryRequestId
      )
    ),
  };

  p.transferItem = {
    update: vi.fn(async ({ where, data }: any) => {
      for (const t of db.transfers.values()) {
        const item = t.items.find(i => i.id === where.id);
        if (item) { Object.assign(item, data); return item; }
      }
      throw new Error(`TransferItem ${where.id} não encontrado`);
    }),
  };

  p.transferHistory = {
    create: vi.fn(async ({ data }: any) => {
      const h = { id: `hist_${db.histories.length + 1}`, ...data };
      db.histories.push(h);
      return h;
    }),
  };
  p.transferDivergence = {
    create: vi.fn(async ({ data }: any) => {
      const d = { id: `div_${db.divergences.length + 1}`, ...data };
      db.divergences.push(d); return d;
    }),
  };
  p.deliveryRequest = {
    update: vi.fn(async ({ where, data }: any) => {
      const req = db.deliveryRequests.get(where.id) ?? { id: where.id };
      const updated = { ...(req as object), ...data };
      db.deliveryRequests.set(where.id, updated); return updated;
    }),
  };
  p.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(p));

  const citel = {
    getSaldoDisponivel:    vi.fn(),
    isCitelConfigured:     vi.fn(() => true),
    getSaldoForEmpresa:    vi.fn(),
    fetchEstoqueCitelBatch: vi.fn(),
  };

  return { prisma: p, db, citel, resetDb, seedLedger, seedTransfer };
});

vi.mock("@/lib/prisma",         () => ({ prisma: mocks.prisma }));
vi.mock("@/services/citel.service", () => mocks.citel);
vi.mock("@/services/erp.service",   () => ({ fetchStockByProduct: vi.fn() }));

import {
  indicateOrigin,
  approveTransfer,
  rejectTransferAtOrigin,
  collectTransfer,
  deliverTransfer,
  cancelTransfer,
  createTransfer,
} from "@/services/transferencia.service";

const { db, resetDb, seedLedger, seedTransfer, citel } = mocks;

// Sinaliza ao TS que TransferPriority é usado no enum-only import acima.
void TransferPriority;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers compartilhados entre tasks 5-9
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cria uma Transfer em AWAITING_APPROVAL via PENDING + indicateOrigin.
 * Default: store-b destino, store-a origem indicada, 3 unidades de TINT-001.
 */
async function setupTransferInAwaitingApproval(
  overrides: { fromStoreId?: string; toStoreId?: string } = {},
) {
  const fromStoreId = overrides.fromStoreId ?? "store-a";
  const toStoreId   = overrides.toStoreId   ?? "store-b";
  seedLedger(fromStoreId, "TINT-001", { qtdFisica: 10, qtdComprometida: 0 });
  const t = seedTransfer(TransferStatus.PENDING, { fromStoreId: null, toStoreId });
  await indicateOrigin(t.id, fromStoreId, "user-132");
  return db.transfers.get(t.id)!;
}

/**
 * Cria uma Transfer em READY_TO_COLLECT — fluxo PENDING → AWAITING_APPROVAL
 * via indicateOrigin → READY_TO_COLLECT via approveTransfer com TE.
 */
async function setupTransferInReadyToCollect(
  overrides: { docType?: "TE" | "NF" } = {},
) {
  const t = await setupTransferInAwaitingApproval();
  const docInput = overrides.docType === "NF"
    ? { nfCitelNumero: "NF-50001" }
    : { teNumber: "TE-50001" };
  await approveTransfer(t.id, docInput, "user-067");
  return db.transfers.get(t.id)!;
}

/**
 * Cria uma Transfer em IN_TRANSIT — fluxo completo até coleta.
 * Default: TE (não fiscal); passe docType "NF" para variar.
 */
async function setupTransferInTransit(
  overrides: { docType?: "TE" | "NF" } = {},
) {
  const t = await setupTransferInReadyToCollect(overrides);
  await collectTransfer(t.id, {
    photoUrl:  "https://supa.example/coleta.jpg",
    photoPath: "transfers/x/coleta.jpg",
  }, "driver-1");
  return db.transfers.get(t.id)!;
}

// ═════════════════════════════════════════════════════════════════════════════
// Task 4 — indicateOrigin (PENDING → AWAITING_APPROVAL)
// ═════════════════════════════════════════════════════════════════════════════

describe("Task 4 — indicateOrigin", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
    citel.isCitelConfigured.mockReturnValue(true);
    citel.getSaldoDisponivel.mockResolvedValue({ saldoDisponivel: 100, saldoFisico: 100 });
  });

  it("PENDING → AWAITING_APPROVAL preenche fromStoreId, originIndicatedAt e commita estoque", async () => {
    seedLedger("store-a", "TINT-001", { qtdFisica: 10, qtdComprometida: 0 });
    const t = seedTransfer(TransferStatus.PENDING, { fromStoreId: null });

    const updated = await indicateOrigin(t.id, "store-a", "user-132");

    // Status e campos de origem
    expect(updated.status).toBe(TransferStatus.AWAITING_APPROVAL);
    expect(updated.fromStoreId).toBe("store-a");
    expect(updated.originIndicatedAt).toBeInstanceOf(Date);
    expect(updated.originIndicatedById).toBe("user-132");

    // Ledger comitado na origem
    const ledger = db.ledgers.get("store-a_TINT-001")!;
    expect(ledger.qtdComprometida).toBe(3);
    expect(ledger.version).toBe(1);

    // Histórico registrado
    const history = db.histories.find(
      (h: any) => h.transferId === t.id && h.toStatus === TransferStatus.AWAITING_APPROVAL,
    );
    expect(history).toBeDefined();
    expect((history as any).fromStatus).toBe(TransferStatus.PENDING);
    expect((history as any).changedById).toBe("user-132");
  });

  it("rejeita se estoque insuficiente na origem indicada", async () => {
    seedLedger("store-a", "TINT-001", { qtdFisica: 1, qtdComprometida: 0 });
    citel.getSaldoDisponivel.mockResolvedValue({ saldoDisponivel: 1, saldoFisico: 1 });
    const t = seedTransfer(TransferStatus.PENDING, { fromStoreId: null });

    await expect(indicateOrigin(t.id, "store-a", "user-132"))
      .rejects.toThrow(/insuficiente/i);

    // Estado não mudou
    const tf = db.transfers.get(t.id)!;
    expect(tf.status).toBe(TransferStatus.PENDING);
    expect(tf.fromStoreId).toBeNull();
    expect(db.ledgers.get("store-a_TINT-001")!.qtdComprometida).toBe(0);
  });

  it("rejeita se status atual não é PENDING", async () => {
    const t = seedTransfer(TransferStatus.AWAITING_APPROVAL, { fromStoreId: "store-a" });

    await expect(indicateOrigin(t.id, "store-a", "user-132"))
      .rejects.toThrow(/PENDING/);
  });

  it("rejeita se fromStoreId é igual a toStoreId", async () => {
    const t = seedTransfer(TransferStatus.PENDING, { fromStoreId: null, toStoreId: "store-a" });

    await expect(indicateOrigin(t.id, "store-a", "user-132"))
      .rejects.toThrow(/destino/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Task 5 — approveTransfer (AWAITING_APPROVAL → READY_TO_COLLECT)
// ═════════════════════════════════════════════════════════════════════════════

describe("Task 5 — approveTransfer", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
    citel.isCitelConfigured.mockReturnValue(true);
    citel.getSaldoDisponivel.mockResolvedValue({ saldoDisponivel: 100, saldoFisico: 100 });
  });

  it("com TE: AWAITING_APPROVAL → READY_TO_COLLECT, persiste TE no item, qtdEmTransito++", async () => {
    const t = await setupTransferInAwaitingApproval();

    const updated = await approveTransfer(t.id, { teNumber: "TE-12345" }, "user-067");

    expect(updated.status).toBe(TransferStatus.READY_TO_COLLECT);
    expect(updated.approvedAt).toBeInstanceOf(Date);
    expect(updated.approvedById).toBe("user-067");

    const tf = db.transfers.get(t.id)!;
    expect(tf.items[0].teNumber).toBe("TE-12345");
    expect(tf.items[0].nfCitelNumero).toBeNull();

    // qtdEmTransito incrementada no destino
    const dest = db.ledgers.get("store-b_TINT-001")!;
    expect(dest.qtdEmTransito).toBe(3);

    // qtdComprometida na origem permanece (TE não dispara citelTakesOver)
    const origem = db.ledgers.get("store-a_TINT-001")!;
    expect(origem.qtdComprometida).toBe(3);
  });

  it("com NF: dispara citelTakesOver (libera qtdComprometida na origem)", async () => {
    const t = await setupTransferInAwaitingApproval();
    const before = db.ledgers.get("store-a_TINT-001")!.qtdComprometida;
    expect(before).toBe(3); // sanidade

    await approveTransfer(t.id, { nfCitelNumero: "NF-99999" }, "user-067");

    const after = db.ledgers.get("store-a_TINT-001")!.qtdComprometida;
    expect(after).toBe(0); // Citel passa a controlar

    const tf = db.transfers.get(t.id)!;
    expect(tf.items[0].nfCitelNumero).toBe("NF-99999");
    expect(tf.items[0].nfCitelEmitidaAt).toBeInstanceOf(Date);
    expect(tf.items[0].teNumber).toBeNull();
  });

  it("rejeita quando nenhum documento é informado", async () => {
    const t = await setupTransferInAwaitingApproval();
    await expect(approveTransfer(t.id, {}, "user-067")).rejects.toThrow(/TE ou NF/i);
  });

  it("rejeita quando ambos TE e NF são informados", async () => {
    const t = await setupTransferInAwaitingApproval();
    await expect(
      approveTransfer(t.id, { teNumber: "TE-1", nfCitelNumero: "NF-1" }, "user-067"),
    ).rejects.toThrow(/TE ou NF/i);
  });

  it("rejeita se status atual não é AWAITING_APPROVAL", async () => {
    const t = seedTransfer(TransferStatus.PENDING, { fromStoreId: null });
    await expect(
      approveTransfer(t.id, { teNumber: "TE-1" }, "user-067"),
    ).rejects.toThrow(/AWAITING_APPROVAL/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Task 6 — rejectTransferAtOrigin (AWAITING_APPROVAL → PENDING)
// ═════════════════════════════════════════════════════════════════════════════

describe("Task 6 — rejectTransferAtOrigin", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
    citel.isCitelConfigured.mockReturnValue(true);
    citel.getSaldoDisponivel.mockResolvedValue({ saldoDisponivel: 100, saldoFisico: 100 });
  });

  it("AWAITING_APPROVAL → PENDING libera commitStock e limpa fromStoreId/originIndicated*", async () => {
    const t = await setupTransferInAwaitingApproval();
    expect(db.ledgers.get("store-a_TINT-001")!.qtdComprometida).toBe(3);

    const updated = await rejectTransferAtOrigin(t.id, "Sem estoque físico real", "user-067");

    expect(updated.status).toBe(TransferStatus.PENDING);
    expect(updated.fromStoreId).toBeNull();
    expect(updated.originIndicatedAt).toBeNull();
    expect(updated.originIndicatedById).toBeNull();

    // qtdComprometida liberada na origem que foi indicada
    expect(db.ledgers.get("store-a_TINT-001")!.qtdComprometida).toBe(0);

    // History registra o motivo
    const history = db.histories.find(
      (h: any) => h.transferId === t.id && h.toStatus === TransferStatus.PENDING,
    );
    expect(history).toBeDefined();
    expect((history as any).notes).toMatch(/Sem estoque físico real/);
  });

  it("rejeita se status atual não é AWAITING_APPROVAL", async () => {
    const t = seedTransfer(TransferStatus.PENDING, { fromStoreId: null });
    await expect(
      rejectTransferAtOrigin(t.id, "motivo", "user-067"),
    ).rejects.toThrow(/AWAITING_APPROVAL/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Task 7 — collectTransfer (READY_TO_COLLECT → IN_TRANSIT)
// ═════════════════════════════════════════════════════════════════════════════

describe("Task 7 — collectTransfer", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
    citel.isCitelConfigured.mockReturnValue(true);
    citel.getSaldoDisponivel.mockResolvedValue({ saldoDisponivel: 100, saldoFisico: 100 });
  });

  it("READY_TO_COLLECT → IN_TRANSIT marca item.collectConfirmed e salva foto", async () => {
    const t = await setupTransferInReadyToCollect();

    const updated = await collectTransfer(t.id, {
      photoUrl:  "https://supa.example/coleta.jpg",
      photoPath: "transfers/x/coleta.jpg",
    }, "driver-1");

    expect(updated.status).toBe(TransferStatus.IN_TRANSIT);
    expect((updated as any).collectPhotoUrl).toBe("https://supa.example/coleta.jpg");
    expect((updated as any).collectPhotoPath).toBe("transfers/x/coleta.jpg");
    expect((updated as any).collectedAt).toBeInstanceOf(Date);

    const tf = db.transfers.get(t.id)!;
    expect(tf.items[0].collectedAt).toBeInstanceOf(Date);
    expect(tf.items[0].collectConfirmed).toBe(true);

    const history = db.histories.find(
      (h: any) => h.transferId === t.id && h.toStatus === TransferStatus.IN_TRANSIT,
    );
    expect(history).toBeDefined();
  });

  it("rejeita se status atual não é READY_TO_COLLECT", async () => {
    const t = await setupTransferInAwaitingApproval();
    await expect(
      collectTransfer(t.id, { photoUrl: "u", photoPath: "p" }, "driver-1"),
    ).rejects.toThrow(/READY_TO_COLLECT/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Task 8 — deliverTransfer (IN_TRANSIT → DELIVERED)
// ═════════════════════════════════════════════════════════════════════════════

describe("Task 8 — deliverTransfer", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
    citel.isCitelConfigured.mockReturnValue(true);
    citel.getSaldoDisponivel.mockResolvedValue({ saldoDisponivel: 100, saldoFisico: 100 });
  });

  it("IN_TRANSIT → DELIVERED reconcilia ledger (zera qtdEmTransito no destino)", async () => {
    const t = await setupTransferInTransit();
    expect(db.ledgers.get("store-b_TINT-001")!.qtdEmTransito).toBe(3);

    const updated = await deliverTransfer(t.id, {
      photoUrl:      "https://supa.example/entrega.jpg",
      photoPath:     "transfers/x/entrega.jpg",
      recipientName: "Maria Silva",
      receivedQty:   3,
    }, "driver-1");

    expect(updated.status).toBe(TransferStatus.DELIVERED);
    expect((updated as any).deliveredAt).toBeInstanceOf(Date);
    expect((updated as any).deliveredById).toBe("driver-1");
    expect((updated as any).recipientName).toBe("Maria Silva");

    // qtdEmTransito zerada no destino
    expect(db.ledgers.get("store-b_TINT-001")!.qtdEmTransito).toBe(0);

    // sem divergência
    expect((updated as any).hasDivergence).toBe(false);
  });

  it("registra divergência se receivedQty < quantity", async () => {
    const t = await setupTransferInTransit();

    const updated = await deliverTransfer(t.id, {
      photoUrl:      "https://supa.example/entrega.jpg",
      photoPath:     "transfers/x/entrega.jpg",
      recipientName: "João",
      receivedQty:   2, // enviou 3, recebeu 2
    }, "driver-1");

    expect((updated as any).hasDivergence).toBe(true);
    expect(db.divergences).toHaveLength(1);
    expect(db.divergences[0]).toMatchObject({
      sentQty: 3, receivedQty: 2, divergenceQty: 1,
    });

    // persistido na Transfer também
    const tf = db.transfers.get(t.id)!;
    expect(tf.hasDivergence).toBe(true);
    expect(tf.divergenceCount).toBe(1);
  });

  it("rejeita se status atual não é IN_TRANSIT", async () => {
    const t = await setupTransferInReadyToCollect();
    await expect(deliverTransfer(t.id, {
      photoUrl: "u", photoPath: "p", recipientName: "X", receivedQty: 1,
    }, "driver-1")).rejects.toThrow(/IN_TRANSIT/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Task 9 — cancelTransfer (matriz por status)
// ═════════════════════════════════════════════════════════════════════════════
//
// Matriz de side effects:
//   PENDING:           nada
//   AWAITING_APPROVAL: releaseStock na origem
//   READY_TO_COLLECT TE: releaseStock + cancelTransit
//   READY_TO_COLLECT NF: só cancelTransit (Citel já liberou)
//   IN_TRANSIT TE:       releaseStock + cancelTransit
//   IN_TRANSIT NF:       só cancelTransit
//   DELIVERED/CANCELLED: erro (terminal)

describe("Task 9 — cancelTransfer (matriz)", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
    citel.isCitelConfigured.mockReturnValue(true);
    citel.getSaldoDisponivel.mockResolvedValue({ saldoDisponivel: 100, saldoFisico: 100 });
  });

  it("PENDING → CANCELLED: ledger inalterado", async () => {
    const t = seedTransfer(TransferStatus.PENDING, { fromStoreId: null });
    // sem ledger seedado — pra confirmar que nada é tocado
    const updated = await cancelTransfer(t.id, "teste", "user-1");

    expect(updated.status).toBe(TransferStatus.CANCELLED);
    expect((updated as any).cancelledAt).toBeInstanceOf(Date);
    expect(db.ledgers.size).toBe(0);
  });

  it("AWAITING_APPROVAL → CANCELLED: releaseStock na origem", async () => {
    const t = await setupTransferInAwaitingApproval();
    expect(db.ledgers.get("store-a_TINT-001")!.qtdComprometida).toBe(3);

    await cancelTransfer(t.id, "operadora trocou de ideia", "user-1");

    expect(db.ledgers.get("store-a_TINT-001")!.qtdComprometida).toBe(0);
  });

  it("READY_TO_COLLECT com TE: releaseStock + cancelTransit", async () => {
    const t = await setupTransferInReadyToCollect({ docType: "TE" });
    expect(db.ledgers.get("store-a_TINT-001")!.qtdComprometida).toBe(3);
    expect(db.ledgers.get("store-b_TINT-001")!.qtdEmTransito).toBe(3);

    await cancelTransfer(t.id, "teste", "user-1");

    expect(db.ledgers.get("store-a_TINT-001")!.qtdComprometida).toBe(0); // releaseStock
    expect(db.ledgers.get("store-b_TINT-001")!.qtdEmTransito).toBe(0);   // cancelTransit
  });

  it("READY_TO_COLLECT com NF: só cancelTransit (Citel controla)", async () => {
    const t = await setupTransferInReadyToCollect({ docType: "NF" });
    // NF já disparou citelTakesOver: qtdComprometida na origem foi zerada
    expect(db.ledgers.get("store-a_TINT-001")!.qtdComprometida).toBe(0);
    expect(db.ledgers.get("store-b_TINT-001")!.qtdEmTransito).toBe(3);
    const versionAntes = db.ledgers.get("store-a_TINT-001")!.version;

    await cancelTransfer(t.id, "teste", "user-1");

    // Origem não é tocada (Citel controla agora)
    expect(db.ledgers.get("store-a_TINT-001")!.qtdComprometida).toBe(0);
    expect(db.ledgers.get("store-a_TINT-001")!.version).toBe(versionAntes);

    // Trânsito no destino é cancelado
    expect(db.ledgers.get("store-b_TINT-001")!.qtdEmTransito).toBe(0);
  });

  it("IN_TRANSIT com TE: releaseStock + cancelTransit", async () => {
    const t = await setupTransferInTransit({ docType: "TE" });
    expect(db.ledgers.get("store-a_TINT-001")!.qtdComprometida).toBe(3);
    expect(db.ledgers.get("store-b_TINT-001")!.qtdEmTransito).toBe(3);

    await cancelTransfer(t.id, "teste", "user-1");

    expect(db.ledgers.get("store-a_TINT-001")!.qtdComprometida).toBe(0);
    expect(db.ledgers.get("store-b_TINT-001")!.qtdEmTransito).toBe(0);
  });

  it("DELIVERED: rejeita (terminal)", async () => {
    const t = await setupTransferInTransit();
    await deliverTransfer(t.id, {
      photoUrl: "u", photoPath: "p", recipientName: "X", receivedQty: 3,
    }, "driver-1");

    await expect(cancelTransfer(t.id, "tarde demais", "user-1"))
      .rejects.toThrow(/terminal/i);
  });

  it("CANCELLED: rejeita (já terminal)", async () => {
    const t = seedTransfer(TransferStatus.PENDING, { fromStoreId: null });
    await cancelTransfer(t.id, "primeiro cancel", "user-1");

    await expect(cancelTransfer(t.id, "segundo cancel", "user-1"))
      .rejects.toThrow(/terminal/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Task 10 — createTransfer (auto-split N → N)
// ═════════════════════════════════════════════════════════════════════════════

describe("Task 10 — createTransfer (auto-split)", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
    citel.isCitelConfigured.mockReturnValue(true);
    citel.getSaldoDisponivel.mockResolvedValue({ saldoDisponivel: 100, saldoFisico: 100 });
  });

  it("input com 3 items → cria 3 Transfers separadas, todas PENDING, fromStoreId=null", async () => {
    const transfers = await createTransfer({
      toStoreId:     "store-b",
      priority:      TransferPriority.ANTICIPATED,
      requestedById: "user-1",
      items: [
        { productCode: "A", productName: "A", quantity: 1, unit: "UN" },
        { productCode: "B", productName: "B", quantity: 2, unit: "UN" },
        { productCode: "C", productName: "C", quantity: 3, unit: "UN" },
      ],
    });

    expect(transfers).toHaveLength(3);
    for (const t of transfers) {
      expect(t.status).toBe(TransferStatus.PENDING);
      expect(t.fromStoreId).toBeNull();
      expect((t as any).items).toHaveLength(1);
    }
    const productCodes = transfers.map((t: any) => t.items[0].productCode).sort();
    expect(productCodes).toEqual(["A", "B", "C"]);
  });

  it("NÃO comita estoque na criação (fromStoreId ainda desconhecido)", async () => {
    // Nenhum ledger seedado para a origem porque ela não existe ainda
    const before = db.ledgerEntries.length;

    const transfers = await createTransfer({
      toStoreId:     "store-b",
      priority:      TransferPriority.ANTICIPATED,
      requestedById: "user-1",
      items: [{ productCode: "X", productName: "x", quantity: 1, unit: "UN" }],
    });

    expect(transfers).toHaveLength(1);
    expect(db.ledgerEntries.length).toBe(before); // nenhuma entrada nova de COMMIT
    expect(db.ledgers.size).toBe(0);              // ledger não tocado
  });

  it("rejeita se items vazio", async () => {
    await expect(createTransfer({
      toStoreId:     "store-b",
      priority:      TransferPriority.ANTICIPATED,
      requestedById: "user-1",
      items: [],
    })).rejects.toThrow(/item/i);
  });

  it("cria history com toStatus=PENDING para cada Transfer", async () => {
    const transfers = await createTransfer({
      toStoreId:     "store-b",
      priority:      TransferPriority.ANTICIPATED,
      requestedById: "user-1",
      items: [
        { productCode: "A", productName: "A", quantity: 1, unit: "UN" },
        { productCode: "B", productName: "B", quantity: 2, unit: "UN" },
      ],
    });

    for (const t of transfers) {
      const h = db.histories.find(
        (x: any) => x.transferId === t.id && x.toStatus === TransferStatus.PENDING,
      );
      expect(h).toBeDefined();
    }
  });
});
