import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { normalizeCitelDocumentNumber } from "@/services/citel.service";

// ─────────────────────────────────────────────────────────────
// TESTES — normalizeCitelDocumentNumber (função pura, sem mocks)
// ─────────────────────────────────────────────────────────────

describe("normalizeCitelDocumentNumber", () => {
  it("gera variação com 12 dígitos (formato padrão Autcom)", () => {
    expect(normalizeCitelDocumentNumber("717081")).toContain("000000717081");
  });

  it("input 717081 gera candidato correto para o caso real", () => {
    const candidates = normalizeCitelDocumentNumber("717081");
    expect(candidates).toContain("000000717081");
    expect(candidates).toContain("717081");
  });

  it("input já com 12 dígitos não gera duplicata", () => {
    const candidates = normalizeCitelDocumentNumber("000000717081");
    const unique = new Set(candidates);
    expect(unique.size).toBe(candidates.length);
    expect(candidates).toContain("000000717081");
  });

  it("remove caracteres não numéricos antes de normalizar", () => {
    const candidates = normalizeCitelDocumentNumber("  71-70.81 ");
    expect(candidates).toContain("717081");
    expect(candidates).toContain("000000717081");
  });

  it("gera variações com 10, 11 e 12 dígitos para número curto", () => {
    const candidates = normalizeCitelDocumentNumber("717081");
    expect(candidates).toContain("0000717081");
    expect(candidates).toContain("00000717081");
    expect(candidates).toContain("000000717081");
  });

  it("número com 11 dígitos gera apenas 12 (não encurta o original)", () => {
    const candidates = normalizeCitelDocumentNumber("00000717081");
    expect(candidates).toContain("000000717081");
    expect(candidates).not.toContain("0717081");
  });
});

// ─────────────────────────────────────────────────────────────
// TESTES — fetchPedidoCabecalho / fetchPedidoItens
//
// API real: GET /consultapedidovenda/{numPad}/PD/{loja}
// Auth: HTTP Basic (sem OperadorLogar)
// Response: { cancelado, pedido: { cliente, enderecoEntrega, itens, ... } }
// ─────────────────────────────────────────────────────────────

// Payload baseado no JSON real retornado pelo PD 717081 / loja 067
const REAL_PEDIDO_PAYLOAD = {
  cancelado: false,
  pedido: {
    numeroDocumento: "000000717081",
    codigoEmpresa:   "067",
    statusPedido:    null,
    valorContabil:   114,
    totalProdutos:   114,
    pesoBruto:       3.48,
    pesoLiquido:     2.6,
    jaFaturado:      false,
    pedidoLiberado:  true,
    cliente: {
      nome:            "COND OURO PRETO E SABARA",
      fantasiaSobrenome: "COD OURO PRETO E SABARA",
      numeroDocumento: "54071154000101",
      tipoDocumento:   1,
      telefone1:       "11 37425010",
      telefone2:       "",
      telefoneCelular: "11 31451322",
      email:           "ouropretoesabara@uol.com.br;",
      endereco:        "RUA MANOEL ANTÔNIO PINTO",
      numero:          "1200",
      complemento:     "",
      bairro:          "PARAISÓPOLIS",
      cep:             "05663020",
      cidade: {
        nomeCidade:  "SÃO PAULO",
        siglaEstado: "SP",
      },
    },
    enderecoEntrega: {
      endereco: "RUA MANOEL ANTÔNIO PINTO, 1200",
      bairro:   "PARAISÓPOLIS",
      cep:      "05663020",
      cidade: {
        nomeCidade:  "SÃO PAULO",
        siglaEstado: "SP",
      },
    },
    itens: [
      {
        codigoProduto:    "21330",
        descricaoProduto: "MAZA MOCOCA MASSA PARA MADEIRA MOGNO 1,3KG",
        quantidade:       2,
        unidadeProduto:   "01",
        pesoBruto:        2.6,
      },
      {
        codigoProduto:    "02992",
        descricaoProduto: "FITA ZEBRADA 70X200 ADERE",
        quantidade:       2,
        unidadeProduto:   "UN",
        pesoBruto:        0.88,
      },
    ],
  },
  dadosCancelamento: null,
};

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
function notFound() { return new Response(null, { status: 404 }); }

