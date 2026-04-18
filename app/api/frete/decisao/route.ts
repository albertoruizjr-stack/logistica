import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { makeFreightDecision } from "@/services/freight-decision.service";
import { apiSuccess, apiError } from "@/types";

const itemSchema = z.object({
  productCode: z.string(),
  quantity:    z.number().positive(),
  weightKg:    z.number().nonnegative(),
  latas:       z.number().nonnegative().optional(),
  volumeM3:    z.number().nonnegative().optional(),
});

const schema = z.object({
  originLat:           z.number(),
  originLng:           z.number(),
  destLat:             z.number(),
  destLng:             z.number(),
  isUrgent:            z.boolean().default(false),
  deliveryDate:        z.string().datetime(),
  deliveryWindowStart: z.string().datetime(),
  deliveryWindowEnd:   z.string().datetime(),
  items:               z.array(itemSchema).min(1),
  sellerId:            z.string(),
  storeId:             z.string(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json(apiError("Não autenticado", "UNAUTHORIZED"), { status: 401 });
    }

    const body   = await req.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
        { status: 400 }
      );
    }

    const input = {
      ...parsed.data,
      deliveryDate:        new Date(parsed.data.deliveryDate),
      deliveryWindowStart: new Date(parsed.data.deliveryWindowStart),
      deliveryWindowEnd:   new Date(parsed.data.deliveryWindowEnd),
    };

    const result = await makeFreightDecision(input);
    return NextResponse.json(apiSuccess(result));
  } catch (error) {
    console.error("[POST /api/frete/decisao]", error);
    return NextResponse.json(apiError("Erro ao calcular decisão de frete"), { status: 500 });
  }
}
