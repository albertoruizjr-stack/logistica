// ──────────────────────────────────────────────
// AUTO-VÍNCULO DE TRANSFERÊNCIAS INTERNAS COM PD DO AUTCOM
//
// Quando Jhow cria uma transferência no Autcom, ele gera um PD
// com cliente "ATUAL COMERCIO DE TINTAS E MAT PARA PINTURA LTDA"
// (CNPJ 42194537000180) na loja de ORIGEM. Esse PD é o "PD interno".
//
// Este service busca esses PDs internos na Citel filtrando por:
//   - cliente CNPJ = ATUAL_TINTAS_CNPJ
//   - especieDocumento = "PD"
//   - itens contém o productCode procurado
// ──────────────────────────────────────────────

import { fetchPedidosDesdeData, type CitelPedidoListItem } from "./citel.service";

// ──────────────────────────────────────────────
// CNPJs da Atual Tintas — uma raiz, 5 filiais
//
// A "Atual Tintas" é o grupo. Cada loja é uma empresa separada
// com CNPJ próprio (raiz 42194537, sufixo diferente). Por isso
// o filtro usa PREFIX matching — qualquer CNPJ que comece com
// 42194537 é uma filial da rede.
// ──────────────────────────────────────────────

export const ATUAL_TINTAS_CNPJ_ROOT = "42194537";

// Conhecidos (descoberto via varredura) — para referência humana / logs
export const ATUAL_TINTAS_CNPJS_BY_STORE: Record<string, string> = {
  "067": "42194537000180",  // Portal Morumbi (matriz)
  "131": "42194537000260",  // Chácara Sto Antônio
  "132": "42194537000341",  // Vila Andrade
  "173": "42194537000422",  // Jardim Guedala
  "191": "42194537000503",  // Vila Mascote
};

/** Mantido pra compat — preferir o root pra filtro */
export const ATUAL_TINTAS_CNPJ = ATUAL_TINTAS_CNPJS_BY_STORE["067"];

export interface InternalTransferCandidate {
  numeroDocumento:  string;          // ex: "000000019095"
  codigoEmpresa:    string;          // loja origem ex: "131"
  dataEntrada:      string;          // ex: "2026-05-12"
  cliente:          string;          // nome
  jaFaturado:       boolean;
  itemMatch: {
    codigoProduto:    string;
    descricaoProduto: string;
    quantidade:       number;
    unidade:          string;
  };
}

/**
 * Busca PDs internos da Atual Tintas que contenham o produto informado.
 *
 * @param productCode  código do produto procurado
 * @param sinceDate    "YYYY-MM-DDTHH:mm:ss" (sem timezone). Default: hoje 00:00
 */
export async function findInternalTransferCandidates(
  productCode: string,
  sinceDate?: string,
): Promise<InternalTransferCandidate[]> {
  const since = sinceDate ?? defaultSinceDate();
  const all = await fetchPedidosDesdeData(since);

  return all
    .filter(isAtualTintasPedido)
    .filter(p => !p.cancelado && !p.jaFaturado)
    .flatMap(p => extractMatchingItems(p, productCode));
}

/** Mesma busca, mas pra uma lista de produtos — agrupa por SKU. */
export async function findInternalTransferCandidatesForSkus(
  productCodes: string[],
  sinceDate?: string,
): Promise<Record<string, InternalTransferCandidate[]>> {
  const since = sinceDate ?? defaultSinceDate();
  const all = await fetchPedidosDesdeData(since);
  const atualTintas = all.filter(isAtualTintasPedido).filter(p => !p.cancelado && !p.jaFaturado);

  const result: Record<string, InternalTransferCandidate[]> = {};
  for (const sku of productCodes) {
    result[sku] = atualTintas.flatMap(p => extractMatchingItems(p, sku));
  }
  return result;
}

// ──────────────────────────────────────────────
// VALIDAÇÃO: confere se um PD informado manualmente é válido
// (existe, é da Atual Tintas, contém o produto, está liberado)
// ──────────────────────────────────────────────

import { fetchPedidoCabecalho, fetchPedidoItens } from "./citel.service";

export interface ValidateInternalPdInput {
  numeroPedido: string;
  storeCode:    string;
  productCode:  string;
}

export interface ValidateInternalPdResult {
  ok:            boolean;
  reason?:       string;   // motivo se !ok
  cabecalho?: {
    numeroPedido: string;
    storeCode:    string;
    clienteNome:  string;
    clienteDoc:   string | null;
  };
  itemMatch?: {
    codigoProduto:    string;
    descricaoProduto: string;
    quantidade:       number;
  };
}

/**
 * Auto-match: dado um SKU e a quantidade mínima necessária, devolve o melhor candidato
 * pra vínculo automático. Critérios (combinados com user):
 *   - cliente da rede Atual Tintas (CNPJ raiz)
 *   - especieDocumento = "PD"
 *   - NÃO cancelado
 *   - NÃO já faturado (porque PD faturado já virou NF — não é mais transferência pendente)
 *   - contém o SKU com qty >= minQty (PD pode ter mais que o necessário)
 *
 * Retorna a lista filtrada **ordenada por data desc** (mais recente primeiro).
 * O caller decide: 1 candidato → vincular auto; vários → vincular o primeiro (mais recente).
 */
