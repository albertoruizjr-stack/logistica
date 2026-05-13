import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks declarados antes dos imports para garantir hoisting correto
vi.mock("@/services/citel.service", () => ({
  fetchEstoqueCitelBatch: vi.fn(),
  fetchProdutoDetalhe:    vi.fn(),
  fetchPedidoItens:       vi.fn(),
  getSaldoForEmpresa:     vi.fn(),
  isCitelConfigured:      vi.fn().mockReturnValue(true),
}));

import {
  fetchEstoqueCitelBatch,
  fetchProdutoDetalhe,
  fetchPedidoItens,
  getSaldoForEmpresa,
  isCitelConfigured,
} from "@/services/citel.service";

import {
  enrichDeliveryItemsWithStock,
  validateStockAvailability,
  calculateDeliveryWeight,
  calculateDeliveryVolumeRules,
  validateVehicleCapacity,
  isHeavyUnit,
  fetchOrderItemsFromCitel,
} from "@/services/citel-stock.service";

import type { CitelPedidoItem, EnrichedDeliveryItem } from "@/types/stock";

// ──────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────

const EMPRESA = "1"; // codigoEmpresaCitel da loja

function makeItem(overrides: Partial<CitelPedidoItem> = {}): CitelPedidoItem {
  return {
    codigo:           "PROD-001",
    descricao:        "Tinta Acrílica 18L Branco",
    marca:            "Coral",
    quantidade:       2,
    unidade:          "GL",
    codigoBarra:      "7891234567890",
    pesoBruto:        28,
    totalWeight:      56,
    hasMissingWeight: false,
    ...overrides,
  };
}

function makeEnriched(overrides: Partial<EnrichedDeliveryItem> = {}): EnrichedDeliveryItem {
  return {
    productCode:      "PROD-001",
    description:      "Tinta Acrílica 18L Branco",
    brand:            "Coral",
    quantity:         2,
    unit:             "GL",
    barcode:          "7891234567890",
    grossWeight:      28,
    totalWeight:      56,
    hasMissingWeight: false,
    availableStock:   10,
    physicalStock:    10,
    daysWithoutSale:  null,
    turnoverClass:    null,
    stockStatus:      "AVAILABLE",
    availableAtStore: true,
    sourceStoreId:    null,
    ...overrides,
  };
}

function mockEstoque(codigo: string, disponivel: number, fisico: number) {
  vi.mocked(fetchEstoqueCitelBatch).mockResolvedValue([
    {
      codigoProduto:  codigo,
      saldoEmpresas:  [],
    },
  ]);
  vi.mocked(getSaldoForEmpresa).mockReturnValue({
    codigoEmpresa:                EMPRESA,
    saldoFisico:                  fisico,
    saldoDisponivel:              disponivel,
    saldoReservadoPedido:         0,
    saldoReservadoPedidoFilial:   0,
    saldoReservadoExterno:        0,
    saldoReservadoEnderecamento:  0,
    saldoEntregaFuturaAguardando: 0,
    estoqueMinimo:                0,
    estoqueMaximo:                0,
  });
}

// ──────────────────────────────────────────────
// CLASSIFICAÇÃO DE ESTOQUE
// ──────────────────────────────────────────────

describe("validateStockAvailability", () => {
  it("TESTE 1 — saldo disponível suficiente → VALIDATED", () => {
    const items = [makeEnriched({ stockStatus: "AVAILABLE", availableAtStore: true })];
    expect(validateStockAvailability(items)).toBe("VALIDATED");
  });

  it("TESTE 2 — saldo físico ok mas disponível insuficiente → PARTIAL", () => {
    const items = [makeEnriched({ stockStatus: "RESERVED_ELSEWHERE", availableAtStore: false })];
    expect(validateStockAvailability(items)).toBe("PARTIAL");
  });

  it("TESTE 3 — saldo físico insuficiente → UNAVAILABLE", () => {
    const items = [makeEnriched({ stockStatus: "UNAVAILABLE", availableAtStore: false })];
    expect(validateStockAvailability(items)).toBe("UNAVAILABLE");
  });

  it("TESTE 3b — saldo zero → UNAVAILABLE (pior status)", () => {
    const items = [makeEnriched({ stockStatus: "ZERO_STOCK", availableAtStore: false })];
    expect(validateStockAvailability(items)).toBe("UNAVAILABLE");
  });

  it("TESTE — Citel indisponível → CITEL_DOWN", () => {
    const items = [makeEnriched({ stockStatus: "CITEL_DOWN", availableAtStore: false })];
    expect(validateStockAvailability(items)).toBe("CITEL_DOWN");
  });

  it("TESTE — lista vazia → PENDING", () => {
    expect(validateStockAvailability([])).toBe("PENDING");
  });
});

