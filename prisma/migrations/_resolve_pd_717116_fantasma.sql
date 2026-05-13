-- ──────────────────────────────────────────────
-- Saneamento: PD 717116 com Transfer fantasma
--
-- A Jane emitiu a NF do PD 717116 (loja origem 132), mas a Transfer
-- ficou em PENDING porque alguns items não tinham PD interno do Citel
-- pra vincular — na prática, os produtos estavam fisicamente em estoque
-- mesmo o Citel acusando falta.
--
-- Esta migration:
--   1. Marca todos os items pendentes da Transfer como RESOLVED_BY_STOCK
--   2. Loga cada item no stock_divergence_log com trigger="MIGRATION"
--   3. Promove a Transfer para APPROVED (ou RECEIVED se a entrega já ocorreu)
--
-- Idempotente: se a Transfer já foi resolvida, o WHERE não encontra nada.
-- ──────────────────────────────────────────────

-- 0. Captura o usuário Jane pra atribuir as resoluções (caso não exista, usa ADMIN)
DO $$
DECLARE
  v_jane_id        TEXT;
  v_jane_name      TEXT;
  v_pd             TEXT := '000000717116';  -- Citel PD 12-digit zero-padded
  v_transfer_id    TEXT;
  v_transfer_state TEXT;
  v_request_id     TEXT;
  v_to_store_code  TEXT;
  v_dr_status      TEXT;
  rec              RECORD;
BEGIN
  -- Busca usuário Jane (LOGISTICS_OPERATOR). Fallback: qualquer ADMIN.
  SELECT id, name INTO v_jane_id, v_jane_name
    FROM users
   WHERE role = 'LOGISTICS_OPERATOR'
     AND active = true
   ORDER BY "createdAt" ASC
   LIMIT 1;

  IF v_jane_id IS NULL THEN
    SELECT id, name INTO v_jane_id, v_jane_name
      FROM users WHERE role = 'ADMIN' AND active = true
      ORDER BY "createdAt" ASC LIMIT 1;
  END IF;

  IF v_jane_id IS NULL THEN
    RAISE EXCEPTION 'Nenhum usuário ADMIN/LOGISTICS_OPERATOR encontrado para registrar a resolução';
  END IF;

  -- Localiza a DeliveryRequest pelo orderNumber (sem zeros à esquerda)
  SELECT id, status INTO v_request_id, v_dr_status
    FROM delivery_requests
   WHERE "orderNumber" = '717116'
   LIMIT 1;

  IF v_request_id IS NULL THEN
    RAISE NOTICE 'PD 717116 não encontrado em delivery_requests — nada a fazer';
    RETURN;
  END IF;

  -- Localiza Transfer ativa (PENDING) atrelada a esse request
  SELECT t.id, t.status, s.code
    INTO v_transfer_id, v_transfer_state, v_to_store_code
    FROM transfers t
    JOIN stores s ON s.id = t."toStoreId"
   WHERE t."deliveryRequestId" = v_request_id
     AND t.status NOT IN ('CANCELLED', 'RECEIVED')
   ORDER BY t."requestedAt" DESC
   LIMIT 1;

  IF v_transfer_id IS NULL THEN
    RAISE NOTICE 'Nenhuma Transfer ativa encontrada para PD 717116 — nada a fazer';
    RETURN;
  END IF;

  RAISE NOTICE 'Saneando Transfer % (status=%) do PD 717116', v_transfer_id, v_transfer_state;

  -- 1. + 2. Para cada item pendente: marca RESOLVED_BY_STOCK + loga divergência
  FOR rec IN
    SELECT id, "productCode", "productName", quantity, unit
      FROM transfer_items
     WHERE "transferId" = v_transfer_id
       AND "linkedCitelPD" IS NULL
  LOOP
    UPDATE transfer_items
       SET "linkedCitelPD"        = 'RESOLVED_BY_STOCK',
           "linkedCitelStoreCode" = v_to_store_code,
           "linkedAt"             = NOW(),
           "linkedById"           = v_jane_id
     WHERE id = rec.id;

    INSERT INTO stock_divergence_log
      (id, "transferItemId", "transferId", "deliveryRequestId",
       "productCode", "productName", quantity, unit,
       "storeCode", "resolvedById", "resolvedByName", trigger, notes)
    VALUES
      ('sdl_mig_' || substr(md5(random()::text), 1, 12),
       rec.id, v_transfer_id, v_request_id,
       rec."productCode", rec."productName", rec.quantity, rec.unit,
       v_to_store_code, v_jane_id, v_jane_name,
       'MIGRATION',
       'Saneamento PD 717116: produto estava em estoque na loja, NF já emitida'
      );
  END LOOP;

  -- 3. Promove a Transfer.
  --    Se o pedido já está em status pós-NF, marca como RECEIVED (transferência já ocorreu).
  --    Caso contrário, APPROVED.
  IF v_dr_status IN ('NF_VINCULADA', 'NF_EMITIDA', 'PRONTO_ROTEIRIZACAO',
                     'ROTEIRIZADO', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED') THEN
    UPDATE transfers
       SET status         = 'RECEIVED',
           "approvedById" = v_jane_id,
           "approvedAt"   = NOW(),
           "receivedAt"   = NOW()
     WHERE id = v_transfer_id
       AND status = 'PENDING';
    RAISE NOTICE 'Transfer % marcada como RECEIVED (DR já em %)', v_transfer_id, v_dr_status;
  ELSE
    UPDATE transfers
       SET status        = 'APPROVED',
           "approvedById" = v_jane_id,
           "approvedAt"   = NOW()
     WHERE id = v_transfer_id
       AND status = 'PENDING';
    RAISE NOTICE 'Transfer % marcada como APPROVED', v_transfer_id;
  END IF;

  RAISE NOTICE 'Saneamento PD 717116 concluído';
END $$;
