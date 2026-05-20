import { describe, it, expect } from "vitest";
import { extractDeliveryRequestIds, isManualStop, type RouteSequenceEntry } from "@/lib/route-sequence";

// Regressão do crash em /despacho: uma parada manual (EXTRA_STOP) sem deliveryRequestId
// gerava undefined dentro de prisma { id: { in: [...] } } e quebrava a query inteira.
describe("extractDeliveryRequestIds", () => {
  it("ignora paradas manuais (sem deliveryRequestId) e nunca devolve undefined", () => {
    const seq: RouteSequenceEntry[] = [
      { stopPosition: 0, deliveryRequestId: "dr-1", eta: null },
      // parada manual exatamente como addExtraStopToRoute grava:
      { stopPosition: 1, type: "EXTRA_STOP", stopId: "extra_x", address: "Rua Domingos Lopes, 155", notes: "NF 11606" },
      { stopPosition: 2, deliveryRequestId: "dr-2", eta: null },
    ];

    const ids = extractDeliveryRequestIds(seq);

    expect(ids).toEqual(["dr-1", "dr-2"]);
    expect(ids).not.toContain(undefined);
  });

  it("devolve lista vazia quando só há paradas manuais", () => {
    const seq: RouteSequenceEntry[] = [
      { stopPosition: 0, type: "STORE_VISIT", stopId: "extra_y", storeId: "store-1" },
    ];
    expect(extractDeliveryRequestIds(seq)).toEqual([]);
  });

  it("isManualStop distingue entrega de parada manual", () => {
    expect(isManualStop({ deliveryRequestId: "dr-1" })).toBe(false);
    expect(isManualStop({ type: "EXTRA_STOP", address: "X" })).toBe(true);
    expect(isManualStop({ type: "STORE_VISIT", storeId: "s1" })).toBe(true);
  });
});
