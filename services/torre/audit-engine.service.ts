// services/torre/audit-engine.service.ts
//
// Função pura: recebe storeId, avalia regras contra DB local,
// retorna lista de ocorrências. Sem efeitos colaterais.
import { prisma } from "@/lib/prisma";
import type { AlertOccurrence } from "@/types/torre";

function windowSlot(minutes: number): string {
  return String(Math.floor(Date.now() / (minutes * 60 * 1000)));
}

// ── R03 — Estoque abaixo do mínimo ──────────────────────────────────────────
async function evaluateR03(storeId: string): Promise<AlertOccurrence[]> {
  const classifications = await prisma.abcClassification.findMany({
    where: { storeId, minStock: { not: null } },
  });

  if (classifications.length === 0) return [];

  const productCodes = classifications.map((c) => c.productCode);
  const ledgers = await prisma.stockLedger.findMany({
    where: { storeId, productCode: { in: productCodes } },
    select: { productCode: true, qtdFisica: true, qtdComprometida: true },
  });
  const ledgerMap = new Map(ledgers.map((l) => [l.productCode, l]));

  const criticalItems: AlertOccurrence["items"] = [];
  const warningItems: AlertOccurrence["items"] = [];

  for (const abc of classifications) {
    if (abc.minStock === null) continue;

    const ledger = ledgerMap.get(abc.productCode);
    const qtdDisponivel = ledger
      ? ledger.qtdFisica - ledger.qtdComprometida
      : 0;

    // R03 verifica apenas qtdDisponivel vs minStock
    // Não depende de coverageDaysActual — funciona mesmo quando avgDailySales = null
    if (qtdDisponivel < abc.minStock) {
      const item = {
        productCode: abc.productCode,
        productName: abc.productName,
        abcClassification: abc.classification as "A" | "B" | "C",
        metricValue: qtdDisponivel,
        metricUnit: "unidades",
        detail: {
          minStock: abc.minStock,
          deficit: abc.minStock - qtdDisponivel,
          coverageDaysActual: abc.coverageDaysActual ?? null,
        },
      };

      if (abc.classification === "A") {
        criticalItems.push(item);
      } else {
        warningItems.push(item);
      }
    }
  }

  const occurrences: AlertOccurrence[] = [];

  if (criticalItems.length > 0) {
    occurrences.push({
      ruleId: "R03",
      type: "ABAIXO_MINIMO",
      severity: "CRITICAL",
      storeId,
      actionType: "CREATE_TRANSFER",
      slaMinutes: 240,
      ownerRole: "COMPRAS",
      groupKey: `${storeId}_R03_CRITICAL_${windowSlot(30)}`,
      dataConfidence: "HIGH",
      items: criticalItems,
    });
  }

  if (warningItems.length > 0) {
    occurrences.push({
      ruleId: "R03",
      type: "ABAIXO_MINIMO",
      severity: "WARNING",
      storeId,
      actionType: "CREATE_TRANSFER",
      slaMinutes: 1440,
      ownerRole: "COMPRAS",
      groupKey: `${storeId}_R03_WARNING_${windowSlot(120)}`,
      dataConfidence: "HIGH",
      items: warningItems,
    });
  }

  return occurrences;
}

// ── R10 — Divergência de transferência em aberto ────────────────────────────
async function evaluateR10(storeId: string): Promise<AlertOccurrence[]> {
  const now = new Date();

  // Reutiliza TransferDivergence do Pilar 1 — sem duplicar lógica
  const candidates = await prisma.transferDivergence.findMany({
    where: {
      status: "PENDING_RESOLUTION",
      deadline: { lt: now },
      ledger: { storeId },
    },
    include: {
      ledger: { select: { storeId: true } },
    },
  });

  // Filtra pós-query para garantir comportamento correto também em testes com mocks
  const overdue = candidates.filter((div) => div.deadline < now);

  if (overdue.length === 0) return [];

  const items = overdue.map((div) => ({
    productCode: div.productCode,
    productName: div.productName,
    metricValue: Math.abs(div.divergenceQty),
    metricUnit: "unidades",
    detail: {
      divergenceQty: div.divergenceQty,
      transferId: div.transferId,
      deadlineVencidaEm: div.deadline.toISOString(),
    },
  }));

  return [
    {
      ruleId: "R10",
      type: "DIVERGENCIA_TRANSFERENCIA",
      severity: "WARNING",
      storeId,
      actionType: "RESOLVE_DIVERGENCE",
      slaMinutes: 1440,
      ownerRole: "LIDER_DESTINO",
      groupKey: `${storeId}_R10_${windowSlot(120)}`,
      dataConfidence: "HIGH",
      items,
    },
  ];
}

// ── Entry point ─────────────────────────────────────────────────────────────
export async function evaluateRules(storeId: string): Promise<AlertOccurrence[]> {
  const [r03, r10] = await Promise.all([evaluateR03(storeId), evaluateR10(storeId)]);
  return [...r03, ...r10];
}
