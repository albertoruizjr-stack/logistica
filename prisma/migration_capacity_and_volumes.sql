-- ─────────────────────────────────────────────────────────────────────────
-- Migration: capacidade individual de motorista + breakdown de volumes
--
-- MOTIVOS:
-- 1. Driver.maxLoadKg: até hoje a capacidade vinha só do VEHICLE_CAPACITY
--    por tipo (FIORINO=500kg, etc). Com Douglas/Fabio (Fiorinos 750kg) e
--    Sandro (Caminhão 1650kg), precisamos override por motorista.
-- 2. DeliveryRequest.volumeBreakdown: pra mostrar "3 LA · 2 GL · 1 papelão"
--    em vez de só "5 latas" — UI da roteirização/despacho fica clara.
--
-- Idempotente: pode rodar várias vezes sem efeito colateral.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. Driver.maxLoadKg ──────────────────────────────────────────────
ALTER TABLE "drivers"
  ADD COLUMN IF NOT EXISTS "maxLoadKg" DOUBLE PRECISION;

-- ── 2. DeliveryRequest.volumeBreakdown ───────────────────────────────
ALTER TABLE "delivery_requests"
  ADD COLUMN IF NOT EXISTS "volumeBreakdown" JSONB;

-- ── 3. Backfill capacidades dos motoristas atuais ────────────────────
-- Douglas e Fabio são Fiorinos (750 kg).
-- Sandro é Caminhão (1.650 kg).
-- Match por nome (case-insensitive). Se não existir, não faz nada.
UPDATE "drivers"
SET "maxLoadKg" = 750
WHERE LOWER("name") LIKE 'douglas%'
  AND "maxLoadKg" IS NULL;

UPDATE "drivers"
SET "maxLoadKg" = 750
WHERE LOWER("name") LIKE 'fabio%'
  AND "maxLoadKg" IS NULL;

UPDATE "drivers"
SET "maxLoadKg" = 1650
WHERE LOWER("name") LIKE 'sandro%'
  AND "maxLoadKg" IS NULL;
