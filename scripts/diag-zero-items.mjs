// Diagnóstico: lista solicitações com itens=0 ou totalWeightKg=0
// Uso: node scripts/diag-zero-items.mjs
import fs from "node:fs";
import path from "node:path";

// Carrega .env.local manualmente
const envText = fs.readFileSync(path.resolve(".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)="(.*)"$/);
  if (m) process.env[m[1]] = m[2];
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

const rows = await prisma.$queryRawUnsafe(`
  SELECT dr.id,
         dr."orderNumber",
         dr."orderStoreId",
         dr."customerName",
         dr.status,
         COALESCE(dr."totalWeightKg", 0) AS weight,
         COUNT(di.id) AS items,
         dr."createdAt"::text AS created
    FROM delivery_requests dr
    LEFT JOIN delivery_items di ON di."deliveryRequestId" = dr.id
   WHERE dr.status NOT IN ('CANCELLED','DELIVERED')
     AND dr."orderNumber" IS NOT NULL
   GROUP BY dr.id
   ORDER BY dr."createdAt" DESC
   LIMIT 30
`);

const broken = rows.filter(r => Number(r.items) === 0);
console.log(`\n${rows.length} solicitações ativas com PD. ${broken.length} com itens=0.\n`);

for (const r of broken) {
  console.log(`  PD ${r.orderNumber} · ${r.customerName.slice(0, 35).padEnd(35)} · ${r.status.padEnd(20)} · ${r.created.slice(0, 16)}`);
}

await prisma.$disconnect();
