import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { validateInternalPd } from "@/services/internal-transfer.service";
import { PRIVILEGED_ROLES } from "@/lib/permissions";
import { notifyTransferConfirmed } from "@/services/notifications.service";

// POST /api/transferencias/[id]/items/[itemId]/link-pd
// Vincula o item de transferência a um PD interno do Autcom.
// Body: { numeroPedido: string, storeCode: string }
//
// Quando TODOS os items da Transfer ficam vinculados:
//   - Transfer.status → APPROVED (Jhow confirmou tudo)
//   - DeliveryRequest.status → SEPARADO (sai da fila de transferência)
//   - Notificações disparadas para Jane + vendedor

const schema = z.object({
  numeroPedido: z.string().min(1),
  storeCode:    z.string().min(1),
});

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
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()), { status: 400 });
    }

    // Confirma que o item existe e pertence à transferência
    const item = await prisma.transferItem.findFirst({
      where: { id: itemId, transferId: id },
      select: { id: true, productCode: true, productName: true, transferId: true },
    });
    if (!item) return NextResponse.json(apiError("Item não encontrado", "NOT_FOUND"), { status: 404 });

    // Valida o PD na Citel — confere se existe, é da Atual Tintas, contém o produto
    const validation = await validateInternalPd({
      numeroPedido: parsed.data.numeroPedido,
      storeCode:    parsed.data.storeCode,
      productCode:  item.productCode,
    });

    if (!validation.ok) {
      return NextResponse.json(apiError(validation.reason ?? "PD inválido", "INVALID_PD"), { status: 422 });
    }

    // Atualiza item com o vínculo
    await prisma.transferItem.update({
      where: { id: itemId },
      data: {
        linkedCitelPD:        validation.cabecalho!.numeroPedido,
        linkedCitelStoreCode: validation.cabecalho!.storeCode,
        linkedAt:             new Date(),
        linkedById:           session.userId,
      },
    });

    // Verifica se TODOS os items da Transfer agora estão vinculados.
    // NÃO promovemos automaticamente para SEPARADO aqui — o operador (Jhow)
    // ainda precisa clicar em "Seguir para Separação" no drawer.
    // Apenas notificamos que esta transferência teve uma confirmação.
    const transfer = await prisma.transfer.findUnique({
      where: { id: item.transferId },
      include: {
        items: { select: { id: true, linkedCitelPD: true } },
        deliveryRequest: { select: { id: true, orderNumber: true, orderStoreId: true } },
      },
    });
    const allLinked = transfer && transfer.items.every(i => i.linkedCitelPD !== null);

    if (transfer?.deliveryRequest) {
      const orderStore = transfer.deliveryRequest.orderStoreId
        ? await prisma.store.findUnique({
            where: { id: transfer.deliveryRequest.orderStoreId },
            select: { code: true },
          })
        : null;
      const fromStore = transfer.fromStoreId
        ? await prisma.store.findUnique({
            where: { id: transfer.fromStoreId },
            select: { code: true },
          })
        : null;

      void notifyTransferConfirmed({
        transferId:        transfer.id,
        deliveryRequestId: transfer.deliveryRequest.id,
        orderNumber:       transfer.deliveryRequest.orderNumber,
        storeCode:         orderStore?.code,
        itemCount:         transfer.items.length,
        fromStoreCode:     fromStore?.code ?? "?",
      });
    }

    return NextResponse.json(apiSuccess({
      linkedCitelPD:        validation.cabecalho!.numeroPedido,
      linkedCitelStoreCode: validation.cabecalho!.storeCode,
      allItemsLinked:       Boolean(allLinked),
      itemMatch:            validation.itemMatch,
    }));
  } catch (error) {
    console.error("[POST /api/transferencias/[id]/items/[itemId]/link-pd]", error);
    return NextResponse.json(apiError("Erro ao vincular PD"), { status: 500 });
  }
}

// DELETE /api/transferencias/[id]/items/[itemId]/link-pd
// Desfaz o vínculo (caso o operador tenha vinculado o PD errado).
export async function DELETE(
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
      select: { id: true },
    });
    if (!item) return NextResponse.json(apiError("Item não encontrado", "NOT_FOUND"), { status: 404 });

    await prisma.transferItem.update({
      where: { id: itemId },
      data:  { linkedCitelPD: null, linkedCitelStoreCode: null, linkedAt: null, linkedById: null },
    });

    return NextResponse.json(apiSuccess({ unlinked: true }));
  } catch (error) {
    console.error("[DELETE /api/transferencias/[id]/items/[itemId]/link-pd]", error);
    return NextResponse.json(apiError("Erro ao desvincular PD"), { status: 500 });
  }
}
