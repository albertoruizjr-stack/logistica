import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { DeliveryRequestStatus } from "@prisma/client";
import {
  transitionDeliveryRequest,
  StateMachineError,
  stateMachineErrorToHttp,
} from "@/services/state-machine.service";
import {
  notifyOrderSeparated,
  notifyOrderDispatched,
  notifyOrderDelivered,
  notifyDeliveryOccurrence,
  notifyRequestCancelled,
} from "@/services/notifications.service";

const schema = z.object({
  requestId:          z.string().min(1),
  toStatus:           z.nativeEnum(DeliveryRequestStatus),
  reason:             z.string().optional(),
  separatedBy:        z.string().optional(),
  routeId:            z.string().optional(),
  occurrenceType:     z.string().optional(),
  occurrenceNotes:    z.string().min(10).optional(),
  forceCancel:        z.boolean().optional(),
  cancellationReason: z.string().min(10).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    if (!["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"].includes(session.role)) {
      return NextResponse.json(apiError("Acesso restrito"), { status: 403 });
    }

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
        { status: 400 }
      );
    }

    const { requestId, toStatus, ...meta } = parsed.data;

    const updated = await transitionDeliveryRequest({
      requestId,
      actorId:  session.userId,
      actorRole: session.role,
      toStatus,
      metadata: meta,
    });

    // Notificações por novo status (gatilhos #7, #8, #9, #10, #13)
    void (async () => {
      try {
        const info = await prisma.deliveryRequest.findUnique({
          where: { id: requestId },
          select: {
            orderNumber: true,
            orderStore: { select: { code: true } },
            transfers:  { select: { id: true }, where: { status: { notIn: ["CANCELLED"] } }, take: 1 },
          },
        });
        if (!info) return;
        const refs = {
          deliveryRequestId: requestId,
          orderNumber:       info.orderNumber,
          storeCode:         info.orderStore?.code,
        };
        switch (toStatus) {
          case "SEPARADO":
            await notifyOrderSeparated(refs);
            break;
          case "DISPATCHED":
          case "IN_TRANSIT":
            await notifyOrderDispatched(refs);
            break;
          case "DELIVERED":
            await notifyOrderDelivered(refs);
            break;
          case "OCORRENCIA":
            await notifyDeliveryOccurrence({ ...refs, occurrence: meta.occurrenceType ?? "Ocorrência sem detalhe" });
            break;
          case "CANCELLED":
            await notifyRequestCancelled({ ...refs, hadTransfer: info.transfers.length > 0 });
            break;
        }
      } catch (e) {
        console.warn("[operacao/action] notify failed:", e instanceof Error ? e.message : e);
      }
    })();

    return NextResponse.json(apiSuccess(updated));
  } catch (error) {
    if (error instanceof StateMachineError) {
      const { status, code, message } = stateMachineErrorToHttp(error);
      // Para CLAIM_VIOLATION, inclui info do dono do lock para o frontend exibir
      if (error.code === "CLAIM_VIOLATION" && error.claimInfo) {
        return NextResponse.json(
          { success: false, error: message, code, claim: error.claimInfo },
          { status }
        );
      }
      return NextResponse.json(apiError(message, code), { status });
    }
    console.error("[POST /api/operacao/action]", error);
    return NextResponse.json(apiError("Erro ao executar ação"), { status: 500 });
  }
}
