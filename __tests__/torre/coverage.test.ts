// __tests__/torre/coverage.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { calculateCoverageForStore } from "../../services/torre/coverage.service";

vi.mock("../../lib/prisma", () => ({
  prisma: {
    abcClassification: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    stockLedger: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "../../lib/prisma";

describe("calculateCoverageForStore", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calcula coverageDaysActual quando avgDailySales > 0", async () => {
    (prisma.abcClassification.findMany as any).mockResolvedValue([
      {
        storeId: "store-1",
        productCode: "TINT-001",
        coverageDaysTarget: 30,
        minStock: 5,
        avgDailySales: 2,
        classification: "A",
      },
    ]);
    (prisma.stockLedger.findMany as any).mockResolvedValue([
      {
        storeId: "store-1",
        productCode: "TINT-001",
        qtdFisica: 20,
        qtdComprometida: 0,
      },
    ]);
    (prisma.abcClassification.updateMany as any).mockResolvedValue({ count: 1 });

    const result = await calculateCoverageForStore("store-1");

    expect(result).toHaveLength(1);
    expect(result[0].coverageDaysActual).toBe(10); // 20 / 2
    expect(result[0].aboveMinStock).toBe(true);    // 20 >= 5
  });

  it("retorna coverageDaysActual null quando avgDailySales não está definida", async () => {
    (prisma.abcClassification.findMany as any).mockResolvedValue([
      {
        storeId: "store-1",
        productCode: "TINT-002",
        coverageDaysTarget: 30,
        minStock: null,
        avgDailySales: null,
        classification: "B",
      },
    ]);
    (prisma.stockLedger.findMany as any).mockResolvedValue([
      {
        storeId: "store-1",
        productCode: "TINT-002",
        qtdFisica: 10,
        qtdComprometida: 2,
      },
    ]);
    (prisma.abcClassification.updateMany as any).mockResolvedValue({ count: 1 });

    const result = await calculateCoverageForStore("store-1");

    expect(result[0].coverageDaysActual).toBeNull();
    expect(result[0].qtdDisponivel).toBe(8); // 10 - 2
  });

  it("retorna coverageDaysActual null quando avgDailySales é 0", async () => {
    (prisma.abcClassification.findMany as any).mockResolvedValue([
      {
        storeId: "store-1",
        productCode: "TINT-003",
        coverageDaysTarget: 30,
        minStock: 5,
        avgDailySales: 0,
        classification: "C",
      },
    ]);
    (prisma.stockLedger.findMany as any).mockResolvedValue([
      {
        storeId: "store-1",
        productCode: "TINT-003",
        qtdFisica: 15,
        qtdComprometida: 0,
      },
    ]);
    (prisma.abcClassification.updateMany as any).mockResolvedValue({ count: 1 });

    const result = await calculateCoverageForStore("store-1");

    // avgDailySales = 0 → divisão por zero → null (não Infinity)
    expect(result[0].coverageDaysActual).toBeNull();
  });

  it("desconta qtdComprometida do saldo disponível", async () => {
    (prisma.abcClassification.findMany as any).mockResolvedValue([
      {
        storeId: "store-1",
        productCode: "TINT-004",
        coverageDaysTarget: 30,
        minStock: 5,
        avgDailySales: 4,
        classification: "A",
      },
    ]);
    (prisma.stockLedger.findMany as any).mockResolvedValue([
      {
        storeId: "store-1",
        productCode: "TINT-004",
        qtdFisica: 20,
        qtdComprometida: 8,  // 8 unidades comprometidas para transferências
      },
    ]);
    (prisma.abcClassification.updateMany as any).mockResolvedValue({ count: 1 });

    const result = await calculateCoverageForStore("store-1");

    // qtdDisponivel = 20 - 8 = 12
    // coverageDaysActual = 12 / 4 = 3
    expect(result[0].qtdDisponivel).toBe(12);
    expect(result[0].coverageDaysActual).toBe(3);
  });

  it("aboveMinStock é false quando qtdDisponivel < minStock", async () => {
    (prisma.abcClassification.findMany as any).mockResolvedValue([
      {
        storeId: "store-1",
        productCode: "TINT-005",
        coverageDaysTarget: 30,
        minStock: 10,
        avgDailySales: 1,
        classification: "A",
      },
    ]);
    (prisma.stockLedger.findMany as any).mockResolvedValue([
      {
        storeId: "store-1",
        productCode: "TINT-005",
        qtdFisica: 8,
        qtdComprometida: 0,
      },
    ]);
    (prisma.abcClassification.updateMany as any).mockResolvedValue({ count: 1 });

    const result = await calculateCoverageForStore("store-1");

    expect(result[0].aboveMinStock).toBe(false); // 8 < 10
  });

  it("retorna lista vazia quando loja não tem classificações ABC", async () => {
    (prisma.abcClassification.findMany as any).mockResolvedValue([]);

    const result = await calculateCoverageForStore("store-sem-abc");

    expect(result).toHaveLength(0);
    expect(prisma.stockLedger.findMany).not.toHaveBeenCalled();
  });
});
