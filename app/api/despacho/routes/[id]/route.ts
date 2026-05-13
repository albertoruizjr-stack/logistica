import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { deleteRoute } from "@/services/route-dispatch.service";

const ALLOWED_ROLES = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"];

// DELETE /api/despacho/routes/[id]
// Exclui uma rota ainda não despachada. Reverte DRs para PRONTO_ROTEIRIZACAO
// e libera o motorista.
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    if (!ALLOWED_ROLES.includes(session.role)) {
      return NextResponse.json(apiError("Sem permissão", "FORBIDDEN"), { status: 403 });
    }

    const result = await deleteRoute(params.id, session.userId);
    return NextResponse.json(apiSuccess(result));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao excluir rota";
    console.error(`[DELETE /api/despacho/routes/${params.id}]`, err);
    return NextResponse.json(apiError(msg), { status: 400 });
  }
}
