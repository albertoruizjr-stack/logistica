// lib/delivery-progression.ts
// Lógica PURA de auto-avanço de entrega até IN_TRANSIT.
//
// CONTEXTO: o app do motorista expõe a entrega já na fase ROTEIRIZADO (rota ACTIVE,
// antes de qualquer despacho — ver lib/driver-ownership.ts). Mas concluir a entrega
// exige IN_TRANSIT. Em vez de travar o motorista quando o escritório esqueceu de
// despachar, o sistema avança sozinho os estados que faltam.
//
// Sem I/O aqui — só decide o caminho. Quem executa é services/route-dispatch.service.ts.

import type { DeliveryRequestStatus } from "@prisma/client";

// Sequência de transições necessárias para levar a entrega até IN_TRANSIT,
// a partir do estado atual.
//   []   → já está em IN_TRANSIT, nada a fazer
//   null → estado de onde NÃO se deve auto-avançar (anterior ao roteiro,
//          terminal, ou lateral como OCORRENCIA que exige resolução do operador)
export function pathToInTransit(
  current: DeliveryRequestStatus,
): DeliveryRequestStatus[] | null {
  switch (current) {
    case "ROTEIRIZADO": return ["DISPATCHED", "IN_TRANSIT"];
    case "DISPATCHED":  return ["IN_TRANSIT"];
    case "IN_TRANSIT":  return [];
    default:            return null;
  }
}
