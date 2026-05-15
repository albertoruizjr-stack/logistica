-- ══════════════════════════════════════════════════════════════
-- Migration: Fase 1 — Schema + Tabela de Frete + Organograma
-- Sistema Logístico — Mestre da Pintura
-- Idempotente — seguro rodar mais de uma vez.
-- ══════════════════════════════════════════════════════════════

-- ── 1. User.citelUserCode ────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "citelUserCode" TEXT;

DO $$ BEGIN
  ALTER TABLE users
    ADD CONSTRAINT "users_citelUserCode_key" UNIQUE ("citelUserCode");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- ── 2. DeliveryRequest.dispatchStoreId ───────────────────────
ALTER TABLE delivery_requests
  ADD COLUMN IF NOT EXISTS "dispatchStoreId" TEXT;

-- ── 3. FreightZone.expressBasePrice ──────────────────────────
ALTER TABLE freight_zones
  ADD COLUMN IF NOT EXISTS "expressBasePrice" DOUBLE PRECISION;

-- ── 4. Atualizar storeId dos vendedores (mapeando email → loja) ─
-- IDs reais buscados via Prisma. Cada UPDATE é WHERE email='X' AND storeId != 'novoId'
-- (assim é idempotente: só atualiza se está no lugar errado).

-- 067 — Loja Morumbi (cmoisytgf00047ogrdcnxpuic)
UPDATE users SET "storeId" = 'cmoisytgf00047ogrdcnxpuic'
  WHERE email IN ('jacques@mestredapintura.com.br','eduardo@mestredapintura.com.br','rafael@mestredapintura.com.br')
    AND "storeId" <> 'cmoisytgf00047ogrdcnxpuic';

-- 131 — Loja Chácara Sto Antônio (cmoisytge00037ogrbs55se61)
UPDATE users SET "storeId" = 'cmoisytge00037ogrbs55se61'
  WHERE email IN ('jhonatan@mestredapintura.com.br','samuel@mestredapintura.com.br','alessandro@mestredapintura.com.br')
    AND "storeId" <> 'cmoisytge00037ogrbs55se61';

-- 191 — Loja Vila Alexandria (cmoisytbq00007ogrb879fuu0)
UPDATE users SET "storeId" = 'cmoisytbq00007ogrb879fuu0'
  WHERE email IN ('leoni@mestredapintura.com.br')
    AND "storeId" <> 'cmoisytbq00007ogrb879fuu0';

-- 173 — Loja Vila Progredior/Jardim Guedala (cmoisytgb00027ogrwdcxgl7u)
UPDATE users SET "storeId" = 'cmoisytgb00027ogrwdcxgl7u'
  WHERE email IN ('josiel@mestredapintura.com.br','christian@mestredapintura.com.br','edielson@mestredapintura.com.br')
    AND "storeId" <> 'cmoisytgb00027ogrwdcxgl7u';

-- ── 5. Atribuir citelUserCode a cada usuário ─────────────────
-- Por email (idempotente; sobrescreve se diferente)
UPDATE users SET "citelUserCode" = '003' WHERE email = 'renato@mestredapintura.com.br';
UPDATE users SET "citelUserCode" = '004' WHERE email = 'jacques@mestredapintura.com.br';
UPDATE users SET "citelUserCode" = '016' WHERE email = 'eduardo@mestredapintura.com.br';
UPDATE users SET "citelUserCode" = '002' WHERE email = 'rafael@mestredapintura.com.br';
UPDATE users SET "citelUserCode" = '022' WHERE email = 'thiago@mestredapintura.com.br';
UPDATE users SET "citelUserCode" = '006' WHERE email = 'fabio@mestredapintura.com.br';
UPDATE users SET "citelUserCode" = '041' WHERE email = 'lucasleonardo@mestredapintura.com.br';
UPDATE users SET "citelUserCode" = '035' WHERE email = 'ryan@mestredapintura.com.br';
UPDATE users SET "citelUserCode" = '027' WHERE email = 'jhow@mestredapintura.com.br';
UPDATE users SET "citelUserCode" = '020' WHERE email = 'jane@mestredapintura.com.br';
UPDATE users SET "citelUserCode" = '031' WHERE email = 'cintia@mestredapintura.com.br';
UPDATE users SET "citelUserCode" = '045' WHERE email = 'jhonatan@mestredapintura.com.br';
UPDATE users SET "citelUserCode" = '036' WHERE email = 'samuel@mestredapintura.com.br';
UPDATE users SET "citelUserCode" = '028' WHERE email = 'alessandro@mestredapintura.com.br';
UPDATE users SET "citelUserCode" = '038' WHERE email = 'lucas@mestredapintura.com.br';
UPDATE users SET "citelUserCode" = '044' WHERE email = 'leoni@mestredapintura.com.br';
UPDATE users SET "citelUserCode" = '033' WHERE email = 'luan@mestredapintura.com.br';
UPDATE users SET "citelUserCode" = '043' WHERE email = 'josiel@mestredapintura.com.br';
UPDATE users SET "citelUserCode" = '042' WHERE email = 'christian@mestredapintura.com.br';

