/**
 * Migração: tabela erp_sync_alerts
 *
 * Cria a tabela que armazena alertas gerados pelo ERP Watcher
 * quando o estado do pedido no Citel diverge do snapshot da solicitação.
 *
 * Uso: node scripts/migrate-erp-watcher.mjs
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "erp_sync_alerts" (
    "id"                TEXT        NOT NULL PRIMARY KEY,
    "deliveryRequestId" TEXT        NOT NULL,
    "orderNumber"       TEXT        NOT NULL,
    "storeCode"         TEXT        NOT NULL,
    "alertType"         TEXT        NOT NULL,
    "severity"          TEXT        NOT NULL,
    "oldValue"          TEXT,
    "newValue"          TEXT,
    "isResolved"        BOOLEAN     NOT NULL DEFAULT FALSE,
    "resolvedAt"        TIMESTAMP(3),
    "resolvedById"      TEXT,
    "detectedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "erp_sync_alerts_deliveryRequestId_fkey"
      FOREIGN KEY ("deliveryRequestId")
      REFERENCES "delivery_requests"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "erp_sync_alerts_deliveryRequestId_isResolved_idx"
    ON "erp_sync_alerts"("deliveryRequestId", "isResolved")`,
  `CREATE INDEX IF NOT EXISTS "erp_sync_alerts_orderNumber_isResolved_idx"
    ON "erp_sync_alerts"("orderNumber", "isResolved")`,
  `CREATE INDEX IF NOT EXISTS "erp_sync_alerts_isResolved_detectedAt_idx"
    ON "erp_sync_alerts"("isResolved", "detectedAt")`,
];

async function main() {
  console.log("Iniciando migração erp_watcher...\n");
  for (const sql of STATEMENTS) {
    const preview = sql.replace(/\s+/g, " ").slice(0, 70);
    process.stdout.write(`  ${preview}... `);
    await prisma.$executeRawUnsafe(sql);
    console.log("✓");
  }
  console.log("\nMigração concluída.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
