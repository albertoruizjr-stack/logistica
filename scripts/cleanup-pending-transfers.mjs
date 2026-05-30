// Cleanup: cancela TODAS as transferências pendentes (qualquer status não-terminal).
// Motivo (Alberto, 2026-05-30): o módulo de transferência não está em uso operacional
// ainda; as pendentes são lixo que pode travar a roteirização. Zerar tudo até o
// sistema+operação estarem 100%.
//
// Estratégia: CANCELLED + history + libera ledger seguindo a MATRIZ da função
// cancelTransfer() (services/transferencia.service.ts):
//   - qtdComprometida na origem: liberada se houve commit E não há NF (Citel não assumiu)
//   - qtdEmTransito no destino:  cancelada se a transfer já passou por markInTransit
// Não toca nas DeliveryRequests vinculadas (todas já estão DELIVERED/CANCELLED — verificado
// no diag-old-transfers de 2026-05-30: 25/25 ligadas a DR DELIVERED).
// Idempotente: usa Math.min contra o saldo atual, então rodar 2x não gera saldo negativo.
//
// Uso:
//   node scripts/cleanup-pending-transfers.mjs           # dry-run (não escreve)
//   node scripts/cleanup-pending-transfers.mjs --execute # aplica
import fs from "node:fs";
import path from "node:path";

