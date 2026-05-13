import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { fetchPedidoFaturamento } from "@/services/citel-nf.service";

// GET /api/solicitacoes/[id]/peek-nf
//
// Consulta o Citel pelo PD da solicitação e devolve a NF emitida (se faturado).
// Quando há mais de uma NF (faturamento parcial / split de loja), retorna todas
// pra que a UI ofereça a Jane uma escolha.
//
// Resposta:
//   { jaFaturado, invoices: [{ number, storeCode, storeId, count, dataFaturamento }] }

interface InvoiceOption {
  number:           string;
  storeCode:        string;
  storeId:          string | null;
  itemCount:        number;
  dataFaturamento:  string | null;
}

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
      select: {
        id: true,
        orderNumber:  true,
        orderStore:   { select: { code: true } },
        store:        { select: { code: true } },
      },
    });
    if (!request) {
      return NextResponse.json(apiError("Solicitação não encontrada", "NOT_FOUND"), { status: 404 });
    }
    if (!request.orderNumber) {
      return NextResponse.json(apiError("PD não informado nesta solicitação", "NO_ORDER_NUMBER"), { status: 422 });
    }

    // Loja origem do PD (campo de consulta no Citel) — fallback pra loja responsável
    const queryStoreCode = request.orderStore?.code ?? request.store.code;

    const pedido = await fetchPedidoFaturamento(request.orderNumber, queryStoreCode);
    if (!pedido) {
      return NextResponse.json(apiSuccess({
        jaFaturado: false,
        invoices: [] as InvoiceOption[],
        message: "PD não encontrado no Citel",
      }));
    }

    if (pedido.cancelado) {
      return NextResponse.json(apiSuccess({
        jaFaturado: false,
        invoices: [] as InvoiceOption[],
        message: "PD cancelado no Citel",
      }));
    }

    // Agrega items por NF (numeroFaturamento + empresaFaturamento).
    // Citel devolve número zero-padded ("000000011527"); humanos digitam "11527".
    type Acc = { number: string; storeCode: string; itemCount: number; dataFaturamento: string | null };
    const map = new Map<string, Acc>();
    for (const it of pedido.itens) {
      if (!it.jaFaturado || !it.numeroFaturamento) continue;
      const number    = it.numeroFaturamento.replace(/^0+/, "") || it.numeroFaturamento;
      const storeCode = it.empresaFaturamento ?? queryStoreCode;
      const key = `${number}|${storeCode}`;
      const existing = map.get(key);
      if (existing) {
        existing.itemCount += 1;
      } else {
        map.set(key, { number, storeCode, itemCount: 1, dataFaturamento: it.dataFaturamento });
      }
    }

    if (map.size === 0) {
      return NextResponse.json(apiSuccess({
        jaFaturado: pedido.jaFaturado,
        invoices: [] as InvoiceOption[],
        message: pedido.jaFaturado
          ? "PD marcado como faturado mas sem número de NF disponível"
          : "PD ainda não foi faturado no Citel",
      }));
    }

    // Resolve storeCode → storeId via cadastro local (necessário pra invoiceStoreId)
    const storeCodes = Array.from(new Set(Array.from(map.values()).map(v => v.storeCode)));
    const stores = await prisma.store.findMany({
      where: { code: { in: storeCodes } },
      select: { id: true, code: true },
    });
    const codeToId = new Map(stores.map(s => [s.code, s.id]));

    const invoices: InvoiceOption[] = Array.from(map.values())
      .map(v => ({
        number:          v.number,
        storeCode:       v.storeCode,
        storeId:         codeToId.get(v.storeCode) ?? null,
        itemCount:       v.itemCount,
        dataFaturamento: v.dataFaturamento,
      }))
      .sort((a, b) => b.itemCount - a.itemCount);

    return NextResponse.json(apiSuccess({
      jaFaturado: pedido.jaFaturado,
      invoices,
    }));
  } catch (error) {
    console.error("[GET /api/solicitacoes/[id]/peek-nf]", error);
    return NextResponse.json(apiError("Erro ao consultar NF no Citel"), { status: 500 });
  }
}
