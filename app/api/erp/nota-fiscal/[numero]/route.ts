import { NextRequest, NextResponse } from "next/server";
import { fetchInvoiceFromERP } from "@/services/erp.service";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";

export async function GET(
  req: NextRequest,
  { params }: { params: { numero: string } }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json(apiError("Não autenticado", "UNAUTHORIZED"), { status: 401 });
    }

    const invoice = await fetchInvoiceFromERP(params.numero);

    if (!invoice) {
      return NextResponse.json(
        apiError(`Nota fiscal ${params.numero} não encontrada`, "NOT_FOUND"),
        { status: 404 }
      );
    }

    return NextResponse.json(apiSuccess(invoice));
  } catch (error) {
    console.error("[GET /api/erp/nota-fiscal]", error);
    return NextResponse.json(apiError("Erro ao consultar ERP"), { status: 500 });
  }
}
