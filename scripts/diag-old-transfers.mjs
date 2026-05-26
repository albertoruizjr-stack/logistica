// Diagnóstico (read-only): transferências com mais de 24h não-finalizadas
// Mostra contagem por status, lojas envolvidas, DRs vinculadas e amostra.
// Uso: node scripts/diag-old-transfers.mjs
import fs from "node:fs";
import path from "node:path";

const envText = fs.readFileSync(path.resolve(".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)="(.*)"$/);
  if (m) process.env[m[1]] = m[2];
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
console.log(`\nCutoff: requestedAt < ${cutoff.toISOString()}\n`);

const byStatus = await prisma.$queryRawUnsafe(`
  SELECT status, COUNT(*)::int AS qtd
    FROM transfers
   WHERE "requestedAt" < $1
     AND status NOT IN ('RECEIVED','CANCELLED')
   GROUP BY status
   ORDER BY qtd DESC
`, cutoff);

console.log("Transfers >24h não-finalizadas por status:");
console.table(byStatus);

const total = byStatus.reduce((s, r) => s + r.qtd, 0);
console.log(`Total a tratar: ${total}\n`);

if (total === 0) {
  await prisma.$disconnect();
  process.exit(0);
}

const sample = await prisma.transfer.findMany({
  where: {
    requestedAt: { lt: cutoff },
    status: { notIn: ["RECEIVED", "CANCELLED"] },
  },
  include: {
    fromStore: { select: { code: true } },
    toStore: { select: { code: true } },
    items: { select: { id: true, quantity: true, sentQty: true, receivedQty: true } },
    deliveryRequest: { select: { id: true, orderNumber: true, status: true } },
  },
  orderBy: { requestedAt: "asc" },
  take: 10,
});

console.log("Amostra (10 mais antigas):");
for (const t of sample) {
  const ageHours = Math.round((Date.now() - t.requestedAt.getTime()) / 3.6e6);
  const hasNF = t.nfCitelNumero ? `NF ${t.nfCitelNumero}` : t.teNumber ? `TE ${t.teNumber}` : "sem doc";
  const dr = t.deliveryRequest ? `DR ${t.deliveryRequest.orderNumber}=${t.deliveryRequest.status}` : "sem DR";
  console.log(`  ${t.id.slice(-8)} | ${t.fromStore.code}→${t.toStore.code} | ${t.status} | ${ageHours}h | ${t.items.length} itens | ${hasNF} | ${dr}`);
}

// Quantas vão tocar DRs vinculadas (cascata via handleTransferReceivedOnRequest)
const linkedToDR = await prisma.transfer.count({
  where: {
    requestedAt: { lt: cutoff },
    status: { notIn: ["RECEIVED", "CANCELLED"] },
    deliveryRequestId: { not: null },
  },
});
const standalone = total - linkedToDR;
console.log(`\nVínculo com DeliveryRequest:`);
console.log(`  ${linkedToDR} ligadas a DR (cascata: ao virar RECEIVED, tenta avançar DR pra SEPARADO)`);
console.log(`  ${standalone} autônomas (só mexem no ledger)`);

// Quantas com NF (já tem Citel controlando) vs sem NF (estoque ainda no ledger)
const withNF = await prisma.transfer.count({
  where: {
    requestedAt: { lt: cutoff },
    status: { notIn: ["RECEIVED", "CANCELLED"] },
    nfCitelNumero: { not: null },
  },
});
const withoutNF = total - withNF;
console.log(`\nEstoque comprometido:`);
console.log(`  ${withNF} com NF (Citel já controla — markReceived só reconcilia)`);
console.log(`  ${withoutNF} sem NF (ledger ainda tem qtdComprometida — releaseStock + reconcile)`);

// Lojas envolvidas
const lojas = await prisma.$queryRawUnsafe(`
  SELECT s.code AS loja,
         SUM(CASE WHEN t."fromStoreId" = s.id THEN 1 ELSE 0 END)::int AS origem,
         SUM(CASE WHEN t."toStoreId"   = s.id THEN 1 ELSE 0 END)::int AS destino
    FROM transfers t
    JOIN stores s ON s.id = t."fromStoreId" OR s.id = t."toStoreId"
   WHERE t."requestedAt" < $1
     AND t.status NOT IN ('RECEIVED','CANCELLED')
   GROUP BY s.code
   ORDER BY s.code
`, cutoff);
console.log(`\nLojas envolvidas:`);
console.table(lojas);

// Quantas têm origem = destino (placeholder bug "132→132")
const placeholders = await prisma.$queryRawUnsafe(`
  SELECT COUNT(*)::int AS qtd
    FROM transfers
   WHERE "requestedAt" < $1
     AND status NOT IN ('RECEIVED','CANCELLED')
     AND "fromStoreId" = "toStoreId"
`, cutoff);
console.log(`\nCom placeholder (fromStore = toStore, sem origem real): ${placeholders[0].qtd}`);

await prisma.$disconnect();
