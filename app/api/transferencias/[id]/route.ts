import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { updateTransferStatus } from "@/services/transferencia.service";
import { TransferStatus, DeliveryRequestStatus } from "@prisma/client";
import {
  notifyTransferConfirmed,
  notifyTransferDispatched,
  notifyTransferReceived,
  notifyTransferCancelled,
} from "@/services/notifications.service";

const updateStatusSchema = z.object({
  status: z.nativeEnum(TransferStatus),
  notes: z.string().optional(),
  cancellationReason: z.string().min(10, "Informe o motivo do cancelamento (mín. 10 caracteres)").optional(),
  estimatedArrival: z.string().datetime().optional(),
  // Documento da aprovação (PENDING → APPROVED): TE (comprovante) ou NF (fiscal).
  // docNumber é o número do documento. Obrigatório ao aprovar (validado abaixo).
  docType: z.enum(["TE", "NF"]).optional(),
  docNumber: z.string().optional(),
  sentItems: z.array(
    z.object({ transferItemId: z.string(), sentQty: z.number() })
  ).optional(),
  receivedItems: z.array(
    z.object({ transferItemId: z.string(), receivedQty: z.number() })
  ).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const transfer = await prisma.transfer.findUnique({
      where: { id: params.id },
      include: {
        fromStore: true,
        toStore: true,
        requestedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        items: true,
        history: { orderBy: { createdAt: "asc" } },
        deliveryRequest: {
          select: { id: true, invoiceNumber: true, customerName: true, status: true },
        },
        dispatch: {
          include: { driver: true, lalamoveOrder: true },
        },
      },
    });

    if (!transfer) {
      return NextResponse.json(apiError("Transferência não encontrada", "NOT_FOUND"), { status: 404 });
    }

    return NextResponse.json(apiSuccess(transfer));
  } catch (error) {
    console.error("[GET /api/transferencias/[id]]", error);
    return NextResponse.json(apiError("Erro ao buscar transferência"), { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const body = await req.json();
    const parsed = updateStatusSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
        { status: 400 }
      );
    }

    // Carrega transferência + identifica a loja ORIGEM (linkedCitelStoreCode dos items)
    const transfer = await prisma.transfer.findUnique({
      where: { id: params.id },
      include: {
        items: { select: { id: true, linkedCitelStoreCode: true } },
        fromStore: { select: { id: true, code: true } },
        deliveryRequest: { select: { id: true, orderNumber: true, orderStore: { select: { code: true } } } },
      },
    });
    if (!transfer) {
      return NextResponse.json(apiError("Transferência não encontrada", "NOT_FOUND"), { status: 404 });
    }

    // Loja origem REAL = a do PD interno vinculado (qualquer item da Transfer).
    // Fallback: fromStoreId da Transfer.
    const originStoreCode = transfer.items.find(i => i.linkedCitelStoreCode)?.linkedCitelStoreCode
                         ?? transfer.fromStore.code;

    // Permissão: ADMIN/LOGISTICS_OPERATOR podem qualquer transferência.
    // Outros roles (incluindo SELLER) — só se forem da loja origem.
    const isAdminOrLogistics = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"].includes(session.role);
    if (!isAdminOrLogistics) {
      const myStore = await prisma.user.findUnique({
        where:  { id: session.userId },
        select: { store: { select: { code: true } } },
      });
      const isFromOriginStore = myStore?.store?.code === originStoreCode;
      if (!isFromOriginStore) {
        return NextResponse.json(
          apiError(
            `Apenas a loja origem (${originStoreCode}) pode aprovar ou cancelar esta transferência`,
            "FORBIDDEN",
          ),
          { status: 403 },
        );
      }
    }

    // Cancelamento exige motivo (mín 10 chars) e tem efeito cascata
    if (parsed.data.status === TransferStatus.CANCELLED) {
      if (!parsed.data.cancellationReason || parsed.data.cancellationReason.trim().length < 10) {
        return NextResponse.json(
          apiError("Informe o motivo do cancelamento (mín. 10 caracteres)", "REASON_REQUIRED"),
          { status: 400 },
        );
      }

      // Quem cancelou
      const canceller = await prisma.user.findUnique({
        where:  { id: session.userId },
        select: { name: true, store: { select: { code: true } } },
      });

      await prisma.$transaction(async (tx) => {
        // 1. Cancela a Transfer
        await tx.transfer.update({
          where: { id: transfer.id },
          data:  {
            status:        TransferStatus.CANCELLED,
            cancelledAt:   new Date(),
            internalNotes: `Cancelado por ${canceller?.name ?? session.userId} (Loja ${canceller?.store?.code ?? "?"}): ${parsed.data.cancellationReason}`,
          },
        });
        await tx.transferHistory.create({
          data: {
            transferId:  transfer.id,
            toStatus:    TransferStatus.CANCELLED,
            changedById: session.userId,
            notes:       parsed.data.cancellationReason,
          },
        });

        // 2. Limpa vínculos com PDs internos
        await tx.transferItem.updateMany({
          where: { transferId: transfer.id },
          data:  {
            linkedCitelPD:        null,
            linkedCitelStoreCode: null,
            linkedAt:             null,
            linkedById:           null,
          },
        });

        // 3. Reverte DeliveryRequest para AWAITING_TRANSFER (sempre, exceto se já finalizado)
        if (transfer.deliveryRequestId) {
          const dr = await tx.deliveryRequest.findUnique({
            where:  { id: transfer.deliveryRequestId },
            select: { status: true },
          });
          const finalizado = dr?.status === DeliveryRequestStatus.DELIVERED
                          || dr?.status === DeliveryRequestStatus.CANCELLED;
          if (!finalizado) {
            await tx.deliveryRequest.update({
              where: { id: transfer.deliveryRequestId },
              data:  {
                status:     DeliveryRequestStatus.AWAITING_TRANSFER,
                isComplete: false,
              },
            });
          }
        }
      });

      // Notifica Jhow + Jane + vendedor (crítico)
      if (transfer.deliveryRequestId) {
        void notifyTransferCancelled({
          transferId:           transfer.id,
          deliveryRequestId:    transfer.deliveryRequestId,
          orderNumber:          transfer.deliveryRequest?.orderNumber ?? null,
          storeCode:            transfer.deliveryRequest?.orderStore?.code,
          itemCount:            transfer.items.length,
          fromStoreCode:        originStoreCode,
          cancelledByStoreCode: canceller?.store?.code ?? "?",
          cancelledByName:      canceller?.name,
          reason:               parsed.data.cancellationReason,
        });
      }

      return NextResponse.json(apiSuccess({
        cancelled: true,
        reverted:  Boolean(transfer.deliveryRequestId),
      }));
    }

    // Aprovação (PENDING → APPROVED) exige o documento da transferência:
    // TE (comprovante, não fiscal) OU NF (fiscal). Mapeia TE→teNumber, NF→nfCitelNumero.
    let approvalDoc: { teNumber?: string; nfCitelNumero?: string } = {};
    if (parsed.data.status === TransferStatus.APPROVED) {
      const docType   = parsed.data.docType;
      const docNumber = parsed.data.docNumber?.trim();
      if (!docType || !docNumber) {
        return NextResponse.json(
          apiError("Informe o documento da transferência (TE ou NF) para aprovar", "DOCUMENT_REQUIRED"),
          { status: 400 },
        );
      }
      approvalDoc = docType === "TE"
        ? { teNumber: docNumber }
        : { nfCitelNumero: docNumber };
    }

    // Demais transições — passa pelo service tradicional
    const updated = await updateTransferStatus(params.id, {
      ...parsed.data,
      changedById:      session.userId,
      estimatedArrival: parsed.data.estimatedArrival ? new Date(parsed.data.estimatedArrival) : undefined,
      docType:          parsed.data.docType,
      ...approvalDoc,
    });

    // Notificações conforme novo status (gatilhos #2, #4, #6)
    if (updated && updated.deliveryRequestId) {
      const itemCount = await prisma.transferItem.count({ where: { transferId: updated.id } });
      const refs = {
        transferId:        updated.id,
        deliveryRequestId: updated.deliveryRequestId,
        orderNumber:       transfer.deliveryRequest?.orderNumber ?? null,
        storeCode:         transfer.deliveryRequest?.orderStore?.code,
        itemCount,
        fromStoreCode:     originStoreCode,
      };
      if (parsed.data.status === TransferStatus.APPROVED) {
        void notifyTransferConfirmed(refs);
      } else if (parsed.data.status === TransferStatus.IN_TRANSIT) {
        void notifyTransferDispatched(refs);
      } else if (parsed.data.status === TransferStatus.RECEIVED) {
        void notifyTransferReceived(refs);
      }
    }

    return NextResponse.json(apiSuccess(updated));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro ao atualizar transferência";
    if (msg.includes("Transição inválida")) {
      return NextResponse.json(apiError(msg, "INVALID_TRANSITION"), { status: 422 });
    }
    console.error("[PATCH /api/transferencias/[id]]", error);
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
