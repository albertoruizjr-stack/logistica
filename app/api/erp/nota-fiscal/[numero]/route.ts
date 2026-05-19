import { NextRequest, NextResponse } from "next/server";
import { fetchInvoiceFromERP } from "@/services/erp.service";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: { numero: string } }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json(apiError("Não autenticado", "UNAUTHORIZED"), { status: 401 });
    }

    // Resolve storeCode a partir do storeId (preferência) ou usa o da sessão.
    const storeIdParam = req.nextUrl.searchParams.get("storeId");
    const targetStoreId = storeIdParam ?? session.storeId;
    const store = await prisma.store.findUnique({
      where:  { id: targetStoreId },
      select: { code: true, codigoEmpresaCitel: true },
    });
    if (!store) {
      return NextResponse.json(apiError("Loja não encontrada", "NOT_FOUND"), { status: 404 });
    }
    // Citel aceita tanto code (ex: "067") quanto codigoEmpresaCitel; preferimos code
    // porque é o que está mais limpo no Autcom (codigoEmpresaCitel só populado em algumas lojas).
    const storeCode = store.code;

    const invoice = await fetchInvoiceFromERP(params.numero, storeCode);

    if (!invoice) {
      return NextResponse.json(
        apiError(`Nota fiscal ${params.numero} não encontrada na loja ${storeCode}`, "NOT_FOUND"),
        { status: 404 }
      );
    }

    return NextResponse.json(apiSuccess(invoice));
  } catch (error) {
    console.error("[GET /api/erp/nota-fiscal]", error);
    return NextResponse.json(apiError("Erro ao consultar ERP"), { status: 500 });
  }
}
