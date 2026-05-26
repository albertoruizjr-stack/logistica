import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { getResponsibility } from "@/services/responsavel.service";

// GET /api/solicitacoes/[id]
// Retorna resumo da solicitação para o drawer de detalhes.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const { id } = await params;

    const request = await prisma.deliveryRequest.findUnique({
      where: { id },
      include: {
        store:        { select: { id: true, code: true, name: true } },
        orderStore:   { select: { code: true, name: true } },
        invoiceStore: { select: { code: true, name: true } },
        seller:       { select: { name: true } },
        items: {
          select: {
            id: true, productCode: true, productName: true,
            quantity: true, unit: true, availableAtStore: true,
            grossWeight: true,
          },
          orderBy: { createdAt: "asc" },
        },
        dispatch: {
          include: {
            driver:        { select: { name: true, phone: true } },
            lalamoveOrder: { select: { status: true, driverName: true, shareLink: true } },
          },
        },
        transfers: {
          where: { status: { notIn: ["CANCELLED", "RECEIVED"] } },
          include: {
            fromStore: { select: { code: true, name: true } },
            toStore:   { select: { code: true, name: true } },
            items: {
              select: {
                id: true, productCode: true, productName: true,
                quantity: true, unit: true,
                linkedCitelPD: true, linkedCitelStoreCode: true, linkedAt: true,
              },
            },
          },
          orderBy: { requestedAt: "desc" },
        },
      },
    });

    if (!request) {
      return NextResponse.json(apiError("Solicitação não encontrada", "NOT_FOUND"), { status: 404 });
    }

    // SELLER só vê própria loja
    if (session.role === "SELLER" && request.storeId !== session.storeId) {
      return NextResponse.json(apiError("Acesso negado", "FORBIDDEN"), { status: 403 });
    }

    const totalWeightKg = request.items.reduce(
      (s, i) => s + (Number(i.grossWeight ?? 0) * i.quantity),
      0,
    );

    // Calcula responsabilidade da próxima ação (Fase A — controla visibilidade do botão na UI)
    const responsibility = getResponsibility({
      status:          request.status,
      storeId:         request.storeId,
      dispatchStoreId: request.dispatchStoreId,
      entregaPeloCD:   request.entregaPeloCD,
    });

    // Carrega responsáveis nominais (até 5) pra UI mostrar "Aguardando: X, Y, Z"
    let responsibleUsers: Array<{ id: string; name: string; role: string }> = [];
    let responsibleStoreCode: string | null = null;
    if (responsibility) {
      const [users, store] = await Promise.all([
        prisma.user.findMany({
          where: {
            storeId: responsibility.responsibleStoreId,
            active:  true,
            role:    { in: [responsibility.primaryRole, ...responsibility.fallbackRoles] },
          },
          select: { id: true, name: true, role: true },
          take: 5,
        }),
        prisma.store.findUnique({
          where: { id: responsibility.responsibleStoreId },
          select: { code: true },
        }),
      ]);
      responsibleUsers     = users;
      responsibleStoreCode = store?.code ?? null;
    }

    // unifica info de motorista — preferência: Lalamove (mais atualizado), fallback: driver do cadastro
    const dispatchInfo = request.dispatch
      ? {
          driverName:    request.dispatch.lalamoveOrder?.driverName ?? request.dispatch.driver?.name ?? null,
          driverPhone:   request.dispatch.driver?.phone ?? null,
          modal:         request.dispatch.modal,
          status:        request.dispatch.status,
          dispatchedAt:  request.dispatch.dispatchedAt?.toISOString() ?? null,
          completedAt:   request.dispatch.completedAt?.toISOString() ?? null,
          lalamoveStatus: request.dispatch.lalamoveOrder?.status ?? null,
          shareLink:     request.dispatch.lalamoveOrder?.shareLink ?? null,
        }
      : null;

    return NextResponse.json(apiSuccess({
      id:                 request.id,
      orderNumber:        request.orderNumber,
      orderStoreCode:     request.orderStore?.code ?? null,
      invoiceNumber:      request.invoiceNumber,
      invoiceStoreCode:   request.invoiceStore?.code ?? null,
      status:             request.status,
      deliveryType:       request.deliveryType,
      scheduledFor:       request.scheduledFor?.toISOString() ?? null,
      createdAt:          request.createdAt.toISOString(),
      customerName:       request.customerName,
      customerPhone:      request.customerPhone,
      customerDoc:        request.customerDoc,
      deliveryAddress:    request.deliveryAddress,
      storeId:            request.storeId,
      storeCode:          request.store.code,
      storeName:          request.store.name,
      sellerName:         request.seller?.name ?? "—",
      chargedFreight:     Number(request.chargedFreight ?? 0),
      items: request.items.map(i => ({
        id:               i.id,
        productCode:      i.productCode,
        productName:      i.productName,
        quantity:         i.quantity,
        unit:             i.unit,
        availableAtStore: i.availableAtStore,
        grossWeight:      i.grossWeight !== null ? Number(i.grossWeight) : null,
      })),
      itemCount:          request.items.length,
      totalWeightKg:      Math.round(totalWeightKg * 10) / 10,
      dispatch:           dispatchInfo,
      notes:              request.notes,
      // contexto para decisões da UI (visibilidade de botões)
      currentUserRole:    session.role,
      currentUserStoreId: session.storeId,
      // Responsabilidade pela próxima ação (Fase A — controla botão + mensagem "Aguardando")
      entregaPeloCD:      request.entregaPeloCD,
      dispatchStoreId:    request.dispatchStoreId,
      responsibility: responsibility ? {
        responsibleStoreId:   responsibility.responsibleStoreId,
        responsibleStoreCode: responsibleStoreCode,
        primaryRole:          responsibility.primaryRole,
        fallbackRoles:        responsibility.fallbackRoles,
        actionLabel:          responsibility.actionLabel,
        responsibleUsers,
      } : null,
      transfers: request.transfers.map(t => ({
        id:            t.id,
        status:        t.status,
        priority:      t.priority,
        fromStoreCode: t.fromStore?.code ?? null,
        fromStoreName: t.fromStore?.name ?? null,
        toStoreCode:   t.toStore.code,
        nfCitelNumero: t.nfCitelNumero,
        requestedAt:   t.requestedAt.toISOString(),
        approvedAt:    t.approvedAt?.toISOString() ?? null,
        dispatchedAt:  t.dispatchedAt?.toISOString() ?? null,
        notes:         t.notes,
        items: t.items.map(i => ({
          id: i.id, productCode: i.productCode, productName: i.productName,
          quantity: i.quantity, unit: i.unit,
          linkedCitelPD:        i.linkedCitelPD,
          linkedCitelStoreCode: i.linkedCitelStoreCode,
          linkedAt:             i.linkedAt?.toISOString() ?? null,
        })),
      })),
    }));
  } catch (error) {
    console.error("[GET /api/solicitacoes/[id]]", error);
    return NextResponse.json(apiError("Erro ao buscar solicitação"), { status: 500 });
  }
}
