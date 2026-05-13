import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { listFreightQuotes } from "@/services/frete.service";
import { apiSuccess, apiError } from "@/types";
import { FreightQuoteStatus } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json(apiError("Não autenticado", "UNAUTHORIZED"), { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const mine   = searchParams.get("mine") === "true";
    const storeId = searchParams.get("storeId") ?? undefined;
    const search  = searchParams.get("search") ?? undefined;
    const page    = parseInt(searchParams.get("page") ?? "1", 10);
    const rawStatus = searchParams.get("status");

    let status: FreightQuoteStatus | FreightQuoteStatus[] | undefined;
    if (rawStatus === "open") {
      status = [FreightQuoteStatus.DRAFT, FreightQuoteStatus.QUOTED];
    } else if (rawStatus && Object.values(FreightQuoteStatus).includes(rawStatus as FreightQuoteStatus)) {
      status = rawStatus as FreightQuoteStatus;
    }

    const result = await listFreightQuotes({
      userId:  mine ? session.userId : undefined,
      storeId: session.role === "ADMIN" || session.role === "OPERATOR" || session.role === "STOCK_OPERATOR" || session.role === "LOGISTICS_OPERATOR"
        ? storeId
        : session.storeId,
      status,
      search,
      page,
    });

    return NextResponse.json(apiSuccess(result));
  } catch (error) {
    console.error("[GET /api/frete/cotacoes]", error);
    return NextResponse.json(apiError("Erro ao listar cotações"), { status: 500 });
  }
}
