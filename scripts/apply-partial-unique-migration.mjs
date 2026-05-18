// Aplica prisma/migration_partial_unique_order.sql no Supabase.
// Mesma estratégia do scripts/apply-migration.mjs: DIRECT_URL + pg client.
import { readFileSync } from "fs";
import pg from "pg";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*"?(.*?)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("✗ DIRECT_URL/DATABASE_URL ausente em .env.local");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log(`✓ Conectado: ${url.split("@")[1]?.split("?")[0] ?? "(host oculto)"}\n`);

// Snapshot pré-migration
console.log("=== ANTES ===");
const before = await client.query(`
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE tablename = 'delivery_requests'
    AND (indexname LIKE '%orderNumber%' OR indexname LIKE '%order_number%')
`);
for (const row of before.rows) {
  console.log(`  ${row.indexname}`);
  console.log(`    ${row.indexdef}`);
}
if (before.rows.length === 0) console.log("  (nenhum índice de orderNumber encontrado)");

// Aplica
console.log("\n=== APLICANDO ===");
const sql = readFileSync("prisma/migration_partial_unique_order.sql", "utf8");
try {
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  console.log("✓ Migration aplicada (transação commitada).");
} catch (err) {
  await client.query("ROLLBACK");
  console.error(`✗ Erro — rollback aplicado: ${err.message}`);
  await client.end();
  process.exit(1);
}

// Snapshot pós-migration
console.log("\n=== DEPOIS ===");
const after = await client.query(`
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE tablename = 'delivery_requests'
    AND (indexname LIKE '%orderNumber%' OR indexname LIKE '%order_number%')
`);
for (const row of after.rows) {
  console.log(`  ${row.indexname}`);
  console.log(`    ${row.indexdef}`);
}

await client.end();
console.log("\n✓ Concluído.");
