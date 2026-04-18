import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { getAuditList } from "@/services/audit.service";
import { DeviationClassification } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const { searchParams } = new URL(req.url);

    const storeId =
      session.role === "SELLER"
        ? session.storeId
        : searchParams.get("storeId") ?? undefined;

    const fromStr = searchParams.get("from");
    const toStr = searchParams.get("to");
    const classificationStr = searchParams.get("classification");
    const page = parseInt(searchParams.get("page") ?? "1");
    const pageSize = Math.min(parseInt(searchParams.get("pageSize") ?? "50"), 100);

    const result = await getAuditList({
      storeId,
      sellerId: searchParams.get("sellerId") ?? undefined,
      classification: classificationStr as DeviationClassification | undefined,
      from: fromStr ? new Date(fromStr) : undefined,
      to: toStr ? new Date(toStr) : undefined,
      onlyPendingJustification: searchParams.get("pendente") === "true",
      page,
      pageSize,
    });

    return NextResponse.json(apiSuccess(result));
  } catch (error) {
    console.error("[GET /api/auditoria/frete]", error);
    return NextResponse.json(apiError("Erro ao listar auditorias"), { status: 500 });
  }
}
