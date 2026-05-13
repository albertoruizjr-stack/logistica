import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { getWaveDetail, deleteWave } from "@/services/routing-wave.service";

const ALLOWED_ROLES = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"];

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const wave = await getWaveDetail(params.id);
    if (!wave) return NextResponse.json(apiError("Wave não encontrada", "NOT_FOUND"), { status: 404 });

    return NextResponse.json(apiSuccess(wave));
  } catch (err) {
    console.error(`[GET /api/roteirizacao/waves/${params.id}]`, err);
    return NextResponse.json(apiError("Erro ao buscar wave"), { status: 500 });
  }
}

// DELETE /api/roteirizacao/waves/[id]
// Recusa waves DISPATCHED/COMPLETED. Reverte rotas ACTIVE antes de deletar.
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

    const result = await deleteWave(params.id, session.userId);
    return NextResponse.json(apiSuccess(result));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao excluir wave";
    console.error(`[DELETE /api/roteirizacao/waves/${params.id}]`, err);
    return NextResponse.json(apiError(msg), { status: 400 });
  }
}
