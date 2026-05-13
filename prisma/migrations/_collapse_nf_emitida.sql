-- Unifica NF_EMITIDA em NF_VINCULADA — fluxo agora é
-- AGUARDANDO_NF → "NF emitida no Citel" (clique único) → NF_VINCULADA.
UPDATE delivery_requests SET status = 'NF_VINCULADA' WHERE status = 'NF_EMITIDA';