export async function findAutoLinkCandidates(
  productCode: string,
  minQty: number,
  sinceDate?: string,
): Promise<InternalTransferCandidate[]> {
  const since = sinceDate ?? defaultSinceDate();
  const all = await fetchPedidosDesdeData(since);

  return all
    .filter(p =>
      isAtualTintasPedido(p) &&
      !p.cancelado &&
      !p.jaFaturado &&
      (p.itens ?? []).some(i => i.codigoProduto === productCode && (i.quantidade ?? 0) >= minQty),
    )
    .flatMap(p => extractMatchingItems(p, productCode).filter(c => c.itemMatch.quantidade >= minQty))
    .sort((a, b) => b.dataEntrada.localeCompare(a.dataEntrada));
}

/**
 * Auto-match com FALLBACK por probe: se a listagem da Citel não devolver candidatos
 * (porque PDs recentes às vezes demoram a entrar no índice), explora números
 * sequenciais a partir do último PD conhecido de cada loja.
 *
 * Estratégia:
 *   1. Roda findAutoLinkCandidates (listagem). Se achar, retorna.
 *   2. Pega o maior numeroDocumento conhecido em cada loja (na listagem).
 *   3. Faz probe direto dos PROBE_SIZE números seguintes em cada loja, em paralelo.
 *   4. Filtra os que: existem + Atual Tintas + contêm produto + qty>=min + não cancelado + não faturado.
 *   5. Retorna ordenado por data desc.
 */
const PROBE_SIZE = 40;

export async function findAutoLinkCandidatesWithProbe(
  productCode: string,
  minQty: number,
  sinceDate?: string,
): Promise<InternalTransferCandidate[]> {
  // 1. Listagem primeiro
  const fromListing = await findAutoLinkCandidates(productCode, minQty, sinceDate);
  if (fromListing.length > 0) return fromListing;

  // 2. Sem candidato na listagem → probe sequencial
  const since = sinceDate ?? defaultSinceDate();
  const all = await fetchPedidosDesdeData(since);

  // último número conhecido por loja
  const lastByStore = new Map<string, number>();
  for (const p of all) {
    const num = parseInt(p.numeroDocumento, 10);
    if (Number.isNaN(num)) continue;
    const cur = lastByStore.get(p.codigoEmpresa) ?? 0;
    if (num > cur) lastByStore.set(p.codigoEmpresa, num);
  }

  console.log(`[auto-link probe] últimos números: ${[...lastByStore.entries()].map(([s,n]) => `${s}=${n}`).join(", ")}`);

  // monta lista de (loja, numeroPadded) candidatos
  const tasks: Array<{ storeCode: string; numero: string }> = [];
  for (const [storeCode, last] of lastByStore) {
    for (let offset = 1; offset <= PROBE_SIZE; offset++) {
      tasks.push({ storeCode, numero: String(last + offset).padStart(12, "0") });
    }
  }

  // probe paralelo (concorrência razoável — 10 por vez pra não saturar)
  const results: InternalTransferCandidate[] = [];
  const CHUNK = 10;
  for (let i = 0; i < tasks.length; i += CHUNK) {
    const chunk = tasks.slice(i, i + CHUNK);
    const settled = await Promise.all(chunk.map(async (t) => {
      const r = await validateInternalPd({
        numeroPedido: t.numero,
        storeCode:    t.storeCode,
        productCode,
      }).catch(() => null);
      if (!r?.ok || !r.itemMatch || !r.cabecalho) return null;
      if (r.itemMatch.quantidade < minQty) return null;
      return {
        numeroDocumento: r.cabecalho.numeroPedido,
        codigoEmpresa:   r.cabecalho.storeCode,
        dataEntrada:     new Date().toISOString().slice(0, 10),
        cliente:         r.cabecalho.clienteNome,
        jaFaturado:      false,
        itemMatch: {
          codigoProduto:    r.itemMatch.codigoProduto,
          descricaoProduto: r.itemMatch.descricaoProduto,
          quantidade:       r.itemMatch.quantidade,
          unidade:          "UN",
        },
      } as InternalTransferCandidate;
    }));
    for (const c of settled) if (c) results.push(c);
  }

  console.log(`[auto-link probe] encontrou ${results.length} candidato(s) via probe sequencial pra sku=${productCode}`);
  return results.sort((a, b) => b.dataEntrada.localeCompare(a.dataEntrada));
}

/**
 * Probe direto: o operador digitou o número do PD interno mas não sabe (ou não importa)
 * em qual das 5 lojas ele está. Testa nas 5 em paralelo e retorna a primeira que casa.
 *
 * Critérios para retornar OK:
 *  - PD existe na loja
 *  - Cliente é da rede Atual Tintas (CNPJ inicia com 42194537)
 *  - O PD contém o productCode procurado
 */
