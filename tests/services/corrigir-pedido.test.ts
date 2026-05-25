import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    deliveryRequest: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    deliveryItem:    { deleteMany: vi.fn(), createMany: vi.fn() },
    deliveryStatusHistory: { create: vi.fn() },
    store:           { findFirst: vi.fn() },
    $transaction:    vi.fn(async (fn: (tx: unknown) => unknown) => fn({
      deliveryRequest: { update: vi.fn() },
      deliveryItem:    { deleteMany: vi.fn(), createMany: vi.fn() },
      deliveryStatusHistory: { create: vi.fn() },
    })),
  },
}));
vi.mock("@/services/citel.service", () => ({
  isCitelConfigured: vi.fn(() => true),
  fetchPedidoCabecalho: vi.fn(),
}));
vi.mock("@/services/citel-stock.service", () => ({
  enrichDeliveryRequestStock: vi.fn(),
}));
vi.mock("@/lib/google-maps", () => ({
  geocodeAddress: vi.fn(async () => ({ city: "São Paulo", state: "SP", lat: -23.5, lng: -46.6 })),
}));

import { corrigirPedido } from "@/services/corrigir-pedido.service";
import { prisma } from "@/lib/prisma";
import { fetchPedidoCabecalho } from "@/services/citel.service";
import { enrichDeliveryRequestStock } from "@/services/citel-stock.service";

const DR_BASE = {
  id: "dr1", orderNumber: "11633", orderStoreId: "s1", storeId: "s1", sellerId: "u1",
  status: "PENDING", customerPhone: "11999",
  orderStore: { code: "067", codigoEmpresaCitel: "067" },
};
const CABECALHO_OK = {
  nomeCliente: "JOÃO DA SILVA", documento: "123", telefone: "11999", celular: null,
  customerAddress: { logradouro: "Rua A", numero: "1", cidade: "São Paulo", estado: "SP" },
  deliveryAddress: { logradouro: "Rua B", numero: "2", cidade: "São Paulo", estado: "SP" },
  status: "APROVADO", entregaPeloCD: false, codigoEmpresaCD: null,
};
const ENRICH_OK = {
  items: [{ productCode: "P1", description: "Tinta", quantity: 2, unit: "GL", brand: "X",
            barcode: "1", grossWeight: 5, totalWeight: 10, hasMissingWeight: false,
            availableStock: 5, physicalStock: 5, stockStatus: "AVAILABLE", availableAtStore: true,
            sourceStoreId: null }],
  totalWeightKg: 10, totalLatas: 2, volumeBreakdown: { GL: 2 }, hasMissingWeights: false,
  stockValidationStatus: "VALIDATED", isEntregaCD: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.deliveryRequest.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...DR_BASE });
  (prisma.deliveryRequest.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (fetchPedidoCabecalho as ReturnType<typeof vi.fn>).mockResolvedValue({ ...CABECALHO_OK });
  (enrichDeliveryRequestStock as ReturnType<typeof vi.fn>).mockResolvedValue({ ...ENRICH_OK });
});

describe("corrigirPedido", () => {
  it("dryRun retorna preview sem persistir", async () => {
    const r = await corrigirPedido({ requestId: "dr1", newOrderNumber: "22000", actorId: "u1", dryRun: true });
    expect(r.ok).toBe(true);
    expect(r.preview?.customerName).toBe("JOÃO DA SILVA");
    expect(r.preview?.itemCount).toBe(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it("aplica: chama transação", async () => {
    const r = await corrigirPedido({ requestId: "dr1", newOrderNumber: "22000", actorId: "u1", dryRun: false });
    expect(r.ok).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });
  it("status != PENDING → NOT_PENDING", async () => {
    (prisma.deliveryRequest.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...DR_BASE, status: "SEPARADO" });
    const r = await corrigirPedido({ requestId: "dr1", newOrderNumber: "22000", actorId: "u1", dryRun: false });
    expect(r.error).toBe("NOT_PENDING");
  });
  it("número igual ao atual → SAME_NUMBER", async () => {
    const r = await corrigirPedido({ requestId: "dr1", newOrderNumber: "11633", actorId: "u1", dryRun: false });
    expect(r.error).toBe("SAME_NUMBER");
  });
  it("duplicata ativa → DUPLICATE", async () => {
    (prisma.deliveryRequest.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "dr2" });
    const r = await corrigirPedido({ requestId: "dr1", newOrderNumber: "22000", actorId: "u1", dryRun: false });
    expect(r.error).toBe("DUPLICATE");
  });
  it("pedido cancelado → ORDER_BLOCKED", async () => {
    (fetchPedidoCabecalho as ReturnType<typeof vi.fn>).mockResolvedValue({ ...CABECALHO_OK, status: "CANCELADO" });
    const r = await corrigirPedido({ requestId: "dr1", newOrderNumber: "22000", actorId: "u1", dryRun: false });
    expect(r.error).toBe("ORDER_BLOCKED");
  });
  it("pedido inexistente → NOT_FOUND", async () => {
    (fetchPedidoCabecalho as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await corrigirPedido({ requestId: "dr1", newOrderNumber: "22000", actorId: "u1", dryRun: false });
    expect(r.error).toBe("NOT_FOUND");
  });
  it("sem itens no Citel → NO_ITEMS", async () => {
    (enrichDeliveryRequestStock as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await corrigirPedido({ requestId: "dr1", newOrderNumber: "22000", actorId: "u1", dryRun: false });
    expect(r.error).toBe("NO_ITEMS");
  });
});
