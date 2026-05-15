// Aplica prisma/migration_fase1_tabela_e_organograma.sql no Supabase.
// Mesma estrutura do apply-migration.mjs original, apontando para o novo arquivo.
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

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
const sql = readFileSync("prisma/migration_fase1_tabela_e_organograma.sql", "utf8");

// Divide por seções "-- ── N. ..."
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

console.log(`\nMigration Fase 1: ${sections.length} seções`);
console.log(`Destino:   ${url.replace(/:([^:@]+)@/, ":***@")}\n`);

await client.connect();
console.log("✓ Conectado\n");

let ok = 0, fail = 0;
for (const sec of sections) {
  const body = sec.body.trim();
  if (!body || body.split(/\r?\n/).every(l => l.trim().startsWith("--") || !l.trim())) continue;
  process.stdout.write(`  ${sec.title.padEnd(60)} `);
  try {
    const r = await client.query(body);
    const rowCount = Array.isArray(r) ? r.reduce((s, x) => s + (x.rowCount ?? 0), 0) : (r.rowCount ?? 0);
    console.log(`✅ ${rowCount ? `(${rowCount} linhas)` : ""}`);
    ok++;
  } catch (e) {
    console.log(`❌ ${e.message.slice(0, 120)}`);
    fail++;
  }
}

console.log(`\nResultado: ${ok} ok / ${fail} erros\n`);

// Verificações
console.log("🔍 Verificações pós-migration:");
const checks = [
  { label: "User.citelUserCode existe",
    sql: `SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='citelUserCode'` },
  { label: "DeliveryRequest.dispatchStoreId existe",
    sql: `SELECT 1 FROM information_schema.columns WHERE table_name='delivery_requests' AND column_name='dispatchStoreId'` },
  { label: "FreightZone.expressBasePrice existe",
    sql: `SELECT 1 FROM information_schema.columns WHERE table_name='freight_zones' AND column_name='expressBasePrice'` },
  { label: "7 novas zonas ativas (z1 a z7)",
    sql: `SELECT 1 FROM freight_zones WHERE id LIKE 'zone_z%_2026' AND active=true HAVING count(*) = 7` },
  { label: "Renato com citelUserCode 003",
    sql: `SELECT 1 FROM users WHERE email='renato@mestredapintura.com.br' AND "citelUserCode"='003'` },
  { label: "Leoni vinculado à loja 191",
    sql: `SELECT 1 FROM users u JOIN stores s ON s.id=u."storeId" WHERE u.email='leoni@mestredapintura.com.br' AND s.code='191'` },
  { label: "Edielson vinculado à loja 173",
    sql: `SELECT 1 FROM users u JOIN stores s ON s.id=u."storeId" WHERE u.email='edielson@mestredapintura.com.br' AND s.code='173'` },
  { label: "Placeholders desativados",
    sql: `SELECT 1 FROM users WHERE email='vendedor067@mestredapintura.com.br' AND active=false` },
];
for (const c of checks) {
  const r = await client.query(c.sql);
  console.log(`  ${r.rowCount > 0 ? "✅" : "❌"} ${c.label}`);
}

await client.end();
process.exit(fail > 0 ? 1 : 0);
