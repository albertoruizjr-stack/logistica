// ──────────────────────────────────────────────
// SERVIÇO DE INTEGRAÇÃO LALAMOVE
// Autenticação HMAC-SHA256 conforme documentação Lalamove
// https://developers.lalamove.com/
// ──────────────────────────────────────────────

import crypto from "crypto";
import { LALAMOVE_API_BASE_URL, LALAMOVE_SANDBOX_URL, LALAMOVE_SERVICE_TYPE } from "@/lib/constants";
import type { LalamoveQuoteRequest, LalamoveQuoteResponse, LalamoveOrderStatus, LalamoveStop } from "@/types";
import { toE164 } from "@/lib/phone";

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

  // Formato OFICIAL da Lalamove v3 (developers.lalamove.com):
  //   TOKEN = API_KEY:TIMESTAMP:SIGNATURE   ← separador ":"
  //   Authorization: hmac <TOKEN>
  // O formato antigo `hmac id="x", ts="y", sign="z"` é rejeitado pelo gateway
  // APISIX deles, devolvendo HTTP 502 sem chegar no backend.
  return {
    "Content-Type": "application/json",
    Authorization: `hmac ${apiKey}:${timestamp}:${signature}`,
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
  // Lalamove v3 exige wrapper { "data": { ... } }
  const innerBody: LalamoveQuoteRequest = {
    language: "pt_BR",
    serviceType: serviceType,
    specialRequests: [],
    // A cotação v3 só aceita coordinates+address nas paradas. name/phone (do destinatário)
    // são rejeitados aqui com ERR_UNKNOWN_FIELD — eles entram só na criação do pedido
    // (recipients). Por isso enviamos uma versão "enxuta" das paradas na cotação.
    stops: [originStop, destinationStop].map((s) => ({ coordinates: s.coordinates, address: s.address })),
    item: {
      quantity: "1",
      weight: "LESS_THAN_3_KG",
      categories: ["OFFICE_SUPPLY"],
      handlingInstructions: [],
    },
  };

  const bodyString = JSON.stringify({ data: innerBody });
  const response = await fetch(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: buildHeaders("POST", path, bodyString),
    body: bodyString,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Lalamove quotation error ${response.status}: ${error}`);
  }

  // Response da v3 também vem com { "data": {...} }
  const json = await response.json();
  return json.data ?? json;
}

// ──────────────────────────────────────────────
// STOPIDS DA COTAÇÃO
// O pedido (POST /v3/orders) precisa referenciar os stopIds GERADOS pela cotação
// (não "1"/"2"). GET /v3/quotations/{id} devolve data.stops = [{stopId}, {stopId}].
// ──────────────────────────────────────────────

async function getQuotationStopIds(
  quotationId: string
): Promise<{ senderStopId: string; recipientStopId: string } | null> {
  const path = `/v3/quotations/${quotationId}`;
  const response = await fetch(`${getBaseUrl()}${path}`, { headers: buildHeaders("GET", path) });
  if (!response.ok) return null;
  const json = await response.json();
  const stops = (json.data ?? json)?.stops as Array<{ stopId: string }> | undefined;
  if (!stops || stops.length < 2) return null;
  return { senderStopId: stops[0].stopId, recipientStopId: stops[1].stopId };
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

  // 1) stopIds reais da cotação — sem eles o Lalamove rejeita o pedido.
  //    null normalmente significa cotação expirada/inválida.
  const stopIds = await getQuotationStopIds(quotationId);
  if (!stopIds) {
    throw new Error("Não foi possível obter os stopIds da cotação Lalamove (cotação pode ter expirado).");
  }

  // 2) telefones em E.164 — o Lalamove rejeita formato cru com 422 ERR_INVALID_FIELD.
  const recipientPhone = toE164(destinationStop.phone);
  if (!recipientPhone) {
    throw new Error("Telefone do cliente inválido — Lalamove exige um número válido.");
  }
  // Telefone da loja: prefere o da loja; se faltar/inválido, usa o do destinatário
  // (um cadastro de loja sem telefone não pode travar o despacho).
  const formattedSenderPhone = toE164(senderPhone) ?? recipientPhone;

  const path = "/v3/orders";
  // Lalamove v3 também exige wrapper { "data": { ... } } pra criar pedido
  const innerBody = {
    quotationId,
    sender: {
      stopId: stopIds.senderStopId,
      name: "Mestre da Pintura",
      phone: formattedSenderPhone,
    },
    recipients: [
      {
        stopId: stopIds.recipientStopId,
        name: destinationStop.name || "Cliente",
        phone: recipientPhone,
      },
    ],
    isRecipientSMSEnabled: true,
    isPODEnabled: false,
  };

  const bodyString = JSON.stringify({ data: innerBody });
  const response = await fetch(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: buildHeaders("POST", path, bodyString),
    body: bodyString,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Lalamove order creation error ${response.status}: ${error}`);
  }

  const json = await response.json();
  const data = json.data ?? json;
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

  const json = await response.json();
  const data = json.data ?? json;
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
  if (!signature || !timestamp) return false;

  const expectedSignature = generateSignature(apiSecret, timestamp, "POST", "/webhook", payload);
  const sig = Buffer.from(signature, "hex");
  const exp = Buffer.from(expectedSignature, "hex");

  // crypto.timingSafeEqual lança exception se buffers tiverem tamanhos diferentes.
  // Esse caso acontece quando o painel da Lalamove valida a URL com signature vazia.
  if (sig.length !== exp.length) return false;

  return crypto.timingSafeEqual(sig, exp);
}
