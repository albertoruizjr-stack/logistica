// Corrige o número do pedido (PD) de uma solicitação PENDENTE, re-buscando os dados
// do pedido correto no Citel. Em dryRun retorna só o preview; senão aplica numa transação.
import { prisma } from "@/lib/prisma";
import { isCitelConfigured, fetchPedidoCabecalho } from "@/services/citel.service";
import { enrichDeliveryRequestStock } from "@/services/citel-stock.service";
import { geocodeAddress } from "@/lib/google-maps";
import { classifyOrderStatus, BLOCKED_MESSAGES, formatEndereco } from "@/lib/erp-order-status";
import type { Prisma } from "@prisma/client";

export type CorrigirPedidoError =
  | "NOT_FOUND" | "NOT_PENDING" | "SAME_NUMBER" | "DUPLICATE"
  | "CITEL_DOWN" | "ORDER_BLOCKED" | "NO_ITEMS";

export interface CorrigirPedidoPreview {
  orderNumber:     string;
  customerName:    string;
  customerDoc:     string | null;
  deliveryAddress: string;
  itemCount:       number;
  totalWeightKg:   number;
  isEntregaCD:     boolean;
}

export interface CorrigirPedidoResult {
  ok:       boolean;
  error?:   CorrigirPedidoError;
  message?: string;
  preview?: CorrigirPedidoPreview;
}

export async function corrigirPedido(input: {
  requestId:      string;
  newOrderNumber: string;
  actorId:        string;
  dryRun:         boolean;
}): Promise<CorrigirPedidoResult> {
  const { requestId, newOrderNumber, actorId, dryRun } = input;

  const dr = await prisma.deliveryRequest.findUnique({
    where:   { id: requestId },
    include: { orderStore: { select: { code: true, codigoEmpresaCitel: true } } },
  });
  if (!dr) return { ok: false, error: "NOT_FOUND", message: "Solicitação não encontrada." };
  if (dr.status !== "PENDING")
    return { ok: false, error: "NOT_PENDING", message: "Só é possível corrigir pedidos pendentes." };
  if (newOrderNumber === dr.orderNumber)
    return { ok: false, error: "SAME_NUMBER", message: "O número informado é o mesmo já cadastrado." };

  const dup = await prisma.deliveryRequest.findFirst({
    where: {
      orderNumber:  newOrderNumber,
      orderStoreId: dr.orderStoreId ?? undefined,
      status:       { not: "CANCELLED" },
      id:           { not: requestId },
    },
    select: { id: true },
  });
  if (dup) return { ok: false, error: "DUPLICATE", message: "Já existe uma solicitação ativa para este pedido." };

  if (!isCitelConfigured())
    return { ok: false, error: "CITEL_DOWN", message: "Citel indisponível — tente novamente em instantes." };

  const storeCode = dr.orderStore?.code ?? "";
  const codigoEmpresaCitel = dr.orderStore?.codigoEmpresaCitel ?? storeCode;

  const cabecalho = await fetchPedidoCabecalho(newOrderNumber, storeCode);
  if (!cabecalho)
    return { ok: false, error: "NOT_FOUND", message: `Pedido ${newOrderNumber} não encontrado na Citel.` };

  const validation = classifyOrderStatus(cabecalho.status);
  if (validation !== "VALID")
    return { ok: false, error: "ORDER_BLOCKED", message: BLOCKED_MESSAGES[validation] ?? "Pedido em status inválido." };

  const citel = await enrichDeliveryRequestStock(newOrderNumber, storeCode, codigoEmpresaCitel);
  if (!citel || citel.items.length === 0)
    return { ok: false, error: "NO_ITEMS", message: "Não foi possível obter os itens do pedido no Citel." };

  const deliveryAddress = formatEndereco(cabecalho.deliveryAddress ?? cabecalho.customerAddress);
  const customerPhone = cabecalho.telefone ?? cabecalho.celular ?? dr.customerPhone ?? "";

  const preview: CorrigirPedidoPreview = {
    orderNumber:     newOrderNumber,
    customerName:    cabecalho.nomeCliente,
    customerDoc:     cabecalho.documento,
    deliveryAddress,
    itemCount:       citel.items.length,
    totalWeightKg:   citel.totalWeightKg,
    isEntregaCD:     citel.isEntregaCD,
  };

  if (dryRun) return { ok: true, preview };

  const geo = await geocodeAddress(deliveryAddress).catch(() => null);

  const cdStore = citel.isEntregaCD
    ? await prisma.store.findFirst({ where: { code: "132", active: true }, select: { id: true } })
    : null;
  const dispatchStoreId = citel.isEntregaCD && cdStore ? cdStore.id : dr.storeId;

  const itemsData = citel.items.map((i) => ({
    productCode:      i.productCode,
    productName:      i.description ?? i.productCode,
    quantity:         i.quantity,
    unit:             i.unit,
    description:      i.description,
    brand:            i.brand,
    barcode:          i.barcode,
    grossWeight:      i.grossWeight,
    totalWeight:      i.totalWeight,
    hasMissingWeight: i.hasMissingWeight,
    availableStock:   i.availableStock,
    physicalStock:    i.physicalStock,
    stockStatus:      i.stockStatus,
    fetchedAt:        new Date(),
    availableAtStore: i.availableAtStore,
    sourceStoreId:    i.sourceStoreId ?? undefined,
  }));

  const oldOrderNumber = dr.orderNumber;

  await prisma.$transaction(async (tx) => {
    await (tx as typeof prisma).deliveryItem.deleteMany({ where: { deliveryRequestId: requestId } });
    await (tx as typeof prisma).deliveryRequest.update({
      where: { id: requestId },
      data: {
        orderNumber:           newOrderNumber,
        customerName:          cabecalho.nomeCliente,
        customerPhone,
        customerDoc:           cabecalho.documento,
        deliveryAddress,
        deliveryCity:          geo?.city ?? null,
        deliveryState:         geo?.state ?? null,
        deliveryLat:           geo?.lat ?? null,
        deliveryLng:           geo?.lng ?? null,
        entregaPeloCD:         citel.isEntregaCD,
        dispatchStoreId,
        totalWeightKg:         citel.totalWeightKg,
        totalLatas:            citel.totalLatas,
        volumeBreakdown:       citel.volumeBreakdown as Prisma.InputJsonValue,
        hasMissingWeights:     citel.hasMissingWeights,
        stockValidationStatus: citel.stockValidationStatus,
        stockFetchedAt:        new Date(),
        items: { create: itemsData },
      },
    });
    await (tx as typeof prisma).deliveryStatusHistory.create({
      data: {
        deliveryRequestId: requestId,
        fromStatus:        "PENDING",
        toStatus:          "PENDING",
        changedById:       actorId,
        metadata: {
          event:          "ORDER_NUMBER_CORRECTED",
          oldOrderNumber,
          newOrderNumber,
          correctedBy:    actorId,
        } as Prisma.InputJsonValue,
      },
    });
  });

  return { ok: true, preview };
}