// Bug da API: número sem padding retorna 200 com { cancelado:true, pedido:null }
function paddingBugResponse() {
  return ok({ cancelado: true, pedido: null, dadosCancelamento: null });
}

type CitelService = typeof import("@/services/citel.service");

describe("fetchPedidoCabecalho — caso real (PD 717081 / loja 067)", () => {
  let svc: CitelService;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    vi.resetModules();
    vi.stubEnv("CITEL_API_URL", "http://citel.test:25046");
    vi.stubEnv("CITEL_PD_URL",  "http://citel.test:25049");
    vi.stubEnv("CITEL_LOGIN",   "user");
    vi.stubEnv("CITEL_SENHA",   "pass");
    svc = await import("@/services/citel.service");
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    svc.__clearCitelPedidoCache();
  });

  afterEach(() => fetchSpy.mockRestore());

  it("encontra o pedido usando o candidato com 12 dígitos (padding)", async () => {
    fetchSpy.mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/consultapedidovenda/000000717081/PD/067")) return ok(REAL_PEDIDO_PAYLOAD);
      return notFound();
    });

    const result = await svc.fetchPedidoCabecalho("717081", "067");

    expect(result).not.toBeNull();
    expect(result!.numeroPedido).toBe("000000717081");
    expect(result!.codigoEmpresa).toBe("067");
    expect(result!.nomeCliente).toBe("COND OURO PRETO E SABARA");
    expect(result!.documento).toBe("54071154000101");
    expect(result!.telefone).toBe("11 37425010");
    expect(result!.celular).toBe("11 31451322");
    expect(result!.email).toBe("ouropretoesabara@uol.com.br");
    expect(result!.valorTotal).toBe(114);
    expect(result!.quantidadeItens).toBe(2);
    expect(result!.pesoBrutoTotal).toBe(3.48);
    expect(result!.jaFaturado).toBe(false);
    expect(result!.cancelado).toBe(false);
  });

  it("preenche o endereço do cliente corretamente", async () => {
    fetchSpy.mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/consultapedidovenda/000000717081/PD/067")) return ok(REAL_PEDIDO_PAYLOAD);
      return notFound();
    });

    const result = await svc.fetchPedidoCabecalho("717081", "067");

    expect(result!.customerAddress.logradouro).toBe("RUA MANOEL ANTÔNIO PINTO");
    expect(result!.customerAddress.numero).toBe("1200");
    expect(result!.customerAddress.bairro).toBe("PARAISÓPOLIS");
    expect(result!.customerAddress.cidade).toBe("SÃO PAULO");
    expect(result!.customerAddress.estado).toBe("SP");
    expect(result!.customerAddress.cep).toBe("05663020");
  });

  it("preenche o endereço de entrega separando logradouro e número", async () => {
    fetchSpy.mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/consultapedidovenda/000000717081/PD/067")) return ok(REAL_PEDIDO_PAYLOAD);
      return notFound();
    });

    const result = await svc.fetchPedidoCabecalho("717081", "067");

    expect(result!.deliveryAddress).not.toBeNull();
    expect(result!.deliveryAddress!.logradouro).toBe("RUA MANOEL ANTÔNIO PINTO");
    expect(result!.deliveryAddress!.numero).toBe("1200");
    expect(result!.deliveryAddress!.bairro).toBe("PARAISÓPOLIS");
    expect(result!.deliveryAddress!.cidade).toBe("SÃO PAULO");
    expect(result!.deliveryAddress!.estado).toBe("SP");
  });

  it("usa Basic Auth no header (não Bearer)", async () => {
    fetchSpy.mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/consultapedidovenda/000000717081/PD/067")) return ok(REAL_PEDIDO_PAYLOAD);
      return notFound();
    });

    await svc.fetchPedidoCabecalho("717081", "067");

    const consultaCall = fetchSpy.mock.calls.find(([u]: [unknown]) => String(u).includes("/consultapedidovenda/"));
    expect(consultaCall).toBeDefined();
    const headers = (consultaCall![1] as RequestInit | undefined)?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toMatch(/^Basic /);
  });

  it("nunca chama o endpoint /OperadorLogar/ na consulta de pedido", async () => {
    fetchSpy.mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/consultapedidovenda/000000717081/PD/067")) return ok(REAL_PEDIDO_PAYLOAD);
      return notFound();
    });

    await svc.fetchPedidoCabecalho("717081", "067");

    const operadorCall = fetchSpy.mock.calls.find(([u]: [unknown]) => String(u).includes("/OperadorLogar/"));
    expect(operadorCall).toBeUndefined();
  });
});

