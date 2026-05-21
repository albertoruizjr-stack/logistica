import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { createDispatch } from "@/services/despacho.service";
import { DispatchModal } from "@prisma/client";

const ROLES = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"];
const schema = z.object({
  deliveryRequestId: z.string().min(1),
  serviceType:       z.string().min(1),
  quotationId:       z.string().optional(),
  estimatedPrice:    z.number().optional(),
});

// POST /api/roteirizacao/lalamove → cria Dispatch LALAMOVE para UMA entrega
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    if (!ROLES.includes(session.role)) return NextResponse.json(apiError("Acesso restrito", "FORBIDDEN"), { status: 403 });

    const body = schema.safeParse(await req.json());
    if (!body.success) return NextResponse.json(apiError("Dados inválidos"), { status: 400 });

    const dr = await prisma.deliveryRequest.findUnique({
      where: { id: body.data.deliveryRequestId },
      select: { id: true, status: true, storeId: true },
    });
    if (!dr) return NextResponse.json(apiError("Entrega não encontrada", "NOT_FOUND"), { status: 404 });
    if (dr.status !== "PRONTO_ROTEIRIZACAO") {
      return NextResponse.json(apiError(`Entrega não está elegível (status ${dr.status})`, "NOT_ELIGIBLE"), { status: 409 });
    }

    const dispatch = await createDispatch({
      deliveryRequestId: dr.id,
      storeId:           dr.storeId,
      modal:             DispatchModal.LALAMOVE,
      dispatchedById:    session.userId,
      serviceType:       body.data.serviceType,
      quotationId:       body.data.quotationId,
      estimatedCost:     body.data.estimatedPrice,
      notes:             `Lalamove ${body.data.serviceType} via roteirização`,
    });

    return NextResponse.json(apiSuccess({ dispatchId: dispatch.id }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao chamar Lalamove";
    console.error("[POST /api/roteirizacao/lalamove]", err);
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