const envText = fs.readFileSync(path.resolve(".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)="(.*)"$/);
  if (m) process.env[m[1]] = m[2];
}

const EXECUTE = process.argv.includes("--execute");
const { PrismaClient, TransferStatus, StockLedgerEntryType } = await import("@prisma/client");
const prisma = new PrismaClient();

// Status não-terminais (tudo que NÃO é DELIVERED/CANCELLED/RECEIVED-legado).
const NON_TERMINAL = [
  TransferStatus.PENDING,
  TransferStatus.AWAITING_APPROVAL,
  TransferStatus.READY_TO_COLLECT,
  TransferStatus.IN_TRANSIT,
  TransferStatus.APPROVED,   // legado
  TransferStatus.PREPARING,  // legado
  TransferStatus.PREPARED,   // legado
];

// Status que já passaram por commitStock na origem (qtdComprometida).
const HAD_COMMIT = new Set([
  TransferStatus.AWAITING_APPROVAL,
  TransferStatus.READY_TO_COLLECT,
  TransferStatus.IN_TRANSIT,
  TransferStatus.APPROVED,
  TransferStatus.PREPARING,
  TransferStatus.PREPARED,
]);

// Status que já passaram por markInTransit no destino (qtdEmTransito).
const HAD_TRANSIT = new Set([
  TransferStatus.READY_TO_COLLECT,
  TransferStatus.IN_TRANSIT,
  TransferStatus.APPROVED,
  TransferStatus.PREPARING,
  TransferStatus.PREPARED,
]);

console.log(`\n${EXECUTE ? "🔴 EXECUTANDO (escreve no banco)" : "🟡 DRY-RUN (não escreve nada)"}\n`);

const targets = await prisma.transfer.findMany({
  where: { status: { in: NON_TERMINAL } },
  include: {
    fromStore: { select: { code: true } },
    toStore: { select: { code: true } },
    items: { select: { id: true, productCode: true, productName: true, quantity: true, nfCitelNumero: true } },
    deliveryRequest: { select: { orderNumber: true, status: true } },
  },
  orderBy: { requestedAt: "asc" },
});

console.log(`Transferências não-terminais encontradas: ${targets.length}\n`);
if (targets.length === 0) {
  await prisma.$disconnect();
  process.exit(0);
}

// SEGURANÇA (Leva 1, Alberto 2026-05-30): só mexemos em transfers SEGURAS —
// sem DR vinculada OU com DR já terminal (DELIVERED/CANCELLED). Transfers
// ligadas a DR ATIVA ficam de fora (Leva 2, investigação caso a caso) pra não
// travar nenhuma entrega de cliente em andamento.
const isSafe = (t) =>
  !t.deliveryRequest || ["DELIVERED", "CANCELLED"].includes(t.deliveryRequest.status);

const skipped = targets.filter((t) => !isSafe(t));
if (skipped.length > 0) {
  console.log(`⏭️  PROTEGIDAS (DR ativa — NÃO serão tocadas): ${skipped.length}`);
  for (const t of skipped) {
    console.log(`     ${t.id.slice(-8)} → DR ${t.deliveryRequest.orderNumber} = ${t.deliveryRequest.status}`);
  }
  console.log("");
}

// A partir daqui só processamos as seguras.
const safeTargets = targets.filter(isSafe);
console.log(`✅ Seguras a cancelar (Leva 1): ${safeTargets.length}\n`);

let okCount = 0, errCount = 0, releaseTotal = 0, transitTotal = 0;
const errors = [];

for (const t of safeTargets) {
  const ageH = t.requestedAt ? Math.round((Date.now() - t.requestedAt.getTime()) / 3.6e6) : "?";
  const anyNf = t.items.some((i) => i.nfCitelNumero);
  const willRelease = HAD_COMMIT.has(t.status) && !anyNf && !!t.fromStoreId;
  const willCancelTransit = HAD_TRANSIT.has(t.status);
  const drInfo = t.deliveryRequest ? `DR ${t.deliveryRequest.orderNumber}=${t.deliveryRequest.status}` : "sem DR";
  const label = `${t.id.slice(-8)} | ${t.fromStore?.code ?? "∅"}→${t.toStore.code} | ${t.status} | ${ageH}h | ${t.items.length}it | ${anyNf ? "NF" : "s/NF"} | ${drInfo}`;
  const effects = [
    willRelease ? "release qtdComprometida(origem)" : null,
    willCancelTransit ? "cancel qtdEmTransito(destino)" : null,
  ].filter(Boolean).join(" + ") || "só CANCELLED (sem efeito ledger)";

  if (!EXECUTE) {
    console.log(`  [dry] ${label}`);
    console.log(`        → ${effects}`);
    continue;
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.transfer.update({
        where: { id: t.id },
        data: { status: TransferStatus.CANCELLED, cancelledAt: new Date() },
      });
      await tx.transferHistory.create({
        data: {
          transferId: t.id,
          fromStatus: t.status,
          toStatus: TransferStatus.CANCELLED,
          notes: "Cleanup 2026-05-30: módulo de transferência fora de uso — zerando pendentes",
        },
      });
    });

    // Libera ledger fora da tx principal (cada call é sua própria $transaction)
    for (const item of t.items) {
      if (willRelease) {
        const src = await prisma.stockLedger.findUnique({
          where: { storeId_productCode: { storeId: t.fromStoreId, productCode: item.productCode } },
        });
        if (src && src.qtdComprometida > 0) {
          const qty = Math.min(item.quantity, src.qtdComprometida);
          await prisma.$transaction([
            prisma.stockLedger.update({ where: { id: src.id }, data: { qtdComprometida: { decrement: qty }, version: { increment: 1 } } }),
            prisma.stockLedgerEntry.create({ data: { ledgerId: src.id, type: StockLedgerEntryType.RELEASE, qty, field: "qtdComprometida", referenceId: t.id, referenceType: "transfer", notes: "Cleanup 2026-05-30 — libera commit pendente" } }),
          ]);
          releaseTotal += qty;
        }
      }
      if (willCancelTransit) {
        const dest = await prisma.stockLedger.findUnique({
          where: { storeId_productCode: { storeId: t.toStoreId, productCode: item.productCode } },
        });
        if (dest && dest.qtdEmTransito > 0) {
          const qty = Math.min(item.quantity, dest.qtdEmTransito);
          await prisma.$transaction([
            prisma.stockLedger.update({ where: { id: dest.id }, data: { qtdEmTransito: { decrement: qty }, version: { increment: 1 } } }),
            prisma.stockLedgerEntry.create({ data: { ledgerId: dest.id, type: StockLedgerEntryType.TRANSIT_CANCEL, qty, field: "qtdEmTransito", referenceId: t.id, referenceType: "transfer", notes: "Cleanup 2026-05-30 — cancela trânsito pendente" } }),
          ]);
          transitTotal += qty;
        }
      }
    }

    console.log(`  [ok]  ${label} → ${effects}`);
    okCount++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  [ERR] ${label}: ${msg}`);
    errors.push({ id: t.id, error: msg });
    errCount++;
  }
}

if (EXECUTE) {
  console.log(`\nResumo: ${okCount} canceladas, ${errCount} erros (de ${safeTargets.length} seguras)`);
  console.log(`Protegidas (DR ativa, intactas): ${skipped.length}`);
  console.log(`Ledger liberado: ${releaseTotal} un qtdComprometida + ${transitTotal} un qtdEmTransito`);
  if (errors.length) console.log("Erros:", errors);
} else {
  const rel = safeTargets.filter((t) => HAD_COMMIT.has(t.status) && !t.items.some((i) => i.nfCitelNumero) && t.fromStoreId).length;
  const tra = safeTargets.filter((t) => HAD_TRANSIT.has(t.status)).length;
  console.log(`\n[dry-run] ${safeTargets.length} seguras seriam canceladas (${skipped.length} protegidas ficam intactas).`);
  console.log(`[dry-run] ${rel} liberariam qtdComprometida; ${tra} cancelariam qtdEmTransito.`);
  console.log(`[dry-run] Rode com --execute para aplicar.`);
}

await prisma.$disconnect();
