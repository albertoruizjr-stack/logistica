// Diagnóstico: estado atual da solicitação PD 5886 e da Transfer dela
import fs from "node:fs";
import path from "node:path";
const envText = fs.readFileSync(path.resolve(".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)="(.*)"$/);
  if (m) process.env[m[1]] = m[2];
}
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

const req = await prisma.deliveryRequest.findFirst({
  where: { orderNumber: "5886" },
  include: {
    items:     { select: { id: true, productCode: true, productName: true, quantity: true, unit: true, availableAtStore: true, grossWeight: true } },
    transfers: { include: { items: { select: { id: true, productCode: true, quantity: true, linkedCitelPD: true, linkedCitelStoreCode: true } } } },
    store:     { select: { code: true } },
    orderStore:{ select: { code: true, codigoEmpresaCitel: true } },
  },
});

if (!req) { console.log("PD 5886 não encontrado no banco"); await prisma.$disconnect(); process.exit(1); }

console.log("\n=== SOLICITAÇÃO ===");
console.log(`id=${req.id}`);
console.log(`status=${req.status}`);
console.log(`orderStore.code=${req.orderStore?.code} · codigoEmpresaCitel=${req.orderStore?.codigoEmpresaCitel}`);
console.log(`storeId=${req.storeId} (loja que pediu)`);

console.log("\n=== ITEMS (delivery_items) ===");
for (const it of req.items) {
  console.log(`  ${it.productCode} | ${it.productName.slice(0,40)} | qtd=${it.quantity} ${it.unit} | grossW=${it.grossWeight} | availStore=${it.availableAtStore}`);
}

console.log("\n=== TRANSFERS ===");
if (req.transfers.length === 0) {
  console.log("  ❌ Nenhuma Transfer associada — por isso não há botão!");
} else {
  for (const t of req.transfers) {
    console.log(`  Transfer ${t.id} · status=${t.status} · ${t.items.length} item(ns)`);
    for (const ti of t.items) {
      console.log(`    item ${ti.productCode} qtd=${ti.quantity} → linked=${ti.linkedCitelPD ?? "—"} loja=${ti.linkedCitelStoreCode ?? "—"}`);
    }
  }
}

await prisma.$disconnect();
