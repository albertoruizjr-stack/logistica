import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { syncDriversFromSpoke } from "@/services/routing-wave.service";

const ALLOWED_ROLES = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"];

// POST /api/roteirizacao/drivers/sync
// Importa motoristas do Spoke (Circuit) para o banco local.
// Idempotente: roda quantas vezes for necessário.
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    if (!ALLOWED_ROLES.includes(session.role)) {
      return NextResponse.json(apiError("Sem permissão", "FORBIDDEN"), { status: 403 });
    }

    const result = await syncDriversFromSpoke();
    return NextResponse.json(apiSuccess(result));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao sincronizar motoristas";
    console.error("[POST /api/roteirizacao/drivers/sync]", err);
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
