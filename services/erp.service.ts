// ──────────────────────────────────────────────
// SERVIÇO DE INTEGRAÇÃO COM ERP LEGADO
// Consulta notas fiscais e pedidos via API externa.
// Quando não configurado retorna null — sem mocks.
// Pedidos de venda (PD) devem ser consultados via
// citel.service.ts (fetchPedidoCabecalho/Itens).
// ──────────────────────────────────────────────

import type { ERPInvoice, ERPOrder, ERPStockByStore } from "@/types";

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
// CONSULTA DE NOTA FISCAL
// ──────────────────────────────────────────────

export async function fetchInvoiceFromERP(
  invoiceNumber: string
): Promise<ERPInvoice | null> {
  const config = getConfig();

  if (!config) return null;

  try {
    const response = await fetch(
      `${config.apiUrl}/api/nota-fiscal/${invoiceNumber}`,
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        // cache de 30s — dados do ERP não mudam com frequência
        next: { revalidate: 30 },
      }
    );

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`ERP retornou status ${response.status}`);
    }

    return response.json() as Promise<ERPInvoice>;
  } catch (error) {
    console.error("[ERP] Erro ao buscar NF:", invoiceNumber, error);
    return null;
  }
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

