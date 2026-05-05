// ──────────────────────────────────────────────
// SERVIÇO DE INTEGRAÇÃO COM ERP
// Responsável por consultar notas fiscais, pedidos
// e estoque via API externa do ERP.
// Quando a API não estiver configurada, retorna dados
// mockados para desenvolvimento.
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

  // sem configuração → retorna mock para desenvolvimento
  if (!config) {
    return getMockInvoice(invoiceNumber);
  }

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

  if (!config) {
    return getMockOrder(orderNumber, storeCode);
  }

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

  if (!config) {
    return getMockStock(productCode);
  }

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

// ──────────────────────────────────────────────
// MOCKS DE DESENVOLVIMENTO
// ──────────────────────────────────────────────

function getMockInvoice(invoiceNumber: string): ERPInvoice {
  return {
    invoiceNumber,
    storeCode: "067",
    seller: { id: "seller-mock", name: "Vendedor Teste" },
    customer: {
      id: "customer-mock",
      name: "João Silva — Pintor",
      phone: "(11) 99999-1234",
      document: "123.456.789-00",
    },
    deliveryAddress: {
      street: "Rua das Flores, 123 — Vila Mariana",
      complement: "Ap 45",
      city: "São Paulo",
      state: "SP",
      zipCode: "04110-000",
    },
    items: [
      {
        productCode: "CORAL-TEC-18L",
        productName: "Coral Tinta Acrílica Fosca 18L Branco",
        quantity: 4,
        unit: "GL",
      },
      {
        productCode: "CORAL-PRIMER-3.6L",
        productName: "Coral Primer Selador Acrílico 3,6L",
        quantity: 2,
        unit: "GL",
      },
    ],
    totalValue: 856.0,
    issuedAt: new Date().toISOString(),
  };
}

function getMockOrder(orderNumber: string, storeCode: string): ERPOrder | null {
  // simula pedido não encontrado para números que terminam em "000"
  if (orderNumber.endsWith("000")) return null;
  return {
    orderNumber,
    storeCode,
    customer: {
      id: "customer-mock",
      name: "João Silva — Pintor",
      phone: "(11) 99999-1234",
      document: "123.456.789-00",
    },
    deliveryAddress: {
      street: "Rua das Flores, 123 — Vila Mariana",
      complement: "Ap 45",
      city: "São Paulo",
      state: "SP",
      zipCode: "04110-000",
    },
    items: [
      { productCode: "CORAL-TEC-18L", productName: "Coral Acrílica Fosca 18L Branco", quantity: 4, unit: "GL" },
      { productCode: "CORAL-PRIMER-3.6L", productName: "Coral Primer Selador 3,6L", quantity: 2, unit: "GL" },
    ],
    totalValue: 856.0,
  };
}

function getMockStock(productCode: string): ERPStockByStore {
  const stores = ["067", "131", "132", "173", "191"];
  return {
    productCode,
    productName: `Produto ${productCode}`,
    availability: stores.map((code) => ({
      storeCode: code,
      storeName: `Loja ${code}`,
      qty: Math.floor(Math.random() * 20),
      available: Math.random() > 0.3,
    })),
  };
}
