-- ──────────────────────────────────────────────
-- Log de divergências Citel × físico
--
-- Registra cada vez que um item de transferência foi resolvido como
-- "produto na verdade estava em estoque" — ou seja, o Citel disse que
-- faltava mas a loja tinha fisicamente. Permite à Jane montar painéis
-- dos SKUs que mais sofrem com divergência de estoque.
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stock_divergence_log (
  id                  TEXT PRIMARY KEY,
  "transferItemId"    TEXT NOT NULL,
  "transferId"        TEXT NOT NULL,
  "deliveryRequestId" TEXT,
  "productCode"       TEXT NOT NULL,
  "productName"       TEXT NOT NULL,
  quantity            DOUBLE PRECISION NOT NULL,
  unit                TEXT,
  "storeCode"         TEXT NOT NULL,
  "resolvedById"      TEXT NOT NULL,
  "resolvedByName"    TEXT,
  "resolvedAt"        TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  trigger             TEXT NOT NULL,  -- "MANUAL" | "AUTO_PROMOTE" | "MIGRATION"
  notes               TEXT
);

CREATE INDEX IF NOT EXISTS sdl_sku_store_idx ON stock_divergence_log("productCode", "storeCode");
CREATE INDEX IF NOT EXISTS sdl_resolved_at_idx ON stock_divergence_log("resolvedAt" DESC);
CREATE INDEX IF NOT EXISTS sdl_store_idx ON stock_divergence_log("storeCode", "resolvedAt" DESC);
