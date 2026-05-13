// scripts/migrate-dispatch-eta.mjs
// Adiciona predicted_delivery_at na tabela dispatches.

import pg from "pg";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

try {
  const dir = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(dir, "../.env.local");
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch { /* usa vars de ambiente do sistema */ }

// Prisma usa camelCase como nome de coluna — aspas duplas para case-sensitive
const STATEMENTS = [
  `ALTER TABLE dispatches
     ADD COLUMN IF NOT EXISTS "predictedDeliveryAt" TIMESTAMPTZ`,
];

const { Client } = pg;

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log("Conectado.");

  for (const sql of STATEMENTS) {
    try {
      await client.query(sql);
      console.log("OK:", sql.slice(0, 80).replace(/\s+/g, " "));
    } catch (err) {
      console.error("ERRO:", err.message);
    }
  }

  await client.end();
  console.log("Migração concluída.");
}

run().catch((err) => { console.error(err); process.exit(1); });
