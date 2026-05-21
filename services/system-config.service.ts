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

// Chave que controla, em runtime, se INICIAR a rota com foto de saída é
// OBRIGATÓRIO antes de o motorista poder finalizar entregas. Permite ativar
// a regra depois sem deploy.
export const REQUIRE_ROUTE_START_PHOTO_KEY = "REQUIRE_ROUTE_START_PHOTO";

/**
 * Indica se iniciar a rota com foto é OBRIGATÓRIO antes de concluir entregas.
 *
 * Regra (default = NÃO obrigatório — oposto da foto de entrega):
 *   - retorna `true` SOMENTE quando o valor for exatamente a string "true";
 *   - chave ausente, qualquer outro valor ou erro de leitura → `false`.
 */
export async function isRouteStartPhotoRequired(): Promise<boolean> {
  try {
    const row = await prisma.systemConfig.findUnique({
      where: { key: REQUIRE_ROUTE_START_PHOTO_KEY },
      select: { value: true },
    });
    return row?.value === "true";
  } catch {
    // Em caso de falha de leitura, mantém o comportamento atual (não-bloqueante).
    return false;
  }
}

// Chave que controla, em runtime, se coletar uma transferência na rota EXIGE a
// foto de coleta. Pode ser alterada no banco sem deploy.
export const REQUIRE_TRANSFER_COLLECT_PHOTO_KEY = "REQUIRE_TRANSFER_COLLECT_PHOTO";

/**
 * Indica se a foto de coleta é OBRIGATÓRIA para coletar uma transferência na rota.
 *
 * Regra (fail-safe / default = obrigatório — mesma forma de isDeliveryPhotoRequired):
 *   - retorna `false` SOMENTE quando o valor for exatamente a string "false";
 *   - qualquer outro valor, chave ausente ou erro de leitura → `true`.
 */
export async function isTransferCollectPhotoRequired(): Promise<boolean> {
  try {
    const row = await prisma.systemConfig.findUnique({
      where: { key: REQUIRE_TRANSFER_COLLECT_PHOTO_KEY },
      select: { value: true },
    });
    return row?.value !== "false";
  } catch {
    // Em caso de falha de leitura, mantém o comportamento mais seguro: exigir foto.
    return true;
  }
}