// ──────────────────────────────────────────────
// PESO TOTAL
// ──────────────────────────────────────────────

describe("calculateDeliveryWeight", () => {
  it("TESTE 4 — produto sem peso bruto registra alerta e usa fallback", () => {
    const items = [
      makeEnriched({ grossWeight: null, totalWeight: 30, hasMissingWeight: true }),
    ];
    const { hasMissingWeights, missingWeightCodes } = calculateDeliveryWeight(items);
    expect(hasMissingWeights).toBe(true);
    expect(missingWeightCodes).toContain("PROD-001");
  });

  it("TESTE 5 — pedido com múltiplos itens soma peso corretamente", () => {
    const items = [
      makeEnriched({ productCode: "P1", totalWeight: 56 }),
      makeEnriched({ productCode: "P2", totalWeight: 10 }),
      makeEnriched({ productCode: "P3", totalWeight: 14 }),
    ];
    const { totalWeightKg } = calculateDeliveryWeight(items);
    expect(totalWeightKg).toBe(80);
  });
});

// ──────────────────────────────────────────────
// REGRAS DE VOLUME
// ──────────────────────────────────────────────

describe("calculateDeliveryVolumeRules", () => {
  it("conta latas/baldes/galões corretamente", () => {
    const items = [
      makeEnriched({ unit: "GL", quantity: 4 }),  // galão → pesado
      makeEnriched({ unit: "BD", quantity: 2 }),  // balde → pesado
      makeEnriched({ unit: "UN", quantity: 5 }),  // unidade → não conta
    ];
    const { totalLatas, hasHeavyUnit } = calculateDeliveryVolumeRules(items);
    expect(totalLatas).toBe(6);   // 4 + 2
    expect(hasHeavyUnit).toBe(true);
  });

  it("isHeavyUnit identifica unidades pesadas", () => {
    expect(isHeavyUnit("BD")).toBe(true);
    expect(isHeavyUnit("GL")).toBe(true);
    expect(isHeavyUnit("LT")).toBe(true);
    expect(isHeavyUnit("UN")).toBe(false);
    expect(isHeavyUnit("SC")).toBe(false);
  });
});

// ──────────────────────────────────────────────
// VALIDAÇÃO DE CAPACIDADE DO VEÍCULO
// ──────────────────────────────────────────────

describe("validateVehicleCapacity", () => {
  it("TESTE 6 — entrega acima de 500 kg bloqueia Fiorino e sugere veículo superior", () => {
    const result = validateVehicleCapacity(501, 5, false, "FIORINO");
    expect(result.allowed).toBe(false);
    expect(result.exceedsWeight).toBe(true);
    // VAN (800 kg) é o menor veículo que comporta — mais econômico que CAMINHAO
    expect(result.suggestedModal).toBe("VAN");
  });

  it("TESTE 6b — entrega acima de 800 kg (VAN) sugere Caminhão", () => {
    const result = validateVehicleCapacity(801, 5, false, "VAN");
    expect(result.allowed).toBe(false);
    expect(result.suggestedModal).toBe("CAMINHAO");
  });

  it("TESTE 7 — acima de 20 latas bloqueia Fiorino", () => {
    const result = validateVehicleCapacity(200, 21, true, "FIORINO");
    expect(result.allowed).toBe(false);
    expect(result.exceedsLatas).toBe(true);
  });

  it("TESTE 8 — moto com lata/balde é bloqueada", () => {
    const result = validateVehicleCapacity(10, 2, true, "MOTO");
    expect(result.allowed).toBe(false);
    expect(result.hasHeavyUnit).toBe(true);
    expect(result.blockedReason).toMatch(/lata|balde|galão/i);
  });

  it("TESTE 9 — caminhão aguenta até 1.650 kg", () => {
    const result = validateVehicleCapacity(1650, 80, true, "CAMINHAO");
    expect(result.allowed).toBe(true);
  });

  it("caminhão bloqueia acima de 1.650 kg", () => {
    const result = validateVehicleCapacity(1651, 80, true, "CAMINHAO");
    expect(result.allowed).toBe(false);
  });

  it("Fiorino permite até 500 kg sem latas pesadas", () => {
    const result = validateVehicleCapacity(499, 0, false, "FIORINO");
    expect(result.allowed).toBe(true);
  });
});

