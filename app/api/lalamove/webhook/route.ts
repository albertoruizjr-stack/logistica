// ──────────────────────────────────────────────
// WEBHOOK LALAMOVE
// Recebe eventos de atualização de pedidos do Lalamove.
//
// Política da Lalamove: "Make sure your Webhook URL is sending 200 to our
// requests" — devolvemos 200 mesmo pra payloads malformados ou de validação
// do painel deles. Erros vão pro log, não pro status code.
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLalamoveWebhook } from "@/services/lalamove.service";
import { LALAMOVE_STATUS_MAP } from "@/types";
import type { LalamoveOrderStatus } from "@/types";
import { updateDispatchStatus } from "@/services/despacho.service";

const OK = NextResponse.json({ received: true });

// GET /api/lalamove/webhook
// Health check / validação inicial do painel da Lalamove.
export async function GET() {
  return NextResponse.json({ status: "ok", endpoint: "lalamove-webhook" });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // Verificação de assinatura (só em produção). Falha vira log, não 401 —
  // o painel da Lalamove faz POST de teste sem signature pra validar a URL.
  if (process.env.NODE_ENV === "production") {
    const signature = req.headers.get("X-Lalamove-Signature") ?? "";
    const timestamp = req.headers.get("X-Lalamove-Timestamp") ?? "";

    if (!signature || !timestamp) {
      console.info("[WEBHOOK] sem signature — provável teste do painel Lalamove");
      return OK;
    }
    if (!verifyLalamoveWebhook(rawBody, signature, timestamp)) {
      console.warn("[WEBHOOK] Assinatura Lalamove inválida (silenciado com 200)");
      return OK;
    }
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.warn("[WEBHOOK] body não é JSON válido:", rawBody.slice(0, 200));
    return OK;
  }

  const orderId = payload.orderId as string | undefined;
  const eventType = payload.status as string | undefined;

  if (!orderId) {
    console.info("[WEBHOOK] payload sem orderId (provável evento de validação)", { eventType, keys: Object.keys(payload) });
    return OK;
  }

  try {
    const lalamoveOrder = await prisma.lalamoveOrder.findUnique({
      where: { lalamoveOrderId: orderId },
    });

    if (!lalamoveOrder) {
      console.warn("[WEBHOOK] Lalamove order não encontrada:", orderId);
      return OK;
    }

    // registra o evento bruto para auditoria
    await prisma.lalamoveEvent.create({
      data: {
        lalamoveOrderId: lalamoveOrder.id,
        externalOrderId: orderId,
        eventType: eventType ?? "UNKNOWN",
        rawPayload: payload as never,
      },
    });

    const internalStatus = eventType ? LALAMOVE_STATUS_MAP[eventType as LalamoveOrderStatus] : undefined;

    if (internalStatus) {
      await prisma.lalamoveOrder.update({
        where: { id: lalamoveOrder.id },
        data: {
          status: eventType,
          internalStatus,
          driverName: (payload.driverInfo as Record<string, string>)?.name ?? lalamoveOrder.driverName,
          driverPhone: (payload.driverInfo as Record<string, string>)?.phone ?? lalamoveOrder.driverPhone,
          driverPlate: (payload.driverInfo as Record<string, string>)?.plateNumber ?? lalamoveOrder.driverPlate,
        },
      });

      await updateDispatchStatus(lalamoveOrder.dispatchId, internalStatus, {
        actualCost: payload.priceBreakdown
          ? parseFloat((payload.priceBreakdown as Record<string, string>).total ?? "0")
          : undefined,
      });

      await prisma.lalamoveEvent.updateMany({
        where: { lalamoveOrderId: lalamoveOrder.id, processedAt: null },
        data: { processedAt: new Date() },
      });
    }

    return OK;
  } catch (error) {
    console.error("[WEBHOOK] Erro ao processar evento Lalamove:", error);
    return OK;
  }
}
