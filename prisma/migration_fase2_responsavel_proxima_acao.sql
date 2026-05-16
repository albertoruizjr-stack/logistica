-- ══════════════════════════════════════════════════════════════
-- Migration: Fase 2 — Responsável da próxima ação por solicitação
-- Sistema Logístico — Mestre da Pintura
-- Idempotente — seguro rodar mais de uma vez.
-- ══════════════════════════════════════════════════════════════

-- ── 1. DeliveryRequest.entregaPeloCD ─────────────────────────
-- Espelha cabecalho.entregaPeloCD do Citel. Define quem é responsável pela separação:
--   true  → CD (loja 132): Jhow/Jane/Thiago
--   false → loja do vendedor: STORE_LEADER local
ALTER TABLE delivery_requests
  ADD COLUMN IF NOT EXISTS "entregaPeloCD" BOOLEAN NOT NULL DEFAULT false;

-- ── 2. Reajustar dispatchStoreId de pedidos antigos ──────────
-- Pedidos da Fase 1 ficaram todos com dispatchStoreId = 132. Mantém esse default —
-- pedidos novos vão setar baseado em entregaPeloCD lido na criação.
-- (sem ação aqui — só documentação)
