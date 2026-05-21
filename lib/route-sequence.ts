// ──────────────────────────────────────────────
// SEQUÊNCIA DE PARADAS DE UMA ROTA (route.sequenceJson)
//
// Uma entrada pode ser:
//   - ENTREGA:      { stopPosition, deliveryRequestId, eta }
//   - PARADA MANUAL: { stopPosition, type: "STORE_VISIT" | "EXTRA_STOP", stopId, ... }
//                    (adicionada pelo operador via addExtraStopToRoute — NÃO tem deliveryRequestId)
//
// Telas que consultam metadados das entregas (despacho, manifest) PRECISAM filtrar
// as paradas manuais antes de mandar IDs pro Prisma — passar undefined dentro de
// { id: { in: [...] } } quebra a query inteira (foi a causa do crash em /despacho).
// ──────────────────────────────────────────────

export interface RouteSequenceEntry {
  stopPosition?:      number | null;
  deliveryRequestId?: string;
  eta?:               string | number | null;
  // type ausente ou "DELIVERY" = entrega. "STORE_VISIT"/"EXTRA_STOP"/"TRANSFER_PICKUP" = parada manual.
  type?:              "DELIVERY" | "STORE_VISIT" | "EXTRA_STOP" | "TRANSFER_PICKUP";
  stopId?:            string;
  storeId?:           string;
  address?:           string;
  notes?:             string | null;
  lat?:               number | null;
  lng?:               number | null;
  // Para TRANSFER_PICKUP: IDs das transferências coletadas nesta parada.
  // Uma parada de coleta cobre VÁRIAS transferências da mesma loja de origem (storeId).
  transferIds?:       string[];
}

// Parada manual = não tem deliveryRequestId (é STORE_VISIT, EXTRA_STOP ou TRANSFER_PICKUP).
// TRANSFER_PICKUP também é parada manual: não tem Dispatch nem deliveryRequestId e
// NÃO entra em extractDeliveryRequestIds (usa transferIds, não IDs de entrega).
export function isManualStop(s: RouteSequenceEntry): boolean {
  return !s.deliveryRequestId;
}

// IDs de entregas reais — descarta paradas manuais (sem deliveryRequestId) e
// quaisquer valores vazios. Seguro para usar em prisma { id: { in: [...] } }.
export function extractDeliveryRequestIds(seq: RouteSequenceEntry[]): string[] {
  return seq
    .map((s) => s.deliveryRequestId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

// Parada de coleta de transferência na rota.
export function isTransferPickupStop(s: RouteSequenceEntry): boolean {
  return s.type === "TRANSFER_PICKUP";
}

// IDs de todas as transferências cobertas pelas paradas TRANSFER_PICKUP da sequência.
// Achata os transferIds de todas as paradas de coleta e remove duplicatas.
export function extractTransferIds(seq: RouteSequenceEntry[]): string[] {
  const ids = seq
    .filter(isTransferPickupStop)
    .flatMap((s) => s.transferIds ?? [])
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return Array.from(new Set(ids));
}
