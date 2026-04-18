import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { createDispatch, listPendingDispatches, decideModal } from "@/services/despacho.service";
import { checkAuditGate } from "@/services/audit.service";
import { DispatchModal, DeliveryType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const createSchema = z.object({
  deliveryRequestId: z.string().optional(),
  transferId: z.string().optional(),
  modal: z.nativeEnum(DispatchModal),
  driverId: z.string().optional(),
  routeId: z.string().optional(),
  estimatedCost: z.number().optional(),
  notes: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get("storeId") ?? undefined;

    const dispatches = await listPendingDispatches(storeId);
    return NextResponse.json(apiSuccess(dispatches));
  } catch (error) {
    console.error("[GET /api/despacho]", error);
    return NextResponse.json(apiError("Erro ao listar despachos"), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    if (!["ADMIN", "OPERATOR"].includes(session.role)) {
      return NextResponse.json(apiError("Sem permissão", "FORBIDDEN"), { status: 403 });
    }

    const body = await req.json();
    const parsed = createSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
        { status: 400 }
      );
    }

    if (!parsed.data.deliveryRequestId && !parsed.data.transferId) {
      return NextResponse.json(
        apiError("Informe deliveryRequestId ou transferId", "MISSING_REFERENCE"),
        { status: 400 }
      );
    }

    // hard gate: verificar se audit exige justificativa não preenchida
    if (parsed.data.deliveryRequestId) {
      const gate = await checkAuditGate(parsed.data.deliveryRequestId);
      if (gate.blocked) {
        return NextResponse.json(
          apiError(gate.reason!, "AUDIT_JUSTIFICATION_REQUIRED", { auditId: gate.auditId }),
          { status: 422 }
        );
      }
    }

    const dispatch = await createDispatch({
      ...parsed.data,
      storeId: session.storeId,
      dispatchedById: session.userId,
    });

    return NextResponse.json(apiSuccess(dispatch), { status: 201 });
  } catch (error) {
    console.error("[POST /api/despacho]", error);
    return NextResponse.json(apiError("Erro ao criar despacho"), { status: 500 });
  }
}

// endpoint de sugestão de modal (usado pelo frontend antes do despacho)
export async function PUT(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const body = await req.json();
    const { deliveryRequestId } = body;

    if (!deliveryRequestId) {
      return NextResponse.json(apiError("deliveryRequestId obrigatório"), { status: 400 });
    }

    const deliveryRequest = await prisma.deliveryRequest.findUnique({
      where: { id: deliveryRequestId },
      include: { freightQuote: true },
    });

    if (!deliveryRequest) {
      return NextResponse.json(apiError("Solicitação não encontrada"), { status: 404 });
    }

    const decision = await decideModal({
      deliveryType: deliveryRequest.deliveryType as DeliveryType,
      distanceKm: deliveryRequest.freightQuote?.distanceKm ?? 0,
      durationMinutes: deliveryRequest.freightQuote?.durationMinutes ?? undefined,
      isUrgent: deliveryRequest.deliveryType === DeliveryType.URGENT,
    });

    return NextResponse.json(apiSuccess(decision));
  } catch (error) {
    console.error("[PUT /api/despacho]", error);
    return NextResponse.json(apiError("Erro ao sugerir modal"), { status: 500 });
  }
}
