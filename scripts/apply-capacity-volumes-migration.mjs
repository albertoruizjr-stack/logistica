// Aplica prisma/migration_capacity_and_volumes.sql no Supabase.
// Padrão do projeto: DIRECT_URL + pg + transação BEGIN/COMMIT.
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
console.log(`✓ Conectado: ${url.split("@")[1]?.split("?")[0]}\n`);

// Snapshot pré-migration (sem maxLoadKg que ainda pode não existir)
console.log("=== ANTES ===");
const before = await client.query(`
  SELECT name, "vehicleType"
  FROM drivers
  WHERE active = true
  ORDER BY name
`);
for (const r of before.rows) {
  console.log(`  ${r.name.padEnd(28)} ${r.vehicleType ?? "—"}`);
}

console.log("\n=== APLICANDO ===");
const sql = readFileSync("prisma/migration_capacity_and_volumes.sql", "utf8");
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

console.log("\n=== DEPOIS ===");
const after = await client.query(`
  SELECT name, "vehicleType", "maxLoadKg"
  FROM drivers
  WHERE active = true
  ORDER BY name
`);
for (const r of after.rows) {
  const marker = r.maxLoadKg ? "✓" : " ";
  console.log(`  ${marker} ${r.name.padEnd(28)} ${r.vehicleType ?? "—"}  ${r.maxLoadKg ?? "—"} kg`);
}

await client.end();
console.log("\n✓ Concluído.");
