-- ──────────────────────────────────────────────
-- Correção emergencial 2026-05-12
-- Adiciona colunas que o schema.prisma declara mas o banco não tinha.
-- Idempotente (IF NOT EXISTS), sem DROPs — preserva snake_case legado.
-- ──────────────────────────────────────────────

ALTER TABLE "delivery_requests"
  ADD COLUMN IF NOT EXISTS "customerAddressSnapshot"  TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryAddressSnapshot"  TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryAddressSource"    TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryAddressOriginal"  TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryAddressEditedById" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryAddressEditedAt"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "erpOrderStatus"           TEXT,
  ADD COLUMN IF NOT EXISTS "erpOrderValidationStatus" TEXT;
