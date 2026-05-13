// Aplica prisma/migration_operacao_real_logistica.sql no Supabase.
// Conecta via DIRECT_URL do .env.local (não-pooled, suporta DDL e ADD VALUE em enums).
// Divide por blocos lógicos para reportar progresso e isolar erros.
import { readFileSync } from "fs";
import pg from "pg";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*"?(.*?)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("❌ DIRECT_URL/DATABASE_URL ausente em .env.local");
  process.exit(1);
}

// pg pega o connection string direto e respeita sslmode=require que vem do Supabase
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

const sql = readFileSync("prisma/migration_operacao_real_logistica.sql", "utf8");

// Divide por seções marcadas com `-- ── N. ...` na migration
const sections = [];
let current = { title: "Header", body: "" };
for (const line of sql.split(/\r?\n/)) {
  const header = line.match(/^-- ── \s*(\d+\.\s*.+?)\s*─*$/);
  if (header) {
    if (current.body.trim()) sections.push(current);
    current = { title: header[1], body: line + "\n" };
  } else {
    current.body += line + "\n";
  }
}
if (current.body.trim()) sections.push(current);

console.log(`\nMigration: ${sections.length} seções identificadas`);
console.log(`Destino:   ${url.replace(/:([^:@]+)@/, ":***@")}\n`);

await client.connect();
console.log("✓ Conectado ao Supabase\n");

let okCount = 0, failCount = 0;
for (const sec of sections) {
  const body = sec.body.trim();
  if (!body || body.split(/\r?\n/).every(l => l.trim().startsWith("--") || !l.trim())) {
    // Seção só com comentários — pula silenciosamente
    continue;
  }
  process.stdout.write(`  ${sec.title.padEnd(60)} `);
  try {
    await client.query(body);
    console.log("✅");
    okCount++;
  } catch (e) {
    console.log(`❌ ${e.message.slice(0, 100)}`);
    failCount++;
    // Continua nas próximas seções — todas idempotentes, falhar uma não impede outras
  }
}

console.log(`\nResultado: ${okCount} ok, ${failCount} erros`);

// Verificação rápida: existe RoutingWaveStatus? TransferStatus tem PREPARED?
console.log("\n🔍 Verificação pós-migration:");
const checks = [
  { label: "enum RoutingWaveStatus existe",
    sql: `SELECT 1 FROM pg_type WHERE typname = 'RoutingWaveStatus'` },
  { label: "TransferStatus tem PREPARED",
    sql: `SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'TransferStatus' AND e.enumlabel = 'PREPARED'` },
  { label: "tabela routing_waves existe",
    sql: `SELECT 1 FROM information_schema.tables WHERE table_name = 'routing_waves'` },
  { label: "tabela delivery_proofs existe",
    sql: `SELECT 1 FROM information_schema.tables WHERE table_name = 'delivery_proofs'` },
  { label: "routes.waveId existe",
    sql: `SELECT 1 FROM information_schema.columns WHERE table_name = 'routes' AND column_name = 'waveId'` },
  { label: "drivers.spokeDriverId existe",
    sql: `SELECT 1 FROM information_schema.columns WHERE table_name = 'drivers' AND column_name = 'spokeDriverId'` },
  { label: "transfers.preparedAt existe",
    sql: `SELECT 1 FROM information_schema.columns WHERE table_name = 'transfers' AND column_name = 'preparedAt'` },
];
for (const c of checks) {
  const r = await client.query(c.sql);
  console.log(`  ${r.rowCount > 0 ? "✅" : "❌"} ${c.label}`);
}

await client.end();
process.exit(failCount > 0 ? 1 : 0);
