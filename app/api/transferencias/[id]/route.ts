import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { updateTransferStatus } from "@/services/transferencia.service";
import { TransferStatus } from "@prisma/client";

const updateStatusSchema = z.object({
  status: z.nativeEnum(TransferStatus),
  notes: z.string().optional(),
  estimatedArrival: z.string().datetime().optional(),
  sentItems: z.array(
    z.object({ transferItemId: z.string(), sentQty: z.number() })
  ).optional(),
  receivedItems: z.array(
    z.object({ transferItemId: z.string(), receivedQty: z.number() })
  ).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const transfer = await prisma.transfer.findUnique({
      where: { id: params.id },
      include: {
        fromStore: true,
        toStore: true,
        requestedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        items: true,
        history: { orderBy: { createdAt: "asc" } },
        deliveryRequest: {
          select: { id: true, invoiceNumber: true, customerName: true, status: true },
        },
        dispatch: {
          include: { driver: true, lalamoveOrder: true },
        },
      },
    });

    if (!transfer) {
      return NextResponse.json(apiError("Transferência não encontrada", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(apiSuccess(transfer));
  } catch (error) {
    console.error("[GET /api/transferencias/[id]]", error);
    return NextResponse.json(apiError("Erro ao buscar transferência"), { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    // apenas operadores e admins podem mudar status
    if (!["ADMIN", "OPERATOR"].includes(session.role)) {
      return NextResponse.json(apiError("Sem permissão", "FORBIDDEN"), { status: 403 });
    }

    const body = await req.json();
    const parsed = updateStatusSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
        { status: 400 }
      );
    }

    const updated = await updateTransferStatus(params.id, {
      ...parsed.data,
      changedById: session.userId,
      estimatedArrival: parsed.data.estimatedArrival
        ? new Date(parsed.data.estimatedArrival)
        : undefined,
    });

    return NextResponse.json(apiSuccess(updated));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro ao atualizar transferência";
    if (msg.includes("Transição inválida")) {
      return NextResponse.json(apiError(msg, "INVALID_TRANSITION"), { status: 422 });
    }
    console.error("[PATCH /api/transferencias/[id]]", error);
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
