// Aplica prisma/migration_5_etapas_transfer.sql no Supabase via DIRECT_URL
// Uso:
//   node scripts/apply-migration-5-etapas.mjs           # dry-run (lista seções)
//   node scripts/apply-migration-5-etapas.mjs --execute # aplica de fato
import fs from "node:fs";
import path from "node:path";

const envText = fs.readFileSync(path.resolve(".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)="(.*)"$/);
  if (m) process.env[m[1]] = m[2];
}

const EXECUTE = process.argv.includes("--execute");
const SQL_PATH = path.resolve("prisma/migration_5_etapas_transfer.sql");
const sql = fs.readFileSync(SQL_PATH, "utf8");

// Divide o SQL em blocos por comentário "-- N." pra log progressivo
const blocks = sql.split(/^-- \d+\./m).slice(1);
console.log(`\n${EXECUTE ? "EXECUTANDO" : "DRY-RUN"} | ${blocks.length} seções\n`);

if (!EXECUTE) {
  blocks.forEach((b, i) => {
    const firstLine = b.trim().split("\n")[0];
    console.log(`  [${i + 1}] ${firstLine.slice(0, 80)}`);
  });
  console.log("\nUse --execute para aplicar no banco.");
  process.exit(0);
}

const { Client } = await import("pg");
const url = process.env.DIRECT_URL;
if (!url) throw new Error("DIRECT_URL não encontrada em .env.local");

const client = new Client({ connectionString: url });
await client.connect();

try {
  // PostgreSQL exige que ALTER TYPE ADD VALUE seja commitado antes do enum
  // value novo ser usado. Por isso executamos seção por seção em queries
  // separadas — cada client.query() é sua própria transação implícita.
  // As seções já estão no array `blocks` (split por "-- N."). Reaplicamos o
  // header "-- N." pra preservar comentários nos logs do servidor.
  for (let i = 0; i < blocks.length; i++) {
    const header = `-- ${i + 1}.`;
    const sqlChunk = header + blocks[i];
    process.stdout.write(`  [${i + 1}/${blocks.length}] ${blocks[i].trim().split("\n")[0].slice(0, 70)} ... `);
    await client.query(sqlChunk);
    console.log("✓");
  }
  console.log("\n✓ Migration aplicada com sucesso");

  // Verificações pós-migration
  const checks = [
    `SELECT v FROM (SELECT unnest(enum_range(NULL::"TransferStatus"))::text AS v) s WHERE s.v IN ('AWAITING_APPROVAL','READY_TO_COLLECT','DELIVERED')`,
    `SELECT column_name FROM information_schema.columns WHERE table_name='transfers' AND column_name IN ('originIndicatedAt','deliveredAt','deliveryPhotoUrl')`,
    `SELECT column_name FROM information_schema.columns WHERE table_name='transfer_items' AND column_name IN ('teNumber','nfCitelNumero','collectConfirmed')`,
    `SELECT indexname FROM pg_indexes WHERE tablename='transfers' AND indexname IN ('transfers_status_toStoreId_idx','transfers_status_fromStoreId_idx')`,
    `SELECT conname FROM pg_constraint WHERE conname = 'transfer_origin_required'`,
  ];
  for (const q of checks) {
    const r = await client.query(q);
    console.log(`✓ ${r.rowCount} resultado(s) para: ${q.slice(0, 80)}...`);
  }
} catch (err) {
  console.error("✗ Falha:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
