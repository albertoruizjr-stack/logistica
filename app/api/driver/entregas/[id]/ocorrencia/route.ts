import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { transitionDeliveryRequest } from "@/services/state-machine.service";
import { checkAndCompleteRouteFromDeliveryRequest } from "@/services/route-dispatch.service";
import { isDeliveryAssignedToDriver } from "@/lib/driver-ownership";

const occurrenceSchema = z.object({
  type:  z.enum(["AUSENTE", "RECUSA_ENTREGA", "ENDERECO_ERRADO", "AVARIA"]),
  notes: z.string().min(10, "Descreva em pelo menos 10 caracteres").max(1000),
});

// POST /api/driver/entregas/[id]/ocorrencia
// Marca a entrega como OCORRENCIA via state machine. Apenas o motorista atribuído.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    if (session.role !== "DRIVER") {
      return NextResponse.json(apiError("Apenas motoristas", "FORBIDDEN"), { status: 403 });
    }

    const body = await req.json();
    const parsed = occurrenceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
        { status: 400 },
      );
    }

    // Garante que o motorista é o dono da entrega
    const driver = await prisma.driver.findFirst({
      where: { userId: session.userId },
      select: { id: true },
    });
    if (!driver) return NextResponse.json(apiError("Motorista não vinculado"), { status: 403 });

    const dr = await prisma.deliveryRequest.findUnique({
      where:  { id: params.id },
      select: { id: true },
    });
    if (!dr) return NextResponse.json(apiError("Entrega não encontrada", "NOT_FOUND"), { status: 404 });

    const isMine = await isDeliveryAssignedToDriver(dr.id, driver.id);
    if (!isMine) {
      return NextResponse.json(apiError("Entrega não é sua", "FORBIDDEN"), { status: 403 });
    }

    await transitionDeliveryRequest({
      requestId: dr.id,
      actorId:   session.userId,
      actorRole: "DRIVER",
      toStatus:  "OCORRENCIA",
      metadata: {
        occurrenceType:  parsed.data.type,
        occurrenceNotes: parsed.data.notes,
        reason:          `Ocorrência registrada pelo motorista: ${parsed.data.type}`,
      },
    });

    // Mesmo cuidado do concluir: se foi a última DR da rota, fecha rota + libera motorista.
    try {
      await checkAndCompleteRouteFromDeliveryRequest(dr.id);
    } catch (err) {
      console.error(`[ocorrencia] checkAndCompleteRoute falhou pra DR ${dr.id}`, err);
    }

    return NextResponse.json(apiSuccess({ deliveryRequestId: dr.id, type: parsed.data.type }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao registrar ocorrência";
    console.error(`[POST /api/driver/entregas/${params.id}/ocorrencia]`, err);
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
