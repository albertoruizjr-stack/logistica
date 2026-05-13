-- ══════════════════════════════════════════════════════════════
-- Migration: operacao_real_logistica
-- Sistema Logístico — Mestre da Pintura
-- Execute no Supabase SQL Editor (é idempotente — seguro rodar mais de uma vez)
-- ══════════════════════════════════════════════════════════════

-- ── 1. Novos valores no enum DeliveryRequestStatus ───────────
ALTER TYPE "DeliveryRequestStatus" ADD VALUE IF NOT EXISTS 'SEPARADO';
ALTER TYPE "DeliveryRequestStatus" ADD VALUE IF NOT EXISTS 'AGUARDANDO_NF';
ALTER TYPE "DeliveryRequestStatus" ADD VALUE IF NOT EXISTS 'NF_EMITIDA';
ALTER TYPE "DeliveryRequestStatus" ADD VALUE IF NOT EXISTS 'NF_VINCULADA';
ALTER TYPE "DeliveryRequestStatus" ADD VALUE IF NOT EXISTS 'PRONTO_ROTEIRIZACAO';
ALTER TYPE "DeliveryRequestStatus" ADD VALUE IF NOT EXISTS 'ROTEIRIZADO';
ALTER TYPE "DeliveryRequestStatus" ADD VALUE IF NOT EXISTS 'OCORRENCIA';
ALTER TYPE "DeliveryRequestStatus" ADD VALUE IF NOT EXISTS 'READY';

-- ── 2. Novo enum DispatchWindow ───────────────────────────────
DO $$ BEGIN
  CREATE TYPE "DispatchWindow" AS ENUM ('FIRST_DISPATCH', 'SECOND_DISPATCH', 'NEXT_DAY', 'EXPRESS');
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- ── 3. Novo enum SLAType ──────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "SLAType" AS ENUM ('STANDARD', 'URGENT', 'EXPRESS', 'SCHEDULED');
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- ── 4. Novo campo na tabela stores ────────────────────────────
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS "codigoEmpresaCitel" TEXT;

-- ── 5. Novos campos em delivery_requests ─────────────────────
ALTER TABLE delivery_requests
  ADD COLUMN IF NOT EXISTS "dispatchWindow"        "DispatchWindow",
  ADD COLUMN IF NOT EXISTS "cutoffWarningShownAt"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cutoffApprovedBy"      TEXT,
  ADD COLUMN IF NOT EXISTS "cutoffApprovalReason"  TEXT,
  ADD COLUMN IF NOT EXISTS "separatedBy"           TEXT,
  ADD COLUMN IF NOT EXISTS "separatedAt"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "occurrenceType"        TEXT,
  ADD COLUMN IF NOT EXISTS "occurrenceNotes"       TEXT,
  ADD COLUMN IF NOT EXISTS "slaType"               "SLAType" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN IF NOT EXISTS "sameDayRequested"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sameDayApprovedBy"     TEXT,
  ADD COLUMN IF NOT EXISTS "sameDayApprovalReason" TEXT,
  ADD COLUMN IF NOT EXISTS "sameDayRequestedAt"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "nfLinkLastAttemptAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "nfLinkAttemptCount"    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "nfLinkError"           TEXT,
  ADD COLUMN IF NOT EXISTS "lockedBy"              TEXT,
  ADD COLUMN IF NOT EXISTS "lockedByName"          TEXT,
  ADD COLUMN IF NOT EXISTS "lockedAt"              TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lockExpiresAt"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lockReason"            TEXT;

