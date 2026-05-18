import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { calculateFreightQuote, saveFreightQuote } from "@/services/frete.service";
import { getLalamoveQuote } from "@/services/lalamove.service";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";

const DELIVERY_OPTIONS = ["SAME_DAY", "TOMORROW_FIRST", "TOMORROW_SECOND", "EXPRESS", "SCHEDULED"] as const;
// ServiceTypes oficiais Lalamove BR (2026) — todos cotam direto na API deles.
const EXPRESS_VEHICLES = ["LALAPRO", "UV_FIORINO", "VAN", "TRUCK330", "TRUCK3_5T"] as const;

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

    // EXPRESS: para QUALQUER veículo escolhido, cota direto no Lalamove.
    // Cada serviceType (LALAPRO, UV_FIORINO, VAN, TRUCK330, TRUCK3_5T) tem
    // preço próprio na frota Lalamove. Se a chamada falhar, cai pra tabela
    // express com aviso (lalamoveWarning) que a UI pode exibir.
    const LABELS: Record<string, string> = {
      LALAPRO:    "Moto (LalaPro)",
      UV_FIORINO: "Utilitário Fiorino",
      VAN:        "Van",
      TRUCK330:   "Carreto",
      TRUCK3_5T:  "Caminhão 2,5t",
    };
    let lalamoveQuoteSource: string | null = null;
    let lalamoveWarning: string | undefined;
    if (data.deliveryOption === "EXPRESS" && data.expressVehicle) {
      try {
        const quote = await getLalamoveQuote(
          { coordinates: { lat: String(data.originLat), lng: String(data.originLng) }, address: data.originAddress },
          { coordinates: { lat: String(data.destLat),   lng: String(data.destLng)   }, address: data.destAddress },
          true,
          data.expressVehicle,
        );
        if ("reason" in quote) {
          lalamoveWarning = `Lalamove indisponível: ${quote.reason}. Usando tabela express.`;
        } else {
          const total = parseFloat(quote.priceBreakdown.total);
          if (total > 0) {
            const label = LABELS[data.expressVehicle] ?? data.expressVehicle;
            result = {
              ...result,
              suggestedPrice:      total,
              urgentFactor:        null,
              dispatchWindowLabel: `Entrega expressa — Lalamove ${label}`,
            };
            lalamoveQuoteSource = `LALAMOVE_${data.expressVehicle}`;
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
