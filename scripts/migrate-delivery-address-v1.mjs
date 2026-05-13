/**
 * Migração: campos de endereço e status ERP na tabela delivery_requests
 *
 * Adiciona (sem quebrar registros existentes — todos nullable):
 *   customerAddressSnapshot  TEXT
 *   deliveryAddressSnapshot  TEXT
 *   deliveryAddressSource    TEXT
 *   deliveryAddressOriginal  TEXT
 *   deliveryAddressEditedById TEXT
 *   deliveryAddressEditedAt  TIMESTAMP(3)
 *   erpOrderStatus           TEXT
 *   erpOrderValidationStatus TEXT
 *
 * Uso: node scripts/migrate-delivery-address-v1.mjs
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const STATEMENTS = [
  `ALTER TABLE delivery_requests ADD COLUMN IF NOT EXISTS "customerAddressSnapshot"   TEXT`,
  `ALTER TABLE delivery_requests ADD COLUMN IF NOT EXISTS "deliveryAddressSnapshot"   TEXT`,
  `ALTER TABLE delivery_requests ADD COLUMN IF NOT EXISTS "deliveryAddressSource"     TEXT`,
  `ALTER TABLE delivery_requests ADD COLUMN IF NOT EXISTS "deliveryAddressOriginal"   TEXT`,
  `ALTER TABLE delivery_requests ADD COLUMN IF NOT EXISTS "deliveryAddressEditedById" TEXT`,
  `ALTER TABLE delivery_requests ADD COLUMN IF NOT EXISTS "deliveryAddressEditedAt"   TIMESTAMP(3)`,
  `ALTER TABLE delivery_requests ADD COLUMN IF NOT EXISTS "erpOrderStatus"            TEXT`,
  `ALTER TABLE delivery_requests ADD COLUMN IF NOT EXISTS "erpOrderValidationStatus"  TEXT`,
];

async function main() {
  console.log("Iniciando migração delivery_address_v1...\n");
  for (const sql of STATEMENTS) {
    process.stdout.write(`  ${sql.slice(0, 70)}... `);
    await prisma.$executeRawUnsafe(sql);
    console.log("✓");
  }
  console.log("\nMigração concluída.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
