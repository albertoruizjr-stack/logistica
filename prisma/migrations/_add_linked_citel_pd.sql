-- ─────────────────────────────────────────────────────────────
-- 2026-05-12 — vínculo de TransferItem com PD interno do Autcom
-- Cliente "ATUAL COMERCIO DE TINTAS E MAT PARA PINTURA LTDA"
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "transfer_items"
  ADD COLUMN IF NOT EXISTS "linkedCitelPD"       TEXT,
  ADD COLUMN IF NOT EXISTS "linkedCitelStoreCode" TEXT,
  ADD COLUMN IF NOT EXISTS "linkedAt"            TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "linkedById"          TEXT;

CREATE INDEX IF NOT EXISTS transfer_items_linked_idx ON "transfer_items" ("linkedCitelPD");
