import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { DeliveryRequestStatus, TransferStatus } from "@prisma/client";
import { PRIVILEGED_ROLES } from "@/lib/permissions";
import { notifyOrderSeparated } from "@/services/notifications.service";

// POST /api/solicitacoes/[id]/seguir-separacao
// Promove DeliveryRequest de AWAITING_TRANSFER → SEPARADO,
// se TODOS os itens das Transfers ativas estão vinculados a PDs internos.
// Também promove as Transfers ativas para APPROVED.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    if (!PRIVILEGED_ROLES.includes(session.role as never)) {
      return NextResponse.json(apiError("Sem permissão", "FORBIDDEN"), { status: 403 });
    }

    const { id } = await params;

    const request = await prisma.deliveryRequest.findUnique({
      where: { id },
      include: {
        orderStore: { select: { code: true } },
        store:      { select: { code: true } },
        transfers: {
          where: { status: { notIn: [TransferStatus.CANCELLED, TransferStatus.RECEIVED] } },
          include: {
            items:   { select: { id: true, productCode: true, productName: true, quantity: true, unit: true, linkedCitelPD: true } },
            toStore: { select: { code: true } },
          },
        },
      },
    });

    if (!request) {
      return NextResponse.json(apiError("Solicitação não encontrada", "NOT_FOUND"), { status: 404 });
    }

    if (request.status !== DeliveryRequestStatus.AWAITING_TRANSFER) {
      return NextResponse.json(
        apiError(`Solicitação está em ${request.status}. Só pode promover quando está em AWAITING_TRANSFER.`, "INVALID_STATE"),
        { status: 422 },
      );
    }

    if (request.transfers.length === 0) {
      return NextResponse.json(apiError("Não há transferências ativas para esta solicitação", "NO_TRANSFER"), { status: 422 });
    }

    // Promoção SEM travas. Quando Jhow segue para Separação SEM ter vinculado todos
    // os PDs internos da Transfer, isso significa que ele encontrou os itens em estoque
    // (apesar do Citel ter dito que faltavam). Auto-resolvemos esses items como
    // RESOLVED_BY_STOCK + log de divergência. Quem clicar no botão é a fonte de verdade.
    const RESOLVED_BY_STOCK_SENTINEL = "RESOLVED_BY_STOCK";
    const user = await prisma.user.findUnique({
      where: { id: session.userId }, select: { name: true },
    });
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      // 1. Auto-resolve items pendentes em todas as Transfers ativas
      for (const t of request.transfers) {
        const pending = t.items.filter(i => !i.linkedCitelPD);
        if (pending.length === 0) continue;
        for (const it of pending) {
          await tx.transferItem.update({
            where: { id: it.id },
            data: {
              linkedCitelPD:        RESOLVED_BY_STOCK_SENTINEL,
              linkedCitelStoreCode: t.toStore.code,
              linkedAt:             now,
              linkedById:           session.userId,
            },
          });
          await tx.$executeRawUnsafe(
            `INSERT INTO stock_divergence_log
              (id, "transferItemId", "transferId", "deliveryRequestId",
               "productCode", "productName", quantity, unit,
               "storeCode", "resolvedById", "resolvedByName", trigger, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            `sdl_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
            it.id, t.id, id,
            it.productCode, it.productName, it.quantity, it.unit,
            t.toStore.code,
            session.userId, user?.name ?? null,
            "AUTO_PROMOTE",
            "Resolvido automaticamente ao promover para Separação",
          );
        }
        // Se Transfer agora está toda resolvida e ainda PENDING, fecha como APPROVED
        if (t.status === TransferStatus.PENDING) {
          await tx.transfer.update({
            where: { id: t.id },
            data: { status: TransferStatus.APPROVED, approvedById: session.userId, approvedAt: now },
          });
        }
      }

      // 2. Promove o pedido
      await tx.deliveryRequest.update({
        where: { id },
        data:  { status: DeliveryRequestStatus.SEPARADO, isComplete: true },
      });
    });

    // Notifica Jane + vendedor (pedido separado)
    void notifyOrderSeparated({
      deliveryRequestId: id,
      orderNumber:       request.orderNumber,
      storeCode:         request.orderStore?.code,
    });

    return NextResponse.json(apiSuccess({ promoted: true, newStatus: "SEPARADO" }));
  } catch (error) {
    console.error("[POST /api/solicitacoes/[id]/seguir-separacao]", error);
    return NextResponse.json(apiError("Erro ao promover para separação"), { status: 500 });
  }
}
