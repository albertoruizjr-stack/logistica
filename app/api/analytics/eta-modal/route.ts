// app/api/analytics/eta-modal/route.ts
// Retorna métricas de precisão: ETA previsto vs real, modal sugerido vs escolhido.

import { NextRequest, NextResponse }       from "next/server";
import { getSessionFromRequest }           from "@/lib/auth";
import { apiSuccess, apiError }            from "@/types";
import { getETAAccuracy, getModalAccuracy } from "@/services/analytics/eta-modal.service";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session || !["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"].includes(session.role)) {
    return NextResponse.json(apiError("Acesso restrito"), { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get("storeId") || undefined;

  // Período padrão: últimos 30 dias
  const to   = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (searchParams.get("from")) from.setTime(new Date(searchParams.get("from")!).getTime());
  if (searchParams.get("to"))   to.setTime(new Date(searchParams.get("to")!).getTime());

  try {
    const [eta, modal] = await Promise.all([
      getETAAccuracy({ from, to, storeId }),
      getModalAccuracy({ from, to, storeId }),
    ]);

    return NextResponse.json(apiSuccess({ eta, modal }));
  } catch (error) {
    console.error("[GET /api/analytics/eta-modal]", error);
    return NextResponse.json(apiError("Erro ao calcular métricas"), { status: 500 });
  }
}
