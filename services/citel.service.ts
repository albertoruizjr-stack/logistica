// ──────────────────────────────────────────────
// INTEGRAÇÃO COM O CITEL/AUTCOM
//
// Duas APIs separadas, dois protocolos de auth:
//
//   CITEL_API_URL (porta 25046)
//     ↳ /produtoEstoqueCodigo, /produto/{codigo}
//     ↳ auth: token via GET /OperadorLogar/{login}/{senha}/{empresa}
//
//   CITEL_PD_URL  (porta 25049)
//     ↳ /consultapedidovenda/{numero}/PD/{loja}
//     ↳ auth: HTTP Basic Auth direto (sem token)
//     ↳ retorna { cancelado, pedido: { cliente, enderecoEntrega, itens, ... } }
// ──────────────────────────────────────────────

import type { CitelEstoqueProduto, CitelEstoqueEmpresa, CitelProdutoDetalhe, CitelPedidoCabecalho, CitelEndereco } from "@/types/stock";

const BASE_URL = process.env.CITEL_API_URL ?? "";
const PD_URL = process.env.CITEL_PD_URL ?? "";
const CITEL_LOGIN = process.env.CITEL_LOGIN ?? "";
const CITEL_SENHA = process.env.CITEL_SENHA ?? "";
const CITEL_EMPRESA_BASE = process.env.CITEL_EMPRESA_BASE ?? "1";

// Cache de token em memória — válido por 50 min (Citel expira em ~60 min)
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

// ──────────────────────────────────────────────
// AUTENTICAÇÃO POR TOKEN (estoque / produto)
// ──────────────────────────────────────────────

