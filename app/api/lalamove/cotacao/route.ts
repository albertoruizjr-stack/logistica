import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { buildLalamoveStops } from "@/lib/lalamove-dispatch";
import { getLalamoveQuote } from "@/services/lalamove.service";

const ROLES = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"];
const schema = z.object({ deliveryRequestId: z.string().min(1), serviceType: z.string().min(1) });

// POST /api/lalamove/cotacao → { quotationId, price, currency }
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    if (!ROLES.includes(session.role)) return NextResponse.json(apiError("Acesso restrito", "FORBIDDEN"), { status: 403 });

    const body = schema.safeParse(await req.json());
    if (!body.success) return NextResponse.json(apiError("Dados inválidos"), { status: 400 });

    const dr = await prisma.deliveryRequest.findUnique({
      where: { id: body.data.deliveryRequestId },
      select: { deliveryLat: true, deliveryLng: true, deliveryAddress: true, customerName: true, customerPhone: true,
                store: { select: { lat: true, lng: true, address: true, phone: true } } },
    });
    if (!dr) return NextResponse.json(apiError("Entrega não encontrada", "NOT_FOUND"), { status: 404 });

    const stops = buildLalamoveStops(dr.store, dr);
    if (!stops) return NextResponse.json(apiError("Entrega sem coordenadas — não dá pra cotar", "NO_COORDS"), { status: 422 });

    const quote = await getLalamoveQuote(stops.origin, stops.destination, false, body.data.serviceType);
    if ("reason" in quote) return NextResponse.json(apiError("Lalamove não configurado/indisponível", "LALAMOVE_OFF"), { status: 503 });

    return NextResponse.json(apiSuccess({
      quotationId: quote.quotationId,
      price: parseFloat(quote.priceBreakdown.total),
      currency: quote.priceBreakdown.currency ?? "BRL",
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao cotar";
    console.error("[POST /api/lalamove/cotacao]", err);
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
