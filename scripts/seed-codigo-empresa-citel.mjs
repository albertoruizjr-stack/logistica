// Preenche codigoEmpresaCitel = code para todas as lojas, se estiver null.
// Confirmado pelo retorno da Citel: codigoEmpresa = "067", "131", "132", "173", "191" — mesmo que o code da loja.
import fs from "node:fs";
import path from "node:path";
const envText = fs.readFileSync(path.resolve(".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)="(.*)"$/);
  if (m) process.env[m[1]] = m[2];
}
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const lojas = await prisma.store.findMany({ select: { id: true, code: true, codigoEmpresaCitel: true } });
let updated = 0;
for (const l of lojas) {
  if (l.codigoEmpresaCitel === l.code) continue;
  await prisma.store.update({ where: { id: l.id }, data: { codigoEmpresaCitel: l.code } });
  console.log(`  ✓ loja ${l.code} · codigoEmpresaCitel = "${l.code}"`);
  updated++;
}
console.log(`\n${updated} loja(s) atualizadas.`);
await prisma.$disconnect();
