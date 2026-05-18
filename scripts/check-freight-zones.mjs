// Lê (sem alterar) o que está em freight_zones no banco e compara com a tabela
// agressiva acordada em 2026-05-13 (Fase 1 da nova regra de frete).
import { readFileSync } from "fs";
import pg from "pg";

for (const envFile of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*"?(.*?)"?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch { /* segue */ }
}

const expected = [
  { name: "Z1", minKm: 0,  maxKm: 3,    basePrice: 15, expressBasePrice: 25 },
  { name: "Z2", minKm: 3,  maxKm: 6,    basePrice: 22, expressBasePrice: 35 },
  { name: "Z3", minKm: 6,  maxKm: 10,   basePrice: 32, expressBasePrice: 48 },
  { name: "Z4", minKm: 10, maxKm: 15,   basePrice: 45, expressBasePrice: 63 },
  { name: "Z5", minKm: 15, maxKm: 22,   basePrice: 60, expressBasePrice: 78 },
  { name: "Z6", minKm: 22, maxKm: 30,   basePrice: 80, expressBasePrice: 94 },
  { name: "Z7", minKm: 30, maxKm: null, basePrice: null, expressBasePrice: null }, // sob consulta
];

const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows } = await client.query(`
  SELECT name, "minKm", "maxKm", "basePrice", "expressBasePrice",
         "urgentFactor", active, "underConsultation"
  FROM freight_zones
  ORDER BY active DESC, "minKm" ASC, name ASC
`);

console.log(`\nTotal de zonas no banco: ${rows.length}\n`);

const active   = rows.filter((r) => r.active);
const inactive = rows.filter((r) => !r.active);

console.log("═══ ZONAS ATIVAS ═══");
console.log("Nome | km          | basePrice | expressBase | urgentFactor | sob_consulta");
console.log("-----|-------------|-----------|-------------|--------------|-------------");
for (const r of active) {
  const km = `${r.minKm}–${r.maxKm ?? "∞"}`.padEnd(12);
  const base = r.basePrice == null ? "  null  " : `R$ ${String(r.basePrice).padStart(5)}`;
  const exp  = r.expressBasePrice == null ? "  null  " : `R$ ${String(r.expressBasePrice).padStart(5)}`;
  const fac  = r.urgentFactor == null ? "  null  " : String(r.urgentFactor).padStart(4);
  console.log(`${r.name.padEnd(5)}| ${km}|  ${base}|  ${exp}  |   ${fac}    |   ${r.underConsultation}`);
}

console.log("\n═══ COMPARAÇÃO COM TABELA ACORDADA (2026-05-13) ═══");
let mismatches = 0;
for (const e of expected) {
  const found = active.find((r) => r.name === e.name);
  if (!found) {
    console.log(`✗ ${e.name}: AUSENTE no banco`);
    mismatches++;
    continue;
  }
  const issues = [];
  if (found.minKm !== e.minKm)      issues.push(`minKm=${found.minKm} (esperado ${e.minKm})`);
  if (found.maxKm !== e.maxKm)      issues.push(`maxKm=${found.maxKm} (esperado ${e.maxKm})`);
  if (e.basePrice != null && Number(found.basePrice) !== e.basePrice)
    issues.push(`basePrice=${found.basePrice} (esperado ${e.basePrice})`);
  if (e.expressBasePrice != null && Number(found.expressBasePrice) !== e.expressBasePrice)
    issues.push(`expressBasePrice=${found.expressBasePrice} (esperado ${e.expressBasePrice})`);

  if (issues.length === 0) {
    console.log(`✓ ${e.name}: bate certinho`);
  } else {
    console.log(`✗ ${e.name}: ${issues.join(", ")}`);
    mismatches++;
  }
}

if (inactive.length > 0) {
  console.log(`\n═══ ZONAS LEGADAS (inactive=true) ═══`);
  for (const r of inactive) {
    console.log(`  ${r.name.padEnd(20)} ${r.minKm}–${r.maxKm ?? "∞"}km  base=${r.basePrice} factor=${r.urgentFactor}`);
  }
}

console.log(`\n${mismatches === 0 ? "✓ Banco bate com a tabela acordada." : `⚠ ${mismatches} divergências encontradas.`}`);

await client.end();
