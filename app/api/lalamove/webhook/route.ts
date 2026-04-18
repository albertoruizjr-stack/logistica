// ──────────────────────────────────────────────
// WEBHOOK LALAMOVE
// Recebe eventos de atualização de pedidos do Lalamove.
// Verifica assinatura HMAC e processa assincronamente.
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLalamoveWebhook } from "@/services/lalamove.service";
import { LALAMOVE_STATUS_MAP } from "@/types";
import type { LalamoveOrderStatus } from "@/types";
import { updateDispatchStatus } from "@/services/despacho.service";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // verificação de assinatura (produção)
  if (process.env.NODE_ENV === "production") {
    const signature = req.headers.get("X-Lalamove-Signature") ?? "";
    const timestamp = req.headers.get("X-Lalamove-Timestamp") ?? "";

    if (!verifyLalamoveWebhook(rawBody, signature, timestamp)) {
      console.warn("[WEBHOOK] Assinatura Lalamove inválida");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orderId = payload.orderId as string;
  const eventType = payload.status as string;

  if (!orderId) {
    return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
  }

  try {
    // busca a ordem no banco
    const lalamoveOrder = await prisma.lalamoveOrder.findUnique({
      where: { lalamoveOrderId: orderId },
    });

    if (!lalamoveOrder) {
      // pedido pode ter sido criado fora do sistema — ignora silenciosamente
      console.warn("[WEBHOOK] Lalamove order não encontrada:", orderId);
      return NextResponse.json({ received: true });
    }

    // registra o evento bruto para auditoria
    await prisma.lalamoveEvent.create({
      data: {
        lalamoveOrderId: lalamoveOrder.id,
        externalOrderId: orderId,
        eventType,
        rawPayload: payload as never,
      },
    });

    // mapeia status Lalamove → interno
    const internalStatus = LALAMOVE_STATUS_MAP[eventType as LalamoveOrderStatus];

    if (internalStatus) {
      // atualiza a ordem Lalamove
      await prisma.lalamoveOrder.update({
        where: { id: lalamoveOrder.id },
        data: {
          status: eventType,
          internalStatus,
          // atualiza dados do motorista quando atribuído
          driverName: (payload.driverInfo as Record<string, string>)?.name ?? lalamoveOrder.driverName,
          driverPhone: (payload.driverInfo as Record<string, string>)?.phone ?? lalamoveOrder.driverPhone,
          driverPlate: (payload.driverInfo as Record<string, string>)?.plateNumber ?? lalamoveOrder.driverPlate,
        },
      });

      // propaga para o despacho
      await updateDispatchStatus(lalamoveOrder.dispatchId, internalStatus, {
        actualCost: payload.priceBreakdown
          ? parseFloat((payload.priceBreakdown as Record<string, string>).total ?? "0")
          : undefined,
      });

      // marca o evento como processado
      await prisma.lalamoveEvent.updateMany({
        where: { lalamoveOrderId: lalamoveOrder.id, processedAt: null },
        data: { processedAt: new Date() },
      });
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[WEBHOOK] Erro ao processar evento Lalamove:", error);
    // retorna 200 para o Lalamove não retentar (o erro já está logado)
    return NextResponse.json({ received: true, error: "Processing error" });
  }
}
