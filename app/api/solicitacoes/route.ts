import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { DeliveryType, DeliveryRequestStatus, TransferPriority, TransferStatus } from "@prisma/client";
import { enrichDeliveryRequestStock, calculateDeliveryVolumeRules } from "@/services/citel-stock.service";
import { findAutoLinkCandidatesWithProbe } from "@/services/internal-transfer.service";
import { createOrUpdateInitialAudit } from "@/services/audit.service";
import { notifyTransferCreated } from "@/services/notifications.service";
import { getDispatchWindow, isAfterFirstCutoff, isAfterSecondCutoff } from "@/lib/cutoff";
import { recordSameDayException } from "@/services/audit.service";

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
  // janela de despacho 17h30 — escolha do vendedor após aviso de corte
  dispatchWindowOverride: z.enum(["EXPRESS", "EXCEPTION"]).optional(),
  cutoffApprovalReason:   z.string().max(500).optional(),
  cutoffWarningShownAt:   z.string().datetime().optional(),
  // corte same-day 12h00 — entrega urgente após o horário limite
  sameDayRequested:       z.boolean().optional(),
  sameDayApprovalReason:  z.string().max(500).optional(),
  // restrição geográfica SP — informado pelo frontend após geocoding
  deliveryState:          z.string().length(2).optional(), // "SP", "RJ", etc.
  outsideSPOverrideReason: z.string().max(500).optional(), // obrigatório quando fora de SP
  // snapshots de endereço e status ERP — capturados pelo drawer no momento da consulta
  customerAddressSnapshot:  z.string().optional(), // JSON: CitelEndereco do cliente
  deliveryAddressSnapshot:  z.string().optional(), // JSON: CitelEndereco efetivo
  deliveryAddressSource:    z.enum(["ORDER_DELIVERY_ADDRESS", "CUSTOMER_MAIN_ADDRESS", "MANUAL_OVERRIDE"]).optional(),
  deliveryAddressOriginal:  z.string().optional(), // endereço antes de override manual
  erpOrderStatus:           z.string().optional(), // status bruto Citel
  erpOrderValidationStatus: z.string().optional(), // VALID | CANCELLED | ...
  // CPF/CNPJ do cliente (da Citel)
  customerDoc:              z.string().optional(),
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

    // Gate geográfico: endereço fora de SP exige permissão de ADMIN/OPERATOR + justificativa
    if (data.deliveryState && data.deliveryState !== "SP") {
      const canOverride = ["ADMIN", "OPERATOR", "STOCK_OPERATOR", "LOGISTICS_OPERATOR", "STORE_LEADER"].includes(session.role);
      if (!canOverride) {
        return NextResponse.json(
          apiError(
            `Endereço em ${data.deliveryState} está fora da área de entrega. Solicite ao operador para liberar manualmente.`,
            "OUTSIDE_SP"
          ),
          { status: 422 }
        );
      }
      if (!data.outsideSPOverrideReason) {
        return NextResponse.json(
          apiError(
            "Informe a justificativa para entrega fora de SP.",
            "OUTSIDE_SP_REASON_REQUIRED"
          ),
          { status: 422 }
        );
      }
    }

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

    // Busca loja do pedido para obter código e codigoEmpresaCitel (necessário para Citel)
    const orderStore = await prisma.store.findUnique({
      where: { id: data.orderStoreId },
      select: { code: true, codigoEmpresaCitel: true },
    });

    if (!orderStore) {
      return NextResponse.json(apiError("Loja do pedido não encontrada"), { status: 400 });
    }

    // Consulta Citel: não-bloqueante — se indisponível, marca CITEL_DOWN e continua
    const citelResult = orderStore.codigoEmpresaCitel
      ? await enrichDeliveryRequestStock(
          data.orderNumber,
          orderStore.code,
          orderStore.codigoEmpresaCitel
        ).catch(() => null)
      : null;

    const citelDown = citelResult === null;

    // Monta itens para criação — usa dados reais da Citel quando disponíveis
    const itemsWithAvailability = citelResult?.items.map((item) => ({
      productCode:      item.productCode,
      productName:      item.description ?? item.productCode,
      quantity:         item.quantity,
      unit:             item.unit,
      description:      item.description,
      brand:            item.brand,
      barcode:          item.barcode,
      grossWeight:      item.grossWeight,
      totalWeight:      item.totalWeight,
      hasMissingWeight: item.hasMissingWeight,
      availableStock:   item.availableStock,
      physicalStock:    item.physicalStock,
      stockStatus:      item.stockStatus,
      fetchedAt:        new Date(),
      availableAtStore: item.availableAtStore,
      sourceStoreId:    item.sourceStoreId ?? undefined,
    })) ?? [];

    const allAvailable = itemsWithAvailability.length > 0 &&
      itemsWithAvailability.every((i) => i.availableAtStore);

    // Se Citel caiu, não bloqueamos criação — operador valida manualmente depois
    const initialStatus: DeliveryRequestStatus = citelDown || itemsWithAvailability.length === 0
      ? DeliveryRequestStatus.PENDING
      : allAvailable
        ? DeliveryRequestStatus.PENDING
        : DeliveryRequestStatus.AWAITING_TRANSFER;

    // Calcula a janela de despacho com base no horário atual (Brasília) + override do vendedor
    const now = new Date();
    const dispatchWindow = getDispatchWindow(now, data.deliveryType, data.dispatchWindowOverride);
    const afterCutoff = isAfterFirstCutoff(now);
    const afterSameDayCutoff = isAfterSecondCutoff(now);

    // Gate same-day: URGENT após 12h exige EXPRESS ou justificativa de exceção
    const isSameDayRequest = data.deliveryType === DeliveryType.URGENT;
    if (isSameDayRequest && afterSameDayCutoff && data.dispatchWindowOverride !== "EXPRESS") {
      if (!data.sameDayApprovalReason) {
        return NextResponse.json(
          apiError(
            "Após 12h00, entregas urgentes precisam de entrega expressa (Lalamove) ou justificativa de exceção operacional.",
            "SAME_DAY_CUTOFF"
          ),
          { status: 422 }
        );
      }
    }

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
        totalValue:       null,
        // totais calculados pelo snapshot Citel
        totalWeightKg:         citelResult?.totalWeightKg ?? null,
        totalLatas:            citelResult?.totalLatas    ?? null,
        hasMissingWeights:     citelResult?.hasMissingWeights ?? false,
        stockValidationStatus: citelDown ? "CITEL_DOWN" : (citelResult?.stockValidationStatus ?? "PENDING"),
        stockFetchedAt:        citelResult ? new Date() : null,
        notes:            data.notes,
        scheduledFor:     data.scheduledFor ? new Date(data.scheduledFor) : undefined,
        status:           initialStatus,
        // janela de despacho (corte 17h30)
        dispatchWindow,
        cutoffWarningShownAt: afterCutoff && data.cutoffWarningShownAt
          ? new Date(data.cutoffWarningShownAt)
          : null,
        cutoffApprovalReason: data.dispatchWindowOverride === "EXCEPTION"
          ? (data.cutoffApprovalReason ?? null)
          : null,
        // SLA e corte same-day (12h00)
        slaType: data.dispatchWindowOverride === "EXPRESS"
          ? "EXPRESS"
          : isSameDayRequest ? "URGENT" : "STANDARD",
        sameDayRequested: isSameDayRequest && afterSameDayCutoff && !!data.sameDayApprovalReason,
        sameDayApprovalReason: isSameDayRequest && afterSameDayCutoff
          ? (data.sameDayApprovalReason ?? null)
          : null,
        sameDayRequestedAt: isSameDayRequest && afterSameDayCutoff && data.sameDayApprovalReason
          ? now
          : null,
        // restrição geográfica SP
        deliveryState:          data.deliveryState ?? null,
        outsideSPApproved:      !!(data.deliveryState && data.deliveryState !== "SP" && data.outsideSPOverrideReason),
        outsideSPApprovedBy:    data.deliveryState !== "SP" && data.outsideSPOverrideReason ? session.userId : null,
        outsideSPApprovalReason: data.outsideSPOverrideReason ?? null,
        outsideSPApprovedAt:    data.deliveryState !== "SP" && data.outsideSPOverrideReason ? now : null,
        items: itemsWithAvailability.length > 0
          ? {
              create: itemsWithAvailability.map((item) => ({
                productCode:      item.productCode,
                productName:      item.productName,
                quantity:         item.quantity,
                unit:             item.unit,
                description:      item.description,
                brand:            item.brand,
                barcode:          item.barcode,
                grossWeight:      item.grossWeight,
                totalWeight:      item.totalWeight,
                hasMissingWeight: item.hasMissingWeight,
                availableStock:   item.availableStock,
                physicalStock:    item.physicalStock,
                stockStatus:      item.stockStatus,
                fetchedAt:        item.fetchedAt,
                availableAtStore: item.availableAtStore,
                sourceStoreId:    item.sourceStoreId,
              })),
            }
          : undefined,
      },
      include: { items: true, store: true },
    });

    // Salva snapshots de endereço e status ERP (campos adicionados em migrate-delivery-address-v1.mjs)
    // Feito via raw SQL para não depender de prisma generate após a migration.
    if (data.customerAddressSnapshot || data.erpOrderStatus) {
      await prisma.$executeRawUnsafe(
        `UPDATE delivery_requests SET
          "customerAddressSnapshot"  = $1,
          "deliveryAddressSnapshot"  = $2,
          "deliveryAddressSource"    = $3,
          "deliveryAddressOriginal"  = $4,
          "erpOrderStatus"           = $5,
          "erpOrderValidationStatus" = $6
        WHERE id = $7`,
        data.customerAddressSnapshot ?? null,
        data.deliveryAddressSnapshot ?? null,
        data.deliveryAddressSource ?? null,
        data.deliveryAddressOriginal ?? null,
        data.erpOrderStatus ?? null,
        data.erpOrderValidationStatus ?? null,
        deliveryRequest.id
      ).catch(() => {
        // Não-bloqueante: se a migration ainda não rodou, ignora silenciosamente
      });
    }

    // Registra exceção same-day para auditoria e alertas operacionais
    if (isSameDayRequest && afterSameDayCutoff && data.sameDayApprovalReason) {
      await recordSameDayException({
        deliveryRequestId: deliveryRequest.id,
        sellerId: session.userId,
        approvalReason: data.sameDayApprovalReason,
        requestedAt: now,
      });
    }

    // Cria transferências automáticas para itens com estoque insuficiente na loja.
    // NÃO-BLOQUEANTE: se a criação da transferência falhar (ex: validação de estoque,
    // origem/destino iguais, etc.), a solicitação já foi salva com status AWAITING_TRANSFER
    // e Jane pode criar a transferência manualmente. Logamos o erro e notificamos.
    const missingItems = itemsWithAvailability.filter((i) => !i.availableAtStore);
    if (missingItems.length > 0 && !citelDown) {
      // Cria a Transfer direto via Prisma. Não usamos createTransfer() do service
      // porque ele valida estoque na loja origem — e neste momento a origem real
      // é DESCONHECIDA (vai ser uma das outras 4 lojas, descoberta quando o Jhow
      // vincular o PD interno no Autcom). Por isso fromStore = toStore = loja
      // do vendedor como placeholder; o link-pd corrige depois.
      let transferId = "";
      try {
        const priority = data.deliveryType === DeliveryType.URGENT
          ? TransferPriority.URGENT
          : TransferPriority.ANTICIPATED;
        const t = await prisma.$transaction(async (tx) => {
          const created = await tx.transfer.create({
            data: {
              deliveryRequestId: deliveryRequest.id,
              fromStoreId:       data.storeId,
              toStoreId:         data.storeId,
              priority,
              status:            TransferStatus.PENDING,
              requestedById:     session.userId,
              notes:             `Transferência automática para PD ${data.orderNumber}`,
              items: {
                create: missingItems.map((i) => ({
                  productCode: i.productCode,
                  productName: i.productName,
                  quantity:    i.quantity,
                  unit:        i.unit,
                })),
              },
            },
            include: { items: { select: { id: true, productCode: true, quantity: true } } },
          });
          await tx.transferHistory.create({
            data: {
              transferId:  created.id,
              toStatus:    TransferStatus.PENDING,
              changedById: session.userId,
              notes:       "Transferência criada — aguardando vínculo com PD interno do Autcom",
            },
          });
          return created;
        });
        transferId = t.id;

        // Auto-vínculo: para cada item, busca PDs candidatos e vincula o mais recente
        await Promise.all(t.items.map(async (ti) => {
          try {
            const cands = await findAutoLinkCandidatesWithProbe(ti.productCode, ti.quantity);
            if (cands.length === 0) return;
            const best = cands[0];
            await prisma.transferItem.update({
              where: { id: ti.id },
              data: {
                linkedCitelPD:        best.numeroDocumento,
                linkedCitelStoreCode: best.codigoEmpresa,
                linkedAt:             new Date(),
                linkedById:           session.userId,
              },
            });
          } catch (e) {
            console.warn(`[POST solicitacoes] auto-link falhou pra ${ti.productCode}:`, e instanceof Error ? e.message : e);
          }
        }));
      } catch (err) {
        console.warn(
          `[POST /api/solicitacoes] falha ao criar Transfer placeholder para PD ${data.orderNumber}: ` +
          (err instanceof Error ? err.message : String(err)),
        );
      }

      // Notifica Jhow + Jane (gatilho #1) — independente de a Transfer ter sido criada
      void notifyTransferCreated({
        transferId,
        deliveryRequestId: deliveryRequest.id,
        orderNumber:       data.orderNumber,
        storeCode:         orderStore.code,
        itemCount:         missingItems.length,
        fromStoreCode:     orderStore.code,
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
        totalValue:        undefined,
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