-- ── 6. Desativar placeholders "vendedor0XX@mestredapintura.com.br" ─
UPDATE users SET active = false
  WHERE email IN (
    'vendedor067@mestredapintura.com.br',
    'vendedor131@mestredapintura.com.br',
    'vendedor132@mestredapintura.com.br',
    'vendedor173@mestredapintura.com.br',
    'vendedor191@mestredapintura.com.br'
  )
  AND active = true;

-- ── 7. Substituir tabela FreightZone (7 zonas + express por zona) ─
-- Desativa zonas antigas (preserva FK em FreightQuote.zoneId — não dá pra DELETE).
-- Idempotente: rodar de novo só re-desativa. Novas zonas têm IDs estáveis "zone_zN_2026".
UPDATE freight_zones SET active = false
  WHERE id NOT LIKE 'zone_z%_2026'
    AND active = true;

INSERT INTO freight_zones (id, name, "minKm", "maxKm", "basePrice", "expressBasePrice", "urgentFactor", "underConsultation", active, "createdAt", "updatedAt")
VALUES
  ('zone_z1_2026',  'Z1 — até 3 km',         0,    3,    15.00, 25.00, 1.0, false, true, NOW(), NOW()),
  ('zone_z2_2026',  'Z2 — 3 a 6 km',         3,    6,    22.00, 35.00, 1.0, false, true, NOW(), NOW()),
  ('zone_z3_2026',  'Z3 — 6 a 10 km',        6,    10,   32.00, 48.00, 1.0, false, true, NOW(), NOW()),
  ('zone_z4_2026',  'Z4 — 10 a 15 km',       10,   15,   45.00, 63.00, 1.0, false, true, NOW(), NOW()),
  ('zone_z5_2026',  'Z5 — 15 a 22 km',       15,   22,   60.00, 78.00, 1.0, false, true, NOW(), NOW()),
  ('zone_z6_2026',  'Z6 — 22 a 30 km',       22,   30,   80.00, 94.00, 1.0, false, true, NOW(), NOW()),
  ('zone_z7_2026',  'Z7 — Acima de 30 km',   30,   NULL,  0.00,  0.00, 1.0, true,  true, NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
  name              = EXCLUDED.name,
  "minKm"           = EXCLUDED."minKm",
  "maxKm"           = EXCLUDED."maxKm",
  "basePrice"       = EXCLUDED."basePrice",
  "expressBasePrice"= EXCLUDED."expressBasePrice",
  "urgentFactor"    = EXCLUDED."urgentFactor",
  "underConsultation"=EXCLUDED."underConsultation",
  active            = EXCLUDED.active,
  "updatedAt"       = NOW();

-- ── 8. Backfill dispatchStoreId em pedidos existentes ────────
-- Convenção: dispatch sempre da 132 (CD) quando dispatchStoreId é NULL.
-- Idempotente: só preenche onde está vazio.
UPDATE delivery_requests
   SET "dispatchStoreId" = 'cmoisytfu00017ogrqcy7abin'
 WHERE "dispatchStoreId" IS NULL;
