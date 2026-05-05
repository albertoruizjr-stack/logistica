// __tests__/torre/audit-engine.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluateRules } from "../../services/torre/audit-engine.service";

vi.mock("../../lib/prisma", () => ({
  prisma: {
    abcClassification: { findMany: vi.fn() },
    stockLedger: { findMany: vi.fn() },
    transferDivergence: { findMany: vi.fn() },
  },
}));

import { prisma } from "../../lib/prisma";

function mockAbc(overrides = {}) {
  return {
    storeId: "store-1",
    productCode: "TINT-001",
    productName: "Tinta Branca 18L",
    classification: "A",
    minStock: 5,
    maxStock: 50,
    coverageDaysTarget: 30,
    avgDailySales: 2,
    coverageDaysActual: 10,
    ...overrides,
  };
}

function mockLedger(overrides = {}) {
  return {
    storeId: "store-1",
    productCode: "TINT-001",
    qtdFisica: 3,
    qtdComprometida: 0,
    ...overrides,
  };
}

describe("evaluateRules — R03 (abaixo do mínimo)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.transferDivergence.findMany as any).mockResolvedValue([]);
  });

  it("gera ocorrência CRITICAL quando curva A está abaixo do mínimo", async () => {
    (prisma.abcClassification.findMany as any).mockResolvedValue([mockAbc()]);
    (prisma.stockLedger.findMany as any).mockResolvedValue([
      mockLedger({ qtdFisica: 3, qtdComprometida: 0 }), // disponível=3, minStock=5
    ]);

    const result = await evaluateRules("store-1");

    expect(result).toHaveLength(1);
    expect(result[0].ruleId).toBe("R03");
    expect(result[0].severity).toBe("CRITICAL");
    expect(result[0].items[0].metricValue).toBe(3);
    expect(result[0].slaMinutes).toBe(240);
  });

  it("gera ocorrência WARNING quando curva B está abaixo do mínimo", async () => {
    (prisma.abcClassification.findMany as any).mockResolvedValue([
      mockAbc({ classification: "B" }),
    ]);
    (prisma.stockLedger.findMany as any).mockResolvedValue([
      mockLedger({ qtdFisica: 3, qtdComprometida: 0 }),
    ]);

    const result = await evaluateRules("store-1");

    expect(result[0].severity).toBe("WARNING");
    expect(result[0].slaMinutes).toBe(1440);
  });

  it("não gera ocorrência quando estoque está acima do mínimo", async () => {
    (prisma.abcClassification.findMany as any).mockResolvedValue([mockAbc()]);
    (prisma.stockLedger.findMany as any).mockResolvedValue([
      mockLedger({ qtdFisica: 20, qtdComprometida: 0 }), // disponível=20 >= minStock=5
    ]);

    const result = await evaluateRules("store-1");

    expect(result).toHaveLength(0);
  });

  it("não gera ocorrência quando minStock não está cadastrado", async () => {
    (prisma.abcClassification.findMany as any).mockResolvedValue([
      mockAbc({ minStock: null }),
    ]);
    (prisma.stockLedger.findMany as any).mockResolvedValue([mockLedger()]);

    const result = await evaluateRules("store-1");

    expect(result).toHaveLength(0);
  });

  it("gera ocorrência R03 mesmo quando coverageDaysActual é null", async () => {
    // Produto sem histórico de venda (avgDailySales null) mas abaixo do mínimo físico
    (prisma.abcClassification.findMany as any).mockResolvedValue([
      mockAbc({ avgDailySales: null, coverageDaysActual: null }),
    ]);
    (prisma.stockLedger.findMany as any).mockResolvedValue([
      mockLedger({ qtdFisica: 3, qtdComprometida: 0 }), // 3 < minStock(5)
    ]);

    const result = await evaluateRules("store-1");

    // R03 não depende de coverageDaysActual — apenas de qtdDisponivel vs minStock
    expect(result).toHaveLength(1);
    expect(result[0].ruleId).toBe("R03");
    expect(result[0].items[0].metricValue).toBe(3);
  });

  it("considera qtdComprometida ao calcular disponível para R03", async () => {
    (prisma.abcClassification.findMany as any).mockResolvedValue([mockAbc({ minStock: 5 })]);
    (prisma.stockLedger.findMany as any).mockResolvedValue([
      mockLedger({ qtdFisica: 8, qtdComprometida: 4 }), // disponível=4 < minStock=5
    ]);

    const result = await evaluateRules("store-1");

    expect(result).toHaveLength(1);
    expect(result[0].items[0].metricValue).toBe(4); // qtdDisponivel = 8 - 4
  });
});

describe("evaluateRules — R10 (divergência em aberto)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.abcClassification.findMany as any).mockResolvedValue([]);
    (prisma.stockLedger.findMany as any).mockResolvedValue([]);
  });

  it("gera ocorrência WARNING quando há divergência com deadline vencido", async () => {
    const pastDeadline = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h atrás
    (prisma.transferDivergence.findMany as any).mockResolvedValue([
      {
        id: "div-1",
        transferId: "transfer-1",
        ledgerId: "ledger-1",
        productCode: "TINT-001",
        productName: "Tinta Branca 18L",
        divergenceQty: 2,
        deadline: pastDeadline,
        ledger: { storeId: "store-1" },
      },
    ]);

    const result = await evaluateRules("store-1");

    expect(result).toHaveLength(1);
    expect(result[0].ruleId).toBe("R10");
    expect(result[0].severity).toBe("WARNING");
    expect(result[0].actionType).toBe("RESOLVE_DIVERGENCE");
  });

  it("não gera ocorrência quando deadline ainda não venceu", async () => {
    const futureDeadline = new Date(Date.now() + 2 * 60 * 60 * 1000);
    (prisma.transferDivergence.findMany as any).mockResolvedValue([
      {
        id: "div-2",
        transferId: "transfer-2",
        ledgerId: "ledger-2",
        productCode: "TINT-002",
        productName: "Tinta Cinza 18L",
        divergenceQty: 1,
        deadline: futureDeadline,
        ledger: { storeId: "store-1" },
      },
    ]);

    const result = await evaluateRules("store-1");

    expect(result).toHaveLength(0);
  });
});
