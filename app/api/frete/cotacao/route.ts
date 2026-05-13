import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { calculateFreightQuote, saveFreightQuote } from "@/services/frete.service";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";

const DELIVERY_OPTIONS = ["SAME_DAY", "TOMORROW_FIRST", "TOMORROW_SECOND", "EXPRESS", "SCHEDULED"] as const;

const schema = z.object({
  storeId:        z.string(),
  originAddress:  z.string().min(1),
  originLat:      z.number(),
  originLng:      z.number(),
  destAddress:    z.string().min(1),
  destLat:        z.number(),
  destLng:        z.number(),
  deliveryOption: z.enum(DELIVERY_OPTIONS).default("TOMORROW_FIRST"),
  scheduledFor:   z.string().optional(),
  cutoffException: z.boolean().optional(),
  cutoffExceptionReason: z.string().optional(),
  city:           z.string().optional(),
  state:          z.string().optional(),
  quotedAddress:  z.string().optional(),
  // legado — mantido para compatibilidade com chamadas antigas
  isUrgent:       z.boolean().optional(),
  save:           z.boolean().optional(),
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

    // compatibilidade: se isUrgent=true e não tem deliveryOption, mapeia para EXPRESS
    let data = parsed.data;
    if (data.isUrgent && !body.deliveryOption) {
      data = { ...data, deliveryOption: "EXPRESS" };
    }

    const result = await calculateFreightQuote(data);

    // sempre salva — salvo quando chamada é explicitamente save=false (preview)
    if (data.save === false) {
      return NextResponse.json(apiSuccess(result));
    }

    const saved = await saveFreightQuote(data, result, session.userId);
    return NextResponse.json(apiSuccess({
      ...result,
      quoteId:   saved.id,
      zone:      saved.zone,
      expiresAt: saved.expiresAt?.toISOString(),
    }));
  } catch (error) {
    console.error("[POST /api/frete/cotacao]", error);
    return NextResponse.json(apiError("Erro ao calcular frete"), { status: 500 });
  }
}
