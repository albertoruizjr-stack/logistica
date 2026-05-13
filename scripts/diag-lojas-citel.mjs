// Lista todas as lojas e o status do codigoEmpresaCitel
import fs from "node:fs";
import path from "node:path";
const envText = fs.readFileSync(path.resolve(".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)="(.*)"$/);
  if (m) process.env[m[1]] = m[2];
}
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const lojas = await prisma.store.findMany({
  select: { code: true, name: true, codigoEmpresaCitel: true, active: true },
  orderBy: { code: "asc" },
});
console.log("\n CODE | EMPRESA_CITEL | ATIVA | NOME");
console.log("------|---------------|-------|----------------------------");
for (const l of lojas) {
  const cec = l.codigoEmpresaCitel ?? "❌ NULL";
  console.log(`  ${l.code} | ${cec.padEnd(13)} |  ${l.active ? "✓" : "✗"}   | ${l.name}`);
}
await prisma.$disconnect();