// ──────────────────────────────────────────────
// FETCH DE ITENS DO PEDIDO
// ──────────────────────────────────────────────

describe("fetchOrderItemsFromCitel", () => {
  beforeEach(() => {
    vi.mocked(isCitelConfigured).mockReturnValue(true);
  });

  it("retorna null quando Citel não está configurado", async () => {
    vi.mocked(isCitelConfigured).mockReturnValue(false);
    const result = await fetchOrderItemsFromCitel("PD-001", "067");
    expect(result).toBeNull();
  });

  it("retorna null quando PD não tem itens", async () => {
    vi.mocked(fetchPedidoItens).mockResolvedValue([]);
    const result = await fetchOrderItemsFromCitel("PD-999", "067");
    expect(result).toBeNull();
  });

  it("TESTE 4 — item sem peso bruto sinaliza hasMissingWeight", async () => {
    vi.mocked(fetchPedidoItens).mockResolvedValue([
      { codigo: "P001", descricao: "Produto sem peso", quantidade: 3, unidade: "UN", pesoBruto: null },
    ]);
    vi.mocked(fetchProdutoDetalhe).mockResolvedValue({
      codigo: "P001", descricao: "Produto sem peso", marca: null,
      unidade: "UN", codigoBarra: null,
      pesoBruto: null, pesoLiquido: null,
      diasSemVenda: null, giro: null, grupo: null, subgrupo: null,
    });

    const result = await fetchOrderItemsFromCitel("PD-001", "067");
    expect(result).not.toBeNull();
    expect(result![0].hasMissingWeight).toBe(true);
    expect(result![0].pesoBruto).toBeNull();
  });

  it("calcula peso total corretamente quando pesoBruto disponível", async () => {
    vi.mocked(fetchPedidoItens).mockResolvedValue([
      { codigo: "P001", descricao: "Tinta 18L", quantidade: 4, unidade: "GL", pesoBruto: null },
    ]);
    vi.mocked(fetchProdutoDetalhe).mockResolvedValue({
      codigo: "P001", descricao: "Tinta 18L", marca: "Coral",
      unidade: "GL", codigoBarra: "789",
      pesoBruto: 28, pesoLiquido: 18,
      diasSemVenda: 5, giro: "A", grupo: "TINTA", subgrupo: null,
    });

    const result = await fetchOrderItemsFromCitel("PD-001", "067");
    expect(result).not.toBeNull();
    expect(result![0].totalWeight).toBe(112); // 4 × 28
    expect(result![0].hasMissingWeight).toBe(false);
  });
});

// ──────────────────────────────────────────────
// ENRIQUECIMENTO COM SALDO
// ──────────────────────────────────────────────

describe("enrichDeliveryItemsWithStock", () => {
  it("TESTE 10 — Citel indisponível marca itens como CITEL_DOWN", async () => {
    vi.mocked(fetchEstoqueCitelBatch).mockResolvedValue([]);
    vi.mocked(getSaldoForEmpresa).mockReturnValue(null);

    const items = [makeItem()];
    const result = await enrichDeliveryItemsWithStock(items, EMPRESA);

    expect(result[0].stockStatus).toBe("CITEL_DOWN");
    expect(result[0].availableAtStore).toBe(false);
    expect(result[0].availableStock).toBe(0);
  });

  it("item disponível → AVAILABLE + availableAtStore=true", async () => {
    mockEstoque("PROD-001", 10, 10);
    const items = [makeItem({ quantidade: 3 })];
    const result = await enrichDeliveryItemsWithStock(items, EMPRESA);

    expect(result[0].stockStatus).toBe("AVAILABLE");
    expect(result[0].availableAtStore).toBe(true);
    expect(result[0].availableStock).toBe(10);
  });

  it("saldo físico ok mas disponível insuficiente → RESERVED_ELSEWHERE", async () => {
    mockEstoque("PROD-001", 1, 10);
    const items = [makeItem({ quantidade: 3 })];
    const result = await enrichDeliveryItemsWithStock(items, EMPRESA);

    expect(result[0].stockStatus).toBe("RESERVED_ELSEWHERE");
    expect(result[0].availableAtStore).toBe(false);
    expect(result[0].physicalStock).toBe(10);
  });
});
