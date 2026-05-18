import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { checkSingleRequest } from "@/services/nf-link.service";

const ALLOWED_ROLES = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR", "STOCK_OPERATOR", "STORE_LEADER"];

// POST /api/solicitacoes/[id]/check-nf
// Força uma verificação imediata da NF no Citel para uma DR específica.
// Diferente do cron batch, não respeita backoff — operador pediu, consulta agora.
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

    const result = await checkSingleRequest(params.id);
    return NextResponse.json(apiSuccess(result));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao verificar NF";
    console.error(`[POST /api/solicitacoes/${params.id}/check-nf]`, err);
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
