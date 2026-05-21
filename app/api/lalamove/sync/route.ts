// ──────────────────────────────────────────────
// SINCRONIZAÇÃO DE STATUS LALAMOVE (POLLING)
//
// POST /api/lalamove/sync → consulta a API de status do Lalamove para todas as
// corridas ativas e atualiza status/motorista/placa + propaga ao dispatch.
// Disparado pelo polling do client (tela de Rastreamento) enquanto o webhook
// não está configurado.
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { apiSuccess, apiError } from "@/types";
import { syncActiveLalamoveOrders } from "@/services/lalamove-sync.service";

const ROLES = ["ADMIN", "OPERATOR", "LOGISTICS_OPERATOR"];

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json(apiError("Não autenticado"), { status: 401 });
    if (!ROLES.includes(session.role)) {
      return NextResponse.json(apiError("Acesso restrito", "FORBIDDEN"), { status: 403 });
    }

    const { checked, updated } = await syncActiveLalamoveOrders();
    return NextResponse.json(apiSuccess({ checked, updated }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao sincronizar corridas Lalamove";
    console.error("[POST /api/lalamove/sync]", err);
    return NextResponse.json(apiError(msg), { status: 500 });
  }
}
