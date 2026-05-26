// ─────────────────────────────────────────────────────────────────────────────
// TESTES — Pilar 1: Estoque Comprometido
//
// Estratégia: Prisma com estado in-memory + mock do Citel service.
// Isso permite testar o comportamento real do sistema — incluindo o lock
// otimista — sem depender de banco de dados nem da rede interna.
//
// Organização:
//   1. Pré-validação e fórmula saldoDisponivelReal
//   2. Concorrência e lock otimista
//   3. createTransfer — pré-validação bloqueia criação
//   4. Fluxo completo: PENDING → APPROVED → IN_TRANSIT → RECEIVED
//   5. Cancelamentos: antes e após NF
//   6. Divergências e bloqueio de READY
// ─────────────────────────────────────────────────────────────────────────────

import { vi, describe, it, expect, beforeEach } from "vitest";
import { TransferStatus, TransferPriority } from "@prisma/client";

// ── vi.hoisted garante que prismaClient e db existam quando vi.mock é hoistado ──

const mocks = vi.hoisted(() => {
  // ── Tipos internos ────────────────────────────────────────────────────────
  type LedgerRow = {
    id: string; storeId: string; productCode: string; productName: string;
    qtdFisica: number; qtdComprometida: number; qtdEmTransito: number;
    version: number; syncedAt: Date | null;
  };
  type TransferItemRow = {
    id: string; transferId: string; productCode: string; productName: string;
    quantity: number; sentQty: number | null; receivedQty: number | null; unit: string;
  };
  type TransferRow = {
    id: string; status: string; fromStoreId: string; toStoreId: string;
    priority: string; nfCitelNumero: string | null;
    hasDivergence: boolean; divergenceCount: number;
    deliveryRequestId: string | null; items: TransferItemRow[];
    fromStore: object; toStore: object; deliveryRequest: object | null;
    nfCitelEmitidaAt?: Date; cancelledAt?: Date;
    [key: string]: unknown;
  };

  // ── Estado in-memory ───────────────────────────────────────────────────────
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
    const t: TransferRow = {
      id, status,
      fromStoreId: "store-a", toStoreId: "store-b",
      priority: "NORMAL",
      nfCitelNumero: null, hasDivergence: false, divergenceCount: 0,
      deliveryRequestId: null,
      items: [{
        id: `item_${db.transferIdSeq}_1`, transferId: id,
        productCode: "TINT-001", productName: "Tinta Branca 18L",
        quantity: 3, sentQty: 3, receivedQty: null, unit: "UN",
      }],
      fromStore: {}, toStore: {}, deliveryRequest: null, ...overrides,
    };
    db.transfers.set(id, t);
    return t;
  }

  // Simula operadores { increment, decrement } do Prisma
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

  // ── Mock do Prisma ─────────────────────────────────────────────────────────
  // Construído uma única vez; o estado (db) é resetado entre testes via resetDb().
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
    // Lock otimista: só aplica se version bater
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
    create: vi.fn(async ({ data }: any) => {
      db.transferIdSeq++;
      const id = `transfer_${db.transferIdSeq}`;
      const items: TransferItemRow[] = (data.items?.create ?? []).map((item: any, i: number) => ({
        id: `item_${db.transferIdSeq}_${i + 1}`, transferId: id,
        sentQty: null, receivedQty: null, unit: "UN", ...item,
      }));
      const t: TransferRow = {
        id, status: "PENDING",
        fromStoreId: data.fromStoreId, toStoreId: data.toStoreId, priority: data.priority,
        nfCitelNumero: null, hasDivergence: false, divergenceCount: 0,
        deliveryRequestId: data.deliveryRequestId ?? null, items,
        fromStore: { id: data.fromStoreId, code: "A", name: "Loja A" },
        toStore:   { id: data.toStoreId,   code: "B", name: "Loja B" },
        deliveryRequest: null,
      };
      db.transfers.set(id, t); return t;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const t = db.transfers.get(where.id);
      if (!t) throw new Error(`Transfer ${where.id} não encontrado`);
      const updated = { ...t, ...applyData(t as unknown as Record<string, unknown>, data) } as TransferRow;
      db.transfers.set(where.id, updated); return updated;
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

  p.transferHistory   = { create: vi.fn(async () => ({})) };
  p.transferDivergence = {
    create: vi.fn(async ({ data }: any) => {
      const d = { id: `div_${db.divergences.length + 1}`, ...data };
      db.divergences.push(d); return d;
    }),
  };
  p.deliveryRequest = {
    findUnique: vi.fn(async ({ where }: any) => {
      return db.deliveryRequests.get(where.id) ?? null;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const req = db.deliveryRequests.get(where.id) ?? { id: where.id };
      const updated = { ...(req as object), ...data };
      db.deliveryRequests.set(where.id, updated); return updated;
    }),
  };
  p.deliveryStatusHistory = {
    create: vi.fn(async ({ data }: any) => ({ id: `dsh_${Date.now()}`, ...data })),
  };
  p.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(p));

  // ── Mock do Citel service ─────────────────────────────────────────────────
  const citel = {
    getSaldoDisponivel:    vi.fn(),
    isCitelConfigured:     vi.fn(() => true),
    getSaldoForEmpresa:    vi.fn(),
    fetchEstoqueCitelBatch: vi.fn(),
  };

  return { prisma: p, db, citel, resetDb, seedLedger, seedTransfer };
});

