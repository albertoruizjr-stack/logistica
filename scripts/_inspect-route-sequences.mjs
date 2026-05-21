// SÓ LEITURA. Inspeciona sequenceJson das rotas ACTIVE pra achar paradas sem deliveryRequestId
// (paradas manuais STORE_VISIT/EXTRA_STOP) que quebram a tela de despacho.
import { readFileSync } from "fs";
import pg from "pg";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*"?(.*?)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

await client.connect();
const { rows } = await client.query(
  `SELECT id, name, "driverId", status, "sequenceJson"
   FROM routes
   WHERE status = 'ACTIVE'
   ORDER BY "createdAt" DESC`,
);

console.log(`Rotas ACTIVE: ${rows.length}\n`);
for (const r of rows) {
  const seq = Array.isArray(r.sequenceJson) ? r.sequenceJson : [];
  const semDR = seq.filter((s) => !s || s.deliveryRequestId == null);
  console.log(`Rota ${r.id.slice(-6)} "${r.name ?? ""}" — ${seq.length} paradas, ${semDR.length} SEM deliveryRequestId`);
  if (semDR.length > 0) {
    console.log("  ⚠ Paradas problemáticas:");
    for (const s of semDR) console.log("   ", JSON.stringify(s));
  }
}

await client.end();
