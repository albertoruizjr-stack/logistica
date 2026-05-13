import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { getOperationalQueue } from "@/services/operacao.service";

export async function GET(req: Request) {
  try {
    const session = await getSessionFromRequest(req as Parameters<typeof getSessionFromRequest>[0]);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    if (!["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"].includes(session.role)) {
      return NextResponse.json(apiError("Acesso restrito"), { status: 403 });
    }

    const queue = await getOperationalQueue();
    return NextResponse.json(apiSuccess(queue));
  } catch (error) {
    console.error("[GET /api/operacao/queue]", error);
    return NextResponse.json(apiError("Erro ao carregar fila operacional"), { status: 500 });
  }
}
