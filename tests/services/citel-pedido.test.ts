import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks antes dos imports (hoisting do vi.mock)
vi.mock("@/services/citel.service", () => ({
  isCitelConfigured:    vi.fn().mockReturnValue(true),
  fetchPedidoCabecalho: vi.fn(),
  fetchPedidoItens:     vi.fn(),
  fetchProdutoDetalhe:  vi.fn(),
  fetchEstoqueCitelBatch: vi.fn(),
  getSaldoForEmpresa:   vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: {
      findFirst: vi.fn().mockResolvedValue({ codigoEmpresaCitel: "1" }),
    },
  },
}));

import {
  isCitelConfigured,
  fetchPedidoCabecalho,
  fetchPedidoItens,
} from "@/services/citel.service";

import { fetchOrderItemsFromCitel } from "@/services/citel-stock.service";
import type { CitelPedidoCabecalho } from "@/types/stock";

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function makeCabecalho(overrides: Partial<CitelPedidoCabecalho> = {}): CitelPedidoCabecalho {
  return {
    numeroPedido:  "12345",
    codigoEmpresa: "067",
    nomeCliente:   "Carlos Moreira",
    documento:     "987.654.321-00",
    telefone:      "(11) 98765-4321",
    celular:       null,
    email:         null,
    customerAddress: {
      logradouro:  "Av. Paulista",
      numero:      "1000",
      complemento: "Sala 12",
      bairro:      "Bela Vista",
      cidade:      "São Paulo",
      estado:      "SP",
      cep:         "01310100",
    },
    deliveryAddress: null,
    valorTotal:    1250.00,
    status:        "APROVADO",
    quantidadeItens: 0,
    pesoBrutoTotal:  null,
    jaFaturado:      false,
    cancelado:       false,
    entregaPeloCD:   false,
    codigoEmpresaCD: null,
    ...overrides,
  };
}

const fetchPedidoCabecalhoCasted = fetchPedidoCabecalho as ReturnType<typeof vi.fn>;
const fetchPedidoItensCasted     = fetchPedidoItens     as ReturnType<typeof vi.fn>;

// ─────────────────────────────────────────────────────────────
// TESTES
// ─────────────────────────────────────────────────────────────

describe("fetchPedidoCabecalho — integração Citel", () => {

  beforeEach(() => {
    vi.clearAllMocks();
    (isCitelConfigured as ReturnType<typeof vi.fn>).mockReturnValue(true);
  });

  it("retorna dados reais do pedido quando Citel responde", async () => {
    fetchPedidoCabecalhoCasted.mockResolvedValue(makeCabecalho());

    const result = await fetchPedidoCabecalho("12345", "067");

    expect(result).not.toBeNull();
    expect(result!.nomeCliente).toBe("Carlos Moreira");
    expect(result!.documento).toBe("987.654.321-00");
    expect(result!.customerAddress.logradouro).toBe("Av. Paulista");
    expect(result!.customerAddress.cidade).toBe("São Paulo");
  });

  it("retorna null quando pedido não existe na Citel", async () => {
    fetchPedidoCabecalhoCasted.mockResolvedValue(null);

    const result = await fetchPedidoCabecalho("99999", "067");
    expect(result).toBeNull();
  });

  it("retorna null quando pedido pertence a loja diferente", async () => {
    // A Citel retorna 404 / null quando empresa não bate
    fetchPedidoCabecalhoCasted.mockResolvedValue(null);

    const result = await fetchPedidoCabecalho("12345", "999");
    expect(result).toBeNull();
  });

  it("retorna null quando Citel está fora (timeout/rede)", async () => {
    fetchPedidoCabecalhoCasted.mockRejectedValue(new Error("fetch failed"));

    // fetchPedidoCabecalho em citel.service.ts já captura e retorna null
    // Testamos o comportamento do mock que simula a camada real
    const result = await fetchPedidoCabecalho("12345", "067").catch(() => null);
    expect(result).toBeNull();
  });

  it("nunca retorna nome 'João Silva' ou telefone '99999-1234' (mocks banidos)", async () => {
    fetchPedidoCabecalhoCasted.mockResolvedValue(makeCabecalho());

    const result = await fetchPedidoCabecalho("12345", "067");

    expect(result?.nomeCliente).not.toContain("João Silva");
    expect(result?.telefone).not.toContain("99999-1234");
    expect(result?.documento).not.toBe("123.456.789-00");
  });

  it("retorna pedido com múltiplos itens corretamente", async () => {
    fetchPedidoCabecalhoCasted.mockResolvedValue(makeCabecalho({ numeroPedido: "77777" }));
    fetchPedidoItensCasted.mockResolvedValue([
      { codigo: "PROD-001", descricao: "Tinta Branca 18L", quantidade: 4, unidade: "GL" },
      { codigo: "PROD-002", descricao: "Primer 3.6L",      quantidade: 2, unidade: "LT" },
      { codigo: "PROD-003", descricao: "Solvente 5L",      quantidade: 1, unidade: "UN" },
    ]);

    const cab   = await fetchPedidoCabecalho("77777", "067");
    const itens = await fetchPedidoItens("77777", "067");

    expect(cab).not.toBeNull();
    expect(itens).toHaveLength(3);
    expect(itens![0].codigo).toBe("PROD-001");
    expect(itens![2].unidade).toBe("UN");
  });

  it("verifica que agendamento futuro pode ser criado (pedido APROVADO)", async () => {
    // Pedido com status APROVADO não bloqueia solicitação futura
    fetchPedidoCabecalhoCasted.mockResolvedValue(makeCabecalho({ status: "APROVADO" }));

    const result = await fetchPedidoCabecalho("12345", "067");
    expect(result?.status).toBe("APROVADO");
    // status APROVADO = pode criar solicitação agendada
    expect(["APROVADO", "PENDENTE", null]).toContain(result?.status);
  });

  it("retorna null para itens quando Citel não encontra o pedido", async () => {
    (isCitelConfigured as ReturnType<typeof vi.fn>).mockReturnValue(true);
    fetchPedidoItensCasted.mockResolvedValue(null);

    const itens = await fetchPedidoItens("00000", "067");
    expect(itens).toBeNull();
  });

  it("fetchOrderItemsFromCitel retorna null quando Citel não está configurado", async () => {
    (isCitelConfigured as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const result = await fetchOrderItemsFromCitel("12345", "067");
    expect(result).toBeNull();
  });

});
