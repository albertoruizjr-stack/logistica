// scripts/seed-stock-ledger.ts
//
// Popula StockLedger com saldo físico atual do Citel.
// Executar UMA VEZ antes de ativar o Pilar 1 em staging.
//
// Uso: npm run db:seed-ledger
// Variáveis obrigatórias: DATABASE_URL, DIRECT_URL, CITEL_API_URL, CITEL_LOGIN, CITEL_SENHA

import { PrismaClient } from "@prisma/client";
import { syncFromCitel } from "../services/stock-ledger.service";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Seed StockLedger — Pilar 1 ===");
  console.log("Fonte: Citel/Autcom | Destino: stock_ledgers\n");

  const stores = await prisma.store.findMany({
    where: { active: true, codigoEmpresaCitel: { not: null } },
    select: { id: true, code: true, name: true, codigoEmpresaCitel: true },
  });

  if (stores.length === 0) {
    console.error("Nenhuma loja ativa com codigoEmpresaCitel encontrada.");
    console.error("Verifique se o seed de lojas foi executado antes deste script.");
    process.exit(1);
  }

  console.log(`Lojas encontradas: ${stores.length}`);
  stores.forEach((s) =>
    console.log(`  · ${s.code} — ${s.name} (empresa Citel: ${s.codigoEmpresaCitel})`)
  );
  console.log();

  let totalSynced = 0;
  let totalErrors = 0;

  for (const store of stores) {
    process.stdout.write(`Sincronizando loja ${store.code} (${store.name})... `);
    try {
      const result = await syncFromCitel(store.id, store.codigoEmpresaCitel!);
      totalSynced += result.synced;
      totalErrors += result.errors;
      console.log(`OK — ${result.synced} produtos sincronizados, ${result.errors} erros`);
    } catch (err) {
      totalErrors++;
      console.log(`FALHOU — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log("\n=== Resultado ===");
  console.log(`Produtos sincronizados: ${totalSynced}`);
  console.log(`Erros:                  ${totalErrors}`);

  if (totalErrors > 0) {
    console.warn("\nATENÇÃO: houve erros. Verifique se o Citel está acessível e");
    console.warn("se CITEL_API_URL, CITEL_LOGIN, CITEL_SENHA estão configurados.");
    process.exit(1);
  }

  console.log("\nSeed concluído. qtdComprometida=0 e qtdEmTransito=0 para todos os produtos.");
  console.log("O Pilar 1 está pronto para receber transferências.");
}

main()
  .catch((err) => {
    console.error("Erro fatal:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
