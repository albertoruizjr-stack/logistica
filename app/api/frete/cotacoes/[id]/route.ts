import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { updateQuoteStatus } from "@/services/frete.service";
import { apiSuccess, apiError } from "@/types";
import { FreightQuoteStatus } from "@prisma/client";

const schema = z.object({
  status: z.enum(["CONVERTED", "CANCELLED", "EXPIRED"]),
  reason: z.string().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json(apiError("Não autenticado", "UNAUTHORIZED"), { status: 401 });
    }

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(apiError("Dados inválidos", "VALIDATION_ERROR"), { status: 400 });
    }

    const { status } = parsed.data;
    const extra = status === "CONVERTED" ? { convertedAt: new Date() } : undefined;

    const updated = await updateQuoteStatus(
      params.id,
      status as FreightQuoteStatus,
      extra
    );

    return NextResponse.json(apiSuccess(updated));
  } catch (error) {
    console.error("[PATCH /api/frete/cotacoes/:id]", error);
    return NextResponse.json(apiError("Erro ao atualizar cotação"), { status: 500 });
  }
}
