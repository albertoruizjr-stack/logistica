import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { approveTransfer } from "@/services/transferencia.service";
import { PRIVILEGED_ROLES } from "@/lib/permissions";

// POST /api/transferencias/[id]/approve
// Líder da loja origem aprova informando TE OU NF (exatamente um).
// Body: { teNumber?: string, nfCitelNumero?: string }
// Permissão: usuário da loja origem OU PRIVILEGED.

const schema = z
  .object({
    teNumber:      z.string().min(1).optional(),
    nfCitelNumero: z.string().min(1).optional(),
  })
  .refine(
    (v) => Boolean(v.teNumber) !== Boolean(v.nfCitelNumero),
    { message: "Informe exatamente um documento: teNumber OU nfCitelNumero" },
  );

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
      select: { fromStoreId: true, status: true },
    });
    if (!transfer) {
      return NextResponse.json(apiError("Transferência não encontrada", "NOT_FOUND"), { status: 404 });
    }

    const isFromStoreUser = transfer.fromStoreId != null && session.storeId === transfer.fromStoreId;
    if (!isFromStoreUser && !PRIVILEGED_ROLES.includes(session.role as never)) {
      return NextResponse.json(apiError("Sem permissão", "FORBIDDEN"), { status: 403 });
    }

    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
        { status: 400 },
      );
    }

    const updated = await approveTransfer(id, parsed.data, session.userId);
    return NextResponse.json(apiSuccess(updated));
  } catch (error) {
    console.error("[POST .../approve]", error);
    const msg = error instanceof Error ? error.message : "Erro ao aprovar";
    const status = /TE ou NF|AWAITING_APPROVAL|fromStoreId/i.test(msg) ? 422 : 500;
    return NextResponse.json(apiError(msg), { status });
  }
}
