// Identifica solicitações órfãs (AWAITING_TRANSFER sem Transfer ativa)
// e cria notificação retroativa para Jhow + Jane.

import fs from "node:fs";
import path from "node:path";

const envText = fs.readFileSync(path.resolve(".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)="(.*)"$/);
  if (m) process.env[m[1]] = m[2];
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

// 1. Acha solicitações em AWAITING_TRANSFER sem Transfer ativa
const orphans = await prisma.deliveryRequest.findMany({
  where: {
    status: "AWAITING_TRANSFER",
    transfers: { none: { status: { notIn: ["CANCELLED", "RECEIVED"] } } },
  },
  include: {
    items:      { select: { id: true, productCode: true, productName: true, availableAtStore: true } },
    orderStore: { select: { code: true } },
  },
  orderBy: { createdAt: "desc" },
  take: 50,
});

console.log(`\n${orphans.length} solicitação(ões) órfã(s) encontradas:\n`);

if (orphans.length === 0) {
  await prisma.$disconnect();
  process.exit(0);
}

// 2. Lista quem é Jhow + Jane
const recipients = await prisma.user.findMany({
  where: {
    role: { in: ["STOCK_OPERATOR", "LOGISTICS_OPERATOR", "OPERATOR"] },
    active: true,
  },
  select: { id: true, name: true, role: true },
});

console.log(`Destinatários ativos: ${recipients.map(r => `${r.name} (${r.role})`).join(", ")}\n`);

// 3. Cria notificação retroativa para cada solicitação órfã
let created = 0;
for (const r of orphans) {
  const missing = r.items.filter(i => !i.availableAtStore);
  const label = r.orderNumber
    ? `PD ${r.orderNumber}${r.orderStore?.code ? ` · Loja ${r.orderStore.code}` : ""}`
    : `Solicitação #${r.id.slice(-6)}`;
  console.log(`  ${label} — ${missing.length} item(ns) faltando (${r.createdAt.toISOString().slice(0,16)})`);

  // Verifica se já não tem notificação para essa solicitação (evita duplicar)
  const existing = await prisma.notification.findFirst({
    where: {
      type: "TRANSFER_CREATED",
      metadata: { contains: r.id },
    },
    select: { id: true },
  });
  if (existing) {
    console.log(`    skip · notificação já existe`);
    continue;
  }

  await prisma.notification.createMany({
    data: recipients.map(u => ({
      userId:   u.id,
      type:     "TRANSFER_CREATED",
      title:    "Solicitação aguardando transferência",
      body:     `${label} · ${missing.length} ${missing.length === 1 ? "item" : "itens"} a transferir`,
      link:     `/solicitacoes?detail=${r.id}`,
      metadata: JSON.stringify({ deliveryRequestId: r.id, retroactive: true }),
    })),
  });
  created += recipients.length;
  console.log(`    ✓ ${recipients.length} notificação(ões) criada(s)`);
}

console.log(`\n${created} notificações criadas no total.`);
await prisma.$disconnect();
