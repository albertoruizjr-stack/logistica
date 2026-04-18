import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { calculateFreightQuote, saveFreightQuote } from "@/services/frete.service";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";

const schema = z.object({
  storeId: z.string(),
  originAddress: z.string().min(1),
  originLat: z.number(),
  originLng: z.number(),
  destAddress: z.string().min(1),
  destLat: z.number(),
  destLng: z.number(),
  isUrgent: z.boolean().default(false),
  save: z.boolean().default(false), // se deve persistir no banco
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json(apiError("Não autenticado", "UNAUTHORIZED"), { status: 401 });
    }

    const body = await req.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
        { status: 400 }
      );
    }

    const result = await calculateFreightQuote(parsed.data);

    // persiste se solicitado (antes de criar a solicitação de entrega)
    if (parsed.data.save) {
      const saved = await saveFreightQuote(parsed.data, result, session.userId);
      return NextResponse.json(apiSuccess({ ...result, quoteId: saved.id, zone: saved.zone }));
    }

    return NextResponse.json(apiSuccess(result));
  } catch (error) {
    console.error("[POST /api/frete/cotacao]", error);
    return NextResponse.json(apiError("Erro ao calcular frete"), { status: 500 });
  }
}
