// ──────────────────────────────────────────────
// CONSULTA DE FATURAMENTO PD → NF NO CITEL/AUTCOM
//
// Usa Basic Auth (CITEL_LOGIN:CITEL_SENHA) — não precisa de JWT.
// codigoEmpresa = store.code (ex: "067", "132") — mapeamento 1:1.
// Endpoint canônico: GET /consultapedidovenda/{numPad}/PD/{empresa}
// Número do PD precisa de zero-padding (12 dígitos).
// ──────────────────────────────────────────────

import { normalizeCitelDocumentNumber } from "./citel.service";

// O endpoint /consultapedidovenda fica em CITEL_PD_URL (porta 25049),
// não em CITEL_API_URL. Mantemos compat com PD_URL antigo.
const PD_URL      = process.env.CITEL_PD_URL    ?? process.env.CITEL_API_URL ?? "";
const CITEL_LOGIN = process.env.CITEL_LOGIN     ?? "";
const CITEL_SENHA = process.env.CITEL_SENHA     ?? "";

function basicAuthHeader(): string {
  const creds = Buffer.from(`${CITEL_LOGIN}:${CITEL_SENHA}`).toString("base64");
  return `Basic ${creds}`;
}

function isConfigured(): boolean {
  return Boolean(PD_URL && CITEL_LOGIN && CITEL_SENHA);
}

// ──────────────────────────────────────────────
// TIPOS
// ──────────────────────────────────────────────

export interface CitelItemFaturado {
  codigoProduto:      string;
  jaFaturado:         boolean;
  numeroFaturamento:  string | null;  // número da NF
  empresaFaturamento: string | null;  // store.code da loja emissora
  especieFaturamento: string | null;
  serieFaturamento:   string | null;
  chaveAcesso:        string | null;  // chave NFe 44 dígitos
  dataFaturamento:    string | null;
}

export interface CitelPedidoFaturamento {
  numeroDocumento: string;
  codigoEmpresa:   string;
  jaFaturado:      boolean;
  cancelado:       boolean;
  itens:           CitelItemFaturado[];
}

export interface PedidoFaturadoBatch {
  numeroDocumento: string;
  codigoEmpresa:   string;
  jaFaturado:      boolean;
  itens:           CitelItemFaturado[];
}

// ──────────────────────────────────────────────
// CONSULTA INDIVIDUAL — um PD específico
// GET /consultapedidovenda/{numPad}/PD/{empresa}
//
// O Autcom armazena documentos com zeros à esquerda (12 dígitos).
// Sem padding o servidor responde {cancelado:true, pedido:null} (bug do servidor),
// que NÃO é cancelamento real — apenas "não encontrei". Tentamos os candidatos
// gerados por normalizeCitelDocumentNumber().
// ──────────────────────────────────────────────

export async function fetchPedidoFaturamento(
  orderNumber: string,
  storeCode: string
): Promise<CitelPedidoFaturamento | null> {
  if (!isConfigured()) return getMockPedido(orderNumber, storeCode);

  const candidates  = normalizeCitelDocumentNumber(orderNumber);
  const storePadded = String(storeCode).replace(/\D/g, "").padStart(3, "0");

  for (const candidate of candidates) {
    const url = `${PD_URL}/consultapedidovenda/${encodeURIComponent(candidate)}/PD/${encodeURIComponent(storePadded)}`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: basicAuthHeader() },
        signal:  AbortSignal.timeout(10000),
      });
      if (res.status === 404) continue;
      if (!res.ok) {
        console.warn(`[CitelNF] HTTP ${res.status} candidate=${candidate} store=${storePadded}`);
        continue;
      }
      const body = await res.json();
      // {cancelado:true, pedido:null, dadosCancelamento:null} → bug do padding
      const pedido            = body?.pedido;
      const dadosCancelamento = body?.dadosCancelamento;
      const realmenteCancelado = body?.cancelado === true && dadosCancelamento != null;

      if (pedido) return parsePedido(pedido as Record<string, unknown>, realmenteCancelado);
      if (realmenteCancelado) return parsePedido({ numeroDocumento: candidate, codigoEmpresa: storePadded }, true);
      // tenta próximo candidato
    } catch (err) {
      console.warn(`[CitelNF] erro candidate=${candidate}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[CitelNF] NOT_FOUND order=${orderNumber} store=${storeCode}`);
  return null;
}

// ──────────────────────────────────────────────
// CONSULTA BATCH — todos os PDs faturados desde uma data
// GET /consultapedidovenda?codigoEmpresa=X&data-hora=T&ja-faturado=true
// ──────────────────────────────────────────────

