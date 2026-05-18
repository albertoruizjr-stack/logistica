import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { calculateFreightQuote, saveFreightQuote } from "@/services/frete.service";
import { getLalamoveQuote } from "@/services/lalamove.service";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";

const DELIVERY_OPTIONS = ["SAME_DAY", "TOMORROW_FIRST", "TOMORROW_SECOND", "EXPRESS", "SCHEDULED"] as const;
const EXPRESS_VEHICLES = ["MOTORCYCLE", "CAR"] as const;

const schema = z.object({
  storeId:        z.string(),
  originAddress:  z.string().min(1),
  originLat:      z.number(),
  originLng:      z.number(),
  destAddress:    z.string().min(1),
  destLat:        z.number(),
  destLng:        z.number(),
  deliveryOption: z.enum(DELIVERY_OPTIONS).default("TOMORROW_FIRST"),
  // Só usado quando deliveryOption=EXPRESS:
  //  - MOTORCYCLE: cota direto no Lalamove (mais barato em pacotes leves)
  //  - CAR/VAN:    usa expressBasePrice da tabela
  expressVehicle: z.enum(EXPRESS_VEHICLES).optional(),
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

    let result = await calculateFreightQuote(data);

    // Express + Moto: tenta cotação direta no Lalamove (mais barato em pacotes leves).
    // Se a chamada falhar (502, sem creds, timeout), cai pra tabela express com aviso.
    let lalamoveQuoteSource: "LALAMOVE_MOTORCYCLE" | null = null;
    let lalamoveWarning: string | undefined;
    if (data.deliveryOption === "EXPRESS" && data.expressVehicle === "MOTORCYCLE") {
      try {
        const quote = await getLalamoveQuote(
          { coordinates: { lat: String(data.originLat), lng: String(data.originLng) }, address: data.originAddress },
          { coordinates: { lat: String(data.destLat),   lng: String(data.destLng)   }, address: data.destAddress },
          true,
          "MOTORCYCLE",
        );
        if ("reason" in quote) {
          lalamoveWarning = `Lalamove indisponível: ${quote.reason}. Usando tabela express.`;
        } else {
          const total = parseFloat(quote.priceBreakdown.total);
          if (total > 0) {
            result = {
              ...result,
              suggestedPrice:      total,
              urgentFactor:        null,
              dispatchWindowLabel: "Entrega expressa — Lalamove Moto",
            };
            lalamoveQuoteSource = "LALAMOVE_MOTORCYCLE";
          } else {
            lalamoveWarning = "Lalamove retornou cotação zerada. Usando tabela express.";
          }
        }
      } catch (err) {
        console.warn("[frete/cotacao] Lalamove falhou, usando tabela express", err);
        lalamoveWarning = "Lalamove indisponível agora. Usando tabela express.";
      }
    }

    // sempre salva — salvo quando chamada é explicitamente save=false (preview)
    if (data.save === false) {
      return NextResponse.json(apiSuccess({ ...result, lalamoveQuoteSource, lalamoveWarning }));
    }

    const saved = await saveFreightQuote(data, result, session.userId);
    return NextResponse.json(apiSuccess({
      ...result,
      quoteId:   saved.id,
      zone:      saved.zone,
      expiresAt: saved.expiresAt?.toISOString(),
      lalamoveQuoteSource,
      lalamoveWarning,
    }));
  } catch (error) {
    console.error("[POST /api/frete/cotacao]", error);
    return NextResponse.json(apiError("Erro ao calcular frete"), { status: 500 });
  }
}