// ── Registra os mocks ─────────────────────────────────────────────────────────
vi.mock("@/lib/prisma",         () => ({ prisma: mocks.prisma }));
vi.mock("@/services/citel.service", () => mocks.citel);
vi.mock("@/services/erp.service",   () => ({ fetchStockByProduct: vi.fn() }));

// ── Imports dos serviços (após declaração dos mocks) ──────────────────────────
import { preCheckStock, commitStock }           from "@/services/stock-ledger.service";
import { createTransfer, updateTransferStatus, indicateOrigin } from "@/services/transferencia.service";
import type { CreateTransferInput }             from "@/types";

// ── Atalhos ───────────────────────────────────────────────────────────────────
const { db, resetDb, seedLedger, seedTransfer, citel } = mocks;

function transferInput(overrides: Partial<CreateTransferInput> = {}): CreateTransferInput {
  return {
    fromStoreId: "store-a", toStoreId: "store-b",
    priority: TransferPriority.ANTICIPATED,
    items: [{ productCode: "TINT-001", productName: "Tinta Branca 18L", quantity: 3, unit: "UN" }],
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. PRÉ-VALIDAÇÃO E FÓRMULA saldoDisponivelReal
// ═════════════════════════════════════════════════════════════════════════════

describe("1. preCheckStock — cálculo saldoDisponivelReal", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
    citel.isCitelConfigured.mockReturnValue(true);
    // Default alto: testes específicos sobrescrevem com mockResolvedValue ou mockResolvedValueOnce
    citel.getSaldoDisponivel.mockResolvedValue({ saldoDisponivel: 100, saldoFisico: 100 });
  });

  it("retorna ok=true quando há saldo suficiente", async () => {
    seedLedger("store-a", "TINT-001", { qtdFisica: 10, qtdComprometida: 2 });
    citel.getSaldoDisponivel.mockResolvedValue({ saldoDisponivel: 10, saldoFisico: 10 });

    const result = await preCheckStock({
      storeId: "store-a", productCode: "TINT-001", productName: "Tinta", qty: 5,
    });

    expect(result.ok).toBe(true);
  });

  it("retorna INSUFFICIENT_STOCK quando saldo real é menor que o solicitado", async () => {
    // Citel: 10 disponíveis, mas 8 já comprometidos → real = 2; pedido = 5
    seedLedger("store-a", "TINT-001", { qtdFisica: 10, qtdComprometida: 8 });
    citel.getSaldoDisponivel.mockResolvedValue({ saldoDisponivel: 10, saldoFisico: 10 });

    const result = await preCheckStock({
      storeId: "store-a", productCode: "TINT-001", productName: "Tinta", qty: 5,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("INSUFFICIENT_STOCK");
    expect(result.detail?.saldoDisponivelReal).toBe(2);
    expect(result.detail?.qtdSolicitada).toBe(5);
  });

  it("usa qtdFisica como fallback quando Citel está indisponível — saldo suficiente", async () => {
    seedLedger("store-a", "TINT-001", { qtdFisica: 4, qtdComprometida: 1 });
    citel.getSaldoDisponivel.mockResolvedValue(null); // Citel fora do ar

    // qtdFisica(4) - qtdComprometida(1) = 3 >= qty(3) → ok
    const result = await preCheckStock({
      storeId: "store-a", productCode: "TINT-001", productName: "Tinta", qty: 3,
    });

    expect(result.ok).toBe(true);
  });

  it("retorna CITEL_UNAVAILABLE quando Citel fora do ar E qtdFisica também é insuficiente", async () => {
    seedLedger("store-a", "TINT-001", { qtdFisica: 2, qtdComprometida: 1 });
    citel.getSaldoDisponivel.mockResolvedValue(null);

    const result = await preCheckStock({
      storeId: "store-a", productCode: "TINT-001", productName: "Tinta", qty: 5,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("CITEL_UNAVAILABLE");
  });

  it("fórmula usa saldoDisponivel do Citel, não qtdFisica, quando ambos estão disponíveis", async () => {
    // qtdFisica = 20 (no ledger), Citel diz apenas 15
    seedLedger("store-a", "TINT-001", { qtdFisica: 20, qtdComprometida: 7 });
    citel.getSaldoDisponivel.mockResolvedValue({ saldoDisponivel: 15, saldoFisico: 20 });

    // saldoDisponivelReal = 15 - 7 = 8
    // Solicitar 8 deve passar; solicitar 9 deve falhar
    const ok      = await preCheckStock({ storeId: "store-a", productCode: "TINT-001", productName: "Tinta", qty: 8 });
    const falha   = await preCheckStock({ storeId: "store-a", productCode: "TINT-001", productName: "Tinta", qty: 9 });

    expect(ok.ok).toBe(true);
    expect(falha.ok).toBe(false);
    expect(falha.detail?.saldoDisponivelReal).toBe(8); // 15 - 7
    expect(falha.detail?.saldoDisponivelCitel).toBe(15); // usa Citel, não qtdFisica(20)
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. CONCORRÊNCIA — lock otimista
// ═════════════════════════════════════════════════════════════════════════════

describe("2. concorrência — dois operadores tentando o mesmo produto", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
    citel.isCitelConfigured.mockReturnValue(true);
    citel.getSaldoDisponivel.mockResolvedValue({ saldoDisponivel: 100, saldoFisico: 100 });
  });

  it("apenas um commitStock simultâneo consegue — o outro recebe CONCURRENT_CONFLICT", async () => {
    seedLedger("store-a", "TINT-001", { qtdFisica: 5, qtdComprometida: 0 });
    // Ambas as chamadas leem saldo disponível = 5 (antes de qualquer commit)
    citel.getSaldoDisponivel.mockResolvedValue({ saldoDisponivel: 5, saldoFisico: 5 });

    const base = { storeId: "store-a", productCode: "TINT-001", productName: "Tinta", qty: 5 };

    const [r1, r2] = await Promise.all([
      commitStock({ ...base, transferId: "t-1" }),
      commitStock({ ...base, transferId: "t-2" }),
    ]);

    const successos  = [r1, r2].filter(r => r.success).length;
    const conflitos  = [r1, r2].filter(r => !r.success && r.error === "CONCURRENT_CONFLICT").length;

    expect(successos).toBe(1);  // exatamente um trava
    expect(conflitos).toBe(1);  // o outro recebe CONCURRENT_CONFLICT
  });

  it("após commit bem-sucedido, version é incrementada e qtdComprometida reflete o lock", async () => {
    seedLedger("store-a", "TINT-001", { qtdFisica: 10, qtdComprometida: 0 });
    citel.getSaldoDisponivel.mockResolvedValue({ saldoDisponivel: 10, saldoFisico: 10 });

    await commitStock({ storeId: "store-a", productCode: "TINT-001", productName: "Tinta", qty: 4, transferId: "t-1" });

    const ledger = db.ledgers.get("store-a_TINT-001")!;
    expect(ledger.qtdComprometida).toBe(4);
    expect(ledger.version).toBe(1); // version incrementada pelo lock
  });

  it("commitStock consecutivos acumulam qtdComprometida corretamente", async () => {
    seedLedger("store-a", "TINT-001", { qtdFisica: 20, qtdComprometida: 0 });
    citel.getSaldoDisponivel.mockResolvedValue({ saldoDisponivel: 20, saldoFisico: 20 });

    await commitStock({ storeId: "store-a", productCode: "TINT-001", productName: "Tinta", qty: 5, transferId: "t-1" });
    await commitStock({ storeId: "store-a", productCode: "TINT-001", productName: "Tinta", qty: 3, transferId: "t-2" });

    const ledger = db.ledgers.get("store-a_TINT-001")!;
    expect(ledger.qtdComprometida).toBe(8);  // 5 + 3
    expect(ledger.version).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. createTransfer + indicateOrigin — pré-validação MIGROU pra indicateOrigin
// ═════════════════════════════════════════════════════════════════════════════
//
// No fluxo de 5 etapas, createTransfer agora apenas registra a Transfer em
// PENDING (fromStoreId=null). A validação de estoque e commitStock acontecem
// em indicateOrigin, quando a loja destino indica qual loja vai fornecer.
//
// Os testes desta seção exercitam o caminho completo PENDING → AWAITING_APPROVAL.

describe("3. createTransfer + indicateOrigin — pré-validação de estoque", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
    citel.isCitelConfigured.mockReturnValue(true);
    citel.getSaldoDisponivel.mockResolvedValue({ saldoDisponivel: 100, saldoFisico: 100 });
  });

  it("createTransfer NÃO valida estoque (cria N PENDING sem mexer no ledger)", async () => {
    // Sem seedLedger — a origem ainda nem é conhecida na criação
    const transfers = await createTransfer({
      toStoreId:     "store-b",
      priority:      TransferPriority.ANTICIPATED,
      requestedById: "user-1",
      items: [
        { productCode: "TINT-001", productName: "Tinta A", quantity: 3 },
        { productCode: "TINT-002", productName: "Tinta B", quantity: 2 },
      ],
    });

    expect(transfers).toHaveLength(2);
    for (const t of transfers) {
      expect(t.status).toBe(TransferStatus.PENDING);
      expect(t.fromStoreId).toBeNull();
    }
    expect(db.ledgers.size).toBe(0); // ledger não foi tocado
  });

  it("indicateOrigin lança erro quando estoque é insuficiente na origem", async () => {
    seedLedger("store-a", "TINT-001", { qtdFisica: 1, qtdComprometida: 0 });
    citel.getSaldoDisponivel.mockResolvedValueOnce({ saldoDisponivel: 1, saldoFisico: 1 });

    const [t] = await createTransfer({
      toStoreId:     "store-b",
      priority:      TransferPriority.ANTICIPATED,
      requestedById: "user-1",
      items: [{ productCode: "TINT-001", productName: "Tinta", quantity: 5 }],
    });

    await expect(indicateOrigin(t.id, "store-a", "user-1"))
      .rejects.toThrow(/insuficiente/i);

    // Estado da transfer não mudou
    expect(db.transfers.get(t.id)!.status).toBe(TransferStatus.PENDING);
    expect(db.transfers.get(t.id)!.fromStoreId).toBeNull();
    expect(db.ledgers.get("store-a_TINT-001")!.qtdComprometida).toBe(0);
  });

  it("indicateOrigin: mensagem de erro inclui código do produto", async () => {
    seedLedger("store-a", "TINT-001", { qtdFisica: 2, qtdComprometida: 1 });
    citel.getSaldoDisponivel.mockResolvedValueOnce({ saldoDisponivel: 2, saldoFisico: 2 });

    const [t] = await createTransfer({
      toStoreId:     "store-b",
      priority:      TransferPriority.ANTICIPATED,
      requestedById: "user-1",
      items: [{ productCode: "TINT-001", productName: "Tinta Branca 18L", quantity: 10 }],
    });

    await expect(indicateOrigin(t.id, "store-a", "user-1")).rejects.toThrow("TINT-001");
  });

  it("indicateOrigin trava ledger quando estoque é suficiente", async () => {
    seedLedger("store-a", "TINT-001", { qtdFisica: 10, qtdComprometida: 0 });

    const [t] = await createTransfer({
      toStoreId:     "store-b",
      priority:      TransferPriority.ANTICIPATED,
      requestedById: "user-1",
      items: [{ productCode: "TINT-001", productName: "Tinta A", quantity: 3 }],
    });

    await indicateOrigin(t.id, "store-a", "user-1");

    expect(db.transfers.get(t.id)!.status).toBe(TransferStatus.AWAITING_APPROVAL);
    expect(db.transfers.get(t.id)!.fromStoreId).toBe("store-a");
    expect(db.ledgers.get("store-a_TINT-001")!.qtdComprometida).toBe(3);
  });

  it("auto-split: N items → N Transfers independentes (uma pode falhar sem afetar as outras)", async () => {
    seedLedger("store-a", "TINT-001", { qtdFisica: 10, qtdComprometida: 0 });
    seedLedger("store-a", "TINT-002", { qtdFisica: 1,  qtdComprometida: 0 }); // insuficiente

    const transfers = await createTransfer({
      toStoreId:     "store-b",
      priority:      TransferPriority.ANTICIPATED,
      requestedById: "user-1",
      items: [
        { productCode: "TINT-001", productName: "Tinta A", quantity: 3 },
        { productCode: "TINT-002", productName: "Tinta B", quantity: 5 },
      ],
    });

    expect(transfers).toHaveLength(2);

    // Pode indicar origem para TINT-001 (sucesso)
    const tA = transfers.find((t: any) => t.items[0].productCode === "TINT-001")!;
    await indicateOrigin(tA.id, "store-a", "user-1");
    expect(db.transfers.get(tA.id)!.status).toBe(TransferStatus.AWAITING_APPROVAL);

    // Mas TINT-002 falha por falta de estoque na mesma origem
    citel.getSaldoDisponivel.mockResolvedValueOnce({ saldoDisponivel: 1, saldoFisico: 1 });
    const tB = transfers.find((t: any) => t.items[0].productCode === "TINT-002")!;
    await expect(indicateOrigin(tB.id, "store-a", "user-1")).rejects.toThrow(/insuficiente/i);

    // TINT-001 permanece comitada; TINT-002 ainda PENDING
    expect(db.transfers.get(tA.id)!.status).toBe(TransferStatus.AWAITING_APPROVAL);
    expect(db.transfers.get(tB.id)!.status).toBe(TransferStatus.PENDING);
    expect(db.ledgers.get("store-a_TINT-001")!.qtdComprometida).toBe(3);
    expect(db.ledgers.get("store-a_TINT-002")!.qtdComprometida).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. FLUXO COMPLETO: PENDING → APPROVED → IN_TRANSIT → RECEIVED
// ═════════════════════════════════════════════════════════════════════════════

describe("4. fluxo completo de transferência", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
    citel.isCitelConfigured.mockReturnValue(true);
    seedLedger("store-a", "TINT-001", { qtdFisica: 10, qtdComprometida: 3 });
    seedLedger("store-b", "TINT-001", { qtdFisica: 0,  qtdComprometida: 0, qtdEmTransito: 0 });
  });

  it("APPROVED → qtdEmTransito incrementada na loja destino", async () => {
    const t = seedTransfer(TransferStatus.PENDING);

    await updateTransferStatus(t.id, { status: TransferStatus.APPROVED, changedById: "supervisor" });

    expect(db.ledgers.get("store-b_TINT-001")!.qtdEmTransito).toBe(3);
  });

  // Legado: PREPARED → IN_TRANSIT por TE (não fiscal) não altera o ledger da origem
  // (sem NF, citelTakesOver não roda). Substitui o antigo teste de PREPARING, que era
  // a etapa intermediária física eliminada no fluxo novo (APPROVED → IN_TRANSIT direto).
  it("PREPARED → IN_TRANSIT por TE → NENHUMA alteração no ledger da origem", async () => {
    const t = seedTransfer(TransferStatus.PREPARED, { teNumber: "TE-999" });
    const antes = { ...db.ledgers.get("store-a_TINT-001")! };

    await updateTransferStatus(t.id, { status: TransferStatus.IN_TRANSIT });

    const depois = db.ledgers.get("store-a_TINT-001")!;
    expect(depois.qtdComprometida).toBe(antes.qtdComprometida);
    expect(depois.version).toBe(antes.version); // nenhuma escrita na origem
  });

  // Fluxo novo: APPROVED → IN_TRANSIT direto (sem PREPARING/PREPARED). O documento
  // (TE/NF) é exigido na AUTORIZAÇÃO; a coleta NÃO trava por falta dele — legadas
  // (aprovadas no fluxo antigo, sem documento) ainda precisam poder ser coletadas.
  it("IN_TRANSIT sem documento → permitido (legado; doc é exigido na autorização)", async () => {
    const t = seedTransfer(TransferStatus.APPROVED);

    await updateTransferStatus(t.id, { status: TransferStatus.IN_TRANSIT });

    expect(db.transfers.get(t.id)!.status).toBe(TransferStatus.IN_TRANSIT);
  });

  // Documento = TE (não fiscal) já gravado na autorização → permite IN_TRANSIT.
  // TE NÃO dispara citelTakesOver, então qtdComprometida permanece travada no ledger.
  it("IN_TRANSIT com TE (já gravada) → permitido; qtdComprometida permanece (TE não é fiscal)", async () => {
    const t = seedTransfer(TransferStatus.APPROVED, { teNumber: "TE-12345" });

    await updateTransferStatus(t.id, { status: TransferStatus.IN_TRANSIT });

    const tf = db.transfers.get(t.id)!;
    expect(tf.status).toBe(TransferStatus.IN_TRANSIT);
    expect(db.ledgers.get("store-a_TINT-001")!.qtdComprometida).toBe(3); // TE não aciona citelTakesOver
  });

  it("IN_TRANSIT com nfCitelNumero → qtdComprometida zerada e NF registrada na transferência", async () => {
    const t = seedTransfer(TransferStatus.APPROVED);

    await updateTransferStatus(t.id, {
      status: TransferStatus.IN_TRANSIT,
      nfCitelNumero: "NF-2024-0042",
    });

    expect(db.ledgers.get("store-a_TINT-001")!.qtdComprometida).toBe(0);
    const tf = db.transfers.get(t.id)!;
    expect(tf.nfCitelNumero).toBe("NF-2024-0042");
    expect(tf.nfCitelEmitidaAt).toBeInstanceOf(Date);
  });

  it("RECEIVED → qtdEmTransito zerada no destino", async () => {
    const t = seedTransfer(TransferStatus.IN_TRANSIT, { nfCitelNumero: "NF-2024-0042" });
    db.ledgers.set("store-b_TINT-001", { ...db.ledgers.get("store-b_TINT-001")!, qtdEmTransito: 3 });

    await updateTransferStatus(t.id, {
      status: TransferStatus.RECEIVED,
      receivedItems: [{ transferItemId: t.items[0].id, receivedQty: 3 }],
    });

    expect(db.ledgers.get("store-b_TINT-001")!.qtdEmTransito).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. CANCELAMENTOS
// ═════════════════════════════════════════════════════════════════════════════

describe("5. cancelamentos — antes e após NF", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
    citel.isCitelConfigured.mockReturnValue(true);
    seedLedger("store-a", "TINT-001", { qtdFisica: 10, qtdComprometida: 3 });
    seedLedger("store-b", "TINT-001", { qtdFisica: 0,  qtdComprometida: 0, qtdEmTransito: 0 });
  });

  it("PENDING → CANCELLED: libera qtdComprometida; destino não é alterado (markInTransit não rodou)", async () => {
    const t = seedTransfer(TransferStatus.PENDING);

    await updateTransferStatus(t.id, { status: TransferStatus.CANCELLED });

    expect(db.ledgers.get("store-a_TINT-001")!.qtdComprometida).toBe(0); // liberado
    expect(db.ledgers.get("store-b_TINT-001")!.qtdEmTransito).toBe(0);  // inalterado
  });

  it("APPROVED → CANCELLED: libera qtdComprometida E cancela qtdEmTransito no destino", async () => {
    const t = seedTransfer(TransferStatus.APPROVED);
    db.ledgers.set("store-b_TINT-001", { ...db.ledgers.get("store-b_TINT-001")!, qtdEmTransito: 3 });

    await updateTransferStatus(t.id, { status: TransferStatus.CANCELLED });

    expect(db.ledgers.get("store-a_TINT-001")!.qtdComprometida).toBe(0); // releaseStock
    expect(db.ledgers.get("store-b_TINT-001")!.qtdEmTransito).toBe(0);  // cancelTransit
  });

  it("PREPARING → CANCELLED: mesmo comportamento de APPROVED (PREPARING não muda ledger)", async () => {
    const t = seedTransfer(TransferStatus.PREPARING);
    db.ledgers.set("store-b_TINT-001", { ...db.ledgers.get("store-b_TINT-001")!, qtdEmTransito: 3 });

    await updateTransferStatus(t.id, { status: TransferStatus.CANCELLED });

    expect(db.ledgers.get("store-a_TINT-001")!.qtdComprometida).toBe(0);
    expect(db.ledgers.get("store-b_TINT-001")!.qtdEmTransito).toBe(0);
  });

  it("IN_TRANSIT → CANCELLED (NF emitida): NÃO toca qtdComprometida; apenas cancela trânsito", async () => {
    const t = seedTransfer(TransferStatus.IN_TRANSIT, { nfCitelNumero: "NF-2024-0042" });
    // Após citelTakesOver, qtdComprometida já foi zerada
    db.ledgers.set("store-a_TINT-001", { ...db.ledgers.get("store-a_TINT-001")!, qtdComprometida: 0 });
    db.ledgers.set("store-b_TINT-001", { ...db.ledgers.get("store-b_TINT-001")!, qtdEmTransito: 3 });
    const versaoAntes = db.ledgers.get("store-a_TINT-001")!.version;

    await updateTransferStatus(t.id, { status: TransferStatus.CANCELLED });

    // qtdComprometida não foi tocada (Citel controla, não o ledger)
    expect(db.ledgers.get("store-a_TINT-001")!.qtdComprometida).toBe(0);
    expect(db.ledgers.get("store-a_TINT-001")!.version).toBe(versaoAntes); // sem escrita na origem

    // qtdEmTransito foi zerada
    expect(db.ledgers.get("store-b_TINT-001")!.qtdEmTransito).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. DIVERGÊNCIAS E BLOQUEIO DE READY
// ═════════════════════════════════════════════════════════════════════════════

describe("6. divergências e bloqueio de READY", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
    seedLedger("store-b", "TINT-001", { qtdFisica: 0, qtdEmTransito: 3, qtdComprometida: 0 });
  });

  it("sentQty != receivedQty → hasDivergence=true e TransferDivergence registrada", async () => {
    const t = seedTransfer(TransferStatus.IN_TRANSIT, { nfCitelNumero: "NF-50" });

    await updateTransferStatus(t.id, {
      status: TransferStatus.RECEIVED,
      receivedItems: [{ transferItemId: t.items[0].id, receivedQty: 2 }], // enviou 3, recebeu 2
    });

    const tf = db.transfers.get(t.id)!;
    expect(tf.hasDivergence).toBe(true);
    expect(tf.divergenceCount).toBe(1);
    expect(db.divergences).toHaveLength(1);
    expect(db.divergences[0]).toMatchObject({
      productCode: "TINT-001", sentQty: 3, receivedQty: 2, divergenceQty: 1,
    });
  });

  it("sentQty === receivedQty → sem divergência", async () => {
    const t = seedTransfer(TransferStatus.IN_TRANSIT, { nfCitelNumero: "NF-51" });

    await updateTransferStatus(t.id, {
      status: TransferStatus.RECEIVED,
      receivedItems: [{ transferItemId: t.items[0].id, receivedQty: 3 }],
    });

    const tf = db.transfers.get(t.id)!;
    expect(tf.hasDivergence).toBe(false);
    expect(db.divergences).toHaveLength(0);
  });

  it("transferência com divergência marca DR como READY mesmo assim (revisão fica como flag)", async () => {
    // Comportamento atual: handler avança a DR independente de divergência —
    // o operador revisa depois através do hasDivergence/divergenceCount. Antes
    // a divergência bloqueava, mas isso piorava UX (pedido ficava preso).
    const t = seedTransfer(TransferStatus.IN_TRANSIT, {
      nfCitelNumero: "NF-52", deliveryRequestId: "dr-001",
    });
    db.deliveryRequests.set("dr-001", { id: "dr-001", status: "AWAITING_TRANSFER" });

    await updateTransferStatus(t.id, {
      status: TransferStatus.RECEIVED,
      receivedItems: [{ transferItemId: t.items[0].id, receivedQty: 1 }], // enviou 3, recebeu 1
    });

    const req = db.deliveryRequests.get("dr-001") as any;
    // DR avançou (fallback READY porque transitionDeliveryRequest não está mockado)
    expect(req?.status).toBe("READY");
    // Mas a Transfer tem divergência marcada
    const tf = db.transfers.get(t.id)!;
    expect(tf.hasDivergence).toBe(true);
  });

  it("todas as transferências recebidas sem divergência → solicitação avança para READY", async () => {
    const t = seedTransfer(TransferStatus.IN_TRANSIT, {
      nfCitelNumero: "NF-53", deliveryRequestId: "dr-002",
    });
    db.deliveryRequests.set("dr-002", { id: "dr-002", status: "AWAITING_TRANSFER" });

    await updateTransferStatus(t.id, {
      status: TransferStatus.RECEIVED,
      receivedItems: [{ transferItemId: t.items[0].id, receivedQty: 3 }], // sem divergência
    });

    const req = db.deliveryRequests.get("dr-002") as any;
    expect(req?.status).toBe("READY");
    expect(req?.isComplete).toBe(true);
  });

  it("solicitação com múltiplas transferências: READY apenas quando todas estiverem limpas", async () => {
    // Transferência 1: recebida sem divergência
    const t1 = seedTransfer(TransferStatus.IN_TRANSIT, {
      nfCitelNumero: "NF-54a", deliveryRequestId: "dr-003",
    });
    // Transferência 2: ainda IN_TRANSIT
    const t2 = seedTransfer(TransferStatus.IN_TRANSIT, {
      nfCitelNumero: "NF-54b", deliveryRequestId: "dr-003",
    });
    db.deliveryRequests.set("dr-003", { id: "dr-003", status: "AWAITING_TRANSFER" });
    seedLedger("store-b", "TINT-001", { qtdFisica: 0, qtdEmTransito: 3 });

    // Recebe apenas t1
    await updateTransferStatus(t1.id, {
      status: TransferStatus.RECEIVED,
      receivedItems: [{ transferItemId: t1.items[0].id, receivedQty: 3 }],
    });

    // t2 ainda está IN_TRANSIT → NÃO deve avançar para READY
    const reqDepoisT1 = db.deliveryRequests.get("dr-003") as any;
    expect(reqDepoisT1?.status).not.toBe("READY");

    // Agora recebe t2
    await updateTransferStatus(t2.id, {
      status: TransferStatus.RECEIVED,
      receivedItems: [{ transferItemId: t2.items[0].id, receivedQty: 3 }],
    });

    const reqFinal = db.deliveryRequests.get("dr-003") as any;
    expect(reqFinal?.status).toBe("READY");
  });
});
