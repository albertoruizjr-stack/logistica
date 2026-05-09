import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { DeliveryType, DeliveryRequestStatus, TransferPriority } from "@prisma/client";
import { fetchOrderFromERP, fetchStockForItems } from "@/services/erp.service";
import { createTransfer } from "@/services/transferencia.service";
import { createOrUpdateInitialAudit } from "@/services/audit.service";
import { getDispatchWindow, isAfterFirstCutoff } from "@/lib/cutoff";

const createSchema = z.object({
  // identificação pelo Pedido (PD)
  orderNumber:   z.string().min(1, "Informe o número do pedido"),
  orderStoreId:  z.string().min(1, "Selecione a loja do pedido"),
  // dados da solicitação
  storeId:       z.string().min(1),
  freightQuoteId: z.string().optional(),
  chargedFreight: z.number().optional(),
  deliveryType:  z.nativeEnum(DeliveryType).default(DeliveryType.STANDARD),
  notes:         z.string().optional(),
  scheduledFor:  z.string().datetime().optional(),
  deliveryWindowStart: z.string().optional(), // "HH:MM"
  deliveryWindowEnd:   z.string().optional(), // "HH:MM"
  // dados do destinatário (sempre do vendedor)
  customerName:  z.string().min(2, "Informe o nome do destinatário"),
  customerPhone: z.string().min(8, "Informe o telefone do destinatário"),
  deliveryAddress: z.string().min(5, "Informe o endereço de entrega"),
  // janela de despacho — escolha do vendedor após aviso de corte
  dispatchWindowOverride: z.enum(["EXPRESS", "EXCEPTION"]).optional(),
  cutoffApprovalReason:   z.string().max(500).optional(),
  cutoffWarningShownAt:   z.string().datetime().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const storeId = searchParams.get("storeId") ||
      (session.role === "SELLER" ? session.storeId : undefined);

    const requests = await prisma.deliveryRequest.findMany({
      where: {
        ...(status ? { status: status as never } : {}),
        ...(storeId ? { storeId } : {}),
      },
      include: {
        store:      { select: { code: true, name: true } },
        orderStore: { select: { code: true } },
        seller:     { select: { id: true, name: true } },
        freightQuote: { include: { zone: true } },
        items: true,
        transfers: {
          select: { id: true, status: true, priority: true, fromStoreId: true, toStoreId: true, requestedAt: true },
        },
        dispatch: { select: { id: true, status: true, modal: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json(apiSuccess(requests));
  } catch (error) {
    console.error("[GET /api/solicitacoes]", error);
    return NextResponse.json(apiError("Erro ao listar solicitações"), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let orderKey: { orderNumber: string; orderStoreId: string } | null = null;

  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    }

    const body = await req.json();
    const parsed = createSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
        { status: 400 }
      );
    }

    const data = parsed.data;
    orderKey = { orderNumber: data.orderNumber, orderStoreId: data.orderStoreId };

    // Verifica duplicata antes de criar (evita erro 500 da constraint UNIQUE)
    const existing = await prisma.deliveryRequest.findFirst({
      where: { orderNumber: data.orderNumber, orderStoreId: data.orderStoreId },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        apiError("Já existe uma solicitação de entrega para este pedido", "DUPLICATE", { existingId: existing.id }),
        { status: 409 }
      );
    }

    // Busca loja do pedido para obter o código (necessário para consulta ERP)
    const orderStore = await prisma.store.findUnique({
      where: { id: data.orderStoreId },
      select: { code: true },
    });

    if (!orderStore) {
      return NextResponse.json(apiError("Loja do pedido não encontrada"), { status: 400 });
    }

    // Lookup no ERP: opcional e não-bloqueante
    // Se encontrar o PD, enriquece dados de itens para verificar estoque
    const erpOrder = await fetchOrderFromERP(data.orderNumber, orderStore.code).catch(() => null);

    // Verifica disponibilidade de estoque só se o ERP retornou itens
    const itemsWithAvailability = erpOrder?.items.length
      ? (await fetchStockForItems(erpOrder.items)).map((r) => ({
          productCode:     r.productCode,
          productName:     r.productName,
          quantity:        r.requestedQty,
          unit:            "UN",
          availableAtStore: r.stock?.availability.find((a) => a.storeCode === orderStore.code)?.available ?? false,
          sourceStoreId:   undefined as string | undefined,
        }))
      : [];

    const allAvailable = itemsWithAvailability.length > 0 &&
      itemsWithAvailability.every((i) => i.availableAtStore);

    const initialStatus: DeliveryRequestStatus = itemsWithAvailability.length === 0
      ? DeliveryRequestStatus.PENDING           // sem itens do ERP: operador define depois
      : allAvailable
        ? DeliveryRequestStatus.PENDING
        : DeliveryRequestStatus.AWAITING_TRANSFER;

    // Calcula a janela de despacho com base no horário atual (Brasília) + override do vendedor
    const now = new Date();
    const dispatchWindow = getDispatchWindow(now, data.deliveryType, data.dispatchWindowOverride);
    const afterCutoff = isAfterFirstCutoff(now);

    const deliveryRequest = await prisma.deliveryRequest.create({
      data: {
        orderNumber:      data.orderNumber,
        orderStoreId:     data.orderStoreId,
        invoiceNumber:    null,                 // preenchida depois pelo CD
        invoiceStoreId:   null,
        storeId:          data.storeId,
        sellerId:         session.userId,
        customerName:     data.customerName,
        customerPhone:    data.customerPhone,
        deliveryAddress:  data.deliveryAddress,
        deliveryWindowStart: data.deliveryWindowStart,
        deliveryWindowEnd:   data.deliveryWindowEnd,
        deliveryType:     data.deliveryType,
        isComplete:       allAvailable,
        freightQuoteId:   data.freightQuoteId,
        chargedFreight:   data.chargedFreight,
        totalValue:       erpOrder?.totalValue ?? null,
        notes:            data.notes,
        scheduledFor:     data.scheduledFor ? new Date(data.scheduledFor) : undefined,
        status:           initialStatus,
        // janela de despacho
        dispatchWindow,
        cutoffWarningShownAt: afterCutoff && data.cutoffWarningShownAt
          ? new Date(data.cutoffWarningShownAt)
          : null,
        cutoffApprovalReason: data.dispatchWindowOverride === "EXCEPTION"
          ? (data.cutoffApprovalReason ?? null)
          : null,
        items: itemsWithAvailability.length > 0
          ? {
              create: itemsWithAvailability.map((item) => ({
                productCode:      item.productCode,
                productName:      item.productName,
                quantity:         item.quantity,
                unit:             item.unit,
                availableAtStore: item.availableAtStore,
                sourceStoreId:    item.sourceStoreId,
              })),
            }
          : undefined,
      },
      include: { items: true, store: true },
    });

    // Cria transferências automáticas para itens faltantes (só quando veio do ERP)
    const missingItems = itemsWithAvailability.filter((i) => !i.availableAtStore);
    if (missingItems.length > 0) {
      await createTransfer({
        deliveryRequestId: deliveryRequest.id,
        fromStoreId:       data.storeId,
        toStoreId:         data.storeId,
        priority:          data.deliveryType === DeliveryType.URGENT
          ? TransferPriority.URGENT
          : TransferPriority.ANTICIPATED,
        requestedById:     session.userId,
        notes:             `Transferência automática para PD ${data.orderNumber}`,
        items:             missingItems.map((i) => ({
          productCode:  i.productCode,
          productName:  i.productName,
          quantity:     i.quantity,
          unit:         i.unit,
        })),
      });
    }

    // Auditoria de frete
    if (data.freightQuoteId) {
      const quote = await prisma.freightQuote.findUnique({
        where: { id: data.freightQuoteId },
        select: { suggestedPrice: true, distanceKm: true, durationMinutes: true, isApproximate: true },
      });
      await createOrUpdateInitialAudit({
        deliveryRequestId: deliveryRequest.id,
        storeId:           deliveryRequest.storeId,
        invoiceNumber:     deliveryRequest.orderNumber ?? deliveryRequest.id,
        sellerId:          session.userId,
        suggestedFreight:  quote?.suggestedPrice ?? undefined,
        chargedFreight:    data.chargedFreight,
        distanceKm:        quote?.distanceKm ?? undefined,
        durationMinutes:   quote?.durationMinutes ?? undefined,
        isApproximate:     quote?.isApproximate ?? undefined,
        totalValue:        erpOrder?.totalValue ?? undefined,
      });
    }

    return NextResponse.json(apiSuccess(deliveryRequest), { status: 201 });
  } catch (error: unknown) {
    if ((error as { code?: string }).code === "P2002") {
      const raceDupe = orderKey
        ? await prisma.deliveryRequest.findFirst({
            where: orderKey,
            select: { id: true },
          }).catch(() => null)
        : null;
      return NextResponse.json(
        apiError(
          "Já existe uma solicitação de entrega para este pedido",
          "DUPLICATE",
          raceDupe ? { existingId: raceDupe.id } : undefined
        ),
        { status: 409 }
      );
    }
    console.error("[POST /api/solicitacoes]", error);
    return NextResponse.json(apiError("Erro ao criar solicitação"), { status: 500 });
  }
}
