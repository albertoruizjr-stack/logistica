import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { fetchInvoiceFromERP } from "@/services/erp.service";

const schema = z.object({
  invoiceNumber: z.string().min(1, "Informe o número da NF"),
  invoiceStoreId: z.string().min(1, "Informe a loja emissora da NF"),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    }

    const body = await req.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        apiError("Dados inválidos", "VALIDATION_ERROR", parsed.error.flatten()),
        { status: 400 }
      );
    }

    const { invoiceNumber, invoiceStoreId } = parsed.data;

    const existing = await prisma.deliveryRequest.findUnique({
      where: { id: params.id },
      select: { id: true, invoiceNumber: true, storeId: true },
    });

    if (!existing) {
      return NextResponse.json(apiError("Solicitação não encontrada"), { status: 404 });
    }

    if (existing.invoiceNumber) {
      return NextResponse.json(
        apiError(
          `Esta solicitação já possui NF vinculada (${existing.invoiceNumber}). Para corrigir, contate um administrador.`,
          "ALREADY_LINKED"
        ),
        { status: 409 }
      );
    }

    // Verifica se a NF já está vinculada a outra solicitação
    const duplicate = await prisma.deliveryRequest.findFirst({
      where: { invoiceNumber, id: { not: params.id } },
      select: { id: true, orderNumber: true },
    });

    if (duplicate) {
      return NextResponse.json(
        apiError(
          `NF ${invoiceNumber} já está vinculada à solicitação do pedido ${duplicate.orderNumber ?? duplicate.id}.`,
          "DUPLICATE_INVOICE"
        ),
        { status: 409 }
      );
    }

    // Tenta enriquecer dados da NF via ERP (não-bloqueante)
    const erpInvoice = await fetchInvoiceFromERP(invoiceNumber).catch(() => null);

    const updated = await prisma.deliveryRequest.update({
      where: { id: params.id },
      data: {
        invoiceNumber,
        invoiceStoreId,
        // Enriquece com dados da NF se o ERP retornou
        ...(erpInvoice && {
          customerName:    erpInvoice.customer.name,
          customerPhone:   erpInvoice.customer.phone ?? undefined,
          totalValue:      erpInvoice.totalValue,
        }),
      },
      include: {
        store:        { select: { code: true, name: true } },
        orderStore:   { select: { code: true } },
        invoiceStore: { select: { code: true, name: true } },
        seller:       { select: { id: true, name: true } },
        items:        true,
      },
    });

    return NextResponse.json(apiSuccess(updated));
  } catch (error) {
    console.error("[POST /api/solicitacoes/[id]/vincular-nf]", error);
    return NextResponse.json(apiError("Erro ao vincular nota fiscal"), { status: 500 });
  }
}
