import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { DeliveryRequestStatus } from "@prisma/client";
import {
  transitionDeliveryRequest,
  StateMachineError,
  stateMachineErrorToHttp,
} from "@/services/state-machine.service";

const schema = z.object({
  status: z.nativeEnum(DeliveryRequestStatus),
  reason: z.string().optional(),
  // Campos de gate por status
  separatedBy:       z.string().optional(),          // SEPARADO
  routeId:           z.string().optional(),          // ROTEIRIZADO
  occurrenceType:    z.string().optional(),          // OCORRENCIA
  occurrenceNotes:   z.string().min(10).optional(),  // OCORRENCIA
  forceCancel:       z.boolean().optional(),         // CANCELLED in-transit
  cancellationReason:z.string().min(10).optional(),  // CANCELLED in-transit
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
        { status: 400 }
      );
    }

    const { status: toStatus, ...meta } = parsed.data;

    const updated = await transitionDeliveryRequest({
      requestId: params.id,
      actorId: session.userId,
      actorRole: session.role,
      toStatus,
      metadata: meta,
    });

    return NextResponse.json(apiSuccess(updated));
  } catch (error) {
    if (error instanceof StateMachineError) {
      const { status, code, message } = stateMachineErrorToHttp(error);
      return NextResponse.json(apiError(message, code), { status });
    }
    console.error("[PATCH /api/solicitacoes/[id]/status]", error);
    return NextResponse.json(apiError("Erro ao atualizar status"), { status: 500 });
  }
}
