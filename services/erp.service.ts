// ──────────────────────────────────────────────
// SERVIÇO DE INTEGRAÇÃO COM ERP LEGADO
//
// CONSULTA DE NF (`fetchInvoiceFromERP`):
//   Citel/Autcom não tem endpoint público "buscar por NF". A estratégia
//   é varrer pedidos faturados nos últimos 15 dias da loja informada
//   (via `fetchPedidosFaturadosBatch`) e filtrar localmente pelo
//   `numeroFaturamento`. Quando acha, busca o cabeçalho do PD pra
//   pegar cliente + endereço de entrega + itens com descrição.
//
// CONSULTA DE PD/ESTOQUE (`fetchOrderFromERP`/`fetchStockFromERP`):
//   Mantida em ERP_API_URL/ERP_API_KEY (legado). Retorna null se não
//   configurado — sem mocks em produção.
// ──────────────────────────────────────────────

import type { ERPInvoice, ERPOrder, ERPStockByStore } from "@/types";
import { fetchInvoiceByNumber } from "./citel-nf.service";
import { fetchPedidoCabecalho, fetchPedidoItens } from "./citel.service";

interface ERPConfig {
  apiUrl: string;
  apiKey: string;
}

function getConfig(): ERPConfig | null {
  const apiUrl = process.env.ERP_API_URL;
  const apiKey = process.env.ERP_API_KEY;
  if (!apiUrl || !apiKey) return null;
  return { apiUrl, apiKey };
}

// ──────────────────────────────────────────────
// CONSULTA DE NOTA FISCAL — via Citel
// ──────────────────────────────────────────────

export async function fetchInvoiceFromERP(
  invoiceNumber: string,
  storeCode: string,
): Promise<ERPInvoice | null> {
  if (!invoiceNumber || !storeCode) return null;

  // 1) Localiza qual PD originou essa NF (varrendo batch faturado da loja)
  const lookup = await fetchInvoiceByNumber(invoiceNumber, storeCode);
  if (!lookup) return null;

  // 2) Busca dados completos do PD: cliente, endereço, itens
  const [cabecalho, itens] = await Promise.all([
    fetchPedidoCabecalho(lookup.orderNumber, lookup.storeCode),
    fetchPedidoItens(lookup.orderNumber, lookup.storeCode),
  ]);

  if (!cabecalho) return null;

  const deliveryAddr = cabecalho.deliveryAddress ?? cabecalho.customerAddress;
  const phone = cabecalho.celular ?? cabecalho.telefone ?? "";

  return {
    invoiceNumber: lookup.invoiceNumber,
    storeCode:     lookup.storeCode,
    seller: {
      id:   "",   // Citel não devolve vendedor no cabeçalho
      name: "",
    },
    customer: {
      id:       cabecalho.documento ?? "",
      name:     cabecalho.nomeCliente,
      phone:    phone || undefined,
      document: cabecalho.documento ?? undefined,
    },
    deliveryAddress: {
      street:     [deliveryAddr?.logradouro, deliveryAddr?.numero, deliveryAddr?.complemento, deliveryAddr?.bairro]
                    .filter(Boolean).join(", "),
      city:       deliveryAddr?.cidade  ?? "",
      state:      deliveryAddr?.estado  ?? "",
      zipCode:    deliveryAddr?.cep     ?? "",
      complement: deliveryAddr?.complemento ?? undefined,
    },
    items: (itens ?? []).map((it) => ({
      productCode: it.codigo,
      productName: it.descricao,
      quantity:    it.quantidade,
      unit:        it.unidade,
    })),
    totalValue: cabecalho.valorTotal ?? 0,
    issuedAt:   new Date().toISOString(),  // Citel não devolve data de emissão da NF no cabeçalho do PD
  };
}

// ──────────────────────────────────────────────
// CONSULTA DE PEDIDO (PD)
// ──────────────────────────────────────────────

export async function fetchOrderFromERP(
  orderNumber: string,
  storeCode: string
): Promise<ERPOrder | null> {
  const config = getConfig();

  if (!config) return null;

  try {
    const response = await fetch(
      `${config.apiUrl}/api/pedido/${orderNumber}?empresa=${storeCode}`,
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        next: { revalidate: 30 },
      }
    );

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`ERP retornou status ${response.status}`);
    }

    return response.json() as Promise<ERPOrder>;
  } catch (error) {
    console.error("[ERP] Erro ao buscar pedido:", orderNumber, error);
    return null; // não-bloqueante: retorna null em vez de lançar
  }
}

// ──────────────────────────────────────────────
// CONSULTA DE ESTOQUE POR PRODUTO E LOJA
// ──────────────────────────────────────────────

export async function fetchStockByProduct(
  productCode: string
): Promise<ERPStockByStore | null> {
  const config = getConfig();

  if (!config) return null;

  try {
    const response = await fetch(
      `${config.apiUrl}/api/estoque/produto/${productCode}`,
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        next: { revalidate: 60 },
      }
    );

    if (!response.ok) return null;
    return response.json() as Promise<ERPStockByStore>;
  } catch (error) {
    console.error("[ERP] Erro ao buscar estoque:", productCode, error);
    return null;
  }
}

// consulta estoque de múltiplos produtos em paralelo
export async function fetchStockForItems(
  items: { productCode: string; productName: string; quantity: number }[]
): Promise<
  {
    productCode: string;
    productName: string;
    requestedQty: number;
    stock: ERPStockByStore | null;
  }[]
> {
  const results = await Promise.allSettled(
    items.map((item) => fetchStockByProduct(item.productCode))
  );

  return items.map((item, i) => ({
    productCode: item.productCode,
    productName: item.productName,
    requestedQty: item.quantity,
    stock: results[i].status === "fulfilled" ? results[i].value : null,
  }));
}

