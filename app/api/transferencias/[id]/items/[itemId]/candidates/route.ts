import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { findInternalTransferCandidates } from "@/services/internal-transfer.service";

// GET /api/transferencias/[id]/items/[itemId]/candidates
// Retorna PDs internos (cliente Atual Tintas) que contêm o produto do TransferItem.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const session = await getSessionFromRequest(_req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    const { id, itemId } = await params;

    const item = await prisma.transferItem.findFirst({
      where: { id: itemId, transferId: id },
      select: {
        id:               true,
        productCode:      true,
        productName:      true,
        quantity:         true,
        unit:             true,
        linkedCitelPD:    true,
        linkedCitelStoreCode: true,
      },
    });

    if (!item) return NextResponse.json(apiError("Item não encontrado", "NOT_FOUND"), { status: 404 });

    const candidates = await findInternalTransferCandidates(item.productCode);

    return NextResponse.json(apiSuccess({
      item: {
        id:           item.id,
        productCode:  item.productCode,
        productName:  item.productName,
        quantity:     item.quantity,
        unit:         item.unit,
        linkedCitelPD:        item.linkedCitelPD,
        linkedCitelStoreCode: item.linkedCitelStoreCode,
      },
      candidates,
    }));
  } catch (error) {
    console.error("[GET /api/transferencias/[id]/items/[itemId]/candidates]", error);
    return NextResponse.json(apiError("Erro ao buscar candidatos"), { status: 500 });
  }
}
