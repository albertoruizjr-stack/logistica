// Remediação: para as 5 Transfers que ficaram com qtdEmTransito pendurada
// após o cleanup-old-transfers.mjs ter falhado por usar nome de enum errado
// (CANCEL_TRANSIT → correto TRANSIT_CANCEL). Idempotente.
//
// Uso:
//   node scripts/cleanup-old-transfers-remediation.mjs           # dry-run
//   node scripts/cleanup-old-transfers-remediation.mjs --execute # aplica
import fs from "node:fs";
import path from "node:path";

const envText = fs.readFileSync(path.resolve(".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)="(.*)"$/);
  if (m) process.env[m[1]] = m[2];
}

const TRANSFER_IDS = [
  "cmpfupz7c000pqafkzhl6m2p6",
  "cmph8lj15001cxm27fius5qym",
  "cmphchnrq001dpbjdkvo8pz1n",
  "cmpii0jir000a10ydf0o95lbo",
  "cmpima19b0009hxty4ormy4ix",
];

const EXECUTE = process.argv.includes("--execute");
const { PrismaClient, StockLedgerEntryType } = await import("@prisma/client");
const prisma = new PrismaClient();

console.log(`\n${EXECUTE ? "EXECUTANDO" : "DRY-RUN"}\n`);

const targets = await prisma.transfer.findMany({
  where: { id: { in: TRANSFER_IDS } },
  include: {
    fromStore: { select: { code: true } },
    toStore: { select: { code: true } },
    items: { select: { productCode: true, productName: true, quantity: true } },
  },
});

for (const t of targets) {
  console.log(`\n${t.id.slice(-8)} ${t.fromStore.code}→${t.toStore.code} (status atual: ${t.status})`);

  for (const item of t.items) {
    // qtdComprometida na origem (placeholder = destino)
    const src = await prisma.stockLedger.findUnique({
      where: { storeId_productCode: { storeId: t.fromStoreId, productCode: item.productCode } },
    });
    const releaseQty = src ? Math.min(item.quantity, src.qtdComprometida) : 0;

    // qtdEmTransito no destino
    const dest = await prisma.stockLedger.findUnique({
      where: { storeId_productCode: { storeId: t.toStoreId, productCode: item.productCode } },
    });
    const cancelQty = dest ? Math.min(item.quantity, dest.qtdEmTransito) : 0;

    console.log(`  ${item.productCode}: release=${releaseQty} cancelTransit=${cancelQty}`);

    if (!EXECUTE) continue;

    if (releaseQty > 0) {
      await prisma.$transaction([
        prisma.stockLedger.update({
          where: { id: src.id },
          data: { qtdComprometida: { decrement: releaseQty }, version: { increment: 1 } },
        }),
        prisma.stockLedgerEntry.create({
          data: {
            ledgerId: src.id,
            type: StockLedgerEntryType.RELEASE,
            qty: releaseQty,
            field: "qtdComprometida",
            referenceId: t.id,
            referenceType: "transfer",
            notes: "Cleanup retroativo - libera commit placeholder (remediation)",
          },
        }),
      ]);
    }

    if (cancelQty > 0) {
      await prisma.$transaction([
        prisma.stockLedger.update({
          where: { id: dest.id },
          data: { qtdEmTransito: { decrement: cancelQty }, version: { increment: 1 } },
        }),
        prisma.stockLedgerEntry.create({
          data: {
            ledgerId: dest.id,
            type: StockLedgerEntryType.TRANSIT_CANCEL,
            qty: cancelQty,
            field: "qtdEmTransito",
            referenceId: t.id,
            referenceType: "transfer",
            notes: "Cleanup retroativo - cancela trânsito placeholder (remediation)",
          },
        }),
      ]);
    }
  }
}

console.log(`\n${targets.length} transfers processadas`);
await prisma.$disconnect();
