import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { DeliveryRequestStatus } from "@prisma/client";

const S = DeliveryRequestStatus;

// Transições permitidas por status atual — impede pular etapas.
// IN_TRANSIT não inclui CANCELLED: motorista já está em rota com os produtos.
// Para cancelar IN_TRANSIT, ADMIN deve enviar { forceCancel: true, cancellationReason: "..." }.
const ALLOWED_TRANSITIONS: Record<DeliveryRequestStatus, DeliveryRequestStatus[]> = {
  [S.AWAITING_ITEMS]:    [S.PENDING, S.CANCELLED],
  [S.PENDING]:           [S.READY, S.AWAITING_TRANSFER, S.CANCELLED],
  [S.AWAITING_TRANSFER]: [S.READY, S.CANCELLED],
  [S.READY]:             [S.DISPATCHED, S.CANCELLED],
  [S.DISPATCHED]:        [S.IN_TRANSIT, S.CANCELLED],
  [S.IN_TRANSIT]:        [S.DELIVERED],
  [S.DELIVERED]:         [],
  [S.CANCELLED]:         [],
};

const schema = z.object({
  status: z.nativeEnum(DeliveryRequestStatus),
  // Campos exclusivos para cancelamento forçado de IN_TRANSIT (somente ADMIN)
  forceCancel: z.boolean().optional(),
  cancellationReason: z.string().min(10, "Motivo deve ter ao menos 10 caracteres").optional(),
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

    const { status: newStatus, forceCancel, cancellationReason } = parsed.data;

    const request = await prisma.deliveryRequest.findUnique({
      where: { id: params.id },
      select: { id: true, storeId: true, status: true },
    });

    if (!request) return NextResponse.json(apiError("Não encontrado"), { status: 404 });

    if (session.role === "SELLER" && request.storeId !== session.storeId) {
      return NextResponse.json(apiError("Sem permissão"), { status: 403 });
    }

    // Caso especial: cancelar enquanto IN_TRANSIT
    if (request.status === S.IN_TRANSIT && newStatus === S.CANCELLED) {
      if (session.role !== "ADMIN") {
        return NextResponse.json(
          apiError(
            "Cancelamento após início do trajeto só pode ser feito por um administrador.",
            "FORBIDDEN"
          ),
          { status: 403 }
        );
      }
      if (!forceCancel || !cancellationReason) {
        return NextResponse.json(
          apiError(
            "Para cancelar uma entrega em trânsito, informe o motivo e confirme com forceCancel.",
            "FORCE_REQUIRED"
          ),
          { status: 422 }
        );
      }
      // Prossegue com cancelamento forçado (motivo registrado nas notas via update abaixo)
    } else {
      const allowed = ALLOWED_TRANSITIONS[request.status] ?? [];
      if (!allowed.includes(newStatus)) {
        return NextResponse.json(
          apiError(
            `Transição inválida: ${request.status} → ${newStatus}`,
            "INVALID_TRANSITION"
          ),
          { status: 422 }
        );
      }
    }

    const updated = await prisma.deliveryRequest.update({
      where: { id: params.id },
      data: {
        status: newStatus,
        // Registra o motivo nas notas quando há cancelamento forçado
        ...(forceCancel && cancellationReason
          ? { notes: `[CANCELADO EM TRÂNSITO] ${cancellationReason}` }
          : {}),
      },
      select: { id: true, status: true, notes: true },
    });

    return NextResponse.json(apiSuccess(updated));
  } catch (error) {
    console.error("[PATCH /api/solicitacoes/[id]/status]", error);
    return NextResponse.json(apiError("Erro ao atualizar status"), { status: 500 });
  }
}
