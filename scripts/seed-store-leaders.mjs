// Migra os 5 vendedores líderes pra STORE_LEADER e ajusta o storeId pra loja deles
import fs from "node:fs";
import path from "node:path";
const envText = fs.readFileSync(path.resolve(".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)="(.*)"$/);
  if (m) process.env[m[1]] = m[2];
}
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

const LEADERS = [
  { email: "renato@mestredapintura.com.br",   storeCode: "067" },
  { email: "cintia@mestredapintura.com.br",   storeCode: "131" },
  { email: "thiago@mestredapintura.com.br",   storeCode: "132" },
  { email: "luan@mestredapintura.com.br",     storeCode: "173" },
  { email: "lucas@mestredapintura.com.br",    storeCode: "191" },
];

let updated = 0;
for (const l of LEADERS) {
  const store = await prisma.store.findFirst({ where: { code: l.storeCode }, select: { id: true } });
  if (!store) { console.log(`  ⚠ loja ${l.storeCode} não encontrada`); continue; }

  const user = await prisma.user.findUnique({ where: { email: l.email }, select: { id: true, name: true, role: true, storeId: true } });
  if (!user) { console.log(`  ⚠ user ${l.email} não encontrado`); continue; }

  if (user.role === "STORE_LEADER" && user.storeId === store.id) {
    console.log(`  - ${user.name.padEnd(12)} já é STORE_LEADER da loja ${l.storeCode}`);
    continue;
  }

  await prisma.user.update({
    where: { id: user.id },
    data:  { role: "STORE_LEADER", storeId: store.id },
  });
  console.log(`  ✓ ${user.name.padEnd(12)} (${l.email}) → STORE_LEADER · Loja ${l.storeCode}`);
  updated++;
}
console.log(`\n${updated} líderes atualizados.`);
await prisma.$disconnect();
