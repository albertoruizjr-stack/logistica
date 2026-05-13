import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { advanceWave } from "@/services/routing-wave.service";

const ALLOWED_ROLES = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"];

// POST /api/roteirizacao/waves/[id]/advance
// Avança a wave para o próximo estado. Idempotente — pode ser chamado em loop.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    if (!ALLOWED_ROLES.includes(session.role)) {
      return NextResponse.json(apiError("Sem permissão", "FORBIDDEN"), { status: 403 });
    }

    const wave = await advanceWave(params.id);
    return NextResponse.json(apiSuccess(wave));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao avançar wave";
    console.error(`[POST /api/roteirizacao/waves/${params.id}/advance]`, err);
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
