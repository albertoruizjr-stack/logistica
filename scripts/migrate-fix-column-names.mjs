// scripts/migrate-fix-column-names.mjs
// Adiciona colunas com nomes camelCase corretos que o Prisma espera.
// As colunas snake_case adicionadas anteriormente são mantidas (Prisma as ignora).

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

// Prisma usa nomes camelCase como colunas no PostgreSQL (sem @map individual).
// PostgreSQL exige aspas duplas para identificadores case-sensitive.
const STATEMENTS = [
  // ── delivery_requests — bloqueio geográfico SP ────────────────────────────
  `ALTER TABLE delivery_requests
     ADD COLUMN IF NOT EXISTS "deliveryState"           VARCHAR(2)`,
  `ALTER TABLE delivery_requests
     ADD COLUMN IF NOT EXISTS "outsideSPApproved"        BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE delivery_requests
     ADD COLUMN IF NOT EXISTS "outsideSPApprovedBy"      TEXT`,
  `ALTER TABLE delivery_requests
     ADD COLUMN IF NOT EXISTS "outsideSPApprovalReason"  TEXT`,
  `ALTER TABLE delivery_requests
     ADD COLUMN IF NOT EXISTS "outsideSPApprovedAt"      TIMESTAMPTZ`,

  // ── delivery_requests — totais Citel ─────────────────────────────────────
  `ALTER TABLE delivery_requests
     ADD COLUMN IF NOT EXISTS "totalWeightKg"            DOUBLE PRECISION`,
  `ALTER TABLE delivery_requests
     ADD COLUMN IF NOT EXISTS "totalLatas"               INTEGER`,
  `ALTER TABLE delivery_requests
     ADD COLUMN IF NOT EXISTS "hasMissingWeights"        BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE delivery_requests
     ADD COLUMN IF NOT EXISTS "stockValidationStatus"    TEXT`,
  `ALTER TABLE delivery_requests
     ADD COLUMN IF NOT EXISTS "stockFetchedAt"           TIMESTAMPTZ`,

  // ── delivery_items — snapshot Citel ──────────────────────────────────────
  `ALTER TABLE delivery_items
     ADD COLUMN IF NOT EXISTS description               TEXT`,
  `ALTER TABLE delivery_items
     ADD COLUMN IF NOT EXISTS brand                     TEXT`,
  `ALTER TABLE delivery_items
     ADD COLUMN IF NOT EXISTS barcode                   TEXT`,
  `ALTER TABLE delivery_items
     ADD COLUMN IF NOT EXISTS "grossWeight"             DOUBLE PRECISION`,
  `ALTER TABLE delivery_items
     ADD COLUMN IF NOT EXISTS "totalWeight"             DOUBLE PRECISION`,
  `ALTER TABLE delivery_items
     ADD COLUMN IF NOT EXISTS "hasMissingWeight"        BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE delivery_items
     ADD COLUMN IF NOT EXISTS "availableStock"          DOUBLE PRECISION`,
  `ALTER TABLE delivery_items
     ADD COLUMN IF NOT EXISTS "physicalStock"           DOUBLE PRECISION`,
  `ALTER TABLE delivery_items
     ADD COLUMN IF NOT EXISTS "daysWithoutSale"         INTEGER`,
  `ALTER TABLE delivery_items
     ADD COLUMN IF NOT EXISTS "turnoverClass"           TEXT`,
  `ALTER TABLE delivery_items
     ADD COLUMN IF NOT EXISTS "stockStatus"             TEXT`,
  `ALTER TABLE delivery_items
     ADD COLUMN IF NOT EXISTS "fetchedAt"               TIMESTAMPTZ`,

  // ── dispatches — ETA previsto ─────────────────────────────────────────────
  `ALTER TABLE dispatches
     ADD COLUMN IF NOT EXISTS "predictedDeliveryAt"     TIMESTAMPTZ`,
];

const { Client } = pg;

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
  console.log("Migração de nomes concluída.");
}

run().catch((err) => { console.error(err); process.exit(1); });
