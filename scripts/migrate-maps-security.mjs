// scripts/migrate-maps-security.mjs
// Adiciona campos de restrição geográfica SP na tabela delivery_requests.
// Executar manualmente: node scripts/migrate-maps-security.mjs

import pg from "pg";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Carrega .env manualmente (sem depender do pacote dotenv)
try {
  const dir = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(dir, "../.env.local");
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch { /* .env.local ausente — usa vars de ambiente do sistema */ }

const { Client } = pg;

// Prisma usa camelCase como nome de coluna (sem @map individual).
// PostgreSQL requer aspas duplas para identificadores case-sensitive.
const STATEMENTS = [
  `ALTER TABLE delivery_requests
     ADD COLUMN IF NOT EXISTS "deliveryState"          VARCHAR(2)`,
  `ALTER TABLE delivery_requests
     ADD COLUMN IF NOT EXISTS "outsideSPApproved"       BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE delivery_requests
     ADD COLUMN IF NOT EXISTS "outsideSPApprovedBy"     TEXT`,
  `ALTER TABLE delivery_requests
     ADD COLUMN IF NOT EXISTS "outsideSPApprovalReason" TEXT`,
  `ALTER TABLE delivery_requests
     ADD COLUMN IF NOT EXISTS "outsideSPApprovedAt"     TIMESTAMPTZ`,
];

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log("Conectado ao banco.");

  for (const sql of STATEMENTS) {
    try {
      await client.query(sql);
      console.log("OK:", sql.slice(0, 80).replace(/\s+/g, " "));
    } catch (err) {
      console.error("ERRO:", err.message, "\nSQL:", sql.slice(0, 120));
    }
  }

  await client.end();
  console.log("Migração concluída.");
}

run().catch((err) => {
  console.error("Falha fatal:", err);
  process.exit(1);
});
