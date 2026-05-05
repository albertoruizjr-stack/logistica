// ──────────────────────────────────────────────
// SERVIÇO DE INTEGRAÇÃO LALAMOVE
// Autenticação HMAC-SHA256 conforme documentação Lalamove
// https://developers.lalamove.com/
// ──────────────────────────────────────────────

import crypto from "crypto";
import { LALAMOVE_API_BASE_URL, LALAMOVE_SANDBOX_URL, LALAMOVE_SERVICE_TYPE } from "@/lib/constants";
import type { LalamoveQuoteRequest, LalamoveQuoteResponse, LalamoveOrderStatus, LalamoveStop } from "@/types";

// ──────────────────────────────────────────────
// TIPO DE RETORNO QUANDO NÃO CONFIGURADO
// ──────────────────────────────────────────────

export type LalamoveNotConfigured = { success: false; reason: "NOT_CONFIGURED" };
const NOT_CONFIGURED: LalamoveNotConfigured = { success: false, reason: "NOT_CONFIGURED" };

// ──────────────────────────────────────────────
// CONFIGURAÇÃO E AUTENTICAÇÃO
// ──────────────────────────────────────────────

function getLalamoveConfig() {
  return {
    apiKey: process.env.LALAMOVE_API_KEY || "",
    apiSecret: process.env.LALAMOVE_API_SECRET || "",
    isSandbox: process.env.LALAMOVE_SANDBOX === "true",
    market: process.env.LALAMOVE_MARKET || "BR",
  };
}

export function isLalamoveConfigured(): boolean {
  const { apiKey, apiSecret } = getLalamoveConfig();
  return Boolean(apiKey && apiSecret);
}

function getBaseUrl(): string {
  const { isSandbox } = getLalamoveConfig();
  return isSandbox ? LALAMOVE_SANDBOX_URL : LALAMOVE_API_BASE_URL;
}

// Geração de assinatura HMAC-SHA256 conforme Lalamove API v3
function generateSignature(
  apiSecret: string,
  timestamp: string,
  method: string,
  path: string,
  body: string
): string {
  const rawSignature = `${timestamp}\r\n${method.toUpperCase()}\r\n${path}\r\n\r\n${body}`;
  return crypto.createHmac("sha256", apiSecret).update(rawSignature).digest("hex");
}

function buildHeaders(method: string, path: string, body: string = ""): HeadersInit {
  const { apiKey, apiSecret, market } = getLalamoveConfig();
  const timestamp = Date.now().toString();
  const signature = generateSignature(apiSecret, timestamp, method, path, body);

  return {
    "Content-Type": "application/json; charset=utf-8",
    Authorization: `hmac id="${apiKey}", ts="${timestamp}", sign="${signature}"`,
    Market: market,
    "Request-ID": crypto.randomUUID(),
  };
}

// ──────────────────────────────────────────────
// COTAÇÃO DE FRETE
// ──────────────────────────────────────────────

export async function getLalamoveQuote(
  originStop:      LalamoveStop,
  destinationStop: LalamoveStop,
  isUrgent:        boolean = false,
  serviceType:     string = LALAMOVE_SERVICE_TYPE
): Promise<LalamoveQuoteResponse | LalamoveNotConfigured> {
  if (!isLalamoveConfigured()) return NOT_CONFIGURED;

  const path = "/v3/quotations";
  const body: LalamoveQuoteRequest = {
    language: "pt_BR",
    serviceType: serviceType,
    specialRequests: [],
    stops: [originStop, destinationStop],
    item: {
      quantity: "1",
      weight: "LESS_THAN_3_KG",
      categories: ["OFFICE_SUPPLY"],
      handlingInstructions: [],
    },
  };

  const bodyString = JSON.stringify(body);
  const response = await fetch(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: buildHeaders("POST", path, bodyString),
    body: bodyString,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Lalamove quotation error ${response.status}: ${error}`);
  }

  return response.json();
}

// ──────────────────────────────────────────────
// CRIAÇÃO DE PEDIDO
// ──────────────────────────────────────────────

export async function createLalamoveOrder(
  quotationId: string,
  originStop: LalamoveStop,
  destinationStop: LalamoveStop,
  senderPhone: string
): Promise<{ orderId: string; shareLink?: string } | LalamoveNotConfigured> {
  if (!isLalamoveConfigured()) return NOT_CONFIGURED;

  const path = "/v3/orders";
  const body = {
    quotationId,
    sender: {
      stopId: "1",
      name: "Mestre da Pintura",
      phone: senderPhone,
    },
    recipients: [
      {
        stopId: "2",
        name: destinationStop.name || "Cliente",
        phone: destinationStop.phone || "",
      },
    ],
    isRecipientSMSEnabled: true,
    isPODEnabled: false,
  };

  const bodyString = JSON.stringify(body);
  const response = await fetch(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: buildHeaders("POST", path, bodyString),
    body: bodyString,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Lalamove order creation error ${response.status}: ${error}`);
  }

  const data = await response.json();
  return {
    orderId: data.orderId,
    shareLink: data.shareLink,
  };
}

// ──────────────────────────────────────────────
// CONSULTA DE STATUS
// ──────────────────────────────────────────────

export async function getLalamoveOrderStatus(orderId: string): Promise<{
  status: LalamoveOrderStatus;
  driverName?: string;
  driverPhone?: string;
  driverPlate?: string;
  priceBreakdown?: { total: string; currency: string };
} | LalamoveNotConfigured> {
  if (!isLalamoveConfigured()) return NOT_CONFIGURED;

  const path = `/v3/orders/${orderId}`;
  const response = await fetch(`${getBaseUrl()}${path}`, {
    headers: buildHeaders("GET", path),
  });

  if (!response.ok) {
    throw new Error(`Lalamove status error ${response.status}`);
  }

  const data = await response.json();
  return {
    status: data.status as LalamoveOrderStatus,
    driverName: data.driverInfo?.name,
    driverPhone: data.driverInfo?.phone,
    driverPlate: data.driverInfo?.plateNumber,
    priceBreakdown: data.priceBreakdown,
  };
}

// ──────────────────────────────────────────────
// CANCELAMENTO
// ──────────────────────────────────────────────

export async function cancelLalamoveOrder(orderId: string): Promise<LalamoveNotConfigured | void> {
  if (!isLalamoveConfigured()) return NOT_CONFIGURED;

  const path = `/v3/orders/${orderId}/cancel`;
  const response = await fetch(`${getBaseUrl()}${path}`, {
    method: "PUT",
    headers: buildHeaders("PUT", path),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Lalamove cancel error ${response.status}: ${error}`);
  }
}

// ──────────────────────────────────────────────
// VERIFICAÇÃO DE WEBHOOK
// Lalamove assina webhooks com HMAC-SHA256
// ──────────────────────────────────────────────

export function verifyLalamoveWebhook(
  payload: string,
  signature: string,
  timestamp: string
): boolean {
  const { apiSecret } = getLalamoveConfig();
  if (!apiSecret) return false;
  const expectedSignature = generateSignature(apiSecret, timestamp, "POST", "/webhook", payload);
  return crypto.timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expectedSignature, "hex")
  );
}
