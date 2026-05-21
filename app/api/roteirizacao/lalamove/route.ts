import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { createDispatch } from "@/services/despacho.service";
import { dispatchViaLalamove } from "@/lib/lalamove-dispatch";
import { geocodeAddress } from "@/lib/google-maps";
import { DispatchModal } from "@prisma/client";

const ROLES = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"];
const schema = z.object({
  deliveryRequestId: z.string().min(1),
  serviceType:       z.string().min(1),
  quotationId:       z.string().optional(),
  estimatedPrice:    z.number().optional(),
});

// POST /api/roteirizacao/lalamove → cria a CORRIDA no Lalamove e SÓ DEPOIS o Dispatch.
// Ordem invertida de propósito: se o pedido falhar, a entrega continua
// PRONTO_ROTEIRIZACAO (elegível) e o operador vê o erro real — sem despacho fantasma.
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    if (!ROLES.includes(session.role)) return NextResponse.json(apiError("Acesso restrito", "FORBIDDEN"), { status: 403 });

    const body = schema.safeParse(await req.json());
    if (!body.success) return NextResponse.json(apiError("Dados inválidos"), { status: 400 });

    const dr = await prisma.deliveryRequest.findUnique({
      where: { id: body.data.deliveryRequestId },
      select: {
        id: true,
        status: true,
        storeId: true,
        deliveryLat: true,
        deliveryLng: true,
        deliveryAddress: true,
        customerName: true,
        customerPhone: true,
        store: { select: { lat: true, lng: true, address: true, phone: true } },
      },
    });
    if (!dr) return NextResponse.json(apiError("Entrega não encontrada", "NOT_FOUND"), { status: 404 });
    if (dr.status !== "PRONTO_ROTEIRIZACAO") {
      return NextResponse.json(apiError(`Entrega não está elegível (status ${dr.status})`, "NOT_ELIGIBLE"), { status: 409 });
    }

    // Garante coordenadas: a roteirização interna não exige lat/lng, então a entrega
    // pode chegar aqui sem elas. O Lalamove precisa — geocodifica e persiste (uma vez).
    let deliveryLat = dr.deliveryLat;
    let deliveryLng = dr.deliveryLng;
    if ((deliveryLat == null || deliveryLng == null) && dr.deliveryAddress) {
      const geo = await geocodeAddress(dr.deliveryAddress);
      if (geo) {
        deliveryLat = geo.lat;
        deliveryLng = geo.lng;
        await prisma.deliveryRequest.update({
          where: { id: dr.id },
          data:  { deliveryLat, deliveryLng },
        });
      }
    }
    if (deliveryLat == null || deliveryLng == null) {
      return NextResponse.json(
        apiError("Não foi possível localizar o endereço da entrega no mapa — confira o endereço.", "NO_COORDS"),
        { status: 422 }
      );
    }

    const deliveryInfoWithCoords = {
      deliveryLat,
      deliveryLng,
      deliveryAddress: dr.deliveryAddress,
      customerName: dr.customerName,
      customerPhone: dr.customerPhone,
    };

    // 1) Cria a CORRIDA primeiro. (dispatchViaLalamove monta os stops e chama
    //    createLalamoveOrder; com quotationId, pula a recotação.)
    let order;
    try {
      order = await dispatchViaLalamove(dr.store, deliveryInfoWithCoords, {
        serviceType:    body.data.serviceType,
        quotationId:    body.data.quotationId,
        estimatedPrice: body.data.estimatedPrice,
      });
    } catch (e) {
      return NextResponse.json(
        apiError(e instanceof Error ? e.message : "Falha ao criar corrida no Lalamove", "LALAMOVE_ORDER_FAILED"),
        { status: 502 }
      );
    }
    if (!order) {
      return NextResponse.json(
        apiError("Não foi possível criar a corrida (sem coordenadas ou Lalamove indisponível).", "LALAMOVE_ORDER_FAILED"),
        { status: 502 }
      );
    }

    // 2) Só com a corrida criada, cria o Dispatch repassando o pedido pré-criado.
    const dispatch = await createDispatch({
      deliveryRequestId: dr.id,
      storeId:           dr.storeId,
      modal:             DispatchModal.LALAMOVE,
      dispatchedById:    session.userId,
      estimatedCost:     order.estimatedPrice,
      notes:             `Lalamove ${body.data.serviceType} via roteirização`,
      lalamovePrecreated: {
        lalamoveOrderId: order.lalamoveOrderId,
        quotationId:     order.quotationId,
        estimatedPrice:  order.estimatedPrice,
        shareLink:       order.shareLink,
      },
    });

    return NextResponse.json(apiSuccess({
      dispatchId:      dispatch.id,
      lalamoveOrderId: order.lalamoveOrderId,
      shareLink:       order.shareLink,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao chamar Lalamove";
    console.error("[POST /api/roteirizacao/lalamove]", err);
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
