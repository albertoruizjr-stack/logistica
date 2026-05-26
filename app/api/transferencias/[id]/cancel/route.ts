import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { cancelTransfer } from "@/services/transferencia.service";
import { PRIVILEGED_ROLES } from "@/lib/permissions";

// POST /api/transferencias/[id]/cancel
// Cancela em qualquer status não-terminal (ledger liberado conforme matriz no service).
// Body: { reason: string }
// Permissão: PRIVILEGED (inclui STORE_LEADER).

const schema = z.object({ reason: z.string().min(3) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    if (!PRIVILEGED_ROLES.includes(session.role as never)) {
      return NextResponse.json(apiError("Sem permissão", "FORBIDDEN"), { status: 403 });
    }

    const { id } = await params;
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
        { status: 400 },
      );
    }

    const updated = await cancelTransfer(id, parsed.data.reason, session.userId);
    return NextResponse.json(apiSuccess(updated));
  } catch (error) {
    console.error("[POST .../cancel]", error);
    const msg = error instanceof Error ? error.message : "Erro ao cancelar";
    const status = /terminal/i.test(msg) ? 422 : 500;
    return NextResponse.json(apiError(msg), { status });
  }
}
