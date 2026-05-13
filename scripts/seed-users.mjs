// Cria os usuários combinados com o Alberto.
// Senha = local-part do email + "123" (ex: "thiago" → "thiago123")
// Hash compatível com lib/auth.ts (SHA-256 hex).
// Loja default: 132. Pula usuários que já existem.

import fs from "node:fs";
import path from "node:path";
import { webcrypto as crypto } from "node:crypto";

// carrega .env.local
const envText = fs.readFileSync(path.resolve(".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)="(.*)"$/);
  if (m) process.env[m[1]] = m[2];
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

async function sha256(s) {
  const data = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

const DEFAULT_STORE_CODE = "132";

const VENDEDORES = [
  "thiago", "fabio", "lucasleonardo", "ryan", "eduardo", "jacques",
  "renato", "rafael", "luan", "josiel", "christian", "edielson",
  "cintia", "jhonatan", "alessandro", "samuel", "lucas", "leoni",
];

function emailLocalToName(local) {
  // capitaliza primeira letra
  return local.charAt(0).toUpperCase() + local.slice(1);
}

const users = [
  { email: "jhow@mestredapintura.com.br",     name: "Jhonatas",           role: "STOCK_OPERATOR" },
  { email: "jane@mestredapintura.com.br",     name: "Jane",               role: "LOGISTICS_OPERATOR" },
  { email: "fernanda@mestredapintura.com.br", name: "Fernanda",           role: "BUYER" },
  ...VENDEDORES.map(local => ({
    email: `${local}@mestredapintura.com.br`,
    name:  emailLocalToName(local),
    role:  "SELLER",
  })),
];

const store = await prisma.store.findFirst({
  where: { code: DEFAULT_STORE_CODE },
  select: { id: true, code: true, name: true },
});
if (!store) {
  console.error(`❌ Loja ${DEFAULT_STORE_CODE} não encontrada no banco`);
  await prisma.$disconnect();
  process.exit(1);
}
console.log(`Loja default: ${store.code} · ${store.name} (${store.id})\n`);

let created = 0, skipped = 0;

for (const u of users) {
  const existing = await prisma.user.findUnique({ where: { email: u.email }, select: { id: true, role: true } });
  if (existing) {
    console.log(`  skip · ${u.email.padEnd(45)} (já existe como ${existing.role})`);
    skipped++;
    continue;
  }
  const local = u.email.split("@")[0];
  const password = await sha256(`${local}123`);
  await prisma.user.create({
    data: {
      email:    u.email,
      name:     u.name,
      password,
      role:     u.role,
      storeId:  store.id,
      active:   true,
    },
  });
  console.log(`  ✓   ${u.email.padEnd(45)} · ${u.role}`);
  created++;
}

console.log(`\n${created} criado(s) · ${skipped} pulado(s) (já existiam)`);
await prisma.$disconnect();
