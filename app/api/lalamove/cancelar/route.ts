import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { cancelLalamoveOrder } from "@/services/lalamove.service";

const ROLES = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"];
const schema = z.object({
  lalamoveOrderId: z.string().min(1),
});

// POST /api/lalamove/cancelar → cancela a CORRIDA no Lalamove e devolve a entrega
// para PRONTO_ROTEIRIZACAO (elegível). Detacha o dispatch da entrega (deliveryRequestId
// = null) em vez de deletá-lo — FKs de lalamove_orders/freight_audit apontam pro dispatch.
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    if (!ROLES.includes(session.role)) return NextResponse.json(apiError("Acesso restrito", "FORBIDDEN"), { status: 403 });

    const body = schema.safeParse(await req.json());
    if (!body.success) return NextResponse.json(apiError("Dados inválidos"), { status: 400 });

    // 1) Carrega a corrida + dispatch vinculado (pra saber a entrega a devolver).
    const lalamoveOrder = await prisma.lalamoveOrder.findUnique({
      where: { lalamoveOrderId: body.data.lalamoveOrderId },
      include: { dispatch: { select: { id: true, deliveryRequestId: true } } },
    });
    if (!lalamoveOrder) {
      return NextResponse.json(apiError("Corrida não encontrada", "NOT_FOUND"), { status: 404 });
    }

    // 2) Cancela no Lalamove em best-effort. NÃO aborta em falha: o operador pode já ter
    //    cancelado no app, mas ainda assim revertemos o estado local. A UI é avisada via
    //    lalamoveCancelled pra confirmar manualmente no app se necessário.
    let lalamoveCancelled = true;
    try {
      const r = await cancelLalamoveOrder(body.data.lalamoveOrderId);
      if (r && "reason" in r) lalamoveCancelled = false; // NOT_CONFIGURED
    } catch (e) {
      lalamoveCancelled = false;
      console.warn("[POST /api/lalamove/cancelar] falha ao cancelar no Lalamove:", e);
    }

    const dispatch = lalamoveOrder.dispatch;
    const deliveryRequestId = dispatch?.deliveryRequestId ?? null;

    // 3) Reverte tudo localmente em uma transação.
    await prisma.$transaction(async (tx) => {
      await tx.lalamoveOrder.update({
        where: { id: lalamoveOrder.id },
        data: { status: "CANCELLED", internalStatus: "FAILED" },
      });

      if (dispatch) {
        await tx.dispatch.update({
          where: { id: dispatch.id },
          data: {
            status: "FAILED",
            deliveryRequestId: null, // detacha pra entrega poder ser re-despachada (unique aceita null)
            failureReason: "Corrida cancelada pelo operador",
          },
        });
      }

      if (deliveryRequestId) {
        await tx.deliveryRequest.update({
          where: { id: deliveryRequestId },
          data: { status: "PRONTO_ROTEIRIZACAO" },
        });
        await tx.deliveryStatusHistory.create({
          data: {
            deliveryRequestId,
            fromStatus: "DISPATCHED",
            toStatus: "PRONTO_ROTEIRIZACAO",
            changedById: session.userId,
            reason: "Corrida Lalamove cancelada — devolvida para elegível",
          },
        });
      }
    });

    return NextResponse.json(apiSuccess({ lalamoveCancelled }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao cancelar corrida Lalamove";
    console.error("[POST /api/lalamove/cancelar]", err);
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
