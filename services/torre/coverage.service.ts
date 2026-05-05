// services/torre/coverage.service.ts
import { prisma } from "@/lib/prisma";
import type { CoverageResult } from "@/types/torre";

export async function calculateCoverageForStore(storeId: string): Promise<CoverageResult[]> {
  const classifications = await prisma.abcClassification.findMany({
    where: { storeId },
  });

  if (classifications.length === 0) return [];

  const productCodes = classifications.map((c) => c.productCode);
  const ledgers = await prisma.stockLedger.findMany({
    where: { storeId, productCode: { in: productCodes } },
    select: { productCode: true, qtdFisica: true, qtdComprometida: true },
  });

  const ledgerMap = new Map(ledgers.map((l) => [l.productCode, l]));
  const results: CoverageResult[] = [];
  const now = new Date();

  for (const abc of classifications) {
    const ledger = ledgerMap.get(abc.productCode);
    const qtdFisica = ledger?.qtdFisica ?? 0;
    const qtdComprometida = ledger?.qtdComprometida ?? 0;
    const qtdDisponivel = qtdFisica - qtdComprometida;

    // Divisão por zero: avgDailySales null, undefined, 0 ou negativo → null
    const coverageDaysActual =
      abc.avgDailySales != null && abc.avgDailySales > 0
        ? Math.round((qtdDisponivel / abc.avgDailySales) * 10) / 10
        : null;

    const aboveMinStock =
      abc.minStock == null
        ? true
        : qtdDisponivel >= abc.minStock;

    results.push({
      storeId,
      productCode: abc.productCode,
      qtdDisponivel,
      avgDailySales: abc.avgDailySales ?? null,
      coverageDaysActual,
      coverageDaysTarget: abc.coverageDaysTarget,
      minStock: abc.minStock ?? null,
      aboveMinStock,
    });
  }

  // Persiste coverageDaysActual em batch
  await Promise.all(
    results.map((r) =>
      prisma.abcClassification.updateMany({
        where: { storeId, productCode: r.productCode },
        data: {
          coverageDaysActual: r.coverageDaysActual,
          coverageUpdatedAt: now,
        },
      })
    )
  );

  return results;
}