const ALL_STORE_CODES = ["067", "131", "132", "173", "191"];

export async function probeInternalPdAcrossStores(
  numeroPedido: string,
  productCode: string,
): Promise<ValidateInternalPdResult> {
  const attempts = await Promise.all(
    ALL_STORE_CODES.map(storeCode =>
      validateInternalPd({ numeroPedido, storeCode, productCode })
        .then(r => ({ storeCode, result: r }))
        .catch(() => ({ storeCode, result: { ok: false, reason: "Erro de rede" } as ValidateInternalPdResult }))
    ),
  );

  // 1ª prioridade: PD encontrado, da Atual Tintas, e com o produto certo
  const ok = attempts.find(a => a.result.ok);
  if (ok) return ok.result;

  // 2ª: pelo menos achou o PD em alguma loja, mas com problema (cliente ou produto)
  const found = attempts.find(a => a.result.cabecalho);
  if (found) return found.result;

  // 3ª: não achou em loja nenhuma
  return {
    ok: false,
    reason: `PD ${numeroPedido} não encontrado em nenhuma das 5 lojas (067/131/132/173/191)`,
  };
}

export async function validateInternalPd(input: ValidateInternalPdInput): Promise<ValidateInternalPdResult> {
  const [cab, items] = await Promise.all([
    fetchPedidoCabecalho(input.numeroPedido, input.storeCode),
    fetchPedidoItens(input.numeroPedido, input.storeCode),
  ]);

  if (!cab) return { ok: false, reason: `PD ${input.numeroPedido} não encontrado na loja ${input.storeCode}` };
  if (!cab.documento?.startsWith(ATUAL_TINTAS_CNPJ_ROOT)) {
    return {
      ok: false,
      reason: `PD não é da Atual Tintas (cliente: ${cab.nomeCliente})`,
      cabecalho: {
        numeroPedido: cab.numeroPedido,
        storeCode:    cab.codigoEmpresa,
        clienteNome:  cab.nomeCliente,
        clienteDoc:   cab.documento,
      },
    };
  }
  if (cab.cancelado) {
    return {
      ok: false,
      reason: `PD ${input.numeroPedido} está cancelado`,
      cabecalho: {
        numeroPedido: cab.numeroPedido,
        storeCode:    cab.codigoEmpresa,
        clienteNome:  cab.nomeCliente,
        clienteDoc:   cab.documento,
      },
    };
  }
  if (cab.jaFaturado) {
    return {
      ok: false,
      reason: `PD ${input.numeroPedido} já foi faturado — não pode mais ser usado como transferência pendente`,
      cabecalho: {
        numeroPedido: cab.numeroPedido,
        storeCode:    cab.codigoEmpresa,
        clienteNome:  cab.nomeCliente,
        clienteDoc:   cab.documento,
      },
    };
  }
  const match = items?.find(i => i.codigo === input.productCode);
  if (!match) {
    return {
      ok: false,
      reason: `PD ${input.numeroPedido} não contém o produto ${input.productCode}`,
      cabecalho: {
        numeroPedido: cab.numeroPedido,
        storeCode:    cab.codigoEmpresa,
        clienteNome:  cab.nomeCliente,
        clienteDoc:   cab.documento,
      },
    };
  }
  return {
    ok: true,
    cabecalho: {
      numeroPedido: cab.numeroPedido,
      storeCode:    cab.codigoEmpresa,
      clienteNome:  cab.nomeCliente,
      clienteDoc:   cab.documento,
    },
    itemMatch: {
      codigoProduto:    match.codigo,
      descricaoProduto: match.descricao,
      quantidade:       match.quantidade,
    },
  };
}

// ──────────────────────────────────────────────
// HELPERS INTERNOS
// ──────────────────────────────────────────────

function isAtualTintasPedido(p: CitelPedidoListItem): boolean {
  const cnpj = p.cliente?.numeroDocumento ?? "";
  return p.especieDocumento === "PD" &&
         cnpj.startsWith(ATUAL_TINTAS_CNPJ_ROOT);
}

function extractMatchingItems(p: CitelPedidoListItem, productCode: string): InternalTransferCandidate[] {
  const matches = (p.itens ?? []).filter(i => i.codigoProduto === productCode);
  return matches.map(m => ({
    numeroDocumento: p.numeroDocumento,
    codigoEmpresa:   p.codigoEmpresa,
    dataEntrada:     p.dataEntrada,
    cliente:         p.cliente?.nome ?? "Atual Tintas",
    jaFaturado:      Boolean(p.jaFaturado),
    itemMatch: {
      codigoProduto:    m.codigoProduto,
      descricaoProduto: m.descricaoProduto,
      quantidade:       m.quantidade,
      unidade:          m.unidadeProduto,
    },
  }));
}

function defaultSinceDate(): string {
  // 7 dias atrás, formato local sem timezone
  const d = new Date();
  d.setDate(d.getDate() - 7);
  d.setHours(0, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00`;
}
