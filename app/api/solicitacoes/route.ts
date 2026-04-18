import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { DeliveryType } from "@prisma/client";
import { fetchInvoiceFromERP, fetchStockForItems } from "@/services/erp.service";
import { createTransfer } from "@/services/transferencia.service";
import { TransferPriority } from "@prisma/client";
import { createOrUpdateInitialAudit } from "@/services/audit.service";

const createSchema = z.object({
  invoiceNumber: z.string().min(1),
  storeId: z.string(),
  freightQuoteId: z.string().optional(),
  chargedFreight: z.number().optional(),
  deliveryType: z.nativeEnum(DeliveryType).default(DeliveryType.STANDARD),
  isComplete: z.boolean(),
  notes: z.string().optional(),
  scheduledFor: z.string().datetime().optional(),
  // itens com disponibilidade já verificada
  itemsAvailability: z.array(
    z.object({
      productCode: z.string(),
      productName: z.string(),
      quantity: z.number(),
      unit: z.string().default("UN"),
      availableAtStore: z.boolean(),
      sourceStoreId: z.string().optional(),
    })
  ).optional(),
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
        store: { select: { code: true, name: true } },
        seller: { select: { id: true, name: true } },
        freightQuote: { include: { zone: true } },
        items: true,
        transfers: {
          select: {
            id: true,
            status: true,
            priority: true,
            fromStoreId: true,
            toStoreId: true,
            requestedAt: true,
          },
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

    // busca dados do ERP para completar a solicitação
    const invoice = await fetchInvoiceFromERP(data.invoiceNumber);
    if (!invoice) {
      return NextResponse.json(
        apiError(`Nota fiscal ${data.invoiceNumber} não encontrada no ERP`, "NOT_FOUND"),
        { status: 404 }
      );
    }

    // verifica disponibilidade de estoque por item se não foi enviada
    const itemsWithAvailability = data.itemsAvailability ??
      (await fetchStockForItems(invoice.items)).map((r) => ({
        productCode: r.productCode,
        productName: r.productName,
        quantity: r.requestedQty,
        unit: "UN",
        availableAtStore: r.stock?.availability.find(
          (a) => a.storeCode === invoice.storeCode
        )?.available ?? false,
        sourceStoreId: undefined,
      }));

    const allAvailable = itemsWithAvailability.every((i) => i.availableAtStore);

    // cria a solicitação de entrega
    const deliveryRequest = await prisma.deliveryRequest.create({
      data: {
        invoiceNumber: data.invoiceNumber,
        storeId: data.storeId,
        sellerId: session.userId,
        customerId: invoice.customer.id,
        customerName: invoice.customer.name,
        customerPhone: invoice.customer.phone,
        customerDoc: invoice.customer.document,
        deliveryAddress: `${invoice.deliveryAddress.street}${invoice.deliveryAddress.complement ? `, ${invoice.deliveryAddress.complement}` : ""}, ${invoice.deliveryAddress.city}`,
        deliveryCity: invoice.deliveryAddress.city,
        deliveryType: data.deliveryType,
        isComplete: allAvailable,
        freightQuoteId: data.freightQuoteId,
        chargedFreight: data.chargedFreight,
        totalValue: invoice.totalValue,
        notes: data.notes,
        scheduledFor: data.scheduledFor ? new Date(data.scheduledFor) : undefined,
        status: allAvailable ? "PENDING" : "AWAITING_TRANSFER",
        items: {
          create: itemsWithAvailability.map((item) => ({
            productCode: item.productCode,
            productName: item.productName,
            quantity: item.quantity,
            unit: item.unit,
            availableAtStore: item.availableAtStore,
            sourceStoreId: item.sourceStoreId,
          })),
        },
      },
      include: {
        items: true,
        store: true,
      },
    });

    // se itens faltam, cria transferências automaticamente
    const missingItems = itemsWithAvailability.filter((i) => !i.availableAtStore);
    if (missingItems.length > 0) {
      // agrupa por loja de origem (simplificado — em produção sugeriria por item)
      await createTransfer({
        deliveryRequestId: deliveryRequest.id,
        fromStoreId: data.storeId, // operador refinará depois
        toStoreId: data.storeId,
        priority: data.deliveryType === DeliveryType.URGENT
          ? TransferPriority.URGENT
          : TransferPriority.ANTICIPATED,
        requestedById: session.userId,
        notes: `Transferência automática para NF ${data.invoiceNumber}`,
        items: missingItems.map((i) => ({
          productCode: i.productCode,
          productName: i.productName,
          quantity: i.quantity,
          unit: i.unit,
        })),
      });
    }

    // cria registro de auditoria de frete com desvio calculado
    if (data.freightQuoteId) {
      const quote = await prisma.freightQuote.findUnique({
        where: { id: data.freightQuoteId },
        select: {
          suggestedPrice: true,
          distanceKm: true,
          durationMinutes: true,
          isApproximate: true,
        },
      });

      await createOrUpdateInitialAudit({
        deliveryRequestId: deliveryRequest.id,
        storeId: deliveryRequest.storeId,
        invoiceNumber: deliveryRequest.invoiceNumber,
        sellerId: session.userId,
        suggestedFreight: quote?.suggestedPrice ?? undefined,
        chargedFreight: data.chargedFreight,
        distanceKm: quote?.distanceKm ?? undefined,
        durationMinutes: quote?.durationMinutes ?? undefined,
        isApproximate: quote?.isApproximate ?? undefined,
        totalValue: invoice.totalValue,
      });
    }

    return NextResponse.json(apiSuccess(deliveryRequest), { status: 201 });
  } catch (error: unknown) {
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json(
        apiError("Já existe uma solicitação para esta nota fiscal", "DUPLICATE"),
        { status: 409 }
      );
    }
    console.error("[POST /api/solicitacoes]", error);
    return NextResponse.json(apiError("Erro ao criar solicitação"), { status: 500 });
  }
}
