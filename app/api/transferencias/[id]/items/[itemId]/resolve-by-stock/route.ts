import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { PRIVILEGED_ROLES } from "@/lib/permissions";
import { TransferStatus } from "@prisma/client";
import { RESOLVED_BY_STOCK_SENTINEL } from "@/lib/transfer-sentinels";

// POST /api/transferencias/[id]/items/[itemId]/resolve-by-stock
//
// Marca um item de transferência como "resolvido — produto encontrado em estoque".
// Usado quando o Citel acusa falta mas a loja tem fisicamente.
// NÃO reverte o pedido. Loga a divergência pra análise futura.
//
// Sentinela usada em linkedCitelPD: "RESOLVED_BY_STOCK" (ver @/lib/transfer-sentinels)
// Storage code "__stock__" indica que o vínculo é com a própria loja, não com PD interno.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    if (!PRIVILEGED_ROLES.includes(session.role as never)) {
      return NextResponse.json(apiError("Sem permissão", "FORBIDDEN"), { status: 403 });
    }

    const { id, itemId } = await params;

    const item = await prisma.transferItem.findFirst({
      where: { id: itemId, transferId: id },
      select: {
        id: true, productCode: true, productName: true, quantity: true, unit: true,
        linkedCitelPD: true,
        transfer: {
          select: {
            id: true, deliveryRequestId: true, status: true,
            toStore: { select: { code: true } },
          },
        },
      },
    });
    if (!item) return NextResponse.json(apiError("Item não encontrado", "NOT_FOUND"), { status: 404 });
    if (item.linkedCitelPD) {
      return NextResponse.json(apiError("Item já está vinculado/resolvido", "ALREADY_RESOLVED"), { status: 422 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { name: true },
    });

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      // 1. Marca item como resolvido por estoque
      await tx.transferItem.update({
        where: { id: itemId },
        data: {
          linkedCitelPD:        RESOLVED_BY_STOCK_SENTINEL,
          linkedCitelStoreCode: item.transfer.toStore.code,
          linkedAt:             now,
          linkedById:           session.userId,
        },
      });

      // 2. Registra divergência
      await tx.$executeRawUnsafe(
        `INSERT INTO stock_divergence_log
          (id, "transferItemId", "transferId", "deliveryRequestId",
           "productCode", "productName", quantity, unit,
           "storeCode", "resolvedById", "resolvedByName", trigger, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        `sdl_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
        item.id,
        item.transfer.id,
        item.transfer.deliveryRequestId,
        item.productCode,
        item.productName,
        item.quantity,
        item.unit,
        item.transfer.toStore.code,
        session.userId,
        user?.name ?? null,
        "MANUAL",
        null,
      );

      // 3. Se TODOS os items da transfer agora estão resolvidos, fecha como APPROVED
      const remaining = await tx.transferItem.count({
        where: { transferId: item.transfer.id, linkedCitelPD: null },
      });
      if (remaining === 0 && item.transfer.status === TransferStatus.PENDING) {
        await tx.transfer.update({
          where: { id: item.transfer.id },
          data: { status: TransferStatus.APPROVED, approvedById: session.userId, approvedAt: now },
        });
      }
    });

    return NextResponse.json(apiSuccess({ resolved: true }));
  } catch (error) {
    console.error("[POST .../resolve-by-stock]", error);
    return NextResponse.json(apiError("Erro ao resolver item por estoque"), { status: 500 });
  }
}