-- ── 6. Tabela delivery_status_history ────────────────────────
CREATE TABLE IF NOT EXISTS "delivery_status_history" (
  "id"                TEXT NOT NULL,
  "deliveryRequestId" TEXT NOT NULL,
  "fromStatus"        "DeliveryRequestStatus",
  "toStatus"          "DeliveryRequestStatus" NOT NULL,
  "changedById"       TEXT,
  "reason"            TEXT,
  "metadata"          JSONB,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_status_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "delivery_status_history_deliveryRequestId_createdAt_idx"
  ON "delivery_status_history" ("deliveryRequestId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "delivery_status_history"
    ADD CONSTRAINT "delivery_status_history_deliveryRequestId_fkey"
    FOREIGN KEY ("deliveryRequestId") REFERENCES "delivery_requests"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- ── 7. Tabela operational_metrics_snapshots ───────────────────
CREATE TABLE IF NOT EXISTS "operational_metrics_snapshots" (
  "id"                TEXT NOT NULL,
  "deliveryRequestId" TEXT NOT NULL,
  "status"            "DeliveryRequestStatus" NOT NULL,
  "enteredAt"         TIMESTAMP(3) NOT NULL,
  "exitedAt"          TIMESTAMP(3),
  "durationSeconds"   INTEGER,
  "operatorId"        TEXT,
  "operatorName"      TEXT,
  "storeId"           TEXT NOT NULL,
  "slaType"           "SLAType" NOT NULL,
  "deliveryType"      "DeliveryType" NOT NULL,
  "dispatchWindow"    "DispatchWindow",
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operational_metrics_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "operational_metrics_snapshots_deliveryRequestId_enteredAt_idx"
  ON "operational_metrics_snapshots" ("deliveryRequestId", "enteredAt");

CREATE INDEX IF NOT EXISTS "operational_metrics_snapshots_status_enteredAt_idx"
  ON "operational_metrics_snapshots" ("status", "enteredAt");

CREATE INDEX IF NOT EXISTS "operational_metrics_snapshots_storeId_enteredAt_idx"
  ON "operational_metrics_snapshots" ("storeId", "enteredAt");

CREATE INDEX IF NOT EXISTS "operational_metrics_snapshots_operatorId_enteredAt_idx"
  ON "operational_metrics_snapshots" ("operatorId", "enteredAt");

CREATE INDEX IF NOT EXISTS "operational_metrics_snapshots_exitedAt_idx"
  ON "operational_metrics_snapshots" ("exitedAt");

DO $$ BEGIN
  ALTER TABLE "operational_metrics_snapshots"
    ADD CONSTRAINT "operational_metrics_snapshots_deliveryRequestId_fkey"
    FOREIGN KEY ("deliveryRequestId") REFERENCES "delivery_requests"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════
-- FASE 1 — RoutingWave + Route/Driver upgrades (integração Spoke)
-- ══════════════════════════════════════════════════════════════

-- ── 8. Enum RoutingWaveStatus ────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "RoutingWaveStatus" AS ENUM (
    'DRAFT', 'SENT', 'OPTIMIZED', 'DISTRIBUTED', 'DISPATCHED', 'COMPLETED', 'FAILED'
  );
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- ── 9. Novos campos em drivers ────────────────────────────────
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS "email"         TEXT,
  ADD COLUMN IF NOT EXISTS "spokeDriverId" TEXT,
  ADD COLUMN IF NOT EXISTS "available"     BOOLEAN NOT NULL DEFAULT true;

DO $$ BEGIN
  ALTER TABLE drivers
    ADD CONSTRAINT "drivers_spokeDriverId_key" UNIQUE ("spokeDriverId");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- ── 10. Novos campos em routes ────────────────────────────────
ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS "name"              TEXT,
  ADD COLUMN IF NOT EXISTS "spokeRouteId"      TEXT,
  ADD COLUMN IF NOT EXISTS "waveId"            TEXT,
  ADD COLUMN IF NOT EXISTS "manifestJson"      JSONB,
  ADD COLUMN IF NOT EXISTS "sequenceJson"      JSONB,
  ADD COLUMN IF NOT EXISTS "estimatedReturnAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "totalWeightKg"     DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "stopCount"         INTEGER;

DO $$ BEGIN
  ALTER TABLE routes
    ADD CONSTRAINT "routes_spokeRouteId_key" UNIQUE ("spokeRouteId");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- ── 11. Tabela routing_waves ──────────────────────────────────
CREATE TABLE IF NOT EXISTS "routing_waves" (
  "id"            TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "date"          TIMESTAMP(3) NOT NULL,
  "status"        "RoutingWaveStatus" NOT NULL DEFAULT 'DRAFT',
  "spokePlanId"   TEXT,
  "notes"         TEXT,
  "errorMessage"  TEXT,
  "createdById"   TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt"        TIMESTAMP(3),
  "optimizedAt"   TIMESTAMP(3),
  "distributedAt" TIMESTAMP(3),
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "routing_waves_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "routing_waves"
    ADD CONSTRAINT "routing_waves_spokePlanId_key" UNIQUE ("spokePlanId");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "routing_waves_date_status_idx"
  ON "routing_waves" ("date", "status");

DO $$ BEGIN
  ALTER TABLE "routing_waves"
    ADD CONSTRAINT "routing_waves_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- ── 12. FK routes.waveId → routing_waves.id ──────────────────
DO $$ BEGIN
  ALTER TABLE routes
    ADD CONSTRAINT "routes_waveId_fkey"
    FOREIGN KEY ("waveId") REFERENCES "routing_waves"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════
-- FASE 4.1 — Novo status PREPARED + campo preparedAt em Transfer
-- ══════════════════════════════════════════════════════════════

-- ── 13. Novo valor no enum TransferStatus ────────────────────
ALTER TYPE "TransferStatus" ADD VALUE IF NOT EXISTS 'PREPARED';

-- ── 14. Novo campo em transfers ──────────────────────────────
ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS "preparedAt" TIMESTAMP(3);

-- ── 15. Campo metadata em routing_waves (estado intermediário do pipeline)
ALTER TABLE routing_waves
  ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- ══════════════════════════════════════════════════════════════
-- APP MOTORISTA — Auth de driver + comprovantes de entrega
-- ══════════════════════════════════════════════════════════════

-- ── 16. drivers.userId (link com User pra login)
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS "userId" TEXT;

DO $$ BEGIN
  ALTER TABLE drivers
    ADD CONSTRAINT "drivers_userId_key" UNIQUE ("userId");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE drivers
    ADD CONSTRAINT "drivers_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- ── 17. Enum DeliveryProofType
DO $$ BEGIN
  CREATE TYPE "DeliveryProofType" AS ENUM ('RECEIPT', 'MATERIAL', 'OCCURRENCE');
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- ── 18. Tabela delivery_proofs
CREATE TABLE IF NOT EXISTS "delivery_proofs" (
  "id"                TEXT NOT NULL,
  "deliveryRequestId" TEXT NOT NULL,
  "type"              "DeliveryProofType" NOT NULL,
  "photoUrl"          TEXT NOT NULL,
  "photoPath"         TEXT NOT NULL,
  "uploadedById"      TEXT,
  "notes"             TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_proofs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "delivery_proofs_deliveryRequestId_createdAt_idx"
  ON "delivery_proofs" ("deliveryRequestId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "delivery_proofs"
    ADD CONSTRAINT "delivery_proofs_deliveryRequestId_fkey"
    FOREIGN KEY ("deliveryRequestId") REFERENCES "delivery_requests"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "delivery_proofs"
    ADD CONSTRAINT "delivery_proofs_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
