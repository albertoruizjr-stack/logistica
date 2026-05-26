// Cleanup: cancela transferências >24h presas em APPROVED/PREPARED.
// Estratégia (definida com Alberto 2026-05-26): CANCELLED + libera ledger,
// sem tocar nas DRs vinculadas (já estão em DELIVERED/CANCELLED).
//
// Uso:
//   node scripts/cleanup-old-transfers.mjs           # dry-run (não escreve)
//   node scripts/cleanup-old-transfers.mjs --execute # aplica
import fs from "node:fs";
import path from "node:path";

const envText = fs.readFileSync(path.resolve(".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)="(.*)"$/);
  if (m) process.env[m[1]] = m[2];
}

const EXECUTE = process.argv.includes("--execute");
const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

const { PrismaClient, TransferStatus, StockLedgerEntryType } = await import("@prisma/client");
const prisma = new PrismaClient();

console.log(`\n${EXECUTE ? "EXECUTANDO" : "DRY-RUN"} | cutoff: ${cutoff.toISOString()}\n`);

const targets = await prisma.transfer.findMany({
  where: {
    requestedAt: { lt: cutoff },
    status: { in: [TransferStatus.APPROVED, TransferStatus.PREPARED] },
  },
  include: {
    fromStore: { select: { code: true } },
    toStore: { select: { code: true } },
    items: { select: { id: true, productCode: true, productName: true, quantity: true } },
  },
  orderBy: { requestedAt: "asc" },
});

console.log(`Encontradas: ${targets.length}\n`);
if (targets.length === 0) {
  await prisma.$disconnect();
  process.exit(0);
}

let okCount = 0;
let errCount = 0;
const errors = [];

for (const t of targets) {
  const hadTransit = true; // APPROVED e PREPARED já passaram por markInTransit
  const ageHours = Math.round((Date.now() - t.requestedAt.getTime()) / 3.6e6);
  const label = `${t.id.slice(-8)} ${t.fromStore.code}→${t.toStore.code} ${t.status} ${ageHours}h ${t.items.length}it`;

  if (!EXECUTE) {
    console.log(`  [dry] ${label}`);
    continue;
  }

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Cancela a Transfer
      await tx.transfer.update({
        where: { id: t.id },
        data: {
          status: TransferStatus.CANCELLED,
          cancelledAt: new Date(),
          internalNotes: [t.internalNotes, "[cleanup retroativo 2026-05-26]"].filter(Boolean).join(" "),
        },
      });

      // 2. Histórico
      await tx.transferHistory.create({
        data: {
          transferId: t.id,
          fromStatus: t.status,
          toStatus: TransferStatus.CANCELLED,
          notes: "Cleanup retroativo: transfer placeholder >24h sem origem real definida",
        },
      });
    });

    // 3. Libera ledger fora da transação (cada call tem a sua $transaction)
    //    Como fromStoreId === toStoreId (placeholder), libera no mesmo storeId.
    for (const item of t.items) {
      // Release qtdComprometida na loja origem (placeholder)
      const ledger = await prisma.stockLedger.findUnique({
        where: { storeId_productCode: { storeId: t.fromStoreId, productCode: item.productCode } },
      });
      if (ledger && ledger.qtdComprometida > 0) {
        const releaseQty = Math.min(item.quantity, ledger.qtdComprometida);
        await prisma.$transaction([
          prisma.stockLedger.update({
            where: { id: ledger.id },
            data: { qtdComprometida: { decrement: releaseQty }, version: { increment: 1 } },
          }),
          prisma.stockLedgerEntry.create({
            data: {
              ledgerId: ledger.id,
              type: StockLedgerEntryType.RELEASE,
              qty: releaseQty,
              field: "qtdComprometida",
              referenceId: t.id,
              referenceType: "transfer",
              notes: "Cleanup retroativo - libera commit placeholder",
            },
          }),
        ]);
      }

      // Cancel qtdEmTransito na loja destino (markInTransit foi chamado em APPROVED)
      if (hadTransit) {
        const dest = await prisma.stockLedger.findUnique({
          where: { storeId_productCode: { storeId: t.toStoreId, productCode: item.productCode } },
        });
        if (dest && dest.qtdEmTransito > 0) {
          const cancelQty = Math.min(item.quantity, dest.qtdEmTransito);
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
                notes: "Cleanup retroativo - cancela trânsito placeholder",
              },
            }),
          ]);
        }
      }
    }

    console.log(`  [ok]  ${label}`);
    okCount++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  [ERR] ${label}: ${msg}`);
    errors.push({ id: t.id, error: msg });
    errCount++;
  }
}

console.log(`\nResumo: ${okCount} ok, ${errCount} erros (de ${targets.length})`);
if (errors.length) console.log("Erros:", errors);

await prisma.$disconnect();
