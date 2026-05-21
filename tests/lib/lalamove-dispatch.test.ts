import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { buildLalamoveStops, dispatchViaLalamove } from "@/lib/lalamove-dispatch";

// mock do serviço Lalamove (evita HTTP real nos testes)
vi.mock("@/services/lalamove.service", () => ({
  getLalamoveQuote: vi.fn(),
  createLalamoveOrder: vi.fn(),
}));

import { getLalamoveQuote, createLalamoveOrder } from "@/services/lalamove.service";

const mockStore = {
  lat: -23.5657,
  lng: -46.6521,
  address: "Rua Funchal, 123 — Vila Olímpia, SP",
  phone: "11999990000",
};

const mockDeliveryRequest = {
  deliveryLat: -23.5505,
  deliveryLng: -46.6333,
  deliveryAddress: "Av. Paulista, 1000 — Bela Vista, SP",
  customerName: "João Silva",
  customerPhone: "11988887777",
};

// ──────────────────────────────────────────────
// buildLalamoveStops
// ──────────────────────────────────────────────

describe("buildLalamoveStops", () => {
  it("retorna stops com coordenadas como strings", () => {
    const result = buildLalamoveStops(mockStore, mockDeliveryRequest);
    expect(result).not.toBeNull();
    expect(result!.origin.coordinates.lat).toBe("-23.5657");
    expect(result!.origin.coordinates.lng).toBe("-46.6521");
    expect(result!.destination.coordinates.lat).toBe("-23.5505");
    expect(result!.destination.coordinates.lng).toBe("-46.6333");
  });

  it("preenche name e phone no destino", () => {
    const result = buildLalamoveStops(mockStore, mockDeliveryRequest);
    expect(result!.destination.name).toBe("João Silva");
    expect(result!.destination.phone).toBe("11988887777");
  });

  it("retorna null quando deliveryLat é null", () => {
    const result = buildLalamoveStops(mockStore, {
      ...mockDeliveryRequest,
      deliveryLat: null,
    });
    expect(result).toBeNull();
  });

  it("retorna null quando deliveryLng é null", () => {
    const result = buildLalamoveStops(mockStore, {
      ...mockDeliveryRequest,
      deliveryLng: null,
    });
    expect(result).toBeNull();
  });

  it("omite phone no destino quando customerPhone é null", () => {
    const result = buildLalamoveStops(mockStore, {
      ...mockDeliveryRequest,
      customerPhone: null,
    });
    expect(result!.destination.phone).toBeUndefined();
  });
});

// ──────────────────────────────────────────────
// dispatchViaLalamove
// ──────────────────────────────────────────────

describe("dispatchViaLalamove", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLalamoveQuote).mockResolvedValue({
      quotationId: "q_abc123",
      scheduleAt: "",
      serviceType: "MOTORCYCLE",
      specialRequests: [],
      expiresAt: "",
      priceBreakdown: {
        base: "15.00",
        totalBeforeOptimization: "15.00",
        total: "15.00",
        currency: "BRL",
      },
      stops: [],
    });
    vi.mocked(createLalamoveOrder).mockResolvedValue({
      orderId: "ord_xyz789",
      shareLink: "https://share.lalamove.com/xyz789",
    });
  });

  it("chama getLalamoveQuote com os stops corretos", async () => {
    await dispatchViaLalamove(mockStore, mockDeliveryRequest);
    expect(getLalamoveQuote).toHaveBeenCalledOnce();
    const [originStop, destStop] = vi.mocked(getLalamoveQuote).mock.calls[0];
    expect(originStop.coordinates.lat).toBe("-23.5657");
    expect(destStop.name).toBe("João Silva");
  });

  it("chama createLalamoveOrder com o quotationId retornado pelo quote", async () => {
    await dispatchViaLalamove(mockStore, mockDeliveryRequest);
    expect(createLalamoveOrder).toHaveBeenCalledWith(
      "q_abc123",
      expect.any(Object),
      expect.any(Object),
      "11999990000"
    );
  });

  it("retorna os campos esperados em caso de sucesso", async () => {
    const result = await dispatchViaLalamove(mockStore, mockDeliveryRequest);
    expect(result).toEqual({
      lalamoveOrderId: "ord_xyz789",
      quotationId: "q_abc123",
      estimatedPrice: 15,
      shareLink: "https://share.lalamove.com/xyz789",
    });
  });

  it("retorna null sem chamar a API quando coordenadas ausentes", async () => {
    const result = await dispatchViaLalamove(mockStore, {
      ...mockDeliveryRequest,
      deliveryLat: null,
    });
    expect(result).toBeNull();
    expect(getLalamoveQuote).not.toHaveBeenCalled();
  });

  it("usa o serviceType informado na cotação", async () => {
    (getLalamoveQuote as Mock).mockResolvedValue({
      quotationId: "Q1", priceBreakdown: { total: "34.50", currency: "BRL" }, stops: [],
    });
    (createLalamoveOrder as Mock).mockResolvedValue({ orderId: "O1", shareLink: "http://x" });
    await dispatchViaLalamove(mockStore, mockDeliveryRequest, { serviceType: "UV_FIORINO" });
    expect((getLalamoveQuote as Mock).mock.calls[0][3]).toBe("UV_FIORINO");
  });

  it("pula a cotação quando recebe quotationId pronto", async () => {
    (createLalamoveOrder as Mock).mockResolvedValue({ orderId: "O1", shareLink: "http://x" });
    const r = await dispatchViaLalamove(mockStore, mockDeliveryRequest, { quotationId: "Q-PRONTO", estimatedPrice: 34.5 });
    expect(getLalamoveQuote).not.toHaveBeenCalled();
    expect(r?.lalamoveOrderId).toBe("O1");
  });
});
