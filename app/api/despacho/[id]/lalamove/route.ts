// app/api/despacho/[id]/lalamove/route.ts
// GET  — retorna status atual do pedido Lalamove vinculado ao dispatch
// DELETE — cancela o pedido Lalamove e atualiza status interno

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { prisma } from "@/lib/prisma";
import { getLalamoveOrderStatus, cancelLalamoveOrder } from "@/services/lalamove.service";
import { updateDispatchStatus } from "@/services/despacho.service";
import { DispatchStatus } from "@prisma/client";

type RouteParams = { params: { id: string } };

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const lalamoveOrder = await prisma.lalamoveOrder.findFirst({
      where: { dispatchId: params.id },
    });

    if (!lalamoveOrder) {
      return NextResponse.json(
        apiError("Pedido Lalamove não encontrado para este despacho"),
        { status: 404 }
      );
    }

    const status = await getLalamoveOrderStatus(lalamoveOrder.lalamoveOrderId);

    if ("reason" in status) {
      return NextResponse.json(
        apiError("Integração Lalamove não configurada neste ambiente", "LALAMOVE_NOT_CONFIGURED"),
        { status: 503 }
      );
    }

    // atualiza o banco se o status mudou
    if (status.status !== lalamoveOrder.status) {
      await prisma.lalamoveOrder.update({
        where: { id: lalamoveOrder.id },
        data: {
          status: status.status,
          driverName: status.driverName ?? lalamoveOrder.driverName,
          driverPhone: status.driverPhone ?? lalamoveOrder.driverPhone,
          driverPlate: status.driverPlate ?? lalamoveOrder.driverPlate,
          finalPrice: status.priceBreakdown
            ? parseFloat(status.priceBreakdown.total)
            : lalamoveOrder.finalPrice,
        },
      });
    }

    return NextResponse.json(
      apiSuccess({
        lalamoveOrderId: lalamoveOrder.lalamoveOrderId,
        status: status.status,
        shareLink: lalamoveOrder.shareLink,
        driverName: status.driverName,
        driverPhone: status.driverPhone,
        driverPlate: status.driverPlate,
        estimatedPrice: lalamoveOrder.estimatedPrice,
        finalPrice: status.priceBreakdown
          ? parseFloat(status.priceBreakdown.total)
          : lalamoveOrder.finalPrice,
      })
    );
  } catch (error) {
    console.error("[GET /api/despacho/[id]/lalamove]", error);
    return NextResponse.json(apiError("Erro ao consultar status Lalamove"), { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    if (!["ADMIN", "OPERATOR"].includes(session.role)) {
      return NextResponse.json(apiError("Sem permissão", "FORBIDDEN"), { status: 403 });
    }

    const lalamoveOrder = await prisma.lalamoveOrder.findFirst({
      where: { dispatchId: params.id },
    });

    if (!lalamoveOrder) {
      return NextResponse.json(apiError("Pedido Lalamove não encontrado"), { status: 404 });
    }

    const cancelResult = await cancelLalamoveOrder(lalamoveOrder.lalamoveOrderId);

    if (cancelResult && "reason" in cancelResult) {
      return NextResponse.json(
        apiError("Integração Lalamove não configurada neste ambiente", "LALAMOVE_NOT_CONFIGURED"),
        { status: 503 }
      );
    }

    // atualiza status interno em paralelo
    await Promise.all([
      prisma.lalamoveOrder.update({
        where: { id: lalamoveOrder.id },
        data: { status: "CANCELLED", internalStatus: DispatchStatus.FAILED },
      }),
      updateDispatchStatus(params.id, DispatchStatus.FAILED, {
        failureReason: "Cancelado pelo operador via Lalamove",
      }),
    ]);

    return NextResponse.json(apiSuccess({ message: "Pedido Lalamove cancelado com sucesso." }));
  } catch (error) {
    console.error("[DELETE /api/despacho/[id]/lalamove]", error);
    return NextResponse.json(apiError("Erro ao cancelar pedido Lalamove"), { status: 500 });
  }
}