export async function fetchPedidosFaturadosBatch(
  storeCode: string,
  since: Date
): Promise<PedidoFaturadoBatch[]> {
  if (!isConfigured()) return getMockBatch(storeCode);

  const dataHora = since.toISOString().replace("T", "T").slice(0, 19); // "2026-05-04T10:00:00"
  const results: PedidoFaturadoBatch[] = [];
  let page = 0;
  const size = 100;

  try {
    while (true) {
      const url = `${PD_URL}/consultapedidovenda?codigoEmpresa=${encodeURIComponent(storeCode)}&data-hora=${encodeURIComponent(dataHora)}&ja-faturado=true&page=${page}&size=${size}`;
      const res  = await fetch(url, {
        headers: { Authorization: basicAuthHeader() },
        signal:  AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        console.error(`[CitelNF] Batch HTTP ${res.status} empresa ${storeCode}`);
        break;
      }

      const body = await res.json();
      const items: unknown[] = body?.content ?? [];

      for (const item of items) {
        const p = item as Record<string, unknown>;
        const pedido = (p.pedido ?? p) as Record<string, unknown>;
        results.push({
          numeroDocumento: String(pedido.numeroDocumento ?? ""),
          codigoEmpresa:   String(pedido.codigoEmpresa  ?? storeCode),
          jaFaturado:      Boolean(pedido.jaFaturado),
          itens:           parseItens(pedido.itens),
        });
      }

      if (body?.last || items.length < size) break;
      page++;
    }
  } catch (err) {
    console.error(`[CitelNF] Erro no batch empresa ${storeCode}:`, err);
  }

  return results;
}

// ──────────────────────────────────────────────
// PARSERS
// ──────────────────────────────────────────────

function parsePedido(
  pedido: Record<string, unknown>,
  cancelado: boolean
): CitelPedidoFaturamento {
  return {
    numeroDocumento: String(pedido.numeroDocumento ?? ""),
    codigoEmpresa:   String(pedido.codigoEmpresa   ?? ""),
    jaFaturado:      Boolean(pedido.jaFaturado),
    cancelado,
    itens:           parseItens(pedido.itens),
  };
}

function parseItens(raw: unknown): CitelItemFaturado[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((i: Record<string, unknown>) => ({
    codigoProduto:      String(i.codigoProduto      ?? ""),
    jaFaturado:         Boolean(i.jaFaturado),
    numeroFaturamento:  (i.numeroFaturamento as string) ?? null,
    empresaFaturamento: (i.empresaFaturamento as string) ?? null,
    especieFaturamento: (i.especieFaturamento as string) ?? null,
    serieFaturamento:   (i.serieFaturamento   as string) ?? null,
    chaveAcesso:        (i.chaveAcesso        as string) ?? null,
    dataFaturamento:    (i.dataFaturamento    as string) ?? null,
  }));
}

// ──────────────────────────────────────────────
// MOCKS DE DESENVOLVIMENTO
// ──────────────────────────────────────────────

function getMockPedido(
  orderNumber: string,
  storeCode: string
): CitelPedidoFaturamento | null {
  // Simula pedido não encontrado para números terminados em "000"
  if (orderNumber.endsWith("000")) return null;

  // Simula faturamento parcial para números terminados em "5"
  const isPartial = orderNumber.endsWith("5");
  // Simula múltiplas NFs para números terminados em "9"
  const isMultiNf = orderNumber.endsWith("9");

  const nfNumero = isMultiNf ? null : `NF${orderNumber}`;

  return {
    numeroDocumento: orderNumber,
    codigoEmpresa:   storeCode,
    jaFaturado:      !isPartial,
    cancelado:       false,
    itens: [
      {
        codigoProduto:      "PROD-001",
        jaFaturado:         true,
        numeroFaturamento:  nfNumero ?? `NF${orderNumber}A`,
        empresaFaturamento: "132",
        especieFaturamento: "NF",
        serieFaturamento:   "001",
        chaveAcesso:        `35260504${orderNumber.padStart(36, "0")}`,
        dataFaturamento:    new Date().toISOString().slice(0, 10),
      },
      {
        codigoProduto:      "PROD-002",
        jaFaturado:         !isPartial,
        numeroFaturamento:  isMultiNf ? `NF${orderNumber}B` : nfNumero,
        empresaFaturamento: isMultiNf ? "067" : "132",
        especieFaturamento: "NF",
        serieFaturamento:   "001",
        chaveAcesso:        isPartial ? null : `35260504${orderNumber.padStart(36, "0")}`,
        dataFaturamento:    isPartial ? null : new Date().toISOString().slice(0, 10),
      },
    ],
  };
}

function getMockBatch(_storeCode: string): PedidoFaturadoBatch[] {
  return [];
}
