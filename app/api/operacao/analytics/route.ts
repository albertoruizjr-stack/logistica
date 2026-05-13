import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { getAnalyticsSummary, type AnalyticsPeriod } from "@/services/analytics.service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    if (!["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"].includes(session.role)) {
      return NextResponse.json(apiError("Acesso restrito"), { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const period = (searchParams.get("period") ?? "week") as AnalyticsPeriod;

    const summary = await getAnalyticsSummary(period);
    return NextResponse.json(apiSuccess(summary));
  } catch (error) {
    console.error("[GET /api/operacao/analytics]", error);
    return NextResponse.json(apiError("Erro ao carregar analytics"), { status: 500 });
  }
}
