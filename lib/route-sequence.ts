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
  // type ausente ou "DELIVERY" = entrega. "STORE_VISIT"/"EXTRA_STOP" = parada manual.
  type?:              "DELIVERY" | "STORE_VISIT" | "EXTRA_STOP";
  stopId?:            string;
  storeId?:           string;
  address?:           string;
  notes?:             string | null;
  lat?:               number | null;
  lng?:               number | null;
}

// Parada manual = não tem deliveryRequestId (é STORE_VISIT ou EXTRA_STOP).
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
