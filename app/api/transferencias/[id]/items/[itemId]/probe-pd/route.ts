import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { probeInternalPdAcrossStores } from "@/services/internal-transfer.service";
import { PRIVILEGED_ROLES } from "@/lib/permissions";

// POST /api/transferencias/[id]/items/[itemId]/probe-pd
// Recebe o número do PD digitado pelo operador. Testa nas 5 lojas em paralelo
// e retorna a loja + dados do PD se for válido (cliente Atual Tintas + contém o produto).
// Não vincula — só descobre. O vínculo é feito chamando link-pd em seguida.

const schema = z.object({
  numeroPedido: z.string().min(1, "Informe o número do PD"),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    if (!PRIVILEGED_ROLES.includes(session.role as never)) {
      return NextResponse.json(apiError("Sem permissão", "FORBIDDEN"), { status: 403 });
    }

    const { id, itemId } = await params;
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(apiError("Informe o número do PD", "VALIDATION_ERROR"), { status: 400 });
    }

    const item = await prisma.transferItem.findFirst({
      where: { id: itemId, transferId: id },
      select: { id: true, productCode: true, productName: true },
    });
    if (!item) return NextResponse.json(apiError("Item não encontrado", "NOT_FOUND"), { status: 404 });

    const result = await probeInternalPdAcrossStores(parsed.data.numeroPedido, item.productCode);

    if (!result.ok) {
      return NextResponse.json(
        apiError(result.reason ?? "PD inválido", "PROBE_FAILED", { cabecalho: result.cabecalho }),
        { status: 422 },
      );
    }

    return NextResponse.json(apiSuccess({
      numeroPedido: result.cabecalho!.numeroPedido,
      storeCode:    result.cabecalho!.storeCode,
      clienteNome:  result.cabecalho!.clienteNome,
      clienteDoc:   result.cabecalho!.clienteDoc,
      itemMatch:    result.itemMatch,
    }));
  } catch (error) {
    console.error("[POST /api/transferencias/[id]/items/[itemId]/probe-pd]", error);
    return NextResponse.json(apiError("Erro ao buscar PD"), { status: 500 });
  }
}
