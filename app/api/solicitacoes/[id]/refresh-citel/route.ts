import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { enrichDeliveryRequestStock } from "@/services/citel-stock.service";
import { DeliveryRequestStatus, DeliveryType, TransferPriority, TransferStatus } from "@prisma/client";
import { findAutoLinkCandidatesWithProbe } from "@/services/internal-transfer.service";

// POST /api/solicitacoes/[id]/refresh-citel
// Recarrega itens e estoque da Citel para uma solicitação existente.
// Usado quando a solicitação foi criada com Citel fora e ficou sem itens.

export async function POST(
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
        orderStore: { select: { code: true, codigoEmpresaCitel: true } },
        items:      { select: { id: true } },
        transfers:  { select: { id: true, status: true } },
      },
    });

    if (!request) {
      return NextResponse.json(apiError("Solicitação não encontrada", "NOT_FOUND"), { status: 404 });
    }

    if (session.role === "SELLER" && request.storeId !== session.storeId) {
      return NextResponse.json(apiError("Acesso negado", "FORBIDDEN"), { status: 403 });
    }

    if (!request.orderNumber || !request.orderStore?.code || !request.orderStore.codigoEmpresaCitel) {
      return NextResponse.json(
        apiError("Solicitação sem PD vinculado — não há o que recarregar do ERP", "NO_ORDER"),
        { status: 422 },
      );
    }

    // Solicitação cancelada/entregue não deve ser tocada
    const frozenStatuses: DeliveryRequestStatus[] = [DeliveryRequestStatus.CANCELLED, DeliveryRequestStatus.DELIVERED];
    if (frozenStatuses.includes(request.status)) {
      return NextResponse.json(
        apiError("Não é possível recarregar uma solicitação cancelada ou já entregue", "INVALID_STATE"),
        { status: 422 },
      );
    }

    // Busca dados frescos do Citel
    const citelResult = await enrichDeliveryRequestStock(
      request.orderNumber,
      request.orderStore.code,
      request.orderStore.codigoEmpresaCitel,
    ).catch((e) => {
      console.error("[refresh-citel] enrichDeliveryRequestStock failed:", e);
      return null;
    });

    if (!citelResult || citelResult.items.length === 0) {
      return NextResponse.json(
        apiError(
          "Citel não retornou itens para esse PD. Confirme o número do pedido ou tente novamente em instantes.",
          "CITEL_NO_ITEMS",
        ),
        { status: 503 },
      );
    }

    const enrichedItems = citelResult.items;
    const allAvailable = enrichedItems.every((i) => i.availableAtStore);
    const newStatus: DeliveryRequestStatus = allAvailable
      ? DeliveryRequestStatus.PENDING
      : DeliveryRequestStatus.AWAITING_TRANSFER;

    // Substitui os itens (delete + create) numa transação
    await prisma.$transaction(async (tx) => {
      // remove os itens antigos (vazios ou desatualizados)
      await tx.deliveryItem.deleteMany({ where: { deliveryRequestId: id } });

      // cria os itens novos
      await tx.deliveryItem.createMany({
        data: enrichedItems.map((item) => ({
          deliveryRequestId: id,
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
          sourceStoreId:    item.sourceStoreId ?? null,
        })),
      });

      // atualiza totais e status da solicitação
      await tx.deliveryRequest.update({
        where: { id },
        data: {
          totalWeightKg:         citelResult.totalWeightKg,
          totalLatas:            citelResult.totalLatas,
          volumeBreakdown:       citelResult.volumeBreakdown ?? undefined,
          hasMissingWeights:     citelResult.hasMissingWeights,
          stockValidationStatus: citelResult.stockValidationStatus,
          stockFetchedAt:        new Date(),
          isComplete:            allAvailable,
          // só altera o status se estiver em estado pré-separação
          ...(request.status === DeliveryRequestStatus.PENDING ||
              request.status === DeliveryRequestStatus.AWAITING_ITEMS ||
              request.status === DeliveryRequestStatus.AWAITING_TRANSFER
            ? { status: newStatus }
            : {}),
        },
      });
    });

    // Cria transferência se faltam itens e ainda não existe uma ativa
    const missingItems = enrichedItems.filter((i) => !i.availableAtStore);
    const hasActiveTransfer = request.transfers.some(
      (t) => t.status !== TransferStatus.CANCELLED && t.status !== TransferStatus.RECEIVED,
    );

    // Cria a Transfer DIRETO via Prisma — pulamos o service createTransfer porque
    // ele valida estoque na loja origem, e neste caso a origem é desconhecida (vai
    // ser descoberta quando o Jhow vincular o PD interno do Autcom).
    // A loja origem real é descoberta no link-pd (Onda 4B).
    let transferCreated = false;
    let transferError: string | null = null;
    let autoLinkedCount = 0;
    let autoLinkTotal = 0;

    if (missingItems.length > 0 && !hasActiveTransfer) {
      try {
        const priority = request.deliveryType === DeliveryType.URGENT
          ? TransferPriority.URGENT
          : TransferPriority.ANTICIPATED;
        const newTransfer = await prisma.$transaction(async (tx) => {
          const t = await tx.transfer.create({
            data: {
              deliveryRequestId: id,
              fromStoreId:       request.storeId,
              toStoreId:         request.storeId,
              priority,
              status:            TransferStatus.PENDING,
              requestedById:     session.userId,
              notes:             `Solicitação de transferência interna · PD ${request.orderNumber}`,
              items: {
                create: missingItems.map((i) => ({
                  productCode: i.productCode,
                  productName: i.description ?? i.productCode,
                  quantity:    i.quantity,
                  unit:        i.unit,
                })),
              },
            },
            include: { items: { select: { id: true, productCode: true, quantity: true } } },
          });
          await tx.transferHistory.create({
            data: {
              transferId:  t.id,
              toStatus:    TransferStatus.PENDING,
              changedById: session.userId,
              notes:       "Transferência criada por refresh-citel",
            },
          });
          return t;
        });
        transferCreated = true;

        // Auto-vínculo: para cada item da Transfer, busca PDs candidatos da Atual Tintas
        // que tenham qty >= necessária, não cancelados, não faturados.
        // Se houver candidatos, vincula o mais recente (sort desc por dataEntrada).
        autoLinkTotal = newTransfer.items.length;
        await Promise.all(newTransfer.items.map(async (ti) => {
          try {
            const candidates = await findAutoLinkCandidatesWithProbe(ti.productCode, ti.quantity);
            if (candidates.length === 0) return;
            const best = candidates[0]; // já ordenado por data desc
            await prisma.transferItem.update({
              where: { id: ti.id },
              data: {
                linkedCitelPD:        best.numeroDocumento,
                linkedCitelStoreCode: best.codigoEmpresa,
                linkedAt:             new Date(),
                linkedById:           session.userId,
              },
            });
            autoLinkedCount++;
          } catch (e) {
            console.warn(`[refresh-citel] auto-link falhou pra item ${ti.productCode}:`, e instanceof Error ? e.message : e);
          }
        }));
      } catch (e) {
        transferError = e instanceof Error ? e.message : String(e);
        console.warn(`[refresh-citel] criação direta de Transfer falhou: ${transferError}`);
      }
    }

    return NextResponse.json(apiSuccess({
      id,
      itemsLoaded:       enrichedItems.length,
      totalWeightKg:     citelResult.totalWeightKg,
      allAvailable,
      newStatus,
      transferCreated,
      transferError,
      missingItemsCount: missingItems.length,
      autoLinkedCount,
      autoLinkTotal,
    }));
  } catch (error) {
    console.error("[POST /api/solicitacoes/[id]/refresh-citel]", error);
    return NextResponse.json(apiError("Erro ao recarregar dados do ERP"), { status: 500 });
  }
}
