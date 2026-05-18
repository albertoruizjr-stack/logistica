-- ─────────────────────────────────────────────────────────────────────────
-- Migration: troca @@unique([orderNumber, orderStoreId]) por UNIQUE INDEX parcial.
--
-- MOTIVO: o constraint antigo bloqueava recriação de uma DR com o mesmo PD
-- mesmo quando a anterior estava CANCELLED. Vendedor que cancelava e refazia
-- não conseguia.
--
-- COMPORTAMENTO NOVO:
--   - DR ativa (status != 'CANCELLED')                    → UMA por (orderNumber, orderStoreId)
--   - DR cancelada (status = 'CANCELLED')                 → não bloqueia novas inserções
--   - Múltiplas DRs canceladas com mesmo PD               → permitido (auditoria histórica)
--
-- Idempotente: pode rodar várias vezes sem efeito colateral.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. Remove o unique index antigo gerado pelo Prisma ─────────────────
-- O Prisma criou um índice cujo nome é "delivery_requests_orderNumber_orderStoreId_key"
-- quando o @@unique estava no schema. Sem ele, o índice parcial fica como
-- única fonte de unicidade.
DROP INDEX IF EXISTS "delivery_requests_orderNumber_orderStoreId_key";

-- ── 2. Cria o índice parcial novo ──────────────────────────────────────
-- O nome propositalmente diferente do antigo deixa explícito que é semântica
-- nova (apenas DRs não-canceladas).
DROP INDEX IF EXISTS "delivery_requests_orderNumber_orderStoreId_active_key";
CREATE UNIQUE INDEX "delivery_requests_orderNumber_orderStoreId_active_key"
  ON "delivery_requests" ("orderNumber", "orderStoreId")
  WHERE "status" <> 'CANCELLED';

-- ── 3. Verificação (opcional, só pra log) ──────────────────────────────
-- DO $$
-- DECLARE
--   v_count integer;
-- BEGIN
--   SELECT COUNT(*) INTO v_count
--   FROM pg_indexes
--   WHERE tablename = 'delivery_requests'
--     AND indexname = 'delivery_requests_orderNumber_orderStoreId_active_key';
--   RAISE NOTICE 'Índice parcial criado: % linha(s) em pg_indexes', v_count;
-- END $$;
