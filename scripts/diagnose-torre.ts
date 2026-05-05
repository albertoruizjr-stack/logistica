// scripts/diagnose-torre.ts
// Valida o pipeline Torre de Controle diretamente no banco (sem Citel API)
// Uso: npx tsx scripts/diagnose-torre.ts

import { prisma } from "../lib/prisma";
import { evaluateRules } from "../services/torre/audit-engine.service";
import { processOccurrences } from "../services/torre/alert-engine.service";

async function main() {
  console.log("🔍 Diagnóstico Torre de Controle\n");

  const stores = await prisma.store.findMany({
    where: { active: true },
    select: { id: true, code: true, name: true },
  });

  console.log(`Lojas ativas: ${stores.length}`);

  for (const store of stores) {
    console.log(`\n--- Loja ${store.code} (${store.name}) ---`);

    const abcCount = await prisma.abcClassification.count({ where: { storeId: store.id } });
    const ledgerCount = await prisma.stockLedger.count({ where: { storeId: store.id } });
    console.log(`  ABC classificados: ${abcCount}`);
    console.log(`  StockLedger entries: ${ledgerCount}`);

    const occurrences = await evaluateRules(store.id);
    console.log(`  Ocorrências detectadas: ${occurrences.length}`);
    for (const o of occurrences) {
      console.log(`    → [${o.ruleId}] ${o.severity} | ${o.items.length} itens | groupKey: ${o.groupKey}`);
    }

    if (occurrences.length > 0) {
      await processOccurrences(occurrences, { storeId: store.id, ruleIds: ["R03", "R10"] });
      console.log(`  ✅ processOccurrences executado`);
    }
  }

  const totalAlerts = await prisma.controlTowerAlert.count();
  const openAlerts = await prisma.controlTowerAlert.count({
    where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
  });

  console.log(`\n📊 Resumo alertas:`);
  console.log(`  Total: ${totalAlerts}`);
  console.log(`  Abertos: ${openAlerts}`);

  const byStore = await prisma.controlTowerAlert.groupBy({
    by: ["storeId", "severity", "status"],
    _count: true,
    where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
  });

  for (const g of byStore) {
    const store = stores.find((s) => s.id === g.storeId);
    console.log(`  Loja ${store?.code ?? g.storeId}: ${g.severity} / ${g.status} → ${g._count}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("❌ Erro:", err);
  process.exit(1);
});
