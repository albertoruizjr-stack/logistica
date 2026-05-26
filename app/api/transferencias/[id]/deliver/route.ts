import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { deliverTransfer } from "@/services/transferencia.service";

// POST /api/transferencias/[id]/deliver
// Motorista entrega no destino com foto + recebedor + qty recebida.
// Body: { photoUrl, photoPath, recipientName, receivedQty }
// Permissão: motorista atribuído ao dispatch da Transfer.

const schema = z.object({
  photoUrl:      z.string().url(),
  photoPath:     z.string().min(1),
  recipientName: z.string().min(1),
  receivedQty:   z.number().positive(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const { id } = await params;
    const transfer = await prisma.transfer.findUnique({
      where:   { id },
      include: { dispatch: { select: { driverId: true } } },
    });
    if (!transfer) {
      return NextResponse.json(apiError("Transferência não encontrada", "NOT_FOUND"), { status: 404 });
    }

    const driverProfile = await prisma.driver.findFirst({
      where:  { userId: session.userId },
      select: { id: true },
    });
    if (!driverProfile || transfer.dispatch?.driverId !== driverProfile.id) {
      return NextResponse.json(apiError("Não é o motorista atribuído", "FORBIDDEN"), { status: 403 });
    }

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
        { status: 400 },
      );
    }

    const updated = await deliverTransfer(id, parsed.data, session.userId);
    return NextResponse.json(apiSuccess(updated));
  } catch (error) {
    console.error("[POST .../deliver]", error);
    const msg = error instanceof Error ? error.message : "Erro ao registrar entrega";
    const status = /IN_TRANSIT/.test(msg) ? 422 : 500;
    return NextResponse.json(apiError(msg), { status });
  }
}
