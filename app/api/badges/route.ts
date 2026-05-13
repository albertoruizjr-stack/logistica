import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/types";
import { COLUMNS_BY_ROLE } from "@/services/operacao.service";
import { DeliveryRequestStatus } from "@prisma/client";

// GET /api/badges
// Retorna contagens por path para alimentar badges do menu lateral.
// Resposta: { paths: { "/solicitacoes": 3, "/transferencias": 2, ... } }

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });

    // Solicitações ativas (não canceladas, não entregues) — todos veem
    const solicitacoesCount = await prisma.deliveryRequest.count({
      where: {
        status: { notIn: [DeliveryRequestStatus.CANCELLED, DeliveryRequestStatus.DELIVERED] },
      },
    });

    // Transferências ativas (não canceladas, não recebidas)
    const transferenciasCount = await prisma.transfer.count({
      where: { status: { notIn: ["CANCELLED", "RECEIVED"] } },
    });

    // Fila operacional — conta apenas os status que o role vê,
    // exceto DELIVERED (entregue não é pendência que precise de ação).
    const cols = COLUMNS_BY_ROLE[session.role];
    const visibleStatuses: DeliveryRequestStatus[] = cols
      ? statusesForColumns(cols)
      : ALL_OPERATIONAL_STATUSES;
    const pendingStatuses = visibleStatuses.filter(s => s !== DeliveryRequestStatus.DELIVERED);
    const operacaoCount = await prisma.deliveryRequest.count({
      where: { status: { in: pendingStatuses } },
    });

    return NextResponse.json(apiSuccess({
      paths: {
        "/solicitacoes":   solicitacoesCount,
        "/transferencias": transferenciasCount,
        "/operacao":       operacaoCount,
      },
    }));
  } catch (error) {
    console.error("[GET /api/badges]", error);
    return NextResponse.json(apiError("Erro ao buscar badges"), { status: 500 });
  }
}

// ──────────────────────────────────────────────
// Mapas internos — alinhados com operacao.service.ts
// ──────────────────────────────────────────────

const COLUMN_TO_STATUSES: Record<string, DeliveryRequestStatus[]> = {
  pendente:      [DeliveryRequestStatus.PENDING, DeliveryRequestStatus.AWAITING_ITEMS],
  transferencia: [DeliveryRequestStatus.AWAITING_TRANSFER],
  separacao:     [DeliveryRequestStatus.SEPARADO],
  fiscal:        [DeliveryRequestStatus.AGUARDANDO_NF, DeliveryRequestStatus.NF_VINCULADA],
  roteirizacao:  [DeliveryRequestStatus.PRONTO_ROTEIRIZACAO, DeliveryRequestStatus.ROTEIRIZADO],
  despacho:      [DeliveryRequestStatus.DISPATCHED],
  transito:      [DeliveryRequestStatus.IN_TRANSIT],
  entregue:      [DeliveryRequestStatus.DELIVERED],
  ocorrencia:    [DeliveryRequestStatus.OCORRENCIA],
};

const ALL_OPERATIONAL_STATUSES: DeliveryRequestStatus[] = Object.values(COLUMN_TO_STATUSES).flat();

function statusesForColumns(cols: string[]): DeliveryRequestStatus[] {
  return cols.flatMap(c => COLUMN_TO_STATUSES[c] ?? []);
}
