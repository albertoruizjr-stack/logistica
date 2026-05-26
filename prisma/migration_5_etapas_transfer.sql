-- ──────────────────────────────────────────────────────────────────────
-- Transferência em 5 etapas — migration consolidada idempotente
-- Spec: docs/superpowers/specs/2026-05-26-transferencia-5-etapas-design.md
-- ──────────────────────────────────────────────────────────────────────

-- 1. enum TransferStatus: adiciona valores novos
DO $$ BEGIN
  ALTER TYPE "TransferStatus" ADD VALUE IF NOT EXISTS 'AWAITING_APPROVAL';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "TransferStatus" ADD VALUE IF NOT EXISTS 'READY_TO_COLLECT';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE "TransferStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. transfers: relaxa fromStoreId, adiciona novos campos
ALTER TABLE transfers ALTER COLUMN "fromStoreId" DROP NOT NULL;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS "originIndicatedAt"   TIMESTAMP(3);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS "originIndicatedById" TEXT;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS "deliveredAt"         TIMESTAMP(3);
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS "deliveredById"       TEXT;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS "deliveryPhotoUrl"    TEXT;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS "deliveryPhotoPath"   TEXT;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS "recipientName"       TEXT;

-- 3. transfer_items: TE/NF por item + rastreio de coleta
ALTER TABLE transfer_items ADD COLUMN IF NOT EXISTS "teNumber"         TEXT;
ALTER TABLE transfer_items ADD COLUMN IF NOT EXISTS "nfCitelNumero"    TEXT;
ALTER TABLE transfer_items ADD COLUMN IF NOT EXISTS "nfCitelEmitidaAt" TIMESTAMP(3);
ALTER TABLE transfer_items ADD COLUMN IF NOT EXISTS "collectedAt"      TIMESTAMP(3);
ALTER TABLE transfer_items ADD COLUMN IF NOT EXISTS "collectConfirmed" BOOLEAN DEFAULT false;

-- 4. FKs novos (ON DELETE SET NULL)
DO $$ BEGIN
  ALTER TABLE transfers ADD CONSTRAINT "transfers_originIndicatedById_fkey"
    FOREIGN KEY ("originIndicatedById") REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE transfers ADD CONSTRAINT "transfers_deliveredById_fkey"
    FOREIGN KEY ("deliveredById") REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5. Índices novos
CREATE INDEX IF NOT EXISTS "transfers_status_toStoreId_idx"   ON transfers(status, "toStoreId");
CREATE INDEX IF NOT EXISTS "transfers_status_fromStoreId_idx" ON transfers(status, "fromStoreId");

-- 6. Migração de dados — copia TE/NF da Transfer para o(s) item(s)
UPDATE transfer_items ti
   SET "teNumber"         = t."teNumber",
       "nfCitelNumero"    = t."nfCitelNumero",
       "nfCitelEmitidaAt" = t."nfCitelEmitidaAt"
  FROM transfers t
 WHERE ti."transferId" = t.id
   AND ti."teNumber" IS NULL AND ti."nfCitelNumero" IS NULL
   AND (t."teNumber" IS NOT NULL OR t."nfCitelNumero" IS NOT NULL);

-- 7. Migração de status em flight (transfers ainda processando)
UPDATE transfers SET status = 'READY_TO_COLLECT'
 WHERE status IN ('APPROVED', 'PREPARING', 'PREPARED');

UPDATE transfers SET status        = 'DELIVERED',
                     "deliveredAt" = COALESCE("deliveredAt", "receivedAt")
 WHERE status = 'RECEIVED';

-- 8. CHECK constraint — defesa em profundidade (rodada DEPOIS da migração de dados)
DO $$ BEGIN
  ALTER TABLE transfers ADD CONSTRAINT transfer_origin_required
    CHECK (status IN ('PENDING','CANCELLED') OR "fromStoreId" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
