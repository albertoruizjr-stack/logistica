// ──────────────────────────────────────────────
// SERVIÇO DE CONFIGURAÇÃO DO SISTEMA
// Leituras tipadas da tabela key/value SystemConfig.
// ──────────────────────────────────────────────

import { prisma } from "@/lib/prisma";

// Chave que controla, em runtime, se concluir uma entrega EXIGE as fotos
// (canhoto + material). Pode ser alterada no banco sem deploy.
export const REQUIRE_DELIVERY_PHOTO_KEY = "REQUIRE_DELIVERY_PHOTO";

/**
 * Indica se as fotos de comprovação são OBRIGATÓRIAS para concluir uma entrega.
 *
 * Regra (fail-safe / default = obrigatório):
 *   - retorna `false` SOMENTE quando o valor for exatamente a string "false";
 *   - qualquer outro valor, chave ausente ou erro de leitura → `true`.
 */
export async function isDeliveryPhotoRequired(): Promise<boolean> {
  try {
    const row = await prisma.systemConfig.findUnique({
      where: { key: REQUIRE_DELIVERY_PHOTO_KEY },
      select: { value: true },
    });
    return row?.value !== "false";
  } catch {
    // Em caso de falha de leitura, mantém o comportamento mais seguro: exigir foto.
    return true;
  }
}
