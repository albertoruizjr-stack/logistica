import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { corrigirPedido } from "@/services/corrigir-pedido.service";

const OPERATOR_ROLES = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR", "STOCK_OPERATOR", "STORE_LEADER"];

const schema = z.object({
  newOrderNumber: z.string().min(1, "Informe o número do pedido"),
  dryRun:         z.boolean().default(false),
});

const STATUS_BY_ERROR: Record<string, number> = {
  NOT_FOUND: 404, NOT_PENDING: 409, SAME_NUMBER: 400,
  DUPLICATE: 409, CITEL_DOWN: 503, ORDER_BLOCKED: 422, NO_ITEMS: 422,
};

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()), { status: 400 });
    }

    const dr = await prisma.deliveryRequest.findUnique({
      where: { id: params.id }, select: { sellerId: true },
    });
    if (!dr) return NextResponse.json(apiError("Solicitação não encontrada", "NOT_FOUND"), { status: 404 });
    const isOwner = dr.sellerId === session.userId;
    if (!OPERATOR_ROLES.includes(session.role) && !isOwner) {
      return NextResponse.json(apiError("Sem permissão para corrigir esta solicitação", "FORBIDDEN"), { status: 403 });
    }

    const result = await corrigirPedido({
      requestId:      params.id,
      newOrderNumber: parsed.data.newOrderNumber.trim(),
      actorId:        session.userId,
      dryRun:         parsed.data.dryRun,
    });

    if (!result.ok) {
      const status = STATUS_BY_ERROR[result.error ?? ""] ?? 400;
      return NextResponse.json(apiError(result.message ?? "Erro ao corrigir pedido", result.error), { status });
    }
    return NextResponse.json(apiSuccess({ preview: result.preview }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao corrigir pedido";
    console.error(`[PATCH /api/solicitacoes/${params.id}/corrigir-pedido]`, err);
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
