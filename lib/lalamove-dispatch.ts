// lib/lalamove-dispatch.ts
// Orquestra a criação de pedido no Lalamove:
// buildLalamoveStops (pura) → getLalamoveQuote → createLalamoveOrder.
// Separado do serviço HTTP (lalamove.service.ts) para facilitar testes.

import { getLalamoveQuote, createLalamoveOrder } from "@/services/lalamove.service";
import type { LalamoveStop } from "@/types";

export interface LalamovedDispatch {
  lalamoveOrderId: string;
  quotationId: string;
  estimatedPrice: number;   // em BRL, convertido de string para number
  shareLink?: string;
}

// Tipos mínimos necessários para construir os stops.
// Mantidos simples para facilitar mocks nos testes.
type StoreInfo = {
  lat: number;
  lng: number;
  address: string;
  phone?: string | null;
};

type DeliveryInfo = {
  deliveryLat?: number | null;
  deliveryLng?: number | null;
  deliveryAddress: string;
  customerName: string;
  customerPhone?: string | null;
};

// ──────────────────────────────────────────────
// FUNÇÃO PURA — sem I/O, testável sem mocks de banco
// ──────────────────────────────────────────────

export function buildLalamoveStops(
  store: StoreInfo,
  deliveryRequest: DeliveryInfo
): { origin: LalamoveStop; destination: LalamoveStop } | null {
  if (!deliveryRequest.deliveryLat || !deliveryRequest.deliveryLng) return null;

  const origin: LalamoveStop = {
    coordinates: {
      lat: String(store.lat),
      lng: String(store.lng),
    },
    address: store.address,
  };

  const destination: LalamoveStop = {
    coordinates: {
      lat: String(deliveryRequest.deliveryLat),
      lng: String(deliveryRequest.deliveryLng),
    },
    address: deliveryRequest.deliveryAddress,
    name: deliveryRequest.customerName,
    ...(deliveryRequest.customerPhone
      ? { phone: deliveryRequest.customerPhone }
      : {}),
  };

  return { origin, destination };
}

// ──────────────────────────────────────────────
// ORQUESTRADOR — quote → create order
// Retorna null se coordenadas ausentes (sem parar o fluxo de despacho).
// Lança exceção se a API Lalamove falhar (o chamador decide como tratar).
// ──────────────────────────────────────────────

export async function dispatchViaLalamove(
  store: StoreInfo,
  deliveryRequest: DeliveryInfo
): Promise<LalamovedDispatch | null> {
  const stops = buildLalamoveStops(store, deliveryRequest);
  if (!stops) return null;

  const quote = await getLalamoveQuote(stops.origin, stops.destination);
  if ("reason" in quote) return null;

  const order = await createLalamoveOrder(
    quote.quotationId,
    stops.origin,
    stops.destination,
    store.phone ?? ""
  );
  if ("reason" in order) return null;

  return {
    lalamoveOrderId: order.orderId,
    quotationId: quote.quotationId,
    estimatedPrice: parseFloat(quote.priceBreakdown.total),
    shareLink: order.shareLink,
  };
}
