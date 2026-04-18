import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { getKPIs } from "@/services/audit.service";

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const { searchParams } = new URL(req.url);

    // período padrão: últimos 30 dias
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);

    const fromStr = searchParams.get("from");
    const toStr = searchParams.get("to");
    const storeId =
      session.role === "SELLER"
        ? session.storeId
        : searchParams.get("storeId") ?? undefined;

    const kpis = await getKPIs({
      storeId,
      from: fromStr ? new Date(fromStr) : thirtyDaysAgo,
      to: toStr ? new Date(toStr) : today,
    });

    return NextResponse.json(apiSuccess(kpis));
  } catch (error) {
    console.error("[GET /api/auditoria/kpis]", error);
    return NextResponse.json(apiError("Erro ao calcular KPIs"), { status: 500 });
  }
}
