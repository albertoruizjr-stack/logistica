import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { indicateOrigin } from "@/services/transferencia.service";
import { PRIVILEGED_ROLES } from "@/lib/permissions";

// POST /api/transferencias/[id]/indicate-origin
// Loja destino indica qual loja vai fornecer o material.
// Body: { fromStoreId: string }
// Permissão: usuário da loja destino OU PRIVILEGED.

const schema = z.object({ fromStoreId: z.string().min(1) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const { id } = await params;
    const transfer = await prisma.transfer.findUnique({
      where:  { id },
      select: { toStoreId: true, status: true },
    });
    if (!transfer) {
      return NextResponse.json(apiError("Transferência não encontrada", "NOT_FOUND"), { status: 404 });
    }

    const isToStoreUser = session.storeId === transfer.toStoreId;
    if (!isToStoreUser && !PRIVILEGED_ROLES.includes(session.role as never)) {
      return NextResponse.json(apiError("Sem permissão", "FORBIDDEN"), { status: 403 });
    }

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
        { status: 400 },
      );
    }

    const updated = await indicateOrigin(id, parsed.data.fromStoreId, session.userId);
    return NextResponse.json(apiSuccess(updated));
  } catch (error) {
    console.error("[POST .../indicate-origin]", error);
    const msg = error instanceof Error ? error.message : "Erro ao indicar origem";
    const status = /insuficiente|inválid|destino|PENDING/i.test(msg) ? 422 : 500;
    return NextResponse.json(apiError(msg), { status });
  }
}
