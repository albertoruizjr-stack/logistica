#!/usr/bin/env node
// scripts/clean-test-data.mjs
// Limpa dados operacionais de teste preservando cadastros (lojas, usuários,
// motoristas, zonas, configs) e caches do Google (já pagos).
//
// Uso:
//   node scripts/clean-test-data.mjs              # dry-run: só mostra contagens
//   node scripts/clean-test-data.mjs --apply      # executa de verdade
//
// Lê DATABASE_URL/DIRECT_URL do .env.local. Em produção, prefere DIRECT_URL
// pra evitar timeout do pooler em DELETEs grandes.

import { readFileSync } from "fs";
import pg from "pg";
import readline from "readline";

// Carrega .env.local manualmente (mesmo padrão de scripts/apply-migration.mjs)
for (const envFile of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*"?(.*?)"?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch { /* arquivo não existe, segue */ }
}

const APPLY     = process.argv.includes("--apply");
const SKIP_PROMPT = process.argv.includes("--yes");

// Tabelas a limpar — em ordem (filhas → pais) pra evitar erros de FK.
// TRUNCATE CASCADE resolveria também, mas listar explícito é menos surpresa.
const TABLES_TO_CLEAN = [
  // Camada 1: filhas mais profundas (sem ninguém dependente)
  "delivery_proofs",
  "delivery_status_history",
  "delivery_items",
  "transfer_history",
  "transfer_items",
  "transfer_divergences",
  "lalamove_events",
  "control_tower_alert_items",
  "stock_ledger_entries",
  "freight_audits",
  "driver_locations",

  // Camada 2: dependem da camada 1
  "lalamove_orders",
  "dispatches",
  "routes",
  "routing_waves",
  "freight_quotes",
  "control_tower_alerts",
  "stock_ledgers",

  // Camada 3: pais operacionais
  "delivery_requests",
  "transfers",
  "notifications",
  "abc_classifications",
  "citel_sync_jobs",
  "erp_sync_alerts",
  "nf_link_jobs",
  "freight_decision_logs",
  "operational_metrics_snapshots",
];

const TABLES_TO_PRESERVE = [
  "stores",
  "users",
  "drivers",
  "freight_zones",
  "system_configs",
  "audit_configs",
  "route_cache",
  "geocoding_cache",
  "maps_usage_logs",
];

async function main() {
  const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("✗ DATABASE_URL/DIRECT_URL não encontrados em .env.local");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log(`✓ Conectado: ${dbUrl.split("@")[1]?.split("?")[0] ?? "(host oculto)"}`);
  console.log(`Modo: ${APPLY ? "🔴 APPLY (vai apagar)" : "🟢 DRY-RUN (não apaga nada)"}\n`);

  // 1. Contagem antes
  console.log("=== Contagem ANTES ===");
  const before = await countAll(client, [...TABLES_TO_CLEAN, ...TABLES_TO_PRESERVE]);
  printCounts(before, TABLES_TO_CLEAN, TABLES_TO_PRESERVE);

  const totalToDelete = TABLES_TO_CLEAN.reduce((acc, t) => acc + (before[t] ?? 0), 0);
  if (totalToDelete === 0) {
    console.log("\n✓ Nenhum dado operacional pra apagar. Tudo limpo.");
    await client.end();
    return;
  }
  console.log(`\nTotal de linhas operacionais a apagar: ${totalToDelete}`);

  if (!APPLY) {
    console.log("\n(modo dry-run — nada foi apagado. Rode de novo com --apply pra executar.)");
    await client.end();
    return;
  }

  // 2. Confirmação interativa
  if (!SKIP_PROMPT) {
    const ok = await confirm(`\n⚠️  Apagar ${totalToDelete} linhas em ${TABLES_TO_CLEAN.length} tabelas? Digite "SIM" para confirmar: `);
    if (!ok) {
      console.log("Abortado.");
      await client.end();
      return;
    }
  }

  // 3. Apaga em transação
  console.log("\nApagando…");
  await client.query("BEGIN");
  try {
    for (const table of TABLES_TO_CLEAN) {
      const result = await client.query(`DELETE FROM "${table}"`);
      console.log(`  ✓ ${table.padEnd(36)} ${result.rowCount} linhas`);
    }

    // Reset driver.available = true (drivers podem ter ficado presos de testes)
    const drv = await client.query(`UPDATE drivers SET available = true WHERE available = false`);
    console.log(`  ✓ drivers.available=true            ${drv.rowCount} motoristas liberados`);

    await client.query("COMMIT");
    console.log("\n✓ Transação commitada.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`\n✗ Erro — rollback aplicado: ${err.message}`);
    await client.end();
    process.exit(1);
  }

  // 4. Contagem depois
  console.log("\n=== Contagem DEPOIS ===");
  const after = await countAll(client, [...TABLES_TO_CLEAN, ...TABLES_TO_PRESERVE]);
  printCounts(after, TABLES_TO_CLEAN, TABLES_TO_PRESERVE);

  await client.end();
  console.log("\n✓ Concluído. Sistema pronto pra produção.");
}

async function countAll(client, tables) {
  const out = {};
  for (const t of tables) {
    try {
      const r = await client.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
      out[t] = r.rows[0].n;
    } catch {
      out[t] = -1; // tabela inexistente
    }
  }
  return out;
}

function printCounts(counts, toDelete, toPreserve) {
  console.log("\nApagar:");
  for (const t of toDelete) {
    const n = counts[t];
    if (n === -1) console.log(`  ${t.padEnd(36)} (tabela não existe)`);
    else          console.log(`  ${t.padEnd(36)} ${String(n).padStart(6)} linhas`);
  }
  console.log("\nManter:");
  for (const t of toPreserve) {
    const n = counts[t];
    if (n === -1) console.log(`  ${t.padEnd(36)} (tabela não existe)`);
    else          console.log(`  ${t.padEnd(36)} ${String(n).padStart(6)} linhas`);
  }
}

function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toUpperCase() === "SIM");
    });
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