async function getToken(): Promise<string | null> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  if (!BASE_URL || !CITEL_LOGIN || !CITEL_SENHA) return null;

  try {
    const url = `${BASE_URL}/OperadorLogar/${encodeURIComponent(CITEL_LOGIN)}/${encodeURIComponent(CITEL_SENHA)}/${CITEL_EMPRESA_BASE}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;

    const data = await res.json();
    const token: string | null = data?.token ?? data?.codigoSessao ?? data?.sessao ?? null;
    if (token) {
      cachedToken = token;
      tokenExpiresAt = Date.now() + 50 * 60 * 1000;
    }
    return token;
  } catch {
    return null;
  }
}

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ──────────────────────────────────────────────
// AUTENTICAÇÃO HTTP BASIC (consulta de pedido)
// ──────────────────────────────────────────────

function basicAuthHeader(): Record<string, string> {
  if (!CITEL_LOGIN || !CITEL_SENHA) return {};
  const credentials = Buffer.from(`${CITEL_LOGIN}:${CITEL_SENHA}`).toString("base64");
  return { Authorization: `Basic ${credentials}`, Accept: "application/json" };
}

// ──────────────────────────────────────────────
// CONSULTA DE ESTOQUE — produto único
// (autenticação Basic Auth — protocolo OperadorLogar foi descontinuado)
// ──────────────────────────────────────────────

export async function fetchEstoqueCitel(codigoProduto: string): Promise<CitelEstoqueProduto | null> {
  if (!BASE_URL) return null;
  try {
    const res = await fetch(`${BASE_URL}/produtoEstoqueCodigo/${encodeURIComponent(codigoProduto)}`, {
      headers: basicAuthHeader(),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn(`[citel] fetchEstoqueCitel sku=${codigoProduto} status=${res.status}`);
      return null;
    }
    const data = await res.json();
    // /produtoEstoqueCodigo/{sku} (sem empresa) retorna array
    return Array.isArray(data) ? data[0] ?? null : data;
  } catch (err) {
    console.warn(`[citel] fetchEstoqueCitel sku=${codigoProduto} error:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ──────────────────────────────────────────────
// CONSULTA DE ESTOQUE — batch
// (autenticação Basic Auth)
// ──────────────────────────────────────────────

export async function fetchEstoqueCitelBatch(codigosProdutos: string[], codigosEmpresas: string[]): Promise<CitelEstoqueProduto[]> {
  if (!BASE_URL || codigosProdutos.length === 0) return [];
  try {
    const produtos = codigosProdutos.join(",");
    const empresas = codigosEmpresas.join(",");
    const url = `${BASE_URL}/produtoEstoqueCodigo/${encodeURIComponent(produtos)}/${encodeURIComponent(empresas)}`;
    const res = await fetch(url, {
      headers: basicAuthHeader(),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(`[citel] fetchEstoqueCitelBatch status=${res.status} skus=${codigosProdutos.length} empresas=${empresas}`);
      return [];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [data];
  } catch (err) {
    console.warn(`[citel] fetchEstoqueCitelBatch error:`, err instanceof Error ? err.message : err);
    return [];
  }
}

export function getSaldoForEmpresa(produto: CitelEstoqueProduto, codigoEmpresaCitel: string): CitelEstoqueEmpresa | null {
  return produto.saldoEmpresas?.find((e) => e.codigoEmpresa === codigoEmpresaCitel) ?? null;
}

export async function getSaldoDisponivel(codigoProduto: string, codigoEmpresaCitel: string): Promise<{ saldoDisponivel: number; saldoFisico: number } | null> {
  const produto = await fetchEstoqueCitel(codigoProduto);
  if (!produto) return null;
  const saldo = getSaldoForEmpresa(produto, codigoEmpresaCitel);
  if (!saldo) return null;
  return { saldoDisponivel: saldo.saldoDisponivel, saldoFisico: saldo.saldoFisico };
}

// ──────────────────────────────────────────────
// DETALHE DO PRODUTO
//
// AVISO: o endpoint /produto/{sku} foi descontinuado na Citel.
// Mantido por compatibilidade — sempre retorna null.
// Os dados que ele entregava agora vêm direto do PD:
//   - descrição, peso bruto, unidade → pedido.itens[*]
//   - código de barras, marca → não estão disponíveis (UI deve esconder)
// ──────────────────────────────────────────────

export async function fetchProdutoDetalhe(_codigoProduto: string): Promise<CitelProdutoDetalhe | null> {
  // endpoint /produto/{sku} retorna 404 — confirmado em 2026-05-12.
  return null;
}

function parseProdutoDetalhe(raw: Record<string, unknown>): CitelProdutoDetalhe {
  return {
    codigo:       String(raw.codigo ?? raw.codigoProduto ?? ""),
    descricao:    String(raw.descricao ?? raw.descricaoProduto ?? ""),
    marca:        (raw.marca as string) ?? null,
    unidade:      String(raw.unidade ?? raw.un ?? "UN"),
    codigoBarra:  (raw.codigoBarra ?? raw.ean ?? raw.gtin ?? null) as string | null,
    pesoBruto:    raw.pesoBruto != null ? Number(raw.pesoBruto) : null,
    pesoLiquido:  raw.pesoLiquido != null ? Number(raw.pesoLiquido) : null,
    diasSemVenda: raw.diasSemVenda != null ? Number(raw.diasSemVenda) : null,
    giro:         (raw.giro ?? raw.classificacaoAbc ?? null) as string | null,
    grupo:        (raw.grupo ?? null) as string | null,
    subgrupo:     (raw.subgrupo ?? null) as string | null,
  };
}

// ──────────────────────────────────────────────
// NORMALIZAÇÃO DE NÚMERO DE PEDIDO
//
// O Autcom armazena documentos com zeros à esquerda
// (ex: 717081 → 000000717081). Gera variações a tentar.
// ──────────────────────────────────────────────

export function normalizeCitelDocumentNumber(input: string): string[] {
  const digits = input.replace(/\D/g, "");
  if (!digits) return [input.trim()];
  const candidates = new Set<string>();
  candidates.add(digits);
  for (const len of [12, 11, 10]) {
    if (digits.length <= len) candidates.add(digits.padStart(len, "0"));
  }
  return [...candidates];
}

// ──────────────────────────────────────────────
// CONSULTA DE PEDIDO DE VENDA (PD)
//
// GET /consultapedidovenda/{numero}/PD/{loja}
// auth: HTTP Basic
// retorna { cancelado: bool, pedido: {...}, dadosCancelamento: null }
// ──────────────────────────────────────────────

interface CitelPedidoRaw {
  cancelado?: boolean;
  pedido?: Record<string, unknown> | null;
  dadosCancelamento?: Record<string, unknown> | null;
}

async function fetchConsultaPedidoRaw(orderNumber: string, storeCode: string): Promise<CitelPedidoRaw | null> {
  if (!PD_URL) {
    console.warn("[citel] fetchConsultaPedidoRaw missing CITEL_PD_URL");
    return null;
  }
  const candidates = normalizeCitelDocumentNumber(orderNumber);
  const headers = basicAuthHeader();

  for (const candidate of candidates) {
    const url = `${PD_URL}/consultapedidovenda/${encodeURIComponent(candidate)}/PD/${encodeURIComponent(storeCode)}`;
    console.log(`[citel] consultapedidovenda trying=${candidate} store=${storeCode}`);

    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      console.log(`[citel] consultapedidovenda candidate=${candidate} status=${res.status}`);

      if (!res.ok) continue;

      const raw = (await res.json()) as CitelPedidoRaw;

      // API tem um bug: número não-paddado retorna 200 com {cancelado:true, pedido:null}
      // — isso NÃO é cancelamento, é "não encontrei". Só aceitamos quando vier pedido válido,
      // OU quando vier cancelado=true com dadosCancelamento preenchido (cancelamento real).
      if (raw?.pedido) {
        console.log(`[citel] consultapedidovenda FOUND canonical=${candidate}`);
        return raw;
      }
      if (raw?.cancelado && raw?.dadosCancelamento) {
        console.log(`[citel] consultapedidovenda CANCELLED canonical=${candidate}`);
        return raw;
      }
      // {cancelado:true, pedido:null, dadosCancelamento:null} → bug do padding, tenta próximo
    } catch (err) {
      console.warn(`[citel] consultapedidovenda candidate=${candidate} error:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[citel] consultapedidovenda NOT_FOUND order=${orderNumber} store=${storeCode}`);
  return null;
}

// Cache de payload bruto por (orderNumber, storeCode) — válido só dentro do mesmo request.
// Evita que fetchPedidoCabecalho e fetchPedidoItens façam 2 chamadas ao Citel.
const rawCache = new Map<string, { at: number; raw: CitelPedidoRaw | null }>();
const RAW_CACHE_TTL_MS = 8000;

async function getConsultaPedidoCached(orderNumber: string, storeCode: string): Promise<CitelPedidoRaw | null> {
  const key = `${orderNumber}::${storeCode}`;
  const hit = rawCache.get(key);
  if (hit && Date.now() - hit.at < RAW_CACHE_TTL_MS) return hit.raw;

  const raw = await fetchConsultaPedidoRaw(orderNumber, storeCode);
  rawCache.set(key, { at: Date.now(), raw });
  // limpa entradas velhas pra não vazar memória
  if (rawCache.size > 50) {
    const cutoff = Date.now() - RAW_CACHE_TTL_MS;
    for (const [k, v] of rawCache) if (v.at < cutoff) rawCache.delete(k);
  }
  return raw;
}

// ──────────────────────────────────────────────
// CABEÇALHO DE PEDIDO — exposto à app
// ──────────────────────────────────────────────

export async function fetchPedidoCabecalho(orderNumber: string, storeCode: string): Promise<CitelPedidoCabecalho | null> {
  const raw = await getConsultaPedidoCached(orderNumber, storeCode);
  if (!raw?.pedido) return null;
  return parsePedidoCabecalho(raw, orderNumber, storeCode);
}

// ──────────────────────────────────────────────
// ITENS DO PEDIDO — reaproveita a mesma chamada
// ──────────────────────────────────────────────

export interface CitelPedidoItemBasic {
  codigo:     string;
  descricao:  string;
  quantidade: number;
  unidade:    string;
  /**
   * Peso bruto unitário (kg) do item neste PD, conforme a Citel devolveu.
   * É a fonte primária — vem direto do pedido oficial. Se null,
   * o consumidor pode tentar buscar via fetchProdutoDetalhe (porta 25046).
   */
  pesoBruto:  number | null;
}

export async function fetchPedidoItens(
  orderNumber: string,
  storeCode: string,
): Promise<CitelPedidoItemBasic[] | null> {
  const raw = await getConsultaPedidoCached(orderNumber, storeCode);
  const pedido = raw?.pedido as Record<string, unknown> | undefined;
  if (!pedido) return null;

  const items: unknown[] = Array.isArray(pedido.itens) ? (pedido.itens as unknown[]) : [];
  const parsed = items.map((i) => {
    const item = i as Record<string, unknown>;
    const peso = item.pesoBruto;
    return {
      codigo:     String(item.codigoProduto ?? item.codigo ?? ""),
      descricao:  String(item.descricaoProduto ?? item.descricao ?? ""),
      quantidade: Number(item.quantidade ?? 0),
      unidade:    extractUnitLabel(item),
      pesoBruto:  peso != null && peso !== "" ? Number(peso) : null,
    };
  }).filter((i) => i.codigo);

  return parsed;
}

/**
 * Extrai a unidade legível do item da Citel.
 * `unidadeProduto` às vezes vem como código numérico ("01", "06").
 * `quantidadeEmbalagemUnitario` tem formato "{qtd} {label} / {extra}" (ex: "50.00 PECAS / UN").
 * Preferimos a label legível e voltamos pro código só se nenhuma estiver disponível.
 */
function extractUnitLabel(item: Record<string, unknown>): string {
  const codigo = String(item.unidadeProduto ?? item.unidade ?? "").trim();
  const isNumericCode = /^\d+$/.test(codigo);

  // se já é letra (UN, GL, BD, LT, SC, etc.) e não é numérico, usa direto
  if (codigo && !isNumericCode) return codigo;

  // tenta extrair label de "50.00 PECAS / UN" ou "2.00 QUARTO"
  const emb = String(item.quantidadeEmbalagemUnitario ?? "").trim();
  const match = emb.match(/^[\d.,]+\s+([A-Za-zÀ-ÿ/ ]+?)(?:\s*\/.*)?$/);
  if (match) {
    const label = match[1].trim();
    // pega só a primeira "palavra" pra ficar curta (PECAS, QUARTO, etc.)
    return label.split(/\s+/)[0].toUpperCase();
  }

  return codigo || "UN";
}

// ──────────────────────────────────────────────
// PARSERS — endereço e cabeçalho
// ──────────────────────────────────────────────

const str = (v: unknown) => (v != null ? String(v).trim() : null);
const num = (v: unknown) => (v != null && v !== "" ? Number(v) : null);

/** O campo "endereco" da Citel vem como "RUA X, 1200". Separa rua e número. */
function splitLogradouroNumero(endereco: string): { logradouro: string; numero: string | null } {
  const match = endereco.match(/^(.+),\s*(\S+)\s*$/);
  if (match) return { logradouro: match[1].trim(), numero: match[2].trim() };
  return { logradouro: endereco, numero: null };
}

function parseClienteEndereco(cliente: Record<string, unknown>): CitelEndereco {
  const enderecoFull = str(cliente.endereco) ?? "";
  const numeroCadastro = str(cliente.numero);

  // se "numero" veio separado no JSON, usa ele; senão tenta extrair de "endereco"
  let logradouro = enderecoFull;
  let numero = numeroCadastro;
  if (!numero && enderecoFull.includes(",")) {
    const split = splitLogradouroNumero(enderecoFull);
    logradouro = split.logradouro;
    numero = split.numero;
  }

  const cidade = (cliente.cidade as Record<string, unknown>) ?? {};
  return {
    logradouro,
    numero,
    complemento: str(cliente.complemento),
    bairro:      str(cliente.bairro),
    cidade:      str(cidade.nomeCidade) ?? "",
    estado:      str(cidade.siglaEstado) ?? "",
    cep:         str(cliente.cep)?.replace(/\D/g, "") ?? null,
  };
}

function parseEnderecoEntrega(enderecoEntrega: Record<string, unknown> | undefined | null): CitelEndereco | null {
  if (!enderecoEntrega || typeof enderecoEntrega !== "object") return null;

  const enderecoFull = str(enderecoEntrega.endereco) ?? "";
  if (!enderecoFull) return null;

  const split = enderecoFull.includes(",") ? splitLogradouroNumero(enderecoFull) : { logradouro: enderecoFull, numero: null };
  const cidade = (enderecoEntrega.cidade as Record<string, unknown>) ?? {};

  return {
    logradouro:  split.logradouro,
    numero:      split.numero,
    complemento: str(enderecoEntrega.complemento),
    bairro:      str(enderecoEntrega.bairro),
    cidade:      str(cidade.nomeCidade) ?? "",
    estado:      str(cidade.siglaEstado) ?? "",
    cep:         str(enderecoEntrega.cep)?.replace(/\D/g, "") ?? null,
  };
}

function parsePedidoCabecalho(raw: CitelPedidoRaw, orderNumber: string, storeCode: string): CitelPedidoCabecalho {
  const pedido = (raw.pedido ?? {}) as Record<string, unknown>;
  const cliente = (pedido.cliente as Record<string, unknown>) ?? {};
  const enderecoEntrega = pedido.enderecoEntrega as Record<string, unknown> | undefined;
  const itens = Array.isArray(pedido.itens) ? (pedido.itens as unknown[]) : [];

  return {
    numeroPedido:    str(pedido.numeroDocumento) ?? orderNumber,
    codigoEmpresa:   str(pedido.codigoEmpresa) ?? storeCode,
    nomeCliente:     str(cliente.nome) ?? str(cliente.fantasiaSobrenome) ?? "",
    documento:       str(cliente.numeroDocumento),
    telefone:        str(cliente.telefone1) ?? str(cliente.telefone2),
    celular:         str(cliente.telefoneCelular),
    email:           str(cliente.email)?.replace(/;$/, "") ?? null,
    customerAddress: parseClienteEndereco(cliente),
    deliveryAddress: parseEnderecoEntrega(enderecoEntrega),
    valorTotal:      num(pedido.valorContabil) ?? num(pedido.totalProdutos),
    status:          str(pedido.statusPedido) ?? (raw.cancelado ? "CANCELADO" : null),
    quantidadeItens: itens.length,
    pesoBrutoTotal:  num(pedido.pesoBruto),
    jaFaturado:      Boolean(pedido.jaFaturado),
    cancelado:       Boolean(raw.cancelado),
    entregaPeloCD:   Boolean(pedido.entregaPeloCD),
    codigoEmpresaCD: str(pedido.codigoEmpresaCD),
  };
}

export function isCitelConfigured(): boolean {
  return Boolean(BASE_URL && CITEL_LOGIN && CITEL_SENHA);
}

export function isCitelPedidoConfigured(): boolean {
  return Boolean(PD_URL && CITEL_LOGIN && CITEL_SENHA);
}

// ──────────────────────────────────────────────
// CONSULTA DE PEDIDOS POR DATA — endpoint paginado
// GET /consultapedidovenda?data-hora=YYYY-MM-DDTHH:mm:ss
// Retorna PDs e OR (orçamentos) de todas as lojas a partir da data informada.
// Usado pra encontrar transferências internas (cliente Atual Tintas).
// ──────────────────────────────────────────────

export interface CitelPedidoListItem {
  numeroDocumento:    string;
  especieDocumento:   "PD" | "OR" | string;
  codigoEmpresa:      string;     // loja origem
  dataEntrada:        string;
  cliente?: {
    nome?:            string;
    numeroDocumento?: string;     // CNPJ
  } | null;
  itens?: Array<{
    codigoProduto:    string;
    descricaoProduto: string;
    quantidade:       number;
    unidadeProduto:   string;
    pesoBruto?:       number;
  }>;
  jaFaturado?:        boolean;
  cancelado?:         boolean;
  pedidoLiberado?:    boolean;
}

interface CitelPedidoListResponse {
  content?:  CitelPedidoListItem[];
  totalElements?: number;
  totalPages?:    number;
}

/**
 * Lista PDs/OR no Citel a partir de uma data. Endpoint paginado.
 * @param dataHoraDesde ISO local sem timezone (ex: "2026-05-12T00:00:00")
 */
export async function fetchPedidosDesdeData(dataHoraDesde: string): Promise<CitelPedidoListItem[]> {
  if (!PD_URL) return [];
  const url = `${PD_URL}/consultapedidovenda?data-hora=${encodeURIComponent(dataHoraDesde)}`;
  try {
    const res = await fetch(url, {
      headers: basicAuthHeader(),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(`[citel] fetchPedidosDesdeData status=${res.status}`);
      return [];
    }
    const json = (await res.json()) as CitelPedidoListResponse | CitelPedidoListItem[];
    return Array.isArray(json) ? json : (json.content ?? []);
  } catch (err) {
    console.warn(`[citel] fetchPedidosDesdeData error:`, err instanceof Error ? err.message : err);
    return [];
  }
}

/** Uso interno — apenas em testes. Limpa o cache de payloads brutos. */
export function __clearCitelPedidoCache(): void {
  rawCache.clear();
}