describe("fetchPedidoCabecalho — bug do padding", () => {
  let svc: CitelService;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    vi.resetModules();
    vi.stubEnv("CITEL_API_URL", "http://citel.test:25046");
    vi.stubEnv("CITEL_PD_URL",  "http://citel.test:25049");
    vi.stubEnv("CITEL_LOGIN",   "user");
    vi.stubEnv("CITEL_SENHA",   "pass");
    svc = await import("@/services/citel.service");
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    svc.__clearCitelPedidoCache();
  });

  afterEach(() => fetchSpy.mockRestore());

  it("ignora {cancelado:true, pedido:null} e tenta o próximo candidato", async () => {
    fetchSpy.mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/consultapedidovenda/717081/PD/067")) return paddingBugResponse();
      if (u.includes("/consultapedidovenda/000000717081/PD/067")) return ok(REAL_PEDIDO_PAYLOAD);
      return notFound();
    });

    const result = await svc.fetchPedidoCabecalho("717081", "067");

    expect(result).not.toBeNull();
    expect(result!.nomeCliente).toBe("COND OURO PRETO E SABARA");
  });

  it("retorna null quando pedido não existe em loja nenhuma", async () => {
    fetchSpy.mockImplementation(async () => notFound());

    const result = await svc.fetchPedidoCabecalho("999999", "067");
    expect(result).toBeNull();
  });

  it("retorna null quando Citel está fora (network error)", async () => {
    fetchSpy.mockImplementation(async () => { throw new Error("ECONNREFUSED"); });

    const result = await svc.fetchPedidoCabecalho("717081", "067");
    expect(result).toBeNull();
  });
});

describe("fetchPedidoItens — reaproveita response do cabeçalho", () => {
  let svc: CitelService;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    vi.resetModules();
    vi.stubEnv("CITEL_API_URL", "http://citel.test:25046");
    vi.stubEnv("CITEL_PD_URL",  "http://citel.test:25049");
    vi.stubEnv("CITEL_LOGIN",   "user");
    vi.stubEnv("CITEL_SENHA",   "pass");
    svc = await import("@/services/citel.service");
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    svc.__clearCitelPedidoCache();
  });

  afterEach(() => fetchSpy.mockRestore());

  it("extrai itens do mesmo response do cabeçalho", async () => {
    fetchSpy.mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/consultapedidovenda/000000717081/PD/067")) return ok(REAL_PEDIDO_PAYLOAD);
      return notFound();
    });

    const items = await svc.fetchPedidoItens("717081", "067");

    expect(items).not.toBeNull();
    expect(items).toHaveLength(2);
    expect(items![0].codigo).toBe("21330");
    expect(items![0].descricao).toBe("MAZA MOCOCA MASSA PARA MADEIRA MOGNO 1,3KG");
    expect(items![0].quantidade).toBe(2);
    expect(items![1].codigo).toBe("02992");
  });

  it("não chama nenhum endpoint /itens/ separado", async () => {
    fetchSpy.mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/consultapedidovenda/000000717081/PD/067")) return ok(REAL_PEDIDO_PAYLOAD);
      return notFound();
    });

    await svc.fetchPedidoItens("717081", "067");

    const itemsCall = fetchSpy.mock.calls.find(([u]: [unknown]) => String(u).includes("/itens/"));
    expect(itemsCall).toBeUndefined();
  });
});
