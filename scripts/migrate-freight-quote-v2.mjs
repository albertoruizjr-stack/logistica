// scripts/migrate-freight-quote-v2.mjs
// Adiciona FreightQuoteStatus enum e campos v2 em freight_quotes.
// Executar: node scripts/migrate-freight-quote-v2.mjs

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

const { Client } = pg;

const STATEMENTS = [
  // 1. Criar enum FreightQuoteStatus (idempotente)
  `DO $$ BEGIN
     CREATE TYPE "FreightQuoteStatus" AS ENUM ('DRAFT','QUOTED','CONVERTED','EXPIRED','CANCELLED');
   EXCEPTION WHEN duplicate_object THEN null;
   END $$`,

  // 2. Colunas v2 em freight_quotes
  `ALTER TABLE freight_quotes ADD COLUMN IF NOT EXISTS status "FreightQuoteStatus" NOT NULL DEFAULT 'QUOTED'`,
  `ALTER TABLE freight_quotes ADD COLUMN IF NOT EXISTS "deliveryOption" TEXT`,
  `ALTER TABLE freight_quotes ADD COLUMN IF NOT EXISTS "slaType" "SLAType"`,
  `ALTER TABLE freight_quotes ADD COLUMN IF NOT EXISTS "dispatchWindow" "DispatchWindow"`,
  `ALTER TABLE freight_quotes ADD COLUMN IF NOT EXISTS city TEXT`,
  `ALTER TABLE freight_quotes ADD COLUMN IF NOT EXISTS state TEXT`,
  `ALTER TABLE freight_quotes ADD COLUMN IF NOT EXISTS "quotedAddress" TEXT`,
  `ALTER TABLE freight_quotes ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMPTZ`,
  `ALTER TABLE freight_quotes ADD COLUMN IF NOT EXISTS "convertedAt" TIMESTAMPTZ`,
  `ALTER TABLE freight_quotes ADD COLUMN IF NOT EXISTS "scheduledFor" TIMESTAMPTZ`,
  `ALTER TABLE freight_quotes ADD COLUMN IF NOT EXISTS "cutoffException" BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE freight_quotes ADD COLUMN IF NOT EXISTS "cutoffExceptionReason" TEXT`,
  `ALTER TABLE freight_quotes ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()`,
];

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log("Conectado.");

  for (const sql of STATEMENTS) {
    try {
      await client.query(sql);
      console.log("OK:", sql.replace(/\s+/g, " ").slice(0, 90));
    } catch (err) {
      console.error("ERRO:", err.message);
    }
  }

  await client.end();
  console.log("Migração freight_quotes v2 concluída.");
}

run().catch((err) => { console.error(err); process.exit(1); });
